/** Hardware routing stays outside deck transport: switching monitors never seeks audio. */
import { NativeAudioBridge, type NativeSelection } from "./native-audio-bridge.ts";
export type OutputMode = "shared" | "pairs" | "devices" | "native";
export type OutputConfig = {
  mode: OutputMode;
  deviceId: string;
  cueDeviceId: string;
  masterPair: number;
  cuePair: number;
  headphoneVolume: number;
  profileId: string;
  nativeDevice?: number; nativeName?: string; nativeApi?: string; bridgeToken?: string;
};
export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  mode: "shared", deviceId: "", cueDeviceId: "", masterPair: 2, cuePair: 0,
  headphoneVolume: .7, profileId: "ni-audio-6",
};
export const OUTPUT_STORAGE_KEY = "loud.audio-outputs.v1";
export function independentOutputs(config: OutputConfig) { return config.mode !== "shared"; }
export function outputConfigError(config: OutputConfig, maxChannels: number): string | null {
  if (!["shared", "pairs", "devices", "native"].includes(config.mode)) return "Choose a routing mode.";
  if (!Number.isFinite(config.headphoneVolume) || config.headphoneVolume < 0 || config.headphoneVolume > 1) return "Headphone level must be between 0 and 100%.";
  if (config.mode === "pairs" || config.mode === "native") {
    if (![config.masterPair, config.cuePair].every((n) => Number.isInteger(n) && n >= 0 && n % 2 === 0 && n + 2 <= maxChannels)) {
      return `This browser exposes ${maxChannels} output channels. Both selected stereo pairs must be available; install the manufacturer's driver or choose separate output devices.`;
    }
    if (config.masterPair === config.cuePair) return "Master and headphones must use different output pairs.";
  }
  if (config.mode === "native" && (!Number.isInteger(config.nativeDevice) || !config.nativeName || !config.nativeApi || !config.bridgeToken)) return "Connect the native bridge and select its driver/device.";
  if (config.mode === "devices") {
    if ([config.deviceId, config.cueDeviceId].some((id) => !id || id === "default" || id === "communications")) return "Choose two explicitly named outputs, not a system-default alias.";
    if (config.deviceId === config.cueDeviceId) return "Master and headphones must use different output devices.";
  }
  return null;
}
export function parseOutputConfig(value: string | null): OutputConfig | null {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed.deviceId !== "string" || typeof parsed.cueDeviceId !== "string" || typeof parsed.profileId !== "string") return null;
    const config = { ...DEFAULT_OUTPUT_CONFIG, ...parsed } as OutputConfig;
    return outputConfigError(config, 32) ? null : config;
  } catch { return null; }
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type Connection = [AudioNode, AudioNode];

export class HardwareAudioOutputs {
  readonly master: GainNode;
  readonly cue: GainNode;
  readonly preview: GainNode;
  readonly audition: GainNode;
  readonly recording: GainNode;
  private monitor: GainNode;
  private cueRecording: GainNode;
  private previewRecording: GainNode;
  private mainGate: GainNode;
  private monitorGate: GainNode;
  private links: Connection[] = [];
  private nodes: AudioNode[] = [];
  private cuePlayer: SinkElement | null = null;
  private cueStream: MediaStreamAudioDestinationNode | null = null;
  private bridge: NativeAudioBridge | null = null;
  private worklet: AudioWorkletNode | null = null;
  private bridgeModule: Promise<void> | null = null;
  private tone: OscillatorNode | null = null;
  private changing = false;
  private failed = false;
  private generation = 0;
  private ctx: AudioContext;
  private makePlayer: () => SinkElement;
  private reportFailure: (message: string) => void;
  config = { ...DEFAULT_OUTPUT_CONFIG };
  constructor(ctx: AudioContext, makePlayer: () => SinkElement = () => new Audio(), reportFailure: (message: string) => void = () => {}) {
    this.ctx = ctx; this.makePlayer = makePlayer; this.reportFailure = reportFailure;
    const stereo = () => {
      const node = ctx.createGain(); node.channelCount = 2; node.channelCountMode = "explicit";
      return node;
    };
    this.master = stereo(); this.cue = stereo(); this.preview = stereo(); this.audition = stereo();
    this.recording = stereo(); this.monitor = stereo(); this.mainGate = stereo(); this.monitorGate = stereo();
    this.cueRecording = stereo(); this.previewRecording = stereo();
    this.master.connect(this.recording);
    this.cue.connect(this.cueRecording); this.cueRecording.connect(this.recording);
    this.preview.connect(this.previewRecording); this.previewRecording.connect(this.recording);
    this.cue.connect(this.monitor); this.preview.connect(this.monitor); this.audition.connect(this.monitor);
    this.master.connect(this.mainGate); this.monitor.connect(this.monitorGate);
    this.connect(this.mainGate, ctx.destination); this.connect(this.monitorGate, ctx.destination);
  }
  private connect(from: AudioNode, to: AudioNode) { from.connect(to); this.links.push([from, to]); }
  private disconnectRoutes() {
    this.stopTest();
    if (this.worklet) { this.worklet.port.postMessage("stop"); this.worklet.port.onmessage = null; this.worklet = null; }
    this.bridge?.close(); this.bridge = null;
    for (const [from, to] of this.links) { try { from.disconnect(to); } catch {} }
    this.links = [];
    for (const node of this.nodes) { try { node.disconnect(); } catch {} }
    this.nodes = [];
    if (this.cuePlayer) { this.cuePlayer.onerror = null; this.cuePlayer.pause(); this.cuePlayer.srcObject = null; this.cuePlayer = null; }
    this.cueStream?.stream.getTracks().forEach((track) => track.stop()); this.cueStream = null;
  }
  /** Caller holds decks paused during this explicit hardware reconfiguration. */
  async configure(config: OutputConfig) {
    if (this.changing) throw new Error("Audio outputs are already being configured.");
    const early = outputConfigError(config, 32); if (early) throw new Error(early);
    this.changing = true;
    // Never allow a rejected sink or downmix to put private audio on master.
    this.mainGate.gain.value = 0; this.monitorGate.gain.value = 0;
    this.disconnectRoutes();
    const generation = this.generation;
    try {
      const context = this.ctx as SinkContext;
      if (config.mode !== "native") {
        if (context.setSinkId) await context.setSinkId(config.deviceId);
        else if (config.deviceId) throw new Error("This browser cannot select an audio output. Use a current Edge or Chrome browser on localhost or HTTPS.");
      }
      const max = config.mode === "native" ? 32 : this.ctx.destination.maxChannelCount;
      const error = outputConfigError(config, max); if (error) throw new Error(error);
      this.ctx.destination.channelCountMode = "explicit";
      this.ctx.destination.channelInterpretation = "discrete";
      // Keep the device's full channel layout, with unused pairs silent. A
      // smaller stream can be remapped/upmixed by downstream speaker layouts.
      this.ctx.destination.channelCount = config.mode === "pairs" ? max : 2;
      if (config.mode === "native") {
        const bridge = new NativeAudioBridge(config.bridgeToken!, message => { this.failClosed(); this.reportFailure(message); });
        this.bridge = bridge;
        await bridge.devices();
        await bridge.configure(config as OutputConfig & NativeSelection, this.ctx.sampleRate, config.masterPair, config.cuePair);
        this.bridgeModule ??= this.ctx.audioWorklet.addModule("/audio-bridge-worklet.js").catch(error => { this.bridgeModule = null; throw error; });
        await this.bridgeModule;
        const merger = this.ctx.createChannelMerger(4); this.nodes.push(merger);
        for (const [bus, offset] of [[this.mainGate, 0], [this.monitorGate, 2]] as const) {
          const split = this.ctx.createChannelSplitter(2); this.nodes.push(split); this.connect(bus, split);
          split.connect(merger, 0, offset); split.connect(merger, 1, offset + 1);
        }
        const worklet = new AudioWorkletNode(this.ctx, "loud-audio-bridge", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 4, channelCountMode: "explicit", channelInterpretation: "discrete" });
        this.worklet = worklet; this.nodes.push(worklet);
        merger.connect(worklet); worklet.connect(this.ctx.destination); // Processor renders silence here.
        worklet.port.onmessage = event => { if (event.data instanceof ArrayBuffer) bridge.send(event.data); };
        worklet.port.postMessage("start");
      } else if (config.mode === "pairs") {
        const merger = this.ctx.createChannelMerger(this.ctx.destination.channelCount);
        this.nodes.push(merger);
        for (const [bus, first] of [[this.mainGate, config.masterPair], [this.monitorGate, config.cuePair]] as const) {
          const split = this.ctx.createChannelSplitter(2); this.nodes.push(split);
          this.connect(bus, split);
          split.connect(merger, 0, first); split.connect(merger, 1, first + 1);
        }
        merger.connect(this.ctx.destination);
      } else {
        this.connect(this.mainGate, this.ctx.destination);
        if (config.mode === "devices") {
          const player = this.makePlayer(); this.cuePlayer = player;
          player.onerror = () => { this.failClosed(); this.reportFailure("The headphone output stopped. Reconnect it and apply Audio Outputs again."); };
          if (!player.setSinkId) throw new Error("This browser cannot send the headphone bus to a separate output.");
          await player.setSinkId(config.cueDeviceId);
          this.cueStream = this.ctx.createMediaStreamDestination();
          this.cueStream.channelCount = 2;
          this.connect(this.monitorGate, this.cueStream);
          player.srcObject = this.cueStream.stream; player.volume = 1;
          await player.play();
        } else this.connect(this.monitorGate, this.ctx.destination);
      }
      await this.ctx.resume();
      if (generation !== this.generation) throw new Error("Audio output disconnected during setup. Reconnect and try again.");
      this.config = { ...config }; this.failed = false;
      this.cueRecording.gain.value = this.previewRecording.gain.value = independentOutputs(config) ? 0 : 1;
      this.mainGate.gain.value = 1;
      this.monitorGate.gain.value = independentOutputs(config) ? config.headphoneVolume : 1;
    } catch (error) {
      this.failClosed();
      throw error;
    } finally { this.changing = false; }
  }
  setHeadphoneVolume(value: number) {
    this.config.headphoneVolume = Math.max(0, Math.min(1, value));
    if (!this.failed && independentOutputs(this.config)) this.monitorGate.gain.setTargetAtTime(this.config.headphoneVolume, this.ctx.currentTime, .008);
  }
  failClosed() {
    this.generation++;
    this.failed = true; this.mainGate.gain.value = 0; this.monitorGate.gain.value = 0;
    this.disconnectRoutes();
  }
  async checkDevices(devices: readonly MediaDeviceInfo[]) {
    if (this.changing || this.failed) return;
    if (this.config.mode === "native") return; // Native host reports its own disconnects/dropouts.
    const has = (id: string) => !id || id === "default" || devices.some((d) => d.kind === "audiooutput" && d.deviceId === id);
    if (!has(this.config.deviceId) || (this.config.mode === "devices" && !has(this.config.cueDeviceId)) || outputConfigError(this.config, this.ctx.destination.maxChannelCount)) {
      this.failClosed();
      throw new Error("An assigned audio output disappeared or changed. Local outputs are muted; reconnect it and apply Audio Outputs again. Private audio has not been redirected to master.");
    }
  }
  test(bus: "master" | "cue") {
    if (this.failed || this.changing) throw new Error("Apply a valid output configuration first.");
    this.stopTest();
    const tone = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    tone.frequency.value = bus === "master" ? 440 : 660;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.035, now + .02);
    gain.gain.setValueAtTime(.035, now + .4); gain.gain.linearRampToValueAtTime(0, now + .48);
    tone.connect(gain); gain.connect(bus === "master" ? this.mainGate : this.monitorGate);
    tone.onended = () => { gain.disconnect(); tone.disconnect(); if (this.tone === tone) this.tone = null; };
    this.tone = tone; tone.start(); tone.stop(now + .5);
  }
  stopTest() { if (this.tone) { try { this.tone.stop(); } catch {} this.tone = null; } }
  dispose() {
    this.failClosed();
    for (const node of [this.master, this.cue, this.preview, this.audition, this.recording, this.monitor, this.cueRecording, this.previewRecording, this.mainGate, this.monitorGate]) node.disconnect();
  }
}

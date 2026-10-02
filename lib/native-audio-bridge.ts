export type NativeDevice = { id: number; name: string; api: string; channels: number; sampleRate: number };
export type NativeSelection = { nativeDevice: number; nativeName: string; nativeApi: string; bridgeToken: string };
export const BRIDGE_URL = "ws://127.0.0.1:17840";
export class NativeAudioBridge {
  private ws: WebSocket;
  private waiters: { type: string; resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private failure: (message: string) => void;
  private closing = false;
  constructor(token: string, failure: (message: string) => void = () => {}) {
    this.failure = failure;
    this.ws = new WebSocket(BRIDGE_URL); this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: "auth", token }));
    this.ws.onmessage = event => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "error") { this.fail(data.message); return; }
        if (data.type === "status" && (data.underruns || data.overruns || data.callbackErrors)) this.failure("Native audio bridge reported a dropout. Pause and reapply outputs; check CPU load, USB and driver buffer settings.");
        for (const waiter of [...this.waiters]) if (waiter.type === data.type) { clearTimeout(waiter.timer); this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(data); }
      } catch { this.fail("Invalid native bridge response."); }
    };
    this.ws.onerror = () => this.fail("Cannot reach the local audio bridge. Start it and check the pairing token.");
    this.ws.onclose = () => { if (!this.closing) this.fail("The native audio bridge disconnected. Local outputs are muted; reconnect in Audio Outputs."); };
  }
  private fail(message: string) { for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error(message)); } if (!this.closing) this.failure(message); }
  wait(type: string): Promise<any> {
    return new Promise((resolve, reject) => { const waiter = { type, resolve, reject, timer: setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(new Error("Native audio bridge timed out.")); }, 10000) }; this.waiters.push(waiter); });
  }
  async devices(): Promise<NativeDevice[]> { const reply = await this.wait("devices"); return reply.devices; }
  async configure(selection: NativeSelection, sampleRate: number, masterPair: number, cuePair: number) {
    const ready = this.wait("ready");
    this.ws.send(JSON.stringify({ type: "configure", device: selection.nativeDevice, deviceName: selection.nativeName, api: selection.nativeApi, sampleRate, masterPair, cuePair }));
    return ready;
  }
  send(packet: ArrayBuffer) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > 65536) { this.fail("Native output queue stalled. Local outputs muted; reapply routing."); this.close(); return; }
    this.ws.send(packet);
  }
  close() { this.closing = true; this.fail("Native audio connection closed."); this.ws.close(); }
}

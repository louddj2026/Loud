"use client";
import { useEffect, useState } from "react";
import { NativeAudioBridge, type NativeDevice } from "../../lib/native-audio-bridge";
import { AUDIO_HARDWARE_PROFILES } from "../../lib/audio-hardware-profiles";
import { independentOutputs, outputConfigError, type OutputConfig } from "../../lib/audio-output";

export default function AudioOutputSetup({ current, onApply, onTest, onClose }: {
  current: OutputConfig;
  onApply: (config: OutputConfig) => Promise<void>;
  onTest: (bus: "master" | "cue") => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current);
  const [nativeDevices, setNativeDevices] = useState<NativeDevice[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [channels, setChannels] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState("");
  const profile = AUDIO_HARDWARE_PROFILES.find(p => p.id === draft.profileId) ?? AUDIO_HARDWARE_PROFILES[0];
  const change = (patch: Partial<OutputConfig>) => { setDraft(d => ({ ...d, ...patch })); setApplied(false); setStatus(""); if (patch.deviceId !== undefined || patch.mode !== undefined || patch.bridgeToken !== undefined) setChannels(null); if (patch.bridgeToken !== undefined) setNativeDevices([]); };
  const refresh = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Audio device selection needs localhost or HTTPS and a supported browser.");
    setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput"));
  };
  useEffect(() => {
    void refresh().catch(e => setStatus(String(e.message ?? e)));
    const changed = () => { setApplied(false); setChannels(null); void refresh().catch(e => setStatus(String(e.message ?? e))); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, []);
  const discover = async () => {
    setBusy(true);
    try {
      const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
      if (media?.selectAudioOutput) await media.selectAudioOutput();
      else {
        // Chromium uses microphone permission to expose the full output list.
        // Capture is stopped immediately and never enters Loud's audio graph.
        const stream = await media.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop());
      }
      await refresh(); setStatus("Outputs refreshed. Choose the interface exposed by its installed driver.");
    } catch (e) { setStatus(`Could not unlock outputs: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy(false); }
  };
  const inspect = async () => {
    setBusy(true);
    let probe: (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    try {
      probe = new AudioContext();
      if (probe.setSinkId) await probe.setSinkId(draft.deviceId);
      else if (draft.deviceId) throw new Error("Output selection is unavailable in this browser.");
      const max = probe.destination.maxChannelCount; setChannels(max);
      setStatus(`Browser exposes ${max} channels on this output. This is the browser's view, not the number printed on the hardware.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); setChannels(null); }
    finally { await probe?.close(); setBusy(false); }
  };
  const connectNative = async () => {
    setBusy(true); let bridge: NativeAudioBridge | undefined;
    try {
      bridge = new NativeAudioBridge(draft.bridgeToken ?? "");
      const list = await bridge.devices(); setNativeDevices(list); setChannels(null);
      setStatus("Native drivers found. Select the exact driver and device; ASIO is listed when the installed driver exposes it.");
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    finally { bridge?.close(); setBusy(false); }
  };
  const named = devices.filter(d => d.deviceId !== "default" && d.deviceId !== "communications");
  const options = (includeDefault: boolean) => <>{includeDefault && <option value="">System output</option>}{!includeDefault && <option value="">Choose a named output</option>}{named.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Audio output ${i + 1}`}</option>)}</>;
  const pairOptions = Array.from({ length: Math.floor((channels ?? 32) / 2) }, (_, n) => <option value={n * 2} key={n}>{n * 2 + 1} / {n * 2 + 2}</option>);
  const error = outputConfigError(draft, channels ?? 32);
  return <div className="settings-overlay control-setup-overlay"><section className="settings-panel control-setup-panel audio-output-panel" role="dialog" aria-modal="true" aria-labelledby="audio-output-title">
    <div className="settings-panel-head"><div><p className="eyebrow">LOUD · HARDWARE</p><h2 id="audio-output-title">AUDIO OUTPUTS</h2></div><button disabled={busy} type="button" onClick={onClose}>CLOSE</button></div>
    <p>Master stays on the house feed. Selected deck cues feed the headphones. Private Preview replaces only the headphone feed.</p>
    <fieldset disabled={busy}>
      <label>HARDWARE SETUP<select aria-label="Audio hardware profile" value={draft.profileId} onChange={e => { const p = AUDIO_HARDWARE_PROFILES.find(p => p.id === e.target.value)!; change({ profileId: p.id, mode: "pairs", masterPair: p.masterPair, cuePair: p.cuePair }); }}>
        <optgroup label="15 standalone DJ soundcards">{AUDIO_HARDWARE_PROFILES.filter(p => p.category === "soundcard").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
        <optgroup label="25 controllers / mixers with audio">{AUDIO_HARDWARE_PROFILES.filter(p => p.category === "controller-mixer").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      </select></label>
      <div className="audio-output-guide"><b>{profile.name}</b><p>{profile.guidance}</p><small>{profile.documentedPairs ? "Manufacturer-documented physical routing; browser availability still needs checking." : "Setup guide: confirm the USB routing and test both destinations. Not hardware-certified in Loud."}</small><a href={profile.source} target="_blank" rel="noreferrer">Manufacturer information ↗</a></div>
      <label>ROUTING<select aria-label="Audio routing mode" value={draft.mode} onChange={e => change({ mode: e.target.value as OutputConfig["mode"] })}>
        <option value="native">Native DJ driver · ASIO / WASAPI / Core Audio bridge</option>
        <option value="pairs">DJ interface · separate master / cue channel pairs</option>
        <option value="devices">Driver exposes master / cue as separate devices</option>
        <option value="shared">Single shared output · switch local listening</option>
      </select></label>
      {draft.mode !== "native" && <><button type="button" onClick={() => void discover()}>UNLOCK / REFRESH AUDIO DEVICES</button>
      <small>If no output picker is available, the browser may ask for microphone permission to list devices. That temporary capture is stopped immediately.</small>
      <label>{draft.mode === "devices" ? "MASTER DEVICE" : "AUDIO INTERFACE"}<select aria-label="Master audio device" value={draft.deviceId} onChange={e => change({ deviceId: e.target.value })}>{options(draft.mode !== "devices")}</select></label></>}
      {draft.mode === "native" && <>
        <p>Start Loud's optional local audio bridge first. Import its connection.json from your local Loud/audio-bridge folder, or paste the pairing token. The bridge never records microphone input.</p>
        <label>PAIRING FILE<input aria-label="Native bridge pairing file" type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const connection = JSON.parse(await file.text()); if (typeof connection.token !== "string" || connection.token.length < 20) throw new Error("Invalid pairing file"); change({ bridgeToken: connection.token }); } catch { setStatus("Choose the connection.json generated by Loud's local bridge."); } }}/></label>
        <label>PAIRING TOKEN<input aria-label="Native bridge pairing token" type="password" autoComplete="off" value={draft.bridgeToken ?? ""} onChange={e => change({ bridgeToken: e.target.value })}/></label>
        <button type="button" disabled={!draft.bridgeToken} onClick={() => void connectNative()}>CONNECT NATIVE BRIDGE</button>
        <label>NATIVE DRIVER / DEVICE<select aria-label="Native audio driver and device" value={nativeDevices.some(d => d.id === draft.nativeDevice && d.name === draft.nativeName && d.api === draft.nativeApi) ? draft.nativeDevice : ""} onChange={e => { if (!e.target.value) { setChannels(null); return; } const d = nativeDevices.find(d => d.id === Number(e.target.value)); if (!d) return; change({ nativeDevice: d.id, nativeName: d.name, nativeApi: d.api }); setChannels(d.channels); }}><option value="">Choose a driver and device</option>{nativeDevices.map(d => <option key={d.id} value={d.id}>{d.api} · {d.name} · {d.channels} outputs</option>)}</select></label>
        <small>The bridge adds buffering. Master and cue share one native stream. Driver support and latency depend on the device; this is not a hardware certification.</small>
      </>}
      {(draft.mode === "pairs" || draft.mode === "native") && <>{draft.mode === "pairs" && <button type="button" onClick={() => void inspect()}>CHECK AVAILABLE CHANNELS</button>}<div className="audio-output-pairs"><label>MASTER PAIR<select aria-label="Master output pair" value={draft.masterPair} onChange={e => change({ masterPair: Number(e.target.value) })}>{channels !== null && draft.masterPair + 2 > channels && <option value={draft.masterPair}>{draft.masterPair + 1} / {draft.masterPair + 2} (unavailable)</option>}{pairOptions}</select></label><label>HEADPHONE / CUE PAIR<select aria-label="Headphone output pair" value={draft.cuePair} onChange={e => change({ cuePair: Number(e.target.value) })}>{channels !== null && draft.cuePair + 2 > channels && <option value={draft.cuePair}>{draft.cuePair + 1} / {draft.cuePair + 2} (unavailable)</option>}{pairOptions}</select></label></div></>}
      {draft.mode === "devices" && <><label>HEADPHONE DEVICE<select aria-label="Headphone audio device" value={draft.cueDeviceId} onChange={e => change({ cueDeviceId: e.target.value })}>{options(false)}</select></label><small>Separate device paths can add headphone delay. Channel pairs on one interface share a clock and are preferred when available.</small></>}
      {independentOutputs(draft) && <label>HEADPHONE LEVEL · {Math.round(draft.headphoneVolume * 100)}%<input aria-label="Headphone output level" type="range" min="0" max="1" step=".01" value={draft.headphoneVolume} onChange={e => change({ headphoneVolume: Number(e.target.value) })}/></label>}
      <p>{independentOutputs(draft) ? "The top-row Cue Monitor switch is disabled in this mode. Use the deck headphone buttons; the master output and master recording continue during Private Preview." : "Shared output mode is for one listening destination. Cue Monitor and Private Preview replace what that output plays; it cannot carry an independent private headphone feed."}</p>
      <p className="audio-output-driver-note">Install your interface's manufacturer driver. This browser uses the operating-system audio endpoints (for example WASAPI / Core Audio), not a selectable ASIO engine. Use Native DJ driver mode for ASIO through Loud's optional local bridge. ASIO4ALL does not add browser channels.</p>
      {error && <p role="alert">{error}</p>}
      <button className="control-setup-save" type="button" disabled={Boolean(error) || ((draft.mode === "pairs" || draft.mode === "native") && channels === null)} onClick={async () => { setBusy(true); try { await onApply(draft); setApplied(true); setStatus("Routing applied. Lower your hardware levels, then test MASTER and HEADPHONES separately before playing a set."); } catch (e) { setApplied(false); setStatus(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>APPLY OUTPUT ROUTING</button>
      <div className="audio-output-tests"><button type="button" disabled={!applied} onClick={() => { try { onTest("master"); setStatus("Master test: hear the low tone only on the house feed."); } catch (e) { setStatus(String(e)); } }}>TEST MASTER</button><button type="button" disabled={!applied || !independentOutputs(draft)} onClick={() => { try { onTest("cue"); setStatus("Headphone test: hear the higher tone only in the headphones, never in the house feed."); } catch (e) { setStatus(String(e)); } }}>TEST HEADPHONES</button></div>
    </fieldset>
    <p className="control-setup-status" role="status">{status}</p>
  </section></div>;
}

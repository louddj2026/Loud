"use client";
import { createContext, useEffect, useRef, useState } from "react";
import { CONTROL_ACTIONS, DEFAULT_HOTKEYS, HOTKEY_STORAGE_KEY, MIDI_STORAGE_KEY, bindHotkey, hotkeyLabel, keyChord, midiButtonPressed, midiControl, parseHotkeys, parseMidiProfile, sameMidiControl, type ControlAction, type HotkeyBindings, type MidiProfile } from "../../lib/control-bindings";
import { MIDI_PRESETS, copyMidiPreset } from "../../lib/midi-presets";
export const HotkeyContext = createContext<HotkeyBindings>(DEFAULT_HOTKEYS);
export type SetupMode = "hotkeys" | "midi" | null;
export function useHotkeyBindings() {
  const [bindings, setBindings] = useState<HotkeyBindings>(DEFAULT_HOTKEYS);
  useEffect(() => { try {
    const saved = parseHotkeys(localStorage.getItem(HOTKEY_STORAGE_KEY));
    if (!localStorage.getItem("loud-bass-567-migrated")) {
      for (const [action, chord] of Object.entries(saved)) if (["Digit5","Digit6","Digit7"].includes(chord ?? "")) saved[action as ControlAction] = "";
      Object.assign(saved, { "bass:A": "Digit5", "bass:B": "Digit6", "bass:C": "Digit7" });
      localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(saved)); localStorage.setItem("loud-bass-567-migrated", "1");
    }
    setBindings(saved);
  } catch {} }, []);
  const save = (next: HotkeyBindings) => { setBindings(next); try { localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(next)); } catch {} };
  return { bindings, save };
}
export default function ControlSetup({ mode, blocked = false, onClose, hotkeys, onSaveHotkeys, onAction }: { mode: SetupMode; blocked?: boolean; onClose: () => void; hotkeys: HotkeyBindings; onSaveHotkeys: (bindings: HotkeyBindings) => void; onAction: (action: ControlAction, value?: number) => void }) {
  const [presetId, setPresetId] = useState(MIDI_PRESETS[0].id);
  const preset = MIDI_PRESETS.find(p => p.id === presetId)!;
  const [testing, setTesting] = useState(false);
  const [step, setStep] = useState(0);
  const [action, setAction] = useState<ControlAction>("bass:A");
  const [draftKeys, setDraftKeys] = useState(hotkeys);
  const [profile, setProfile] = useState<MidiProfile | null>(null);
  const [draftMidi, setDraftMidi] = useState<MidiProfile | null>(null);
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [status, setStatus] = useState("");
  const [learning, setLearning] = useState(false);
  const latest = useRef({ mode, step, action, draftKeys, draftMidi, profile, learning, onAction, testing, blocked });
  latest.current = { mode, step, action, draftKeys, draftMidi, profile, learning, onAction, testing, blocked };
  useEffect(() => { try { setProfile(parseMidiProfile(localStorage.getItem(MIDI_STORAGE_KEY))); } catch {} }, []);
  useEffect(() => { if (mode) { setTesting(false); setStep(0); setLearning(false); setDraftKeys(hotkeys); setDraftMidi(profile); setStatus(""); } }, [mode]);
  const connect = async () => {
    if (!navigator.requestMIDIAccess) { setStatus("This browser does not support Web MIDI. Open Loud in Edge or Chrome to connect a controller."); return; }
    try { const next = await navigator.requestMIDIAccess({ sysex: false }); setAccess(next); setStatus("MIDI access ready. Select your controller."); }
    catch { setStatus("MIDI access was not granted. You can try Connect again when ready."); }
  };
  useEffect(() => {
    if (!profile || access || !navigator.permissions) return;
    let cancelled = false;
    void navigator.permissions.query({ name: "midi" as PermissionName }).then(async permission => {
      if (permission.state === "granted" && !cancelled) { const next = await navigator.requestMIDIAccess({ sysex: false }); if (!cancelled) setAccess(next); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [profile, access]);
  useEffect(() => {
    if (!access) return;
    const update = () => setInputs(Array.from(access.inputs.values()).filter(input => input.state === "connected"));
    update(); access.addEventListener("statechange", update);
    return () => access.removeEventListener("statechange", update);
  }, [access]);
  useEffect(() => {
    const pressed = new Map<string, boolean>();
    const handlers = inputs.map(input => {
      const handler = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const control = midiControl(event.data); if (!control) return;
        const state = latest.current;
        if (state.blocked) return;
        const selected = state.mode === "midi" ? state.draftMidi : state.profile;
        if (!selected) return;
        const exact = inputs.find(port => port.id === selected.inputId);
        const named = inputs.filter(port => port.name === selected.inputName && (port.manufacturer ?? "") === selected.manufacturer);
        if (input.id !== (exact?.id ?? (named.length === 1 ? named[0].id : ""))) return;
        if (state.mode === "midi" && state.testing) {
          const matched = selected.bindings.find(b => sameMidiControl(b, control));
          setStatus(`${control.type.toUpperCase()} ${control.number} · CH ${control.channel + 1} · value ${control.value} → ${matched ? CONTROL_ACTIONS.find(a => a.id === matched.action)?.label : "Unmapped in this preset"}. Test only: live decks unchanged.`);
          return;
        }
        if (state.mode) {
          if (state.mode !== "midi" || !state.learning) return;
          const definition = CONTROL_ACTIONS.find(item => item.id === state.action)!;
          if (definition.continuous && control.type !== "cc") { setStatus("Move an absolute MIDI knob or fader for this control."); return; }
          if (!definition.continuous && !midiButtonPressed(control)) return;
          const conflict = selected.bindings.find(binding => sameMidiControl(binding, control) && binding.action !== state.action);
          if (conflict) { setStatus("That control is assigned to " + CONTROL_ACTIONS.find(item => item.id === conflict.action)?.label + ". Choose another or remove its old mapping."); return; }
          const binding = { type: control.type, channel: control.channel, number: control.number, action: state.action, continuous: definition.continuous };
          setDraftMidi({ ...selected, bindings: [...selected.bindings.filter(item => item.action !== state.action), binding] });
          latest.current.learning = false; setLearning(false); setStep(2); setStatus("Control learned. Review and save your setup."); return;
        }
        for (const binding of selected.bindings) {
          if (!sameMidiControl(binding, control)) continue;
          if (binding.continuous) { state.onAction(binding.action, control.value); continue; }
          const key = control.type + ":" + control.channel + ":" + control.number;
          const down = midiButtonPressed(control); const wasDown = pressed.get(key) ?? false; pressed.set(key, down);
          if (down && !wasDown) state.onAction(binding.action);
        }
      };
      input.addEventListener("midimessage", handler); return { input, handler };
    });
    return () => handlers.forEach(({ input, handler }) => input.removeEventListener("midimessage", handler));
  }, [inputs]);
  useEffect(() => {
    if (!mode) return;
    let modifier: string | null = null;
    const assign = (chord: string) => {
      const result = bindHotkey(latest.current.draftKeys, latest.current.action, chord);
      if (result.conflict) { setStatus("Already used by " + result.conflict + ". Choose another key or clear that mapping."); return; }
      setDraftKeys(result.bindings); setLearning(false); latest.current.learning = false; setStep(2); setStatus("Key captured. Review and save your shortcuts.");
    };
    const keydown = (event: KeyboardEvent) => {
      if (mode !== "hotkeys" || !latest.current.learning) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === "Escape") { setLearning(false); setStatus("Capture cancelled."); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || ["Tab","Enter","F1"].includes(event.code)) { modifier = null; setStatus("Use a letter, number, punctuation, Space or Shift combination. Navigation and system shortcuts stay reserved."); return; }
      if (/^Shift(Left|Right)$/.test(event.code)) { modifier = event.code; return; }
      modifier = null; assign(keyChord(event));
    };
    const keyup = (event: KeyboardEvent) => {
      if (mode !== "hotkeys" || !latest.current.learning) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (modifier === event.code) { modifier = null; assign(event.code); }
    };
    window.addEventListener("keydown", keydown, true); window.addEventListener("keyup", keyup, true);
    return () => { window.removeEventListener("keydown", keydown, true); window.removeEventListener("keyup", keyup, true); };
  }, [mode]);
  if (!mode) return null;
  const selectedAction = CONTROL_ACTIONS.find(item => item.id === action)!;
  const save = () => {
    if (mode === "hotkeys") onSaveHotkeys(draftKeys);
    else { setProfile(draftMidi); try { if (draftMidi) localStorage.setItem(MIDI_STORAGE_KEY, JSON.stringify(draftMidi)); else localStorage.removeItem(MIDI_STORAGE_KEY); } catch {} }
    onClose();
  };
  return <div className="settings-overlay control-setup-overlay"><section className="settings-panel control-setup-panel" role="dialog" aria-modal="true" aria-label={mode === "hotkeys" ? "Hotkey setup wizard" : "MIDI controller wizard"}>
    <div className="settings-panel-head"><div><p className="eyebrow">LOUD · {step + 1} / 3</p><h2>{mode === "hotkeys" ? "HOTKEY SETUP" : "MIDI CONTROLLER"}</h2></div><button type="button" onClick={onClose}>CANCEL</button></div>
    <p className="control-setup-intro">{step === 0 ? "Choose the control to configure." : step === 1 ? "Learn its physical input." : "Review your mappings, then save."}</p>
    {step === 0 && <>
      {mode === "midi" && <div className="control-setup-device"><button type="button" onClick={() => void connect()}>CONNECT MIDI</button><label>CONTROLLER<select aria-label="MIDI controller" value={draftMidi?.inputId ?? ""} onChange={event => { const input = inputs.find(item => item.id === event.target.value); if (input) setDraftMidi({ inputId: input.id, inputName: input.name ?? "MIDI input", manufacturer: input.manufacturer ?? "", bindings: input.id === profile?.inputId ? profile.bindings : [] }); }}><option value="">Select a connected controller</option>{inputs.map(input => <option key={input.id} value={input.id}>{input.name || input.id}</option>)}</select></label><small>{access && !inputs.length ? "No MIDI inputs detected. Plug in your controller; this list updates automatically." : "Buttons use notes or CC messages. Knobs and faders use absolute CC values."}</small></div>}
      {mode === "midi" && <div className="control-setup-device">
        <label>10 MIDI-ONLY PRESETS<select aria-label="MIDI preset" value={presetId} onChange={e => setPresetId(e.target.value)}>{MIDI_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <b>{preset.customTemplate ? "Requires the described hardware template" : "Uses the specified hardware mode"}</b><p>{preset.setup}</p>
        <a href={preset.source} target="_blank" rel="noreferrer">Manufacturer MIDI reference ↗</a>
        <button type="button" disabled={!draftMidi} onClick={() => { setDraftMidi(current => current ? { ...current, bindings: copyMidiPreset(presetId) } : null); setStep(2); setTesting(false); setStatus("Preset loaded into this draft. Review the required hardware mode, test controls, then save. Existing saved mappings change only when you save."); }}>LOAD PRESET INTO DRAFT</button>
      </div>}
      <label>LOUD CONTROL<select aria-label="Control to configure" value={action} onChange={event => setAction(event.target.value as ControlAction)}>{CONTROL_ACTIONS.filter(item => mode === "midi" || !item.continuous).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <p>{mode === "hotkeys" ? "Current key: " + hotkeyLabel(draftKeys[action]) : "Selected: " + selectedAction.label}</p>
      <button type="button" onClick={() => { if (mode === "hotkeys") setDraftKeys(current => ({ ...current, [action]: "" })); else setDraftMidi(current => current ? { ...current, bindings: current.bindings.filter(item => item.action !== action) } : null); setStep(2); }}>CLEAR THIS MAPPING</button>
      {mode === "hotkeys" && <button type="button" onClick={() => { setDraftKeys({ ...DEFAULT_HOTKEYS }); setStep(2); }}>RESTORE DEFAULTS · BASS 5 / 6 / 7</button>}
      <button type="button" disabled={mode === "midi" && !draftMidi} onClick={() => { setStep(1); setStatus(""); }}>NEXT</button>
    </>}
    {step === 1 && <><b>{selectedAction.label}</b><p>{mode === "hotkeys" ? "Click Listen, then press your new key. Tap either Shift key to assign it alone; Esc cancels capture." : selectedAction.continuous ? "Click Listen, then move the knob or fader." : "Click Listen, then press the controller button."}</p><button type="button" disabled={learning} onClick={() => { setLearning(true); setStatus("Listening…"); }}>{learning ? "LISTENING…" : "LISTEN"}</button></>}
    {step === 2 && <>{mode === "midi" && <button type="button" onClick={() => { setTesting(v => !v); setStatus("Move a mapped control to check its message. Test mode does not operate live decks."); }}>{testing ? "STOP INPUT TEST" : "TEST MAPPED INPUTS"}</button>}<div className="control-setup-review">{(mode === "hotkeys" ? CONTROL_ACTIONS.filter(item => draftKeys[item.id]) : CONTROL_ACTIONS.filter(item => draftMidi?.bindings.some(binding => binding.action === item.id))).map(item => <div key={item.id}><span>{item.label}</span><b>{mode === "hotkeys" ? hotkeyLabel(draftKeys[item.id]) : (() => { const binding = draftMidi!.bindings.find(b => b.action === item.id)!; return binding.type.toUpperCase() + " " + binding.number + " · CH " + (binding.channel + 1); })()}</b></div>)}</div><button type="button" onClick={() => { setStep(0); setTesting(false); setStatus(""); }}>CONFIGURE ANOTHER</button><button type="button" className="control-setup-save" onClick={save}>SAVE SETUP</button></>}
    {step > 0 && <button type="button" onClick={() => { setStep(step - 1); setLearning(false); }}>BACK</button>}
    <p className="control-setup-status" role="status">{status}</p>
  </section></div>;
}

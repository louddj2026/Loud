export type ControlDeck = "A" | "B" | "C";
export type ControlKind = "play" | "cue" | "bass" | "loop" | "loop-half" | "loop-double" | "loop-back" | "loop-forward" | "volume" | "low" | "mid" | "high";
export type ControlAction = `${ControlKind}:${ControlDeck}` | "play-all" | "overview-out" | "overview-in";
export const CONTROL_ACTIONS: { id: ControlAction; label: string; continuous: boolean }[] = (["A", "B", "C"] as const).flatMap(deck => (
  [
    ["play", "Play / pause"], ["cue", "Headphone cue"], ["bass", "Bass kill / restore"], ["loop", "Loop on / off"],
    ["loop-half", "Halve loop"], ["loop-double", "Double loop"], ["loop-back", "Move loop left"], ["loop-forward", "Move loop right"],
    ["volume", "Volume"], ["low", "Low EQ"], ["mid", "Mid EQ"], ["high", "High EQ"],
  ] as const
).map(([kind, label]) => ({ id: `${kind}:${deck}` as ControlAction, label: `Deck ${deck} · ${label}`, continuous: ["volume", "low", "mid", "high"].includes(kind) }))).concat([
  { id: "play-all", label: "Play / pause playing decks", continuous: false },
  { id: "overview-out", label: "Selected deck · Overview zoom out", continuous: false },
  { id: "overview-in", label: "Selected deck · Overview zoom in", continuous: false },
]);
export type HotkeyBindings = Partial<Record<ControlAction, string>>;
export const HOTKEY_STORAGE_KEY = "loud-hotkeys-v1";
export const DEFAULT_HOTKEYS: HotkeyBindings = {
  "play:A": "KeyQ", "play:B": "Shift+Digit3", "play:C": "KeyC",
  "cue:A": "Backquote", "cue:B": "Backspace", "cue:C": "KeyV",
  "bass:A": "Digit5", "bass:B": "Digit6", "bass:C": "Digit7",
  "loop:A": "ShiftLeft", "loop:B": "ShiftRight",
  "loop-half:A": "KeyA", "loop-double:A": "KeyS", "loop-back:A": "KeyZ", "loop-forward:A": "KeyX",
  "loop-half:B": "Semicolon", "loop-double:B": "Quote", "loop-back:B": "Period", "loop-forward:B": "Slash",
  "play-all": "Space", "overview-out": "Minus", "overview-in": "Shift+Equal",
};

export function keyChord(event: { code: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): string {
  if (/^(Shift|Alt|Control|Meta)(Left|Right)$/.test(event.code)) return event.code;
  const code = event.code.replace(/^Numpad([0-9])$/, "Digit$1");
  if (code === "NumpadSubtract") return "Minus";
  if (code === "NumpadAdd") return "Shift+Equal";
  return [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift", code].filter(Boolean).join("+");
}

export function hotkeyLabel(chord: string | undefined): string {
  return chord ? chord.replace(/Key(?=[A-Z])/g, "").replace(/Digit(?=\d)/g, "").replace("ShiftLeft", "Left Shift (tap)").replace("ShiftRight", "Right Shift (tap)").replace("Backquote", "`").replace("Semicolon", ";").replace("Quote", "'").replace("Period", ".").replace("Slash", "/").replace("Equal", "=").replace("Minus", "−") : "Unassigned";
}

export function parseHotkeys(raw: string | null): HotkeyBindings {
  if (!raw) return { ...DEFAULT_HOTKEYS };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_HOTKEYS };
    const bindings = { ...DEFAULT_HOTKEYS };
    for (const action of CONTROL_ACTIONS.filter(action => !action.continuous)) {
      if (typeof value[action.id] === "string" && value[action.id].length < 50) bindings[action.id] = value[action.id];
    }
    return bindings;
  } catch { return { ...DEFAULT_HOTKEYS }; }
}

export type MidiControl = { type: "note" | "cc"; channel: number; number: number; value: number };
export type MidiBinding = Omit<MidiControl, "value"> & { action: ControlAction; continuous: boolean };
export type MidiProfile = { inputId: string; inputName: string; manufacturer: string; bindings: MidiBinding[] };
export function midiControl(data: ArrayLike<number>): MidiControl | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  if (status !== 0x80 && status !== 0x90 && status !== 0xb0) return null;
  return { type: status === 0xb0 ? "cc" : "note", channel: data[0] & 0x0f, number: data[1], value: status === 0x80 ? 0 : data[2] };
}
export function sameMidiControl(left: Omit<MidiControl, "value">, right: Omit<MidiControl, "value">): boolean {
  return left.type === right.type && left.channel === right.channel && left.number === right.number;
}
export function midiEqDb(value: number): number {
  return value <= 64 ? -60 + value / 64 * 60 : (value - 64) / 63 * 12;
}
export function midiButtonPressed(control: MidiControl): boolean {
  return control.type === "note" ? control.value > 0 : control.value >= 64;
}

export const MIDI_STORAGE_KEY = "loud-midi-v1";
export function parseMidiProfile(raw: string | null): MidiProfile | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || typeof p.inputId !== "string" || !Array.isArray(p.bindings)) return null;
    return { inputId: p.inputId, inputName: typeof p.inputName === "string" ? p.inputName : "", manufacturer: typeof p.manufacturer === "string" ? p.manufacturer : "", bindings: p.bindings.filter((b: MidiBinding) => b && (b.type === "cc" || b.type === "note") && Number.isInteger(b.channel) && b.channel >= 0 && b.channel < 16 && Number.isInteger(b.number) && b.number >= 0 && b.number < 128 && CONTROL_ACTIONS.some(a => a.id === b.action && a.continuous === b.continuous) && (!b.continuous || b.type === "cc")) };
  } catch { return null; }
}
export function bindHotkey(bindings: HotkeyBindings, action: ControlAction, chord: string): { bindings: HotkeyBindings; conflict?: string } {
  const conflict = Object.entries(bindings).find(([id, value]) => id !== action && value === chord && chord);
  return conflict ? { bindings, conflict: CONTROL_ACTIONS.find(a => a.id === conflict[0])?.label ?? conflict[0] } : { bindings: { ...bindings, [action]: chord } };
}

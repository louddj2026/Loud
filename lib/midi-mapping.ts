export const MIDI_MAPPING_VERSION = 1;

export type MidiSignalKind = "note" | "control-change" | "pitch-bend";
export type MidiBindingMode =
  | "momentary"
  | "toggle"
  | "absolute"
  | "relative-twos-complement"
  | "relative-binary-offset";
export type MidiTargetKind = "button" | "toggle" | "continuous" | "stepped";
export type MidiPermissionState = "unknown" | "requesting" | "granted" | "denied" | "unsupported";
export type MidiWizardStep = "intro" | "permission" | "device" | "learn" | "review" | "complete";

export type MidiSignal = {
  inputId: string;
  channel: number;
  kind: MidiSignalKind;
  number: number;
  rawValue: number;
  value: number;
  active: boolean;
  receivedAt: number;
};

export type MidiTargetDefinition = {
  id: string;
  label: string;
  kind: MidiTargetKind;
  preferredMode: MidiBindingMode;
  minimum?: number;
  maximum?: number;
};

export type MidiBinding = {
  id: string;
  targetId: string;
  inputId: string;
  channel: number;
  kind: MidiSignalKind;
  number: number;
  mode: MidiBindingMode;
  minimum: number;
  maximum: number;
  invert: boolean;
  sensitivity: number;
};

export type MidiDeviceSummary = {
  id: string;
  name: string;
  manufacturer?: string;
};

export type MidiWizardState = {
  step: MidiWizardStep;
  permission: MidiPermissionState;
  devices: MidiDeviceSummary[];
  selectedInputId: string | null;
  learningTargetId: string | null;
  bindings: MidiBinding[];
  error: string | null;
};

export type MidiMappingProfile = {
  version: typeof MIDI_MAPPING_VERSION;
  id: string;
  name: string;
  inputId: string;
  inputName: string;
  bindings: MidiBinding[];
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function decodeMidiMessage(
  inputId: string,
  data: ArrayLike<number>,
  receivedAt = 0,
): MidiSignal | null {
  if (data.length < 1) return null;
  const status = Number(data[0]);
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const first = clamp(Number(data[1] ?? 0), 0, 127);
  const second = clamp(Number(data[2] ?? 0), 0, 127);

  if (command === 0x80 || command === 0x90) {
    const active = command === 0x90 && second > 0;
    return {
      inputId,
      channel,
      kind: "note",
      number: first,
      rawValue: active ? second : 0,
      value: active ? second / 127 : 0,
      active,
      receivedAt,
    };
  }
  if (command === 0xb0) {
    return {
      inputId,
      channel,
      kind: "control-change",
      number: first,
      rawValue: second,
      value: second / 127,
      active: second > 0,
      receivedAt,
    };
  }
  if (command === 0xe0) {
    const rawValue = first + second * 128;
    return {
      inputId,
      channel,
      kind: "pitch-bend",
      number: 0,
      rawValue,
      value: rawValue / 16383,
      active: rawValue !== 8192,
      receivedAt,
    };
  }
  return null;
}

export function midiSignalKey(signal: Pick<MidiSignal, "inputId" | "channel" | "kind" | "number">) {
  return `${signal.inputId}:${signal.channel}:${signal.kind}:${signal.number}`;
}

export function midiBindingMatches(binding: MidiBinding, signal: MidiSignal) {
  return binding.inputId === signal.inputId
    && binding.channel === signal.channel
    && binding.kind === signal.kind
    && binding.number === signal.number;
}

export function createMidiBinding(
  target: MidiTargetDefinition,
  signal: MidiSignal,
  mode = target.preferredMode,
): MidiBinding {
  return {
    id: `${target.id}:${midiSignalKey(signal)}`,
    targetId: target.id,
    inputId: signal.inputId,
    channel: signal.channel,
    kind: signal.kind,
    number: signal.number,
    mode,
    minimum: target.minimum ?? 0,
    maximum: target.maximum ?? 1,
    invert: false,
    sensitivity: .01,
  };
}

export function midiBindingConflicts(bindings: readonly MidiBinding[], candidate: MidiBinding) {
  return bindings.filter((binding) =>
    binding.id !== candidate.id
    && binding.inputId === candidate.inputId
    && binding.channel === candidate.channel
    && binding.kind === candidate.kind
    && binding.number === candidate.number
  );
}

export function applyMidiBinding(
  binding: MidiBinding,
  signal: MidiSignal,
  currentValue: number,
): number | null {
  if (!midiBindingMatches(binding, signal)) return null;
  const minimum = Math.min(binding.minimum, binding.maximum);
  const maximum = Math.max(binding.minimum, binding.maximum);
  const fromUnit = (unit: number) => {
    const directed = binding.invert ? 1 - unit : unit;
    return minimum + clamp(directed, 0, 1) * (maximum - minimum);
  };

  if (binding.mode === "momentary") return signal.active ? maximum : minimum;
  if (binding.mode === "toggle") {
    if (!signal.active || signal.value === 0) return null;
    return currentValue > (minimum + maximum) / 2 ? minimum : maximum;
  }
  if (binding.mode === "absolute") return fromUnit(signal.value);

  let steps = 0;
  if (binding.mode === "relative-twos-complement") {
    steps = signal.rawValue <= 63 ? signal.rawValue : signal.rawValue - 128;
  } else {
    steps = signal.rawValue - 64;
  }
  const direction = binding.invert ? -1 : 1;
  return clamp(
    currentValue + steps * binding.sensitivity * (maximum - minimum) * direction,
    minimum,
    maximum,
  );
}

export function createMidiWizardState(): MidiWizardState {
  return {
    step: "intro",
    permission: "unknown",
    devices: [],
    selectedInputId: null,
    learningTargetId: null,
    bindings: [],
    error: null,
  };
}

export function setMidiPermission(
  state: MidiWizardState,
  permission: MidiPermissionState,
  devices: readonly MidiDeviceSummary[] = state.devices,
) {
  return {
    ...state,
    permission,
    devices: [...devices],
    selectedInputId: devices.some((device) => device.id === state.selectedInputId)
      ? state.selectedInputId
      : devices[0]?.id ?? null,
    step: permission === "granted" ? "device" as const : "permission" as const,
    error: permission === "denied"
      ? "MIDI access was denied. Allow MIDI devices in Chrome, then try again."
      : permission === "unsupported"
        ? "This browser does not expose Web MIDI."
        : null,
  };
}

export function selectMidiInput(state: MidiWizardState, inputId: string) {
  if (!state.devices.some((device) => device.id === inputId)) {
    return { ...state, error: "That MIDI input is no longer connected." };
  }
  return {
    ...state,
    selectedInputId: inputId,
    learningTargetId: null,
    step: "learn" as const,
    error: null,
  };
}

export function beginMidiLearn(state: MidiWizardState, targetId: string) {
  if (!state.selectedInputId) {
    return { ...state, step: "device" as const, error: "Choose a MIDI input first." };
  }
  return { ...state, learningTargetId: targetId, step: "learn" as const, error: null };
}

export function captureMidiLearn(
  state: MidiWizardState,
  signal: MidiSignal,
  targets: readonly MidiTargetDefinition[],
) {
  if (!state.learningTargetId || signal.inputId !== state.selectedInputId) return state;
  const target = targets.find((candidate) => candidate.id === state.learningTargetId);
  if (!target) return { ...state, error: "That booth control is no longer available." };
  const binding = createMidiBinding(target, signal);
  const withoutTarget = state.bindings.filter((current) => current.targetId !== target.id);
  const conflicts = midiBindingConflicts(withoutTarget, binding);
  return {
    ...state,
    bindings: [...withoutTarget.filter((current) => !conflicts.includes(current)), binding],
    learningTargetId: null,
    error: conflicts.length
      ? `${conflicts[0].targetId} was unmapped because this MIDI control is now assigned to ${target.label}.`
      : null,
  };
}

export function reviewMidiSetup(state: MidiWizardState) {
  if (!state.selectedInputId) return { ...state, step: "device" as const, error: "Choose a MIDI input first." };
  if (!state.bindings.length) return { ...state, step: "learn" as const, error: "Map at least one booth control." };
  return { ...state, step: "review" as const, learningTargetId: null, error: null };
}

export function completeMidiSetup(
  state: MidiWizardState,
  profileId: string,
  profileName: string,
): { state: MidiWizardState; profile: MidiMappingProfile } {
  const input = state.devices.find((device) => device.id === state.selectedInputId);
  if (!input || !state.bindings.length) throw new Error("The MIDI setup is incomplete.");
  return {
    state: { ...state, step: "complete", error: null },
    profile: {
      version: MIDI_MAPPING_VERSION,
      id: profileId,
      name: profileName,
      inputId: input.id,
      inputName: input.name,
      bindings: state.bindings,
    },
  };
}


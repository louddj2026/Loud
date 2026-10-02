import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMidiBinding,
  beginMidiLearn,
  captureMidiLearn,
  completeMidiSetup,
  createMidiBinding,
  createMidiWizardState,
  decodeMidiMessage,
  reviewMidiSetup,
  selectMidiInput,
  setMidiPermission,
} from "../lib/midi-mapping.ts";

const targets = [
  { id: "play", label: "Play", kind: "toggle", preferredMode: "toggle" },
  { id: "volume", label: "Volume", kind: "continuous", preferredMode: "absolute" },
];

test("MIDI decoder handles notes, CC and 14-bit pitch bend", () => {
  assert.deepEqual(decodeMidiMessage("controller", [0x91, 36, 127], 20), {
    inputId: "controller",
    channel: 2,
    kind: "note",
    number: 36,
    rawValue: 127,
    value: 1,
    active: true,
    receivedAt: 20,
  });
  assert.equal(decodeMidiMessage("controller", [0x91, 36, 0])?.active, false);
  assert.equal(decodeMidiMessage("controller", [0xb0, 7, 64])?.value, 64 / 127);
  assert.equal(decodeMidiMessage("controller", [0xe0, 0, 64])?.value, 8192 / 16383);
  assert.equal(decodeMidiMessage("controller", [0xf8]), null);
});

test("absolute, toggle and relative bindings produce bounded values", () => {
  const cc = decodeMidiMessage("controller", [0xb0, 7, 127]);
  assert.ok(cc);
  const absolute = createMidiBinding(targets[1], cc);
  assert.equal(applyMidiBinding(absolute, cc, 0), 1);

  const note = decodeMidiMessage("controller", [0x90, 40, 100]);
  assert.ok(note);
  const toggle = createMidiBinding(targets[0], note);
  assert.equal(applyMidiBinding(toggle, note, 0), 1);
  assert.equal(applyMidiBinding(toggle, { ...note, active: false, value: 0 }, 1), null);

  const relative = { ...absolute, mode: "relative-twos-complement", sensitivity: .01 };
  assert.equal(applyMidiBinding(relative, { ...cc, rawValue: 1 }, .5), .51);
  assert.equal(applyMidiBinding(relative, { ...cc, rawValue: 127 }, .5), .49);
  assert.equal(applyMidiBinding(relative, { ...cc, rawValue: 20 }, .95), 1);
});

test("wizard selects a device, learns controls, resolves conflicts and saves a profile", () => {
  let state = createMidiWizardState();
  state = setMidiPermission(state, "granted", [{ id: "controller", name: "Test Controller" }]);
  assert.equal(state.step, "device");
  state = selectMidiInput(state, "controller");
  state = beginMidiLearn(state, "play");
  const note = decodeMidiMessage("controller", [0x90, 40, 100]);
  assert.ok(note);
  state = captureMidiLearn(state, note, targets);
  assert.equal(state.bindings[0].targetId, "play");

  state = beginMidiLearn(state, "volume");
  state = captureMidiLearn(state, note, targets);
  assert.deepEqual(state.bindings.map((binding) => binding.targetId), ["volume"]);
  assert.match(state.error, /play was unmapped/);

  state = reviewMidiSetup(state);
  assert.equal(state.step, "review");
  const completed = completeMidiSetup(state, "test-profile", "My controller");
  assert.equal(completed.state.step, "complete");
  assert.equal(completed.profile.inputName, "Test Controller");
  assert.equal(completed.profile.bindings.length, 1);
});


import assert from "node:assert/strict";
import test from "node:test";
import { FOCUS_WAVE_COLOURS } from "../app/dj/dj-ui-config.ts";

test("focused decks use explicit wave, label and overlap colours", () => {
  assert.deepEqual(FOCUS_WAVE_COLOURS, {
    A: { wave: "#55a7ff", label: "#d9ff54", overlap: "#4cf2b4" },
    B: { wave: "#d9ff54", label: "#ff5a67", overlap: "#ff9f43" },
    C: { wave: "#ff5a67", label: "#55a7ff", overlap: "#ab7dff" },
  });
});

test("each deck's wave, label and overlap colours remain distinct", () => {
  for (const colours of Object.values(FOCUS_WAVE_COLOURS)) {
    assert.equal(new Set(Object.values(colours)).size, 3);
  }
});

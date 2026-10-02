import assert from "node:assert/strict";
import test from "node:test";
import { clippedFocusWaveLabel, focusWaveTrackLabel } from "../lib/track-labels.ts";

test("uploaded album filenames become artist and tune labels", () => {
  assert.deepEqual(
    focusWaveTrackLabel({ name: "Bio Genesis - Harmonic Science - 10 - Bazoom", album: "User uploads" }),
    { artist: "Bio Genesis", title: "Bazoom" },
  );
  assert.deepEqual(
    focusWaveTrackLabel({ name: "Broken Toy - Broken Toy - 05 - Fucking Machines", album: "User uploads" }),
    { artist: "Broken Toy", title: "Fucking Machines" },
  );
});

test("compilation filenames use the post-track artist", () => {
  assert.deepEqual(
    focusWaveTrackLabel({ name: "VA - The Exploding Man - 09 - Switch - Megasonics", album: "User uploads" }),
    { artist: "Switch", title: "Megasonics" },
  );
  assert.deepEqual(
    focusWaveTrackLabel({ name: "09. Switch   Megasonics", album: "Various - The Exploding Man" }),
    { artist: "Switch", title: "Megasonics" },
  );
});

test("short and imperfect filenames retain a useful tune label", () => {
  assert.deepEqual(focusWaveTrackLabel({ name: "01-Damage - Bringdanoise", album: "User uploads" }), { artist: "Damage", title: "Bringdanoise" });
  assert.deepEqual(focusWaveTrackLabel({ name: "05-Dirty Boy", album: "User uploads" }), { artist: "UNKNOWN ARTIST", title: "Dirty Boy" });
  assert.deepEqual(focusWaveTrackLabel({ name: "10 - Bazoom", album: "Bio Genesis - Harmonic Science" }), { artist: "Bio Genesis", title: "Bazoom" });
});

test("wave labels clip without losing the artist/title distinction", () => {
  assert.equal(clippedFocusWaveLabel("A very long tune title", 12), "A very long…");
  assert.equal(clippedFocusWaveLabel("Bazoom", 12), "Bazoom");
});

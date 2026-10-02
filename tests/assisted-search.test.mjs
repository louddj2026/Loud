import assert from "node:assert/strict";
import test from "node:test";
import { assistedSelectionPool } from "../lib/assisted-search.ts";

test("assisted selection keeps every unused tune regardless of tempo, mapping or compatibility metadata", () => {
  const tracks = [
    { id: "slow", bpm: 72, mapped: false, incompatible: true },
    { id: "fast", bpm: 178, mapped: true, incompatible: true },
    { id: "unknown", bpm: null, mapped: false, incompatible: false },
  ];
  assert.deepEqual(assistedSelectionPool(tracks, new Set()), tracks);
});

test("assisted selection only excludes a tune already used in the current rotation", () => {
  const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(assistedSelectionPool(tracks, new Set(["b"])), [tracks[0], tracks[2]]);
});

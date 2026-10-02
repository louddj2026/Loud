import assert from "node:assert/strict";
import test from "node:test";
import {
  assistedSessionReady,
  createAssistedSessionSnapshot,
  parseAssistedSessionSnapshot,
} from "../lib/assisted-session.ts";

const preparedPair = {
  source: "loaded",
  order: 1,
  deck: "B",
  trackId: "elements-next",
  mixInRequired: true,
  mixInSet: true,
  mixOutSet: true,
  introPrepSkipped: false,
  selection: {
    selectedBpm: 144,
    previousTrackId: "elements-current",
    previousTrackName: "Current",
    previousBpm: 142,
  },
  launchedOrder: 1,
  wasPlaying: true,
};

test("a playing assisted pair persists as a reusable prepared session", () => {
  const snapshot = createAssistedSessionSnapshot(preparedPair, "2026-07-24T01:00:00.000Z");
  assert.deepEqual(parseAssistedSessionSnapshot(JSON.stringify(snapshot)), snapshot);
  assert.equal(assistedSessionReady(snapshot), true);
});

test("an incoming assisted tune is ready before its later outgoing window is set", () => {
  const snapshot = createAssistedSessionSnapshot({ ...preparedPair, mixOutSet: false });
  assert.equal(assistedSessionReady(snapshot), true);
});

test("an incoming assisted session without its Mix In restores to cue preparation", () => {
  const snapshot = createAssistedSessionSnapshot({ ...preparedPair, mixInSet: false });
  assert.equal(assistedSessionReady(snapshot), false);
});

test("invalid assisted session storage is ignored", () => {
  assert.equal(parseAssistedSessionSnapshot("{"), null);
  assert.equal(parseAssistedSessionSnapshot(JSON.stringify({ ...preparedPair, version: 9 })), null);
});

test("older assisted sessions default to random-library mode", () => {
  const legacy = createAssistedSessionSnapshot({ ...preparedPair, source: "random" });
  delete legacy.source;
  assert.equal(parseAssistedSessionSnapshot(JSON.stringify(legacy))?.source, "random");
});

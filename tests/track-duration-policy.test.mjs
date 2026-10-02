import assert from "node:assert/strict";
import test from "node:test";
import { MINIMUM_FULL_TUNE_SECONDS, isKnownFullTune, isKnownShortSample } from "../lib/track-duration-policy.ts";

test("assisted search silently recognises short samples before considering tunes", () => {
  assert.equal(MINIMUM_FULL_TUNE_SECONDS, 90);
  assert.equal(isKnownShortSample(12), true);
  assert.equal(isKnownShortSample(89.99), true);
  assert.equal(isKnownShortSample(90), false);
  assert.equal(isKnownFullTune(90), true);
  assert.equal(isKnownFullTune(420), true);
});

test("unknown duration is not mistaken for a short sample", () => {
  assert.equal(isKnownShortSample(0), false);
  assert.equal(isKnownShortSample(null), false);
  assert.equal(isKnownFullTune(0), false);
  assert.equal(isKnownFullTune(undefined), false);
});

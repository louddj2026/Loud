import assert from "node:assert/strict";
import test from "node:test";
import { naturalTempoRate } from "../lib/tempo-return.ts";

test("an adjusted tune returns gently to natural tempo across its playing time", () => {
  assert.equal(naturalTempoRate(1.04, 100, 300, 100), 1.04);
  assert.ok(Math.abs(naturalTempoRate(1.04, 100, 300, 200) - 1.02) < .00001);
  assert.equal(naturalTempoRate(1.04, 100, 300, 300), 1);
  assert.ok(naturalTempoRate(1.04, 100, 300, 120) > 1.038);
});

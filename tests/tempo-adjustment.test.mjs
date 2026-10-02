import assert from "node:assert/strict";
import test from "node:test";
import { fineTempoStepBpm, tempoRateAfterBpmStep, FINE_TEMPO_MAX_STEP_BPM } from "../lib/tempo-adjustment.ts";

test("one press changes effective tempo by exactly .001 BPM at different local tempos and playback rates", () => {
  for (const bpm of [87, 120, 142.447, 174]) {
    for (const rate of [.75, 1, 1.2]) {
      for (const direction of [-1, 1]) {
        const next = tempoRateAfterBpmStep(bpm, rate, direction, fineTempoStepBpm(0));
        assert.ok(Math.abs((next - rate) * bpm - direction * .001) < 1e-10);
      }
    }
  }
});
test("tempo changes use the BPM in the current portion rather than the overall track figure", () => {
  const next = tempoRateAfterBpmStep(174, 1, 1, .001);
  assert.ok(Math.abs(next * 174 - 174.001) < 1e-10);
  assert.notEqual(next, tempoRateAfterBpmStep(140, 1, 1, .001));
});
test("the hold curve stays fine initially, accelerates smoothly and caps large steps", () => {
  assert.equal(fineTempoStepBpm(0), .001);
  assert.equal(fineTempoStepBpm(399), .001);
  assert.ok(fineTempoStepBpm(1400) > fineTempoStepBpm(900));
  assert.ok(fineTempoStepBpm(3400) > fineTempoStepBpm(1400));
  assert.equal(fineTempoStepBpm(60_000), FINE_TEMPO_MAX_STEP_BPM);
  assert.equal(fineTempoStepBpm(-100), .001);
});
test("invalid BPM or steps cannot change playback rate, and rate limits are retained", () => {
  assert.equal(tempoRateAfterBpmStep(0, 1.1, 1, .001), 1.1);
  assert.equal(tempoRateAfterBpmStep(142, 1.1, 1, NaN), 1.1);
  assert.equal(tempoRateAfterBpmStep(142, 2, 1, .25), 2);
  assert.equal(tempoRateAfterBpmStep(142, .5, -1, .25), .5);
});

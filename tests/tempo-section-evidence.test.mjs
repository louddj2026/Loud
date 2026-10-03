import test from "node:test";
import assert from "node:assert/strict";
import { assessTempoSection, kickTempoSeed } from "../lib/tempo-section-evidence.ts";

const section = { start: 0, end: 96, bpm: 150.873 };
const kicks = (bpm, start = 0, end = 96, phase = .137) => {
  const result = [];
  for (let time = start + phase, i = 0; time < end; time += 60 / bpm, i++) {
    result.push({ time: time + Math.sin(i * 2.1) * .003, strength: .8 });
  }
  return result;
};

test("rejects a false fast section only after sustained independent kick support", () => {
  const result = assessTempoSection(section, 146.002, kicks(146));
  assert.equal(result.decision, "contradicted-by-kicks");
  assert.equal(result.referenceWins, 6);
  assert.equal(result.candidateWins, 0);
});

for (const bpm of [120, 151, 165]) {
  test(`preserves a real ${bpm} BPM section against a 146 BPM global estimate`, () => {
    const result = assessTempoSection({ ...section, bpm }, 146, kicks(bpm));
    assert.equal(result.decision, "keep");
    assert.equal(result.candidateWins, 6);
  });
}

test("a phase offset never masquerades as a tempo error", () => {
  assert.equal(assessTempoSection(section, 146, kicks(section.bpm, 0, 96, .29)).decision, "keep");
});

test("silence and zero-strength detections cannot veto a grid", () => {
  for (const evidence of [[], kicks(146).map(k => ({ ...k, strength: 0 }))]) {
    assert.equal(assessTempoSection(section, 146, evidence).decision, "insufficient-evidence");
  }
});

test("one fill or isolated good window cannot rewrite a whole section", () => {
  assert.notEqual(assessTempoSection(section, 146, kicks(146, 32, 48)).decision, "contradicted-by-kicks");
});

test("separated bursts across kickless gaps are not sustained evidence", () => {
  assert.notEqual(assessTempoSection(section, 146, [...kicks(146, 0, 16), ...kicks(146, 32, 48), ...kicks(146, 64, 80)]).decision, "contradicted-by-kicks");
});

test("conflicting evidence of a genuine tempo section blocks replacement", () => {
  assert.equal(assessTempoSection(section, 146, [...kicks(146, 0, 64), ...kicks(section.bpm, 64, 96)]).decision, "keep");
});

test("half-time kicks and extra subdivisions do not count as proof of a new grid", () => {
  const half = kicks(73);
  const doubled = [...kicks(146), ...kicks(146, 0, 96, .137 + 30 / 146)].sort((a,b) => a.time-b.time);
  for (const evidence of [half, doubled]) {
    assert.notEqual(assessTempoSection(section, 146, evidence).decision, "contradicted-by-kicks");
  }
});

test("small tempo variation and ordinary constant grids are untouched", () => {
  assert.equal(assessTempoSection({ ...section, bpm: 145.8 }, 146, kicks(146)).decision, "keep");
});

test("multi-beat timing recovers precise tempo despite 5ms detector quantisation", () => {
  const times = kicks(146, 0, 300).map(k => Math.round(k.time / .005) * .005);
  assert.ok(Math.abs(kickTempoSeed(times, 146.332) - 146) < .02);
  assert.equal(kickTempoSeed(times.slice(0, 5), 146), null);
});

test("precision check rejects sustained small drift, but retains a real small change", () => {
  const long = { start: 0, end: 320, bpm: 145.758 };
  assert.equal(assessTempoSection(long, 146, kicks(146, 0, 320), true).decision, "contradicted-by-kicks");
  assert.equal(assessTempoSection(long, 146, kicks(145.758, 0, 320), true).decision, "keep");
  assert.equal(assessTempoSection({ ...long, end: 64 }, 146, kicks(146, 0, 64), true).decision, "insufficient-evidence");
});

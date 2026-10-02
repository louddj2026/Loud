import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withPlacementMetadata } from "../lib/mix-placement-policy.ts";
import { applyManualCycleGrid, withoutStoredCuePlacements } from "../lib/teaching.ts";

function fixture() {
  return {
    duration: 48, hopSeconds: .5,
    beats: Array.from({ length: 97 }, (_, index) => ({
      beat: index, time: index * .5, beatInBar: (index + 3) % 4 + 1,
      isDownbeat: index % 4 === 1, confidence: .82,
    })),
    tempoSections: [{ start: 0, end: 48, bpm: 120, confidence: .9 }],
    selected: { bpm: 120, period: .5 },
    downbeats: [{ rotation: 1, probability: .7 }],
    phrases: [{ time: .5 }], waveform: [], lowWaveform: [],
    verification: { status: "analysed" },
  };
}
function analysisOnly(value) {
  const { teaching, ...analysis } = value;
  return analysis;
}

test("saving mix-in and mix-out between beats preserves every analysis field", () => {
  const original = fixture();
  const before = structuredClone(original);
  const intro = withPlacementMetadata(original, { teaching: { preferredEntryCue: { time: 2.137 } } });
  const outro = withPlacementMetadata(intro, { teaching: { ...intro.teaching, preferredCue: { time: 35.637 } } });
  assert.deepEqual(analysisOnly(outro), original);
  assert.equal(outro.teaching.preferredEntryCue.time, 2.137);
  assert.equal(outro.teaching.preferredCue.time, 35.637);
  assert.deepEqual(original, before);
});

test("intro and outro windows with different bar phases cannot renumber each other", () => {
  const original = fixture();
  let saved = original;
  for (const [start, end, purpose] of [[.5, 16.5, "intro-loop"], [20, 36, "outro-transition"]]) {
    saved = withPlacementMetadata(saved, applyManualCycleGrid(saved, start, end, 32, 120, "saved", "end", undefined, purpose).analysis);
  }
  assert.deepEqual(analysisOnly(saved), original);
  assert.equal(saved.beats[1].beatInBar, 1);
  assert.equal(saved.beats[40].beatInBar, 4);
  assert.equal(saved.teaching.manualIntroCycle.start, .5);
  assert.equal(saved.teaching.manualOutroCycle.start, 20);
});

test("placement boundary rejects even a helper result that rewrites the entire grid", () => {
  const current = fixture();
  const candidate = { ...current, beats: [], selected: { bpm: 146 }, downbeats: [],
    tempoSections: [], verification: {}, teaching: { preferredCue: { time: 30.2 } } };
  const saved = withPlacementMetadata(current, candidate);
  assert.deepEqual(analysisOnly(saved), current);
  assert.equal(saved.teaching.preferredCue.time, 30.2);
});

test("undo restores placements without restoring obsolete analysis", () => {
  const current = { ...fixture(), analysisRevision: 2 };
  const old = { ...fixture(), analysisRevision: 1, beats: [], teaching: { preferredCue: { time: 14.1 } } };
  const restored = withPlacementMetadata(current, old);
  assert.deepEqual(analysisOnly(restored), current);
  assert.equal(restored.teaching.preferredCue.time, 14.1);
  assert.equal(withPlacementMetadata(restored, {}).teaching, undefined);
});

test("resetting placements preserves bar numbering and analysis", () => {
  const original = fixture();
  const placed = { ...original, teaching: { preferredCue: { time: 7.3 }, manualCycle: { start: 1, end: 9, beats: 16 } } };
  assert.deepEqual(analysisOnly(withoutStoredCuePlacements(placed)), original);
});

test("single and paired saves and undo use the placement-only boundary", async () => {
  const route = await readFile(new URL("../app/api/dj-library/teaching/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /applyKickCycleAnchor|applyCueGridPhase|semanticLabel: "kick-cycle-start"/);
  assert.match(route, /corrected = withPlacementMetadata\(analysis, corrected\)/);
  assert.match(route, /validated.map\(\(entry\) => prepareTeachingEdit/);
  assert.match(route, /const restored = withPlacementMetadata\(currentAnalysis, record.analysis\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyManualCycleGrid, reapplyStoredTeaching } from "../lib/teaching.ts";

function analysisFixture() {
  const hopSeconds = .25;
  const duration = 40;
  const beats = Array.from({ length: 81 }, (_, index) => ({
    beat: index,
    time: index * .5,
    isDownbeat: index % 4 === 0,
    beatInBar: index % 4 + 1,
    confidence: .94,
    isPhraseStart: index % 16 === 0,
    phraseIndex: index % 16 === 0 ? index / 16 : null,
    phraseConfidence: index % 16 === 0 ? .9 : 0,
    attackTime: index * .5 + .01,
    kickStatus: "aligned",
  }));
  const bins = Math.ceil(duration / hopSeconds) + 1;
  return {
    track: { id: "teach-test", name: "Teach Test", file: "test.wav" },
    duration,
    hopSeconds,
    mode: "test",
    evidenceMode: "test",
    beats,
    phrases: [],
    waveform: Array.from({ length: bins }, () => .5),
    lowWaveform: Array.from({ length: bins }, () => .5),
    lowWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 16 < 8 ? .8 : .18),
    bassLowWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 16 < 8 ? .9 : .12),
    bassHighWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 8 < 3 ? .72 : .14),
    lowAttackWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 2 === 0 ? .8 : .1),
    kickWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 2 === 0 ? .9 : .08),
    upperAttackWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 32 === 0 ? 1 : .1),
    crashWaveformDetailed: Array.from({ length: bins }, (_, index) => index % 64 === 0 ? 1 : .04),
    tempoSections: [{ start: 0, end: duration, bpm: 120, confidence: .9 }],
    selected: { bpm: 120, probability: 1, coverage: 1, lowPulseCoverage: 1, medianResidualMs: 0, p90ResidualMs: 0, metricalRelation: "primary" },
    hypotheses: [{ bpm: 120, probability: 1, coverage: 1, lowPulseCoverage: 1, medianResidualMs: 0, p90ResidualMs: 0, metricalRelation: "primary" }],
    uncertainty: [],
    verification: { blocks: [{ start: 0, end: duration, status: "verified", evidenceCoverage: .95 }] },
  };
}

test("re-analysis preserves both taught windows and both preferred cues from the stored analysis", () => {
  const taughtIntro = applyManualCycleGrid(analysisFixture(), 2, 18.08, 32, 120, "2026-07-01T00:00:00.000Z", "end", undefined, "intro-loop").analysis;
  const taughtBoth = applyManualCycleGrid(taughtIntro, 20, 36.16, 32, 120, "2026-07-02T00:00:00.000Z", "end", "before", "outro-transition").analysis;
  const stored = {
    ...taughtBoth,
    teaching: {
      ...taughtBoth.teaching,
      preferredCue: { time: 30.137, crowdSuggestedTime: 30, nearestCrowdBeatTime: 30, cueVsCrowdMs: 137, cueVsGridMs: 137, selectedAt: "2026-07-03T00:00:00.000Z" },
      preferredEntryCue: { time: 4.137, crowdSuggestedTime: 4, nearestCrowdBeatTime: 4, cueVsCrowdMs: 137, cueVsGridMs: 137, selectedAt: "2026-07-04T00:00:00.000Z" },
    },
  };
  const restoration = reapplyStoredTeaching(analysisFixture(), stored, []);
  const teaching = restoration.analysis.teaching;
  assert.equal(teaching.manualIntroCycle.start, 2);
  assert.equal(teaching.manualIntroCycle.end, 18.08);
  assert.equal(teaching.manualIntroCycle.beats, 32);
  assert.equal(teaching.manualOutroCycle.start, 20);
  assert.equal(teaching.manualOutroCycle.end, 36.16);
  assert.equal(teaching.manualOutroCycle.beats, 32);
  assert.equal(teaching.preferredCue.time, 30.137);
  assert.equal(teaching.preferredEntryCue.time, 4.137);
  assert.equal(restoration.restoredWindows.length, 2);
  assert.equal(restoration.restoredCues, 2);
  assert.equal(restoration.failures.length, 0);
  const spanBpm = 60 / ((36.16 - 20) / 32);
  assert.ok(Math.abs(restoration.analysis.selected.bpm - spanBpm) < 1e-9, "the newest taught span stays the tempo authority");
  assert.ok(restoration.analysis.beats.some((beat) => Math.abs(beat.time - 2) < 1e-9), "the intro window start stays a literal grid beat");
  assert.ok(restoration.analysis.beats.some((beat) => Math.abs(beat.time - 18.08) < 1e-9), "the intro window end stays a literal grid beat");
  assert.ok(restoration.analysis.beats.some((beat) => Math.abs(beat.time - 20) < 1e-9), "the outro window start stays a literal grid beat");
  assert.ok(restoration.analysis.beats.some((beat) => Math.abs(beat.time - 36.16) < 1e-9), "the outro window end stays a literal grid beat");
});

test("a taught pair survives from teaching moments alone when the stored analysis file is gone", () => {
  const moments = [
    { momentId: 4, kind: "cue", role: "mix-in", trackId: "teach-test", time: 4.137, crowdSuggestedTime: 4, nearestCrowdBeatTime: 4, cueVsCrowdMs: 137, cueVsGridMs: 137, selectedAt: "2026-07-04T00:00:00.000Z" },
    { momentId: 3, kind: "cue", role: "mix-out", trackId: "teach-test", time: 30.137, crowdSuggestedTime: 30, nearestCrowdBeatTime: 30, cueVsCrowdMs: 137, cueVsGridMs: 137, selectedAt: "2026-07-03T00:00:00.000Z" },
    { momentId: 2, kind: "loop-grid", trackId: "teach-test", purpose: "outro-transition", start: 20, end: 36.16, beats: 32, bpm: 60 / ((36.16 - 20) / 32), crowdBpm: 120, selectedAt: "2026-07-02T00:00:00.000Z" },
    { momentId: 1, kind: "loop-grid", trackId: "teach-test", purpose: "intro-loop", start: 2, end: 18.08, beats: 32, bpm: 60 / ((18.08 - 2) / 32), crowdBpm: 120, selectedAt: "2026-07-01T00:00:00.000Z" },
  ];
  const restoration = reapplyStoredTeaching(analysisFixture(), null, moments);
  const teaching = restoration.analysis.teaching;
  assert.equal(teaching.manualIntroCycle.start, 2, "the older pair member must survive, not just the newest window");
  assert.equal(teaching.manualIntroCycle.end, 18.08);
  assert.equal(teaching.manualOutroCycle.start, 20);
  assert.equal(teaching.manualOutroCycle.end, 36.16);
  assert.equal(teaching.preferredCue.time, 30.137);
  assert.equal(teaching.preferredEntryCue.time, 4.137);
  assert.equal(restoration.restoredWindows.length, 2);
  assert.equal(restoration.restoredCues, 2);
});

test("a taught window the fresh grid cannot host survives verbatim as teaching evidence", () => {
  const badWindow = { start: 36, end: 39.9, beats: 32, bpm: 60 / ((39.9 - 36) / 32), crowdBpm: 120, purpose: "outro-transition", selectedAt: "2026-07-02T00:00:00.000Z" };
  const stored = { ...analysisFixture(), teaching: { manualOutroCycle: badWindow } };
  const restoration = reapplyStoredTeaching(analysisFixture(), stored, []);
  assert.equal(restoration.failures.length, 1);
  assert.deepEqual(restoration.analysis.teaching.manualOutroCycle, badWindow);
  assert.equal(restoration.analysis.selected.bpm, 120, "an unusable window must not move the automatic grid");
});

test("a track with no taught history re-analyses purely automatically", () => {
  const restoration = reapplyStoredTeaching(analysisFixture(), null, []);
  assert.equal(restoration.restoredWindows.length, 0);
  assert.equal(restoration.restoredCues, 0);
  assert.equal(restoration.failures.length, 0);
  assert.equal(restoration.analysis.teaching, undefined);
});

test("analyse-library re-reads stored teaching before overwriting an analysis", async () => {
  const source = await readFile(new URL("../scripts/analyse-library.mjs", import.meta.url), "utf8");
  assert.match(source, /const storedAnalysis = await readFile\(path\.join\(analysisDirectory, `\$\{track\.id\}\.json`\), "utf8"\)\.then\(JSON\.parse\)\.catch\(\(\) => null\);/);
  assert.match(source, /reapplyStoredTeaching\(automaticAnalysis, storedAnalysis, await readTeachingMoments\(track\.id, 64\)\)/);
  assert.ok(
    source.indexOf("reapplyStoredTeaching(automaticAnalysis") < source.indexOf("rememberCompactDjRecord(track, result"),
    "teaching must be restored before the compact DJ record is written",
  );
});

test("a forced remap never deletes the stored grid analysis before the analyser can re-read it", async () => {
  const source = await readFile(new URL("../app/api/map/route.ts", import.meta.url), "utf8");
  const mapping = source.match(/async function runMapping[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(mapping, "runMapping must exist");
  assert.match(mapping, /await rm\(modelOutput, \{ force: true \}\);/, "stale model output is still cleared up front");
  assert.doesNotMatch(mapping.split("try {")[0], /rm\(gridOutput/, "the stored grid analysis must survive until the analyser overwrites it");
});

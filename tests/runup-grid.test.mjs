import assert from "node:assert/strict";
import test from "node:test";
import { runupGridDiagnostics } from "../lib/runup-grid.ts";

test("run-up grid diagnostics compare a confirmed cycle with Crowd's existing grid", () => {
  const diagnostics = runupGridDiagnostics({
    start: 10.05,
    end: 42.05,
    beats: 64,
    crowdBpm: 118,
    grid: Array.from({ length: 80 }, (_, index) => ({
      time: 10 + index * .5,
      isDownbeat: index % 4 === 0,
      kickStatus: index % 2 === 0 ? "aligned" : "inferred",
    })),
    verification: [{ start: 10, end: 30, status: "verified", evidenceCoverage: .9 }, { start: 30, end: 45, status: "review", evidenceCoverage: .4 }],
    hypotheses: [{ bpm: 120, probability: .7 }, { bpm: 60, probability: .2 }, { bpm: 120.004, probability: .1 }],
  });
  assert.ok(Math.abs(diagnostics.manualBpm - 120) < 1e-12);
  assert.ok(Math.abs(diagnostics.beatDurationMs - 500) < 1e-12);
  assert.equal(diagnostics.startOffsetMs, 50);
  assert.equal(diagnostics.endOffsetMs, 50);
  assert.equal(diagnostics.verificationStatus, "review");
  assert.equal(diagnostics.mappedBeatsInWindow, 64);
  assert.equal(diagnostics.mappedDownbeatsInWindow, 16);
  assert.equal(diagnostics.alignedKicksInWindow, 32);
  assert.equal(diagnostics.hypotheses.length, 2);
  assert.ok(diagnostics.bpmCorrectionPercent > 1.6 && diagnostics.bpmCorrectionPercent < 1.7);
});

test("run-up grid diagnostics remain usable before a tune has a trusted grid", () => {
  const diagnostics = runupGridDiagnostics({ start: 5, end: 65, beats: 128, crowdBpm: 0, grid: [] });
  assert.equal(diagnostics.manualBpm, 128);
  assert.equal(diagnostics.startOffsetMs, null);
  assert.equal(diagnostics.endOffsetMs, null);
  assert.equal(diagnostics.verificationStatus, "unavailable");
  assert.equal(diagnostics.bpmCorrectionPercent, 0);
});

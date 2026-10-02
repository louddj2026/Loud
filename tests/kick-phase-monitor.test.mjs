import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyKickPhaseMonitor,
  kickPhaseReportLabel,
  observeKickAgainstKick,
  updateKickPhaseMonitor,
} from "../lib/kick-phase-monitor.ts";

function clock(offsetSeconds = 0, currentTime = .9) {
  return {
    currentTime,
    playbackRate: 1,
    beats: Array.from({ length: 24 }, (_, beat) => ({
      beat,
      time: beat * .4 + offsetSeconds,
      attackTime: beat * .4 + offsetSeconds,
      confidence: .9,
      isDownbeat: beat % 4 === 0,
      kickStatus: "aligned",
    })),
  };
}

test("kick-against-kick compares audible attacks rather than grid fractions", () => {
  const observation = observeKickAgainstKick(clock(0), clock(.032));
  assert.ok(observation);
  assert.ok(Math.abs(observation.offsetMs - 32) < .001);
});

test("kick-against-kick reports whether the incoming attack is early or late", () => {
  const early = observeKickAgainstKick(clock(0), clock(-.027));
  assert.ok(early);
  assert.ok(early.offsetMs < 0);
  let monitor = emptyKickPhaseMonitor();
  const first = updateKickPhaseMonitor(monitor, early);
  monitor = first.state;
  const second = updateKickPhaseMonitor(monitor, { ...early, pairKey: "next", outgoingBeat: early.outgoingBeat + 4, incomingBeat: early.incomingBeat + 4 });
  assert.equal(second.report.status, "incoming-early");
  assert.match(kickPhaseReportLabel(second.report), /27 MS EARLY/);
});

test("kick-against-kick learns sustained drift across several attacks", () => {
  let monitor = emptyKickPhaseMonitor();
  for (let index = 0; index < 5; index += 1) {
    const result = updateKickPhaseMonitor(monitor, {
      pairKey: `${index}`,
      outgoingBeat: index * 4,
      incomingBeat: index * 4,
      outgoingAttackTime: index * 1.6,
      incomingAttackTime: index * 1.6 + (.006 + index * .008),
      offsetMs: 6 + index * 8,
      confidence: .92,
    });
    monitor = result.state;
  }
  const report = updateKickPhaseMonitor(monitor, null).report;
  assert.equal(report.status, "drifting");
  assert.ok((report.driftMsPer16Beats ?? 0) > 18);
  assert.match(kickPhaseReportLabel(report), /MS \/ 16 BEATS/);
});

test("ambiguous or inferred attacks are not treated as audible kick evidence", () => {
  const ambiguous = clock(0);
  ambiguous.beats = ambiguous.beats.map((beat) => ({ ...beat, kickStatus: "ambiguous" }));
  assert.equal(observeKickAgainstKick(ambiguous, clock(0)), null);
});

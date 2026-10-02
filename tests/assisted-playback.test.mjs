import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTED_CONTINUOUS_GRID_CORRECTION, ASSISTED_ENDPOINT_GRID_SNAP, ASSISTED_GRID_GREEN_TOLERANCE_SECONDS, ASSISTED_OVERLAP_BEAT_OPTIONS, ASSISTED_OVERLAP_START_GAIN, ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS, ASSISTED_SILENT_GRID_NUDGE_LIMIT, ASSISTED_SILENT_PREROLL_BEATS, DEFAULT_ASSISTED_OVERLAP_AUTOMATION, addAssistedGainCalibration, assistedAutomationAtBeat, assistedBassSwitchWindow, assistedCuePrerollStart, assistedDeckForOrder, assistedFixedGainDecision, assistedLoadedDeckForOrder, assistedLogicalTrackOrder, assistedNextDeck, assistedOutgoingMidHighEq, assistedOverlapMix, assistedPlannedTrackIsReleased, assistedPreviousDeck, assistedRunwayPreviewStart, assistedSilentGridNudgeRate, averagedAssistedGainCalibration, buildAssistedPlaybackPlan, buildAssistedPlaybackSequence, canStartLoadedAssistedSet, emptyAssistedGainCalibration, extendAssistedPlaybackSequence, normaliseAssistedOverlapAutomation, playbackContinuationStage, replaceAssistedTransition, resizeAssistedOverlapAutomation } from "../lib/assisted-playback.ts";
import { bpmMatchedTempoRate, cueLockedTempoRate, sourceTimeAlignedToCue } from "../lib/demo-set.ts";

function window(start, end, beats) {
  return { start, end, beats, bpm: 60, crowdBpm: 60, crowdNearestStart: start, crowdNearestEnd: end, startVsGridMs: 0, endVsGridMs: 0, bpmDelta: 0, selectedAt: "now" };
}

function analysis(id, name, introWindow, outroWindow) {
  return {
    duration: 140,
    hopSeconds: .01,
    track: { id, name },
    beats: Array.from({ length: 140 }, (_, index) => ({ beat: index, time: index + .25, isDownbeat: index % 4 === 0, confidence: 1 })),
    lowWaveformDetailed: [],
    tempoSections: [{ start: 0, end: 140, bpm: 60 }],
    teaching: {
      ...(introWindow ? { manualIntroCycle: window(...introWindow) } : {}),
      ...(outroWindow ? { manualOutroCycle: window(...outroWindow) } : {}),
    },
  };
}

test("assisted playback makes both manually selected run-up windows end together", () => {
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [80.25, 96.25, 32]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [48.25, 56.25, 16], [110.25, 126.25, 32]) },
  );
  const [outgoing, incoming] = plan.tracks;
  assert.equal(outgoing.exitRunway, 80.25);
  assert.equal(outgoing.exitHandoff, 96.25);
  assert.equal(incoming.entryRunway, 48.25);
  assert.equal(incoming.entryDrop, 56.25);
  assert.equal(outgoing.mixOut, outgoing.exitHandoff);
  assert.equal(plan.blendBeats, 0);
  const rate = cueLockedTempoRate(outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop);
  assert.equal(sourceTimeAlignedToCue(outgoing.exitHandoff, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop), incoming.entryDrop);
  assert.equal((incoming.entryDrop - incoming.entryRunway) / rate, outgoing.exitHandoff - outgoing.exitRunway);
});

test("manual assisted playback pauses continuous correction and endpoint snapping", () => {
  assert.equal(ASSISTED_CONTINUOUS_GRID_CORRECTION, false);
  assert.equal(ASSISTED_ENDPOINT_GRID_SNAP, false);
});

test("assisted playback matches the incoming BPM with one exact ratio", () => {
  const rate = bpmMatchedTempoRate(143, 144);
  assert.equal(rate, 143 / 144);
  assert.ok(Math.abs((rate - 1) * 100 - (-.6944444444444444)) < 1e-12);
  assert.equal(144 * rate, 143);
});

test("manually assisted tunes rotate A, B, C, then repeat", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, order) => assistedDeckForOrder(order)), ["A", "B", "C", "A", "B", "C", "A", "B"]);
  assert.equal(assistedNextDeck("A"), "B");
  assert.equal(assistedNextDeck("B"), "C");
  assert.equal(assistedNextDeck("C"), "A");
  assert.equal(assistedPreviousDeck("A"), "C");
  assert.equal(assistedPreviousDeck("B"), "A");
  assert.equal(assistedPreviousDeck("C"), "B");
});

test("pair-local runtime indices keep their logical order when arming mid-rotation", () => {
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => assistedLogicalTrackOrder(index, 0)), [0, 1, 2, 3]);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => assistedLogicalTrackOrder(index, 1)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => assistedLogicalTrackOrder(index, 2)), [2, 3, 4, 5]);
});

test("manually loaded tunes are adopted in the same A, B, C rotation", () => {
  const loaded = { A: { id: "a" }, B: { id: "b" }, C: { id: "c" } };
  assert.equal(canStartLoadedAssistedSet(loaded), true);
  assert.deepEqual(Array.from({ length: 5 }, (_, order) => assistedLoadedDeckForOrder(order, loaded)), ["A", "B", "C", "A", "B"]);
  assert.equal(assistedLoadedDeckForOrder(1, { A: loaded.A }), null);
  assert.equal(canStartLoadedAssistedSet({ B: loaded.B }), false);
});

test("assisted playback refuses to launch without both relevant manual run-up windows", () => {
  const outgoing = { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [80.25, 96.25, 32]) };
  const incoming = { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", null, [110.25, 126.25, 32]) };
  assert.throws(() => buildAssistedPlaybackPlan(outgoing, incoming), /manually selected incoming run-up window/);
});

test("the incoming tune's later Mix Out does not gate the current transition", () => {
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [80.25, 96.25, 32]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [48.25, 56.25, 16], null) },
  );
  assert.equal(plan.tracks[0].exitRunway, 80.25);
  assert.equal(plan.tracks[1].entryRunway, 48.25);
  assert.equal(plan.tracks[1].cuePoints.some((cue) => cue.id === "exit-runway"), false);
  assert.equal(plan.tracks[1].exitRunway, 140);
});

test("three prepared tunes become one A to B to C sequence with both saved mixes", () => {
  const plan = buildAssistedPlaybackSequence([
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [80.25, 96.25, 32]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [48.25, 56.25, 16], [110.25, 126.25, 32]) },
    { id: "three", name: "Tune Three", deck: "C", analysis: analysis("three", "Tune Three", [20.25, 28.25, 16], null) },
  ]);

  assert.deepEqual(plan.tracks.map((track) => track.deck), ["A", "B", "C"]);
  assert.equal(plan.tracks[0].entryRunway, 0);
  assert.equal(plan.tracks[0].exitRunway, 80.25);
  assert.equal(plan.tracks[1].entryRunway, 48.25);
  assert.equal(plan.tracks[1].entryDrop, 56.25);
  assert.equal(plan.tracks[1].exitRunway, 110.25);
  assert.equal(plan.tracks[1].exitHandoff, 126.25);
  assert.deepEqual(plan.tracks[1].cuePoints.map((cue) => cue.id), [
    "entry-runway",
    "entry-drop",
    "exit-runway",
    "exit-handoff",
  ]);
  assert.equal(plan.tracks[2].entryRunway, 20.25);
  assert.equal(plan.settleBeats, 0);
});

test("a three-tune sequence refuses a middle tune whose second mix starts before its first mix ends", () => {
  assert.throws(() => buildAssistedPlaybackSequence([
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [54.25, 96.25, 64]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [48.25, 90.25, 64], [80.25, 96.25, 32]) },
    { id: "three", name: "Tune Three", deck: "C", analysis: analysis("three", "Tune Three", [20.25, 28.25, 16], null) },
  ]), /Mix Out must start after its Mix In ends/);
});

test("each transition in a three-tune sequence keeps its own automation length", () => {
  const longAnalysis = (id, name, introWindow, outroWindow) => {
    const value = analysis(id, name, introWindow, outroWindow);
    value.duration = 400;
    value.beats = Array.from({ length: 400 }, (_, index) => ({ beat: index, time: index + .25, isDownbeat: index % 4 === 0, confidence: 1 }));
    return value;
  };
  const firstAutomation = resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, 64);
  const secondAutomation = resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, 96);
  const plan = buildAssistedPlaybackSequence([
    { id: "one", name: "Tune One", deck: "A", analysis: longAnalysis("one", "Tune One", null, [200.25, 264.25, 64]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: longAnalysis("two", "Tune Two", [40.25, 104.25, 64], [272.25, 336.25, 64]) },
    { id: "three", name: "Tune Three", deck: "C", analysis: longAnalysis("three", "Tune Three", [152.25, 216.25, 64], null) },
  ], [firstAutomation, secondAutomation]);

  assert.equal(plan.tracks[0].exitRunway, 200.25);
  assert.equal(plan.tracks[1].entryRunway, 40.25);
  assert.equal(plan.tracks[1].exitRunway, 272.25);
  assert.equal(plan.tracks[2].entryRunway, 152.25);
});

test("continuous assisted sequences never enter the demo skip stage between mixes", () => {
  assert.equal(playbackContinuationStage(1, 3, true), "primary");
  assert.equal(playbackContinuationStage(1, 3, false), "settle");
  assert.equal(playbackContinuationStage(2, 3, true), "complete");
});

test("a private preview can replace one live transition without changing the following mix", () => {
  const initial = buildAssistedPlaybackSequence([
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [40.25, 104.25, 64]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [8.25, 72.25, 64], [75.25, 139.25, 64]) },
    { id: "three", name: "Tune Three", deck: "C", analysis: analysis("three", "Tune Three", [10.25, 74.25, 64], null) },
  ]);
  const replacement = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [35.25, 99.25, 64]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [5.25, 69.25, 64], [75.25, 139.25, 64]) },
  );
  const updated = replaceAssistedTransition(initial, 0, replacement);
  assert.equal(updated.tracks[0].exitHandoff, 99.25);
  assert.equal(updated.tracks[1].entryDrop, 69.25);
  assert.equal(updated.tracks[1].exitHandoff, initial.tracks[1].exitHandoff);
  assert.equal(updated.tracks[2].entryDrop, initial.tracks[2].entryDrop);
});

test("a live A to B to C sequence extends through C to a replacement Tune A", () => {
  const initial = buildAssistedPlaybackSequence([
    { id: "old-a", name: "Old A", deck: "A", analysis: analysis("old-a", "Old A", null, [80.25, 96.25, 32]) },
    { id: "old-b", name: "Old B", deck: "B", analysis: analysis("old-b", "Old B", [20.25, 36.25, 32], [90.25, 106.25, 32]) },
    { id: "old-c", name: "Old C", deck: "C", analysis: analysis("old-c", "Old C", [30.25, 46.25, 32], [100.25, 116.25, 32]) },
  ]);
  const automation = resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, 64);
  const extended = extendAssistedPlaybackSequence(
    initial,
    { id: "old-c", name: "Old C", deck: "C", analysis: analysis("old-c", "Old C", [30.25, 46.25, 32], [100.25, 116.25, 32]) },
    { id: "new-a", name: "New A", deck: "A", analysis: analysis("new-a", "New A", [50.25, 66.25, 32], [120.25, 136.25, 32]) },
    automation,
  );

  assert.deepEqual(extended.tracks.map((track) => `${track.deck}:${track.id}`), [
    "A:old-a",
    "B:old-b",
    "C:old-c",
    "A:new-a",
  ]);
  assert.equal(extended.tracks[2].entryRunway, 30.25);
  assert.equal(extended.tracks[2].entryDrop, 46.25);
  assert.equal(extended.tracks[2].exitRunway, 100.25);
  assert.equal(extended.tracks[2].exitHandoff, 116.25);
  assert.equal(extended.tracks[3].entryRunway, 50.25);
  assert.equal(extended.tracks[3].entryDrop, 66.25);
  assert.equal(extended.settleBeats, 0);
});

test("only a track behind the live transition is safe to recycle", () => {
  const tracks = [
    { id: "old-a", deck: "A" },
    { id: "old-b", deck: "B" },
    { id: "old-c", deck: "C" },
    { id: "new-a", deck: "A" },
  ];
  assert.equal(assistedPlannedTrackIsReleased(tracks, 0, "A", "old-a"), false);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 1, "A", "old-a"), true);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 2, "B", "old-b"), true);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 2, "C", "old-c"), false);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 2, "A", "new-a"), false);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 3, "C", "old-c"), true);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 3, "A", "new-a"), false);
  assert.equal(assistedPlannedTrackIsReleased(tracks, 3, "B", "not-planned"), false);
});

test("assisted overlap matches channel volume and raises mids and highs from 76 to 100 percent", () => {
  const opening = assistedOverlapMix(0, .72);
  const middle = assistedOverlapMix(.5, .72);
  const endpoint = assistedOverlapMix(1, .72);
  assert.equal(opening.volume, .72);
  assert.equal(opening.low, -60);
  assert.equal(opening.midHighGain, ASSISTED_OVERLAP_START_GAIN);
  assert.equal(opening.mid, 20 * Math.log10(.76));
  assert.equal(opening.high, opening.mid);
  assert.equal(middle.midHighGain, .88);
  assert.equal(endpoint.midHighGain, 1);
  assert.equal(endpoint.mid, 0);
  assert.equal(endpoint.high, 0);
});

test("outgoing mids and highs ease down by 35 percent across the overlap", () => {
  const opening = assistedOutgoingMidHighEq(0);
  const middle = assistedOutgoingMidHighEq(.5);
  const endpoint = assistedOutgoingMidHighEq(1);
  assert.equal(opening.midHighGain, 1);
  assert.equal(middle.midHighGain, .825);
  assert.equal(endpoint.midHighGain, .65);
  assert.equal(endpoint.mid, 20 * Math.log10(.65));
  assert.equal(endpoint.high, endpoint.mid);
});

test("fixed gain decision gives a quieter, duller incoming master bounded extra oomph", () => {
  const decision = assistedFixedGainDecision(.8,
    { rms: .22, peak: .8, bassRatio: .24, brightness: .32 },
    { rms: .13, peak: .7, bassRatio: .16, brightness: .16 });
  assert.ok(decision.volume > .8);
  assert.ok(decision.volume <= 1);
  assert.ok(decision.highDb > 0);
  assert.ok(decision.lowDb > 0);
  assert.ok(decision.levelDb <= 3);
  assert.deepEqual(decision, assistedFixedGainDecision(.8,
    { rms: .22, peak: .8, bassRatio: .24, brightness: .32 },
    { rms: .13, peak: .7, bassRatio: .16, brightness: .16 }));
});

test("fixed gain decision restrains a hotter, brighter incoming master", () => {
  const balance = assistedFixedGainDecision(.85,
    { rms: .14, peak: .7, bassRatio: .2, brightness: .16 },
    { rms: .25, peak: .92, bassRatio: .22, brightness: .4 });
  assert.ok(balance.volume < .85);
  assert.ok(balance.highDb < 0);
  assert.ok(balance.levelDb >= -3);
});

test("gain calibration averages a short pre-fader sample before one decision", () => {
  let calibration = emptyAssistedGainCalibration();
  calibration = addAssistedGainCalibration(calibration,
    { rms: .2, peak: .7, bassRatio: .2, brightness: .3 },
    { rms: .1, peak: .5, bassRatio: .1, brightness: .2 });
  calibration = addAssistedGainCalibration(calibration,
    { rms: .4, peak: .9, bassRatio: .4, brightness: .5 },
    { rms: .2, peak: .6, bassRatio: .3, brightness: .4 });
  calibration = addAssistedGainCalibration(calibration,
    { rms: 0, peak: 0, bassRatio: 0, brightness: 0 },
    { rms: .2, peak: .6, bassRatio: .3, brightness: .4 });
  const average = averagedAssistedGainCalibration(calibration);
  assert.equal(calibration.samples, 2);
  assert.ok(Math.abs(average.outgoing.rms - Math.sqrt(.1)) < 1e-12);
  assert.ok(Math.abs(average.incoming.rms - Math.sqrt(.025)) < 1e-12);
  assert.equal(average.outgoing.peak, .9);
  assert.equal(average.incoming.peak, .6);
  assert.ok(Math.abs(average.outgoing.bassRatio - .3) < 1e-12);
  assert.ok(Math.abs(average.incoming.brightness - .3) < 1e-12);
});

test("all assisted beat-length choices preserve the selectable bass cue and sweep EQ through the beat before it", () => {
  assert.deepEqual(ASSISTED_OVERLAP_BEAT_OPTIONS, [64, 96, 128, 160, 192, 224, 256]);
  for (const beats of ASSISTED_OVERLAP_BEAT_OPTIONS) {
    const resized = resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, beats);
    assert.equal(resized.windowBeats, beats);
    assert.equal(resized.bassSwapBeat, beats / 2);
    assert.deepEqual(resized.points.map((point) => point.beat), [0, beats / 2, beats]);
    assert.deepEqual(assistedBassSwitchWindow(resized.bassSwapBeat), {
      startBeat: beats / 2 - .75,
      centreBeat: beats / 2 - .5,
      endBeat: beats / 2 - .25,
      cueBeat: beats / 2,
    });
  }
  const wide = resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, 256);
  const back = resizeAssistedOverlapAutomation(wide, 128);
  assert.deepEqual(back.points.map((point) => point.beat), [0, 64, 128]);
  assert.equal(back.bassSwapBeat, 64);
  assert.equal(normaliseAssistedOverlapAutomation({ ...back, bassSwapBeat: 127.5 }).bassSwapBeat, 64);
});

test("custom overlap automation uses the selected cue and an equal-power low-EQ sweep through the beat before it", () => {
  const automation = normaliseAssistedOverlapAutomation({
    windowBeats: 128,
    bassSwapBeat: 72,
    points: [
      { beat: 0, incomingPercent: 60, outgoingPercent: 100 },
      { beat: 64, incomingPercent: 90, outgoingPercent: 75 },
      { beat: 128, incomingPercent: 110, outgoingPercent: 40 },
    ],
  });
  assert.deepEqual(automation.points.map((point) => point.beat), [0, 72, 128]);
  assert.equal(automation.bassSwapBeat, 72);
  const before = assistedAutomationAtBeat(automation, 32);
  const atStart = assistedAutomationAtBeat(automation, 71.25);
  const atCentre = assistedAutomationAtBeat(automation, 71.5);
  const atEnd = assistedAutomationAtBeat(automation, 71.75);
  const atCue = assistedAutomationAtBeat(automation, 72);
  assert.ok(Math.abs(before.incomingPercent - 73.33333333333333) < 1e-9);
  assert.ok(Math.abs(before.outgoingPercent - 88.88888888888889) < 1e-9);
  assert.equal(before.incomingLow, -60);
  assert.equal(before.outgoingLow, 0);
  assert.equal(atStart.incomingLow, -60);
  assert.equal(atStart.outgoingLow, 0);
  assert.ok(Math.abs(atCentre.incomingLow - (-3.010299956639812)) < 1e-12);
  assert.ok(Math.abs(atCentre.outgoingLow - (-3.0102999566398116)) < 1e-12);
  assert.equal(atEnd.incomingLow, 0);
  assert.equal(atEnd.outgoingLow, -60);
  assert.equal(atCue.incomingLow, 0);
  assert.equal(atCue.outgoingLow, -60);
  assert.equal(atStart.bassSwapped, false);
  assert.equal(atEnd.bassSwapped, true);
  assert.equal(atCue.beatsUntilBassSwap, 0);
});

test("incoming assisted playback starts silently eight mapped beats before its Mix In cue", () => {
  const mapped = analysis("two", "Tune Two", [48.25, 56.25, 16], null);
  const cueIndex = mapped.beats.findIndex((beat) => beat.time === 48.25);
  const preroll = assistedCuePrerollStart(mapped, 48.25, 60);
  assert.equal(ASSISTED_SILENT_PREROLL_BEATS, 8);
  assert.equal(preroll, mapped.beats[cueIndex - ASSISTED_SILENT_PREROLL_BEATS].time);
  assert.equal(preroll, 40.25);
});

test("muted grid nudge bends phase only outside green tolerance and never changes the BPM ratio by more than 0.8 percent", () => {
  const baseRate = 143 / 144;
  assert.equal(ASSISTED_GRID_GREEN_TOLERANCE_SECONDS, .014);
  assert.equal(ASSISTED_SILENT_GRID_NUDGE_LIMIT, .008);
  assert.equal(assistedSilentGridNudgeRate(baseRate, 0), baseRate);
  assert.equal(assistedSilentGridNudgeRate(baseRate, ASSISTED_GRID_GREEN_TOLERANCE_SECONDS), baseRate);
  assert.ok(assistedSilentGridNudgeRate(baseRate, .03) < baseRate);
  assert.ok(assistedSilentGridNudgeRate(baseRate, -.03) > baseRate);
  assert.equal(assistedSilentGridNudgeRate(baseRate, 10), baseRate * (1 - ASSISTED_SILENT_GRID_NUDGE_LIMIT));
  assert.equal(assistedSilentGridNudgeRate(baseRate, -10), baseRate * (1 + ASSISTED_SILENT_GRID_NUDGE_LIMIT));
});

test("a selected 256-beat overlap never moves either exact manual window coordinate", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [80.25, 96.25, 32]);
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 56.25, 16], [110.25, 126.25, 32]);
  outgoingAnalysis.duration = 400;
  incomingAnalysis.duration = 400;
  outgoingAnalysis.beats = Array.from({ length: 400 }, (_, index) => ({ beat: index, time: index + .25, isDownbeat: index % 4 === 0, confidence: 1 }));
  incomingAnalysis.beats = Array.from({ length: 400 }, (_, index) => ({ beat: index, time: index + .25, isDownbeat: index % 4 === 0, confidence: 1 }));
  outgoingAnalysis.teaching.manualOutroCycle = window(300.25, 356.25, 64);
  incomingAnalysis.teaching.manualIntroCycle = window(240.25, 296.25, 64);
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
    resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, 256),
  );
  assert.equal(plan.runwayBeats, 256);
  assert.equal(plan.tracks[0].exitRunway, 300.25);
  assert.equal(plan.tracks[0].exitHandoff, 356.25);
  assert.equal(plan.tracks[1].entryRunway, 240.25);
  assert.equal(plan.tracks[1].entryDrop, 296.25);
});

test("runway rehearsal begins eight beats before automation takes over", () => {
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: analysis("one", "Tune One", null, [80.25, 96.25, 32]) },
    { id: "two", name: "Tune Two", deck: "B", analysis: analysis("two", "Tune Two", [48.25, 56.25, 16], [110.25, 126.25, 32]) },
  );
  const preview = assistedRunwayPreviewStart(plan.tracks[0]);
  const runwayIndex = plan.tracks[0].analysis.beats.findIndex((beat) => beat.time === plan.tracks[0].exitRunway);
  assert.equal(preview, plan.tracks[0].analysis.beats[runwayIndex - ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS].time);
  assert.ok(preview < plan.tracks[0].exitRunway);
});

test("equal-beat-count window spans outrank a half-time misdetected incoming BPM at launch", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [80.25, 102.07, 64]);
  outgoingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 176 }];
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 70.32, 64], null);
  incomingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 87 }];
  assert.ok(bpmMatchedTempoRate(176, 87) > 2);
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
  );
  assert.equal(plan.tracks[0].exitRunway, 80.25);
  assert.equal(plan.tracks[0].exitHandoff, 102.07);
  assert.equal(plan.tracks[1].entryRunway, 48.25);
  assert.equal(plan.tracks[1].entryDrop, 70.32);
  const rate = cueLockedTempoRate(80.25, 102.07, 48.25, 70.32);
  assert.ok(rate > .5 && rate < 2);
});

test("differing selected beat counts still fall back to the BPM safety gate", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [80.25, 102.07, 64]);
  outgoingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 176 }];
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 59.16, 32], null);
  incomingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 87 }];
  assert.throws(() => buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
  ), /cannot be matched safely/);
});

test("the span-locked gate still refuses an equal-beat-count launch beyond the doubling bounds", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [80.25, 90.25, 64]);
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 73.25, 64], null);
  assert.throws(() => buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
  ), /cannot be matched safely/);
});

test("a Mix Out window ending exactly at the final tempo section boundary uses that section's BPM", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [124.25, 140, 32]);
  outgoingAnalysis.tempoSections = [{ start: 0, end: 100, bpm: 140 }, { start: 100, end: 140, bpm: 174 }];
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 56.25, 16], null);
  incomingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 174 }];
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
  );
  assert.equal(plan.tracks[0].bpm, 174);
  assert.equal(plan.tracks[1].bpm, 174);
});

test("an interior tempo section boundary still belongs to the later section", () => {
  const outgoingAnalysis = analysis("one", "Tune One", null, [84.25, 100, 32]);
  outgoingAnalysis.tempoSections = [{ start: 0, end: 100, bpm: 140 }, { start: 100, end: 140, bpm: 174 }];
  const incomingAnalysis = analysis("two", "Tune Two", [48.25, 56.25, 16], null);
  incomingAnalysis.tempoSections = [{ start: 0, end: 140, bpm: 174 }];
  const plan = buildAssistedPlaybackPlan(
    { id: "one", name: "Tune One", deck: "A", analysis: outgoingAnalysis },
    { id: "two", name: "Tune Two", deck: "B", analysis: incomingAnalysis },
  );
  assert.equal(plan.tracks[0].bpm, 174);
});

test("resizing an overlap never collides the scaled bass cue with the legacy migration marker", () => {
  for (const [fromBeats, toBeats] of [[128, 64], [192, 96], [256, 128], [256, 64]]) {
    const resized = resizeAssistedOverlapAutomation(
      normaliseAssistedOverlapAutomation({ windowBeats: fromBeats, bassSwapBeat: fromBeats - 1 }),
      toBeats,
    );
    assert.equal(resized.bassSwapBeat, toBeats);
    assert.equal(resized.points[1].beat, toBeats);
  }
  const control = resizeAssistedOverlapAutomation(
    normaliseAssistedOverlapAutomation({ windowBeats: 128, bassSwapBeat: 120 }),
    64,
  );
  assert.equal(control.bassSwapBeat, 60);
});

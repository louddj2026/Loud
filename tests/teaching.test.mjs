import assert from "node:assert/strict";
import test from "node:test";
import { applyCueGridPhase, applyKickCycleAnchor, applyManualCycleGrid, cueFeatureVector, cuePatternSimilarity, cueTeachingComparison, kickCycleTeachingEvidence, kickFingerprintSimilarity, latestAuthoritativeManualTempo, learnedCueCandidates, manualTempoEvidenceWeight, manualWindowPurposeAt, resolvedBpmAt, teachingProfile, tempoRateAfterManualTempoTeaching, withoutStoredCuePlacements, withRestoredManualWindows } from "../lib/teaching.ts";

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

test("a taught cue remains exact between Crowd grid beats", () => {
  const analysis = analysisFixture();
  const comparison = cueTeachingComparison(analysis, 10.137, 12, "2026-07-22T00:00:00.000Z");
  assert.equal(comparison.time, 10.137);
  assert.equal(comparison.nearestCrowdBeatTime, 10);
  assert.equal(comparison.cueVsGridMs, 137);
  assert.equal(comparison.cueVsCrowdMs, -1863);
});

test("an exact taught cue repositions grid phase without changing BPM", () => {
  const analysis = analysisFixture();
  const cue = 10.137;
  const { analysis: corrected, shiftMs } = applyCueGridPhase(analysis, cue);
  const nearest = corrected.beats.reduce((best, beat) => Math.abs(beat.time - cue) < Math.abs(best.time - cue) ? beat : best);
  assert.equal(shiftMs, 137);
  assert.ok(Math.abs(nearest.time - cue) < 1e-9);
  assert.equal(corrected.beats[0].time, analysis.beats[0].time, "a cue anchor must not discard the distant grid");
  assert.equal(corrected.beats.at(-1).time, analysis.beats.at(-1).time, "a cue anchor must stay local");
  assert.equal(corrected.tempoSections[0].bpm, 120);
  assert.equal(corrected.selected.bpm, 120);
});

test("cue learning compares cycle, frequency and grid patterns with Crowd's own choices", () => {
  const analysis = analysisFixture();
  const firstUser = cueFeatureVector(analysis, 8.137);
  const secondUser = cueFeatureVector(analysis, 16.137);
  const firstCrowd = cueFeatureVector(analysis, 10);
  const secondCrowd = cueFeatureVector(analysis, 18);
  const moments = [
    { kind: "cue", trackId: "one", ...cueTeachingComparison(analysis, 8.137, 10), userFeatures: firstUser, crowdFeatures: firstCrowd },
    { kind: "cue", trackId: "two", ...cueTeachingComparison(analysis, 16.137, 18), userFeatures: secondUser, crowdFeatures: secondCrowd },
  ];
  const profile = teachingProfile(moments);
  assert.equal(profile.cueMoments, 2);
  assert.equal(profile.mixInCueMoments, 0);
  assert.equal(profile.mixOutCueMoments, 2);
  assert.equal(profile.cuePattern.samples, 2);
  assert.equal(profile.crowdCuePattern.samples, 2);
  assert.equal(profile.cuePattern.lowPattern.length, 16);
  assert.notEqual(profile.cuePattern.beatPhase, profile.crowdCuePattern.beatPhase);
  assert.ok(cuePatternSimilarity(firstUser, profile.cuePattern) > 0.7);
});

test("cue features preserve the multiband kick shape and its position in the overall visual wave", () => {
  const features = cueFeatureVector(analysisFixture(), 16.01);
  assert.equal(features.bassLowShape.length, 24);
  assert.equal(features.bassHighShape.length, 24);
  assert.equal(features.kickShape.length, 24);
  assert.equal(features.upperAttackShape.length, 24);
  assert.equal(features.overallLowContext.length, 32);
  assert.ok(features.bassLowAtCue > 0);
  assert.ok(features.bassHighAtCue > 0);
  assert.ok(features.lowAttackAtCue > 0);
  assert.ok(Math.abs(features.trackPosition - 16.01 / 40) < 1e-9);
});

test("stored cue timestamps are training memory only and are removed before a tune loads", () => {
  const analysis = {
    ...analysisFixture(),
    teaching: {
      preferredCue: { time: 30 },
      preferredEntryCue: { time: 4 },
      manualCycle: { start: 1, end: 2 },
      manualIntroCycle: { start: 3, end: 4 },
      manualOutroCycle: { start: 28, end: 32 },
      predictedCue: { time: 29 },
      predictedEntryCue: { time: 5 },
    },
  };
  const fresh = withoutStoredCuePlacements(analysis);
  assert.deepEqual(fresh.teaching, {});
  assert.equal(fresh.beats[20].time, analysis.beats[20].time);
  assert.equal(fresh.lowWaveformDetailed, analysis.lowWaveformDetailed);
});

test("only an explicitly restored assisted session gets its saved manual windows back", () => {
  const stored = applyManualCycleGrid(analysisFixture(), 4, 20, 32, 120, "saved", "end", "after", "outro-transition").analysis;
  const fresh = withoutStoredCuePlacements(stored);
  assert.equal(fresh.teaching.manualOutroCycle, undefined);
  const restored = withRestoredManualWindows(fresh, stored);
  assert.deepEqual(restored.teaching.manualOutroCycle, stored.teaching.manualOutroCycle);
  assert.equal(restored.teaching.preferredCue, undefined);
});

test("a selected kick becomes the cycle origin and confirms matching downbeats", () => {
  const analysis = analysisFixture();
  const selectedTime = 10.01;
  const anchored = applyKickCycleAnchor(analysis, selectedTime);
  const selectedBeat = anchored.analysis.beats[anchored.anchorIndex];
  assert.ok(Math.abs(selectedBeat.time - selectedTime) < 1e-9);
  assert.equal(selectedBeat.beatInBar, 1);
  assert.equal(selectedBeat.isDownbeat, true);
  assert.equal(selectedBeat.isPhraseStart, true);
  assert.equal(selectedBeat.kickCycleConfirmed, true);
  assert.equal(selectedBeat.kickCycleSimilarity, 1);
  assert.equal(selectedBeat.confidence, 1);
  assert.equal(anchored.analysis.beats[anchored.anchorIndex + 1].beatInBar, 2);
  assert.ok(anchored.confirmedCycleStarts > 1, "the labelled kick should identify repeated cycle starts across the tune");
  assert.equal(anchored.matchingKickTimes.length, anchored.confirmedCycleStarts);
  assert.ok(kickFingerprintSimilarity(anchored.anchorFeatures, { ...anchored.anchorFeatures, samples: 1 }) > .99);
});

test("a marked mix-in stores multi-scale cycle evidence without inventing manual tempo evidence", () => {
  const analysis = analysisFixture();
  const selectedTime = 8.01;
  const anchored = applyKickCycleAnchor(analysis, selectedTime);
  const features = cueFeatureVector(anchored.analysis, selectedTime, { includeCycleRepeats: true });
  const evidence = kickCycleTeachingEvidence(anchored.analysis, anchored.anchorIndex, features);
  assert.equal(features.cycleRepeatCoverage.length, 5);
  assert.equal(features.cycleRepeatPattern.length, 5);
  assert.ok(features.cycleRepeatPattern.every((similarity) => similarity > .7));
  assert.equal(evidence.originTime, selectedTime);
  assert.ok(evidence.testedCycleStarts > 1);
  assert.ok(evidence.confirmedCycleStarts > 1);
  assert.ok(evidence.confirmationRatio > .5);
  assert.deepEqual(evidence.repeats.map((repeat) => repeat.beats), [4, 8, 16, 32, 64]);
  assert.ok(evidence.confirmedBeatOffsets.includes(0));

  const moment = {
    kind: "cue",
    role: "mix-in",
    semanticLabel: "kick-cycle-start",
    trackId: "one",
    ...cueTeachingComparison(analysis, selectedTime, 10),
    userFeatures: features,
    crowdFeatures: cueFeatureVector(analysis, 10),
    cycleEvidence: evidence,
  };
  const profile = teachingProfile([moment]);
  assert.equal(profile.inferredCycleMoments, 1);
  assert.equal(profile.cycleMoments, 0, "a one-point cue must not masquerade as a manually counted tempo window");
  assert.equal(profile.cycleRepeatPattern.length, 5);
  assert.equal(profile.cycleRepeatPattern[0].samples, 1);
});

test("fresh cue predictions come from cross-track kick and waveform examples", () => {
  const source = analysisFixture();
  const moments = [8.01, 16.01].map((time, index) => {
    const anchored = applyKickCycleAnchor(source, time);
    const userFeatures = cueFeatureVector(anchored.analysis, time, { includeCycleRepeats: true });
    return {
      kind: "cue",
      role: "mix-in",
      semanticLabel: "kick-cycle-start",
      trackId: index ? "two" : "one",
      ...cueTeachingComparison(source, time, time + 2),
      userFeatures,
      crowdFeatures: cueFeatureVector(source, time + 2),
      cycleEvidence: kickCycleTeachingEvidence(anchored.analysis, anchored.anchorIndex, userFeatures),
    };
  });
  const profile = teachingProfile(moments);
  const target = { ...analysisFixture(), track: { id: "new-track", name: "New Track", file: "new.wav" } };
  const candidates = learnedCueCandidates(target, profile, "mix-in", 2);
  assert.equal(profile.kickCyclePattern.samples, 2);
  assert.equal(profile.entryCuePattern.samples, 2);
  assert.equal(profile.inferredCycleMoments, 2);
  assert.ok(profile.cycleRepeatPattern.some((repeat) => repeat.samples === 2 && repeat.similarity > .7));
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].samples, 2);
  assert.ok(candidates[0].kickScore > .7);
  assert.ok(candidates[0].waveformScore > .7);
  assert.ok(candidates[0].score > .48);
});

test("mix-in examples are learned separately and test bass-arrival theory", () => {
  const analysis = analysisFixture();
  const baseUser = cueFeatureVector(analysis, 8);
  const baseCrowd = cueFeatureVector(analysis, 10);
  const moments = ["one", "two", "three"].map((trackId, index) => ({
    kind: "cue",
    role: "mix-in",
    trackId,
    ...cueTeachingComparison(analysis, 8 + index * 8, 10 + index * 8),
    userFeatures: { ...baseUser, lowChange: .82 },
    crowdFeatures: { ...baseCrowd, lowChange: -.2 },
  }));
  const profile = teachingProfile(moments);
  assert.equal(profile.mixInCueMoments, 3);
  assert.equal(profile.mixOutCueMoments, 0);
  assert.equal(profile.entryCuePattern.samples, 3);
  assert.equal(profile.cuePattern, null);
  const bassArrival = profile.theories.find((theory) => theory.id === "in-bass-return");
  assert.equal(bassArrival.status, "supported");
  assert.ok(bassArrival.lift > .7);
});

test("grid corrections compare the true manual beat with Crowd's missed grid evidence", () => {
  const analysis = analysisFixture();
  const user = { ...cueFeatureVector(analysis, 8.137), kickAtCue: .92, upperAttackAtCue: .8 };
  const missed = { ...cueFeatureVector(analysis, 8), kickAtCue: .12, upperAttackAtCue: .1 };
  const moments = ["one", "two", "three"].map((trackId) => ({
    kind: "cue",
    role: "mix-in",
    trackId,
    ...cueTeachingComparison(analysis, 8.137, 8),
    userFeatures: user,
    crowdFeatures: missed,
    gridFeatures: missed,
  }));
  const profile = teachingProfile(moments);
  assert.equal(profile.gridCorrectionMoments, 3);
  assert.equal(profile.learnedGridOffsetMs, 137);
  assert.equal(profile.correctedGridPattern.samples, 3);
  assert.equal(profile.missedGridPattern.samples, 3);
  assert.equal(profile.theories.find((theory) => theory.id === "grid-kick-anchor").status, "supported");
});

test("a manual loop rebuilds BPM and grid from its exact cycle boundaries", () => {
  const analysis = analysisFixture();
  const start = 10.137;
  const end = 14.137;
  const { analysis: corrected, teaching } = applyManualCycleGrid(analysis, start, end, 8, 121, "2026-07-22T00:00:00.000Z");
  assert.equal(teaching.bpm, 120);
  assert.equal(teaching.start, start);
  assert.equal(teaching.end, end);
  assert.equal(teaching.beats, 8);
  assert.equal(corrected.tempoSections[0].bpm, 120);
  const startBeat = corrected.beats.find((beat) => Math.abs(beat.time - start) < 1e-9);
  const endBeat = corrected.beats.find((beat) => Math.abs(beat.time - end) < 1e-9);
  assert.ok(startBeat);
  assert.ok(endBeat);
  assert.equal(startBeat.isPhraseStart, true);
  assert.equal(startBeat.isDownbeat, true);
  assert.equal(endBeat.isPhraseStart, true);
  assert.equal(corrected.teaching.manualCycle.start, start);
  assert.equal(corrected.beats[0].time, analysis.beats[0].time, "the manual loop must preserve the distant grid before it");
  assert.equal(corrected.beats.at(-1).time, analysis.beats.at(-1).time, "the manual loop must preserve the distant grid after it");
});

test("a confirmed 64-beat window decisively locks tempo against metrical alternatives", () => {
  const analysis = analysisFixture();
  const { analysis: corrected, teaching } = applyManualCycleGrid(analysis, 4, 36, 64, 178.864, "2026-07-23T00:00:00.000Z");
  assert.equal(teaching.bpm, 120);
  assert.equal(teaching.tempoAuthority, "decisive");
  assert.equal(teaching.tempoEvidenceWeight, 16);
  assert.equal(corrected.selected.bpm, 120);
  assert.equal(corrected.selected.probability, 1);
  assert.equal(corrected.selected.manualTempoAuthority, "decisive");
  assert.equal(corrected.hypotheses[0].bpm, 120);
  assert.ok(corrected.hypotheses.slice(1).every((hypothesis) => hypothesis.probability <= 1 / 17));
});

test("the main deck keeps a decisive manual BPM at the selected window end", () => {
  const analysis = analysisFixture();
  analysis.tempoSections = [
    { start: 0, end: 4, bpm: 175.602, confidence: .1 },
    { start: 4, end: 30.464549, bpm: 175.602, confidence: .1 },
    { start: 30.464549, end: analysis.duration, bpm: 175.602, confidence: .1 },
  ];
  const corrected = applyManualCycleGrid(analysis, 4, 30.464549, 64, 175.602, "2026-07-23T00:00:00.000Z").analysis;
  const period = (30.464549 - 4) / 64;
  assert.ok(Math.abs(corrected.teaching.manualCycle.bpm - 145.099771) < .00001);
  assert.ok(Math.abs(resolvedBpmAt(corrected, corrected.teaching.manualCycle.end) - 145.099771) < .00001);
  assert.equal(corrected.tempoSections.length, 1);
  assert.equal(corrected.tempoSections[0].start, 0);
  assert.equal(corrected.tempoSections[0].end, analysis.duration);
  assert.ok(corrected.beats.every((beat) => beat.manualGridAuthoritative));
  assert.ok(corrected.beats[0].time >= 0 && corrected.beats[0].time < period);
  assert.ok(corrected.beats.at(-1).time <= analysis.duration && corrected.beats.at(-1).time > analysis.duration - period);
  assert.ok(corrected.beats.slice(1).every((beat, index) => Math.abs(beat.time - corrected.beats[index].time - period) < 1e-9));
  const kickAudited = applyKickCycleAnchor(corrected, corrected.teaching.manualCycle.end).analysis;
  assert.deepEqual(kickAudited.beats.map((beat) => beat.time), corrected.beats.map((beat) => beat.time), "kick evidence must not move an authoritative manual grid");
});

test("strong manual tempo teaching clears a stale playback-rate multiplier", () => {
  assert.equal(tempoRateAfterManualTempoTeaching(64, 1.109), 1);
  assert.equal(tempoRateAfterManualTempoTeaching(32, .92), 1);
  assert.equal(tempoRateAfterManualTempoTeaching(16, 1.03), 1.03);
});

test("the newest strong manual window is reused as tempo authority on remap", () => {
  const old = { kind: "loop-grid", trackId: "one", start: 0, end: 21.466, beats: 64, bpm: 178.9, crowdBpm: 178.9, crowdNearestStart: 0, crowdNearestEnd: 21.466, startVsGridMs: 0, endVsGridMs: 0, bpmDelta: 0, selectedAt: "old" };
  const corrected = { ...old, end: 26.500577, bpm: 144.90250533, selectedAt: "new" };
  assert.equal(manualTempoEvidenceWeight(64), 16);
  assert.equal(latestAuthoritativeManualTempo([corrected, old]), corrected);
});

test("an outgoing run-up keeps its selected start and shared endpoint as fixed grid boundaries", () => {
  const analysis = analysisFixture();
  const start = 10.137;
  const end = 14.137;
  const { analysis: corrected, teaching } = applyManualCycleGrid(analysis, start, end, 8, 121, "2026-07-22T00:00:00.000Z", "end", "after", "outro-transition");
  assert.equal(teaching.start, start);
  assert.equal(teaching.end, end);
  assert.equal(teaching.cueEdge, "end");
  assert.equal(teaching.purpose, "outro-transition");
  assert.equal(corrected.teaching.manualOutroCycle.start, start);
});

test("saving a second run-up keeps both manually selected windows pinned to the remapped grid", () => {
  const analysis = analysisFixture();
  const intro = { start: 10.137, end: 14.137, beats: 8 };
  const outro = { start: 15.22, end: 19.22, beats: 8 };
  const withIntro = applyManualCycleGrid(analysis, intro.start, intro.end, intro.beats, 120, "intro", "end", "after", "intro-loop").analysis;
  const corrected = applyManualCycleGrid(withIntro, outro.start, outro.end, outro.beats, 120, "outro", "end", "after", "outro-transition").analysis;
  for (const boundary of [intro.start, intro.end, outro.start, outro.end]) {
    const nearest = corrected.beats.reduce((best, beat) => Math.abs(beat.time - boundary) < Math.abs(best.time - boundary) ? beat : best);
    assert.ok(Math.abs(nearest.time - boundary) < 1e-9, `${boundary} remains an exact grid beat`);
  }
  assert.equal(corrected.teaching.manualIntroCycle.end, intro.end);
  assert.equal(corrected.teaching.manualOutroCycle.end, outro.end);
});

test("manual windows are ordered by track time even when the later window is clicked first", () => {
  const analysis = analysisFixture();
  const laterFirst = applyManualCycleGrid(analysis, 26.137, 30.137, 8, 120, "later", "end", "after", "intro-loop").analysis;
  const earlierPurpose = manualWindowPurposeAt(laterFirst.teaching, 10.137);
  assert.equal(earlierPurpose, "intro-loop");
  const corrected = applyManualCycleGrid(laterFirst, 10.137, 14.137, 8, 120, "earlier", "end", "after", earlierPurpose).analysis;
  assert.equal(corrected.teaching.manualIntroCycle.start, 10.137);
  assert.equal(corrected.teaching.manualIntroCycle.purpose, "intro-loop");
  assert.equal(corrected.teaching.manualOutroCycle.start, 26.137);
  assert.equal(corrected.teaching.manualOutroCycle.purpose, "outro-transition");
});

test("cycle teaching learns cycle, cue edge, loop release and BPM correction", () => {
  const base = { kind: "loop-grid", start: 1, end: 17, beats: 32, crowdBpm: 118, crowdNearestStart: 1.05, crowdNearestEnd: 17.05, startVsGridMs: -50, endVsGridMs: -50, bpmDelta: 2, cueEdge: "start", exitSide: "before", selectedAt: "now" };
  const profile = teachingProfile([
    { ...base, trackId: "one", bpm: 120 },
    { ...base, trackId: "two", bpm: 120 },
    { ...base, trackId: "three", beats: 64, bpm: 120, cueEdge: "end" },
  ]);
  assert.equal(profile.commonCycleBeats, 32);
  assert.equal(profile.cycleMoments, 3);
  assert.ok(profile.learnedBpmRatio > 1);
  assert.equal(profile.theories.find((theory) => theory.id === "cycle-32-64").status, "supported");
  assert.equal(profile.theories.find((theory) => theory.id === "cycle-cue-edge").status, "supported");
  assert.match(profile.theories.find((theory) => theory.id === "cycle-cue-edge").label, /front edge/);
  assert.equal(profile.theories.find((theory) => theory.id === "cycle-release-side").status, "supported");
  assert.match(profile.theories.find((theory) => theory.id === "cycle-release-side").label, /before/);
});

test("kick evidence must not move beats inside a supporting manual window", () => {
  const analysis = analysisFixture();
  const start = 10.137;
  const end = 14.137;
  const taught = applyManualCycleGrid(analysis, start, end, 8, 120, "2026-08-08T00:00:00.000Z", "end", "after", "outro-transition").analysis;
  const windowIndices = taught.beats.flatMap((beat, index) => beat.time >= start - 1e-6 && beat.time <= end + 1e-6 ? [index] : []);
  assert.equal(windowIndices.length, 9);
  const savedTimes = windowIndices.map((index) => taught.beats[index].time);
  const auditedAtEnd = applyKickCycleAnchor(taught, end).analysis;
  assert.deepEqual(windowIndices.map((index) => auditedAtEnd.beats[index].time), savedTimes, "the loop-teach audit must not move taught window beats");
  const auditedAtCue = applyKickCycleAnchor(taught, 20.01).analysis;
  assert.deepEqual(windowIndices.map((index) => auditedAtCue.beats[index].time), savedTimes, "a later cue teach must not move taught window beats");
});

test("a demoted strong window still freezes the whole grid against later teaching audits", () => {
  const analysis = analysisFixture();
  const withIntro = applyManualCycleGrid(analysis, 4.137, 20.137, 32, 120, "intro", "end", "after", "intro-loop").analysis;
  const withOutro = applyManualCycleGrid(withIntro, 30.637, 34.637, 8, 120, "outro", "end", "after", "outro-transition").analysis;
  assert.equal(withOutro.teaching.manualCycle.beats, 8, "the legacy slot now holds the supporting window");
  assert.equal(withOutro.teaching.manualIntroCycle.tempoAuthority, "strong");
  const audited = applyKickCycleAnchor(withOutro, 10.31).analysis;
  assert.deepEqual(audited.beats.map((beat) => beat.time), withOutro.beats.map((beat) => beat.time), "kick evidence must not move a grid holding a strong manual window");
});

test("teaching a cue near a manual window rephases only Crowd's own beats", () => {
  const analysis = analysisFixture();
  const start = 10.137;
  const end = 14.137;
  const taught = applyManualCycleGrid(analysis, start, end, 8, 120, "2026-08-08T00:00:00.000Z", "end", "after", "outro-transition").analysis;
  const windowIndices = taught.beats.flatMap((beat, index) => beat.time >= start - 1e-6 && beat.time <= end + 1e-6 ? [index] : []);
  const savedTimes = windowIndices.map((index) => taught.beats[index].time);
  const cue = 16.637;
  const { analysis: corrected } = applyCueGridPhase(taught, cue);
  const nearest = corrected.beats.reduce((best, beat) => Math.abs(beat.time - cue) < Math.abs(best.time - cue) ? beat : best);
  assert.ok(Math.abs(nearest.time - cue) < 1e-9, "the cue still rephases Crowd's own grid outside the window");
  assert.deepEqual(windowIndices.map((index) => corrected.beats[index].time), savedTimes, "beats inside the taught window must not be rephased");
});

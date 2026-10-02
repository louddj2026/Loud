import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessLiveCandidate, assessLiveOpenerExit, assessRunwayGridCoverage, bassPatternSimilarity, liveCandidateAccepted, selectLockedOutgoingCue } from "../lib/live-crate.ts";
import { predictRundownLoop } from "../lib/rundown-loop.ts";
import { continuityCoverageSafe } from "../lib/runway-grid.ts";

test("matching bass-energy patterns outrank unrelated patterns", () => {
  const source = [1, .3, .8, .25, 1, .3, .8, .25, 1, .3, .8, .25, 1, .3, .8, .25];
  const matching = source.map((value) => value * .7);
  const unrelated = [.1, 1, .1, 1, .1, 1, .1, 1, .1, 1, .1, 1, .1, 1, .1, 1];
  assert.ok(bassPatternSimilarity(source, matching) > .99);
  assert.ok(bassPatternSimilarity(source, matching) > bassPatternSimilarity(source, unrelated) + .2);
});

test("deadline pressure relaxes only score and never the hard mixing gates", () => {
  const safe = {
    accepted: false,
    score: .6,
    bassSimilarity: .7,
    tempoShiftPercent: 2,
    transitionGridSafe: true,
    rundownSafe: true,
    phrasePaired: true,
    incomingPlayabilitySafe: true,
  };
  assert.equal(liveCandidateAccepted(safe, 90, true), true, "a score-only miss may be rescued near the deadline");
  assert.equal(liveCandidateAccepted({ ...safe, score: .46, bassSimilarity: .52, tempoShiftPercent: 10 }, 90, true), true, "the widened musical limits remain available near the deadline");
  for (const unsafe of [
    { phrasePaired: false },
    { incomingPlayabilitySafe: false },
    { transitionGridSafe: false },
    { rundownSafe: false },
    { bassSimilarity: .519 },
    { tempoShiftPercent: 10.01 },
  ]) {
    assert.equal(liveCandidateAccepted({ ...safe, ...unsafe }, 90, true), false);
  }
  assert.equal(liveCandidateAccepted(safe, 120, true), false, "the score relaxation is deadline-only");
  assert.equal(liveCandidateAccepted(safe, 90, false), false, "an expired runway cannot be rescued");
});

test("Male P7 is anchored to its strong phrase-edge kick and crash", async () => {
  const male = JSON.parse(await readFile(new URL("../public/analysis/elements-16864e2b58f5f3.json", import.meta.url), "utf8"));
  const p7 = male.beats.find((beat) => beat.phraseIndex === 6 && beat.isPhraseStart);
  assert.ok(p7);
  assert.ok(p7.crashConfidence >= .78);
  assert.ok(p7.attackTime !== null);
  assert.ok(Math.abs(p7.time - p7.attackTime) <= .0005, `P7 grid ${p7.time} should meet attack ${p7.attackTime}`);
});

test("the pictured Alone P30 to Male P7 runways are accepted as direct phrase-grid consensus", async () => {
  const load = (id) => readFile(new URL(`../public/analysis/${id}.json`, import.meta.url), "utf8").then(JSON.parse);
  const [alone, male] = await Promise.all(["elements-f4ce22a8ebdda3", "elements-16864e2b58f5f3"].map(load));
  const aloneP30 = alone.beats.findIndex((beat) => beat.phraseIndex === 29 && beat.isPhraseStart);
  const maleP7 = male.beats.findIndex((beat) => beat.phraseIndex === 6 && beat.isPhraseStart);
  const aloneCoverage = assessRunwayGridCoverage(alone, alone.beats[aloneP30 - 32].time, alone.beats[aloneP30 + 16].time);
  const maleCoverage = assessRunwayGridCoverage(male, male.beats[maleP7 - 32].time, male.beats[maleP7 + 16].time);
  assert.equal(aloneCoverage.verifiedEvidenceCoverage, 1);
  assert.equal(maleCoverage.verifiedEvidenceCoverage, 1);
  assert.ok(aloneCoverage.evidenceAvailability >= .12);
  assert.ok(maleCoverage.evidenceAvailability >= .12);

  const picturedPair = assessLiveCandidate(
    { id: alone.track.id, name: alone.track.name, analysis: alone },
    { id: male.track.id, name: male.track.name, analysis: male },
    { outgoingNotBefore: 320 },
  );
  assert.equal(picturedPair.accepted, true);
  assert.equal(picturedPair.plan.tracks[0].exitHandoff, alone.beats[aloneP30].time);
  assert.equal(picturedPair.plan.tracks[1].entryDrop, male.beats[maleP7].time);
  assert.ok(picturedPair.incomingNextExitHandoff !== null);
  assert.equal(picturedPair.plan.tracks[1].exitHandoff, picturedPair.incomingNextExitHandoff, "the winning tune must carry forward the safety-checked cue it was selected with");
  assert.equal(picturedPair.plan.tracks[1].cuePoints.find((cue) => cue.id === "exit-handoff")?.time, picturedPair.incomingNextExitHandoff);
  assert.equal(picturedPair.incomingRunwayAudienceMuted, true);
  assert.ok(picturedPair.bassSimilarity > .95, "the inaudible bassless runup must not dilute the audible handoff match");
});

test("the playing tune's selected cue stays fixed until the cue itself is missed", async () => {
  const load = (id) => readFile(new URL(`../public/analysis/${id}.json`, import.meta.url), "utf8").then(JSON.parse);
  const [alone, male] = await Promise.all(["elements-f4ce22a8ebdda3", "elements-16864e2b58f5f3"].map(load));
  const p30 = alone.beats.find((beat) => beat.phraseIndex === 29 && beat.isPhraseStart).time;
  const lockedBeforeRunway = selectLockedOutgoingCue(alone, 320, p30);
  assert.equal(lockedBeforeRunway.exitHandoff, p30);

  const matched = assessLiveCandidate(
    { id: alone.track.id, name: alone.track.name, analysis: alone },
    { id: male.track.id, name: male.track.name, analysis: male },
    { outgoingNotBefore: 320, lockedOutgoingHandoff: p30 },
  );
  assert.equal(matched.accepted, true);
  assert.equal(matched.plan.tracks[0].exitHandoff, p30);

  const afterRunway = selectLockedOutgoingCue(alone, 337, p30);
  assert.equal(afterRunway.exitHandoff, p30, "a missed preparation runway does not move a cue that has not played yet");
  const afterCue = selectLockedOutgoingCue(alone, 339, p30);
  assert.ok(afterCue.exitHandoff > p30, "only passing the selected bass-swap cue may advance it");
});

test("runway coverage ignores evidence elsewhere in the track", () => {
  const analysis = {
    duration: 120,
    beats: [{ time: 0 }],
    verification: { blocks: [
      { start: 0, end: 16, status: "verified", evidenceCoverage: 1 },
      { start: 40, end: 56, status: "review", evidenceCoverage: .75 },
      { start: 56, end: 72, status: "verified", evidenceCoverage: .25 },
      { start: 90, end: 106, status: "verified", evidenceCoverage: 1 },
    ] },
  };
  const local = assessRunwayGridCoverage(analysis, 40, 72);
  assert.equal(local.evidencedSeconds, 16);
  assert.equal(local.verifiedEvidenceCoverage, .25);
  assert.equal(local.reviewRatio, .75);
  assert.equal(local.evidenceAvailability, .5);
});

test("a breakdown may hold an established grid but contradictory evidence may not", () => {
  assert.equal(continuityCoverageSafe({ verifiedEvidenceCoverage: 0, evidenceAvailability: 0, reviewRatio: 1, evidencedSeconds: 0, windowSeconds: 20 }), true);
  assert.equal(continuityCoverageSafe({ verifiedEvidenceCoverage: .5, evidenceAvailability: .4, reviewRatio: .5, evidencedSeconds: 8, windowSeconds: 20 }), false);
});

test("opener selection ignores its intro grid and requires a safe outro", async () => {
  const ufo = JSON.parse(await readFile(new URL("../public/analysis/03.json", import.meta.url), "utf8"));
  const weakIntro = {
    ...ufo,
    verification: {
      ...ufo.verification,
      blocks: ufo.verification.blocks.map((block) => block.end < ufo.duration * .5 ? { ...block, status: "review", evidenceCoverage: .8 } : block),
    },
  };
  assert.equal(assessLiveOpenerExit(weakIntro).accepted, true);
  const weakOutro = {
    ...ufo,
    verification: {
      ...ufo.verification,
      blocks: ufo.verification.blocks.map((block) => block.start >= ufo.duration * .5 ? { ...block, status: "review", evidenceCoverage: .8 } : block),
    },
  };
  assert.equal(assessLiveOpenerExit(weakOutro).accepted, false);
});

test("live digging accepts good local runways and refuses local disputed evidence", async () => {
  const load = (id) => readFile(new URL(`../public/analysis/${id}.json`, import.meta.url), "utf8").then(JSON.parse);
  const [ufo, mythical] = await Promise.all(["03", "06"].map(load));
  const locallyVerified = (analysis) => ({
    ...analysis,
    verification: {
      ...analysis.verification,
      blocks: analysis.verification.blocks.map((block) => ({ ...block, status: "verified", evidenceCoverage: Math.max(.5, block.evidenceCoverage) })),
    },
  });
  const unverified = {
    ...locallyVerified(mythical),
    verification: {
      ...locallyVerified(mythical).verification,
      blocks: mythical.verification.blocks.map((block) => ({ ...block, status: "review", evidenceCoverage: .8 })),
    },
  };
  const strong = assessLiveCandidate({ id: ufo.track.id, name: ufo.track.name, analysis: locallyVerified(ufo) }, { id: mythical.track.id, name: mythical.track.name, analysis: locallyVerified(mythical) });
  const weak = assessLiveCandidate({ id: ufo.track.id, name: ufo.track.name, analysis: locallyVerified(ufo) }, { id: `${mythical.track.id}-unverified`, name: mythical.track.name, analysis: unverified });
  assert.equal(strong.accepted, true);
  assert.ok(strong.cuePairsTested > 1);
  assert.ok([32, 64].includes(strong.plan.runwayBeats));
  assert.equal(strong.plan.blendBeats, 128, "a safe long hold should outrank the 64-beat fallback");
  assert.equal(strong.phrasePaired, true);
  const outgoingCue = strong.plan.tracks[0];
  const incomingCue = strong.plan.tracks[1];
  const outgoingExitIndex = locallyVerified(ufo).beats.reduce((best, beat, index, beats) => Math.abs(beat.time - outgoingCue.exitHandoff) < Math.abs(beats[best].time - outgoingCue.exitHandoff) ? index : best, 0);
  const incomingEntryIndex = locallyVerified(mythical).beats.reduce((best, beat, index, beats) => Math.abs(beat.time - incomingCue.entryDrop) < Math.abs(beats[best].time - incomingCue.entryDrop) ? index : best, 0);
  const outgoingRunwayIndex = locallyVerified(ufo).beats.reduce((best, beat, index, beats) => Math.abs(beat.time - outgoingCue.exitRunway) < Math.abs(beats[best].time - outgoingCue.exitRunway) ? index : best, 0);
  const incomingRunwayIndex = locallyVerified(mythical).beats.reduce((best, beat, index, beats) => Math.abs(beat.time - incomingCue.entryRunway) < Math.abs(beats[best].time - incomingCue.entryRunway) ? index : best, 0);
  assert.equal(locallyVerified(ufo).beats[outgoingExitIndex].isPhraseStart, true);
  assert.equal(locallyVerified(mythical).beats[incomingEntryIndex].isPhraseStart, true);
  assert.equal(outgoingExitIndex - outgoingRunwayIndex, strong.plan.runwayBeats);
  assert.equal(incomingEntryIndex - incomingRunwayIndex, strong.plan.runwayBeats);
  assert.equal(weak.accepted, false);
  assert.match(weak.reason, /no locally safe mix-in\/out pairing|no entry left enough active bass\/kick space/);
});

test("rundown loops are conditional and release only on a later primary break", async () => {
  const load = (id) => readFile(new URL(`../public/analysis/${id}.json`, import.meta.url), "utf8").then(JSON.parse);
  const [ufo, mythical] = await Promise.all(["03", "06"].map(load));
  const natural = assessLiveCandidate({ id: ufo.track.id, name: ufo.track.name, analysis: ufo }, { id: mythical.track.id, name: mythical.track.name, analysis: mythical });
  assert.equal(natural.accepted, true);
  assert.equal(natural.plan.tracks[0].rundownLoop, undefined);

  const makeAnalysis = (quietFrom, quietTo) => {
    const beatSeconds = .4;
    const hopSeconds = .1;
    const beats = Array.from({ length: 161 }, (_, beat) => ({ beat, time: beat * beatSeconds, confidence: 1, isDownbeat: beat % 4 === 0, isPhraseStart: beat % 32 === 0 }));
    const values = Array.from({ length: 640 }, (_, frame) => {
      const beat = Math.floor(frame / 4);
      return beat >= quietFrom && beat < quietTo ? .02 : .8;
    });
    return {
      duration: 64,
      hopSeconds,
      beats,
      lowWaveformDetailed: values,
      lowAttackWaveformDetailed: values,
      upperAttackWaveformDetailed: values,
      tempoSections: [{ start: 0, end: 64, bpm: 150 }],
      verification: { blocks: [{ start: 0, end: 64, status: "verified", evidenceCoverage: 1 }] },
    };
  };
  const outgoing = makeAnalysis(40, 48); // neutral eight-beat hold after the handoff
  const incoming = makeAnalysis(64, 68); // later four-beat primary-track break
  const held = predictRundownLoop(outgoing, outgoing.beats[32].time, incoming, incoming.beats[32].time);
  assert.equal(held.safe, true);
  assert.ok([4, 8, 16].includes(held.loop.loopBeats));
  assert.ok(held.loop.releaseBeatOffset >= 8);
  assert.ok(held.loop.releaseIncomingTime > incoming.beats[32].time);
});

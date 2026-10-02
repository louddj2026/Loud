import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CROWD2_DEMO_TRACK_IDS, DEMO_BLEND_BEATS, DEMO_RUNWAY_BEATS, audibleRunwayPhraseEdge, cueLockedTempoRate, findEntryCueCandidates, findExitCueCandidates, planDemoSet, sourceTimeAlignedToCue } from "../lib/demo-set.ts";

const analysisDirectory = new URL("../public/analysis/", import.meta.url);

async function loadDemoInputs() {
  return Promise.all(CROWD2_DEMO_TRACK_IDS.map(async (id) => {
    const analysis = JSON.parse(await readFile(new URL(`${id}.json`, analysisDirectory), "utf8"));
    return { id, name: analysis.track.name, analysis };
  }));
}

function beatIndexAt(analysis, time) {
  return analysis.beats.reduce((bestIndex, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[bestIndex].time - time) ? index : bestIndex, 0);
}

test("demo planner selects phrase-aligned runways, drops and patient mix clears", async () => {
  const plan = planDemoSet(await loadDemoInputs());
  assert.deepEqual(plan.tracks.map((track) => track.name), ["U.F.O.", "Mythical Tales", "Bleep Orchestra"]);
  assert.deepEqual(plan.tracks.map((track) => track.deck), ["A", "B", "A"]);
  assert.equal(plan.runwayBeats, 32);
  assert.equal(plan.blendBeats, 64);

  plan.tracks.forEach((track, order) => {
    const entryIndex = beatIndexAt(track.analysis, track.entryDrop);
    const entryRunwayIndex = beatIndexAt(track.analysis, track.entryRunway);
    const exitIndex = beatIndexAt(track.analysis, track.exitHandoff);
    const exitRunwayIndex = beatIndexAt(track.analysis, track.exitRunway);
    const mixOutIndex = beatIndexAt(track.analysis, track.mixOut);
    assert.equal(track.analysis.beats[entryIndex].isDownbeat, true, `${track.name} entry is a downbeat`);
    assert.equal(track.analysis.beats[exitIndex].isDownbeat, true, `${track.name} handoff is a downbeat`);
    assert.equal(track.analysis.beats[entryIndex].isPhraseStart, true, `${track.name} entry is the beginning of a phrase`);
    assert.equal(track.analysis.beats[exitIndex].isPhraseStart, true, `${track.name} exit is the end of one phrase and beginning of the next`);
    assert.equal(entryIndex - entryRunwayIndex, DEMO_RUNWAY_BEATS, `${track.name} has a 32-beat incoming runway`);
    assert.equal(exitIndex - exitRunwayIndex, DEMO_RUNWAY_BEATS, `${track.name} has a 32-beat outgoing runway`);
    assert.equal(mixOutIndex - exitIndex, DEMO_BLEND_BEATS, `${track.name} has a 64-beat blend`);
    if (order === 0) assert.equal(track.entryRunway >= 0, true);
    if (order > 0 && order < plan.tracks.length - 1) assert.equal(exitIndex - beatIndexAt(track.analysis, track.skipTo), 64);
    if (order > 0) assert.equal(track.cuePoints.find((cue) => cue.id === "entry-drop")?.label, "MIX IN · BASS ON");
    if (order < plan.tracks.length - 1) assert.equal(track.cuePoints.find((cue) => cue.id === "exit-handoff")?.label, "MIX OUT · BASS OFF");
  });
});

test("the selected incoming drops are early enough to preserve the tune", async () => {
  const plan = planDemoSet(await loadDemoInputs());
  for (const track of plan.tracks.slice(1)) {
    assert.ok(track.entryDrop < track.analysis.duration * .3, `${track.name} enters before 30% of the tune`);
    assert.ok(track.entryDrop > track.entryRunway, `${track.name} runway precedes its bass drop`);
  }
});

test("a taught incoming cue remains the exact preferred point between beats", async () => {
  const [input] = await loadDemoInputs();
  const machineCue = findEntryCueCandidates(input.analysis, { allowLateEntry: true })[0];
  const exact = machineCue.time + .137;
  const taught = { ...input.analysis, teaching: { ...input.analysis.teaching, preferredEntryCue: { time: exact } } };
  const candidates = findEntryCueCandidates(taught, { allowLateEntry: true });
  assert.equal(candidates[0].time, exact);
  assert.equal(candidates[0].beatIndex, machineCue.beatIndex);
});

test("every outgoing handoff lands on the incoming bass-drop cue at the same instant", async () => {
  const plan = planDemoSet(await loadDemoInputs());
  for (let index = 0; index < plan.tracks.length - 1; index += 1) {
    const outgoing = plan.tracks[index];
    const incoming = plan.tracks[index + 1];
    const incomingRate = cueLockedTempoRate(outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop, 1);
    const outgoingWallSeconds = outgoing.exitHandoff - outgoing.exitRunway;
    const incomingWallSeconds = (incoming.entryDrop - incoming.entryRunway) / incomingRate;
    assert.ok(Math.abs(outgoingWallSeconds - incomingWallSeconds) < 1e-9, `${outgoing.name} and ${incoming.name} reach their linked cues together`);
    const incomingAtHandoff = sourceTimeAlignedToCue(outgoing.exitHandoff, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop);
    assert.ok(Math.abs(incomingAtHandoff - incoming.entryDrop) < 1e-9, `${incoming.name} lands exactly on its bass-drop cue`);
  }
});

test("outro choices follow usable kick and bass runway rather than raw track position", () => {
  const beatCount = 401;
  const hopSeconds = .5;
  const beats = Array.from({ length: beatCount }, (_, index) => ({
    beat: index + 1,
    time: index * hopSeconds,
    isDownbeat: index % 4 === 0,
    confidence: 1,
    isPhraseStart: index % 32 === 0,
  }));
  const lowWaveformDetailed = Array.from({ length: beatCount }, (_, index) => index >= 200 && index < 340 ? .9 : .08);
  const analysis = {
    duration: (beatCount - 1) * hopSeconds,
    hopSeconds,
    track: { id: "runway-test", name: "Runway Test" },
    beats,
    lowWaveformDetailed,
    tempoSections: [{ start: 0, end: beatCount * hopSeconds, bpm: 120 }],
  };

  const exits = findExitCueCandidates(analysis);
  const strongestLateExit = exits.filter((exit) => exit.time >= analysis.duration * .8)[0];
  assert.ok(exits[0].time < analysis.duration * .8, "the strong low-end runway before 80% should remain selectable");
  assert.ok(strongestLateExit, "the synthetic track should also contain later candidates");
  assert.ok(exits[0].score > strongestLateExit.score, "strong continuing kick and bass should outrank a later but empty tail");
});

test("entry and exit candidates never substitute an ordinary downbeat for a phrase edge", async () => {
  for (const input of await loadDemoInputs()) {
    for (const cue of findEntryCueCandidates(input.analysis, { allowLateEntry: true })) {
      assert.equal(input.analysis.beats[cue.beatIndex].isPhraseStart, true);
    }
    for (const cue of findExitCueCandidates(input.analysis, { allowEarlyExit: true })) {
      assert.equal(input.analysis.beats[cue.beatIndex].isPhraseStart, true);
    }
  }
});

test("a running runway stays audience-muted until a late phrase edge", () => {
  const beats = Array.from({ length: 129 }, (_, beat) => ({ beat, time: beat * .4, isDownbeat: beat % 4 === 0, isPhraseStart: beat % 32 === 0, confidence: 1 }));
  const analysis = { duration: 52, hopSeconds: .1, track: { id: "muted-runway", name: "Muted Runway" }, beats, lowWaveformDetailed: [], tempoSections: [{ start: 0, end: 52, bpm: 150 }] };
  assert.equal(audibleRunwayPhraseEdge(analysis, beats[32].time, beats[96].time), beats[64].time, "a 64-beat runup may become audible on its late phrase edge");
  assert.equal(audibleRunwayPhraseEdge(analysis, beats[64].time, beats[96].time), beats[96].time, "a 32-beat runup may remain muted until the handoff itself");
});

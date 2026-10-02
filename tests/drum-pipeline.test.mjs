import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fitKickGrid, KICK_MATCH_TOLERANCE_SECONDS } from "../lib/kick-grid.ts";
import { detectKicks, KICK_PICK_SAMPLE_RATE } from "../lib/kick-detect.ts";
import { buildKickMap } from "../lib/kick-map.ts";
import { proposeLabelCues } from "../lib/label-cue.ts";
import { APPLY_MEDIAN_ERROR_LIMIT_MS, kickGridApplyDecision, kickGridApplyWindow } from "../lib/kick-grid-apply.ts";

const boothSource = readFileSync(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");

/** A clean fit on a tune nobody has judged: the case auto-apply exists for. */
function cleanFit(overrides = {}) {
  return { bpm: 145, firstBeatMs: 1234, beatCount: 900, medianErrorMs: 9, ...overrides };
}

function openContext(overrides = {}) {
  return { judged: false, manualGrid: false, duration: 372, ...overrides };
}

/** A mapped grid to declare against, with bars every four beats. */
function libraryGrid(bpm, count, from = 1.2) {
  const period = 60 / bpm;
  return Array.from({ length: count }, (_, index) => ({ time: from + index * period, isDownbeat: index % 4 === 0 }));
}

/** A regular kick on every beat, plus whatever extras a test wants. */
function kicks({ bpm, beats, from = 0, extras = [] }) {
  const period = 60 / bpm;
  const times = Array.from({ length: beats }, (_, index) => from + index * period);
  return [...times, ...extras].sort((left, right) => left - right);
}

test("a grid fits a steady kick pattern to the beat", () => {
  const times = kicks({ bpm: 145, beats: 400, from: 1.234 });
  const grid = fitKickGrid(times, 400 * (60 / 145) + 5);
  assert.ok(grid, "should fit");
  assert.ok(Math.abs(grid.bpm - 145) < 0.05, `bpm was ${grid.bpm}`);
  assert.ok(grid.explains > 0.98, `explained only ${grid.explains}`);
  assert.ok(grid.medianErrorMs < 5, `median error ${grid.medianErrorMs}ms`);
});

test("stutters and fills do not move the tempo", () => {
  // DJ's requirement: extra kicks — rolls, or the four that fill a bassline hole —
  // must not affect the grid or the BPM. A whole bar of 16th-note kicks is added.
  const period = 60 / 142;
  const extras = [];
  for (let step = 1; step < 64; step += 1) extras.push(60 + step * period / 4);
  const grid = fitKickGrid(kicks({ bpm: 142, beats: 400, from: 0.5, extras }), 400 * period + 5);
  assert.ok(grid, "should fit");
  assert.ok(Math.abs(grid.bpm - 142) < 0.05, `stutters moved the tempo to ${grid.bpm}`);
  // Those extras are outliers, so they should be reported rather than absorbed.
  assert.ok(grid.outliers > 20, `expected the stutters to be counted as outliers, got ${grid.outliers}`);
});

test("the grid is centred on the kicks, not offset from them", () => {
  // The bug DJ heard as "a slight but consistent delay": phase taken from one
  // kick rather than the middle of the cluster.
  const period = 60 / 140;
  const jittered = Array.from({ length: 300 }, (_, index) => {
    const wobble = (index % 3 === 0 ? 0.004 : index % 3 === 1 ? -0.002 : 0);
    return 2 + index * period + wobble;
  });
  const grid = fitKickGrid(jittered, 300 * period + 5);
  assert.ok(grid, "should fit");
  let signedSum = 0;
  let matched = 0;
  for (const kick of jittered) {
    const along = (kick - grid.firstBeat) / (60 / grid.bpm);
    const signed = (Math.round(along) - along) * (60 / grid.bpm) * 1000;
    if (Math.abs(signed) <= 35) { signedSum += signed; matched += 1; }
  }
  const bias = signedSum / matched;
  assert.ok(Math.abs(bias) < 2.5, `grid sits ${bias.toFixed(1)}ms off the kicks it was fitted to`);
});

test("a detected kick's time is the START of the kick, not its swell", () => {
  // DJ saw picks landing at the far side of the drawn blobs: the detector was
  // reporting the steepest rise, mid-swell, 30-45ms after the attack a DJ cues
  // to. Synthetic kicks with a known instant attack pin the onset.
  const rate = KICK_PICK_SAMPLE_RATE;
  const period = 60 / 145;
  const seconds = 60;
  const samples = new Float32Array(Math.round(seconds * rate));
  const starts = [];
  for (let kick = 0; kick * period + 1 < seconds - 1; kick += 1) {
    const start = 1 + kick * period;
    starts.push(start);
    const from = Math.round(start * rate);
    for (let index = 0; index < Math.round(.08 * rate); index += 1) {
      const t = index / rate;
      samples[from + index] += Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 30);
    }
  }
  const hits = detectKicks(samples, rate);
  assert.ok(hits.length >= starts.length * .9, `found ${hits.length} of ${starts.length}`);
  const offsets = hits.map((hit) => {
    const nearest = starts.reduce((best, start) => Math.abs(start - hit.time) < Math.abs(best - hit.time) ? start : best);
    return (hit.time - nearest) * 1000;
  }).sort((a, b) => a - b);
  const medianOffset = offsets[offsets.length >> 1];
  // On the attack: within one hop after the true start, never tens of ms into
  // the swell, and never before the drum exists at all.
  assert.ok(medianOffset >= -6 && medianOffset <= 12, `median pick sits ${medianOffset.toFixed(1)}ms from the attack`);
});

test("the kick map IS the kicks — verbatim at the beginning, middle and end", () => {
  // DJ's spec: "no approximations where there is a kick." Every map point that
  // has a kick must equal that kick's detected time EXACTLY — strict equality,
  // not tolerance — across the whole tune.
  const period = 60 / 145;
  // Real kicks wobble; these carry per-kick offsets a grid could never sit on.
  const kicks = Array.from({ length: 600 }, (_, index) => 2 + index * period + (index % 7 - 3) * .004);
  const duration = 600 * period + 8;
  const map = buildKickMap(kicks, duration);
  assert.ok(map, "should build");
  const kickSet = new Set(kicks);
  const exact = map.points.filter((point) => point.exact);
  assert.ok(exact.length >= 590, `only ${exact.length} of 600 kicks made the map`);
  for (const point of exact) {
    assert.ok(kickSet.has(point.time), `${point.time} is not a detected kick's exact time`);
  }
  // Beginning, middle, end: the first, middle and last kicks are all in, verbatim.
  for (const kick of [kicks[0], kicks[300], kicks[kicks.length - 1]]) {
    assert.ok(map.points.some((point) => point.exact && point.time === kick), `kick at ${kick} missing`);
  }
});

test("stutters are excluded from the map; the beat kicks around them are kept", () => {
  const period = 60 / 142;
  const beatKicks = Array.from({ length: 400 }, (_, index) => 1 + index * period);
  // A bar of 16th-note stutters between beats 100 and 116.
  const stutters = [];
  for (let step = 1; step < 64; step += 1) {
    const time = beatKicks[100] + step * period / 4;
    if (Math.abs(step % 4) !== 0) stutters.push(time);
  }
  const map = buildKickMap([...beatKicks, ...stutters].sort((a, b) => a - b), 400 * period + 4);
  assert.ok(map);
  const mapTimes = new Set(map.points.filter((p) => p.exact).map((p) => p.time));
  for (const stutter of stutters) assert.ok(!mapTimes.has(stutter), `stutter at ${stutter} made the map`);
  for (const kick of beatKicks.slice(98, 120)) assert.ok(mapTimes.has(kick), `beat kick at ${kick} lost near the stutter bar`);
});

test("gaps are filled from the kicks either side, not from the skeleton tempo", () => {
  // DJ's spec: "those approx are based on the kicks." A tune running a hair
  // fast around a gap must have the gap filled a hair fast too.
  const period = 60 / 145;
  const fast = period * .996; // locally ~0.4% quick — real drums, not the skeleton
  const before = Array.from({ length: 200 }, (_, index) => 2 + index * fast);
  const gapStart = before[199];
  // 16 beats of silence, then the kicks resume on the same fast spacing.
  const after = Array.from({ length: 200 }, (_, index) => gapStart + (16 + index) * fast);
  const map = buildKickMap([...before, ...after], gapStart + 220 * fast + 4);
  assert.ok(map);
  const fills = map.points.filter((point) => !point.exact && point.time > gapStart && point.time < after[0]);
  assert.equal(fills.length, 15, `expected 15 fills in a 16-beat gap, got ${fills.length}`);
  // The fill spacing is the span the two real kicks bound, divided evenly:
  // exactly the fast spacing, not the skeleton's slower one.
  for (let index = 0; index < fills.length; index += 1) {
    const expected = gapStart + (index + 1) * fast;
    assert.ok(Math.abs(fills[index].time - expected) < .001, `fill ${index} at ${fills[index].time}, expected ${expected}`);
  }
  // And the map runs to the end of the tune rather than stopping at the last kick.
  assert.ok(map.points[map.points.length - 1].time > after[after.length - 1]);
});

test("the grid sits in the middle of the kicks, not to one side of them", () => {
  // The bug this pins: the phase correction averages only the kicks already
  // within tolerance of the beat, so a starting phase far enough out clips one
  // side of the distribution and a single pass under-corrects. Measured over 51
  // real grids it left 34 biased by more than 3ms and the worst at 25ms — every
  // kick consistently late, which is exactly what a flam is.
  const period = 60 / 145;
  // Kicks all sitting 24ms after where a naive phase would put them, with enough
  // spread that the tolerance window clips the far tail on the first pass.
  const kicks = Array.from({ length: 400 }, (_, index) => {
    const wobble = (index % 5 - 2) * .004;
    return 3 + index * period + .024 + wobble;
  });
  const grid = fitKickGrid(kicks, 400 * period + 6);
  assert.ok(grid, "should fit");
  let signedSum = 0;
  let matched = 0;
  for (const kick of kicks) {
    const along = (kick - grid.firstBeat) / (60 / grid.bpm);
    const signed = (Math.round(along) - along) * (60 / grid.bpm) * 1000;
    if (Math.abs(signed) <= 35) { signedSum += signed; matched += 1; }
  }
  const bias = signedSum / matched;
  assert.ok(Math.abs(bias) < 2.5, `grid sits ${bias.toFixed(1)}ms to one side of its own kicks`);
});

test("too few kicks is refused rather than fitted to noise", () => {
  assert.equal(fitKickGrid([1, 2, 3], 60), null);
  assert.equal(fitKickGrid(kicks({ bpm: 145, beats: 400 }), 0), null);
});

test("mix in anchors on the FIRST chorus, mix out on the LAST — DJ's rule", () => {
  // Measured on his 13 marked windows: the entry sits in the first half of the
  // tune's chorus list 13/13, the exit in the last third 13/13. The only
  // structural rule tested that did not fail its control.
  const period = 60 / 145;
  const beats = Array.from({ length: 1200 }, (_, index) => index * period);
  const duration = 1200 * period;
  const spans = [
    { start: 0, end: duration * .1, label: "intro" },
    { start: duration * .1, end: duration * .3, label: "chorus" },   // first chorus
    { start: duration * .3, end: duration * .5, label: "verse" },
    { start: duration * .5, end: duration * .75, label: "chorus" },
    { start: duration * .75, end: duration * .8, label: "inst" },
    { start: duration * .8, end: duration * .93, label: "chorus" },  // last chorus
    { start: duration * .93, end: duration, label: "outro" },
  ];

  const entry = proposeLabelCues(spans, beats, duration, "mix-in");
  assert.ok(entry, "should propose an entry");
  const entryAnchor = entry.candidates.find((candidate) => candidate.phraseOffset === 0);
  assert.ok(entryAnchor, "the label's own boundary should be offered");
  assert.ok(Math.abs(entryAnchor.time - duration * .1) < period * 2, `entry anchored at ${entryAnchor.time}, not the first chorus`);

  const exit = proposeLabelCues(spans, beats, duration, "mix-out");
  assert.ok(exit, "should propose an exit");
  const exitAnchor = exit.candidates.find((candidate) => candidate.phraseOffset === 0);
  assert.ok(exitAnchor, "the label's own boundary should be offered");
  // The last chorus ENDS at 93%, which is the boundary into the outro.
  assert.ok(Math.abs(exitAnchor.time - duration * .93) < period * 2, `exit anchored at ${exitAnchor.time}, not the last chorus end`);
  assert.ok(exitAnchor.time > duration * .7, "an exit must be late in the tune");

  // Neighbouring phrases offered, nearest first, because All-In-One only places a
  // boundary every 32 beats and the observed misses were whole phrases.
  assert.ok(exit.candidates.length > 1, "neighbouring phrases should be offered");
  assert.equal(exit.candidates[0].phraseOffset, 0, "the label's own boundary comes first");
  const offsets = exit.candidates.map((candidate) => Math.abs(candidate.phraseOffset));
  assert.deepEqual([...offsets].sort((a, b) => a - b), offsets, "candidates should widen outward");
  for (let index = 1; index < exit.candidates.length; index += 1) {
    const gapBeats = Math.abs(exit.candidates[index].time - exitAnchor.time) / period;
    assert.ok(Math.abs(gapBeats % 32) < 1 || Math.abs((gapBeats % 32) - 32) < 1, `neighbour is ${gapBeats} beats away, not a whole phrase`);
  }
});

test("a busy or bass-less opening section is vetoed and the walk asks the next boundary", () => {
  // DJ, 16 Aug 2026: the mix-in overlaps the other tune, so it wants a simple
  // section that still carries the bassline. Approved entries measured bass
  // ~0.65 / busy ~0.02 of the tune's 90th percentile; rejected sections read
  // bass <= 0.17 or busy >= 0.79. This control builds a tune whose FIRST
  // boundary is full-blast and whose second is stripped groove, and the entry
  // must land on the second.
  const period = 60 / 145;
  const beats = Array.from({ length: 1200 }, (_, index) => index * period);
  const duration = 1200 * period;
  const spans = [
    { start: 0, end: duration * .1, label: "intro" },
    { start: duration * .1, end: duration * .2, label: "chorus" },   // full-blast opener
    { start: duration * .2, end: duration * .4, label: "inst" },     // stripped groove
    { start: duration * .4, end: duration, label: "outro" },
  ];
  const kicks = beats.filter((time) => time >= duration * .1);
  const rate = 100;
  const bins = Math.floor(duration * rate);
  const between = (index, from, to) => index >= bins * from && index < bins * to;
  // Bass runs through both sections; the busy band only through the first.
  const bass = Array.from({ length: bins }, (_, index) => between(index, .1, .4) ? 1 : 0);
  const busy = Array.from({ length: bins }, (_, index) => between(index, .1, .2) ? 1 : 0.01);
  const proposal = proposeLabelCues(spans, beats, duration, "mix-in", kicks, { bass, busy });
  const best = proposal.candidates.find((candidate) => candidate.phraseOffset === 0);
  assert.ok(Math.abs(best.time - duration * .2) < period * 2, `entry at ${best.time}, expected the stripped section at ${duration * .2}`);
  // And without activity data the veto stays out of the way entirely.
  const bare = proposeLabelCues(spans, beats, duration, "mix-in", kicks);
  const bareBest = bare.candidates.find((candidate) => candidate.phraseOffset === 0);
  assert.ok(Math.abs(bareBest.time - duration * .1) < period * 2, "no bands, no veto: the first grooved boundary stands");
});

test("every proposed cue lands on a grid beat", () => {
  const period = 60 / 145;
  const beats = Array.from({ length: 1000 }, (_, index) => index * period);
  const duration = 1000 * period;
  const spans = [
    { start: 0, end: duration * .3, label: "intro" },
    // Two chorus endings late in the tune: the honest answer is that it cannot
    // choose between them, and it has to say so.
    { start: duration * .3, end: duration * .75, label: "chorus" },
    { start: duration * .75, end: duration * .82, label: "verse" },
    { start: duration * .82, end: duration * .9, label: "chorus" },
    // A chorus that runs to the end of the file has no boundary after it, so it is
    // not a mix-out candidate. An outro gives the second one its boundary.
    { start: duration * .9, end: duration, label: "outro" },
  ];
  const proposal = proposeLabelCues(spans, beats, duration, "mix-out");
  assert.ok(proposal, "should propose something");
  assert.match(proposal.because, /every 32 beats/, "it should say why the phrase is uncertain");
  // Snapped onto a beat, and honest about how far it moved.
  for (const candidate of proposal.candidates) {
    const nearest = beats.reduce((best, beat) => Math.abs(beat - candidate.time) < Math.abs(best - candidate.time) ? beat : best, beats[0]);
    // Times are stored rounded to the millisecond, so "on a beat" means within one.
    assert.ok(Math.abs(nearest - candidate.time) <= 0.001, "candidate is not on a grid beat");
    assert.ok(Math.abs(candidate.snappedByMs) <= period * 1000, "snap distance is implausible");
  }
});

test("no cue sits partway through a kick", () => {
  // DJ's rule, and stricter than snapping to a grid: the grid beat is a
  // prediction of where a kick is, the detected kick is where one was. The cue
  // goes on the kick.
  const period = 60 / 145;
  const beats = Array.from({ length: 1000 }, (_, index) => index * period);
  const duration = 1000 * period;
  const spans = [
    { start: 0, end: duration * .1, label: "intro" },
    { start: duration * .1, end: duration * .5, label: "chorus" },
    { start: duration * .5, end: duration * .88, label: "chorus" },
    { start: duration * .88, end: duration, label: "outro" },
  ];
  // Kicks that sit a few ms off the grid, as real ones do — 11ms is the median
  // error of the grids that came back clean by ear.
  const kicks = beats.map((beat, index) => beat + (index % 2 ? .011 : -.008));
  const proposal = proposeLabelCues(spans, beats, duration, "mix-out", kicks);
  assert.ok(proposal, "should propose an exit");
  for (const candidate of proposal.candidates) {
    assert.equal(candidate.onKick, true, "a cue should have found its kick");
    const nearestKick = kicks.reduce((best, kick) => Math.abs(kick - candidate.time) < Math.abs(best - candidate.time) ? kick : best, kicks[0]);
    // Stored to the millisecond, so "on the kick" means within one.
    assert.ok(Math.abs(nearestKick - candidate.time) <= .001, `cue sits ${Math.abs(nearestKick - candidate.time) * 1000}ms off the nearest kick`);
    // And it is the kick, not the beat: the beat is 8-11ms away from it.
    const nearestBeat = beats.reduce((best, beat) => Math.abs(beat - candidate.time) < Math.abs(best - candidate.time) ? beat : best, beats[0]);
    assert.ok(Math.abs(nearestBeat - candidate.time) > .005, "the cue landed on the beat rather than the kick");
    // It must be the kick AT the chorus boundary, never a neighbouring one. The
    // window is 35ms against a 414ms beat, so the snap cannot reach the next kick
    // — it can only ever pick the one already under this beat.
    assert.ok(
      Math.abs(nearestBeat - candidate.time) <= KICK_MATCH_TOLERANCE_SECONDS,
      "the snap crossed further than the tolerance, so it could reach another kick",
    );
    assert.ok(KICK_MATCH_TOLERANCE_SECONDS < period / 4, "the tolerance must stay a fraction of a beat");
  }
});

test("a cue in a drum gap stays on the beat and says so", () => {
  // Inventing a kick where the drums stop would be worse than admitting there is
  // none, so the beat is kept and the candidate is honest about it.
  const period = 60 / 145;
  const beats = Array.from({ length: 1000 }, (_, index) => index * period);
  const duration = 1000 * period;
  const spans = [
    { start: 0, end: duration * .1, label: "intro" },
    { start: duration * .1, end: duration * .88, label: "chorus" },
    { start: duration * .88, end: duration, label: "outro" },
  ];
  // Kicks everywhere except the second half, where the exit anchor falls.
  const kicks = beats.filter((beat) => beat < duration * .5).map((beat) => beat + .009);
  const proposal = proposeLabelCues(spans, beats, duration, "mix-out", kicks);
  assert.ok(proposal, "should still propose an exit");
  const anchor = proposal.candidates.find((candidate) => candidate.phraseOffset === 0);
  assert.ok(anchor);
  assert.equal(anchor.onKick, false, "there is no kick there to sit on");
  const nearestBeat = beats.reduce((best, beat) => Math.abs(beat - anchor.time) < Math.abs(best - anchor.time) ? beat : best, beats[0]);
  assert.ok(Math.abs(nearestBeat - anchor.time) <= .001, "with no kick it should still be exactly on a beat");
  // With no kick list at all it degrades the same way rather than proposing nothing.
  const bare = proposeLabelCues(spans, beats, duration, "mix-out");
  assert.ok(bare);
  assert.equal(bare.candidates[0].onKick, false);
});

test("a grid you have judged by ear is never replaced", () => {
  // 68 verdicts exist on the library's own grids and they are ground truth. A
  // verdict describes the beat times it was given, so re-fitting one would leave a
  // judgement attached to a grid nobody ever heard — worse than a bad grid.
  const held = kickGridApplyDecision(cleanFit(), openContext({ judged: true }));
  assert.equal(held.apply, false);
  assert.match(held.because, /judged/);
  // Same fit, unjudged: this is the case the carve-out exists for.
  assert.equal(kickGridApplyDecision(cleanFit(), openContext()).apply, true);
});

test("a manual grid is never moved by measurement", () => {
  const held = kickGridApplyDecision(cleanFit(), openContext({ manualGrid: true }));
  assert.equal(held.apply, false);
  assert.match(held.because, /manual/);
});

test("the 12ms flam line decides, and it is the measured one", () => {
  // 6 of the 9 flams heard sat at 18-26ms against ~11ms for the 33 clean grids.
  assert.equal(APPLY_MEDIAN_ERROR_LIMIT_MS, 12);
  assert.equal(kickGridApplyDecision(cleanFit({ medianErrorMs: 11 }), openContext()).apply, true);
  assert.equal(kickGridApplyDecision(cleanFit({ medianErrorMs: 12 }), openContext()).apply, true);
  const held = kickGridApplyDecision(cleanFit({ medianErrorMs: 13 }), openContext());
  assert.equal(held.apply, false);
  assert.match(held.because, /13ms/);
});

test("the stored tempo has no veto — the kick map is the master", () => {
  // A gate used to hold the fit when it disagreed with the library's stored BPM
  // by over 5%. Red Tide killed it: stored 169.013, kicks locked at 146.002 with
  // a 2.3ms fit, and the gate protected the wrong number. A clean fit applies no
  // matter what the analyser once guessed; a bad fit is already refused by the
  // flam line.
  assert.equal(kickGridApplyDecision(cleanFit({ bpm: 146.002 }), openContext()).apply, true);
  assert.equal(kickGridApplyDecision(cleanFit({ bpm: 96.7 }), openContext()).apply, true);
});

test("the declared window implies exactly the fitted tempo", () => {
  // Beats over span is the DJ's own definition, and the teaching path takes the
  // window rather than a BPM — so a window whose span is not a whole number of
  // fitted beats would quietly declare a different tempo from the one measured.
  const grid = cleanFit({ bpm: 145.37 });
  const duration = grid.beatCount * (60 / grid.bpm);
  const window = kickGridApplyWindow(grid, libraryGrid(145.1, grid.beatCount), duration);
  assert.ok(window, "should find a window");
  const implied = 60 / ((window.end - window.start) / window.beats);
  assert.ok(Math.abs(implied - grid.bpm) < 1e-9, `window implies ${implied}, not ${grid.bpm}`);
  // 64 beats or more is decisive tempo authority; anything less is recorded as
  // supporting evidence and leaves the old grid in place — a silent no-op.
  assert.ok(window.beats >= 64, `window of ${window.beats} beats would not carry the tempo`);
  assert.ok(window.start >= 0 && window.end <= duration);
});

test("the declared window keeps the tune's bar phase", () => {
  // Detected kicks say where the beats are and nothing about which one is beat 1.
  // The teaching path makes the window start a downbeat, so an arbitrary kick
  // would rotate every bar in the tune by up to three beats.
  const grid = cleanFit({ bpm: 145.37, firstBeatMs: 1234 });
  const duration = grid.beatCount * (60 / grid.bpm);
  const library = libraryGrid(145.1, grid.beatCount);
  const window = kickGridApplyWindow(grid, library, duration);
  assert.ok(window, "should find a window");
  const period = 60 / grid.bpm;
  const nearestDownbeat = library
    .filter((beat) => beat.isDownbeat)
    .reduce((best, beat) => Math.abs(beat.time - window.start) < Math.abs(best.time - window.start) ? beat : best);
  assert.ok(
    Math.abs(window.start - nearestDownbeat.time) <= period / 2 + 1e-9,
    `window starts ${Math.abs(window.start - nearestDownbeat.time)}s from a downbeat`,
  );
  // And on a kick-grid beat, so the phase it declares is the fitted phase.
  const along = (window.start - grid.firstBeatMs / 1000) / period;
  assert.ok(Math.abs(along - Math.round(along)) < 1e-9, "window start is not a fitted beat");
});

test("a mapped grid too short to follow the window is refused rather than guessed", () => {
  // `applyManualCycleGrid` throws when the mapped grid runs out of following
  // beats. Discovering that as an exception mid-load would be a broken deck.
  const grid = cleanFit({ beatCount: 900 });
  assert.equal(kickGridApplyWindow(grid, libraryGrid(145.1, 40), 900 * (60 / 145)), null);
  assert.equal(kickGridApplyWindow(cleanFit({ beatCount: 20 }), libraryGrid(145.1, 900), 300), null);
  assert.equal(kickGridApplyWindow(grid, [], 372), null);
});

test("the booth applies the grid but only ever proposes the cue", () => {
  // DJ's rule picked the right chorus 13/13 both ways; the 32-beat phrase inside
  // it was right 4/13. So the grid lands and the cue is reported, and the drum
  // path must never reach for the cue-teaching endpoint to do it.
  const drumPath = boothSource.slice(
    boothSource.indexOf("const drumCueSummary"),
    boothSource.indexOf("const drumLoadedTrackIds"),
  );
  assert.ok(drumPath.length > 200, "the drum apply path should be findable in the booth");
  assert.doesNotMatch(drumPath, /fetch\(/, "the drum path must go through the drum module, not its own writes");
  assert.doesNotMatch(drumPath, /kind: "cue"/, "a proposed cue must never be taught");
  assert.match(drumPath, /proposed only, not placed/, "the booth should say the cue is a suggestion");
  // Both requests carry a live report of whether anything is playing: the server
  // refuses to separate, or to move a grid, on a stale claim of silence. They also
  // carry the deck's own duration, because every uploaded track is stored with
  // duration 0 and a cue proposer given no length proposes nothing at all.
  const carries = /\(trackId, !analysisPlaybackProtected, decksCurrent\.current\[id\]\.analysis\?\.duration \?\? 0\)/;
  assert.match(boothSource, new RegExp(`requestDrumAnalysis${carries.source}`));
  assert.match(boothSource, new RegExp(`applyDrumGrid${carries.source}`));
  // On unless switched off, unlike SECTIONS: loading a tune is meant to grid it,
  // so the switch stops that rather than starting it.
  assert.match(boothSource, /DRUM GRID ON/);
  assert.match(boothSource, /localStorage\.getItem\(DRUM_AUTO_ANALYSE_STORAGE_KEY\) !== "off"/);
  assert.match(boothSource, /const \[drumAutoAnalyse, setDrumAutoAnalyseEnabled\] = useState\(true\)/);
});

test("an auto-placed cue is stamped, and never lands on top of one of yours", () => {
  // Two safety properties, both load-bearing enough to pin in source.
  const route = readFileSync(new URL("../app/api/drum-analysis/route.ts", import.meta.url), "utf8");
  // 1. Provenance. 18 of 22 "taught" mix-outs once turned out to sit on the app's
  //    own mark, which made every feature learned from them circular. A cue the
  //    app placed must be distinguishable from one DJ placed, forever.
  assert.match(route, /source: "label-cue"/);
  // 2. A cue already on the tune is never touched. `preferredCue` is where a
  //    placed cue lives, so the check has to come before the write.
  assert.match(route, /if \(teaching\[field\]\) continue;/);
  // And the cues go on after the grid, because they are snapped to beats that
  // the grid application is about to move.
  const applyBody = route.slice(route.indexOf("async function applyKickGrid"), route.indexOf("async function applyCuesOnly"));
  assert.ok(
    applyBody.indexOf("applyManualCycleGrid") < applyBody.indexOf("placeLabelCues"),
    "cues must be placed after the grid moves, not before",
  );
});

test("a cue is never proposed early in the tune", () => {
  const period = 60 / 145;
  const beats = Array.from({ length: 1000 }, (_, index) => index * period);
  const duration = 1000 * period;
  const spans = [
    { start: 0, end: duration * .2, label: "chorus" },
    { start: duration * .2, end: duration, label: "verse" },
  ];
  // The only chorus ending is 20% in, which the positional gate exists to refuse:
  // early handoffs were wrong by 321-498 beats every time.
  assert.equal(proposeLabelCues(spans, beats, duration, "mix-out"), null);
});

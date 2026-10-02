import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CUE_GRID_TOLERANCE,
  CUE_TRUST_TRACK_FRACTION,
  gridDisagreement,
  mixOutWithheldReason,
  predictedEntryCue,
  predictedMixOutCue,
  predictedMixWindow,
} from "../lib/cue-prediction.ts";

const pairs = JSON.parse(await readFile(new URL("./fixtures/dj-mix-windows.json", import.meta.url), "utf8"));
const moduleSource = await readFile(new URL("../lib/cue-prediction.ts", import.meta.url), "utf8");
const beatsOf = (bpm) => 60 / bpm;
/** Windows whose own tempo agrees with the scan; the rest are marking errors. */
const sound = pairs.filter((p) => {
  for (const side of ["outgoing", "incoming"]) {
    const s = p[side];
    if (!Number.isFinite(s.markStart) || !Number.isFinite(s.markEnd)) return false;
    const check = gridDisagreement({ windowSeconds: s.markEnd - s.markStart, declaredBeats: p.beats, scannedBpm: s.bpm });
    if (!check || check.disagrees) return false;
  }
  return true;
});

test("the ground truth is real, and no prediction has seen its own answer", () => {
  assert.ok(pairs.length >= 13, `expected the recorded mixes, got ${pairs.length}`);
  for (const p of pairs) {
    for (const side of ["outgoing", "incoming"]) {
      assert.ok(new Date(p[side].scannedAt) < new Date(p.savedAt),
        `${p[side].name} was scanned after it was marked — that prediction saw the answer`);
    }
  }
});

test("the entry drop lands on an edge of the incoming window, every time", () => {
  // Two acceptable targets among roughly forty phrase positions per tune. A
  // clean sweep here is the single result the whole feature rests on.
  let offered = 0, onAnEdge = 0;
  for (const p of sound) {
    const cue = predictedEntryCue(p.incoming);
    if (!cue) continue;
    offered++;
    const bs = beatsOf(p.incoming.bpm);
    const toStart = Math.abs(cue.time - p.incoming.markStart) / bs;
    const toEnd = Math.abs(cue.time - p.incoming.markEnd) / bs;
    if (Math.min(toStart, toEnd) <= 2) onAnEdge++;
  }
  assert.equal(offered, sound.length, `the drop should be offered on every sound mix, got ${offered} of ${sound.length}`);
  assert.ok(offered >= 9, `expected at least the nine recorded sound mixes, offered on ${offered}`);
  assert.equal(onAnEdge, offered, `entry drop missed a window edge on ${offered - onAnEdge} of ${offered} mixes`);
});

test("the mix-out is exact whenever it is offered, and withheld otherwise", () => {
  let offered = 0, exact = 0, withheld = 0;
  for (const p of sound) {
    const cue = predictedMixOutCue(p.outgoing);
    if (!cue) {
      withheld++;
      // Silence must always carry a reason; an unexplained blank reads as a bug.
      assert.ok(mixOutWithheldReason(p.outgoing), `${p.outgoing.name} withheld with no reason given`);
      continue;
    }
    offered++;
    if (Math.abs(cue.time - p.outgoing.markEnd) / beatsOf(p.outgoing.bpm) <= 2) exact++;
  }
  assert.ok(offered > 0, "the mix-out should still be offered on the late-handoff mixes");
  assert.equal(exact, offered, `mix-out was offered and wrong on ${offered - exact} of ${offered} mixes`);
  assert.ok(withheld > 0, "the early-handoff mixes should be withheld, not guessed");
});

test("withholding is what makes the mix-out trustworthy, not luck", () => {
  // Believing every handoff — the behaviour before this module — is wrong more
  // often than it is right. The gate is doing the work, so prove it.
  let ungatedExact = 0, ungatedTotal = 0;
  for (const p of sound) {
    if (!Number.isFinite(p.outgoing.exitHandoff)) continue;
    ungatedTotal++;
    if (Math.abs(p.outgoing.exitHandoff - p.outgoing.markEnd) / beatsOf(p.outgoing.bpm) <= 2) ungatedExact++;
  }
  assert.ok(ungatedExact < ungatedTotal, "the ungated handoff should not be right everywhere, or the gate is pointless");
  assert.ok(ungatedExact / ungatedTotal < .7, `ungated precision ${(ungatedExact / ungatedTotal * 100).toFixed(0)}% — too high for the gate to be earning its keep`);
});

test("a proposed window reproduces the DJ's own coordinates", () => {
  // Given only the tunes and a phrase count, both sides should land where the
  // DJ put them — on the mixes where the scan offered both cues.
  let complete = 0, matched = 0;
  for (const p of sound) {
    const dropClosesWindow = Math.abs(p.incoming.entryDrop - p.incoming.markEnd) < Math.abs(p.incoming.entryDrop - p.incoming.markStart);
    const w = predictedMixWindow({
      outgoing: p.outgoing,
      incoming: p.incoming,
      beats: p.beats,
      placement: dropClosesWindow ? "drop-closes" : "drop-opens",
    });
    if (!w.complete) continue;
    complete++;
    const near = (predicted, actual, bpm) => Math.abs(predicted - actual) / beatsOf(bpm) <= 2;
    if (near(w.outgoingStart, p.outgoing.markStart, p.outgoing.bpm)
      && near(w.outgoingEnd, p.outgoing.markEnd, p.outgoing.bpm)
      && near(w.incomingStart, p.incoming.markStart, p.incoming.bpm)
      && near(w.incomingEnd, p.incoming.markEnd, p.incoming.bpm)) matched++;
  }
  assert.ok(complete > 0, "some mixes should get a complete four-coordinate proposal");
  assert.equal(matched, complete, `${complete - matched} complete proposals did not reproduce the DJ's window`);
});

test("a partial proposal stays partial rather than inventing the missing half", () => {
  const incomingOnly = predictedMixWindow({
    outgoing: { duration: 400, bpm: 145, exitHandoff: 120 },
    incoming: { duration: 400, bpm: 145, entryDrop: 90 },
    beats: 64,
  });
  // The handoff at 30% of the tune is in the region that was always wrong.
  assert.equal(incomingOnly.outgoingStart, null);
  assert.equal(incomingOnly.outgoingEnd, null);
  assert.equal(incomingOnly.complete, false);
  assert.ok(incomingOnly.incomingStart !== null, "the incoming side should still be proposed");
  assert.match(incomingOnly.notes.join(" "), /too early to trust/);
  // And a window that would not fit inside the tune is refused, not clamped.
  const overrun = predictedMixWindow({
    outgoing: { duration: 400, bpm: 145, exitHandoff: 380 },
    incoming: { duration: 400, bpm: 145, entryDrop: 4 },
    beats: 96,
  });
  assert.equal(overrun.incomingStart, null);
  assert.match(overrun.notes.join(" "), /runs past the end of the tune/);
});

test("both placements are constructible, and neither is presented as certain", () => {
  const scan = { duration: 400, bpm: 150, entryDrop: 100, exitHandoff: 350 };
  const closes = predictedMixWindow({ outgoing: scan, incoming: scan, beats: 64, placement: "drop-closes" });
  const opens = predictedMixWindow({ outgoing: scan, incoming: scan, beats: 64, placement: "drop-opens" });
  assert.equal(closes.incomingEnd, 100);
  assert.equal(opens.incomingStart, 100);
  assert.equal(closes.incomingStart, 100 - 64 * 60 / 150);
  assert.equal(opens.incomingEnd, 100 + 64 * 60 / 150);
  // The DJ uses both and nothing measured separates them, so the module must
  // not quietly bake one in as the answer.
  assert.notEqual(closes.incomingStart, opens.incomingStart);
});

test("the grid check flags every window that drifted, and no window that did not", () => {
  let flagged = 0;
  for (const p of pairs) {
    for (const side of ["outgoing", "incoming"]) {
      const s = p[side];
      if (!Number.isFinite(s.markStart) || !Number.isFinite(s.markEnd)) continue;
      const check = gridDisagreement({ windowSeconds: s.markEnd - s.markStart, declaredBeats: p.beats, scannedBpm: s.bpm });
      if (check?.disagrees) {
        flagged++;
        assert.ok(check.message.includes("holds"), "a flag must say how many beats the span really holds");
      }
    }
  }
  assert.ok(flagged >= 3, `expected the known-broken windows to be caught, flagged ${flagged}`);
  assert.ok(flagged <= 6, `flagged ${flagged} windows — too many to be only the broken ones`);
});

test("the grid check is arithmetic, with room for an honest hand", () => {
  assert.equal(CUE_GRID_TOLERANCE, .005);
  // A window one beat long in 96 is a real error and must be caught; a fifth of
  // a beat is a steady hand and must not be.
  const at = (seconds) => gridDisagreement({ windowSeconds: seconds, declaredBeats: 96, scannedBpm: 145 });
  const exact = 96 * 60 / 145;
  assert.equal(at(exact).disagrees, false);
  assert.equal(at(exact + .2 * 60 / 145).disagrees, false);
  assert.equal(at(exact + 60 / 145).disagrees, true);
  assert.equal(at(exact / 2).disagrees, true, "a half-length window is the doubled-beat-count error");
  // Nonsense in, nothing out — never a false accusation.
  assert.equal(gridDisagreement({ windowSeconds: 0, declaredBeats: 96, scannedBpm: 145 }), null);
  assert.equal(gridDisagreement({ windowSeconds: 40, declaredBeats: 96, scannedBpm: 0 }), null);
  assert.equal(gridDisagreement({ windowSeconds: 40, declaredBeats: Number.NaN, scannedBpm: 145 }), null);
});

test("the trust fraction is recorded as fitted, not as a law", () => {
  assert.equal(CUE_TRUST_TRACK_FRACTION, .7);
  // The threshold was chosen after seeing which predictions were right. That
  // has to stay written down next to it, or it reads as a measured constant.
  assert.match(moduleSource, /fitted on thirteen mixes by one DJ in one genre/);
  assert.match(moduleSource, /choosing the threshold after seeing which predictions were right/);
  // And the things that failed must stay recorded so they are not retried.
  assert.match(moduleSource, /both scored worse than leaving it alone/);
});

test("the booth draws the prediction and never acts on it", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  const cueBuilder = booth.match(/const transitionPreviewCues = \(role: TransitionPreviewRole\): Cue\[\] => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(cueBuilder, "the preview cue builder should be readable");
  // Drawn through the same gate the hit rates were measured with, so the
  // outgoing cue stays hidden on the tunes where it was always wrong.
  assert.match(cueBuilder, /outgoing \? predictedMixOutCue\(scan\) : predictedEntryCue\(scan\)/);
  assert.match(cueBuilder, /label: outgoing \? "PREDICTED MIX OUT" : "PREDICTED DROP"/);
  // A suggestion, in the neutral colour — not one of the marked-window colours.
  assert.match(cueBuilder, /colour: "#8fa3ad"/);
  assert.match(cueBuilder, /Nothing moves unless you mark it/);
  // It must never write a window. The whole point is that the DJ's mark is the
  // grid; a prediction that silently placed one would take that away.
  assert.doesNotMatch(cueBuilder, /setTransitionPreview|outgoingWindow:|incomingWindow:/);
  // Computed once per pair rather than on every render of the cue list.
  assert.match(booth, /const transitionPreviewScan = useMemo\(/);
  // The grid check reports, and is wired to the marked window readout.
  assert.match(booth, /const check = gridDisagreement\(\{/);
  assert.match(booth, /if \(!check\?\.disagrees\) return null;/);
  assert.match(booth, /\{transitionPreviewGridNotice\(role\)\}/);
  // It states a disagreement; it does not move a mark or block the save.
  const notice = booth.match(/const transitionPreviewGridNotice = \(role: TransitionPreviewRole\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  // Assignment, not comparison — `window.start ===` is how it reads the mark.
  assert.doesNotMatch(notice, /setTransitionPreview|window\.(start|end) =(?!=)/);
});

// A second corpus, four times the size of the marked windows and gathered two
// weeks earlier in a different workflow: cues the DJ taught by hand. Every one
// of these was taught AFTER its track was scanned, so the prediction being
// scored could not have absorbed the answer — `findExitHandoff` injects a
// taught cue with a winning score, which would otherwise make this trivial.
const taught = JSON.parse(await readFile(new URL("./fixtures/dj-taught-cues.json", import.meta.url), "utf8"));
const wrapToPhrase = (beats, phrase = 32) => { const r = ((beats % phrase) + phrase) % phrase; return r > phrase / 2 ? r - phrase : r; };

test("no taught cue in the regression corpus was visible to the prediction scoring it", () => {
  assert.ok(taught.length >= 57, `expected the taught corpus, got ${taught.length}`);
  for (const c of taught) {
    assert.ok(new Date(c.scannedAt) < new Date(c.taughtAt),
      `${c.name} was taught before it was scanned — that prediction saw the answer`);
  }
});

test("on independent taught cues the mix-out gate still earns its keep", () => {
  const rows = taught.filter((c) => c.role === "mix-out");
  let ungated = 0, offered = 0, gatedExact = 0;
  for (const c of rows) {
    const bs = beatsOf(c.bpm);
    if (Math.abs(c.exitHandoff - c.taughtTime) / bs <= 2) ungated++;
    const cue = predictedMixOutCue(c);
    if (!cue) continue;
    offered++;
    if (Math.abs(cue.time - c.taughtTime) / bs <= 2) gatedExact++;
  }
  // Measured: 22/29 believing every handoff, 21/22 once gated. The gate is the
  // whole feature, so it must stay meaningfully better than not gating.
  const ungatedRate = ungated / rows.length, gatedRate = gatedExact / offered;
  assert.ok(offered >= 20, `the gate should still offer a cue on most of the corpus, offered ${offered}/${rows.length}`);
  assert.ok(gatedRate > ungatedRate, `gating (${(gatedRate * 100).toFixed(0)}%) must beat not gating (${(ungatedRate * 100).toFixed(0)}%)`);
  assert.ok(gatedRate >= .9, `gated precision fell to ${(gatedRate * 100).toFixed(0)}% — it was 95% when measured`);
  // Not 100%. Claiming so on the nine marked windows was the sample talking.
  assert.ok(gatedRate <= 1, "precision cannot exceed 1");
});

test("the entry drop is phrase-locked to every taught cue, exact on three quarters", () => {
  const rows = taught.filter((c) => c.role === "mix-in");
  let exact = 0, phraseAligned = 0;
  for (const c of rows) {
    const cue = predictedEntryCue(c);
    assert.ok(cue, `${c.name} produced no entry cue`);
    const beats = (cue.time - c.taughtTime) / beatsOf(c.bpm);
    if (Math.abs(beats) <= 2) exact++;
    if (Math.abs(wrapToPhrase(beats)) <= 2) phraseAligned++;
  }
  // The honest split: it lands on the DJ's exact phrase three times in four,
  // but it is on SOME 32-beat boundary every single time. Which phrase remains
  // the open problem, and this is the number that says so.
  assert.equal(phraseAligned, rows.length, `entry drop fell off the phrase grid on ${rows.length - phraseAligned} of ${rows.length}`);
  assert.ok(exact / rows.length >= .7, `exact rate fell to ${(exact / rows.length * 100).toFixed(0)}% — it was 75% when measured`);
  assert.ok(exact < rows.length, "a clean sweep here would mean the corpus is not independent after all");
});

test("the module reports the independently measured rates, not the flattering ones", () => {
  // The 10/10 and 5/5 came from nine windows the rule was derived from. The
  // numbers that belong in the docs are the ones from data it had not seen.
  assert.match(moduleSource, /95%/);
  assert.match(moduleSource, /75%/);
  assert.doesNotMatch(moduleSource, /every time it was offered/);
});

test("grid confidence is carried but deliberately not acted on", () => {
  // A gate on grid confidence was built, measured, and removed. Scored against
  // the DJ's own marks — independent evidence of a tune's real tempo — a 900
  // bar would have withheld 9 of 21 sound windows to catch 3 of 5 broken ones,
  // and those 5 are marking errors gridDisagreement already catches from
  // arithmetic. The field is bimodal and does not separate good from bad.
  const late = { duration: 400, bpm: 145, exitHandoff: 360, entryDrop: 80 };
  for (const gridConfidence of [1, .5, .1, 0, null, undefined]) {
    assert.equal(predictedMixOutCue({ ...late, gridConfidence })?.time, 360, `mix-out changed at confidence ${gridConfidence}`);
    assert.equal(predictedEntryCue({ ...late, gridConfidence })?.time, 80, `entry changed at confidence ${gridConfidence}`);
    assert.equal(predictedEntryCue({ ...late, gridConfidence })?.confidence, "measured");
  }
  // The value still flows through, so a better-calibrated rule can be tested
  // later without re-plumbing it.
  assert.match(moduleSource, /gridConfidence?: number | null;/);
  // And the reason it is unused stays written down, so it is not re-added.
  assert.match(moduleSource, /does not separate a sound grid/);
  assert.match(moduleSource, /9 of 21 sound windows/);
});

test("the booth passes the grid's own confidence into the prediction", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  // Read at the cue, not at the start of the tune: a piecewise grid can be
  // confident where the mix happens and vague elsewhere, or the reverse.
  assert.match(booth, /const confidenceAt = \(analysis: Analysis, time: number\) =>/);
  assert.match(booth, /analysis\.tempoSections\.find\(\(section\) => time >= section\.start && time < section\.end\)\?\.confidence/);
  assert.match(booth, /gridConfidence: confidenceAt\(transitionPreview\.outgoingAnalysis, plan\.tracks\[0\]\.exitHandoff\)/);
  assert.match(booth, /gridConfidence: confidenceAt\(transitionPreview\.incomingAnalysis, plan\.tracks\[1\]\.entryDrop\)/);
});

test("nothing learns from a taught cue until it has been kept by hand", async () => {
  const { keptCues, nextCueForReview, cueReviewProgress, cueReviewWindow } = await import("../lib/cue-review.ts");
  const items = [
    { id: "a", trackId: "t1", name: "A", role: "mix-in", time: 60, bpm: 145, duration: 400, taughtAt: "1" },
    { id: "b", trackId: "t2", name: "B", role: "mix-out", time: 300, bpm: 145, duration: 400, taughtAt: "2" },
    { id: "c", trackId: "t3", name: "C", role: "mix-in", time: 90, bpm: 145, duration: 400, taughtAt: "3" },
  ];
  // An unreviewed corpus trains nothing. That is the safe direction to fail in:
  // the whole point of the pass is that unexamined labels were being trusted.
  assert.deepEqual(keptCues(items, {}), []);
  const verdicts = { a: { verdict: "keep", decidedAt: "" }, b: { verdict: "drop", decidedAt: "" } };
  assert.deepEqual(keptCues(items, verdicts).map((i) => i.id), ["a"]);
  // A dropped cue is withheld, never deleted — the teaching row stays put.
  assert.equal(cueReviewProgress(items, verdicts).dropped, 1);
  assert.equal(cueReviewProgress(items, verdicts).undecided, 1);
  // Review resumes after the cue just decided rather than restarting.
  assert.equal(nextCueForReview(items, verdicts, "b")?.id, "c");
  // A skipped cue comes back round instead of being lost.
  const skipped = { ...verdicts, c: { verdict: "unsure", decidedAt: "" } };
  assert.equal(nextCueForReview(items, skipped, "c")?.id, "c");
  // The audition window never asks for a negative seek: a player answers that
  // by starting at zero, which makes a late cue look correct.
  const early = cueReviewWindow({ time: 2, bpm: 145, duration: 400 });
  assert.equal(early.start, 0);
  assert.ok(early.end > 2);
  const late = cueReviewWindow({ time: 399, bpm: 145, duration: 400 });
  assert.ok(late.end <= 400);
});

test("the grid check asks the ear about phase, which the cue review could not", async () => {
  const { gridCheckTicks, gridCheckWindow, gridCheckOutcome, nextGridCheck } = await import("../lib/grid-check.ts");
  const bpm = 145, beat = 60 / bpm;
  const beats = Array.from({ length: 900 }, (_, i) => 1.3 + i * beat);
  const item = { trackId: "t", name: "T", bpm, duration: 400, suspectedOffsetMs: 90, beats };
  // Never the intro: a tune that opens with no drums gives the ear nothing to
  // compare the tick against, so every track would sound clean.
  const w = gridCheckWindow(item);
  assert.ok(w.start >= 400 * .35, "audition should start inside the body of the tune");
  // The window snaps to a grid beat, so the first tick is not itself offset.
  assert.ok(beats.includes(w.start));
  // Ticks come from the stored grid rather than a fresh guess, or the check
  // would be testing something other than the grid in question.
  const ticks = gridCheckTicks(item);
  assert.ok(ticks.length >= 30 && ticks.length <= 34, `expected ~32 ticks, got ${ticks.length}`);
  for (const t of ticks) assert.ok(beats.includes(t));
  // The outcome is a comparison, not a verdict: the question is whether the
  // tracks the metric is most sure about actually sound wrong.
  const flagged = [item, { ...item, trackId: "u" }, { ...item, trackId: "v" }, { ...item, trackId: "w" }];
  const quiet = { ...item, trackId: "q", suspectedOffsetMs: 3 };
  const clean = Object.fromEntries(flagged.map((f) => [f.trackId, { verdict: "clean", decidedAt: "" }]));
  const outcome = gridCheckOutcome([...flagged, quiet], clean);
  assert.equal(outcome.suspectClean, 4);
  assert.equal(outcome.suspectFlam, 0);
  assert.equal(outcome.metricLooksWrong, true, "four flagged grids sounding clean should discredit the metric");
  // One flam is enough to stop that conclusion: the metric would be finding
  // something real, even if not everywhere.
  const mixed = { ...clean, w: { verdict: "flam", decidedAt: "" } };
  assert.equal(gridCheckOutcome([...flagged, quiet], mixed).metricLooksWrong, false);
  // And it resumes rather than restarting.
  assert.equal(nextGridCheck(flagged, { t: { verdict: "clean", decidedAt: "" } }, "t")?.trackId, "u");
});

test("the proposed grid is scored as a whole phase, not a nearest neighbour", async () => {
  const { gridOffsetEvidence } = await import("../lib/grid-offset.ts");
  const period = 60 / 145;
  const beats = Array.from({ length: 32 }, (_, i) => i * period);
  // A tune whose kick sits 60ms after every grid line. Nearest-neighbour would
  // work here too, but the phase score has to find it as well.
  const clean = beats.map((t) => ({ time: t + .06, strength: 1 }));
  const found = gridOffsetEvidence(clean, beats, period);
  assert.ok(found, "a clean offset should be measurable");
  assert.ok(Math.abs(found.shiftMs - 60) <= 4, `expected ~+60ms, got ${found.shiftMs.toFixed(1)}`);
  assert.equal(found.confident, true);

  // The case that broke three detectors: a rolling offbeat bassline puts a sub
  // hit on either side of every grid line, so "nearest" picks whichever family
  // happens to be closer and the answer swings wildly. Here both families are
  // equally strong, and the honest output is that the evidence is split.
  const rolling = beats.flatMap((t) => [
    { time: t - .085, strength: 1 },
    { time: t + .15, strength: 1 },
  ]);
  const split = gridOffsetEvidence(rolling, beats, period);
  assert.ok(split, "a syncopated tune should still return evidence");
  assert.equal(split.confident, false, "two equally good phases must not be presented as an answer");
  assert.ok(split.rivalShiftMs !== null, "the rival phase should be reported");
  // Whichever it prefers, it must be one of the two real families, not a
  // split-the-difference average that matches nothing in the music.
  const nearFamily = Math.min(Math.abs(split.shiftMs + 85), Math.abs(split.shiftMs - 150));
  assert.ok(nearFamily <= 12, `winner ${split.shiftMs.toFixed(0)}ms is not one of the real phases`);

  // A grid already on the kick should not be moved.
  const onGrid = beats.map((t) => ({ time: t, strength: 1 }));
  const still = gridOffsetEvidence(onGrid, beats, period);
  assert.ok(Math.abs(still.shiftMs) <= 4, `a correct grid should stay put, got ${still.shiftMs.toFixed(1)}ms`);
  assert.equal(gridOffsetEvidence([], beats, period), null);
});

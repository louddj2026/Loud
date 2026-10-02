/**
 * A cue proposed from All-In-One's section labels, snapped to a kick-fitted grid.
 *
 * The division of labour, and its limits, both measured:
 *
 *  - The labels give a REGION, not a point. 19 of 21 of DJ's mix-outs leave a
 *    `chorus` — but 48% of all boundaries leave a chorus, so the veto admits about
 *    five candidates per track. His own mark was within 2 beats of an admitted
 *    candidate 9 times in 13: the set is right, the choice is not solved. Nothing
 *    tested could rank within it — dip depth scored 2/13 against 1.9/13 by chance,
 *    and "take the latest" scored 4/13.
 *  - All-In-One's own boundary times are useless as cue points. Its segments are
 *    uniformly 32 beats and its downbeats sit ~29 ms off a grid that passed a
 *    listening test, so the label says roughly where and the grid says exactly.
 *
 * So this returns a candidate SET with the best guess first, each snapped to the
 * nearest grid beat, and it says how many candidates it had to choose from. A
 * single confident number would be a lie about a one-in-five guess.
 */
import { KICK_MATCH_TOLERANCE_SECONDS } from "./kick-grid.ts";
import type { SectionSpan } from "./section-patterns.ts";

/** Where in the tune a mix-out can be trusted at all — the predictor's own gate. */
const TRUST_FRACTION = 0.7;
/** What DJ's mix-outs leave, measured on 83 label sets. */
const LEAVES = new Set(["chorus", "inst"]);
/**
 * How many phrases either side of the chosen chorus to offer.
 *
 * Measured against DJ's 13 marked windows: his rule picks the right chorus every
 * time — the entry is in the first half of the chorus list 13/13, the exit in the
 * last third 13/13 — but the label's boundary TIME is off by whole phrases, because
 * All-In-One's segments are uniformly 32 beats and it cannot place a boundary
 * inside one. The observed misses are almost all multiples of 32, mostly one or two
 * phrases, so the neighbours are offered rather than pretending to a precision the
 * label does not have.
 */
const PHRASE_BEATS = 32;
const PHRASES_EITHER_SIDE = 2;

export type LabelCueCandidate = {
  /** On a detected kick where there is one, otherwise on the beat. In seconds. */
  time: number;
  /** The label of the section this leaves. */
  leaves: string;
  /** How far the snap moved it, in ms — large means label and grid disagree. */
  snappedByMs: number;
  /** True when a detected kick sits under this cue, false in a drum gap. */
  onKick: boolean;
  /** Position in the tune, 0..1. */
  position: number;
  /** Phrases from the label's own boundary: 0 is the label, ±1 is 32 beats away. */
  phraseOffset: number;
};

export type LabelCueProposal = {
  candidates: LabelCueCandidate[];
  /** Honest statement of how much choosing is left to do. */
  because: string;
};

/**
 * Band envelopes for the entry's simplicity veto, any fixed rate spanning the
 * whole tune — the arrays' own length against the duration is the clock.
 */
export type EntryActivity = {
  /** The bassline's band, e.g. the analysis record's bassLowWaveformDetailed. */
  bass: readonly number[];
  /** Everything that fights an overlap: full band minus low band. */
  busy: readonly number[];
};

function nearestBeat(beats: readonly number[], time: number) {
  if (!beats.length) return null;
  let best = 0;
  for (let index = 1; index < beats.length; index += 1) {
    if (Math.abs(beats[index] - time) < Math.abs(beats[best] - time)) best = index;
  }
  return beats[best];
}

/**
 * Put the cue on the kick, not merely on the beat above it.
 *
 * DJ's rule, and it is stricter than snapping to a grid: no cue partway through a
 * kick. A grid beat is a prediction of where a kick is; the detected kick is where
 * one actually was, ear-verified as "spot on" across 17 tunes. Where the two
 * disagree by a few milliseconds the kick is right, and a cue dropped on the beat
 * instead would start the tune fractionally before or after the drum it is meant
 * to land with.
 *
 * The window is the fit's own `KICK_MATCH_TOLERANCE_SECONDS` — the same 35 ms that
 * decides whether a kick "lands on" a beat — so a cue and the grid can never
 * disagree about which kick is under a given beat. A beat with no kick inside that
 * window keeps the beat: a cue in a drum gap is still on the grid, and inventing a
 * kick there would be worse than admitting there is none.
 */
function snapToKick(beat: number, kicks: readonly number[]) {
  const kick = nearestBeat(kicks, beat);
  if (kick === null || Math.abs(kick - beat) > KICK_MATCH_TOLERANCE_SECONDS) return { time: beat, onKick: false };
  return { time: kick, onKick: true };
}

/**
 * @param spans    Section labels, merged, in order.
 * @param beats    A kick-fitted grid's beat times.
 * @param duration Track duration in seconds.
 * @param kicks    The detected kicks, so the cue lands on one rather than beside it.
 */
export function proposeLabelCues(
  spans: readonly SectionSpan[],
  beats: readonly number[],
  duration: number,
  role: "mix-out" | "mix-in" = "mix-out",
  kicks: readonly number[] = [],
  activity: EntryActivity | null = null,
): LabelCueProposal | null {
  if (!spans.length || !beats.length || !(duration > 0)) return null;

  const period = beats.length > 1 ? (beats.at(-1)! - beats[0]) / (beats.length - 1) : 0;
  if (!(period > 0)) return null;

  /**
   * DJ's rules. The EXIT is an early-chorus/late-chorus judgment, measured
   * 13/13 on his marked windows. The ENTRY is not a chorus judgment at all —
   * "groove entry usually", his words, 16 Aug 2026: the first section
   * boundary after the intro, where the full groove lands.
   *
   * Two Duck And Cover rips settled why the entry cannot lean on label
   * classes: All-In-One called the same tune's opening sections "chorus" on
   * one rip and "verse/solo" on the other, and the first-chorus rule placed
   * one entry at 81.7 s and the other at 372 s — the back of the tune. The
   * boundary POSITIONS were fine both times; only the class names moved. So
   * the entry takes the first boundary after the intro, of any class, and
   * where a kick map exists it must vouch for the groove: a boundary with no
   * kick inside 1.5 beats is a breakdown, not an entry, and the next boundary
   * is asked instead. Entries also stay in the first half of the tune — the
   * one part of the 13/13 measurement that was about position, not labels.
   */
  /**
   * "You want the mix in not to be too busy, because it's overlapping with
   * the other tune, so simple sections (but with bassline) are good." (DJ,
   * 16 Aug 2026.) Measured at every candidate boundary of his two live picks:
   * approved entries read bass ≈ 0.65 and busy ≈ 0.02 of the tune's own 90th
   * percentile; the sections he would never enter on read bass ≤ 0.17 or
   * busy ≥ 0.79. The thresholds below sit in the middle of a 10x gap.
   */
  const windowSeconds = period * 16;
  const percentile = (values: readonly number[], share: number) => {
    const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length * share)] || 1e-9;
  };
  const meanAround = (values: readonly number[], start: number) => {
    const rate = values.length / duration;
    const slice = values.slice(Math.max(0, Math.floor(start * rate)), Math.floor((start + windowSeconds) * rate));
    return slice.length ? slice.reduce((sum, value) => sum + value, 0) / slice.length : 0;
  };
  // .95, not .9: the reference must land inside the tune's LOUD material. A
  // tune that is quiet 90% of the time puts the 90th percentile on the quiet
  // floor, and a threshold cut from the floor vetoes everything.
  const bassReference = activity ? percentile(activity.bass, .95) : 1;
  const busyReference = activity ? percentile(activity.busy, .95) : 1;
  // Busy at .35: approved entries measured ~.02, rejected sections .54-1.23 —
  // a wide gap. Bass at .25, deliberately softer: Isis and Osiris's real
  // entry reads bass .30 (a thinner bassline is still a bassline), and every
  // section that truly lacked one ALSO failed the busy gate, so the bass gate
  // only needs to catch the outright bass-less, not adjudicate mix levels.
  const simpleWithBass = (start: number) => {
    if (!activity) return true;
    return meanAround(activity.bass, start) >= bassReference * .25
      && meanAround(activity.busy, start) <= busyReference * .35;
  };

  const grooveWalk = (useVeto: boolean, periodic: boolean) => {
    const openers = new Set(["start", "intro"]);
    for (const span of spans) {
      if (openers.has(span.label)) continue;
      // A boundary at the very top of the file is the file starting, not a
      // section changing. All-In-One emits zero-length spans — Wicked Plastic
      // came back "intro@0.0 verse@0.0", so the walk skipped the intro, took
      // the verse AT TIME ZERO, and placed a mix-in 3 s into the tune.
      //
      // Floor deliberately set well below anything DJ does rather than at
      // the phrase he usually waits for: his earliest entry of 45 measured is
      // 6.5 s (median 7.9 phrases in), so 5 s cannot reject a choice of his.
      // A full-phrase minimum WAS tried and overreached — it moved Last Nite
      // from a defensible 13.1 s to 109.7 s because its intro ends a hair
      // under one phrase at that tempo. Fix the fault, not the neighbourhood.
      if (span.start < 5) continue;
      // "Could be second or third section — but not in the 2nd half of the
      // tune." (DJ, 16 Aug 2026.) The walk keeps asking later boundaries
      // until one carries a groove, and gives up at halfway.
      if (span.start / duration > 0.5) break;
      // The busy/bass veto: a boundary that opens full-blast, or without its
      // bassline, is no place to overlap the outgoing tune. Skip it and ask
      // the next boundary.
      if (useVeto && !simpleWithBass(span.start)) continue;
      if (!kicks.length) return span.start;
      // A groove is kicks ON THE BEAT, not merely kicks nearby. The Prayer
      // settled why counting is not enough: its chanted intro carries dense
      // tribal percussion that Demucs files under drums, 37 map hits in the
      // first 12 s at 0.19-0.42 s spacings — plenty to pass any count, but
      // only 5 of 8 beat slots land a hit. The real groove at 66.2 s scores
      // 8/8. So the strict vouch asks: of the next 8 beat slots, do at least
      // 7 carry a kick within 15% of the period? The lenient fallback (any 4
      // hits in 8 beats) remains for tunes whose maps are sparse but honest.
      const from = span.start - period * .25;
      const groove = periodic
        ? Array.from({ length: 8 }, (_, beat) => span.start + beat * period)
          .filter((slot) => kicks.some((k) => Math.abs(k - slot) <= period * .15)).length >= 7
        : kicks.filter((time) => time >= from && time <= span.start + period * 8).length >= 4;
      if (!groove) continue;
      const kick = kicks.find((time) => time >= from && time <= span.start + period * 1.5);
      if (kick !== undefined) return span.start;
    }
    return undefined;
  };
  const grooveEntry = () =>
    grooveWalk(true, true)
    // Each gate stands down rather than strand the entry: first the strict
    // periodicity (a sparse-but-honest map still deserves a groove entry),
    // then the busy/bass veto (miscalibrated bands must not push the entry
    // to the chorus fallback).
    ?? grooveWalk(true, false)
    ?? (activity ? grooveWalk(false, true) ?? grooveWalk(false, false) : undefined)
    // No qualifying boundary — fall back to the first chorus rather than
    // return nothing for a tune whose labels never leave the opener classes.
    ?? spans.filter((span) => span.label === "chorus").map((span) => span.start).sort((left, right) => left - right)[0];
  const anchor = role === "mix-in"
    ? grooveEntry()
    // The chorus ending, late enough to trust.
    : spans
      .filter((span, index) => index > 0 && LEAVES.has(spans[index - 1].label) && span.start / duration >= TRUST_FRACTION)
      .map((span) => span.start)
      .sort((left, right) => right - left)[0];
  if (anchor === undefined) return null;

  // The anchor plus its neighbouring phrases. The label names the chorus; which
  // phrase inside it is a separate question, and by DJ's own account it is decided
  // by what makes the exit land rather than by anything in the labels.
  const candidates: LabelCueCandidate[] = [];
  for (let step = -PHRASES_EITHER_SIDE; step <= PHRASES_EITHER_SIDE; step += 1) {
    const target = anchor + step * PHRASE_BEATS * period;
    if (target < 0 || target > duration) continue;
    // An entry is DJ's own recipe run forwards: the section shift says where
    // the phrase begins, and the FIRST KICK after it is the cue. Nearest-beat
    // was measurably wrong here — on The Twin Complex Of Dawn the boundary sat
    // at 52.990, the chorus's first kick at 53.040 and the nearest grid beat at
    // 53.079: the beat was 39 ms past the kick, outside snapToKick's 35 ms, so
    // the cue landed 39 ms inside the crack it was meant to start on. A
    // quarter-beat guard admits a kick fractionally before the label boundary
    // (All-In-One's own downbeats sit ~29 ms off the fitted grid); a kick more
    // than 1.5 beats late means the phrase opens in a drum gap, and the beat
    // fallback stays the honest place for a cue with no kick to sit on.
    // The entry is not merely the boundary's first kick — it is the first
    // kick WHERE THE BASS LANDS. Gaijinrocker measured why (16 Aug 2026):
    // the AIO boundary sat at 65.8, the first kick at 65.77, but the
    // bassline arrived two beats later and DJ's ear put the entry on the
    // kick at 66.63. All-In-One cannot place a boundary inside a phrase;
    // the fine bass envelope can. So within the 8 beats after the boundary,
    // find where sustained bass first reaches half the tune's own loud
    // reference, and take the first kick from there. No arrival found —
    // bass already going, or no band data — falls back to the boundary's
    // first kick, which is the previous behaviour.
    let entrySearchFrom = target - period * .25;
    if (role === "mix-in" && activity) {
      // A threshold cannot hear the drop: Gaijinrocker's bass sits at half
      // strength through the boundary and lands at full weight two beats
      // later, which is where DJ's ear put the entry. His own recipe names
      // the signal — a GAP then the bassline LANDING — so this looks for the
      // largest sustained upward STEP in the beat-averaged bass inside the 8
      // beats after the boundary: one beat of bass after each bin against
      // one beat before. A step only counts when it is substantial (a
      // quarter of the tune's loud reference) and lands at least a third
      // above what preceded it; otherwise the bass was already going and the
      // boundary's own first kick stands.
      const rate = activity.bass.length / duration;
      const beatBins = Math.max(1, Math.round(period * rate));
      const from = Math.max(beatBins, Math.floor((target - period * .25) * rate));
      const to = Math.min(activity.bass.length - beatBins, Math.floor((target + period * 8) * rate));
      let bestStep = 0;
      let bestBin = -1;
      for (let bin = from; bin <= to; bin += 1) {
        let before = 0, after = 0;
        for (let i = 0; i < beatBins; i += 1) { before += activity.bass[bin - beatBins + i]; after += activity.bass[bin + i]; }
        before /= beatBins; after /= beatBins;
        const step = after - before;
        if (step > bestStep && after >= before * (4 / 3)) { bestStep = step; bestBin = bin; }
      }
      if (bestBin >= 0 && bestStep >= bassReference * .25) {
        const arrival = bestBin / rate;
        if (arrival > entrySearchFrom) entrySearchFrom = arrival - period * .15;
      }
    }
    const firstKick = role === "mix-in"
      ? kicks.find((kick) => kick >= entrySearchFrom && kick <= entrySearchFrom + period * 1.75) ?? null
      : null;
    const snapped = firstKick ?? nearestBeat(beats, target);
    if (snapped === null) continue;
    // The beat locates the bar; the kick under it is where the cue goes.
    const placed = firstKick !== null ? { time: firstKick, onKick: true } : snapToKick(snapped, kicks);
    candidates.push({
      time: Math.round(placed.time * 1000) / 1000,
      leaves: role === "mix-in" ? "the groove lands" : "chorus ends",
      snappedByMs: Math.round((placed.time - target) * 1000),
      position: Math.round(target / duration * 1000) / 1000,
      phraseOffset: step,
      onKick: placed.onKick,
    });
  }
  if (!candidates.length) return null;

  // The label's own boundary first, then outward by phrase. That ordering is the
  // measurement: the right chorus every time, the right phrase only sometimes.
  candidates.sort((left, right) => Math.abs(left.phraseOffset) - Math.abs(right.phraseOffset) || left.phraseOffset - right.phraseOffset);

  return {
    candidates,
    because: role === "mix-in"
      ? "the groove entry — the first boundary after the intro with a kick under it — plus two phrases either side, because All-In-One places boundaries only every 32 beats"
      : "the last chorus ending late in the tune, on the grid — plus two phrases either side, because All-In-One places boundaries only every 32 beats",
  };
}

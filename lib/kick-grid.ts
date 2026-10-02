/**
 * A grid fitted to detected kicks, and required to explain them.
 *
 * The rule this serves, in DJ's words: extra kicks â€” stutters, rolls, the four
 * kicks that fill a bassline hole â€” must not affect the overall grid or BPM. So
 * the fit is deliberately a *consensus* rather than an average: it finds the tempo
 * and phase that the largest number of kicks agree on, and everything else becomes
 * an outlier with no vote. An average would let a bar of 16th-note kicks drag the
 * tempo; a consensus will not notice them.
 *
 * Two things it refuses to do, both learned the hard way:
 *
 *  - It does not re-derive tempo from the spacing of hits. A stutter section makes
 *    spacing imply the wrong tempo, which is how fitting a stem produced 96 BPM on
 *    a 144 BPM tune. Candidate tempos are scored by how many kicks they *land on*,
 *    which stutters cannot inflate.
 *  - It does not report a grid it cannot justify. Every result carries the share of
 *    kicks it explains, so a bad fit is visible instead of silently shipped. That
 *    is the "must fit the known drums" requirement made checkable.
 */

export type KickGrid = {
  bpm: number;
  /** Time of the first beat, in seconds. */
  firstBeat: number;
  beats: number[];
  /** Share of detected kicks that land on a beat, 0..1. This is the fit quality. */
  explains: number;
  /** Share of beats that have a kick on them. Low means a sparse or broken pattern. */
  covered: number;
  /** Median absolute distance from a matched kick to its beat, in ms. */
  medianErrorMs: number;
  /** Kicks that matched no beat â€” stutters, fills, ghost notes. */
  outliers: number;
};

/**
 * How close a kick has to be to a beat to count as landing on it.
 *
 * Exported because a cue asks the same question: a cue that belongs on a kick has
 * to know which kick the beat under it is, and answering that with a second,
 * separately chosen number would let the two disagree.
 */
export const KICK_MATCH_TOLERANCE_SECONDS = 0.035;
const TOLERANCE_SECONDS = KICK_MATCH_TOLERANCE_SECONDS;
/** The tempo range this genre lives in, and the step the search uses. */
const MIN_BPM = 118;
const MAX_BPM = 165;
const COARSE_STEP_BPM = 0.05;
/** Refinement either side of the coarse winner. */
const FINE_SPAN_BPM = 0.08;
const FINE_STEP_BPM = 0.002;
/** Enough for the phase correction to converge; measured at two or three. */
const PHASE_CENTRING_PASSES = 6;
/** Half a millisecond is under the storage resolution, so it has arrived. */
const PHASE_CENTRING_SETTLED_SECONDS = 0.0005;

function score(kicks: readonly number[], period: number, phase: number, tolerance: number) {
  let landed = 0;
  let error = 0;
  for (const kick of kicks) {
    const beats = (kick - phase) / period;
    const distance = Math.abs(beats - Math.round(beats)) * period;
    if (distance <= tolerance) {
      landed += 1;
      error += distance;
    }
  }
  return { landed, meanError: landed ? error / landed : Infinity };
}

/**
 * The phase that most kicks agree on, for a given tempo.
 *
 * Every kick proposes a phase â€” its own position modulo the beat period. The
 * winning phase is the one most kicks cluster around, which is a mode rather than
 * a mean: a handful of off-grid stutters cannot pull it.
 */
function bestPhase(kicks: readonly number[], period: number, tolerance: number) {
  let best = { phase: 0, landed: -1, meanError: Infinity };
  for (const candidate of kicks) {
    const phase = ((candidate % period) + period) % period;
    const result = score(kicks, period, phase, tolerance);
    if (result.landed > best.landed || (result.landed === best.landed && result.meanError < best.meanError)) {
      best = { phase, ...result };
    }
  }
  return best;
}

/**
 * @param kicks    Detected kick times in seconds, ascending.
 * @param duration Track duration in seconds, so the grid spans the whole tune.
 */
export function fitKickGrid(
  kicks: readonly number[],
  duration: number,
  { tolerance = TOLERANCE_SECONDS, minBpm = MIN_BPM, maxBpm = MAX_BPM }: { tolerance?: number; minBpm?: number; maxBpm?: number } = {},
): KickGrid | null {
  const usable = [...kicks].filter((time) => Number.isFinite(time) && time >= 0).sort((left, right) => left - right);
  if (usable.length < 16 || !(duration > 0)) return null;

  // Sampling the phase search over a subset keeps the coarse sweep affordable:
  // 940 tempo candidates against every kick as a phase candidate would be
  // millions of scores. The winner is refined against all of them below.
  const stride = Math.max(1, Math.floor(usable.length / 120));
  const phaseCandidates = usable.filter((_, index) => index % stride === 0);

  let best: { bpm: number; phase: number; landed: number; meanError: number } | null = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += COARSE_STEP_BPM) {
    const period = 60 / bpm;
    let local = { phase: 0, landed: -1, meanError: Infinity };
    for (const candidate of phaseCandidates) {
      const phase = ((candidate % period) + period) % period;
      const result = score(usable, period, phase, tolerance);
      if (result.landed > local.landed || (result.landed === local.landed && result.meanError < local.meanError)) {
        local = { phase, ...result };
      }
    }
    if (!best || local.landed > best.landed || (local.landed === best.landed && local.meanError < best.meanError)) {
      best = { bpm, ...local };
    }
  }
  if (!best) return null;

  // Refine tempo around the winner, now searching phase against every kick.
  let refined = { bpm: best.bpm, ...bestPhase(usable, 60 / best.bpm, tolerance) };
  for (let bpm = best.bpm - FINE_SPAN_BPM; bpm <= best.bpm + FINE_SPAN_BPM; bpm += FINE_STEP_BPM) {
    if (bpm < minBpm || bpm > maxBpm) continue;
    const candidate = { bpm, ...bestPhase(usable, 60 / bpm, tolerance) };
    if (candidate.landed > refined.landed || (candidate.landed === refined.landed && candidate.meanError < refined.meanError)) {
      refined = candidate;
    }
  }

  const period = 60 / refined.bpm;

  /**
   * Centre the phase on the kicks it matched.
   *
   * The search above picks the phase of whichever single kick lands the most
   * others, which is robust to outliers but is one kick's position rather than the
   * middle of the cluster â€” so the whole grid can sit a few milliseconds early or
   * late. DJ heard exactly that: "a slight but consistent delay". Consistent is
   * the tell that it is a constant, and this removes it.
   *
   * The median of the matched offsets, not the mean: a stutter that squeaks inside
   * the tolerance should not pull the correction.
   *
   * **And it repeats until it stops moving.** One pass was not enough and the
   * failure was invisible: the offsets it averages are only the kicks already
   * within `tolerance` of the beat, so when the starting phase is far enough out
   * the window clips the far side of the distribution and the median under-reports
   * the true offset. Measured over 51 fitted grids, one pass left 34 of them
   * biased by more than 3 ms and 24 by more than 8 ms, the worst at ±25 ms —
   * every kick consistently late or early, which is precisely what a flam is.
   * Two or three passes take every one of them to zero.
   */
  for (let pass = 0; pass < PHASE_CENTRING_PASSES; pass += 1) {
    const matchedOffsets: number[] = [];
    for (const kick of usable) {
      const beatsAlong = (kick - refined.phase) / period;
      const signed = (beatsAlong - Math.round(beatsAlong)) * period;
      if (Math.abs(signed) <= tolerance) matchedOffsets.push(signed);
    }
    if (matchedOffsets.length < 8) break;
    matchedOffsets.sort((left, right) => left - right);
    const shift = matchedOffsets[matchedOffsets.length >> 1];
    refined = { ...refined, phase: refined.phase + shift };
    if (Math.abs(shift) < PHASE_CENTRING_SETTLED_SECONDS) break;
  }

  /**
   * Then the phase LOCKS ONTO A KICK. DJ's rule, in his words: "it can't move
   * from where a kick is." The centring above decides which kick is the true
   * anchor — the one closest to the middle of the cluster — and then the grid is
   * moved that last millimetre so a beat sits exactly on that kick, not on the
   * cluster's average, which is a place where no drum was ever hit.
   */
  {
    let anchor: number | null = null;
    let nearest = Infinity;
    for (const kick of usable) {
      const beatsAlong = (kick - refined.phase) / period;
      const signed = (beatsAlong - Math.round(beatsAlong)) * period;
      if (Math.abs(signed) <= tolerance && Math.abs(signed) < Math.abs(nearest)) { nearest = signed; anchor = kick; }
    }
    if (anchor !== null) refined = { ...refined, phase: refined.phase + nearest };
  }

  // Start the grid at or before the first kick, on the corrected phase.
  const firstIndex = Math.floor((usable[0] - refined.phase) / period);
  const firstBeat = refined.phase + firstIndex * period;
  const beatCount = Math.max(1, Math.floor((duration - firstBeat) / period) + 1);
  const beats = Array.from({ length: beatCount }, (_, index) => Math.round((firstBeat + index * period) * 1000) / 1000);

  // Fit quality, both ways round. `explains` is the requirement â€” the grid has to
  // account for the drums that are actually there. `covered` says whether the
  // pattern is dense enough for that to mean much.
  const final = score(usable, period, refined.phase, tolerance);
  const occupied = new Set<number>();
  for (const kick of usable) {
    const beats = (kick - refined.phase) / period;
    if (Math.abs(beats - Math.round(beats)) * period <= tolerance) occupied.add(Math.round(beats));
  }
  const distances: number[] = [];
  for (const kick of usable) {
    const beatsAlong = (kick - refined.phase) / period;
    const distance = Math.abs(beatsAlong - Math.round(beatsAlong)) * period;
    if (distance <= tolerance) distances.push(distance * 1000);
  }
  distances.sort((left, right) => left - right);

  return {
    bpm: Math.round(refined.bpm * 1000) / 1000,
    firstBeat: Math.round(firstBeat * 1000) / 1000,
    beats,
    explains: Math.round(final.landed / usable.length * 1000) / 1000,
    covered: Math.round(occupied.size / beatCount * 1000) / 1000,
    medianErrorMs: distances.length ? Math.round(distances[distances.length >> 1] * 10) / 10 : 0,
    outliers: usable.length - final.landed,
  };
}


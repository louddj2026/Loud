/**
 * The kick map. DJ's spec, verbatim, 13 Aug 2026:
 *
 *   "make a kick map. every fucking kick in the tune except stutters etc. make
 *    sure the map perfectly matches the kicks in the beginning, middle, end.
 *    no approximations where there is a kick - only approximations in spaces
 *    with no kicks, and those approx are based on the kicks"
 *
 * So this is NOT a grid. A grid is one line of best fit — an approximation
 * everywhere, including on top of real drums. Here every beat that has a kick IS
 * that kick's exact detected time, to the millisecond, one for one. Only where
 * the drums stop does it approximate, and the fill is derived from the kicks
 * themselves: between two real kicks it divides their actual span evenly, and
 * past the ends it extends at the spacing of the nearest real kicks.
 *
 * Stutters, rolls and fills are excluded by the consensus skeleton: a kick only
 * becomes a map point if it lands within the tolerance of a skeleton beat, so a
 * bar of 16th-note kicks contributes its four on-beat kicks and nothing else.
 * The skeleton decides WHICH kicks are beats; it never decides WHERE they are.
 */
import { fitKickGrid, KICK_MATCH_TOLERANCE_SECONDS } from "./kick-grid.ts";

export type KickMapPoint = {
  /** Seconds. A real kick's exact time, or a fill derived from real kicks. */
  time: number;
  /** True when this point IS a detected kick, untouched. */
  exact: boolean;
};

export type KickMap = {
  points: KickMapPoint[];
  /** The skeleton tempo, for beatmatching readouts — never for point placement. */
  bpm: number;
  /** How many points are real kicks, verbatim. */
  exactCount: number;
  /** How many are fills in kickless space. */
  filledCount: number;
  /** Median |detected kick − skeleton beat| among matched kicks, for reporting. */
  skeletonMedianErrorMs: number;
};

/**
 * @param kicks    Detected kick times, seconds, from the drums stem.
 * @param duration Track length in seconds, so fills reach both ends of the tune.
 */
export function buildKickMap(
  kicks: readonly number[],
  duration: number,
  { tolerance = KICK_MATCH_TOLERANCE_SECONDS }: { tolerance?: number } = {},
): KickMap | null {
  const skeleton = fitKickGrid(kicks, duration, { tolerance });
  if (!skeleton) return null;
  const usable = [...kicks].filter((time) => Number.isFinite(time) && time >= 0).sort((left, right) => left - right);
  const period = 60 / skeleton.bpm;

  // Which real kick owns each skeleton beat. Nearest wins; a beat with no kick
  // inside the tolerance owns nothing and will be filled.
  const owners: Array<number | null> = skeleton.beats.map((beat) => {
    let best: number | null = null;
    for (const kick of usable) {
      if (kick < beat - tolerance) continue;
      if (kick > beat + tolerance) break;
      if (best === null || Math.abs(kick - beat) < Math.abs(best - beat)) best = kick;
    }
    return best;
  });

  // A kick may sit inside the tolerance of two beats only if the tempo were
  // absurd, but a kick must still never own two map points: keep its closest.
  for (let index = 1; index < owners.length; index += 1) {
    if (owners[index] !== null && owners[index] === owners[index - 1]) {
      const kick = owners[index]!;
      if (Math.abs(kick - skeleton.beats[index]) < Math.abs(kick - skeleton.beats[index - 1])) owners[index - 1] = null;
      else owners[index] = null;
    }
  }

  const matchedIndices = owners.map((owner, index) => owner !== null ? index : -1).filter((index) => index >= 0);
  if (matchedIndices.length < 8) return null;

  const points: KickMapPoint[] = new Array(owners.length);
  // 1. Every matched beat IS its kick. No rounding, no averaging, no movement.
  for (const index of matchedIndices) points[index] = { time: owners[index]!, exact: true };

  // 2. Fills between two real kicks: divide their actual span evenly by the
  //    number of beats between them. The spacing is the kicks' own, so a gap in
  //    a tune that runs a hair fast is filled a hair fast.
  for (let m = 0; m < matchedIndices.length - 1; m += 1) {
    const from = matchedIndices[m];
    const to = matchedIndices[m + 1];
    if (to - from < 2) continue;
    const span = (owners[to]! - owners[from]!) / (to - from);
    for (let index = from + 1; index < to; index += 1) {
      points[index] = { time: owners[from]! + (index - from) * span, exact: false };
    }
  }

  // 3. Fills past either end: extend at the spacing of the nearest real kicks —
  //    the last known good tempo, taken from the drums rather than the skeleton.
  const first = matchedIndices[0];
  const last = matchedIndices[matchedIndices.length - 1];
  const headSpan = matchedIndices.length > 1
    ? (owners[matchedIndices[1]]! - owners[first]!) / (matchedIndices[1] - first)
    : period;
  for (let index = first - 1; index >= 0; index -= 1) {
    points[index] = { time: owners[first]! - (first - index) * headSpan, exact: false };
  }
  const tailStart = matchedIndices[matchedIndices.length - 2] ?? first;
  const tailSpan = matchedIndices.length > 1
    ? (owners[last]! - owners[tailStart]!) / (last - tailStart)
    : period;
  for (let index = last + 1; index < points.length; index += 1) {
    points[index] = { time: owners[last]! + (index - last) * tailSpan, exact: false };
  }

  // The map must keep time to the end of the tune, not stop at the last kick.
  let tail = points[points.length - 1].time + tailSpan;
  while (tail <= duration) {
    points.push({ time: tail, exact: false });
    tail += tailSpan;
  }

  const kept = points.filter((point) => point.time >= 0 && point.time <= duration);
  const errors = matchedIndices
    .map((index) => Math.abs(owners[index]! - skeleton.beats[index]) * 1000)
    .sort((left, right) => left - right);
  return {
    points: kept,
    bpm: skeleton.bpm,
    exactCount: kept.filter((point) => point.exact).length,
    filledCount: kept.filter((point) => !point.exact).length,
    skeletonMedianErrorMs: errors.length ? Math.round(errors[errors.length >> 1] * 10) / 10 : 0,
  };
}

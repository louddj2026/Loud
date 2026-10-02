/**
 * Where the grid would sit if it followed the low end.
 *
 * Judging "is this grid off" by ear is hard; judging "is this better" is easy.
 * So the check offers a correction to listen to rather than a number to trust,
 * and the DJ decides by comparing the two.
 *
 * Finding the correction by looking for the nearest kick to each beat does not
 * work, and failing that way is what produced three different answers for the
 * same track earlier: on a tune with a rolling offbeat bassline the sub band
 * fires roughly every eighth note, so every grid line has a low-end hit on
 * either side of it and "nearest" picks whichever family happens to be closer.
 * One track measured 174 ms, then 132 ms, then 85 ms depending on the detector.
 *
 * Scoring a whole phase instead removes that choice. Every candidate shift is
 * scored by how much onset strength lands on the shifted grid across the entire
 * window, so the winner is the phase the track actually supports rather than
 * one beat's nearest neighbour. A syncopated tune with two credible phases will
 * still produce two peaks — and the honest response to that is to say the
 * evidence is split, not to pick one and present it as the answer.
 */

export type GridOffsetEvidence = {
  /** Milliseconds to add to every grid beat. Positive moves the grid later. */
  shiftMs: number;
  /** How much better the winning phase scores than the grid as it stands. */
  improvement: number;
  /** Second-best phase, when the track supports more than one reading. */
  rivalShiftMs: number | null;
  /** How clearly the winner beats its rival; near 1 means the track is ambiguous. */
  rivalRatio: number | null;
  confident: boolean;
};

/**
 * @param onsets  Times of low-end onsets, in seconds, with a strength each.
 * @param beats   Grid beat times, in seconds, covering the same span.
 * @param period  Seconds per beat; the search covers half a beat either way.
 */
export function gridOffsetEvidence(
  onsets: readonly { time: number; strength: number }[],
  beats: readonly number[],
  period: number,
): GridOffsetEvidence | null {
  if (!onsets.length || beats.length < 8 || !(period > 0)) return null;
  const reach = period / 2;
  const stepSeconds = .002;
  const tolerance = .022;
  const scores: Array<{ shift: number; score: number }> = [];
  for (let shift = -reach; shift <= reach; shift += stepSeconds) {
    let score = 0;
    for (const beat of beats) {
      const target = beat + shift;
      // Only the best-supported onset near this beat counts, so a dense patch
      // of low end cannot outvote a steady pulse elsewhere in the window.
      let best = 0;
      for (const onset of onsets) {
        const distance = Math.abs(onset.time - target);
        if (distance > tolerance) continue;
        const weight = 1 - distance / tolerance;
        if (onset.strength * weight > best) best = onset.strength * weight;
      }
      score += best;
    }
    scores.push({ shift, score });
  }
  if (!scores.length) return null;
  const ranked = [...scores].sort((left, right) => right.score - left.score);
  const winner = ranked[0];
  if (winner.score <= 0) return null;
  // The runner-up only counts as a rival if it is a genuinely separate phase,
  // not a neighbouring step of the same peak.
  const rival = ranked.find((entry) => Math.abs(entry.shift - winner.shift) > period * .12) ?? null;
  const current = scores.reduce((best, entry) => Math.abs(entry.shift) < Math.abs(best.shift) ? entry : best, scores[0]);
  const rivalRatio = rival && winner.score > 0 ? rival.score / winner.score : null;
  return {
    shiftMs: winner.shift * 1000,
    improvement: current.score > 0 ? winner.score / current.score : Infinity,
    rivalShiftMs: rival ? rival.shift * 1000 : null,
    rivalRatio,
    // A shift worth offering has to beat the existing grid clearly and beat its
    // nearest alternative clearly. Anything less is a coin toss dressed up as a
    // measurement, and the DJ's window is the authority in that case.
    confident: (current.score > 0 ? winner.score / current.score : Infinity) >= 1.25 && (rivalRatio === null || rivalRatio <= .8),
  };
}

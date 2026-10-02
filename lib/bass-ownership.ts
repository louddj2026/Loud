/**
 * Which tune owns the bass, beat by beat, across a confirmed overlap.
 *
 * The overlap used to carry a single bass-swap beat: outgoing holds the low end
 * until that beat, incoming holds it afterwards. A DJ playing a long overlap
 * wants to cut back and forth — take the incoming bass for a phrase, hand it
 * back, take it again — so ownership is a list of swap beats rather than one.
 *
 * The outgoing tune always owns the bass at beat 0: at the start of an overlap
 * it is the tune the room is already hearing. Every swap beat after that flips
 * ownership, so a single-element list behaves exactly like the old single cue.
 */

export type BassOwner = "outgoing" | "incoming";

export type BassOwnershipSegment = {
  /** First beat of this segment, inclusive. */
  startBeat: number;
  /** End of this segment, exclusive — the next swap, or the window end. */
  endBeat: number;
  owner: BassOwner;
};

/** Whole beats inside the window, ascending, no duplicates, beat 0 excluded. */
export function normaliseBassSwapBeats(swapBeats: readonly number[] | undefined, windowBeats: number) {
  if (!Array.isArray(swapBeats) || !Number.isFinite(windowBeats) || windowBeats <= 0) return [];
  const seen = new Set<number>();
  for (const value of swapBeats) {
    const beat = Math.round(Number(value));
    // Beat 0 cannot be a swap: the outgoing tune owns the bass by definition
    // when the overlap opens, and a swap at the very end would never fire.
    if (!Number.isFinite(beat) || beat <= 0 || beat >= windowBeats) continue;
    seen.add(beat);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Ownership at a beat. Ties resolve to the incoming side: a swap AT beat n means n is already the new owner's. */
export function bassOwnerAtBeat(swapBeats: readonly number[], windowBeats: number, beat: number): BassOwner {
  const swaps = normaliseBassSwapBeats(swapBeats, windowBeats);
  let flips = 0;
  for (const swap of swaps) {
    if (beat >= swap) flips += 1; else break;
  }
  return flips % 2 === 0 ? "outgoing" : "incoming";
}

/** The contiguous runs of ownership, for painting the window. */
export function bassOwnershipSegments(swapBeats: readonly number[], windowBeats: number): BassOwnershipSegment[] {
  if (!Number.isFinite(windowBeats) || windowBeats <= 0) return [];
  const swaps = normaliseBassSwapBeats(swapBeats, windowBeats);
  const edges = [0, ...swaps, windowBeats];
  const segments: BassOwnershipSegment[] = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    segments.push({
      startBeat: edges[index],
      endBeat: edges[index + 1],
      owner: index % 2 === 0 ? "outgoing" : "incoming",
    });
  }
  return segments;
}

/**
 * Clicking a beat flips ownership from there on. Clicking a beat that is
 * already a swap removes it, so the same control adds and undoes a cut.
 */
export function toggleBassSwapBeat(swapBeats: readonly number[], windowBeats: number, beat: number) {
  const swaps = normaliseBassSwapBeats(swapBeats, windowBeats);
  const target = Math.round(beat);
  if (!Number.isFinite(target) || target <= 0 || target >= windowBeats) return swaps;
  return swaps.includes(target)
    ? swaps.filter((swap) => swap !== target)
    : normaliseBassSwapBeats([...swaps, target], windowBeats);
}

/**
 * The swap the automation should be running at this beat, if any, plus how far
 * through it we are. The exchange occupies the middle half of the beat
 * immediately before the swap — the same shape the single cue always used —
 * so existing feel is preserved when there is exactly one swap.
 */
export function bassSwapWindowAtBeat(swapBeats: readonly number[], windowBeats: number, beat: number) {
  const swaps = normaliseBassSwapBeats(swapBeats, windowBeats);
  if (!swaps.length) return null;
  // The swap being approached or just passed is the one that governs the
  // crossfade; anything earlier has already completed.
  let governing = swaps[0];
  for (const swap of swaps) {
    if (swap - 1 <= beat) governing = swap; else break;
  }
  const startBeat = governing - .75;
  const endBeat = governing - .25;
  return { swapBeat: governing, startBeat, centreBeat: governing - .5, endBeat };
}

/** Rescale swap beats when the overlap length changes, keeping musical position. */
export function resizeBassSwapBeats(swapBeats: readonly number[], fromWindowBeats: number, toWindowBeats: number) {
  if (!Number.isFinite(fromWindowBeats) || fromWindowBeats <= 0) return [];
  const scale = toWindowBeats / fromWindowBeats;
  return normaliseBassSwapBeats(
    normaliseBassSwapBeats(swapBeats, fromWindowBeats).map((beat) => Math.round(beat * scale)),
    toWindowBeats,
  );
}

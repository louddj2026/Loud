/**
 * Whether a kick-fitted grid may replace the one a tune already has, and where to
 * declare it.
 *
 * The app's standing rule is that measurement never moves a placed grid. This is
 * the one carve-out, and it is narrow: a tune nobody has judged and nobody has
 * gridded by hand has no placement to protect, so a grid fitted to its own kicks
 * is strictly better than one fitted to a mix where the bassline shares the kick's
 * band. Everything else is held and said out loud.
 *
 * The gates are measurements, not preferences:
 *
 *  - **Judged tracks are untouchable.** `data/grid-check.json` holds 68 verdicts on
 *    the library's own grids. A verdict is about the grid that was auditioned, so
 *    re-fitting one leaves its verdict describing a grid that no longer exists —
 *    that is ground truth destroyed silently, which is worse than a bad grid.
 *  - **12 ms median error** is where the flam/clean line sits by ear: 6 of the 9
 *    kick-grid flams measured 18-26 ms against ~11 ms for the 33 clean ones.
 *  - **A gross tempo disagreement is held, not applied.** Fitting to percussion
 *    alone produced 2:3 metrical errors — 96 BPM on a 144 BPM tune — when the
 *    bassline was removed. Consensus fitting fixed that (22 of 23 within 0.12% of
 *    stored), so a fit that now disagrees by more than a few percent is reporting
 *    something wrong rather than correcting something wrong.
 *
 * The window also keeps bar phase from the existing grid. Detected kicks say where
 * the beats are; they say nothing about which one is beat 1. Declaring an arbitrary
 * kick as a downbeat would rotate the tune's bars by up to three beats and take
 * every phrase with it, so the window is anchored on a library downbeat and only
 * then snapped to the kicks.
 */

/** Where the flam/clean line sits by ear, measured over 42 fitted grids. */
export const APPLY_MEDIAN_ERROR_LIMIT_MS = 12;
/**
 * Beat counts a declared window may use, largest first.
 *
 * 64 beats or more is `decisive` tempo authority in `teaching.ts`, which is what
 * makes the declaration regenerate the whole grid rather than dent it locally.
 * Anything shorter would be recorded as supporting evidence and leave the old
 * grid in place — a silent no-op, which is the worst of both.
 */
export const APPLY_WINDOW_BEATS = [256, 128, 64] as const;
/** Where in the tune to declare it: past the intro, well before the outro. */
const WINDOW_POSITION = .15;

export type KickGridSummary = {
  bpm: number;
  firstBeatMs: number;
  beatCount: number;
  medianErrorMs: number;
};

export type LibraryBeat = { time: number; isDownbeat?: boolean };

export type KickGridApplyDecision = {
  apply: boolean;
  /** Said in the booth, so a held grid is never a silence. */
  because: string;
};

export type KickGridApplyContext = {
  /** True when this track carries an ear verdict on its stored grid. */
  judged: boolean;
  /** True when a manual window has been taught on this track. */
  manualGrid: boolean;
  duration: number;
};

export function kickGridApplyDecision(grid: KickGridSummary, context: KickGridApplyContext): KickGridApplyDecision {
  if (!(grid.bpm > 0) || grid.beatCount < 2) return { apply: false, because: "the fitted grid is not usable" };
  if (!(context.duration > 0)) return { apply: false, because: "that track has no duration to place a grid in" };
  // First, because it is the one that protects something irreplaceable.
  if (context.judged) return { apply: false, because: "you have already judged this grid by ear — held so that verdict still describes it" };
  if (context.manualGrid) return { apply: false, because: "a manual grid is placed here, and measurement never moves one" };
  if (!(grid.medianErrorMs <= APPLY_MEDIAN_ERROR_LIMIT_MS)) {
    return { apply: false, because: `held at ${Math.round(grid.medianErrorMs)}ms median error — the flam line is ${APPLY_MEDIAN_ERROR_LIMIT_MS}ms` };
  }
  // There is deliberately NO comparison against the library's stored tempo. One
  // existed — hold the fit when it disagreed with the stored BPM by over 5% —
  // and it was the wrong way round: it let an analyser guess veto the measured
  // kicks. Red Tide made it concrete, 13 Aug: stored 169.013 BPM, kicks locked at
  // 146.002 with a 2.3 ms fit, and the gate protected the nonsense number. The
  // kick map is the master. A bad fit is already refused by the flam line above.
  return { apply: true, because: `${grid.bpm.toFixed(2)} BPM at ${Math.round(grid.medianErrorMs)}ms median error, fitted to this tune's own kicks` };
}

export type DeclaredWindow = { start: number; end: number; beats: number };

/**
 * The window to declare, in the shape the teaching path already takes.
 *
 * `start` and `end` are both kick-grid beats a whole number of beats apart, so the
 * tempo the declaration implies — beats over span, the DJ's own rule — is exactly
 * the fitted tempo, with no rounding introduced on the way through.
 *
 * @param grid         The fitted grid.
 * @param libraryBeats The grid the tune currently has, for bar phase and for the
 *                     following-beats check the teaching path enforces.
 */
export function kickGridApplyWindow(
  grid: KickGridSummary,
  libraryBeats: readonly LibraryBeat[],
  duration: number,
): DeclaredWindow | null {
  if (!(grid.bpm > 0) || grid.beatCount < 2 || !(duration > 0) || !libraryBeats.length) return null;
  const period = 60 / grid.bpm;
  const firstBeat = grid.firstBeatMs / 1000;
  const kickBeatAt = (index: number) => firstBeat + index * period;

  // Bar phase comes from the existing grid: the kicks know where the beats are and
  // nothing about which one is beat 1.
  const target = duration * WINDOW_POSITION;
  const downbeats = libraryBeats.filter((beat) => beat.isDownbeat);
  const anchor = (downbeats.length ? downbeats : libraryBeats)
    .reduce((best, beat) => Math.abs(beat.time - target) < Math.abs(best.time - target) ? beat : best);

  const startIndex = Math.round((anchor.time - firstBeat) / period);
  const libraryIndexNear = (time: number) => libraryBeats
    .reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(libraryBeats[best].time - time) ? index : best, 0);

  for (const beats of APPLY_WINDOW_BEATS) {
    // Slide the window back off either end rather than shortening it: the beat
    // count is what carries the tempo authority.
    const highest = Math.min(grid.beatCount - 1 - beats, Math.floor((duration - firstBeat) / period) - beats);
    const index = Math.max(0, Math.min(startIndex, highest));
    if (index + beats > grid.beatCount - 1) continue;
    const start = kickBeatAt(index);
    const end = kickBeatAt(index + beats);
    if (start < 0 || end > duration) continue;
    // `applyManualCycleGrid` refuses a window the mapped grid cannot follow, so
    // the same arithmetic is done here rather than discovering it as an error.
    if (libraryIndexNear(start) + beats >= libraryBeats.length) continue;
    return { start, end, beats };
  }
  return null;
}

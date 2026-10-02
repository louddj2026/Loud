/**
 * The one time-to-pixel model for every scrolling waveform surface.
 *
 * Waves, beat grids, cue markers, window markers and verification blocks slid
 * against each other because they were positioned through different code paths
 * and updated on different schedules: the wave by an imperative per-frame SVG
 * transform, everything else by React renders carrying absolute coordinates.
 * Two update channels can always disagree for a frame, and a frame is all it
 * takes to see the cue leave the sound.
 *
 * The rule this module exists to enforce:
 *
 *   - Child geometry is a pure function of (time, anchorTime, pixelsPerSecond).
 *     It NEVER depends on the playhead time, so the moving clock cannot make
 *     one child move without the others.
 *   - The playhead time enters exactly once, in the group transform, which is
 *     applied to the single group that contains every child.
 *   - Rebasing changes anchorTime. Children shift by a constant and the group
 *     transform shifts by the same constant the other way, so nothing moves on
 *     screen. Rebasing is visually a no-op by construction.
 *
 * Anything drawn outside that group, or positioned by any other formula, can
 * drift. There is one exception by design: the playhead itself is stationary,
 * because the time under it is the view time by definition.
 */

export type WaveViewGeometry = {
  /** Horizontal scale. The only place seconds become pixels. */
  pixelsPerSecond: number;
  /** Track time that maps to the group's local origin. Changes only on rebase. */
  anchorTime: number;
  /** Rendered width of the surface in pixels. */
  width: number;
  /** Where the stationary playhead sits. The view time is always under it. */
  playheadX: number;
};

export function waveViewGeometry(input: {
  width: number;
  windowSeconds: number;
  anchorTime: number;
  playheadFraction?: number;
}): WaveViewGeometry {
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 1;
  const windowSeconds = Number.isFinite(input.windowSeconds) && input.windowSeconds > 0 ? input.windowSeconds : .001;
  const anchorTime = Number.isFinite(input.anchorTime) ? input.anchorTime : 0;
  const fraction = Number.isFinite(input.playheadFraction) ? Math.min(1, Math.max(0, input.playheadFraction!)) : .5;
  return {
    pixelsPerSecond: width / windowSeconds,
    anchorTime,
    width,
    playheadX: width * fraction,
  };
}

/**
 * Local x for ANY child of the moving group — wave chunk, beat line, cue,
 * window marker, alike. Deliberately free of the playhead time: a child cannot
 * be positioned relative to the moving clock, only relative to the anchor.
 */
export function waveViewX(geometry: WaveViewGeometry, time: number) {
  const safeTime = Number.isFinite(time) ? time : geometry.anchorTime;
  return (safeTime - geometry.anchorTime) * geometry.pixelsPerSecond + geometry.playheadX;
}

/** Width in pixels of a duration, for chunk scaling and block widths. */
export function waveViewSpan(geometry: WaveViewGeometry, seconds: number) {
  return (Number.isFinite(seconds) ? seconds : 0) * geometry.pixelsPerSecond;
}

/**
 * The single transform for the single moving group. This is the only place the
 * playhead time is allowed to influence layout.
 */
export function waveViewTransform(geometry: WaveViewGeometry, viewTime: number) {
  const safeViewTime = Number.isFinite(viewTime) ? viewTime : geometry.anchorTime;
  const offset = -(safeViewTime - geometry.anchorTime) * geometry.pixelsPerSecond;
  return `translate(${offset.toFixed(3)} 0)`;
}

/** Where a track time actually lands on screen once the group has moved. */
export function waveViewScreenX(geometry: WaveViewGeometry, viewTime: number, time: number) {
  const safeViewTime = Number.isFinite(viewTime) ? viewTime : geometry.anchorTime;
  const safeTime = Number.isFinite(time) ? time : safeViewTime;
  return (safeTime - safeViewTime) * geometry.pixelsPerSecond + geometry.playheadX;
}

/**
 * Inverse of waveViewScreenX — the track time under a screen pixel. Clicks,
 * drags and scrubs must resolve through this so that what the user grabs is
 * exactly what they saw.
 */
export function waveViewTimeAtScreenX(geometry: WaveViewGeometry, viewTime: number, screenX: number) {
  const safeViewTime = Number.isFinite(viewTime) ? viewTime : geometry.anchorTime;
  const safeX = Number.isFinite(screenX) ? screenX : geometry.playheadX;
  return safeViewTime + (safeX - geometry.playheadX) / geometry.pixelsPerSecond;
}

/** Track-time range worth rendering, with overscan either side of the view. */
export function waveViewRange(geometry: WaveViewGeometry, viewTime: number, overscanSeconds = 0) {
  const safeViewTime = Number.isFinite(viewTime) ? viewTime : geometry.anchorTime;
  const half = geometry.width / 2 / geometry.pixelsPerSecond;
  const overscan = Math.max(0, Number.isFinite(overscanSeconds) ? overscanSeconds : 0);
  return {
    start: safeViewTime - half - overscan,
    end: safeViewTime + half + overscan,
  };
}

/**
 * Rebase policy. The anchor only needs to move when the view has travelled far
 * enough that overscan would run dry; because rebasing is visually a no-op it
 * can be done on any frame without risk.
 */
export function waveViewShouldRebase(geometry: WaveViewGeometry, viewTime: number, driftLimitSeconds: number) {
  if (!Number.isFinite(viewTime)) return false;
  return Math.abs(viewTime - geometry.anchorTime) > Math.max(.001, driftLimitSeconds);
}

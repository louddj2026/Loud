export type LoopGridBeat = { time: number };

export type LoopGridWindow = {
  start: number;
  end: number;
  snapped: boolean;
};

export const LOOP_GRID_SNAP_THRESHOLD_BEATS = 0.5;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function nearestBeatIndex(beats: readonly LoopGridBeat[], time: number) {
  return beats.reduce((best, beat, index) => (
    Math.abs(beat.time - time) < Math.abs(beats[best].time - time) ? index : best
  ), 0);
}

function localBeatPeriod(beats: readonly LoopGridBeat[], index: number) {
  const left = Math.max(0, Math.min(beats.length - 2, index));
  return Math.max(0.001, beats[left + 1].time - beats[left].time);
}

function gridTimeAt(beats: readonly LoopGridBeat[], position: number) {
  const lower = Math.floor(position);
  if (lower >= beats.length - 1) return beats.at(-1)!.time;
  const fraction = position - lower;
  return beats[lower].time + (beats[lower + 1].time - beats[lower].time) * fraction;
}

export function loopWindowAtGrid(
  beats: readonly LoopGridBeat[],
  rawStart: number,
  loopBeats: number,
  duration: number,
): LoopGridWindow | null {
  if (beats.length < 2 || !(loopBeats > 0) || !(duration > 0)) return null;
  const boundedStart = clamp(rawStart, 0, duration);
  const startIndex = nearestBeatIndex(beats, boundedStart);
  if (loopBeats <= LOOP_GRID_SNAP_THRESHOLD_BEATS) {
    const start = boundedStart;
    const end = clamp(start + localBeatPeriod(beats, startIndex) * loopBeats, 0, duration);
    return end > start ? { start, end, snapped: false } : null;
  }
  const start = beats[startIndex].time;
  const end = Math.min(duration, gridTimeAt(beats, startIndex + loopBeats));
  return end > start ? { start, end, snapped: true } : null;
}

export function movedLoopWindow(
  beats: readonly LoopGridBeat[],
  start: number,
  end: number,
  loopBeats: number,
  direction: -1 | 1,
  duration: number,
): LoopGridWindow | null {
  if (loopBeats <= LOOP_GRID_SNAP_THRESHOLD_BEATS) {
    const length = end - start;
    if (!(length > 0)) return null;
    const nextStart = clamp(start + direction * length, 0, Math.max(0, duration - length));
    if (Math.abs(nextStart - start) <= 0.0001) return null;
    return { start: nextStart, end: nextStart + length, snapped: false };
  }
  if (beats.length < 2) return null;
  const startIndex = nearestBeatIndex(beats, start);
  const step = Math.max(1, Math.round(loopBeats));
  const maxStartIndex = Math.max(0, beats.length - 1 - Math.ceil(loopBeats));
  const nextIndex = Math.trunc(clamp(startIndex + direction * step, 0, maxStartIndex));
  if (nextIndex === startIndex) return null;
  return loopWindowAtGrid(beats, beats[nextIndex].time, loopBeats, duration);
}

/** Tempo of the loop that is actually repeating, rather than a whole-track estimate. */
export function loopTempoBpm(loop: { loopActive: boolean; loopStart: number | null; loopEnd: number | null; loopSize: number }): number | null {
  const span = (loop.loopEnd ?? 0) - (loop.loopStart ?? 0);
  return loop.loopActive && loop.loopStart !== null && loop.loopEnd !== null && span > 0 && loop.loopSize > 0 ? 60 * loop.loopSize / span : null;
}

/** Keep previous handoff error from becoming a fresh delay on every repetition. */
export function loopStandbyPosition(start: number, end: number, currentTime: number, accumulatedError: number): number {
  return Math.max(0, start + currentTime - end - accumulatedError);
}
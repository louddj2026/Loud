const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function naturalTempoRate(startRate: number, startTrackTime: number, endTrackTime: number, currentTrackTime: number) {
  if (Math.abs(startRate - 1) < .00005 || endTrackTime <= startTrackTime) return 1;
  const progress = clamp01((currentTrackTime - startTrackTime) / (endTrackTime - startTrackTime));
  const eased = progress * progress * (3 - 2 * progress);
  return startRate + (1 - startRate) * eased;
}

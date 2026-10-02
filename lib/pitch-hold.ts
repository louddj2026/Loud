export const PITCH_HOLD_BEATS = 8;
export const PITCH_HOLD_FALLBACK_BPM = 120;
export const PITCH_HOLD_MAX_PLAYBACK_RATE = 4;

export const PITCH_SCRUB_INITIAL_SPEED = .25;
export const PITCH_SCRUB_ACCELERATION = 1;
export const PITCH_SCRUB_MAX_SPEED = 8;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function positiveOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Wall-clock length of an eight-beat pitch hold. The source BPM is converted
 * to the BPM currently heard by the crowd with the deck's base playback rate.
 */
export function pitchHoldDurationMs(sourceBpm: number, baseRate: number) {
  const resolvedSourceBpm = positiveOr(sourceBpm, PITCH_HOLD_FALLBACK_BPM);
  const resolvedBaseRate = positiveOr(baseRate, 1);
  return PITCH_HOLD_BEATS * 60_000 / (resolvedSourceBpm * resolvedBaseRate);
}

/** Smooth acceleration/deceleration with a flat tangent at both endpoints. */
export function pitchHoldSmoothstep(progress: number) {
  const bounded = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

/**
 * Effective playback rate for a momentary pitch hold. Pitch down reaches
 * exactly zero at the deadline; the media adapter can pause there if its
 * browser cannot accept a zero playbackRate. Pitch up mirrors the curve and
 * is capped at the booth's safe transient ceiling.
 */
export function pitchHoldPlaybackRate(
  direction: -1 | 1,
  baseRate: number,
  elapsedMs: number,
  durationMs: number,
  maximumRate = PITCH_HOLD_MAX_PLAYBACK_RATE,
) {
  const resolvedBaseRate = positiveOr(baseRate, 1);
  const resolvedDurationMs = positiveOr(durationMs, pitchHoldDurationMs(PITCH_HOLD_FALLBACK_BPM, resolvedBaseRate));
  const progress = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / resolvedDurationMs;
  const movement = pitchHoldSmoothstep(progress);
  if (direction < 0) return resolvedBaseRate * (1 - movement);
  return Math.min(positiveOr(maximumRate, PITCH_HOLD_MAX_PLAYBACK_RATE), resolvedBaseRate * (1 + movement));
}

/**
 * Absolute paused-scrub distance in source seconds. Speed starts gently,
 * accelerates linearly, then remains at the cap. Calculating from elapsed time
 * avoids accumulating interval jitter or rounding error.
 */
export function pitchScrubDistance(
  elapsedMs: number,
  initialSpeed = PITCH_SCRUB_INITIAL_SPEED,
  acceleration = PITCH_SCRUB_ACCELERATION,
  maximumSpeed = PITCH_SCRUB_MAX_SPEED,
) {
  const elapsedSeconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0);
  const startSpeed = clamp(Number.isFinite(initialSpeed) ? initialSpeed : PITCH_SCRUB_INITIAL_SPEED, 0, Number.MAX_VALUE);
  const speedIncrease = clamp(Number.isFinite(acceleration) ? acceleration : PITCH_SCRUB_ACCELERATION, 0, Number.MAX_VALUE);
  const speedCap = Math.max(startSpeed, positiveOr(maximumSpeed, PITCH_SCRUB_MAX_SPEED));

  if (speedIncrease === 0 || startSpeed >= speedCap) return Math.min(startSpeed, speedCap) * elapsedSeconds;

  const secondsToCap = (speedCap - startSpeed) / speedIncrease;
  if (elapsedSeconds <= secondsToCap) {
    return startSpeed * elapsedSeconds + .5 * speedIncrease * elapsedSeconds ** 2;
  }

  const distanceToCap = startSpeed * secondsToCap + .5 * speedIncrease * secondsToCap ** 2;
  return distanceToCap + speedCap * (elapsedSeconds - secondsToCap);
}

/**
 * Accelerated paused-scrub target. A finite positive duration clamps the
 * target to the loaded track; an unknown duration (0, negative, NaN or
 * Infinity) only clamps the lower bound — the media element itself limits
 * seeking past the end, and collapsing to [0, 0] would teleport the deck to
 * 0:00 on analysis-less tracks.
 */
export function pitchScrubTarget(
  startTime: number,
  direction: -1 | 1,
  elapsedMs: number,
  duration: number,
) {
  const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const resolvedStart = clamp(Number.isFinite(startTime) ? startTime : 0, 0, knownDuration);
  return clamp(resolvedStart + direction * pitchScrubDistance(elapsedMs), 0, knownDuration);
}

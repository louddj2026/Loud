export const MINIMUM_FULL_TUNE_SECONDS = 90;

export function isKnownShortSample(durationSeconds: number | null | undefined) {
  return Number.isFinite(durationSeconds)
    && Number(durationSeconds) > 0
    && Number(durationSeconds) < MINIMUM_FULL_TUNE_SECONDS;
}

export function isKnownFullTune(durationSeconds: number | null | undefined) {
  return Number.isFinite(durationSeconds)
    && Number(durationSeconds) >= MINIMUM_FULL_TUNE_SECONDS;
}

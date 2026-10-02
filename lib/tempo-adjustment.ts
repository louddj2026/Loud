export const FINE_TEMPO_INITIAL_STEP_BPM = .001;
export const FINE_TEMPO_REPEAT_DELAY_MS = 400;
export const FINE_TEMPO_REPEAT_INTERVAL_MS = 100;
export const FINE_TEMPO_MAX_STEP_BPM = .25;

/** Fine on first press, then a smooth exponential acceleration while held. */
export function fineTempoStepBpm(heldMs: number) {
  const elapsed = Number.isFinite(heldMs) ? Math.max(0, heldMs - FINE_TEMPO_REPEAT_DELAY_MS) : 0;
  return Math.min(FINE_TEMPO_MAX_STEP_BPM, FINE_TEMPO_INITIAL_STEP_BPM * 2 ** (elapsed / 750));
}

/** An absolute BPM change at the current portion, independent of source tempo. */
export function tempoRateAfterBpmStep(sourceBpm: number, currentRate: number, direction: -1 | 1, deltaBpm: number) {
  const rate = Number.isFinite(currentRate) && currentRate > 0 ? currentRate : 1;
  if (!Number.isFinite(sourceBpm) || sourceBpm <= 0 || !Number.isFinite(deltaBpm) || deltaBpm <= 0) return rate;
  return Math.max(.5, Math.min(2, rate + direction * deltaBpm / sourceBpm));
}

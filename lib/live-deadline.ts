export const STOP_NEW_MAPPING_SECONDS = 110;
export const ARM_COLD_START_SECONDS = 45;
export const NEXT_TUNE_SELECTION_SECONDS = 60;
export const FRESH_SCAN_SECONDS = 40;

export type LiveSearchDeadlineMode = "full-search" | "mapped-only" | "cold-start";
export type NextTuneSelectionPhase = "fresh-scan" | "mapped-fallback" | "decision-due";

export function nextTuneSelectionSecondsRemaining(elapsedSeconds: number) {
  return Math.max(0, NEXT_TUNE_SELECTION_SECONDS - Math.max(0, elapsedSeconds));
}

export function nextTuneSelectionPhase(elapsedSeconds: number): NextTuneSelectionPhase {
  const elapsed = Math.max(0, elapsedSeconds);
  if (elapsed >= NEXT_TUNE_SELECTION_SECONDS) return "decision-due";
  if (elapsed >= FRESH_SCAN_SECONDS) return "mapped-fallback";
  return "fresh-scan";
}

export function liveSearchBudgetSeconds(trackSecondsLeft: number, preferredRunwaySecondsLeft: number | null = null) {
  const trackBudget = Math.max(0, trackSecondsLeft);
  if (preferredRunwaySecondsLeft === null || !Number.isFinite(preferredRunwaySecondsLeft)) return trackBudget;
  return Math.min(trackBudget, Math.max(0, preferredRunwaySecondsLeft));
}

export function liveSearchDeadlineMode(secondsLeft: number): LiveSearchDeadlineMode {
  if (secondsLeft <= ARM_COLD_START_SECONDS) return "cold-start";
  if (secondsLeft <= STOP_NEW_MAPPING_SECONDS) return "mapped-only";
  return "full-search";
}

export function shouldYieldMappingToPreferredMatch(hasPreferredMatch: boolean, searchBudgetSecondsLeft: number) {
  return hasPreferredMatch && liveSearchDeadlineMode(searchBudgetSecondsLeft) !== "full-search";
}

export function liveCueAwareDeadlineMode(trackSecondsLeft: number, lockedRunwaySecondsLeft: number | null) {
  if (trackSecondsLeft <= ARM_COLD_START_SECONDS) return "cold-start" as const;
  if (lockedRunwaySecondsLeft !== null && Number.isFinite(lockedRunwaySecondsLeft) && lockedRunwaySecondsLeft <= STOP_NEW_MAPPING_SECONDS) return "mapped-only" as const;
  return liveSearchDeadlineMode(trackSecondsLeft);
}

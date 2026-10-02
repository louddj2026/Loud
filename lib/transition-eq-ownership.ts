export const TRANSITION_EQ_BANDS = ["low", "mid", "high"] as const;

export type TransitionEqBand = typeof TRANSITION_EQ_BANDS[number];
export type TransitionEqValues = Record<TransitionEqBand, number>;
export type TransitionManualEqOwnership<Deck extends string = string> = Partial<
  Record<Deck, Partial<Record<TransitionEqBand, true>>>
>;

/**
 * Record the EQ bands changed by the operator without mutating the current
 * transition ownership. Non-EQ fields in a wider deck patch are ignored.
 */
export function claimTransitionManualEq<Deck extends string>(
  ownership: TransitionManualEqOwnership<Deck>,
  deck: Deck,
  patch: Partial<TransitionEqValues>,
): TransitionManualEqOwnership<Deck> {
  const claimed = TRANSITION_EQ_BANDS.filter((band) => Number.isFinite(patch[band]));
  if (!claimed.length) return ownership;

  const deckOwnership: Partial<Record<TransitionEqBand, true>> = { ...(ownership[deck] ?? {}) };
  for (const band of claimed) deckOwnership[band] = true;
  return { ...ownership, [deck]: deckOwnership };
}

/**
 * Resolve one automation frame. Automation continues to own every band that
 * the operator has not claimed; manually owned bands retain their live value.
 */
export function mergeTransitionAutomatedEq<Deck extends string>(
  ownership: TransitionManualEqOwnership<Deck>,
  deck: Deck,
  current: TransitionEqValues,
  automated: TransitionEqValues,
): TransitionEqValues {
  const deckOwnership = ownership[deck];
  return {
    low: deckOwnership?.low ? current.low : automated.low,
    mid: deckOwnership?.mid ? current.mid : automated.mid,
    high: deckOwnership?.high ? current.high : automated.high,
  };
}

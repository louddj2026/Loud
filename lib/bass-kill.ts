export type BassOverride = "kill" | "live";
export type BassDeck = "A" | "B" | "C";

export function bassKillDeck(code: string): BassDeck | null {
  if (code === "Digit5" || code === "Numpad5") return "A";
  if (code === "Digit6" || code === "Numpad6") return "B";
  if (code === "Digit7" || code === "Numpad7") return "C";
  return null;
}

/**
 * A manual bass choice owns the low EQ for the current transition. Release
 * that ownership after the handoff so an old "live" choice cannot prevent the
 * same deck being killed when it becomes the outgoing deck in the next mix.
 * The deck's landed EQ value is deliberately left untouched.
 */
export function releaseTransitionBassOverrides(
  overrides: Partial<Record<BassDeck, BassOverride>>,
  decks: readonly BassDeck[],
) {
  const released = decks.filter((deck) => overrides[deck] !== undefined);
  for (const deck of released) delete overrides[deck];
  return released;
}

export function nextBassOverride(held: BassOverride | undefined, currentLow: number): BassOverride {
  return held === "kill" || (held === undefined && currentLow <= -59) ? "live" : "kill";
}

export function overriddenBassLow(curveLow: number, held: BassOverride | undefined, restoredLow = 0): number {
  return held === "kill" ? -60 : held === "live" ? restoredLow : curveLow;
}

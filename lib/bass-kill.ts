export type BassOverride = "kill" | "live";

export function bassKillDeck(code: string): "A" | "B" | "C" | null {
  if (code === "Digit5" || code === "Numpad5") return "A";
  if (code === "Digit6" || code === "Numpad6") return "B";
  if (code === "Digit7" || code === "Numpad7") return "C";
  return null;
}

export function nextBassOverride(held: BassOverride | undefined, currentLow: number): BassOverride {
  return held === "kill" || (held === undefined && currentLow <= -59) ? "live" : "kill";
}

export function overriddenBassLow(curveLow: number, held: BassOverride | undefined, restoredLow = 0): number {
  return held === "kill" ? -60 : held === "live" ? restoredLow : curveLow;
}

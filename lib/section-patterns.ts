/**
 * Section labels drawn as fill patterns, with a different visual language on
 * each wave surface.
 *
 * Colour is already spoken for on both waves — the deck identity owns the wave
 * colour, tempo sections tint the overview, and verification blocks tint the
 * focus wave. Another colour scale would collide with all three. Texture is free,
 * so the section label is carried by the *pattern* and nothing else.
 *
 * The two surfaces deliberately use different patterns for the same label:
 *
 *   - The overview is short and shows the whole tune, so its patterns are coarse
 *     and low-frequency. Fine hatching at that height turns into grey mush.
 *   - The focus wave is tall and zoomed, so it can carry finer, denser texture.
 *
 * The point of them differing is that a glance can never mistake one surface for
 * the other. Same label, same *rank* of density, different mark.
 *
 * Density carries meaning on both: a chorus is the densest fill, a start or end
 * the sparsest, so the loud parts of the tune read as busy texture even before
 * the specific pattern is recognised.
 */

/** The vocabulary All-In-One emits. Anything else falls back to `unknown`. */
export const SECTION_LABELS = [
  "start", "intro", "verse", "chorus", "inst", "break", "bridge", "solo", "outro", "end",
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];
export type SectionSurface = "overview" | "focus";

/**
 * The texture is drawn in this, not in the deck's wave colour.
 *
 * Drawn in the wave colour, a pattern sitting inside the wave silhouette is the
 * same hue as the thing behind it, so it only slightly brightens the wave and
 * neither reads clearly. A near-white ink separates from every deck colour and
 * from the dark background, so the wave shape and the section texture are both
 * legible at once. Deck identity is already carried by the wave itself and does
 * not need saying twice.
 */
export const SECTION_PATTERN_INK = "#f2fbf7";

export type SectionPatternShape =
  | { shape: "line"; x1: number; y1: number; x2: number; y2: number; width: number }
  | { shape: "circle"; cx: number; cy: number; r: number }
  | { shape: "rect"; x: number; y: number; width: number; height: number };

export type SectionPattern = {
  /** Stable per surface and label; the scope is added when the id is built. */
  key: string;
  label: SectionLabel | "unknown";
  /** Tile size in user units. Larger reads coarser. */
  tile: number;
  shapes: SectionPatternShape[];
  /** How strongly the texture sits over the wave colour. */
  opacity: number;
};

const line = (x1: number, y1: number, x2: number, y2: number, width: number): SectionPatternShape =>
  ({ shape: "line", x1, y1, x2, y2, width });

/**
 * Coarse marks for the overview: one or two strokes per tile, nothing finer than
 * about a third of the tile, so the pattern survives a 60-pixel-high surface.
 */
const OVERVIEW: Record<SectionLabel | "unknown", Omit<SectionPattern, "key" | "label">> = {
  // Opacities are deliberately restrained: the ink is near-white, which reads far
  // harder over a saturated wave than the deck colour did. The wave shape has to
  // stay legible through the texture — both are the point.
  // Sparsest: a single dot. The tune has not started.
  start: { tile: 14, shapes: [{ shape: "circle", cx: 7, cy: 7, r: 1.1 }], opacity: .22 },
  // Widely spaced verticals.
  intro: { tile: 12, shapes: [line(0, 0, 0, 12, 1.4)], opacity: .26 },
  // Diagonal one way.
  verse: { tile: 10, shapes: [line(0, 10, 10, 0, 1.6)], opacity: .32 },
  // Densest: block fill, kept translucent so the wave still shows through it.
  chorus: { tile: 8, shapes: [{ shape: "rect", x: 0, y: 0, width: 8, height: 8 }], opacity: .40 },
  // Crisscross — busy, but not solid.
  inst: { tile: 10, shapes: [line(0, 10, 10, 0, 1.5), line(0, 0, 10, 10, 1.5)], opacity: .34 },
  // Horizontals: the energy has flattened out.
  break: { tile: 12, shapes: [line(0, 0, 12, 0, 1.5)], opacity: .26 },
  // Hex-ish: two angled strokes meeting.
  bridge: { tile: 12, shapes: [line(0, 6, 6, 0, 1.5), line(6, 0, 12, 6, 1.5)], opacity: .30 },
  // Checker half-tile.
  solo: { tile: 12, shapes: [{ shape: "rect", x: 0, y: 0, width: 6, height: 6 }, { shape: "rect", x: 6, y: 6, width: 6, height: 6 }], opacity: .32 },
  // Diagonal the other way from a verse, so the pair cannot be confused.
  outro: { tile: 10, shapes: [line(0, 0, 10, 10, 1.6)], opacity: .30 },
  end: { tile: 16, shapes: [{ shape: "circle", cx: 8, cy: 8, r: 1 }], opacity: .20 },
  unknown: { tile: 14, shapes: [{ shape: "circle", cx: 7, cy: 7, r: .8 }], opacity: .16 },
};

/**
 * Finer marks for the focus wave: smaller tiles and thinner strokes, and a
 * different mark for each label than the overview uses.
 */
const FOCUS: Record<SectionLabel | "unknown", Omit<SectionPattern, "key" | "label">> = {
  start: { tile: 10, shapes: [{ shape: "circle", cx: 5, cy: 5, r: .7 }], opacity: .20 },
  // Fine dot grid rather than the overview's verticals.
  intro: { tile: 7, shapes: [{ shape: "circle", cx: 3.5, cy: 3.5, r: .9 }], opacity: .24 },
  // Hexagon outline rather than the overview's single diagonal.
  verse: { tile: 9, shapes: [line(2.5, 0, 6.5, 0, 1), line(6.5, 0, 9, 4.5, 1), line(9, 4.5, 6.5, 9, 1), line(6.5, 9, 2.5, 9, 1), line(2.5, 9, 0, 4.5, 1), line(0, 4.5, 2.5, 0, 1)], opacity: .30 },
  // Dense crosshatch rather than the overview's block fill.
  chorus: { tile: 6, shapes: [line(0, 6, 6, 0, 1.2), line(0, 0, 6, 6, 1.2), line(3, 0, 3, 6, .8)], opacity: .40 },
  // Steep single diagonal, opposite lean to the overview's crisscross.
  inst: { tile: 7, shapes: [line(0, 7, 3.5, 0, 1.1), line(3.5, 7, 7, 0, 1.1)], opacity: .32 },
  // Zigzag rather than flat horizontals.
  break: { tile: 10, shapes: [line(0, 7, 5, 3, 1.2), line(5, 3, 10, 7, 1.2)], opacity: .24 },
  // Brick.
  bridge: { tile: 10, shapes: [line(0, 0, 10, 0, 1.1), line(0, 5, 10, 5, 1.1), line(5, 0, 5, 5, 1.1), line(0, 5, 0, 10, 1.1)], opacity: .30 },
  // Fine checker.
  solo: { tile: 8, shapes: [{ shape: "rect", x: 0, y: 0, width: 4, height: 4 }, { shape: "rect", x: 4, y: 4, width: 4, height: 4 }], opacity: .32 },
  // Widely spaced verticals — the overview uses these for an intro, so on this
  // surface they are free for the outro.
  outro: { tile: 9, shapes: [line(0, 0, 0, 9, 1.2)], opacity: .26 },
  end: { tile: 12, shapes: [{ shape: "circle", cx: 6, cy: 6, r: .6 }], opacity: .18 },
  unknown: { tile: 10, shapes: [{ shape: "circle", cx: 5, cy: 5, r: .6 }], opacity: .14 },
};

export function normaliseSectionLabel(label: string | null | undefined): SectionLabel | "unknown" {
  const cleaned = String(label ?? "").trim().toLowerCase();
  return (SECTION_LABELS as readonly string[]).includes(cleaned) ? cleaned as SectionLabel : "unknown";
}

export function sectionPattern(label: string | null | undefined, surface: SectionSurface): SectionPattern {
  const normalised = normaliseSectionLabel(label);
  const table = surface === "overview" ? OVERVIEW : FOCUS;
  return { key: `${surface}-${normalised}`, label: normalised, ...table[normalised] };
}

/** Every pattern a surface can need, for one `<defs>` block. */
export function sectionPatterns(surface: SectionSurface): SectionPattern[] {
  return [...SECTION_LABELS, "unknown" as const].map((label) => sectionPattern(label, surface));
}

/** Namespaced so two decks on one page cannot share a pattern id. */
export function sectionPatternId(scope: string, surface: SectionSurface, label: string | null | undefined) {
  return `section-${scope}-${surface}-${normaliseSectionLabel(label)}`;
}

export type SectionSpan = { start: number; end: number; label: SectionLabel | "unknown" };

/**
 * Merge neighbouring spans that share a label.
 *
 * All-In-One emits uniform 32-beat segments, so a 4-phrase chorus arrives as four
 * separate `chorus` segments. Drawn as four rects they tile identically and the
 * seams are invisible, but each one is a separate clip path and a separate fill —
 * so on a long tune this is several hundred nodes redrawn every frame the wave
 * scrolls. Merging first is what makes this cheap enough for the focus wave.
 */
export function mergeSectionSpans(spans: readonly SectionSpan[]): SectionSpan[] {
  const sorted = [...spans]
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start);
  const merged: SectionSpan[] = [];
  for (const span of sorted) {
    const previous = merged.at(-1);
    // A hair of tolerance: segment ends and starts are rounded to 2 dp upstream.
    if (previous && previous.label === span.label && span.start - previous.end <= .05) {
      previous.end = Math.max(previous.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

/** Spans overlapping a visible time range, clipped to it. */
export function visibleSectionSpans(spans: readonly SectionSpan[], start: number, end: number): SectionSpan[] {
  if (!(end > start)) return [];
  return spans
    .filter((span) => span.end > start && span.start < end)
    .map((span) => ({ label: span.label, start: Math.max(span.start, start), end: Math.min(span.end, end) }));
}

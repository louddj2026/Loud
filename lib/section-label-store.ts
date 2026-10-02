/**
 * Durable section labels, and the record of what has already been tried.
 *
 * Seeded from the shipped `public/section-labels.json` on first run, then owned
 * by the durable data root so an analysis survives a runtime reinstall — the same
 * arrangement uploads and the DJ memory database use.
 *
 * Failures are recorded, not just successes. Without that, a track All-In-One
 * cannot read is re-queued every single time it is loaded, which on a 15,915
 * track crate would mean the GPU grinding through the same broken file forever.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adoptLegacyDurableFile, durableDataRoot } from "./data-root.ts";
import { mergeSectionSpans, normaliseSectionLabel, type SectionSpan } from "./section-patterns.ts";

export type StoredSpan = [start: number, end: number, label: string];
export type SectionFailure = { at: string; error: string; attempts: number };

type StoreFile = {
  source?: string;
  note?: string;
  generatedAt?: string;
  tracks: Record<string, StoredSpan[]>;
  failures?: Record<string, SectionFailure>;
};

const STORE = path.join(durableDataRoot, "section-labels.json");
const SEED = path.join(process.cwd(), "public", "section-labels.json");
/** Give up after this many failures on one track. */
export const SECTION_ANALYSIS_MAX_ATTEMPTS = 2;

let cache: StoreFile | null = null;
/** Bumped on every write so a client can tell whether to re-fetch the map. */
let version = 0;

function empty(): StoreFile {
  return { source: "All-In-One (harmonix structure model), labels only", tracks: {}, failures: {} };
}

function load(): StoreFile {
  if (cache) return cache;
  mkdirSync(durableDataRoot, { recursive: true });
  // The shipped file is a seed, not the live store: copied in only when the
  // durable location is still empty, so an analysed library is never overwritten.
  adoptLegacyDurableFile(STORE, [SEED]);
  if (!existsSync(STORE)) {
    cache = empty();
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as StoreFile;
    cache = { ...empty(), ...parsed, tracks: parsed.tracks ?? {}, failures: parsed.failures ?? {} };
  } catch {
    // A corrupt store must not take the booth down. Start clean; the seed will
    // be re-adopted on the next boot if the file is removed.
    cache = empty();
  }
  return cache;
}

function persist(file: StoreFile) {
  mkdirSync(durableDataRoot, { recursive: true });
  // Write-then-rename: a crash mid-write must not leave a truncated store, which
  // would silently lose every label analysed so far.
  const temporary = `${STORE}.partial`;
  writeFileSync(temporary, JSON.stringify(file));
  renameSync(temporary, STORE);
  cache = file;
  version += 1;
}

export function sectionLabelVersion() {
  load();
  return version;
}

export function allSectionSpans(): Record<string, StoredSpan[]> {
  return load().tracks;
}

export function sectionSpansForTrack(trackId: string): SectionSpan[] {
  const spans = load().tracks[trackId];
  if (!spans?.length) return [];
  return mergeSectionSpans(spans.map(([start, end, label]) => ({
    start: Number(start),
    end: Number(end),
    label: normaliseSectionLabel(label),
  })));
}

export function hasSectionLabels(trackId: string) {
  return (load().tracks[trackId]?.length ?? 0) > 0;
}

export function sectionFailure(trackId: string): SectionFailure | null {
  return load().failures?.[trackId] ?? null;
}

export function allSectionFailures(): Record<string, SectionFailure> {
  return load().failures ?? {};
}

/** True when this track is worth spending 90 seconds of GPU on. */
export function sectionAnalysisWorthTrying(trackId: string) {
  if (hasSectionLabels(trackId)) return false;
  const failure = sectionFailure(trackId);
  return !failure || failure.attempts < SECTION_ANALYSIS_MAX_ATTEMPTS;
}

export function saveSectionSpans(trackId: string, spans: readonly SectionSpan[]) {
  const file = load();
  const merged = mergeSectionSpans(spans);
  if (!merged.length) return false;
  const failures = { ...(file.failures ?? {}) };
  delete failures[trackId];
  persist({
    ...file,
    generatedAt: new Date().toISOString(),
    tracks: { ...file.tracks, [trackId]: merged.map((span) => [span.start, span.end, span.label] as StoredSpan) },
    failures,
  });
  return true;
}

export function recordSectionFailure(trackId: string, error: string) {
  const file = load();
  const previous = file.failures?.[trackId];
  persist({
    ...file,
    failures: {
      ...(file.failures ?? {}),
      [trackId]: { at: new Date().toISOString(), error: error.slice(0, 300), attempts: (previous?.attempts ?? 0) + 1 },
    },
  });
}

/** Test seam. */
export function resetSectionLabelStore() {
  cache = null;
  version = 0;
}

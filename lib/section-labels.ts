/**
 * Section labels for the wave surfaces, and the request that fills them in.
 *
 * Loaded once from `/api/section-labels`, then kept for the session. A deck load
 * must never wait on a network round trip to draw its wave, so every accessor
 * answers synchronously from the cache and returns an empty list until the map
 * arrives — a track with no labels simply draws a plain wave.
 *
 * When a track has none, the booth asks for analysis. That runs All-In-One in
 * WSL2 on the GPU for ~90 seconds, so the request always carries whether the
 * booth is idle, and the server refuses to *start* a job unless it is. The poll
 * that waits for the result is what keeps that report fresh.
 *
 * Only labels are taken. All-In-One's BPM is integer-only and its downbeats sit
 * ~29 ms off a grid that passed a listening test, so nothing here touches tempo
 * or phase — see docs/allin1-setup.md.
 */
import { mergeSectionSpans, normaliseSectionLabel, type SectionSpan } from "./section-patterns.ts";

type StoredSpan = [start: number, end: number, label: string];
export type SectionAnalysisStatus = {
  running: string | null;
  runningName: string | null;
  queued: string[];
  completed: number;
  failed: number;
  lastError: string | null;
  boothIdle: boolean;
  waitingForIdle: boolean;
};
export type SectionFailure = { at: string; error: string; attempts: number };
type Feed = {
  version?: number;
  tracks?: Record<string, StoredSpan[]>;
  failures?: Record<string, SectionFailure>;
  maxAttempts?: number;
  status?: SectionAnalysisStatus;
};

const ENDPOINT = "/api/section-labels";

let cache: Map<string, SectionSpan[]> | null = null;
let version = -1;
let latestStatus: SectionAnalysisStatus | null = null;
let failures: Record<string, SectionFailure> = {};
let maxAttempts = 2;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function parse(tracks: Record<string, StoredSpan[]>) {
  const parsed = new Map<string, SectionSpan[]>();
  for (const [id, spans] of Object.entries(tracks)) {
    if (!Array.isArray(spans)) continue;
    const usable = spans
      .filter((span): span is StoredSpan => Array.isArray(span) && span.length >= 3)
      .map((span) => ({ start: Number(span[0]), end: Number(span[1]), label: normaliseSectionLabel(span[2]) }));
    const merged = mergeSectionSpans(usable);
    if (merged.length) parsed.set(id, merged);
  }
  return parsed;
}

function announce() {
  for (const listener of listeners) listener();
}

/** Notified whenever the map or the queue status changes. */
export function onSectionLabelsChanged(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Whether anything is playing is a property of the whole booth, not of the deck
// whose wave happens to be asking. The root sets it; the wave surfaces read it.
let boothIdle = false;

export function setBoothIdle(idle: boolean) {
  boothIdle = idle;
}

export function boothIsIdle() {
  return boothIdle;
}

/**
 * Analysing on load is on unless switched off.
 *
 * It is a ~90 second GPU job whose first stage is a full source separation, and
 * it was off by default for exactly that reason. What changed is what the labels
 * are for: the cue placed on load is the beat at a chorus start, and the choruses
 * come from here. A tune with no labels gets a grid and no cue, so this is now
 * part of loading a tune rather than an extra. It still waits for silence.
 */
let autoAnalyseOnLoad = true;

export function setSectionAutoAnalyse(enabled: boolean) {
  if (autoAnalyseOnLoad === enabled) return;
  autoAnalyseOnLoad = enabled;
  // Announce it: flipping the switch on has to reach the wave already on screen,
  // not wait for the next track to be loaded.
  announce();
}

export function sectionAutoAnalyseEnabled() {
  return autoAnalyseOnLoad;
}

function absorb(feed: Feed) {
  // Announce ONLY when something actually changed. The unconditional
  // announce() re-armed the booth's polling effects on every response —
  // their own replies re-triggered them, the 4 s backoff never ran, and the
  // server took 1000+ pending POSTs at 3.5 GB (root-caused 24 Aug, fixed
  // 26 Aug when DJ ordered the load path stripped of redundant work).
  let changed = false;
  if (feed.status && JSON.stringify(feed.status) !== JSON.stringify(latestStatus)) { latestStatus = feed.status; changed = true; }
  else if (feed.status) latestStatus = feed.status;
  if (feed.failures && JSON.stringify(feed.failures) !== JSON.stringify(failures)) { failures = feed.failures; changed = true; }
  else if (feed.failures) failures = feed.failures;
  if (typeof feed.maxAttempts === "number" && feed.maxAttempts !== maxAttempts) { maxAttempts = feed.maxAttempts; changed = true; }
  if (feed.tracks && feed.version !== version) {
    cache = parse(feed.tracks);
    version = feed.version ?? version;
    changed = true;
  }
  if (changed) announce();
}

/** True once a track has failed often enough that it will not be tried again. */
export function sectionAnalysisGaveUp(trackId: string | null | undefined) {
  if (!trackId) return false;
  const failure = failures[trackId];
  return !!failure && failure.attempts >= maxAttempts;
}

export function sectionFailureFor(trackId: string | null | undefined) {
  return trackId ? failures[trackId] ?? null : null;
}

/**
 * Begin loading. Safe to call repeatedly; only the first call fetches. A failure
 * leaves the cache empty rather than throwing, because a missing label feed must
 * degrade to plain waves and never break a deck load.
 */
export function loadSectionLabels(): Promise<void> {
  if (cache) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = fetch(ENDPOINT, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`section labels unavailable (${response.status})`);
      absorb(await response.json() as Feed);
    })
    .catch(() => { cache = new Map(); announce(); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Synchronous, and empty until the feed has loaded. */
export function sectionSpansFor(trackId: string | null | undefined): SectionSpan[] {
  if (!trackId || !cache) return [];
  return cache.get(trackId) ?? [];
}

export function sectionLabelsReady() {
  return cache !== null;
}

export function sectionAnalysisStatus() {
  return latestStatus;
}

export function sectionLabelsVersion() {
  return version;
}

/**
 * Ask for a track to be analysed, and report whether the booth is quiet.
 *
 * Called with no track id it is just a heartbeat, which is how a waiting poll
 * keeps the idle report inside its trust window.
 */
export async function requestSectionAnalysis(trackId: string | null, boothIdle: boolean) {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ...(trackId ? { trackId } : {}), boothIdle }),
    });
    if (!response.ok) return null;
    const feed = await response.json() as Feed & { queued?: boolean };
    // A finished job bumps the version, so re-fetch the map to pick up its spans.
    if (typeof feed.version === "number" && feed.version !== version) {
      const refreshed = await fetch(ENDPOINT, { cache: "no-store" });
      if (refreshed.ok) absorb(await refreshed.json() as Feed);
      else absorb(feed);
    } else {
      absorb(feed);
    }
    return feed.status ?? null;
  } catch {
    return null;
  }
}

/** Test seams. */
export function primeSectionLabels(file: { tracks?: Record<string, StoredSpan[]> }) {
  cache = parse(file.tracks ?? {});
  version = 0;
}

export function resetSectionLabels() {
  cache = null;
  version = -1;
  latestStatus = null;
  failures = {};
  inFlight = null;
  listeners.clear();
}

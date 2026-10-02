/**
 * Detected kick times per track, for the ticker to play.
 *
 * These are individual hits, not a grid. Nothing is inferred from their spacing
 * and nothing here touches a tempo or a beat number: the file answers only
 * "where did the detector say the kicks are", so an ear can judge that directly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { durableDataRoot } from "./data-root.ts";

const STORE = path.join(durableDataRoot, "kick-hits.json");
/**
 * Where the drum stems live while they are being judged.
 *
 * Temporary in intent, not in mechanism: these are kept because the ticker plays
 * them — judging whether a tick sits on a kick is far easier against isolated
 * drums than against a full mix. They are deleted once the grids and cues they
 * inform are settled, which is what `clearKickStems` is for.
 */
export const KICK_STEM_DIRECTORY = path.join(durableDataRoot, "kick-stems");

export function kickStemPath(trackId: string) {
  // The id is used as a filename, so anything but the known-safe shape is refused.
  if (!/^[a-z0-9_-]+$/i.test(trackId)) return null;
  return path.join(KICK_STEM_DIRECTORY, `${trackId}.wav`);
}

/**
 * The audition file: the stem with everything but the kick band EQ'd away, then
 * gated.
 *
 * Judging whether a tick lands on a kick against the whole kit means judging
 * against snares and hats as well, which is not the question. This is the signal
 * the detector actually sees, so ear and detector are looking at the same thing.
 */
export function kickAuditionPath(trackId: string) {
  if (!/^[a-z0-9_-]+$/i.test(trackId)) return null;
  return path.join(KICK_STEM_DIRECTORY, `${trackId}-kick.wav`);
}

export function kickStemExists(trackId: string) {
  const file = kickStemPath(trackId);
  return !!file && existsSync(file);
}

/** The EQ'd audition if it has been rendered, otherwise the raw stem. */
export function kickPlayablePath(trackId: string) {
  const audition = kickAuditionPath(trackId);
  if (audition && existsSync(audition)) return audition;
  const stem = kickStemPath(trackId);
  return stem && existsSync(stem) ? stem : null;
}

export type StoredKickHits = {
  /** Times in milliseconds, integers, so the file stays small. */
  timesMs: number[];
  /** 0..1000 per hit, matching the times, for a future confidence gate. */
  strengths: number[];
  impliedTempo: number | null;
  detector: string;
  computedAt: string;
};

type StoreFile = { tracks: Record<string, StoredKickHits> };

let cache: StoreFile | null = null;
let cachedMtimeMs = -1;

/** Re-reads when the file changes: a separate process writes it. */
function load(): StoreFile {
  if (!existsSync(STORE)) { cache ??= { tracks: {} }; return cache; }
  const mtimeMs = statSync(STORE).mtimeMs;
  if (cache && mtimeMs === cachedMtimeMs) return cache;
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as StoreFile;
    cache = { tracks: parsed.tracks ?? {} };
    cachedMtimeMs = mtimeMs;
  } catch {
    cache ??= { tracks: {} };
  }
  return cache;
}

export function saveKickHits(trackId: string, hits: StoredKickHits) {
  const file = load();
  const next: StoreFile = { tracks: { ...file.tracks, [trackId]: hits } };
  mkdirSync(durableDataRoot, { recursive: true });
  const temporary = `${STORE}.partial`;
  writeFileSync(temporary, JSON.stringify(next));
  renameSync(temporary, STORE);
  cache = next;
  cachedMtimeMs = statSync(STORE).mtimeMs;
}

export function kickHitsFor(trackId: string) {
  const stored = load().tracks[trackId];
  if (!stored?.timesMs?.length) return null;
  return { ...stored, times: stored.timesMs.map((value) => value / 1000) };
}

export function kickHitIds() {
  return Object.keys(load().tracks);
}

export function resetKickHitsStore() {
  cache = null;
  cachedMtimeMs = -1;
}

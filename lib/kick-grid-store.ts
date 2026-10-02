/**
 * Grids fitted to detected kicks, kept so the ticker can play them.
 *
 * Stored compactly as a tempo and a first beat rather than a list of times: the
 * grid is regular by construction, so the times are derivable and storing them
 * would only invite them to drift out of step with the tempo they came from.
 *
 * The fit quality travels with the grid. A grid that explains 51% of the kicks it
 * was fitted to is not the same claim as one that explains 96%, and the ear should
 * be told which it is being asked about.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { durableDataRoot } from "./data-root.ts";

const STORE = path.join(durableDataRoot, "kick-grids.json");

export type StoredKickGrid = {
  bpm: number;
  firstBeatMs: number;
  beatCount: number;
  /** Share of detected kicks the grid lands on, 0..1. */
  explains: number;
  /** Share of grid beats that have a kick on them, 0..1. */
  covered: number;
  medianErrorMs: number;
  outliers: number;
  computedAt: string;
};

type StoreFile = { grids: Record<string, StoredKickGrid> };

let cache: StoreFile | null = null;
let cachedMtimeMs = -1;

function load(): StoreFile {
  if (!existsSync(STORE)) { cache ??= { grids: {} }; return cache; }
  const mtimeMs = statSync(STORE).mtimeMs;
  if (cache && mtimeMs === cachedMtimeMs) return cache;
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as StoreFile;
    cache = { grids: parsed.grids ?? {} };
    cachedMtimeMs = mtimeMs;
  } catch {
    cache ??= { grids: {} };
  }
  return cache;
}

export function saveKickGrid(trackId: string, grid: StoredKickGrid) {
  const file = load();
  const next: StoreFile = { grids: { ...file.grids, [trackId]: grid } };
  mkdirSync(durableDataRoot, { recursive: true });
  const temporary = `${STORE}.partial`;
  writeFileSync(temporary, JSON.stringify(next));
  renameSync(temporary, STORE);
  cache = next;
  cachedMtimeMs = statSync(STORE).mtimeMs;
}

/** Beat times rebuilt from the tempo, so they cannot disagree with it. */
export function kickGridFor(trackId: string) {
  const stored = load().grids[trackId];
  if (!stored || !(stored.bpm > 0) || stored.beatCount < 2) return null;
  const period = 60 / stored.bpm;
  const first = stored.firstBeatMs / 1000;
  const beats = Array.from({ length: stored.beatCount }, (_, index) => Math.round((first + index * period) * 1000) / 1000);
  return { ...stored, beats };
}

export function kickGridIds() {
  return Object.keys(load().grids);
}

export function resetKickGridStore() {
  cache = null;
  cachedMtimeMs = -1;
}

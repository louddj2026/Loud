/**
 * Grids fitted to percussion alone, kept so the ticker can play them.
 *
 * Separate from the library's own grids on purpose. These are candidates for the
 * ear, not replacements: nothing here overwrites a grid the DJ has already
 * validated, and the stored grid is never an input to producing one.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { durableDataRoot } from "./data-root.ts";
import type { PackedStemGrid } from "./stem-grid.ts";
import { unpackStemGrid } from "./stem-grid.ts";

const STORE = path.join(durableDataRoot, "stem-grids.json");

type StoreFile = { grids: Record<string, PackedStemGrid> };

let cache: StoreFile | null = null;
let cachedMtimeMs = -1;

/**
 * Re-reads whenever the file has changed on disk.
 *
 * The grids are produced by a separate process, so a cache held for the life of
 * the server would hide every grid built after it started — the DJ would have to
 * restart the booth to see work that had already finished.
 */
function load(): StoreFile {
  if (!existsSync(STORE)) {
    cache ??= { grids: {} };
    return cache;
  }
  const mtimeMs = statSync(STORE).mtimeMs;
  if (cache && mtimeMs === cachedMtimeMs) return cache;
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as StoreFile;
    cache = { grids: parsed.grids ?? {} };
    cachedMtimeMs = mtimeMs;
  } catch {
    // A half-written file would throw; keep whatever was last good rather than
    // dropping every grid because of one bad read.
    cache ??= { grids: {} };
  }
  return cache;
}

export function saveStemGrid(trackId: string, packed: PackedStemGrid) {
  const file = load();
  const next: StoreFile = { grids: { ...file.grids, [trackId]: packed } };
  mkdirSync(durableDataRoot, { recursive: true });
  // Write then rename: a crash mid-write must not cost every grid produced so far.
  const temporary = `${STORE}.partial`;
  writeFileSync(temporary, JSON.stringify(next));
  renameSync(temporary, STORE);
  cache = next;
  cachedMtimeMs = statSync(STORE).mtimeMs;
}

export function stemGridFor(trackId: string) {
  const packed = load().grids[trackId];
  if (!packed) return null;
  return { packed, beats: unpackStemGrid(packed) };
}

export function stemGridIds() {
  return Object.keys(load().grids);
}

export function resetStemGridStore() {
  cache = null;
  cachedMtimeMs = -1;
}

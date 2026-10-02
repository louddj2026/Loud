/**
 * Which tracks have had their stored grid judged by ear.
 *
 * Only `grid-check.json` is read here, and deliberately. It is the file that
 * answers "is the library's own grid clean" — the other three verdict files ask
 * about detected kicks, a stem-fitted grid and a kick-fitted grid, which are
 * different questions about different beat times. Any of them would be the wrong
 * thing to check before replacing the library's grid.
 *
 * A verdict of any kind counts, including `flam` and `unsure`. The point is not
 * that the grid is good — it is that the verdict describes *that* grid, so
 * replacing it would leave a judgement attached to beat times nobody ever heard.
 * 68 of those verdicts exist and they are the most valuable measurement in the
 * project.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { durableDataRoot } from "./data-root.ts";
import { parseGridCheckRecord } from "./grid-check.ts";

const STORE = path.join(durableDataRoot, "grid-check.json");

let cache: Set<string> | null = null;
let cachedMtimeMs = -1;

/** Re-reads when the file changes: the grid-check pass writes it as you listen. */
function load(): Set<string> {
  if (!existsSync(STORE)) { cache ??= new Set(); return cache; }
  const mtimeMs = statSync(STORE).mtimeMs;
  if (cache && mtimeMs === cachedMtimeMs) return cache;
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as Record<string, unknown>;
    const judged = new Set<string>();
    for (const [id, value] of Object.entries(parsed)) {
      if (parseGridCheckRecord(value)) judged.add(id);
    }
    cache = judged;
    cachedMtimeMs = mtimeMs;
  } catch {
    cache ??= new Set();
  }
  return cache;
}

export function storedGridJudged(trackId: string) {
  return load().has(trackId);
}

export function judgedGridIds() {
  return [...load()];
}

export function resetGridVerdictStore() {
  cache = null;
  cachedMtimeMs = -1;
}

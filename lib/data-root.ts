import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// Keep every durable Crowd file under one configurable root. The booth's
// standalone runtime sets CROWD_DATA_ROOT so uploads, the DJ memory database,
// and teaching undo history all survive a runtime reinstall together; a plain
// project checkout falls back to its own data folder. Resolve this exactly
// once so no store can drift onto a different root.
export const durableDataRoot = process.env.CROWD_DATA_ROOT ?? path.join(process.cwd(), "data");

// Adopt a durable file that an earlier build wrote under a previous data
// root. The copy happens only when the configured location is still empty, so
// an already-populated root is never overwritten, and a missing legacy file is
// simply skipped rather than treated as a failure.
export function adoptLegacyDurableFile(file: string, legacyFiles: readonly string[]) {
  if (existsSync(file)) return false;
  for (const legacyFile of legacyFiles) {
    if (path.resolve(legacyFile) === path.resolve(file)) continue;
    if (!existsSync(legacyFile)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    copyFileSync(legacyFile, file);
    return true;
  }
  return false;
}

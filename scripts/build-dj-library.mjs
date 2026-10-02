import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rememberCompactDjRecord } from "../lib/dj-library.ts";
import { getMusicLibrary, resolveMusicPath } from "../lib/music-library.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analysisDirectory = path.join(root, "public", "analysis");
const tracks = new Map((await getMusicLibrary()).tracks.map((track) => [track.id, track]));
const files = (await readdir(analysisDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json" && !entry.name.startsWith("beat-this-"));

let remembered = 0;
for (const [index, entry] of files.entries()) {
  const analysis = JSON.parse(await readFile(path.join(analysisDirectory, entry.name), "utf8"));
  const track = tracks.get(analysis.track?.id ?? path.basename(entry.name, ".json"));
  if (!track) continue;
  const sourceFile = await resolveMusicPath(track);
  const fileStat = await stat(sourceFile).catch(() => null);
  const record = await rememberCompactDjRecord(track, analysis, fileStat ? { size: fileStat.size, modifiedMs: Math.round(fileStat.mtimeMs) } : null);
  remembered += 1;
  process.stdout.write(`[${index + 1}/${files.length}] remembered ${record.name}\n`);
}

console.log(`Compact DJ library contains ${remembered} mapped tracks.`);

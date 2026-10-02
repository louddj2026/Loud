import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.CROWD_ELEMENTS_ROOT?.trim()) throw new Error("Set CROWD_ELEMENTS_ROOT to the music folder to index.");
const crateRoot = path.resolve(process.env.CROWD_ELEMENTS_ROOT);
const output = path.join(projectRoot, "data", "elements-crate.json");
const audioExtensions = new Set([".mp3", ".wav", ".flac", ".m4a", ".aiff", ".aif", ".ogg"]);
const ignoredDirectories = new Set(["archive", "$recycle.bin", "recycler", "system volume information", "$avg", "$avg8.vault$"]);
const tracks = [];
const pending = [{ absolute: crateRoot, relative: "" }];

while (pending.length) {
  const current = pending.pop();
  let entries;
  try { entries = await readdir(current.absolute, { withFileTypes: true }); }
  catch { continue; }
  for (const entry of entries) {
    const relative = path.join(current.relative, entry.name);
    const absolute = path.join(current.absolute, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name.toLowerCase())) pending.push({ absolute, relative });
      continue;
    }
    if (!entry.isFile() || !audioExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const album = relative.split(path.sep)[0] || "Elements";
    const id = `elements-${createHash("sha1").update(relative.toLowerCase()).digest("hex").slice(0, 14)}`;
    tracks.push({
      id,
      name: path.basename(entry.name, path.extname(entry.name)),
      file: entry.name,
      duration: 0,
      album,
      source: "elements",
      relativePath: relative,
    });
  }
}

tracks.sort((left, right) => left.album.localeCompare(right.album) || left.name.localeCompare(right.name));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ root: crateRoot, generatedAt: new Date().toISOString(), tracks }));
console.log(`Indexed ${tracks.length} tracks across ${new Set(tracks.map((track) => track.album)).size} albums; Archive was ignored.`);

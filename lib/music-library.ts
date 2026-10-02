import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { adoptLegacyDurableFile, durableDataRoot } from "./data-root.ts";

export type MusicTrack = {
  id: string;
  name: string;
  file: string;
  duration: number;
  album: string;
  source: "built-in" | "elements" | "uploaded";
  relativePath?: string;
  size?: number;
  modifiedMs?: number;
};

type ExternalCrate = { root: string; generatedAt: string; tracks: MusicTrack[] };
type Cache = { signature: string; tracks: MusicTrack[]; externalRoot: string; externalGeneratedAt: string };

const globalLibrary = globalThis as typeof globalThis & { __crowd2MusicLibrary?: Cache; __crowd2ResolvedExternalRoot?: string };
const projectRoot = process.cwd();
const builtInFile = path.join(projectRoot, "public", "audio", "library.json");
const externalFile = path.join(projectRoot, "data", "elements-crate.json");
// Keep local DJ uploads beside Crowd's other durable data. The booth's
// standalone runtime mounts this directory back to the writable project data
// folder, whereas LOCALAPPDATA may be read-only in managed desktop runtimes.
// Hosted installations can still point at a persistent volume explicitly.
const uploadedDirectory = path.join(durableDataRoot, "uploads");
const uploadedIndexFile = path.join(durableDataRoot, "uploaded-tracks.json");
// Earlier builds kept the upload index beside the project itself or under the
// project data folder. Adopt whichever legacy index exists so previously
// uploaded tunes stay visible after a data-root move, even when their audio
// files have to be re-uploaded before they can stream again.
adoptLegacyDurableFile(uploadedIndexFile, [
  path.join(projectRoot, "data", "uploaded-tracks.json"),
  path.join(projectRoot, "uploaded-tracks.json"),
]);
const allowedUploadExtensions = new Set([".mp3", ".wav", ".flac", ".m4a", ".mp4", ".aiff", ".aif", ".ogg", ".ape"]);

async function modified(file: string) {
  return stat(file).then((value) => value.mtimeMs).catch(() => 0);
}

export async function getMusicLibrary() {
  const signature = `${await modified(builtInFile)}:${await modified(externalFile)}:${await modified(uploadedIndexFile)}`;
  if (globalLibrary.__crowd2MusicLibrary?.signature === signature) return globalLibrary.__crowd2MusicLibrary;
  const builtIn = await readFile(builtInFile, "utf8")
    .then((text) => JSON.parse(text) as Array<Omit<MusicTrack, "album" | "source">>)
    .catch(() => []);
  const external = await readFile(externalFile, "utf8").then((text) => JSON.parse(text) as ExternalCrate).catch(() => ({ root: "D:\\", generatedAt: "", tracks: [] }));
  const uploaded = await readFile(uploadedIndexFile, "utf8").then((text) => JSON.parse(text) as MusicTrack[]).catch(() => []);
  const tracks: MusicTrack[] = [
    ...builtIn.map((track) => ({ ...track, album: "Crowd2 original crate", source: "built-in" as const })),
    ...external.tracks,
    ...uploaded,
  ];
  const cache = { signature, tracks, externalRoot: external.root, externalGeneratedAt: external.generatedAt };
  globalLibrary.__crowd2MusicLibrary = cache;
  return cache;
}

export async function getMusicTrack(id: string) {
  const library = await getMusicLibrary();
  return library.tracks.find((track) => track.id === id) ?? null;
}

export async function resolveMusicPath(track: MusicTrack) {
  if (track.source === "built-in") return path.join(projectRoot, "public", "audio", track.file);
  if (track.source === "uploaded") {
    if (!track.relativePath) throw new Error(`Uploaded path missing for ${track.name}`);
    const resolved = path.resolve(uploadedDirectory, track.relativePath);
    const prefix = uploadedDirectory.endsWith(path.sep) ? uploadedDirectory : `${uploadedDirectory}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw new Error("Uploaded track escaped the upload directory");
    return resolved;
  }
  const library = await getMusicLibrary();
  if (!track.relativePath) throw new Error(`External path missing for ${track.name}`);
  const configuredRoot = path.resolve(library.externalRoot);
  const candidateRoots = [
    globalLibrary.__crowd2ResolvedExternalRoot,
    process.env.CROWD_ELEMENTS_ROOT,
    configuredRoot,
    ...(process.platform === "win32"
      ? Array.from({ length: 23 }, (_, index) => `${String.fromCharCode(68 + index)}:\\`)
      : []),
  ].filter((root): root is string => Boolean(root));
  const checked = new Set<string>();
  let configuredPath = "";
  for (const candidateRoot of candidateRoots) {
    const root = path.resolve(candidateRoot);
    if (checked.has(root.toLowerCase())) continue;
    checked.add(root.toLowerCase());
    const resolved = path.resolve(root, track.relativePath);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(prefix)) throw new Error("External track escaped the configured crate root");
    if (root === configuredRoot) configuredPath = resolved;
    const info = await stat(resolved).catch(() => null);
    if (info?.isFile()) {
      globalLibrary.__crowd2ResolvedExternalRoot = root;
      return resolved;
    }
  }
  return configuredPath || path.resolve(configuredRoot, track.relativePath);
}

export function trackAudioUrl(track: MusicTrack) {
  return track.source === "built-in" ? `/audio/${encodeURIComponent(track.file)}` : `/api/audio/${encodeURIComponent(track.id)}`;
}

function uploadExtension(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (!allowedUploadExtensions.has(extension)) throw new Error("Choose an MP3, WAV, FLAC, M4A, MP4, AIFF, OGG or APE audio file.");
  return extension;
}

async function rememberUploadedTrack(name: string, extension: string, digest: string, size: number) {
  const id = `upload-${digest}`;
  const storedName = `${digest}${extension}`;
  const existing = await readFile(uploadedIndexFile, "utf8").then((text) => JSON.parse(text) as MusicTrack[]).catch(() => []);
  const track: MusicTrack = {
    id,
    name: path.basename(name, extension),
    file: storedName,
    duration: 0,
    album: "User uploads",
    source: "uploaded",
    relativePath: storedName,
    size,
    modifiedMs: Date.now(),
  };
  const next = [...existing.filter((item) => item.id !== id), track];
  await writeFile(uploadedIndexFile, JSON.stringify(next, null, 2));
  globalLibrary.__crowd2MusicLibrary = undefined;
  return track;
}

export async function registerUploadedTrack(name: string, bytes: Uint8Array) {
  const extension = uploadExtension(name);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  await mkdir(uploadedDirectory, { recursive: true });
  await writeFile(path.join(uploadedDirectory, `${digest}${extension}`), bytes);
  return rememberUploadedTrack(name, extension, digest, bytes.byteLength);
}

export async function registerUploadedTrackStream(name: string, stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const extension = uploadExtension(name);
  await mkdir(uploadedDirectory, { recursive: true });
  const temporaryPath = path.join(uploadedDirectory, `.crowd-upload-${randomUUID()}.part`);
  const handle = await open(temporaryPath, "wx");
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("That audio file is larger than the current 300 MB upload limit.");
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
        if (!bytesWritten) throw new Error("The selected audio file stopped while it was being copied.");
        offset += bytesWritten;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (!size) {
    await rm(temporaryPath, { force: true });
    throw new Error("That audio file is empty.");
  }
  const digest = hash.digest("hex").slice(0, 24);
  const storedPath = path.join(uploadedDirectory, `${digest}${extension}`);
  try {
    await rename(temporaryPath, storedPath);
  } catch (error) {
    const existing = await stat(storedPath).catch(() => null);
    if (!existing?.isFile()) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    await rm(temporaryPath, { force: true });
  }
  return rememberUploadedTrack(name, extension, digest, size);
}

export function publicTrack(track: MusicTrack) {
  return {
    id: track.id,
    name: track.name,
    file: track.file,
    duration: track.duration,
    album: track.album,
    source: track.source,
  };
}

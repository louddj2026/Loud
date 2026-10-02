import { randomUUID } from "node:crypto";
import { copyFile, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "./data-root.ts";
import { clearPendingTeachingBatch, readPendingTeachingBatch } from "./dj-library.ts";
import type { TeachableAnalysis } from "./teaching.ts";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");
const undoDirectory = path.join(durableDataRoot, "teaching-undo");
const teachingBatchDirectory = path.join(undoDirectory, "batches");

type TeachingUndoRecord = {
  token: string;
  trackId: string;
  analysis: TeachableAnalysis;
  momentIds: number[];
  createdAt: string;
};

type TeachingBatchManifest = {
  batchId: string;
  createdAt: string;
  entries: Array<{ id: string; undoToken: string }>;
};

export function teachingBatchPath(batchId: string) {
  if (!/^[a-z0-9-]+$/i.test(batchId)) throw new Error("Unsafe teaching batch ID");
  return path.join(teachingBatchDirectory, batchId);
}

export async function syncFileForDurability(file: string) {
  // Windows rejects FlushFileBuffers (fsync) on a read-only handle with EPERM.
  // Open the already-created file without truncating it, but with write access,
  // so the durability barrier works on Windows as well as POSIX systems.
  const handle = await open(file, "r+");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

export async function syncDirectoryBestEffort(directory: string) {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function durableWriteFile(file: string, contents: string) {
  const handle = await open(file, "w");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicPromote(source: string, destination: string, batchId: string, label: string) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${batchId}.${label}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await syncFileForDurability(temporary);
    await rename(temporary, destination);
    await syncFileForDurability(destination);
    await syncDirectoryBestEffort(path.dirname(destination));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Complete an interrupted pair promotion before any analysis reader proceeds. */
export async function recoverPendingTeachingBatch() {
  const pending = await readPendingTeachingBatch();
  if (!pending) return false;
  const directory = teachingBatchPath(pending.batchId);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as TeachingBatchManifest;
  if (manifest.batchId !== pending.batchId || manifest.entries.length !== 2) throw new Error("The pending transition-pair manifest is invalid");
  for (const entry of manifest.entries) {
    const momentIds = pending.momentIdsByTrack[entry.id];
    if (!Array.isArray(momentIds)) throw new Error(`The pending transition pair is missing ${entry.id}'s teaching moments`);
    const original = JSON.parse(await readFile(path.join(directory, `original-${entry.id}.json`), "utf8")) as TeachableAnalysis;
    const undoRecord: TeachingUndoRecord = { token: entry.undoToken, trackId: entry.id, analysis: original, momentIds, createdAt: manifest.createdAt };
    await durableWriteFile(path.join(directory, `undo-${entry.id}.json`), JSON.stringify(undoRecord));
  }
  await syncDirectoryBestEffort(directory);
  for (const entry of manifest.entries) {
    await atomicPromote(path.join(directory, `corrected-${entry.id}.json`), path.join(analysisDirectory, `${entry.id}.json`), pending.batchId, `${entry.id}-analysis`);
    await atomicPromote(path.join(directory, `undo-${entry.id}.json`), path.join(undoDirectory, `${entry.id}.json`), pending.batchId, `${entry.id}-undo`);
  }
  if (!await clearPendingTeachingBatch(pending.batchId)) throw new Error("A newer teaching batch replaced the pending transition pair");
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  await syncDirectoryBestEffort(teachingBatchDirectory);
  return true;
}

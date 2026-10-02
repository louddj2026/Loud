/**
 * On-demand section labels: one GPU job at a time, never while a deck is playing.
 *
 * All-In-One lives in WSL2 because `natten` has never shipped a Windows wheel
 * (docs/allin1-setup.md). So a job is a `wsl.exe` spawn, and every path crossing
 * that boundary has to be translated.
 *
 * Two rules this exists to enforce:
 *
 *  - **One job, and only while the booth is idle.** A job takes ~90 s of GPU and
 *    All-In-One's first stage is a full HTDemucs separation. Running that against
 *    live audio is the one outcome worth engineering against, so the worker will
 *    not *start* a job unless the booth has recently reported nothing playing. A
 *    job already running is left alone: killing a separation mid-way wastes the
 *    GPU time and leaves byproducts behind.
 *  - **Labels only.** The script discards All-In-One's BPM and downbeats before
 *    they ever reach Node. Its BPM is integer-only and its downbeats sit ~29 ms
 *    off a grid that passed a listening test.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "./music-library.ts";
import { hasCompactDjRecord } from "./dj-library.ts";
import { seekAccuratePath } from "./playback-clock.ts";
import { normaliseSectionLabel } from "./section-patterns.ts";
import { recordSectionFailure, saveSectionSpans, sectionAnalysisWorthTrying } from "./section-label-store.ts";

/** How long a report of "nothing is playing" stays trustworthy. */
export const BOOTH_IDLE_TRUST_MS = 30_000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

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

type Runtime = {
  queue: string[];
  running: string | null;
  runningName: string | null;
  worker: Promise<void> | null;
  completed: number;
  failed: number;
  lastError: string | null;
  idleAt: number;
  idle: boolean;
};

const globals = globalThis as typeof globalThis & { __crowd2SectionAnalysis?: Runtime };
const runtime: Runtime = globals.__crowd2SectionAnalysis ??= {
  queue: [], running: null, runningName: null, worker: null,
  completed: 0, failed: 0, lastError: null, idleAt: 0, idle: false,
};

/** `D:\Music\x.mp3` -> `/mnt/d/Music/x.mp3`. */
export function toWslPath(windowsPath: string) {
  const absolute = path.resolve(windowsPath);
  const drive = absolute.match(/^([A-Za-z]):[\\/]/);
  if (!drive) return absolute.replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${absolute.slice(3).replace(/\\/g, "/")}`;
}

function boothIsIdle() {
  return runtime.idle && Date.now() - runtime.idleAt <= BOOTH_IDLE_TRUST_MS;
}

/** The booth tells the server what it cannot know for itself. */
export function reportBoothIdle(idle: boolean) {
  runtime.idle = idle;
  runtime.idleAt = Date.now();
  if (idle) start();
}

export function status(): SectionAnalysisStatus {
  return {
    running: runtime.running,
    runningName: runtime.runningName,
    queued: [...runtime.queue],
    completed: runtime.completed,
    failed: runtime.failed,
    lastError: runtime.lastError,
    boothIdle: boothIsIdle(),
    waitingForIdle: (runtime.queue.length > 0 || runtime.running !== null) && !boothIsIdle(),
  };
}

/**
 * A file the browser opened from disk, which the server has never received.
 *
 * These ids are minted client-side, so there is no path to give All-In-One. They
 * are refused here rather than allowed to fail in the worker: a failure would
 * record an attempt and report "not in the music library", which is true but
 * misleading — nothing is wrong with the track.
 */
export function isLocalOnlyTrack(trackId: string) {
  return trackId.startsWith("local-");
}

export function enqueueSectionAnalysis(trackId: string) {
  if (process.env.CROWD_SECTION_ANALYSIS === "disabled") {
    runtime.lastError = "Song-section analysis is not installed. Use Set up song sections from the Crowd2 Start menu, then reopen the booth.";
    return false;
  }
  if (!trackId || typeof trackId !== "string") return false;
  if (isLocalOnlyTrack(trackId)) return false;
  if (runtime.running === trackId || runtime.queue.includes(trackId)) return false;
  if (!sectionAnalysisWorthTrying(trackId)) return false;
  runtime.queue.push(trackId);
  start();
  return true;
}

function start() {
  if (!runtime.worker) runtime.worker = runWorker().finally(() => { runtime.worker = null; });
}

/**
 * The next tune to analyse, or null when none is ready yet.
 *
 * DJ, 26 Aug 2026: All-In-One runs LAST — separation and the stem-fed grid
 * analysis own the GPU first. A tune whose grid record is not on disk yet
 * keeps its place in the queue and is passed over; the client's poll
 * re-nudges (reportBoothIdle/enqueue restart the worker), so it is picked up
 * promptly once the grid lands. One pass, oldest first; a tune no longer
 * worth trying is dropped.
 *
 * 26 Sep 2026: this used to take each tune out of the queue, check it, and
 * push it back. The POST route reports idle (starting this worker, which took
 * the tune out) before enqueueing the same tune — which, no longer queued,
 * went in again: one deck was enough to hold a tune twice. From two entries
 * waiting for grids the rotation never ended, and because hasCompactDjRecord
 * answers synchronously every await settled on the microtask queue: timers
 * and HTTP starved and the whole server froze until the booth's idle report
 * went stale 30 s later, then the next heartbeat started it again — the
 * "30.0 s" stall that made loads look frozen (NOTE-server-stalls-26aug.md).
 * Waiting tunes now never leave the queue, so they cannot be duplicated.
 */
async function nextReadyTrack() {
  const unqueue = (trackId: string) => {
    runtime.queue = runtime.queue.filter((queued) => queued !== trackId);
  };
  for (const candidate of new Set(runtime.queue)) {
    if (!sectionAnalysisWorthTrying(candidate)) { unqueue(candidate); continue; }
    if (await hasCompactDjRecord(candidate)) { unqueue(candidate); return candidate; }
  }
  return null;
}

async function runWorker() {
  while (runtime.queue.length) {
    // Hold the queue rather than the GPU: a job is only ever started when the
    // booth is quiet, and the client keeps that report fresh while it waits.
    if (!boothIsIdle()) return;
    const trackId = await nextReadyTrack();
    // Nothing ready: stop, every waiting tune keeping its place, and yield the
    // event loop instead of spinning on it.
    if (trackId === null) return;
    runtime.running = trackId;
    try {
      const track = await getMusicTrack(trackId);
      if (!track) throw new Error("that track is not in the music library");
      runtime.runningName = track.name ?? trackId;
      // Same clock the booth plays — section spans line up with the corrected
      // kick maps (see lib/playback-clock.ts).
      const file = await seekAccuratePath(await resolveMusicPath(track));
      if (!file) throw new Error("no audio file for that track");
      const segments = await analyse(file);
      const spans = segments
        .map((segment) => ({ start: segment.start, end: segment.end, label: normaliseSectionLabel(segment.label) }))
        .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start);
      if (!spans.length) throw new Error("All-In-One returned no usable segments");
      saveSectionSpans(trackId, spans);
      runtime.completed += 1;
      runtime.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "section analysis failed";
      recordSectionFailure(trackId, message);
      runtime.failed += 1;
      runtime.lastError = `${runtime.runningName ?? trackId}: ${message}`;
    } finally {
      runtime.running = null;
      runtime.runningName = null;
    }
  }
}

// DJ, 27 Aug 2026: shared-demix entries are a hand-off between separation
// and this stage; a tune whose sections never run leaves ~280 MB stranded.
// Sweep anything older than a day before each run — never the fresh ones.
function sweepStaleDemixEntries() {
  const root = path.join(process.cwd(), "data", "demix-cache", "htdemucs");
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(root)) {
      const entry = path.join(root, name);
      try {
        if (statSync(entry).mtimeMs < cutoff) {
          rmSync(entry, { recursive: true, force: true });
          console.log(`[sections] swept stale demix entry ${name}`);
        }
      } catch { /* a vanished entry mid-scan is fine */ }
    }
  } catch { /* no cache directory yet */ }
}

function analyse(audioFile: string): Promise<Array<{ start: number; end: number; label: string }>> {
  sweepStaleDemixEntries();
  const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-sections-"));
  const resultFile = path.join(scratch, "sections.json");
  const script = path.join(process.cwd(), "scripts", "section-analyse.py");
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", [
      "-d", process.env.CROWD_SECTION_DISTRIBUTION?.trim() || "Ubuntu-24.04",
      "-u", "root",
      "--",
      process.env.CROWD_SECTION_PYTHON?.trim() || "/opt/allin1/bin/python",
      toWslPath(script),
      toWslPath(audioFile),
      toWslPath(resultFile),
      // DJ, 27 Aug 2026 (shared demix): "-" = no stems export; the fourth
      // argument points All-In-One at the demix the drums-stem pass already
      // parked, so its internal Demucs is skipped and deleted-after-use.
      "-",
      toWslPath(path.join(process.cwd(), "data", "demix-cache")),
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    // All-In-One writes a wall of progress bars; only the tail is worth keeping
    // for a failure message.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("section analysis timed out"));
    }, JOB_TIMEOUT_MS);
    const done = (error: Error | null, segments?: Array<{ start: number; end: number; label: string }>) => {
      clearTimeout(timer);
      try { rmSync(scratch, { recursive: true, force: true }); } catch { /* a temp dir left behind is not worth failing over */ }
      if (error) reject(error); else resolve(segments ?? []);
    };
    child.on("error", (error) => done(new Error(`could not start WSL: ${error.message}`)));
    child.on("close", () => {
      let payload: { ok?: boolean; segments?: Array<{ start: number; end: number; label: string }>; error?: string };
      try {
        payload = JSON.parse(readFileSync(resultFile, "utf8"));
      } catch {
        return done(new Error(stderr.split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? "All-In-One produced no result"));
      }
      if (!payload.ok) return done(new Error(payload.error ?? "All-In-One reported a failure"));
      done(null, payload.segments ?? []);
    });
  });
}

/** Test seam. */
export function resetSectionAnalysis() {
  runtime.queue = [];
  runtime.running = null;
  runtime.runningName = null;
  runtime.worker = null;
  runtime.completed = 0;
  runtime.failed = 0;
  runtime.lastError = null;
  runtime.idle = false;
  runtime.idleAt = 0;
}

import { spawn, type ChildProcess } from "node:child_process";
import { access, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { probeAudioDuration } from "../../../lib/audio-duration";
import { reconcileCrateScanCursor, type CrateScanResumePosition } from "../../../lib/crate-scan-resume";
import { hasCompactDjRecord, readCompactDjIndex, readDjLibraryMeta, writeDjLibraryMeta } from "../../../lib/dj-library";
import { getMusicLibrary, resolveMusicPath, type MusicTrack } from "../../../lib/music-library";
import { MINIMUM_FULL_TUNE_SECONDS } from "../../../lib/track-duration-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanStatus = "idle" | "running" | "paused" | "complete" | "error";
type CrateScanState = CrateScanResumePosition & {
  status: ScanStatus;
  totalFiles: number;
  currentId: string | null;
  currentName: string | null;
  currentStage: string;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  error: string | null;
  minimumDurationSeconds: number;
};

type ScanRuntime = { state: CrateScanState | null; worker: Promise<void> | null; keepAwake: ChildProcess | null };
const globals = globalThis as typeof globalThis & { __crowd2CrateScan?: ScanRuntime };
const scan = globals.__crowd2CrateScan ??= { state: null, worker: null, keepAwake: null };
const root = process.cwd();
const analysisDirectory = path.join(root, "public", "analysis");
const ffmpegExecutable = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
// The worker keeps only one detailed analysis in flight, then replaces it with
// a roughly 15 KB compact record. A 1.5 GB floor still leaves ample transient
// headroom without refusing to start on this deliberately small system drive.
const MINIMUM_FREE_GB = 1.5;
const MINIMUM_FREE_BYTES = MINIMUM_FREE_GB * 1024 ** 3;

function emptyState(totalFiles = 0): CrateScanState {
  return { status: "idle", totalFiles, cursor: 0, checked: 0, mapped: 0, rejected: 0, skippedShort: 0, skippedKnown: 0, compacted: 0, rejectedIds: [], skippedShortIds: [], crateGeneratedAt: null, currentId: null, currentName: null, currentStage: "Ready", startedAt: null, updatedAt: Date.now(), completedAt: null, error: null, minimumDurationSeconds: MINIMUM_FULL_TUNE_SECONDS };
}

async function loadState(totalFiles: number) {
  if (scan.state) return scan.state;
  scan.state = await readDjLibraryMeta("crate-scan", emptyState(totalFiles));
  scan.state.totalFiles = totalFiles;
  scan.state.compacted ??= 0;
  scan.state.rejectedIds ??= [];
  scan.state.skippedShortIds ??= [];
  scan.state.crateGeneratedAt ??= null;
  if (scan.state.status === "running") scan.state.status = "paused";
  return scan.state;
}

async function saveState() {
  if (!scan.state) return;
  scan.state.updatedAt = Date.now();
  await writeDjLibraryMeta("crate-scan", scan.state);
}

function startKeepAwake() {
  if (scan.keepAwake && scan.keepAwake.exitCode === null) return;
  scan.keepAwake = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", path.join(root, "scripts", "keep-awake.ps1"), "-ParentPid", String(process.pid)], { cwd: root, windowsHide: true, stdio: "ignore" });
}

function stopKeepAwake() {
  if (scan.keepAwake?.exitCode === null) scan.keepAwake.kill();
  scan.keepAwake = null;
}

async function exists(file: string) {
  return access(file).then(() => true).catch(() => false);
}

async function mapTrack(origin: string, track: MusicTrack, force = false) {
  const response = await fetch(`${origin}/api/map`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: track.id, force }) });
  if (response.status === 409) return "mapped" as const;
  if (response.status === 422) return "rejected" as const;
  if (!response.ok && response.status !== 202) return "rejected" as const;
  while (scan.state?.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = await fetch(`${origin}/api/map?id=${encodeURIComponent(track.id)}&v=${Date.now()}`, { cache: "no-store" }).then((result) => result.json()) as { mapped?: boolean; job?: { state?: string; stage?: string; detail?: string } | null };
    if (state.mapped) return "mapped" as const;
    if (state.job?.state === "error") return "rejected" as const;
    if (scan.state) scan.state.currentStage = state.job?.detail ?? state.job?.stage ?? "Mapping";
  }
  return "paused" as const;
}

async function runWorker(origin: string) {
  const library = await getMusicLibrary();
  const tracks = library.tracks.filter((track) => track.source === "elements");
  const state = await loadState(tracks.length);
  // The cursor is a position in the album/name-sorted crate listing, so it is
  // only trustworthy while data/elements-crate.json is the exact listing it
  // was advanced through. After a re-index the walk restarts from zero; the
  // remembered outcome ids below keep that re-walk to cheap set lookups.
  reconcileCrateScanCursor(state, library.externalGeneratedAt);
  // Older compact records remain usable, but the crate scan revisits them once
  // so the single database also gains the complete per-beat compatibility
  // feature stream used by current cue-pair and rundown scoring.
  const compactIndex = await readCompactDjIndex();
  const known = new Set(compactIndex.filter((track) => track.featureVersion >= 2).map((track) => track.id));
  const legacy = new Set(compactIndex.filter((track) => track.featureVersion < 2).map((track) => track.id));
  const rejectedIds = new Set(state.rejectedIds);
  const skippedShortIds = new Set(state.skippedShortIds);
  startKeepAwake();
  try {
    while (state.status === "running" && state.cursor < tracks.length) {
      const disk = await statfs(root);
      if (disk.bavail * disk.bsize < MINIMUM_FREE_BYTES) {
        state.status = "paused";
        state.error = `Paused before the system drive fell below ${MINIMUM_FREE_GB} GB free`;
        state.currentStage = "LOW DISK SPACE";
        break;
      }
      const track = tracks[state.cursor];
      state.currentId = track.id;
      state.currentName = track.name;
      state.currentStage = "Checking file duration";
      if (known.has(track.id) || await exists(path.join(analysisDirectory, `${track.id}.json`))) {
        state.skippedKnown += 1;
      } else if (rejectedIds.has(track.id)) {
        // Remembered from an earlier walk over a since-re-indexed crate: keep
        // the verdict without re-probing or re-mapping. Restart clears these.
        state.rejected += 1;
      } else if (skippedShortIds.has(track.id)) {
        state.skippedShort += 1;
      } else {
        const duration = await probeAudioDuration(ffmpegExecutable, await resolveMusicPath(track));
        if (duration !== null && duration < MINIMUM_FULL_TUNE_SECONDS) {
          state.skippedShort += 1;
          skippedShortIds.add(track.id);
          state.skippedShortIds.push(track.id);
        }
        else {
          state.currentStage = duration === null
            ? "Mapping track whose duration could not be confirmed"
            : `Mapping ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, "0")} track`;
          const result = await mapTrack(origin, track, legacy.has(track.id));
          if (result === "paused") break;
          if (result === "mapped") {
            // analyse-library has already written the reusable compact record.
            // Whole-crate scans discard the large display-resolution evidence;
            // it can be regenerated if this tune is later loaded onto a deck.
            if (!await hasCompactDjRecord(track.id)) throw new Error(`Compact grid record was not written for ${track.name}; detailed evidence was preserved`);
            await Promise.all([
              rm(path.join(analysisDirectory, `${track.id}.json`), { force: true }),
              rm(path.join(analysisDirectory, `beat-this-${track.id}.json`), { force: true }),
            ]);
            state.mapped += 1;
            state.compacted += 1;
            known.add(track.id);
            legacy.delete(track.id);
          }
          else {
            state.rejected += 1;
            rejectedIds.add(track.id);
            state.rejectedIds.push(track.id);
          }
        }
      }
      state.cursor += 1;
      state.checked += 1;
      state.error = null;
      await saveState();
    }
    if (state.cursor >= tracks.length) {
      state.status = "complete";
      state.completedAt = Date.now();
      state.currentId = null;
      state.currentName = null;
      state.currentStage = "Whole crate checked";
    }
  } catch (error) {
    state.status = "error";
    state.error = error instanceof Error ? error.message : String(error);
    state.currentStage = "Scan stopped";
  } finally {
    stopKeepAwake();
    await saveState();
    scan.worker = null;
  }
}

function startWorker(origin: string) {
  if (!scan.worker) scan.worker = runWorker(origin);
}

function scanProgress(state: CrateScanState) {
  const { rejectedIds, skippedShortIds, ...summary } = state;
  const elapsedSeconds = state.startedAt ? Math.max(1, (Date.now() - state.startedAt) / 1000) : 0;
  const filesPerHour = elapsedSeconds ? state.checked / elapsedSeconds * 3600 : 0;
  const discoveredSongs = state.mapped + state.rejected + state.skippedKnown;
  const estimatedSongsTotal = state.checked >= 20
    ? Math.max(discoveredSongs, Math.round(state.totalFiles * discoveredSongs / state.checked))
    : null;
  const estimatedSongsRemaining = estimatedSongsTotal === null ? null : Math.max(0, estimatedSongsTotal - discoveredSongs);
  const remainingFiles = Math.max(0, state.totalFiles - state.checked);
  const estimatedSecondsRemaining = filesPerHour > 0 && state.status !== "complete" ? remainingFiles / filesPerHour * 3600 : state.status === "complete" ? 0 : null;
  return {
    ...summary,
    elapsedSeconds,
    filesPerHour,
    discoveredSongs,
    estimatedSongsTotal,
    estimatedSongsRemaining,
    estimatedSecondsRemaining,
    progressPercent: state.totalFiles ? state.checked / state.totalFiles * 100 : 0,
  };
}

export async function GET() {
  const library = await getMusicLibrary();
  const total = library.tracks.filter((track) => track.source === "elements").length;
  return Response.json(scanProgress(await loadState(total)), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const library = await getMusicLibrary();
  const total = library.tracks.filter((track) => track.source === "elements").length;
  const state = await loadState(total);
  const body = await request.json().catch(() => ({})) as { action?: "start" | "resume" | "pause" | "restart" };
  if (body.action === "pause") {
    state.status = "paused";
    state.currentStage = "Pausing after the current mapper operation";
    stopKeepAwake();
    await saveState();
    return Response.json(scanProgress(state));
  }
  if (body.action === "restart") Object.assign(state, emptyState(total));
  state.status = "running";
  state.startedAt ??= Date.now();
  state.completedAt = null;
  state.error = null;
  state.currentStage = state.cursor ? "Resuming whole-crate scan" : "Starting whole-crate scan";
  await saveState();
  startWorker(new URL(request.url).origin);
  return Response.json(scanProgress(state), { status: 202 });
}

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, appendFile, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants as osPriority, setPriority } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { trackAnalysisUrl } from "../../../lib/analysis-delivery";
import { modelWorkerEnv, resolveAnalysisRuntime } from "../../../lib/analysis-runtime";
import { localBeatThisInstall } from "../../../lib/beat-this-runtime";
import { forgetCompactDjRecord, hasCompactDjRecord, readCompactDjIndex, readTrackIntelligenceIndex, readTrackIntelligenceSummary, type TrackIntelligenceSummary } from "../../../lib/dj-library";
import { durableDataRoot } from "../../../lib/data-root";
import { kickStemPath } from "../../../lib/kick-hits-store";
import { friendlyMappingError } from "../../../lib/mapping-error";
import { getMusicLibrary, publicTrack, resolveMusicPath, trackAudioUrl, type MusicTrack } from "../../../lib/music-library";
import { ensureDrumsStem, lastStemTimingFor, stemJobInFlight, stemStageFor, warmDrumsSeparator } from "../../../lib/kick-analysis";
import {
  applyAnalyserEvent, beginStage, beginStep, cloneStage, completeLoadProgress, composeSnapshot, createLoadProgress, failLoadProgress,
  finishStep, formatClock, legacyStage, noteStageEvent, parseAnalyserLine, shortJobStatus, skipStage, skipStep, stageOf,
  summariseLoadProgress, completeStage, type LoadProgress, type LoadProgressSnapshot, type QueuedAhead,
} from "../../../lib/load-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalysisSummary = { id: string; verificationStatus?: "verified" | "review" | "insufficient-evidence"; verifiedBeatCoverage?: number; reviewBlocks?: number; noEvidenceBlocks?: number };
type Stage = "queued" | "model" | "decode" | "grid" | "complete" | "error";
type MappingJob = {
  id: string;
  trackName: string;
  state: "running" | "complete" | "error";
  /** Coarse legacy stage and one-line detail, derived from `progress` (lab page, crate scan). */
  stage: Stage;
  detail: string;
  startedAt: number;
  stageStartedAt: number;
  /**
   * DJ, 26 Sep 2026: the real pipeline, stage by stage and step by step
   * (lib/load-progress.ts). Replaces the 29 Aug 50-step scale, whose client
   * crept through bands on elapsed time and showed step 15 while this job
   * was at 7. Every change here is an event that happened.
   */
  progress: LoadProgress;
  /** True while the job waits on the shared drum-stem job, whose live stage it shows. */
  stemLinked?: boolean;
  protectPlayback?: boolean;
  completedAt?: number;
  error?: string;
  timings?: Record<string, number>;
  stemTiming?: NonNullable<ReturnType<typeof lastStemTimingFor>>;
};

type BeatWorkerReply = {
  type: "ready" | "complete" | "error";
  requestId?: string;
  error?: string;
  traceback?: string;
  beats?: number;
  downbeats?: number;
  elapsedSeconds?: number;
};
type BeatWorkerHandle = {
  run: (request: { audio: string; output: string; ffmpeg: string }) => Promise<BeatWorkerReply>;
  setPlaybackProtected: (protectedPlayback: boolean) => void;
  close: () => void;
};
type CrowdMappingGlobals = typeof globalThis & {
  __crowd2MappingJobs?: Map<string, MappingJob>;
  __crowd2MappingTail?: Promise<void>;
  __crowd2MappingAttempts?: Map<string, number>;
  __crowd2BeatPython?: Promise<string>;
  __crowd2BeatWorker?: Promise<BeatWorkerHandle>;
  /** The Beat This worker that has said "ready" (its model is loaded), and when it did. */
  __crowd2BeatWorkerReady?: BeatWorkerHandle;
  __crowd2BeatWorkerReadyAt?: number;
  __crowd2BeatWorkerIdleTimer?: ReturnType<typeof setTimeout>;
  __crowd2AnalysisSummaries?: { signature: string; values: Map<string, AnalysisSummary> };
  __crowd2PlaybackProtected?: boolean;
};

const globalJobs = globalThis as CrowdMappingGlobals;
const jobs = globalJobs.__crowd2MappingJobs ??= new Map<string, MappingJob>();
const root = process.cwd();
const analysisDirectory = path.join(root, "public", "analysis");
const analysisThreads = String(Math.max(1, Math.min(4, Number(process.env.CROWD_ANALYSIS_THREADS) || 3)));
// Keep the CUDA model resident for a normal DJ session. Loading the model is a
// meaningful part of grid-ready latency, while an idle resident worker uses no
// material CPU and avoids a cold start when a recycled deck needs a new tune.
const analysisWorkerIdleMs = Math.max(30_000, Number(process.env.CROWD_ANALYSIS_IDLE_MS) || 4 * 60 * 60 * 1000);

function analysisEnvironment(extra: NodeJS.ProcessEnv = process.env) {
  return {
    ...extra,
    CROWD_ANALYSIS_THREADS: analysisThreads,
    OMP_NUM_THREADS: analysisThreads,
    MKL_NUM_THREADS: analysisThreads,
    OPENBLAS_NUM_THREADS: analysisThreads,
    NUMEXPR_NUM_THREADS: analysisThreads,
    OMP_WAIT_POLICY: "PASSIVE",
    KMP_BLOCKTIME: "0",
  };
}

async function analysisSummaries(): Promise<Map<string, AnalysisSummary>> {
  const file = path.join(analysisDirectory, "index.json");
  const info = await stat(file).catch(() => null);
  const signature = info ? `${info.mtimeMs}:${info.size}` : "missing";
  if (globalJobs.__crowd2AnalysisSummaries?.signature === signature) return globalJobs.__crowd2AnalysisSummaries.values;
  try {
    const summaries = JSON.parse(await readFile(file, "utf8")) as AnalysisSummary[];
    const values = new Map(summaries.map((summary) => [summary.id, summary]));
    globalJobs.__crowd2AnalysisSummaries = { signature, values };
    return values;
  } catch { return new Map(); }
}

async function exists(file: string) {
  return access(file).then(() => true).catch(() => false);
}

async function resolveFfmpegExecutable() {
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const directCandidates = [
    process.env.FFMPEG_BIN,
    ffmpegStatic,
    path.join(root, "node_modules", "ffmpeg-static", executableName),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of directCandidates) {
    if (await exists(candidate)) return candidate;
  }

  // Next standalone keeps pnpm's traced binary under node_modules/.pnpm, while
  // ffmpeg-static's build-time absolute path is no longer valid at runtime.
  const pnpmModules = path.join(root, "node_modules", ".pnpm");
  const ffmpegPackage = (await readdir(pnpmModules, { withFileTypes: true }).catch(() => []))
    .find((entry) => entry.isDirectory() && entry.name.startsWith("ffmpeg-static@"));
  const pnpmExecutable = ffmpegPackage
    ? path.join(pnpmModules, ffmpegPackage.name, "node_modules", "ffmpeg-static", executableName)
    : "";
  if (pnpmExecutable && await exists(pnpmExecutable)) return pnpmExecutable;
  throw new Error("The local FFmpeg audio decoder is missing from the packaged booth.");
}

/** Keep the legacy coarse fields in step with the real progress after every change. */
function sync(job: MappingJob) {
  const stage = legacyStage(job.progress);
  if (stage !== job.stage) job.stageStartedAt = Date.now();
  job.stage = stage;
  job.detail = summariseLoadProgress(snapshotFor(job));
}

/** Stage boundaries, milliseconds after the job started: the real timeline, for load-timing.jsonl. */
function stageTimings(progress: LoadProgress) {
  const timings: Record<string, number> = {};
  for (const stage of progress.stages) {
    if (stage.startedAt !== null) timings[`${stage.id}Start`] = stage.startedAt - progress.startedAt;
    if (stage.endedAt !== null) timings[`${stage.id}End`] = stage.endedAt - progress.startedAt;
  }
  return timings;
}

async function recordLoadTiming(job: MappingJob) {
  const record = { id: job.id, state: job.state, totalMs: Date.now() - job.startedAt, timings: { ...job.timings, ...stageTimings(job.progress) },
    stem: job.stemTiming, protectPlayback: Boolean(job.protectPlayback), sharedDemix: process.env.CROWD_SHARED_DEMIX !== "0", threads: process.env.CROWD_ANALYSIS_THREADS };
  console.log(`[load-timing] ${JSON.stringify(record)}`);
  await appendFile(path.join(durableDataRoot, "load-timing.jsonl"), `${JSON.stringify(record)}\n`).catch((error) => console.warn("Could not save loading timings", error));
}

function run(command: string, args: string[], job: MappingJob, onLine?: (line: string) => void, env?: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: env ?? process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (child.pid) {
      try { setPriority(child.pid, osPriority.priority.PRIORITY_BELOW_NORMAL); }
      catch { /* Playback remains functional on platforms that do not expose process priorities. */ }
    }
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Waveform and grid analysis did not finish within 3 minutes."));
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    // Whole lines only: a progress line split across two chunks is still one event.
    let pendingLine = "";
    child.stdout.on("data", (chunk: string) => {
      pendingLine += chunk;
      let newline;
      while ((newline = pendingLine.indexOf("\n")) >= 0) {
        const line = pendingLine.slice(0, newline);
        pendingLine = pendingLine.slice(newline + 1);
        onLine?.(line);
      }
      if (pendingLine.length > 64_000) pendingLine = pendingLine.slice(-4000);
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("error", finish);
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr || `Analysis process exited ${code}`)));
  });
}

function supportsBeatThis(command: string) {
  return new Promise<boolean>((resolve) => {
    const env = analysisEnvironment(process.env.BEAT_THIS_PACKAGES
      ? { ...process.env, PYTHONPATH: process.env.BEAT_THIS_PACKAGES }
      : process.env);
    const child = spawn(command, ["-c", "import torch, beat_this"], { cwd: root, env, windowsHide: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * The shared native analysis runtime (lib/analysis-runtime.ts), which Beat
 * This now runs in beside Demucs: a physical path, so a booth started outside
 * Codex (Start-Crowd.cmd) finds it too.
 */
function analysisRuntime() {
  return resolveAnalysisRuntime({ platform: process.platform, env: process.env, cwd: root, exists: existsSync });
}

/**
 * The runtime is verified when it is installed (pinned packages, checkpoint
 * hashes, a live import and model load), so its files are checked here
 * instead of paying for a second interpreter start before the worker's own.
 */
function isPreparedRuntimePython(candidate: string) {
  const prepared = analysisRuntime()?.paths;
  return Boolean(prepared && candidate === prepared.python
    && existsSync(path.join(prepared.sitePackages, "beat_this"))
    && existsSync(path.join(prepared.sitePackages, "torch"))
    && existsSync(path.join(prepared.torchHome, "hub", "checkpoints", "beat_this-small0.ckpt")));
}

async function beatPythonCandidates() {
  const bundledPython = path.resolve(path.dirname(process.execPath), "..", "..", "python", "python.exe");
  const linkedProjectRoot = path.dirname(path.dirname(await realpath(analysisDirectory).catch(() => analysisDirectory)));
  const localInstall = localBeatThisInstall();
  return [...new Set([
    process.env.BEAT_THIS_PYTHON,
    analysisRuntime()?.paths.python,
    localInstall.python,
    path.join(linkedProjectRoot, ".bt-env", "Scripts", "python.exe"),
    path.join(root, ".bt-env", "Scripts", "python.exe"),
    path.join(root, "..", ".bt-env", "Scripts", "python.exe"),
    path.resolve(root, "..", "..", "..", ".bt-env", "Scripts", "python.exe"),
    bundledPython,
  ].filter((value): value is string => Boolean(value)))];
}

function resolveBeatPython() {
  globalJobs.__crowd2BeatPython ??= (async () => {
    const pythonCandidates = await beatPythonCandidates();
    for (const candidate of pythonCandidates) {
      if (!await exists(candidate)) continue;
      if (isPreparedRuntimePython(candidate) || await supportsBeatThis(candidate)) return candidate;
    }
    throw new Error("The local Beat This Python environment is missing PyTorch or Beat This.");
  })().catch((error) => {
    globalJobs.__crowd2BeatPython = undefined;
    throw error;
  });
  return globalJobs.__crowd2BeatPython;
}

async function legacyBeatThisPackages() {
  const pythonCandidates = await beatPythonCandidates();
  const localInstall = localBeatThisInstall();
  const pythonChecks = await Promise.all(pythonCandidates.map(async (candidate) => ({
    candidate,
    found: await exists(path.join(path.dirname(candidate), "Lib", "site-packages", "beat_this"))
      || await exists(path.resolve(path.dirname(candidate), "..", "Lib", "site-packages", "beat_this")),
  })));
  const packageCandidates = [
    process.env.BEAT_THIS_PACKAGES,
    localInstall.packages,
    ...pythonChecks.filter((candidate) => candidate.found).flatMap(({ candidate }) => {
      const pythonDirectory = path.dirname(candidate);
      return [
        path.join(pythonDirectory, "Lib", "site-packages"),
        path.resolve(pythonDirectory, "..", "Lib", "site-packages"),
      ];
    }),
  ].filter((value): value is string => Boolean(value));
  return (await Promise.all(packageCandidates.map(async (candidate) => ({ candidate, found: await exists(path.join(candidate, "beat_this")) })))).find((item) => item.found)?.candidate;
}

async function createBeatWorker(): Promise<BeatWorkerHandle> {
  const python = await resolveBeatPython();
  const prepared = analysisRuntime()?.paths;
  // The shared runtime is a complete venv: the same worker environment as
  // Demucs (its own verified model home, UTF-8, no foreign PYTHONPATH — a
  // legacy env's site-packages must never shadow the runtime's torch).
  // Other interpreters keep the older package-path discovery.
  const pythonEnv = prepared && python === prepared.python
    ? modelWorkerEnv(analysisEnvironment(process.env), { platform: process.platform, torchHome: prepared.torchHome }) as NodeJS.ProcessEnv
    : await legacyBeatThisPackages().then((beatThisPackages) => analysisEnvironment(beatThisPackages ? { ...process.env, PYTHONPATH: beatThisPackages } : process.env));
  const child = spawn(python, [
    path.join(root, "scripts", "beat-model.py"),
    "--worker",
    "--model", "small0",
  ], { cwd: root, env: pythonEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let nextRequestId = 1;
  const pending = new Map<string, { resolve: (reply: BeatWorkerReply) => void; reject: (error: Error) => void }>();
  const handle: BeatWorkerHandle = {
    setPlaybackProtected: (protectedPlayback) => {
      if (!child.pid) return;
      try {
        setPriority(child.pid, protectedPlayback
          ? osPriority.priority.PRIORITY_BELOW_NORMAL
          : osPriority.priority.PRIORITY_NORMAL);
      } catch { /* The worker remains usable when process priorities are unavailable. */ }
    },
    run: (request) => new Promise((resolve, reject) => {
      const requestId = String(nextRequestId++);
      pending.set(requestId, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...request, requestId })}\n`, (error) => {
        if (!error) return;
        pending.delete(requestId);
        reject(error);
      });
    }),
    close: () => child.kill(),
  };

  return new Promise<BeatWorkerHandle>((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => {
      if (ready) return;
      child.kill();
      reject(new Error("Beat This worker did not become ready within 45 seconds."));
    }, 45_000);
    const failAll = (error: Error) => {
      clearTimeout(timeout);
      if (!ready) reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      globalJobs.__crowd2BeatWorker = undefined;
      if (globalJobs.__crowd2BeatWorkerReady === handle) globalJobs.__crowd2BeatWorkerReady = undefined;
    };
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-12_000); });
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let reply: BeatWorkerReply;
        try { reply = JSON.parse(line) as BeatWorkerReply; }
        catch { continue; }
        if (reply.type === "ready") {
          ready = true;
          clearTimeout(timeout);
          globalJobs.__crowd2BeatWorkerReady = handle;
          globalJobs.__crowd2BeatWorkerReadyAt = Date.now();
          resolve(handle);
          continue;
        }
        const request = reply.requestId ? pending.get(reply.requestId) : undefined;
        if (!request || !reply.requestId) continue;
        pending.delete(reply.requestId);
        if (reply.type === "complete") request.resolve(reply);
        else request.reject(new Error(reply.traceback || reply.error || "Beat This worker failed"));
      }
    });
    child.on("error", (error) => failAll(error));
    const stopWorker = () => child.kill();
    child.on("close", (code) => {
      process.removeListener("exit", stopWorker);
      failAll(new Error(stderr || `Beat This worker exited ${code}`));
    });
    process.once("exit", stopWorker);
  });
}

function getBeatWorker() {
  if (globalJobs.__crowd2BeatWorkerIdleTimer) {
    clearTimeout(globalJobs.__crowd2BeatWorkerIdleTimer);
    globalJobs.__crowd2BeatWorkerIdleTimer = undefined;
  }
  globalJobs.__crowd2BeatWorker ??= createBeatWorker().catch((error) => {
    globalJobs.__crowd2BeatWorker = undefined;
    throw error;
  });
  return globalJobs.__crowd2BeatWorker;
}

function releaseBeatWorkerAfterIdle(worker: BeatWorkerHandle) {
  if (globalJobs.__crowd2BeatWorkerIdleTimer) clearTimeout(globalJobs.__crowd2BeatWorkerIdleTimer);
  globalJobs.__crowd2BeatWorkerIdleTimer = setTimeout(() => {
    const activeWorker = globalJobs.__crowd2BeatWorker;
    globalJobs.__crowd2BeatWorker = undefined;
    globalJobs.__crowd2BeatWorkerIdleTimer = undefined;
    void activeWorker?.then((resolved) => {
      if (resolved === worker) resolved.close();
    }).catch(() => undefined);
  }, analysisWorkerIdleMs);
  globalJobs.__crowd2BeatWorkerIdleTimer.unref?.();
}

async function runMapping(track: MusicTrack, job: MappingJob) {
  (job.timings ??= {}).runStarted = Date.now() - job.startedAt;
  const modelOutput = path.join(analysisDirectory, `beat-this-${track.id}.json`);
  const gridOutput = path.join(analysisDirectory, `${track.id}.json`);
  await rm(modelOutput, { force: true });
  // The stored grid analysis stays in place while a remap runs: it carries the
  // DJ's taught windows and preferred cues, which analyse-library.mjs re-reads
  // and re-applies before atomically overwriting the file. A failed forced
  // remap therefore never orphans taught data.
  // 26 Sep 2026 (cold loads): the beat model used to start only after the
  // stem existed, so a first load after a restart paid its start-up on top
  // of separation. It now starts with the job and loads while Demucs runs —
  // the same worker the stem step would have started, just sooner. With
  // playback protected it still starts where it always did.
  const earlyBeatWorker = job.protectPlayback ? null : getBeatWorker().catch(() => null);
  const progress = job.progress;
  try {
    // 25 Aug 2026, DJ: the analyser is fed ONLY the drums stem, every tune —
    // full-mix multiband evidence phase-locked grids onto the rolling bass.
    // Separation therefore runs FIRST (reused when the stem already exists);
    // stems have been on the booth clock since the 16 Aug re-cut.
    beginStage(progress, "stem", Date.now());
    const stemStarted = Date.now();
    const stemFile = kickStemPath(track.id);
    const stemWasCached = stemFile ? await exists(stemFile) : false;
    // A stem already on disk is a real, instant completion; otherwise the job
    // shows the shared stem job's own live stage (lib/kick-analysis.ts).
    if (stemWasCached && !stemJobInFlight(track.id)) skipStage(stageOf(progress, "stem"), Date.now(), "Drum stem already on disk · Demucs not needed", true);
    else job.stemLinked = true;
    sync(job);
    let audioFile: string;
    try {
      audioFile = await ensureDrumsStem(track.id);
    } finally {
      // Freeze the stem stage as it ended, into this job's own record.
      const linked = job.stemLinked ? stemStageFor(track.id) : null;
      if (linked) {
        progress.stages[progress.stages.findIndex((stage) => stage.id === "stem")] = cloneStage(linked);
        noteStageEvent(progress, linked);
      }
      job.stemLinked = false;
    }
    job.stemTiming = stemWasCached
      ? { cacheHit: true, totalMs: Date.now() - stemStarted }
      : { ...lastStemTimingFor(track.id), cacheHit: false, totalMs: Date.now() - stemStarted };
    const ffmpegExecutable = await resolveFfmpegExecutable();
    // Beat This: its model load is a real step only when the worker is not up yet.
    beginStage(progress, "beats", Date.now());
    const beats = stageOf(progress, "beats");
    const beatModelReady = Boolean(globalJobs.__crowd2BeatWorkerReady && globalJobs.__crowd2BeatWorker);
    // Loaded by this job's own early start (in parallel with Demucs) is a load that happened, not a skip.
    if (beatModelReady && (globalJobs.__crowd2BeatWorkerReadyAt ?? 0) >= job.startedAt) finishStep(beats, "model", Date.now(), "Beat This model loaded in parallel with the separation");
    else if (beatModelReady) skipStep(beats, "model", Date.now(), "Beat This model already loaded");
    else beginStep(beats, "model", Date.now(), "Starting Beat This (Python, PyTorch, checkpoint)");
    sync(job);
    const worker = await getBeatWorker();
    if (!beatModelReady) finishStep(beats, "model", Date.now(), "Beat This model ready");
    beginStep(beats, "scan", Date.now(), "Beat This is scanning the drum stem for beats and downbeats");
    sync(job);
    worker.setPlaybackProtected(Boolean(job.protectPlayback));
    try {
      const reply = await worker.run({ audio: audioFile, output: modelOutput, ffmpeg: ffmpegExecutable });
      if (reply.elapsedSeconds !== undefined) (job.timings ??= {}).beatProcessingMs = Math.round(reply.elapsedSeconds * 1000);
      finishStep(beats, "scan", Date.now(), `${reply.beats ?? "?"} beats and ${reply.downbeats ?? "?"} downbeats found`);
    } finally {
      releaseBeatWorkerAfterIdle(worker);
    }

    beginStage(progress, "grid", Date.now());
    beginStep(stageOf(progress, "grid"), "start", Date.now(), "Starting the grid analyser");
    sync(job);
    await run(process.execPath, ["--experimental-strip-types", path.join(root, "scripts", "analyse-library.mjs"), track.id], job, (line) => {
      // One structured line per real analyser step (lib/load-progress.ts).
      const event = parseAnalyserLine(line);
      if (event && applyAnalyserEvent(progress, event, Date.now())) sync(job);
    }, analysisEnvironment({ ...process.env, FFMPEG_BIN: ffmpegExecutable, CROWD_ANALYSIS_PROGRESS: "1" }));
    beginStage(progress, "save", Date.now());
    const save = stageOf(progress, "save");
    beginStep(save, "verify", Date.now(), "Checking the compact DJ record");
    sync(job);
    if (!await hasCompactDjRecord(track.id)) throw new Error(`Compact grid record was not written for ${track.name}; detailed evidence was preserved.`);
    const analysis = JSON.parse(await readFile(gridOutput, "utf8")) as {
      retentionQuality?: { wholeTrackAccepted: boolean; safeTransitionWindows: number };
    };
    const retained = analysis.retentionQuality;
    finishStep(save, "verify", Date.now(), retained
      ? retained.wholeTrackAccepted
        ? "Grid retained · whole track independently trusted"
        : retained.safeTransitionWindows
          ? `Provisional grid retained with ${retained.safeTransitionWindows} evidence-backed region${retained.safeTransitionWindows === 1 ? "" : "s"} · manual cues will correct BPM and phase`
          : "Provisional grid retained · manual cue windows will teach BPM and grid phase"
      : "Provisional grid retained · manual cue windows will teach BPM and grid phase");
    completeLoadProgress(progress, Date.now());
    job.state = "complete";
    job.completedAt = Date.now();
    sync(job);
    // Timing telemetry is diagnostic only. A slow filesystem/virus scanner
    // must never hold the one-at-a-time analysis lane after the result is
    // already saved and marked complete.
    void recordLoadTiming(job);
  } catch (error) {
    // A beat worker this job woke early must still idle out if the job died first.
    void earlyBeatWorker?.then((worker) => { if (worker) releaseBeatWorkerAfterIdle(worker); });
    try {
      const compactExists = await hasCompactDjRecord(track.id);
      const preserveDetailed = error instanceof Error && error.message.startsWith("Compact grid record was not written");
      if (!compactExists && !preserveDetailed) await rm(modelOutput, { force: true });
      if (!compactExists && !preserveDetailed) await rm(gridOutput, { force: true });
      if (!compactExists && !preserveDetailed) await forgetCompactDjRecord(track.id);
      const summaries = await readFile(path.join(analysisDirectory, "index.json"), "utf8").then(JSON.parse).catch(() => []);
      await writeFile(path.join(analysisDirectory, "index.json"), JSON.stringify(summaries.filter((item: { id?: string }) => item.id !== track.id), null, 2));
    } catch (cleanupError) {
      console.error("Crowd2 could not finish failed-mapping cleanup", cleanupError);
    }
    throw error;
  }
}

function queueMapping(track: MusicTrack, job: MappingJob) {
  const previous = globalJobs.__crowd2MappingTail ?? Promise.resolve();
  const execution = previous.catch(() => undefined).then(async () => {
    // The lane is clear: the queue stage ends here, saying how long it held this tune.
    const waited = Date.now() - job.startedAt;
    completeStage(stageOf(job.progress, "queue"), Date.now(), waited >= 1000 ? `Lane clear after waiting ${formatClock(waited / 1000)}` : "Lane was free");
    sync(job);
    await runMapping(track, job);
  });
  globalJobs.__crowd2MappingTail = execution.then(() => undefined, () => undefined);
  void execution.catch((error: unknown) => {
    job.state = "error";
    job.error = friendlyMappingError(error);
    job.completedAt = Date.now();
    // The stage and step it stopped at stay as they were, marked failed; nothing claims done.
    failLoadProgress(job.progress, Date.now(), job.error);
    job.stemLinked = false;
    sync(job);
    void recordLoadTiming(job);
  });
}

/**
 * Tunes ahead of `job` in the one-at-a-time lane, oldest first — the first
 * is the one running — each with where it really is, so a queued tune can
 * name what it waits behind (DJ's 26 Sep load of Fragile waited 3:23 behind
 * Genetic Spin while the deck said only "Preparing local analysis").
 */
function queueAheadOf(job: MappingJob): QueuedAhead[] {
  if (stageOf(job.progress, "queue").state !== "active") return [];
  return [...jobs.values()]
    // `progress` guard: a job object from before this contract can survive a dev recompile on globalThis.
    .filter((other) => other !== job && other.progress && other.state === "running" && other.startedAt <= job.startedAt)
    .sort((left, right) => left.startedAt - right.startedAt)
    .map((other) => ({ trackId: other.id, trackName: other.trackName, summary: shortJobStatus(snapshotFor(other, false)) }));
}

/** The job as the booth sees it: its real stages, the live stem stage while linked, and who is ahead. */
function snapshotFor(job: MappingJob, withQueue = true): LoadProgressSnapshot {
  return composeSnapshot(job.progress, {
    serverNow: Date.now(),
    linkedStem: job.stemLinked ? stemStageFor(job.id) : null,
    queueAhead: withQueue ? queueAheadOf(job) : undefined,
  });
}

/** The legacy job fields the lab page and crate scan read, derived from the real progress. */
function publicJob(job: MappingJob, snapshot = snapshotFor(job)) {
  return {
    id: job.id,
    jobId: job.progress.jobId,
    attempt: job.progress.attempt,
    state: job.state,
    stage: legacyStage(job.progress),
    detail: summariseLoadProgress(snapshot),
    startedAt: job.startedAt,
    stageStartedAt: job.stageStartedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
}

async function trackState(track: MusicTrack, summary?: AnalysisSummary, intelligence?: TrackIntelligenceSummary, knownCompact?: boolean, withProgress = false) {
  const remembered = jobs.get(track.id);
  const rememberedJob = remembered?.progress ? remembered : undefined;
  const compact = knownCompact ?? await hasCompactDjRecord(track.id);
  const detailed = compact ? await exists(path.join(analysisDirectory, `${track.id}.json`)) : false;
  const mapped = detailed && compact && rememberedJob?.state !== "running";
  const snapshot = rememberedJob ? snapshotFor(rememberedJob) : null;
  return {
    ...publicTrack(track),
    mapped,
    intelligence: intelligence ?? null,
    verificationStatus: summary?.verificationStatus,
    verifiedBeatCoverage: summary?.verifiedBeatCoverage,
    reviewBlocks: summary?.reviewBlocks,
    noEvidenceBlocks: summary?.noEvidenceBlocks,
    audio: trackAudioUrl(track),
    analysis: trackAnalysisUrl(track.id),
    job: mapped || rememberedJob?.state === "complete" || !rememberedJob ? null : publicJob(rememberedJob, snapshot!),
    // The structured progress of this track's latest job on this server —
    // running, complete or stopped — for the booth's deck panel.
    ...(withProgress ? { loadProgress: snapshot } : {}),
  };
}

export async function GET(request: Request) {
  const tracks = (await getMusicLibrary()).tracks;
  const summaries = await analysisSummaries();
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    const track = tracks.find((item) => item.id === id);
    if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
    const [intelligence, compact] = await Promise.all([readTrackIntelligenceSummary(id), hasCompactDjRecord(id)]);
    return Response.json(await trackState(track, summaries.get(track.id), intelligence ?? undefined, compact, true), { headers: { "Cache-Control": "no-store" } });
  }
  const intelligence = new Map((await readTrackIntelligenceIndex()).map((record) => [record.id, record]));
  const rememberedIds = new Set((await readCompactDjIndex()).map((track) => track.id));
  return Response.json({
    tracks: await Promise.all(tracks.map((track) => trackState(track, summaries.get(track.id), intelligence.get(track.id), rememberedIds.has(track.id)))),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as { protectPlayback?: boolean; warmModel?: boolean };
  const protectPlayback = Boolean(body.protectPlayback);
  globalJobs.__crowd2PlaybackProtected = protectPlayback;
  for (const job of jobs.values()) {
    if (job.state === "running") job.protectPlayback = protectPlayback;
  }
  const existingWorker = globalJobs.__crowd2BeatWorker;
  if (existingWorker) {
    const worker = await existingWorker.catch(() => null);
    worker?.setPlaybackProtected(protectPlayback);
  }
  // The booth can hide CUDA/model startup while the DJ is choosing tunes. Do
  // not initiate that work after playback has begun; live audio stays first.
  if (body.warmModel && !protectPlayback) {
    const [worker] = await Promise.all([getBeatWorker().catch(() => null), warmDrumsSeparator().catch((error) => console.warn("Drums prewarm unavailable", error))]);
    if (worker) {
      worker.setPlaybackProtected(false);
      releaseBeatWorkerAfterIdle(worker);
    }
  }
  return Response.json({ protectPlayback, modelWarm: Boolean(globalJobs.__crowd2BeatWorker) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { id?: string; force?: boolean; protectPlayback?: boolean };
  const tracks = (await getMusicLibrary()).tracks;
  const track = tracks.find((item) => item.id === body.id);
  if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
  const current = jobs.get(track.id);
  // One job per tune at a time: a second request joins the running job (same jobId).
  if (current?.state === "running") return Response.json({ ...publicJob(current), loadProgress: snapshotFor(current) }, { status: 202 });
  if (!body.force && await exists(path.join(analysisDirectory, `${track.id}.json`)) && await hasCompactDjRecord(track.id)) {
    return Response.json({ error: "Track is already mapped" }, { status: 409 });
  }
  const attempts = globalJobs.__crowd2MappingAttempts ??= new Map<string, number>();
  const attempt = (attempts.get(track.id) ?? 0) + 1;
  attempts.set(track.id, attempt);
  const now = Date.now();
  const job: MappingJob = {
    id: track.id,
    trackName: track.name,
    state: "running",
    stage: "queued",
    detail: "Waiting for the one-at-a-time analysis lane",
    startedAt: now,
    stageStartedAt: now,
    progress: createLoadProgress({ trackId: track.id, trackName: track.name, attempt, now }),
    protectPlayback: Boolean(body.protectPlayback || globalJobs.__crowd2PlaybackProtected),
  };
  jobs.set(track.id, job);
  queueMapping(track, job);
  return Response.json({ ...publicJob(job), loadProgress: snapshotFor(job) }, { status: 202 });
}

// DJ, 27 Aug 2026 ("apply the 2 least risky load-time changes"): the booth's
// wipe-and-fresh re-analysed every tune once per tab session even when the
// stored analysis was already produced by current code — 5-90 s per load for
// byte-identical results. Analyses at/after this cutoff carry the sag tracker
// and the stem attack stamps, so the wipe keeps them and the load falls
// through to an instant fetch (the client's follow-up POST 409s, which
// ensureMapped already tolerates, and its first poll sees mapped=true).
// Older analyses still wipe exactly as before, so they gain the new stamps
// once. Bump the date (or set CROWD_WIPE_CUTOFF) after the next analysis-
// changing deploy.
const WIPE_KEEPS_ANALYSES_SINCE = process.env.CROWD_WIPE_CUTOFF?.trim() || "2026-08-27T08:00:00Z";

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9_-]+$/i.test(id)) return Response.json({ error: "A safe track ID is required" }, { status: 400 });
  const track = (await getMusicLibrary()).tracks.find((item) => item.id === id);
  if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
  const stored = await readFile(path.join(analysisDirectory, `${id}.json`), "utf8")
    .then((text) => JSON.parse(text) as { generatedAt?: string })
    .catch(() => null);
  if (stored?.generatedAt && stored.generatedAt >= WIPE_KEEPS_ANALYSES_SINCE && await hasCompactDjRecord(id)) {
    console.log(`[map] wipe skipped for ${track.name}: analysis ${stored.generatedAt} is current (cutoff ${WIPE_KEEPS_ANALYSES_SINCE})`);
    return Response.json({ removed: false, kept: true, id, name: track.name, generatedAt: stored.generatedAt });
  }
  await Promise.all([
    rm(path.join(analysisDirectory, `${id}.json`), { force: true }),
    rm(path.join(analysisDirectory, `beat-this-${id}.json`), { force: true }),
    forgetCompactDjRecord(id),
  ]);
  const summaries = await readFile(path.join(analysisDirectory, "index.json"), "utf8").then(JSON.parse).catch(() => []);
  await writeFile(path.join(analysisDirectory, "index.json"), JSON.stringify(summaries.filter((item: { id?: string }) => item.id !== id), null, 2));
  jobs.delete(id);
  return Response.json({ removed: true, id, name: track.name });
}

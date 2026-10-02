/**
 * On-demand drum analysis: stem, kicks, grid — one job at a time, never while a
 * deck is playing.
 *
 * The chain, per track:
 *   1. HTDemucs separates the drums (~30-40 s of GPU). Cached: it never changes.
 *   2. Kicks are detected individually in the stem. Ear-verified: DJ heard a tick
 *      on every hit as "spot on" across most of 17 tracks.
 *   3. A grid is fitted to those kicks by consensus, so stutters and fills are
 *      outliers with no vote. 33 of 42 came back clean by ear.
 *
 * What it deliberately does NOT do is apply the result. The app's rule is that
 * measurement never moves a placed cue or grid without an explicit press — auto
 * tightening was built once, removed at DJ's request, and a guard test now keeps
 * it out. So this produces a proposal and stops.
 *
 * Protection is the same as the section analyser's: one job, and only started when
 * the booth reports nothing playing, with that report expiring so it cannot go
 * stale under a live mix.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "./music-library.ts";
import { seekAccuratePath } from "./playback-clock.ts";
import { detectKicks, impliedTempo, KICK_PICK_SAMPLE_RATE, KICK_SHAPE_SAMPLE_RATE } from "./kick-detect.ts";
import { anchorHitsLocally, slapEnvelope, subEnvelope } from "./ear.ts";
import { fitKickGrid } from "./kick-grid.ts";
import { KICK_STEM_DIRECTORY, kickHitsFor, kickStemPath, saveKickHits } from "./kick-hits-store.ts";
import { kickGridFor, saveKickGrid } from "./kick-grid-store.ts";
import { BOOTH_IDLE_TRUST_MS } from "./section-analysis.ts";
import {
  drumsColdPlan, drumsJobPath, drumsRuntimeKey, drumsRuntimeMayHealWsl, drumsWorkerPlan, resolveDrumsRuntime,
  type DrumsRuntime,
} from "./drums-runtime.ts";
import {
  applySeparatorEvent, beginStep, completeStage, createStage, failStage, finishStep, parseSeparatorLine, restartStage,
  separatorStartupDetail, settleUnreportedSteps, skipStep, updateStep, type LoadStage, type SeparatorEvent, type SeparatorStartupStep,
} from "./load-progress.ts";

/**
 * 25 Aug 2026 test mode, at DJ's direction: while cue tests run against the
 * library analyser's original beat grid, this worker separates and persists
 * the drums stem (Drum Stem Only needs it) and then STOPS — no kick
 * detection, no grid fitting, nothing written to kick-hits/kick-grids. The
 * detected stores were purged the same day (snapshot:
 * data/kick-12h/snapshots/2026-08-25-pre-analyser-only-purge). Flip this
 * back to false to restore the full chain.
 */
const ANALYSER_GRID_ONLY_TESTS = true;
// DJ, 30 Aug 2026 ("make whatever change needed for it to broadcast
// smooth"): OFF again — Demucs grinding the GPU while the booth tab
// generates the crowd stream was the best-correlated dropout suspect.
// This restores the booth-idle gate from before 25 Aug: separation WAITS
// for silence. The cost is DJ's own earlier trade reversed — first-time
// tunes do not get stems mid-set; flip back to true to prefer load speed.
const SEPARATION_DURING_PLAYBACK = false;

const JOB_TIMEOUT_MS = 12 * 60 * 1000;

/**
 * 29 Aug 2026: WSL died mid-session with "Wsl/Service/E_UNEXPECTED" — every
 * spawn (warm worker and cold fallback both) failed in ~100 ms, so no stem
 * could ever land and deck loads failed until a human ran wsl --shutdown.
 * On a separation failure the pipeline probes WSL, and only when the probe
 * fails does it wait for WSL to answer again and retry ONCE. Single-flight
 * with a cooldown.
 *
 * 26 Sep 2026: separation is native Windows by default (lib/drums-runtime.ts).
 * This recovery belongs to the explicitly selected WSL reference runtime
 * only — a native failure never probes, restarts or falls back to WSL. And
 * it never runs `wsl --shutdown` any more: the same VM carries other,
 * unrelated work on this PC (other projects' services and jobs), and a
 * separation is not worth killing them. If WSL stays down, the failure
 * surfaces with the instruction to restart it by hand.
 */
const WSL_HEAL_COOLDOWN_MS = 5 * 60 * 1000;
const WSL_PROBE_TIMEOUT_MS = 20_000;
const WSL_RECOVERY_PROBES = 3;
const WSL_RECOVERY_WAIT_MS = Math.max(0, Number(process.env.CROWD_WSL_RECOVERY_WAIT_MS ?? 3000));
const wslHealGlobals = globalThis as typeof globalThis & {
  __crowd2WslHeal?: Promise<boolean>;
  __crowd2WslHealAt?: number;
};

/** WSL prints UTF-16LE; captured as UTF-8 its text arrives NUL-riddled. */
function wslText(raw: string) {
  return raw.replace(/\u0000/g, "");
}

function probeWsl(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("wsl.exe", ["-d", "Ubuntu-24.04", "-u", "root", "--", "echo", "ok"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } resolve(false); }, WSL_PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && wslText(out).includes("ok")); });
  });
}

/**
 * Returns true only when WSL was not answering AND answers again within the
 * recovery window — the caller then retries its separation once. A healthy
 * probe returns false immediately: the failure was a real Demucs error and
 * must surface. Nothing here stops, terminates or shuts down WSL.
 */
async function healWslIfDead(cause: unknown): Promise<boolean> {
  if (await probeWsl()) return false;
  if (wslHealGlobals.__crowd2WslHeal) return wslHealGlobals.__crowd2WslHeal;
  const now = Date.now();
  if (now - (wslHealGlobals.__crowd2WslHealAt ?? 0) < WSL_HEAL_COOLDOWN_MS) return false;
  wslHealGlobals.__crowd2WslHealAt = now;
  const heal = (async () => {
    const reason = cause instanceof Error ? wslText(cause.message).slice(0, 120) : "unknown failure";
    console.warn(`[stems] WSL is not answering (${reason}) — waiting for it to recover; Crowd2 never shuts WSL down because other work may be running in it`);
    for (let attempt = 0; attempt < WSL_RECOVERY_PROBES; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, WSL_RECOVERY_WAIT_MS));
      if (await probeWsl()) { console.warn("[stems] WSL is answering again"); return true; }
    }
    console.warn("[stems] WSL is still not answering — leaving the failure to surface; restart WSL by hand (wsl --shutdown) once nothing else needs it, or use the native separator");
    return false;
  })().finally(() => { wslHealGlobals.__crowd2WslHeal = undefined; });
  wslHealGlobals.__crowd2WslHeal = heal;
  return heal;
}
/** Detected kicks below this many make a grid fit meaningless. */
const MINIMUM_KICKS = 16;

export type KickAnalysisStatus = {
  running: string | null;
  runningName: string | null;
  stage: "separating" | "detecting" | "fitting" | null;
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
  stage: KickAnalysisStatus["stage"];
  worker: Promise<void> | null;
  completed: number;
  failed: number;
  lastError: string | null;
  idle: boolean;
  idleAt: number;
};

const globals = globalThis as typeof globalThis & { __crowd2KickAnalysis?: Runtime };
const runtime: Runtime = globals.__crowd2KickAnalysis ??= {
  queue: [], running: null, runningName: null, stage: null, worker: null,
  completed: 0, failed: 0, lastError: null, idle: false, idleAt: 0,
};

/**
 * Exported because applying a grid needs the same protection as measuring one.
 *
 * Separation is protected because it is expensive; applying is protected because
 * it is live. Moving a grid under a deck that is playing changes where every beat
 * is mid-mix, so the same fresh report of silence gates both.
 */
export function kickBoothIsIdle() {
  return runtime.idle && Date.now() - runtime.idleAt <= BOOTH_IDLE_TRUST_MS;
}

function boothIsIdle() {
  return kickBoothIsIdle();
}

export function reportKickBoothIdle(idle: boolean) {
  runtime.idle = idle;
  runtime.idleAt = Date.now();
  if (idle) start();
}

export function kickAnalysisStatus(): KickAnalysisStatus {
  return {
    running: runtime.running,
    runningName: runtime.runningName,
    stage: runtime.stage,
    queued: [...runtime.queue],
    completed: runtime.completed,
    failed: runtime.failed,
    lastError: runtime.lastError,
    boothIdle: boothIsIdle(),
    waitingForIdle: (runtime.queue.length > 0 || runtime.running !== null) && !boothIsIdle(),
  };
}

/** True when this track already has everything the chain produces. */
export function kickAnalysisComplete(trackId: string) {
  return !!kickGridFor(trackId) && !!kickHitsFor(trackId);
}

export function enqueueKickAnalysis(trackId: string) {
  if (!trackId || typeof trackId !== "string") return false;
  // A browser-local file never reaches the server, so there is nothing to separate.
  if (trackId.startsWith("local-")) return false;
  if (runtime.running === trackId || runtime.queue.includes(trackId)) return false;
  if (kickAnalysisComplete(trackId)) return false;
  runtime.queue.push(trackId);
  start();
  return true;
}

function start() {
  if (!runtime.worker) runtime.worker = runWorker().finally(() => { runtime.worker = null; });
}

/**
 * The drums stem for a track, made if it does not exist yet.
 *
 * 25 Aug 2026, DJ: the library analyser is fed ONLY the drums stem, for
 * every tune — the full-mix multiband evidence phase-locked grids onto the
 * rolling bass (Bella Donna: one full bass-step, 166 ms early of the kicks).
 * So separation now precedes analysis, and both the kick worker and the
 * mapping job come here. Concurrent callers for one track share one Demucs.
 */
const stemGlobals = globalThis as typeof globalThis & { __crowd2StemInFlight?: Map<string, Promise<string>> };
const stemInFlight = stemGlobals.__crowd2StemInFlight ??= new Map<string, Promise<string>>();
type StemTiming = {
  cacheHit: boolean; workerWaitMs?: number; separationMs?: number; threads?: number; device?: string; publishMs?: number; totalMs?: number; audioSeconds?: number;
  /** Which separator runtime did the work, e.g. windows-native or wsl:Ubuntu-24.04. */
  backend?: string;
  /** "warm" (resident worker) or "cold" (one-shot fallback). */
  path?: "warm" | "cold";
  /** Spawn to READY for a worker this job had to start (model load included). */
  workerStartMs?: number;
  decodeMs?: number; modelMs?: number; writeMs?: number; writer?: string;
};
const timingGlobals = globalThis as typeof globalThis & { __crowd2StemTimings?: Map<string, StemTiming> };
const stemTimings = timingGlobals.__crowd2StemTimings ??= new Map<string, StemTiming>();
export function lastStemTimingFor(trackId: string) { return stemTimings.get(trackId) ?? null; }
function saveStemTiming(trackId: string, timing: Partial<StemTiming>) {
  stemTimings.set(trackId, { cacheHit: false, ...stemTimings.get(trackId), ...timing });
  if (stemTimings.size > 128) stemTimings.delete(stemTimings.keys().next().value!);
}
// DJ, 27 Aug 2026 (warm separation): a resident worker keeps the HTDemucs
// model loaded, so a separation costs only the separation. ANY warm failure
// — spawn, timeout, protocol, a job error — falls back to the cold
// drums-stem.py spawn for that job, on the SAME runtime, and respawns the
// worker lazily, so the worst case is exactly the pre-warm behavior.
// CROWD_WARM_DEMUCS=0 disables the worker outright.
const WARM_DEMUCS = process.env.CROWD_WARM_DEMUCS !== "0";
const DEMUCS_WORKER_IDLE_MS = Math.max(60_000, Number(process.env.CROWD_WARM_DEMUCS_IDLE_MS) || 2 * 60 * 60 * 1000);
type DemucsJob = { audio: string; out: string; result: string; demixRoot: string | null; trackId?: string; threads?: number };
/** Who a job is: named so a tune queued behind it can say whose separation it is waiting on. */
type DemucsJobOwner = { trackId: string | null; trackName: string | null };
/** A job's live progress: its place on the worker, then the worker's own events for it. */
type DemucsJobHooks = DemucsJobOwner & {
  onQueued?: (ahead: DemucsJobOwner[]) => void;
  onDispatch?: () => void;
  onEvent?: (event: SeparatorEvent) => void;
};
type DemucsWorkerHandle = {
  run: (job: DemucsJob, hooks?: DemucsJobHooks) => Promise<void>;
  close: () => void;
  /** Spawn to READY, milliseconds: interpreter, torch import and model load. */
  startMs: number;
};
/** The resident worker's own start-up, as it reports it (spawn -> import -> model -> ready). */
type DemucsStartup = { pid: number | undefined; step: SeparatorStartupStep | "ready" | "failed"; at: number };
const demucsGlobals = globalThis as typeof globalThis & {
  __crowd2DemucsWorker?: Promise<DemucsWorkerHandle>;
  __crowd2DemucsWorkerKey?: string;
  __crowd2DemucsWorkerPid?: number;
  __crowd2DemucsWorkerIdle?: ReturnType<typeof setTimeout>;
  __crowd2DemucsStartup?: DemucsStartup;
  __crowd2DemucsStartupListeners?: Set<(startup: DemucsStartup) => void>;
};
const startupListeners = demucsGlobals.__crowd2DemucsStartupListeners ??= new Set();
function reportDemucsStartup(startup: DemucsStartup) {
  demucsGlobals.__crowd2DemucsStartup = startup;
  for (const listener of [...startupListeners]) {
    try { listener(startup); } catch { /* a listener must never break the worker */ }
  }
}
/** True when the current worker process for `runtime` has said READY. */
function demucsWorkerReady(runtime: DrumsRuntime) {
  const startup = demucsGlobals.__crowd2DemucsStartup;
  return hasDemucsWorker(runtime) && startup?.step === "ready" && startup.pid === demucsGlobals.__crowd2DemucsWorkerPid;
}

/**
 * The drum-stem stage (lib/load-progress.ts) of each track's latest stem
 * job: real sub-steps from audio input to publish, fed by the separator's
 * own events. The mapping route shows it while its job waits on the stem.
 */
const stageGlobals = globalThis as typeof globalThis & { __crowd2StemStages?: Map<string, LoadStage> };
const stemStages = stageGlobals.__crowd2StemStages ??= new Map<string, LoadStage>();
export function stemStageFor(trackId: string) { return stemStages.get(trackId) ?? null; }
export function stemJobInFlight(trackId: string) { return stemInFlight.has(trackId); }
function rememberStemStage(trackId: string, stage: LoadStage) {
  stemStages.delete(trackId);
  stemStages.set(trackId, stage);
  if (stemStages.size > 64) stemStages.delete(stemStages.keys().next().value!);
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);

/** A job the worker ran and reported as failed: the worker itself is healthy. */
class WarmJobError extends Error {}

/**
 * The separator runtime for this server, resolved from the environment each
 * time so a whole job (warm, cold fallback and any retry) uses one answer.
 * A missing native runtime throws its setup error; nothing falls back to WSL.
 */
function drumsRuntime(): DrumsRuntime {
  const resolved = resolveDrumsRuntime({ platform: process.platform, env: process.env, cwd: process.cwd(), exists: existsSync });
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved;
}

/** Torch threads for a separation starting now: the idle budget only under a fresh booth-idle report. */
function demucsThreadBudget() {
  const normalThreads = Math.max(1, Math.min(4, Number(process.env.CROWD_ANALYSIS_THREADS) || 3));
  const idleThreads = Math.max(normalThreads, Math.min(12, Number(process.env.CROWD_DEMUCS_IDLE_THREADS) || normalThreads));
  return boothIsIdle() ? idleThreads : normalThreads;
}

function spawnDemucsWorker(runtime: DrumsRuntime): Promise<DemucsWorkerHandle> {
  return new Promise((resolveReady, rejectReady) => {
    const plan = drumsWorkerPlan(runtime);
    const spawnedAt = performance.now();
    const child = spawn(plan.command, plan.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: plan.env as NodeJS.ProcessEnv });
    demucsGlobals.__crowd2DemucsWorkerPid = child.pid;
    reportDemucsStartup({ pid: child.pid, step: "spawn", at: Date.now() });
    let buffer = "";
    // Drained so a chatty library can never fill the pipe and stall the
    // worker; the tail explains a worker that dies.
    let stderrTail = "";
    let ready = false;
    let pending: { settle: () => void; abort: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
    let workerDead: Error | null = null;
    const readyTimer = setTimeout(() => fail(new Error(`${runtime.label} warm separator did not become ready within 90 seconds`)), 90_000);
    const stopWorker = () => { child.stdin?.end(); child.kill(); };
    process.once("exit", stopWorker);
    const fail = (error: Error) => {
      clearTimeout(readyTimer);
      if (demucsGlobals.__crowd2DemucsWorkerPid === child.pid) {
        demucsGlobals.__crowd2DemucsWorker = undefined;
        demucsGlobals.__crowd2DemucsWorkerKey = undefined;
        demucsGlobals.__crowd2DemucsWorkerPid = undefined;
        reportDemucsStartup({ pid: child.pid, step: "failed", at: Date.now() });
      }
      workerDead = error;
      current = null;
      if (!ready) { ready = true; rejectReady(error); }
      if (pending) { clearTimeout(pending.timer); pending.abort(error); pending = null; }
      try { child.kill(); } catch { /* already gone */ }
    };
    child.on("error", (error) => fail(new Error(`${runtime.label} warm separator could not start: ${error.message}`)));
    child.on("close", () => {
      process.removeListener("exit", stopWorker);
      const reason = stderrTail.split("\n").map((text) => text.trim()).filter(Boolean).at(-1);
      fail(new Error(`${runtime.label} warm separator exited${reason ? `: ${reason.slice(0, 200)}` : ""}`));
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000); });
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "READY" && !ready) {
          clearTimeout(readyTimer);
          ready = true;
          handle.startMs = Math.round(performance.now() - spawnedAt);
          console.log(`[stems] ${runtime.label} separator ready in ${handle.startMs} ms (pid ${child.pid})`);
          reportDemucsStartup({ pid: child.pid, step: "ready", at: Date.now() });
          resolveReady(handle);
        }
        else if (line.startsWith("INFO ")) { console.log(`[stems] ${runtime.label} separator runtime ${line.slice(5)}`); }
        else if (line.startsWith("PROGRESS ")) {
          // Start-up lines belong to the worker; everything else to the job it is running.
          const event = parseSeparatorLine(line);
          if (event?.event === "startup") { if (!ready) reportDemucsStartup({ pid: child.pid, step: event.step, at: Date.now() }); }
          else if (event && current) { try { current.onEvent?.(event); } catch { /* progress never breaks a job */ } }
        }
        else if (line === "DONE" && pending) { clearTimeout(pending.timer); const settled = pending; pending = null; current = null; settled.settle(); }
      }
    });
    // DJ, 30 Aug 2026 ("plumbing"): a second tune used to hit "warm
    // separator is busy" and fall back to a COLD spawn - two Demucs fighting
    // for one GPU, which is exactly the "randomly takes too long" pattern.
    // Concurrent jobs now QUEUE on the warm worker instead: strictly serial,
    // each getting the full job timeout from the moment it actually starts.
    // A dead worker rejects the queue, so the cold fallback still covers
    // real failures - just never mere busyness.
    let tail: Promise<void> = Promise.resolve();
    // The job running now, and every job holding a place (running or queued),
    // in order: a tune that has to wait is told whose separation it waits on.
    let current: DemucsJobHooks | null = null;
    const lineup: DemucsJobHooks[] = [];
    const runOne = (job: DemucsJob, hooks: DemucsJobHooks) => new Promise<void>((settle, abort) => {
      if (workerDead) return abort(workerDead);
      clearDemucsIdleTimer();
      const timer = setTimeout(() => fail(new Error(`${runtime.label} warm separation timed out`)), JOB_TIMEOUT_MS);
      pending = { settle, abort, timer };
      current = hooks;
      try { hooks.onDispatch?.(); } catch { /* progress never breaks a job */ }
      child.stdin?.write(`${JSON.stringify({ ...job, threads: demucsThreadBudget() })}\n`);
    });
    const handle: DemucsWorkerHandle = {
      run: (job, hooks = { trackId: job.trackId ?? null, trackName: null }) => {
        const ahead = [...lineup];
        lineup.push(hooks);
        if (ahead.length) { try { hooks.onQueued?.(ahead); } catch { /* progress never breaks a job */ } }
        const next = tail.then(() => runOne(job, hooks)).finally(() => {
          const index = lineup.indexOf(hooks);
          if (index >= 0) lineup.splice(index, 1);
        });
        tail = next.catch(() => undefined);
        return next;
      },
      close: () => { try { child.stdin?.end(); child.kill(); } catch { /* already gone */ } },
      startMs: 0,
    };
  });
}

/** True when a worker for exactly this runtime exists (ready or still starting). */
function hasDemucsWorker(runtime: DrumsRuntime) {
  return Boolean(demucsGlobals.__crowd2DemucsWorker) && demucsGlobals.__crowd2DemucsWorkerKey === drumsRuntimeKey(runtime);
}

async function getDemucsWorker(runtime: DrumsRuntime): Promise<DemucsWorkerHandle> {
  clearDemucsIdleTimer();
  const key = drumsRuntimeKey(runtime);
  const cached = demucsGlobals.__crowd2DemucsWorker;
  if (cached && demucsGlobals.__crowd2DemucsWorkerKey === key) return cached;
  // A worker from another runtime (a backend switch, or a WSL worker a dev
  // recompile inherited on globalThis) is retired, never borrowed.
  if (cached) void cached.then((worker) => worker.close()).catch(() => undefined);
  const spawned = spawnDemucsWorker(runtime);
  demucsGlobals.__crowd2DemucsWorker = spawned;
  demucsGlobals.__crowd2DemucsWorkerKey = key;
  spawned.catch(() => {
    if (demucsGlobals.__crowd2DemucsWorker !== spawned) return;
    demucsGlobals.__crowd2DemucsWorker = undefined;
    demucsGlobals.__crowd2DemucsWorkerKey = undefined;
  });
  return spawned;
}

/**
 * Retire the worker a failed job used — only that one, so a newer worker
 * spawned meanwhile survives — and close it, so no orphan keeps a model
 * resident beside its replacement.
 */
function retireDemucsWorker(used: Promise<DemucsWorkerHandle>) {
  if (demucsGlobals.__crowd2DemucsWorker === used) {
    demucsGlobals.__crowd2DemucsWorker = undefined;
    demucsGlobals.__crowd2DemucsWorkerKey = undefined;
  }
  void used.then((worker) => worker.close()).catch(() => undefined);
}

function clearDemucsIdleTimer() {
  if (demucsGlobals.__crowd2DemucsWorkerIdle) clearTimeout(demucsGlobals.__crowd2DemucsWorkerIdle);
  demucsGlobals.__crowd2DemucsWorkerIdle = undefined;
}

export async function warmDrumsSeparator() {
  if (!WARM_DEMUCS) return;
  await getDemucsWorker(drumsRuntime());
  releaseDemucsWorkerAfterIdle();
}

function releaseDemucsWorkerAfterIdle() {
  clearDemucsIdleTimer();
  demucsGlobals.__crowd2DemucsWorkerIdle = setTimeout(() => {
    if (stemInFlight.size) { releaseDemucsWorkerAfterIdle(); return; }
    void demucsGlobals.__crowd2DemucsWorker?.then((worker) => worker.close()).catch(() => undefined);
    demucsGlobals.__crowd2DemucsWorker = undefined;
    demucsGlobals.__crowd2DemucsWorkerKey = undefined;
    demucsGlobals.__crowd2DemucsWorkerIdle = undefined;
  }, DEMUCS_WORKER_IDLE_MS);
  demucsGlobals.__crowd2DemucsWorkerIdle.unref?.();
}

type SeparationPayload = {
  ok?: boolean; error?: string; separationSeconds?: number; threads?: number; device?: string; seconds?: number;
  decodeSeconds?: number; modelSeconds?: number; writeSeconds?: number; writer?: string;
};

function payloadTiming(payload: SeparationPayload): Partial<StemTiming> {
  const ms = (seconds?: number) => (seconds === undefined ? undefined : Math.round(seconds * 1000));
  return {
    separationMs: ms(payload.separationSeconds ?? 0), threads: payload.threads, device: payload.device, audioSeconds: payload.seconds,
    decodeMs: ms(payload.decodeSeconds), modelMs: ms(payload.modelSeconds), writeMs: ms(payload.writeSeconds), writer: payload.writer,
  };
}

const ownerName = (owner: DemucsJobOwner) => owner.trackName ?? owner.trackId ?? "another tune";

async function separateDrumsWarm(runtime: DrumsRuntime, audioFile: string, trackId?: string, outputFile?: string, started?: Promise<DemucsWorkerHandle>, stage?: LoadStage, trackName?: string | null): Promise<{ scratch: string; wav: string }> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-kickjob-"));
  const wav = outputFile ?? path.join(scratch, "drums.wav");
  const result = path.join(scratch, "result.json");
  const workerStarted = performance.now();
  // Read before asking for a worker: asking may itself start one.
  const alreadyReady = demucsWorkerReady(runtime);
  // The job's own early start when there is one: a worker that failed to
  // start is not started a second time before the cold fallback.
  const used = started ?? getDemucsWorker(runtime);
  // Start-up is a real sub-step only when this job waits for a process to
  // come up; the worker's own lines (import, model) name what it is doing.
  let stopWatching: (() => void) | null = null;
  if (stage) {
    if (alreadyReady) skipStep(stage, "startup", Date.now(), "Separator already running with HTDemucs loaded");
    else {
      const startup = demucsGlobals.__crowd2DemucsStartup;
      beginStep(stage, "startup", Date.now(), separatorStartupDetail(startup && startup.step !== "ready" && startup.step !== "failed" ? startup.step : "spawn"));
      const listener = (status: DemucsStartup) => {
        if (status.step !== "ready" && status.step !== "failed") updateStep(stage, "startup", Date.now(), { detail: separatorStartupDetail(status.step) });
      };
      startupListeners.add(listener);
      stopWatching = () => { startupListeners.delete(listener); };
    }
  }
  try {
    const worker = await used;
    stopWatching?.();
    if (stage && !alreadyReady) finishStep(stage, "startup", Date.now(), `Separator ready · HTDemucs loaded (${(worker.startMs / 1000).toFixed(1)} s from process start)`);
    if (trackId) saveStemTiming(trackId, { workerWaitMs: Math.round(performance.now() - workerStarted), path: "warm" });
    await worker.run({
      audio: drumsJobPath(runtime, audioFile),
      out: drumsJobPath(runtime, wav),
      result: drumsJobPath(runtime, result),
      demixRoot: SHARED_DEMIX ? drumsJobPath(runtime, sharedDemixRoot()) : null,
      trackId,
    }, {
      trackId: trackId ?? null,
      trackName: trackName ?? null,
      onQueued: (ahead) => {
        if (stage) beginStep(stage, "wait", Date.now(), `Separator busy with ${ahead.map(ownerName).join(", then ")} · this tune is next`);
      },
      onDispatch: () => {
        if (!stage) return;
        if (stage.steps.find((step) => step.id === "wait")?.state === "active") finishStep(stage, "wait", Date.now(), "Separator free · job sent");
        else skipStep(stage, "wait", Date.now(), "Separator was free");
      },
      onEvent: (event) => { if (stage) applySeparatorEvent(stage, event, Date.now()); },
    });
    releaseDemucsWorkerAfterIdle();
    const payload = JSON.parse(readFileSync(result, "utf8")) as SeparationPayload;
    if (!payload.ok) throw new WarmJobError(payload.error ?? "warm separation failed");
    if (trackId) saveStemTiming(trackId, payloadTiming(payload));
    if (stage) settleUnreportedSteps(stage, ["decode", "blocks", "write"], Date.now());
    return { scratch, wav };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    // A job the worker reported as failed leaves a healthy worker; anything
    // else (spawn, exit, timeout, protocol) retires the one this job used.
    if (!(error instanceof WarmJobError)) retireDemucsWorker(used);
    throw error;
  } finally {
    stopWatching?.();
  }
}

export async function ensureDrumsStem(trackId: string): Promise<string> {
  const kept = kickStemPath(trackId);
  if (!kept) throw new Error("no stem path for that track id");
  if (existsSync(kept)) return kept;
  const running = stemInFlight.get(trackId);
  if (running) return running;
  // DJ, 26 Sep 2026 ("that demucs step is too much of a black box"): every
  // real sub-step of this job — audio input, separator start-up, waiting
  // behind another tune, decode, each block, stem write, publish — lands on
  // this stage as it happens, for the deck to show (lib/load-progress.ts).
  const stage = createStage("stem");
  rememberStemStage(trackId, stage);
  const job = (async () => {
    const started = performance.now();
    stemTimings.delete(trackId);
    beginStep(stage, "input", Date.now(), "Locating the audio file");
    try {
      // One runtime for the whole job: the warm worker, its cold fallback and
      // any retry all run on it. A missing native runtime throws its setup
      // error right here — there is no silent move to WSL.
      const runtime = drumsRuntime();
      saveStemTiming(trackId, { backend: runtime.label });
      // A first load after a restart pays interpreter + torch + model start-up;
      // begin it now so it overlaps the library lookup and any MP3 sidecar
      // transcode below. The same promise is awaited by the warm separation.
      let earlyWorker: Promise<DemucsWorkerHandle> | undefined;
      if (WARM_DEMUCS) {
        const coldStart = !hasDemucsWorker(runtime);
        earlyWorker = getDemucsWorker(runtime);
        earlyWorker.then(
          (worker) => { if (coldStart) saveStemTiming(trackId, { workerStartMs: worker.startMs }); },
          () => undefined,
        );
      }
      try {
        const track = await getMusicTrack(trackId);
        if (!track) throw new Error("that track is not in the music library");
        updateStep(stage, "input", Date.now(), { detail: "Preparing the booth-clock audio for the separator" });
        const audio = await seekAccuratePath(await resolveMusicPath(track));
        if (!audio || !existsSync(audio)) throw new Error("no audio file for that track");
        await mkdir(KICK_STEM_DIRECTORY, { recursive: true });
        finishStep(stage, "input", Date.now(), "Audio input ready");
        const partial = `${kept}.partial.wav`;
        let attempts = 0;
        const attemptSeparation = async () => {
          attempts += 1;
          if (attempts > 1) restartStage(stage, Date.now(), "WSL answered again", "startup");
          if (WARM_DEMUCS) {
            // First attempt reuses the early start; a retry after a WSL heal starts afresh.
            const started = earlyWorker;
            earlyWorker = undefined;
            try {
              return await separateDrumsWarm(runtime, audio, trackId, partial, started, stage, track.name ?? null);
            } catch (error) {
              console.warn(`[stems] ${runtime.label} warm separator fell back to the ${runtime.label} cold spawn: ${error instanceof Error ? error.message : String(error)}`);
              // The cold run separates the whole tune again: a new, labelled attempt.
              restartStage(stage, Date.now(), `the resident separator failed (${errorText(error)}) · separating again in a one-shot process`, "startup");
            }
          }
          return separateDrums(runtime, audio, trackId, stage);
        };
        let separated: { scratch: string; wav: string };
        try {
          separated = await attemptSeparation();
        } catch (error) {
          await rm(partial, { force: true });
          // A dead WSL fails both paths in milliseconds. When WSL is the
          // selected runtime, heal it and retry once; any other failure (or a
          // heal that could not bring WSL back, or a native runtime) surfaces
          // exactly as it happened.
          if (!drumsRuntimeMayHealWsl(runtime) || !(await healWslIfDead(error))) throw error;
          console.warn("[stems] retrying the separation once on the restarted WSL");
          separated = await attemptSeparation();
        }
        try {
          const publishStarted = performance.now();
          beginStep(stage, "publish", Date.now(), "Moving the finished stem into the stem library");
          if (separated.wav !== partial) await copyFile(separated.wav, partial);
          await rename(partial, kept);
          saveStemTiming(trackId, { publishMs: Math.round(performance.now() - publishStarted), totalMs: Math.round(performance.now() - started) });
          finishStep(stage, "publish", Date.now(), "Stem published");
          completeStage(stage, Date.now(), "Drum stem ready");
          return kept;
        } finally {
          await rm(partial, { force: true });
          rmSync(separated.scratch, { recursive: true, force: true });
        }
      } finally {
        // Whatever happened, a worker this job woke must still idle out.
        if (WARM_DEMUCS) releaseDemucsWorkerAfterIdle();
      }
    } catch (error) {
      failStage(stage, Date.now(), errorText(error));
      throw error;
    }
  })().finally(() => { stemInFlight.delete(trackId); });
  stemInFlight.set(trackId, job);
  return job;
}

async function runWorker() {
  while (runtime.queue.length) {
    // DJ, 25 Aug 2026: separation runs even while a deck plays — he chose
    // the GPU-contention risk over stem loads stalling until the booth goes
    // quiet. Flip SEPARATION_DURING_PLAYBACK to false to restore the gate.
    if (!SEPARATION_DURING_PLAYBACK && !boothIsIdle()) return;
    const trackId = runtime.queue.shift()!;
    if (kickAnalysisComplete(trackId)) continue;
    runtime.running = trackId;
    let scratch: string | null = null;
    try {
      const track = await getMusicTrack(trackId);
      if (!track) throw new Error("that track is not in the music library");
      runtime.runningName = track.name ?? trackId;
      // Booth clock, not raw-upload clock: LAME MP3s carry 25 ms of encoder
      // padding that the playback sidecar strips. A stem separated from the
      // raw file puts every kick 25 ms late in booth terms — see
      // lib/playback-clock.ts for the 16 Aug 2026 incident.
      // 1. Stem via the SHARED single-flight helper — 26 Aug 2026: the worker's
      // old inline separation raced runMapping's ensureDrumsStem and ran TWO
      // Demucs passes for one tune, stalling the whole server. One flight per
      // track, whoever asks.
      runtime.stage = "separating";
      const stem = await ensureDrumsStem(trackId);

      if (ANALYSER_GRID_ONLY_TESTS) return; // stem persisted; the analyser grid is the only grid during tests

      // 2. Kicks — WHICH from the low band, WHERE from the slap.
      //
      // The low-band detector alone anchors on the sub swell, and the slap
      // leads the sub by 5-70 ms — DJ cues to the slap. Every map this
      // worker produced before 16 Aug 2026 sat 25-40 ms past the crack (the
      // knee sweep measured it; DJ heard it on The Prayer and High Energy).
      // This is the certified 12h-run recipe verbatim: detect on the low
      // band, re-time each hit onto its slap onset with the sub confirming —
      // strict 1:1, a hit is re-timed, never added or deleted.
      runtime.stage = "detecting";
      const samples = await decode(stem, KICK_PICK_SAMPLE_RATE);
      const hits = detectKicks(samples, KICK_PICK_SAMPLE_RATE);
      if (hits.length < MINIMUM_KICKS) throw new Error(`only ${hits.length} kicks detected`);
      const shapePcm = await decode(stem, KICK_SHAPE_SAMPLE_RATE);
      const anchoredHits = anchorHitsLocally(
        hits,
        slapEnvelope(shapePcm, KICK_SHAPE_SAMPLE_RATE),
        subEnvelope(samples, KICK_PICK_SAMPLE_RATE),
      );
      saveKickHits(trackId, {
        timesMs: anchoredHits.map((hit) => Math.round(hit.time * 1000)),
        strengths: anchoredHits.map((hit) => Math.round(hit.strength * 1000)),
        impliedTempo: impliedTempo(anchoredHits),
        detector: "low-band rise, adaptive threshold, 180ms suppression + slap-anchor v1",
        computedAt: new Date().toISOString(),
      });

      // 3. Grid. Stored as a proposal; nothing adopts it here.
      runtime.stage = "fitting";
      const duration = samples.length / KICK_PICK_SAMPLE_RATE;
      const grid = fitKickGrid(anchoredHits.map((hit) => hit.time), duration);
      if (!grid) throw new Error("no grid could be fitted to those kicks");
      saveKickGrid(trackId, {
        bpm: grid.bpm,
        firstBeatMs: Math.round(grid.firstBeat * 1000),
        beatCount: grid.beats.length,
        explains: grid.explains,
        covered: grid.covered,
        medianErrorMs: grid.medianErrorMs,
        outliers: grid.outliers,
        computedAt: new Date().toISOString(),
      });
      runtime.completed += 1;
      runtime.lastError = null;
    } catch (error) {
      runtime.failed += 1;
      runtime.lastError = `${runtime.runningName ?? trackId}: ${error instanceof Error ? error.message : "drum analysis failed"}`;
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      runtime.running = null;
      runtime.runningName = null;
      runtime.stage = null;
    }
  }
}

// DJ, 27 Aug 2026 (shared demix): separation now emits all four sources and
// parks them where All-In-One's demix stage looks, so the tune is separated
// ONCE per load instead of twice. CROWD_SHARED_DEMIX=0 restores two-stem runs.
export const sharedDemixRoot = () => path.join(process.cwd(), "data", "demix-cache");
const SHARED_DEMIX = process.env.CROWD_SHARED_DEMIX !== "0";

/** The cold one-shot separation, on the same runtime the warm worker used. */
function separateDrums(runtime: DrumsRuntime, audioFile: string, trackId?: string, stage?: LoadStage): Promise<{ scratch: string; wav: string }> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-kickjob-"));
  const wav = path.join(scratch, "drums.wav");
  const result = path.join(scratch, "result.json");
  return new Promise((resolve, reject) => {
    const plan = drumsColdPlan(runtime, {
      audio: audioFile, out: wav, result,
      demixRoot: SHARED_DEMIX ? sharedDemixRoot() : null,
      threads: demucsThreadBudget(),
    });
    // A one-shot process always starts up (interpreter, PyTorch, model) and
    // speaks the resident worker's PROGRESS protocol on stdout.
    if (stage) beginStep(stage, "startup", Date.now(), separatorStartupDetail("spawn"));
    const child = spawn(plan.command, plan.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: plan.env as NodeJS.ProcessEnv });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      let newline;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const event = parseSeparatorLine(stdout.slice(0, newline).trim());
        stdout = stdout.slice(newline + 1);
        if (event && stage) applySeparatorEvent(stage, event, Date.now());
      }
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-1200); });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`${runtime.label} drum separation timed out`)); }, JOB_TIMEOUT_MS);
    const fail = (error: Error) => { clearTimeout(timer); rmSync(scratch, { recursive: true, force: true }); reject(error); };
    child.on("error", (error) => fail(new Error(runtime.backend === "wsl" ? `could not start WSL: ${error.message}` : `could not start the ${runtime.label} separator: ${error.message}`)));
    child.on("close", () => {
      clearTimeout(timer);
      let payload: SeparationPayload;
      try { payload = JSON.parse(readFileSync(result, "utf8")); }
      catch { return fail(new Error(stderr.split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? "separation produced no result")); }
      if (!payload.ok) return fail(new Error(payload.error ?? "separation failed"));
      if (trackId) saveStemTiming(trackId, { path: "cold", ...payloadTiming(payload) });
      if (stage) settleUnreportedSteps(stage, ["decode", "blocks", "write"], Date.now());
      resolve({ scratch, wav });
    });
  });
}

function decode(file: string, sampleRate: number): Promise<Float32Array> {
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1",
      "-ar", String(sampleRate), "-f", "f32le", "pipe:1"], { windowsHide: true });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`));
      const bytes = Buffer.concat(chunks);
      resolve(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)));
    });
  });
}

export function resetKickAnalysis() {
  runtime.queue = [];
  runtime.running = null;
  runtime.runningName = null;
  runtime.stage = null;
  runtime.worker = null;
  runtime.completed = 0;
  runtime.failed = 0;
  runtime.lastError = null;
  runtime.idle = false;
  runtime.idleAt = 0;
}

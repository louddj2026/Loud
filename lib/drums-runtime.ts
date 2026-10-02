import path from "node:path";
import { ANALYSIS_RUNTIME_SETUP_COMMAND, defaultAnalysisRuntimeRoot, modelWorkerEnv, platformPath, resolveAnalysisRuntime } from "./analysis-runtime.ts";

/**
 * Where the HTDemucs drums separator runs, decided in ONE place so the
 * resident worker, its cold fallback, the booth's prewarm and any retry can
 * never land on different machines.
 *
 * DJ, 26 Sep 2026: the booth separates NATIVELY on Windows by default —
 * scripts/drums-stem-worker.py and scripts/drums-stem.py run by the shared
 * analysis runtime (lib/analysis-runtime.ts: Python 3.12.10, torch 2.5.1+cpu,
 * the same htdemucs checkpoint and Demucs commit as the WSL reference, with
 * identical kick onsets, Beat This beats and grids measured against it),
 * which scripts/setup-analysis-runtime.mjs installs and verifies. The WSL
 * runtime (Ubuntu-24.04, /opt/allin1) stays available only when an operator
 * asks for it with CROWD_DEMUCS_BACKEND=wsl. Nothing falls back across that
 * line: a missing native runtime is a setup error, never a reason to wake
 * Linux.
 *
 * Pure: every input is a parameter, so the choice is testable without
 * spawning anything.
 */

export type DrumsBackend = "windows" | "wsl";
export type DrumsEnv = Record<string, string | undefined>;

export const WSL_DISTRIBUTION = "Ubuntu-24.04";
export const WSL_SEPARATOR_PYTHON = "/opt/allin1/bin/python";
export const DRUMS_WORKER_SCRIPT = "drums-stem-worker.py";
export const DRUMS_COLD_SCRIPT = "drums-stem.py";
export const SEPARATOR_SETUP_COMMAND = ANALYSIS_RUNTIME_SETUP_COMMAND;

export type DrumsRuntimeRequest = {
  platform: string;
  env: DrumsEnv;
  cwd: string;
  exists: (file: string) => boolean;
};

export type WindowsDrumsRuntime = {
  ok: true;
  backend: "windows";
  label: string;
  python: string;
  torchHome: string;
  ffmpeg: string;
  ffprobe: string;
  workerScript: string;
  coldScript: string;
  /** The complete child environment: decoder directories first on PATH. */
  env: DrumsEnv;
};

export type WslDrumsRuntime = {
  ok: true;
  backend: "wsl";
  label: string;
  distribution: string;
  python: string;
  /** Host (Windows) paths; translated to /mnt/<drive>/ only when spawned. */
  workerScript: string;
  coldScript: string;
  env: DrumsEnv;
};

export type DrumsRuntime = WindowsDrumsRuntime | WslDrumsRuntime;
export type DrumsRuntimeFailure = { ok: false; backend: DrumsBackend | null; error: string };
export type DrumsRuntimeResolution = DrumsRuntime | DrumsRuntimeFailure;

export type DrumsSpawnPlan = { command: string; args: string[]; env: DrumsEnv };
export type DrumsColdFiles = { audio: string; out: string; result: string; demixRoot?: string | null; threads?: number };

/** `D:\Music\x.mp3` -> `/mnt/d/Music/x.mp3`, exactly as lib/section-analysis.ts toWslPath. */
export function wslPathFor(windowsPath: string) {
  const absolute = path.win32.resolve(windowsPath);
  const drive = absolute.match(/^([A-Za-z]):[\\/]/);
  if (!drive) return absolute.replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${absolute.slice(3).replace(/\\/g, "/")}`;
}

function setting(env: DrumsEnv, name: string) {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function requestedDrumsBackend(platform: string, env: DrumsEnv): { backend: DrumsBackend } | DrumsRuntimeFailure {
  const raw = env.CROWD_DEMUCS_BACKEND?.trim();
  if (!raw) return { backend: "windows" };
  const backend = raw.toLowerCase();
  if (backend !== "windows" && backend !== "wsl") {
    return { ok: false, backend: null, error: `CROWD_DEMUCS_BACKEND must be "windows" or "wsl", not "${raw}".` };
  }
  if (backend === "wsl" && platform !== "win32") {
    return { ok: false, backend: "wsl", error: "CROWD_DEMUCS_BACKEND=wsl needs a Windows host with wsl.exe." };
  }
  return { backend };
}

/**
 * The folder whose torch\ and ffprobe\ belong to an overriding python:
 * <root>\Scripts\python.exe (a self-contained env) or <root>\env\Scripts\
 * python.exe (the analysis-runtime layout) — whichever holds the probe.
 */
function rootBeside(python: string, platform: string, exists: (file: string) => boolean) {
  const api = platformPath(platform);
  const folder = api.dirname(python);
  const leaf = api.basename(folder).toLowerCase();
  const envRoot = leaf === "scripts" || leaf === "bin" ? api.dirname(folder) : folder;
  const probe = platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return [envRoot, api.dirname(envRoot)].find((root) => exists(api.join(root, "ffprobe", probe))) ?? envRoot;
}

function missingNative(message: string): DrumsRuntimeFailure {
  return {
    ok: false,
    backend: "windows",
    error: `Native drums separator is not ready: ${message} Run \`${SEPARATOR_SETUP_COMMAND}\` (or set CROWD_ANALYSIS_RUNTIME to a prepared runtime). WSL is used only when CROWD_DEMUCS_BACKEND=wsl.`,
  };
}

function resolveWindows({ platform, env, cwd, exists }: DrumsRuntimeRequest): WindowsDrumsRuntime | DrumsRuntimeFailure {
  const api = platformPath(platform);
  const windows = platform === "win32";
  const override = setting(env, "CROWD_DEMUCS_PYTHON");
  const runtime = resolveAnalysisRuntime({ platform, env, cwd, exists });
  const python = override ?? runtime?.paths.python;
  if (!python) return missingNative(`no analysis runtime at ${defaultAnalysisRuntimeRoot(cwd, platform)} and CROWD_ANALYSIS_RUNTIME is not set.`);
  if (!exists(python)) return missingNative(`${python} does not exist.`);
  // The model home and decoder probe travel with the interpreter: the
  // runtime's own, or those beside an overriding python.
  const root = override ? rootBeside(override, platform, exists) : runtime!.paths.root;
  const torchHome = setting(env, "CROWD_DEMUCS_TORCH_HOME") ?? api.join(root, "torch");
  const ffprobe = setting(env, "CROWD_DEMUCS_FFPROBE") ?? api.join(root, "ffprobe", windows ? "ffprobe.exe" : "ffprobe");
  // Demucs asks ffprobe for the stream layout before ffmpeg decodes; without
  // it Demucs quietly decodes through torchaudio instead, which resamples and
  // decodes MP3 differently from the reference. Required, not optional.
  if (!exists(ffprobe)) return missingNative(`the decoder probe ${ffprobe} does not exist.`);
  const ffmpegName = windows ? "ffmpeg.exe" : "ffmpeg";
  const ffmpeg = [setting(env, "FFMPEG_BIN"), api.join(cwd, "node_modules", "ffmpeg-static", ffmpegName)]
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => exists(candidate));
  if (!ffmpeg) return missingNative(`the app's FFmpeg decoder (node_modules/ffmpeg-static/${ffmpegName}) is missing.`);

  // Demucs finds ffprobe and ffmpeg by name, so both directories go first.
  const childEnv = modelWorkerEnv(env, { platform, decoderDirectories: [api.dirname(ffmpeg), api.dirname(ffprobe)], torchHome });
  return {
    ok: true,
    backend: "windows",
    label: windows ? "windows-native" : `${platform}-native`,
    python,
    torchHome,
    ffmpeg,
    ffprobe,
    workerScript: api.join(cwd, "scripts", DRUMS_WORKER_SCRIPT),
    coldScript: api.join(cwd, "scripts", DRUMS_COLD_SCRIPT),
    env: childEnv,
  };
}

export function resolveDrumsRuntime(request: DrumsRuntimeRequest): DrumsRuntimeResolution {
  const requested = requestedDrumsBackend(request.platform, request.env);
  if ("ok" in requested) return requested;
  if (requested.backend === "windows") return resolveWindows(request);
  return {
    ok: true,
    backend: "wsl",
    label: `wsl:${WSL_DISTRIBUTION}`,
    distribution: WSL_DISTRIBUTION,
    python: WSL_SEPARATOR_PYTHON,
    workerScript: path.win32.join(request.cwd, "scripts", DRUMS_WORKER_SCRIPT),
    coldScript: path.win32.join(request.cwd, "scripts", DRUMS_COLD_SCRIPT),
    // The reference keeps its original environment: .env.local's WSLENV
    // forwards the thread settings. Native-only settings never cross over.
    env: { ...request.env },
  };
}

/** Stable identity of a runtime, so a worker is never reused across runtimes. */
export function drumsRuntimeKey(runtime: DrumsRuntime) {
  return runtime.backend === "windows"
    ? ["windows", runtime.python, runtime.torchHome, runtime.ffprobe, runtime.ffmpeg, runtime.workerScript].join("|")
    : ["wsl", runtime.distribution, runtime.python, runtime.workerScript].join("|");
}

/** A path as the separator process must see it. */
export function drumsJobPath(runtime: DrumsRuntime, file: string) {
  return runtime.backend === "wsl" ? wslPathFor(file) : file;
}

function planFor(runtime: DrumsRuntime, script: string, operands: string[], env: DrumsEnv): DrumsSpawnPlan {
  const target = [script, ...operands].map((file) => drumsJobPath(runtime, file));
  if (runtime.backend === "wsl") {
    return { command: "wsl.exe", args: ["-d", runtime.distribution, "-u", "root", "--", runtime.python, ...target], env };
  }
  return { command: runtime.python, args: target, env };
}

export function drumsWorkerPlan(runtime: DrumsRuntime): DrumsSpawnPlan {
  return planFor(runtime, runtime.workerScript, [], runtime.env);
}

export function drumsColdPlan(runtime: DrumsRuntime, files: DrumsColdFiles): DrumsSpawnPlan {
  const operands = [files.audio, files.out, files.result, ...(files.demixRoot ? [files.demixRoot] : [])];
  // The native cold run takes the same thread budget the warm job would
  // have; the WSL reference keeps its OMP_NUM_THREADS default untouched.
  const env = runtime.backend === "windows" && files.threads
    ? { ...runtime.env, CROWD_DEMUCS_THREADS: String(files.threads) }
    : runtime.env;
  return planFor(runtime, runtime.coldScript, operands, env);
}

/** Only an explicitly selected WSL runtime may be probed or restarted. */
export function drumsRuntimeMayHealWsl(runtime: DrumsRuntime) {
  return runtime.backend === "wsl";
}

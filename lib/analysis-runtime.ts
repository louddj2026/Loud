import path from "node:path";

/**
 * Crowd2's native analysis runtime: ONE plain directory holding the Python
 * env that both local models run in (Beat This and HTDemucs), their verified
 * checkpoints (the workers' TORCH_HOME) and the decoder probe:
 *
 *   <root>\env\Scripts\python.exe        Python 3.12.10 venv, torch 2.5.1+cpu
 *   <root>\torch\hub\checkpoints\        htdemucs 955717e8-8726e21a.th,
 *                                        beat_this-small0.ckpt (SHA-256 checked)
 *   <root>\ffprobe\ffprobe.exe           pairs with the app's FFmpeg 6.1.1
 *   <root>\runtime.json                  what scripts/setup-analysis-runtime.mjs
 *                                        installed and verified
 *
 * DJ, 26 Sep 2026: the earlier envs lived under %LOCALAPPDATA%\Crowd2, which
 * on this PC is MSIX-virtualised into the Codex package — a booth started
 * from D:\Crowd\Start-Crowd.cmd could not see them. The runtime is now a
 * physical path, named in .env.local as CROWD_ANALYSIS_RUNTIME; without it the
 * D:\Crowd layout default (<app>\..\Codex\runtimes\crowd2-analysis) is used
 * when its interpreter exists.
 *
 * Pure: every input is a parameter.
 */

export type RuntimeEnv = Record<string, string | undefined>;
export const ANALYSIS_RUNTIME_SETUP_COMMAND = "node scripts/setup-analysis-runtime.mjs";
export const DEFAULT_ANALYSIS_RUNTIME_FROM_APP = ["..", "Codex", "runtimes", "crowd2-analysis"] as const;

export type AnalysisRuntimePaths = {
  root: string;
  python: string;
  sitePackages: string;
  torchHome: string;
  ffprobe: string;
  manifest: string;
};

export type AnalysisRuntimeRequest = {
  platform: string;
  env: RuntimeEnv;
  cwd: string;
  exists: (file: string) => boolean;
};

export function platformPath(platform: string) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function analysisRuntimePaths(root: string, platform: string): AnalysisRuntimePaths {
  const api = platformPath(platform);
  const windows = platform === "win32";
  return {
    root,
    python: api.join(root, "env", windows ? "Scripts" : "bin", windows ? "python.exe" : "python"),
    sitePackages: windows ? api.join(root, "env", "Lib", "site-packages") : api.join(root, "env", "lib", "python3.12", "site-packages"),
    torchHome: api.join(root, "torch"),
    ffprobe: api.join(root, "ffprobe", windows ? "ffprobe.exe" : "ffprobe"),
    manifest: api.join(root, "runtime.json"),
  };
}

/** Where the default runtime would be for an app at `cwd`. */
export function defaultAnalysisRuntimeRoot(cwd: string, platform: string) {
  return platformPath(platform).resolve(cwd, ...DEFAULT_ANALYSIS_RUNTIME_FROM_APP);
}

/**
 * The runtime this app should use: CROWD_ANALYSIS_RUNTIME when set (returned
 * even when missing, so a setup error can name it), else the layout default
 * when its interpreter exists, else null.
 */
export function resolveAnalysisRuntime({ platform, env, cwd, exists }: AnalysisRuntimeRequest): { paths: AnalysisRuntimePaths; explicit: boolean } | null {
  const api = platformPath(platform);
  const configured = env.CROWD_ANALYSIS_RUNTIME?.trim();
  if (configured) return { paths: analysisRuntimePaths(api.resolve(configured), platform), explicit: true };
  const paths = analysisRuntimePaths(defaultAnalysisRuntimeRoot(cwd, platform), platform);
  return exists(paths.python) ? { paths, explicit: false } : null;
}

/** Windows environment names are case-insensitive: replace, never duplicate. */
export function setEnvVariable(env: RuntimeEnv, name: string, value: string | undefined, platform: string) {
  const matches = Object.keys(env).filter((key) => (platform === "win32" ? key.toUpperCase() === name.toUpperCase() : key === name));
  const keep = matches[0] ?? name;
  for (const key of matches) if (key !== keep) delete env[key];
  if (value === undefined) delete env[keep];
  else env[keep] = value;
}

export function readEnvVariable(env: RuntimeEnv, name: string, platform: string) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * The environment every native model worker gets, Demucs and Beat This alike:
 * decoder directories first on PATH, the runtime's own model home, UTF-8
 * stdio (job lines carry accented crate paths), and no stray global Python
 * settings grafting another installation's packages on.
 */
export function modelWorkerEnv(base: RuntimeEnv, options: { platform: string; decoderDirectories?: string[]; torchHome?: string }): RuntimeEnv {
  const { platform } = options;
  const api = platformPath(platform);
  const env: RuntimeEnv = { ...base };
  const directories = [...new Set(options.decoderDirectories ?? [])];
  if (directories.length) {
    const inherited = readEnvVariable(base, "PATH", platform);
    setEnvVariable(env, "PATH", [...directories, inherited].filter(Boolean).join(api.delimiter), platform);
  }
  if (options.torchHome) setEnvVariable(env, "TORCH_HOME", options.torchHome, platform);
  setEnvVariable(env, "PYTHONUTF8", "1", platform);
  setEnvVariable(env, "PYTHONHOME", undefined, platform);
  setEnvVariable(env, "PYTHONPATH", undefined, platform);
  return env;
}

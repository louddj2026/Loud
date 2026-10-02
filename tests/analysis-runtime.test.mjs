import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  analysisRuntimePaths, defaultAnalysisRuntimeRoot, modelWorkerEnv, resolveAnalysisRuntime,
} from "../lib/analysis-runtime.ts";

const win = path.win32;
const ROOT = "D:\\Crowd Runtimes\\crowd2-analysis";

test("one runtime directory holds the interpreter, both model checkpoints' home and the decoder probe", () => {
  assert.deepEqual(analysisRuntimePaths(ROOT, "win32"), {
    root: ROOT,
    python: win.join(ROOT, "env", "Scripts", "python.exe"),
    sitePackages: win.join(ROOT, "env", "Lib", "site-packages"),
    torchHome: win.join(ROOT, "torch"),
    ffprobe: win.join(ROOT, "ffprobe", "ffprobe.exe"),
    manifest: win.join(ROOT, "runtime.json"),
  });
});

test("the default runtime sits beside the app in the D:\\Crowd layout, never under LOCALAPPDATA", () => {
  assert.equal(defaultAnalysisRuntimeRoot("D:\\Crowd\\Crowd2", "win32"), "D:\\Crowd\\Codex\\runtimes\\crowd2-analysis");
  const python = "D:\\Crowd\\Codex\\runtimes\\crowd2-analysis\\env\\Scripts\\python.exe";
  const found = resolveAnalysisRuntime({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\DJ\\AppData\\Local" }, cwd: "D:\\Crowd\\Crowd2", exists: (file) => file === python });
  assert.equal(found?.explicit, false);
  assert.equal(found?.paths.python, python);
  assert.ok(!found?.paths.root.includes("AppData"));
  assert.equal(resolveAnalysisRuntime({ platform: "win32", env: {}, cwd: "D:\\Crowd\\Crowd2", exists: () => false }), null);
});

test("CROWD_ANALYSIS_RUNTIME is explicit: used as given (spaces and all), even before it exists", () => {
  const found = resolveAnalysisRuntime({ platform: "win32", env: { CROWD_ANALYSIS_RUNTIME: `  ${ROOT}  ` }, cwd: "D:\\Crowd\\Crowd2", exists: () => false });
  assert.equal(found?.explicit, true);
  assert.equal(found?.paths.root, ROOT);
});

test("every model worker gets the same environment: decoders first, its own model home, UTF-8, no foreign Python", () => {
  const base = { Path: "C:\\Windows\\system32", PATH: "C:\\dupe", PYTHONPATH: "C:\\legacy\\site-packages", PYTHONHOME: "C:\\legacy", TORCH_HOME: "C:\\Users\\DJ\\.cache\\torch", OMP_NUM_THREADS: "4" };
  const env = modelWorkerEnv(base, { platform: "win32", decoderDirectories: ["D:\\app\\ffmpeg-static", "D:\\rt\\ffprobe", "D:\\app\\ffmpeg-static"], torchHome: "D:\\rt\\torch" });
  assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase() === "PATH"), ["Path"]);
  assert.equal(env.Path, "D:\\app\\ffmpeg-static;D:\\rt\\ffprobe;C:\\Windows\\system32");
  assert.equal(env.TORCH_HOME, "D:\\rt\\torch");
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.PYTHONHOME, undefined);
  assert.equal(env.OMP_NUM_THREADS, "4", "thread settings pass through");
  assert.equal(base.PYTHONPATH, "C:\\legacy\\site-packages", "the caller's environment is not mutated");
  const beat = modelWorkerEnv(base, { platform: "win32", torchHome: "D:\\rt\\torch" });
  assert.equal(beat.Path, "C:\\Windows\\system32", "no decoder directories, no PATH change");
});

test("Beat This prefers the shared runtime and gives it the standard worker environment", async () => {
  const route = await readFile(new URL("../app/api/map/route.ts", import.meta.url), "utf8");
  const candidates = route.match(/async function beatPythonCandidates[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.ok(candidates.indexOf("analysisRuntime()?.paths.python") > candidates.indexOf("process.env.BEAT_THIS_PYTHON"));
  assert.ok(candidates.indexOf("analysisRuntime()?.paths.python") < candidates.indexOf("localInstall.python"), "the physical runtime comes before the per-user legacy env");
  const worker = route.match(/async function createBeatWorker[\s\S]*?spawn\(python/)?.[0] ?? "";
  assert.match(worker, /modelWorkerEnv\(analysisEnvironment\(process\.env\), \{ platform: process\.platform, torchHome: prepared\.torchHome \}\)/);
  const launcher = await readFile(new URL("../scripts/run-crowd2-production.ps1", import.meta.url), "utf8");
  assert.match(launcher, /\$env:CROWD_ANALYSIS_RUNTIME = \$analysisRuntime/);
});

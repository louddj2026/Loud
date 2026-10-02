import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  drumsColdPlan, drumsJobPath, drumsRuntimeKey, drumsRuntimeMayHealWsl, drumsWorkerPlan,
  requestedDrumsBackend, resolveDrumsRuntime, wslPathFor,
} from "../lib/drums-runtime.ts";
import { toWslPath } from "../lib/section-analysis.ts";

const win = path.win32;
const CWD = "D:\\Crowd Apps\\Crowd2";
const RUNTIME = "D:\\Crowd Apps\\Codex\\runtimes\\crowd2-analysis";
const PYTHON = win.join(RUNTIME, "env", "Scripts", "python.exe");
const FFPROBE = win.join(RUNTIME, "ffprobe", "ffprobe.exe");
const FFMPEG = win.join(CWD, "node_modules", "ffmpeg-static", "ffmpeg.exe");
const installed = new Set([PYTHON, FFPROBE, FFMPEG]);
const exists = (file) => installed.has(file);

function resolve(env, options = {}) {
  return resolveDrumsRuntime({
    platform: options.platform ?? "win32",
    env: { LOCALAPPDATA: "C:\\Users\\DJ Booth\\AppData\\Local", Path: "C:\\Windows\\system32;C:\\Tools", ...env },
    cwd: options.cwd ?? CWD,
    exists: options.exists ?? exists,
  });
}

test("Windows separates natively by default, in the shared analysis runtime beside the app", () => {
  const runtime = resolve({});
  assert.equal(runtime.ok, true);
  assert.equal(runtime.backend, "windows");
  assert.equal(runtime.label, "windows-native");
  assert.equal(runtime.python, PYTHON);
  assert.equal(runtime.torchHome, win.join(RUNTIME, "torch"));
  assert.equal(runtime.ffprobe, FFPROBE);
  assert.equal(runtime.ffmpeg, FFMPEG);
  assert.equal(runtime.workerScript, win.join(CWD, "scripts", "drums-stem-worker.py"));
  assert.equal(runtime.coldScript, win.join(CWD, "scripts", "drums-stem.py"));
});

test("CROWD_ANALYSIS_RUNTIME names the runtime explicitly; a virtualised LOCALAPPDATA env is never the default", () => {
  const explicit = "E:\\Booth Runtime\\crowd2-analysis";
  const legacy = "C:\\Users\\DJ Booth\\AppData\\Local\\Crowd2\\separator-env\\Scripts\\python.exe";
  const files = new Set([...installed, legacy, win.join(explicit, "env", "Scripts", "python.exe"), win.join(explicit, "ffprobe", "ffprobe.exe")]);
  const runtime = resolve({ CROWD_ANALYSIS_RUNTIME: explicit }, { exists: (file) => files.has(file) });
  assert.equal(runtime.python, win.join(explicit, "env", "Scripts", "python.exe"));
  assert.equal(runtime.torchHome, win.join(explicit, "torch"));
  const withoutRuntime = resolve({}, { exists: (file) => file === legacy || file === FFMPEG });
  assert.equal(withoutRuntime.ok, false, "the old per-user env is not picked up silently");
});

test("the native worker and cold fallback spawn python.exe directly with native paths, spaces intact", () => {
  const runtime = resolve({});
  const worker = drumsWorkerPlan(runtime);
  assert.equal(worker.command, PYTHON);
  assert.deepEqual(worker.args, [runtime.workerScript]);
  const audio = "D:\\Music\\Crate With Spaces\\Altöm - Tune (Extended).wav";
  const out = "D:\\Crowd Apps\\Crowd2\\data\\kick-stems\\upload-abc.wav.partial.wav";
  const result = "C:\\Users\\DJ Booth\\AppData\\Local\\Temp\\crowd2-kickjob-1\\result.json";
  const cold = drumsColdPlan(runtime, { audio, out, result, demixRoot: null, threads: 12 });
  assert.equal(cold.command, PYTHON);
  assert.deepEqual(cold.args, [runtime.coldScript, audio, out, result]);
  assert.equal(cold.env.CROWD_DEMUCS_THREADS, "12");
  for (const plan of [worker, cold]) {
    assert.ok(!/wsl/i.test(plan.command));
    assert.ok(plan.args.every((arg) => !arg.startsWith("/mnt/") && !/wsl\.exe/i.test(arg)));
  }
  assert.equal(drumsJobPath(runtime, audio), audio);
  const withDemix = drumsColdPlan(runtime, { audio, out, result, demixRoot: "D:\\Crowd Apps\\Crowd2\\data\\demix-cache" });
  assert.deepEqual(withDemix.args.slice(1), [audio, out, result, "D:\\Crowd Apps\\Crowd2\\data\\demix-cache"]);
  assert.equal(withDemix.env.CROWD_DEMUCS_THREADS, undefined);
});

test("the native child sees the app's ffmpeg and the runtime's ffprobe first, its own model home, and UTF-8 stdio", () => {
  const runtime = resolve({ PYTHONPATH: "C:\\Other\\site-packages", PYTHONHOME: "C:\\Other", TORCH_HOME: "C:\\BeatThis\\torch" });
  const keys = Object.keys(runtime.env).filter((key) => key.toUpperCase() === "PATH");
  assert.deepEqual(keys, ["Path"], "Windows env names are case-insensitive: one PATH, never two");
  assert.deepEqual(runtime.env.Path.split(";"), [win.dirname(FFMPEG), win.dirname(FFPROBE), "C:\\Windows\\system32", "C:\\Tools"]);
  assert.equal(runtime.env.TORCH_HOME, win.join(RUNTIME, "torch"), "the runtime's verified checkpoints, never another cache");
  assert.equal(runtime.env.PYTHONUTF8, "1");
  assert.equal(runtime.env.PYTHONPATH, undefined);
  assert.equal(runtime.env.PYTHONHOME, undefined);
});

test("CROWD_DEMUCS_PYTHON selects another prepared interpreter, and its model home and probe travel with it", () => {
  for (const [python, root] of [
    ["E:\\Separator Envs\\self contained\\Scripts\\python.exe", "E:\\Separator Envs\\self contained"],
    ["E:\\Runtimes\\other analysis\\env\\Scripts\\python.exe", "E:\\Runtimes\\other analysis"],
  ]) {
    const files = new Set([python, win.join(root, "ffprobe", "ffprobe.exe"), FFMPEG]);
    const runtime = resolve({ CROWD_DEMUCS_PYTHON: `  ${python}  ` }, { exists: (file) => files.has(file) });
    assert.equal(runtime.ok, true);
    assert.equal(runtime.python, python);
    assert.equal(runtime.torchHome, win.join(root, "torch"));
    assert.equal(runtime.ffprobe, win.join(root, "ffprobe", "ffprobe.exe"));
    assert.notEqual(drumsRuntimeKey(runtime), drumsRuntimeKey(resolve({})), "a different interpreter is a different worker");
  }
  const python = "E:\\x\\Scripts\\python.exe";
  const pinned = resolve({ CROWD_DEMUCS_PYTHON: python, CROWD_DEMUCS_TORCH_HOME: "F:\\models\\torch", CROWD_DEMUCS_FFPROBE: "F:\\bin\\ffprobe.exe" },
    { exists: (file) => file === python || file === "F:\\bin\\ffprobe.exe" || file === FFMPEG });
  assert.equal(pinned.torchHome, "F:\\models\\torch");
  assert.equal(pinned.ffprobe, "F:\\bin\\ffprobe.exe");
});

test("FFMPEG_BIN is honoured before the bundled decoder", () => {
  const custom = "C:\\ffmpeg 6.1.1\\bin\\ffmpeg.exe";
  const runtime = resolve({ FFMPEG_BIN: custom }, { exists: (file) => file === custom || installed.has(file) });
  assert.equal(runtime.ffmpeg, custom);
  assert.equal(runtime.env.Path.split(";")[0], "C:\\ffmpeg 6.1.1\\bin");
});

test("a missing native runtime is a setup error that never offers or falls back to WSL", () => {
  for (const [missing, words] of [[PYTHON, /python\.exe does not exist/], [FFPROBE, /ffprobe/], [FFMPEG, /FFmpeg decoder/]]) {
    const runtime = resolve({ CROWD_ANALYSIS_RUNTIME: RUNTIME }, { exists: (file) => file !== missing && installed.has(file) });
    assert.equal(runtime.ok, false);
    assert.equal(runtime.backend, "windows");
    assert.match(runtime.error, words);
    assert.match(runtime.error, /setup-analysis-runtime\.mjs/);
    assert.match(runtime.error, /only when CROWD_DEMUCS_BACKEND=wsl/);
  }
  const nowhere = resolve({}, { exists: () => false });
  assert.equal(nowhere.ok, false);
  assert.match(nowhere.error, /no analysis runtime at D:\\Crowd Apps\\Codex\\runtimes\\crowd2-analysis/);
});

test("the backend is validated: windows or wsl, explicitly", () => {
  assert.deepEqual(requestedDrumsBackend("win32", {}), { backend: "windows" });
  assert.deepEqual(requestedDrumsBackend("win32", { CROWD_DEMUCS_BACKEND: " WSL " }), { backend: "wsl" });
  assert.deepEqual(requestedDrumsBackend("win32", { CROWD_DEMUCS_BACKEND: "windows" }), { backend: "windows" });
  const invalid = resolve({ CROWD_DEMUCS_BACKEND: "linux" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /must be "windows" or "wsl"/);
  const wslOffWindows = resolveDrumsRuntime({ platform: "linux", env: { CROWD_DEMUCS_BACKEND: "wsl" }, cwd: "/srv/crowd2", exists: () => true });
  assert.equal(wslOffWindows.ok, false);
});

test("WSL is an explicit reference runtime with the original spawn and path translation", () => {
  const runtime = resolve({ CROWD_DEMUCS_BACKEND: "wsl" });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.backend, "wsl");
  assert.equal(runtime.label, "wsl:Ubuntu-24.04");
  const worker = drumsWorkerPlan(runtime);
  assert.equal(worker.command, "wsl.exe");
  assert.deepEqual(worker.args, ["-d", "Ubuntu-24.04", "-u", "root", "--", "/opt/allin1/bin/python", toWslPath(runtime.workerScript)]);
  const audio = "D:\\Music\\Altöm\\track with spaces.mp3";
  const cold = drumsColdPlan(runtime, { audio, out: "C:\\T\\drums.wav", result: "C:\\T\\result.json", demixRoot: "D:\\Crowd Apps\\Crowd2\\data\\demix-cache", threads: 12 });
  assert.deepEqual(cold.args.slice(0, 6), ["-d", "Ubuntu-24.04", "-u", "root", "--", "/opt/allin1/bin/python"]);
  assert.deepEqual(cold.args.slice(6), [toWslPath(runtime.coldScript), toWslPath(audio), "/mnt/c/T/drums.wav", "/mnt/c/T/result.json", "/mnt/d/Crowd Apps/Crowd2/data/demix-cache"]);
  assert.equal(cold.env.CROWD_DEMUCS_THREADS, undefined, "the reference keeps its own thread default");
  assert.equal(drumsJobPath(runtime, audio), "/mnt/d/Music/Altöm/track with spaces.mp3");
  assert.equal(drumsRuntimeMayHealWsl(runtime), true);
  assert.equal(drumsRuntimeMayHealWsl(resolve({})), false, "native failures never touch WSL");
});

test("native and WSL settings never mix", () => {
  const env = { CROWD_DEMUCS_BACKEND: "wsl", CROWD_ANALYSIS_RUNTIME: RUNTIME, CROWD_DEMUCS_PYTHON: PYTHON, CROWD_DEMUCS_TORCH_HOME: "C:\\x\\torch", CROWD_DEMUCS_FFPROBE: FFPROBE };
  const wsl = resolve(env);
  const plan = drumsWorkerPlan(wsl);
  assert.equal(plan.args[5], "/opt/allin1/bin/python", "a Windows interpreter is not a Linux interpreter");
  assert.equal(plan.env.TORCH_HOME, undefined);
  assert.equal(plan.env.PYTHONUTF8, undefined);
  assert.equal(plan.env.Path, "C:\\Windows\\system32;C:\\Tools", "the reference environment is passed through untouched");
  const native = resolve({ WSLENV: "OMP_NUM_THREADS/u" });
  assert.ok(Object.values(drumsWorkerPlan(native).args).every((arg) => !arg.includes("/mnt/")));
  assert.notEqual(drumsRuntimeKey(wsl), drumsRuntimeKey(native));
});

test("WSL path translation is byte-for-byte the section analyser's", () => {
  for (const sample of ["D:\\Music\\Atmos\\Atmos - Klein Aber Doctor.mp3", "C:\\Users\\DJ\\project\\scripts\\x.py", "D:\\Music\\Altöm\\track.mp3", "D:/Music/x.wav", "E:\\a b\\c (d).wav"]) {
    assert.equal(wslPathFor(sample), toWslPath(sample));
  }
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Drives the real ensureDrumsStem / warmDrumsSeparator through the real spawn
// plumbing. Every child_process.spawn is recorded; separator launches (the
// test env's python, or wsl.exe) are served by tests/fixtures/fake-separator.mjs
// speaking the real protocols, so no model, no Python and no WSL is needed —
// and a real wsl.exe can never start from this test.
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const realSpawn = childProcess.spawn;
const fakeSeparator = fileURLToPath(new URL("./fixtures/fake-separator.mjs", import.meta.url));

const root = mkdtempSync(path.join(os.tmpdir(), "crowd2 separator test "));
const dataRoot = path.join(root, "data root");
const uploads = path.join(dataRoot, "uploads");
mkdirSync(uploads, { recursive: true });

function tinyWav(seed) {
  const samples = 400;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + samples * 2, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(samples * 2, 40);
  const body = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) body.writeInt16LE((index * seed) % 3000, index * 2);
  return Buffer.concat([header, body]);
}

const names = ["native-warm", "native-cold", "native-down", "native-missing", "wsl-down", "wsl-warm", "wsl-dead", "native-watch", "native-queue-a", "native-queue-b", "native-legacy", "native-restart", "native-fail"];
writeFileSync(path.join(dataRoot, "uploaded-tracks.json"), JSON.stringify(names.map((name) => ({
  id: `upload-${name}`, name, file: `${name} Ö.wav`, duration: 0.05, album: "User uploads", source: "uploaded", relativePath: `${name} Ö.wav`,
}))));
names.forEach((name, index) => writeFileSync(path.join(uploads, `${name} Ö.wav`), tinyWav(index + 3)));

process.env.CROWD_DATA_ROOT = dataRoot;
process.env.CROWD_SHARED_DEMIX = "0";
process.env.CROWD_WSL_RECOVERY_WAIT_MS = "5";
delete process.env.CROWD_WARM_DEMUCS;
delete process.env.CROWD_DEMUCS_BACKEND;

const calls = [];
const children = [];
let scenario = {};
childProcess.spawn = function recordedSpawn(command, args = [], options = {}) {
  calls.push({ command, args: [...args], env: options.env ?? process.env });
  const separator = command === "wsl.exe" || String(command).startsWith(root);
  const child = separator
    ? realSpawn(process.execPath, [fakeSeparator, ...args], { ...options, env: { ...(options.env ?? process.env), ...scenario } })
    : realSpawn(command, args, options);
  children.push(child);
  return child;
};
syncBuiltinESMExports();

const { ensureDrumsStem, lastStemTimingFor, stemStageFor, warmDrumsSeparator } = await import("../lib/kick-analysis.ts");

test.after(() => {
  for (const child of children) { try { child.kill(); } catch { /* gone */ } }
  childProcess.spawn = realSpawn;
  syncBuiltinESMExports();
  rmSync(root, { recursive: true, force: true });
});

function preparedEnv(name) {
  const envRoot = path.join(root, `separator env ${name}`);
  const python = path.join(envRoot, "Scripts", "python.exe");
  mkdirSync(path.dirname(python), { recursive: true });
  mkdirSync(path.join(envRoot, "ffprobe"), { recursive: true });
  writeFileSync(python, "");
  writeFileSync(path.join(envRoot, "ffprobe", "ffprobe.exe"), "");
  return { envRoot, python };
}

function useNative(python, behaviour) {
  delete process.env.CROWD_DEMUCS_BACKEND;
  process.env.CROWD_DEMUCS_PYTHON = python;
  scenario = behaviour;
}

const since = (mark) => calls.slice(mark);
const launchedWsl = (list) => list.some((call) => /wsl(\.exe)?$/i.test(call.command) || call.args.some((arg) => /wsl\.exe|^\/mnt\//i.test(arg)));
const stemFile = (id) => path.join(dataRoot, "kick-stems", `${id}.wav`);
const input = (name) => readFileSync(path.join(uploads, `${name} Ö.wav`));

test("the resident native worker separates with python.exe, native paths and the env's own model home", async () => {
  const { envRoot, python } = preparedEnv("warm");
  useNative(python, { FAKE_WORKER: "ok" });
  const mark = calls.length;
  const stem = await ensureDrumsStem("upload-native-warm");
  assert.equal(stem, stemFile("upload-native-warm"));
  assert.deepEqual(readFileSync(stem), input("native-warm"));
  const launched = since(mark);
  assert.equal(launchedWsl(launched), false);
  assert.equal(launched.length, 1, "one worker, started once even though the job asked for it early");
  assert.equal(launched[0].command, python);
  assert.deepEqual(launched[0].args, [path.join(process.cwd(), "scripts", "drums-stem-worker.py")]);
  assert.equal(launched[0].env.TORCH_HOME, path.join(envRoot, "torch"));
  assert.equal(launched[0].env.PYTHONUTF8, "1");
  const timing = lastStemTimingFor("upload-native-warm");
  assert.equal(timing.backend, "windows-native");
  assert.equal(timing.path, "warm");
  assert.equal(typeof timing.workerStartMs, "number");
  assert.equal(timing.modelMs, 150);
  assert.equal(timing.writer, "fake");
});

test("a warm failure falls back to the cold script on the SAME native python, never WSL", async () => {
  const { python } = preparedEnv("cold");
  useNative(python, { FAKE_WORKER: "dies", FAKE_COLD: "ok" });
  const mark = calls.length;
  const stem = await ensureDrumsStem("upload-native-cold");
  assert.deepEqual(readFileSync(stem), input("native-cold"));
  const launched = since(mark);
  assert.equal(launchedWsl(launched), false);
  assert.ok(launched.every((call) => call.command === python));
  const cold = launched.find((call) => call.args[0].endsWith("drums-stem.py"));
  assert.ok(cold, "the cold script ran");
  assert.equal(cold.args[1], path.join(uploads, "native-cold Ö.wav"), "a native path with a space and a non-ASCII letter, verbatim");
  assert.equal(cold.env.CROWD_DEMUCS_THREADS, "3", "the same live thread budget the warm job would have used");
  assert.equal(lastStemTimingFor("upload-native-cold").path, "cold");
  assert.equal(lastStemTimingFor("upload-native-cold").backend, "windows-native");
});

test("when both native paths fail the error surfaces without probing, restarting or using WSL", async () => {
  const { python } = preparedEnv("down");
  useNative(python, { FAKE_WORKER: "nostart", FAKE_COLD: "fails" });
  const mark = calls.length;
  await assert.rejects(ensureDrumsStem("upload-native-down"), /fake cold failure/);
  const launched = since(mark);
  assert.equal(launched.length, 2, "one worker start, one cold run: a worker that failed to start is not started twice");
  assert.equal(launchedWsl(launched), false);
  assert.ok(launched.every((call) => call.command === python));
  assert.equal(existsSync(stemFile("upload-native-down")), false);
  assert.equal(existsSync(`${stemFile("upload-native-down")}.partial.wav`), false);
});

test("a missing native runtime is a setup error: nothing is spawned, for loads or prewarm", async () => {
  useNative(path.join(root, "never installed", "Scripts", "python.exe"), { FAKE_WORKER: "ok" });
  const mark = calls.length;
  await assert.rejects(ensureDrumsStem("upload-native-missing"), /Native drums separator is not ready.*setup-analysis-runtime/);
  await assert.rejects(warmDrumsSeparator(), /Native drums separator is not ready/);
  assert.equal(since(mark).length, 0);
});

test("explicit WSL keeps the reference spawn, path translation and its own healing probe", async () => {
  process.env.CROWD_DEMUCS_BACKEND = "wsl";
  process.env.CROWD_DEMUCS_PYTHON = path.join(root, "separator env warm", "Scripts", "python.exe");
  scenario = { FAKE_WORKER: "nostart", FAKE_COLD: "fails" };
  let mark = calls.length;
  await assert.rejects(ensureDrumsStem("upload-wsl-down"), /fake cold failure/);
  const failing = since(mark);
  assert.ok(failing.every((call) => call.command === "wsl.exe"), "a Windows python override is never used for WSL");
  assert.ok(failing.some((call) => call.args.includes("echo")), "only the WSL runtime probes WSL health");

  scenario = { FAKE_WORKER: "ok" };
  mark = calls.length;
  const stem = await ensureDrumsStem("upload-wsl-warm");
  assert.deepEqual(readFileSync(stem), input("wsl-warm"));
  const [worker] = since(mark);
  assert.equal(worker.command, "wsl.exe");
  assert.deepEqual(worker.args.slice(0, 6), ["-d", "Ubuntu-24.04", "-u", "root", "--", "/opt/allin1/bin/python"]);
  assert.match(worker.args[6], /^\/mnt\/[a-z]\/.*\/scripts\/drums-stem-worker\.py$/);
  assert.equal(lastStemTimingFor("upload-wsl-warm").backend, "wsl:Ubuntu-24.04");
  delete process.env.CROWD_DEMUCS_BACKEND;
});

test("a WSL that stops answering is waited for and re-probed, but never shut down or terminated", async () => {
  // The resident WSL worker from the previous test would serve this job; end it first.
  const exited = children.filter((child) => child.exitCode === null && child.signalCode === null).map((child) => new Promise((resolve) => child.once("close", resolve)));
  for (const child of children) { try { child.kill(); } catch { /* gone */ } }
  await Promise.all(exited);
  process.env.CROWD_DEMUCS_BACKEND = "wsl";
  scenario = { FAKE_WORKER: "nostart", FAKE_COLD: "fails", FAKE_PROBE: "dead" };
  const mark = calls.length;
  await assert.rejects(ensureDrumsStem("upload-wsl-dead"), /fake cold failure/);
  const launched = since(mark);
  const probes = launched.filter((call) => call.args.includes("echo"));
  assert.equal(probes.length, 4, "one probe, then three recovery probes");
  assert.ok(launched.every((call) => !call.args.some((arg) => /^--(shutdown|terminate)$|^-t$/.test(arg))), "other work shares that VM");
  delete process.env.CROWD_DEMUCS_BACKEND;
});

// ---- 26 Sep 2026: the drum-stem stage the deck shows, driven through the real spawn plumbing.
const stepOf = (stage, id) => stage.steps.find((step) => step.id === id);
async function until(predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("the stem stage shows each real Demucs sub-step as it happens, blocks counted only on their end", async () => {
  delete process.env.CROWD_DEMUCS_BACKEND;
  const { python } = preparedEnv("watch");
  useNative(python, { FAKE_WORKER: "ok", FAKE_BLOCKS: "4", FAKE_STEP_MS: "40" });
  const job = ensureDrumsStem("upload-native-watch");
  const stage = stemStageFor("upload-native-watch");
  assert.ok(stage, "the stage exists as soon as the job does");
  const seen = [];
  const watcher = setInterval(() => seen.push(structuredClone(stage)), 4);
  await job;
  clearInterval(watcher);
  seen.push(structuredClone(stage));
  const startupDetails = seen.map((snapshot) => stepOf(snapshot, "startup")).filter((step) => step.state === "active").map((step) => step.detail);
  assert.ok(startupDetails.some((detail) => /separator process|importing PyTorch|HTDemucs checkpoint/.test(detail)), "the worker's own start-up lines are shown while it starts");
  const measures = seen.map((snapshot) => stepOf(snapshot, "blocks").measure).filter(Boolean);
  for (let index = 1; index < measures.length; index += 1) assert.ok(measures[index].doneInPass >= measures[index - 1].doneInPass, "never backwards");
  assert.ok(measures.some((measure) => measure.current === measure.doneInPass + 1), "a running block was on screen before it counted");
  assert.ok(measures.every((measure) => measure.passBlocks === 4 && measure.doneInPass <= 4));
  const final = seen.at(-1);
  assert.equal(final.state, "done");
  assert.deepEqual(final.steps.map((step) => [step.id, step.state]), [["input", "done"], ["startup", "done"], ["wait", "skipped"], ["decode", "done"], ["blocks", "done"], ["write", "done"], ["publish", "done"]]);
  assert.match(stepOf(final, "startup").detail, /Separator ready/);
  assert.equal(stepOf(final, "blocks").measure.doneInPass, 4);
  assert.equal(final.audioSeconds, 0.05);
});

test("a tune queued behind another on the separator names it, waits, and skips the model load it did not need", async () => {
  const { python } = preparedEnv("queue");
  useNative(python, { FAKE_WORKER: "ok", FAKE_BLOCKS: "3", FAKE_STEP_MS: "60" });
  const first = ensureDrumsStem("upload-native-queue-a");
  const firstStage = stemStageFor("upload-native-queue-a");
  await until(() => stepOf(firstStage, "blocks").state === "active");
  const second = ensureDrumsStem("upload-native-queue-b");
  const secondStage = stemStageFor("upload-native-queue-b");
  await until(() => stepOf(secondStage, "wait").state !== "pending");
  assert.equal(stepOf(secondStage, "wait").state, "active");
  assert.match(stepOf(secondStage, "wait").detail, /^Separator busy with native-queue-a/);
  assert.equal(stepOf(secondStage, "startup").state, "skipped");
  assert.equal(stepOf(secondStage, "blocks").measure, null, "nothing of the second tune is counted while it waits");
  await Promise.all([first, second]);
  assert.equal(stepOf(secondStage, "wait").state, "done");
  assert.equal(secondStage.state, "done");
  assert.equal(stepOf(secondStage, "blocks").measure.doneInPass, 3);
});

test("a separator speaking the old numeric progress line fills nothing; its finished sub-steps say they were not reported", async () => {
  const { python } = preparedEnv("legacy");
  useNative(python, { FAKE_WORKER: "ok", FAKE_LEGACY: "1" });
  await ensureDrumsStem("upload-native-legacy");
  const stage = stemStageFor("upload-native-legacy");
  assert.equal(stage.state, "done");
  for (const id of ["decode", "blocks", "write"]) {
    assert.equal(stepOf(stage, id).state, "done");
    assert.match(stepOf(stage, id).detail, /not reported/);
  }
  assert.equal(stepOf(stage, "blocks").measure, null);
});

test("a warm failure restarts the stage as a labelled attempt 2 on the one-shot separator, with its own count", async () => {
  const { python } = preparedEnv("restart");
  useNative(python, { FAKE_WORKER: "dies", FAKE_COLD: "ok", FAKE_BLOCKS: "2" });
  await ensureDrumsStem("upload-native-restart");
  const stage = stemStageFor("upload-native-restart");
  assert.equal(stage.attempt, 2);
  assert.match(stage.restartedBecause, /resident separator failed/);
  assert.equal(stage.state, "done");
  assert.equal(stepOf(stage, "startup").state, "done", "the one-shot process really started up");
  assert.equal(stepOf(stage, "blocks").measure.doneInPass, 2);
});

test("when every separator fails, the stage fails at the step it reached and nothing after it claims done", async () => {
  const { python } = preparedEnv("fail");
  useNative(python, { FAKE_WORKER: "nostart", FAKE_COLD: "fails" });
  await assert.rejects(ensureDrumsStem("upload-native-fail"), /fake cold failure/);
  const stage = stemStageFor("upload-native-fail");
  assert.equal(stage.state, "failed");
  assert.equal(stage.attempt, 2);
  assert.equal(stepOf(stage, "startup").state, "failed");
  for (const id of ["decode", "blocks", "write", "publish"]) assert.equal(stepOf(stage, id).state, "pending");
});

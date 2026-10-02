import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { modelWorkerEnv, resolveAnalysisRuntime } from "../lib/analysis-runtime.ts";

// The block accounting checked against the REAL demucs.apply.apply_model in
// the booth's own analysis runtime (tests/demucs_block_progress_check.py):
// bag / shift / overlap cases, totals equal to model calls, output unchanged
// by the callback, and the htdemucs separator's settings untouched.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolveAnalysisRuntime({ platform: process.platform, env: process.env, cwd: appRoot, exists: existsSync });
const python = runtime?.paths.python;
const ready = Boolean(python && existsSync(python) && existsSync(path.join(runtime.paths.torchHome, "hub", "checkpoints")));

test("Demucs loading lamps keep truthful progress with an analogue gradient and live-only pulse", () => {
  const boothSource = readFileSync(path.join(appRoot, "app", "dj", "dj-booth.tsx"), "utf8");
  const cssSource = readFileSync(path.join(appRoot, "app", "globals.css"), "utf8");
  const start = boothSource.indexOf("function DemucsBlockMeter");
  const end = boothSource.indexOf("\nfunction FocusWaveLoadState", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const meterSource = boothSource.slice(start, end);

  assert.match(meterSource, /aria-valuenow=\{measure\.doneInPass\}/);
  assert.match(meterSource, /index < measure\.doneInPass \? "done"/);
  assert.match(meterSource, /"--block-at"/);
  assert.match(meterSource, /live && lit > 0 && <span key=\{pace\} className="deck-load-pulse"/);
  assert.match(meterSource, /Math\.floor\(fraction \* 10\) \/ 10/);
  assert.match(cssSource, /\.deck-load-blocks>i\{--lamp:color-mix\(in oklch/);
  assert.match(cssSource, /width:calc\(\(100% - 4px\) \* var\(--load-lit,0\)\)/);
  assert.match(cssSource, /@media \(prefers-reduced-motion:reduce\)\{\.deck-load-pulse\{display:none\}\}/);
});

test("Demucs block progress: counted on end only, totals from Demucs' own loop, settings and output unchanged", { skip: ready ? false : "the analysis runtime is not installed here" }, () => {
  const env = modelWorkerEnv(process.env, { platform: process.platform, torchHome: runtime.paths.torchHome });
  const run = spawnSync(python, [path.join(appRoot, "tests", "demucs_block_progress_check.py")], { cwd: appRoot, env, encoding: "utf8", timeout: 240_000, windowsHide: true });
  assert.equal(run.error, undefined, String(run.error));
  const line = run.stdout.trim().split("\n").at(-1) ?? "";
  const result = JSON.parse(line);
  for (const item of result.cases) assert.deepEqual(item.problems, [], `${item.models} model(s), ${item.shifts} shift(s), overlap ${item.overlap}, ${item.seconds} s`);
  // Two shifted passes over the same audio can differ by a block: each count is read, not assumed.
  const twoShifts = result.cases.find((item) => item.shifts === 2 && item.models === 1);
  assert.equal(Object.keys(twoShifts.passTotals).length, 2);
  const settings = result.htdemucs;
  assert.deepEqual(settings.differencesFromPlainSeparator, []);
  assert.equal(settings.callbackInstalled, true);
  assert.deepEqual([settings.bag, settings.models, settings.shifts, settings.overlap, settings.split, settings.jobs, settings.segmentOverride], [true, 1, 1, 0.25, true, 0, null]);
  assert.equal(settings.samplerate, 44100);
  assert.equal(settings.blockFrames, 343980);
  assert.equal(settings.strideFrames, 257985);
  assert.equal(result.ok, true);
});

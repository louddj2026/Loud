import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyAnalyserEvent, applySeparatorEvent, beginStage, beginStep, blockFraction, completeLoadProgress, completeStage, composeSnapshot,
  createLoadProgress, createStage, failLoadProgress, failStage, finishStep, legacyStage, parseAnalyserLine, parseSeparatorLine,
  queueDetail, restartStage, settleUnreportedSteps, shortJobStatus, skipStage, skipStep, stageOf, summariseLoadProgress, viewLoadProgress,
} from "../lib/load-progress.ts";

const T0 = 1_750_000_000_000;
const block = (state, blockNumber, done, passBlocks = 62, extra = {}) => `PROGRESS ${JSON.stringify({ event: "block", state, block: blockNumber, passBlocks, done, doneInPass: done, pass: 1, passes: 1, range: [(blockNumber - 1) * 5.85, (blockNumber - 1) * 5.85 + 7.8], ...extra })}`;
const stepOf = (stage, id) => stage.steps.find((step) => step.id === id);

test("a new job is in the lane and nothing else: no stage claims progress it has not made", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  assert.equal(progress.state, "running");
  assert.deepEqual(progress.stages.map((stage) => [stage.id, stage.state]), [["queue", "active"], ["stem", "pending"], ["beats", "pending"], ["grid", "pending"], ["save", "pending"]]);
  assert.deepEqual(stepOf(stageOf(progress, "stem"), "input").state, "pending");
  assert.notEqual(createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 2, now: T0 }).jobId, progress.jobId, "a retry is a new identity");
});

test("the Demucs sub-steps are the real ones, in the order they happen", () => {
  assert.deepEqual(createStage("stem").steps.map((step) => step.id), ["input", "startup", "wait", "decode", "blocks", "write", "publish"]);
});

test("separator lines: structured events parse; the old numeric line that counted started blocks is ignored", () => {
  assert.equal(parseSeparatorLine("PROGRESS 0.500"), null);
  assert.equal(parseSeparatorLine("PROGRESS {not json"), null);
  assert.equal(parseSeparatorLine("READY"), null);
  assert.deepEqual(parseSeparatorLine('PROGRESS {"event":"startup","step":"model"}'), { event: "startup", step: "model" });
  assert.deepEqual(parseSeparatorLine('PROGRESS {"event":"decode","state":"end","audioSeconds":512.453}'), { event: "decode", state: "end", audioSeconds: 512.453 });
  const parsed = parseSeparatorLine(block("end", 3, 3));
  assert.equal(parsed.event, "block");
  assert.equal(parsed.done, 3);
  assert.equal(parsed.passBlocks, 62);
  // A block beyond the count, or a count below what is done, is not a real state.
  assert.equal(parseSeparatorLine(block("start", 63, 62)), null);
  assert.equal(parseSeparatorLine(block("end", 2, 5, 4)), null);
  // An unknown total stays unknown rather than being guessed.
  assert.equal(parseSeparatorLine(block("end", 3, 3, null)).passBlocks, null);
  // A backwards span is dropped, the event kept.
  assert.equal(parseSeparatorLine(block("end", 3, 3, 62, { range: [9, 2] })).range, null);
});

test("a started block is shown running and never counted; only its end fills the bar", () => {
  const stage = createStage("stem");
  beginStep(stage, "input", T0);
  applySeparatorEvent(stage, parseSeparatorLine('PROGRESS {"event":"decode","state":"start"}'), T0 + 10);
  applySeparatorEvent(stage, parseSeparatorLine('PROGRESS {"event":"decode","state":"end","audioSeconds":512.45}'), T0 + 20);
  assert.equal(stepOf(stage, "input").state, "done", "the pipeline moved past the input, so it finished");
  assert.equal(stepOf(stage, "startup").state, "skipped", "a sub-step that never ran is skipped, not done");
  assert.equal(stage.audioSeconds, 512.45);

  applySeparatorEvent(stage, parseSeparatorLine(block("start", 1, 0)), T0 + 30);
  const blocks = stepOf(stage, "blocks");
  assert.equal(blocks.state, "active");
  assert.equal(blocks.measure.doneInPass, 0);
  assert.equal(blocks.measure.current, 1);
  assert.equal(blockFraction(blocks.measure), 0, "a running block adds nothing");

  applySeparatorEvent(stage, parseSeparatorLine(block("end", 1, 1)), T0 + 40);
  assert.equal(blocks.measure.doneInPass, 1);
  assert.equal(blocks.measure.current, null);
  assert.equal(blockFraction(blocks.measure), 1 / 62);
  assert.match(blocks.detail, /1 of 62 blocks finished/);

  applySeparatorEvent(stage, parseSeparatorLine(block("start", 2, 1)), T0 + 50);
  assert.equal(blocks.measure.current, 2);
  assert.equal(blocks.measure.doneInPass, 1);
  assert.match(blocks.detail, /running block 2 of 62 \(0:05–0:13 of 8:32\)/);
});

test("block counts never go backwards within an attempt, and a stale event changes nothing", () => {
  const stage = createStage("stem");
  applySeparatorEvent(stage, parseSeparatorLine(block("end", 10, 10)), T0);
  applySeparatorEvent(stage, parseSeparatorLine(block("end", 4, 4)), T0 + 1);
  assert.equal(stepOf(stage, "blocks").measure.doneInPass, 10);
  applySeparatorEvent(stage, parseSeparatorLine('PROGRESS {"event":"write","state":"start"}'), T0 + 2);
  assert.equal(stepOf(stage, "blocks").state, "done");
  assert.equal(applySeparatorEvent(stage, parseSeparatorLine(block("end", 11, 11)), T0 + 3), false, "a block after the write began is stale");
  assert.equal(stepOf(stage, "blocks").measure.doneInPass, 10);
  assert.equal(applySeparatorEvent(stage, parseSeparatorLine('PROGRESS {"event":"decode","state":"start"}'), T0 + 4), false, "a finished step is never reopened");
});

test("with several passes the fraction counts finished passes whole and the running pass by its own count", () => {
  const measure = { unit: "blocks", done: 12, doneInPass: 3, passBlocks: 10, current: 4, pass: 2, passes: 2, range: null };
  assert.equal(blockFraction(measure), (1 + 3 / 10) / 2);
  assert.equal(blockFraction({ ...measure, passBlocks: null }), null, "no exact count, no fraction");
  assert.equal(blockFraction(null), null);
});

test("nothing here moves with time: the same snapshot viewed later has the same stages, step and fraction", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  beginStage(progress, "stem", T0 + 1000);
  const stem = stageOf(progress, "stem");
  applySeparatorEvent(stem, parseSeparatorLine(block("end", 5, 5)), T0 + 2000);
  const snapshot = composeSnapshot(progress, { serverNow: T0 + 3000 });
  const early = viewLoadProgress(snapshot, 10_000, 10_000);
  const later = viewLoadProgress(snapshot, 10_000 + 3_600_000, 10_000);
  assert.equal(early.fraction, 5 / 62);
  assert.equal(later.fraction, early.fraction);
  assert.equal(later.stagesDone, early.stagesDone);
  assert.equal(later.step.id, early.step.id);
  assert.equal(later.step.measure.doneInPass, 5);
  // Only the clocks advance, labelled as ages and elapsed time.
  assert.equal(early.lastEventAgeMs, 1000);
  assert.equal(later.lastEventAgeMs, 1000 + 3_600_000);
});

test("ages are read on the server's clock, so a skewed browser clock cannot invent or hide activity", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  const snapshot = composeSnapshot(progress, { serverNow: T0 + 4000 });
  const view = viewLoadProgress(snapshot, 99, 99);
  assert.equal(view.lastEventAgeMs, 4000);
  assert.equal(view.stageElapsedMs, 4000);
});

test("the lane names the tune ahead and where it really is", () => {
  const ahead = createLoadProgress({ trackId: "genetic", trackName: "Genetic Spin - Lord Of The Strings", attempt: 1, now: T0 });
  completeStage(stageOf(ahead, "queue"), T0 + 5);
  beginStage(ahead, "stem", T0 + 5);
  const aheadStem = stageOf(ahead, "stem");
  applySeparatorEvent(aheadStem, parseSeparatorLine(block("end", 40, 40, 74)), T0 + 9);
  const summary = shortJobStatus(ahead);
  assert.equal(summary, "Drum stem · Demucs › Separate blocks 40/74");
  const mine = createLoadProgress({ trackId: "fragile", trackName: "Fragile", attempt: 1, now: T0 + 10 });
  const snapshot = composeSnapshot(mine, { serverNow: T0 + 20, queueAhead: [{ trackId: "genetic", trackName: "Genetic Spin - Lord Of The Strings", summary }] });
  assert.equal(stageOf(snapshot, "queue").detail, "Behind Genetic Spin - Lord Of The Strings (Drum stem · Demucs › Separate blocks 40/74)");
  assert.match(summariseLoadProgress(snapshot), /^Queued · Behind Genetic Spin/);
  assert.equal(queueDetail([]), "Waiting for the one-at-a-time analysis lane");
  assert.equal(stageOf(mine, "queue").detail, "Waiting for the one-at-a-time analysis lane", "composing never mutates the job");
});

test("a cached stem is an instant, labelled completion, not a countdown", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  beginStage(progress, "stem", T0 + 1);
  skipStage(stageOf(progress, "stem"), T0 + 1, "Drum stem already on disk · Demucs not needed", true);
  const stem = stageOf(progress, "stem");
  assert.equal(stem.state, "skipped");
  assert.equal(stem.cached, true);
  assert.ok(stem.steps.every((step) => step.state === "skipped"));
  assert.equal(stepOf(stem, "blocks").measure, null, "no block count is shown for work that did not happen");
});

test("an error keeps the stage, step and count it stopped at, and never completes anything", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  beginStage(progress, "stem", T0 + 1);
  const stem = stageOf(progress, "stem");
  applySeparatorEvent(stem, parseSeparatorLine(block("end", 37, 37)), T0 + 2);
  failLoadProgress(progress, T0 + 3, "Demucs ran out of memory");
  assert.equal(progress.state, "error");
  assert.equal(stem.state, "failed");
  assert.equal(stepOf(stem, "blocks").state, "failed");
  assert.equal(stepOf(stem, "blocks").measure.doneInPass, 37);
  assert.equal(stepOf(stem, "write").state, "pending", "a step that never started is not failed or done");
  assert.equal(stageOf(progress, "beats").state, "pending");
  const view = viewLoadProgress(composeSnapshot(progress, { serverNow: T0 + 4 }), 0, 0);
  assert.equal(view.stagesDone, 1, "only the lane finished");
  assert.equal(view.fraction, null, "a failed step shows no fill");
  assert.match(summariseLoadProgress(progress), /^Analysis stopped at Drum stem · Demucs › Separate blocks · 37 of 62 blocks finished \(3:30–3:38\) · Demucs ran out of memory$/);
  assert.equal(completeLoadProgress(progress, T0 + 5), false, "a stopped job cannot be completed afterwards");
});

test("a failure between steps marks only the stage: no pending step is blamed", () => {
  const stage = createStage("stem");
  finishStep(stage, "input", T0);
  failStage(stage, T0 + 1, "setup error");
  assert.equal(stage.state, "failed");
  assert.ok(stage.steps.every((step) => step.state !== "failed"));
});

test("a restart inside the stem stage is a new, labelled attempt with its own count", () => {
  const stage = createStage("stem");
  finishStep(stage, "input", T0);
  skipStep(stage, "startup", T0, "already running");
  applySeparatorEvent(stage, parseSeparatorLine(block("end", 20, 20)), T0 + 1);
  restartStage(stage, T0 + 2, "the resident separator failed (exit 3)", "startup");
  assert.equal(stage.attempt, 2);
  assert.match(stage.restartedBecause, /resident separator failed/);
  assert.equal(stepOf(stage, "input").state, "done", "the audio input stays done");
  assert.ok(["startup", "wait", "decode", "blocks", "write", "publish"].every((id) => stepOf(stage, id).state === "pending"));
  assert.equal(stepOf(stage, "blocks").measure, null, "the new attempt starts its own count");
});

test("sub-steps a separator finished without reporting are done and say so, never skipped", () => {
  const stage = createStage("stem");
  finishStep(stage, "input", T0);
  settleUnreportedSteps(stage, ["decode", "blocks", "write"], T0 + 1);
  assert.deepEqual(["decode", "blocks", "write"].map((id) => stepOf(stage, id).state), ["done", "done", "done"]);
  assert.match(stepOf(stage, "blocks").detail, /not reported/);
  assert.equal(stepOf(stage, "blocks").measure, null);
});

test("analyser lines drive the grid and save stages, split lines and all", () => {
  assert.equal(parseAnalyserLine("[1/1] Tune: decoding... "), null, "human output is not an event");
  assert.deepEqual(parseAnalyserLine('CROWD_PROGRESS {"stage":"fit","mode":"model-guided"}'), { stage: "fit", mode: "model-guided" });
  assert.equal(parseAnalyserLine('CROWD_PROGRESS {"stage":"fit","mode":"guess"}'), null);
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  beginStage(progress, "grid", T0);
  beginStep(stageOf(progress, "grid"), "start", T0);
  for (const [line, at] of [['CROWD_PROGRESS {"stage":"decode"}', 1], ['CROWD_PROGRESS {"stage":"fit","mode":"model-guided"}', 2], ['CROWD_PROGRESS {"stage":"teaching","windows":2,"cues":1}', 3], ['CROWD_PROGRESS {"stage":"display"}', 4], ['CROWD_PROGRESS {"stage":"save"}', 5], ['CROWD_PROGRESS {"stage":"saved"}', 6]]) {
    assert.equal(applyAnalyserEvent(progress, parseAnalyserLine(line), T0 + at), true, line);
  }
  const grid = stageOf(progress, "grid");
  assert.equal(grid.state, "done");
  assert.deepEqual(grid.steps.map((step) => step.state), ["done", "done", "done", "done"]);
  assert.match(stepOf(grid, "fit").detail, /re-applied 2 taught windows and 1 preferred cue/);
  assert.equal(stepOf(stageOf(progress, "save"), "write").state, "done");
  assert.equal(legacyStage(progress), "grid");
});

test("complete means every stage finished or was not needed, and only then", () => {
  const progress = createLoadProgress({ trackId: "t", trackName: "Tune", attempt: 1, now: T0 });
  beginStage(progress, "save", T0 + 1);
  assert.equal(progress.state, "running");
  assert.equal(legacyStage(progress), "grid");
  completeLoadProgress(progress, T0 + 2);
  assert.equal(progress.state, "complete");
  assert.ok(progress.stages.every((stage) => stage.state === "done" || stage.state === "skipped"));
  assert.equal(legacyStage(progress), "complete");
  assert.match(summariseLoadProgress(progress), /^Analysis complete · 5\/5 stages done/);
});

test("the booth carries no time-derived progress, no 50-step scale and no invented countdown", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  for (const banned of [/MAPPING_BAND_TAU_SECONDS/, /mappingDisplayStep/, /step \$\{?\w*\}?\/50/, /\/50/, /estimatedTotalSeconds/, /about \$\{remaining\}s left/, /Math\.exp\(-/]) {
    assert.doesNotMatch(booth, banned);
  }
  const loadState = booth.match(/function FocusWaveLoadState[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(loadState, "the deck loading strip exists");
  assert.doesNotMatch(loadState, /status\.match|\.test\(lowerStatus\)|step \(\\d\+\)/, "the strip reads structured progress, not text");
  assert.match(loadState, /viewLoadProgress\(/);
  const route = await readFile(new URL("../app/api/map/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /estimatedTotalSeconds|job\.step\b|separationProgressFor/);
  const lab = await readFile(new URL("../app/beat-grid-lab.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(lab, /estimatedTotalSeconds|time left/);
});

test("normal deck loads reuse saved analysis and telemetry cannot hold the analysis lane", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(booth, /freshAnalysisWiped|deck\.analysis\.wiped|FRESH ANALYSIS · wiping stored grid/,
    "ordinary deck loading must not turn a saved tune into a cold analysis");

  const route = await readFile(new URL("../app/api/map/route.ts", import.meta.url), "utf8");
  assert.match(route, /void recordLoadTiming\(job\);/,
    "diagnostic timing writes must run after the mapping result releases the lane");
  assert.doesNotMatch(route, /await recordLoadTiming\(job\);/,
    "the next tune must not wait for diagnostic file I/O");
});

test("the separator counts a block on its end callback only, and reads the block count from Demucs' own loop", async () => {
  const separation = await readFile(new URL("../scripts/drums_separation.py", import.meta.url), "utf8");
  assert.match(separation, /if state == "end":\s*\n\s*self\.done \+= 1/);
  assert.match(separation, /isinstance\(offsets, range\)/);
  assert.doesNotMatch(separation, /segment_offset.*\/.*audio_length/, "no offset/length fraction");
  // The model settings are Demucs' defaults, untouched by reporting.
  assert.match(separation, /Separator\(model="htdemucs", device=device\)/);
  assert.match(separation, /separator\.update_parameter\(callback=progress\)/);
  const worker = await readFile(new URL("../scripts/drums-stem-worker.py", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /offset \/ length/);
});

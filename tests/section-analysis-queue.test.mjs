import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 26 Sep 2026: two tunes waiting for their grids (two decks loading at once)
// made the section worker rotate its queue forever on already-settled
// promises, freezing every timer and request in the server until the booth's
// idle report went stale 30 s later. These run against an empty, private
// data root: no tune here has a grid record.
const root = mkdtempSync(path.join(os.tmpdir(), "crowd2 section queue "));
mkdirSync(path.join(root, "dj-library"), { recursive: true });
// Empty stores in place, so nothing is adopted from the project's own data.
writeFileSync(path.join(root, "dj-library", "crowd-library.sqlite"), "");
writeFileSync(path.join(root, "section-labels.json"), JSON.stringify({ source: "test", tracks: {}, failures: {} }));
process.env.CROWD_DATA_ROOT = root;

const { enqueueSectionAnalysis, reportBoothIdle, resetSectionAnalysis, status } = await import("../lib/section-analysis.ts");

test.after(() => {
  resetSectionAnalysis();
  // Windows will not delete a directory holding an open database.
  try { globalThis.__crowd2DjLibraryDatabase?.close(); } catch { /* already closed */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* a temp dir left behind is harmless */ }
});

/** How late a 20 ms timer fires: the event loop's own answer to "is anything starving me". */
function timerLateness() {
  const started = performance.now();
  return new Promise((resolve) => setTimeout(() => resolve(performance.now() - started - 20), 20));
}

test("two tunes still waiting for their grids never starve the event loop", async () => {
  resetSectionAnalysis();
  reportBoothIdle(true);
  await timerLateness();
  // Two decks' requests arrive separately; the second starts a worker over both.
  assert.equal(enqueueSectionAnalysis("upload-waiting-grid-a"), true);
  await timerLateness();
  assert.equal(enqueueSectionAnalysis("upload-waiting-grid-b"), true);
  const late = await timerLateness();
  assert.ok(late < 1000, `a 20 ms timer fired ${Math.round(late)} ms late: the section worker is spinning`);
  const now = status();
  assert.equal(now.running, null, "nothing is analysed without a grid record");
  assert.deepEqual(now.queued, ["upload-waiting-grid-a", "upload-waiting-grid-b"], "both tunes keep their place, in order");
});

test("the booth's heartbeats re-check the queue without spinning either", async () => {
  resetSectionAnalysis();
  reportBoothIdle(true);
  enqueueSectionAnalysis("upload-waiting-grid-a");
  enqueueSectionAnalysis("upload-waiting-grid-b");
  enqueueSectionAnalysis("upload-waiting-grid-c");
  for (let beat = 0; beat < 5; beat += 1) {
    reportBoothIdle(true);
    const late = await timerLateness();
    assert.ok(late < 1000, `heartbeat ${beat}: timer ${Math.round(late)} ms late`);
  }
  assert.deepEqual(status().queued, ["upload-waiting-grid-a", "upload-waiting-grid-b", "upload-waiting-grid-c"]);
});

test("the section route's own request order cannot duplicate a waiting tune: one deck is enough", async () => {
  resetSectionAnalysis();
  // What POST /api/section-labels does: report idle (which starts the worker), then enqueue.
  const post = (trackId) => { reportBoothIdle(true); return enqueueSectionAnalysis(trackId); };
  post("upload-one-deck");
  await timerLateness();
  // The deck's second wave (or a re-armed effect) asks again for the same tune.
  post("upload-one-deck");
  const late = await timerLateness();
  assert.ok(late < 1000, `a 20 ms timer fired ${Math.round(late)} ms late: the section worker is spinning`);
  assert.deepEqual(status().queued, ["upload-one-deck"], "held once, not twice");
});

test("a single waiting tune still just waits", async () => {
  resetSectionAnalysis();
  reportBoothIdle(true);
  enqueueSectionAnalysis("upload-waiting-grid-a");
  assert.ok(await timerLateness() < 1000);
  assert.deepEqual(status().queued, ["upload-waiting-grid-a"]);
});

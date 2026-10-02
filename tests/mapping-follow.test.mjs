import assert from "node:assert/strict";
import test from "node:test";
import { createLoadProgress, composeSnapshot } from "../lib/load-progress.ts";
import { describeMappingUpdate, followMapping, MappingRequestError } from "../lib/mapping-follow.ts";

// A scripted booth server: each poll takes the next answer; an Error is "no answer".
function harness(answers, { startFailures = [] } = {}) {
  let clock = 1_000_000;
  const updates = [];
  const waits = [];
  const starts = [];
  const queue = [...answers];
  const startQueue = [...startFailures];
  return {
    updates, waits, starts,
    options: {
      trackName: "Fragile",
      start: async (recovery) => { starts.push(recovery); const failure = startQueue.shift(); if (failure) throw failure; },
      poll: async () => { const next = queue.shift(); if (next instanceof Error) throw next; if (!next) throw new Error("script ran out"); return next; },
      onUpdate: (update) => updates.push(structuredClone(update)),
      cancelled: () => false,
      wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
      now: () => clock,
    },
  };
}
const snapshot = (attempt, serverNow, trackId = "fragile") => composeSnapshot(createLoadProgress({ trackId, trackName: "Fragile", attempt, now: serverNow - 10 }), { serverNow });
const running = (loadProgress) => ({ mapped: false, job: { state: "running" }, loadProgress });

test("a failed poll does not end the load: the last snapshot is kept and the silence is counted", async () => {
  const first = snapshot(1, 5000);
  const { options, updates } = harness([running(first), new Error("Failed to fetch"), new Error("no answer within 10 s"), { mapped: true, job: null, loadProgress: snapshot(1, 9000) }]);
  const result = await followMapping(options);
  assert.equal(result.mapped, true);
  const silent = updates.filter((update) => update.connection.failures > 0);
  assert.deepEqual(silent.map((update) => update.connection.failures), [1, 2]);
  assert.ok(silent.every((update) => update.snapshot?.jobId === first.jobId), "the last real progress stays on screen, unchanged");
  assert.equal(silent[1].connection.lastError, "no answer within 10 s");
  assert.match(describeMappingUpdate(silent[1], silent[1].connection.failingSince + 3000), /^No answer from the booth server for \d+ s · last known: Queued/);
  assert.equal(updates.at(-1).connection.failures, 0, "an answer clears the failure count");
});

test("the server's silence is given up on only after the configured time, with the last known stage named", async () => {
  const answers = [running(snapshot(1, 5000)), ...Array.from({ length: 200 }, () => new Error("Failed to fetch"))];
  const { options } = harness(answers);
  await assert.rejects(followMapping({ ...options, giveUpAfterMs: 20_000 }), /has not answered for \d+ s \(\d+ requests\) · last known: Queued/);
});

test("a refusal from the server is an error at once, not a connection problem", async () => {
  const { options } = harness([], { startFailures: [new MappingRequestError("Unknown track")] });
  await assert.rejects(followMapping(options), /Unknown track/);
});

test("the job's own error surfaces with its message; nothing reports completion", async () => {
  const { options, updates } = harness([running(snapshot(1, 5000)), { mapped: false, job: { state: "error", error: "Demucs failed: out of memory" }, loadProgress: snapshot(1, 6000) }]);
  await assert.rejects(followMapping(options), /Demucs failed: out of memory/);
  assert.ok(updates.every((update) => update.snapshot?.state !== "complete"));
});

test("a job the server lost is requested again, and the new job id replaces the old one", async () => {
  const before = snapshot(1, 5000);
  const after = snapshot(2, 7000);
  const { options, updates, starts } = harness([running(before), { mapped: false, job: null, loadProgress: null }, running(after), { mapped: true, job: null, loadProgress: after }]);
  await followMapping(options);
  assert.deepEqual(starts, [false, true]);
  assert.equal(updates.at(-1).restarts, 1);
  assert.equal(updates.at(-1).snapshot.jobId, after.jobId);
  assert.notEqual(after.jobId, before.jobId);
});

test("an older snapshot of the same job never replaces a newer one", async () => {
  const newer = snapshot(1, 9000);
  const older = { ...newer, serverNow: 4000 };
  const { options, updates } = harness([running(newer), running(older), { mapped: true, job: null, loadProgress: newer }]);
  await followMapping(options);
  assert.ok(updates.every((update) => !update.snapshot || update.snapshot.serverNow === 9000));
});

test("cancelling stops following without claiming anything", async () => {
  const { options } = harness([running(snapshot(1, 5000))]);
  let polls = 0;
  await assert.rejects(followMapping({ ...options, cancelled: () => polls++ > 1 }), /mapping cancelled/);
});

test("polling waits a fixed interval while the server answers and backs off only while it does not", async () => {
  const { options, waits } = harness([running(snapshot(1, 5000)), new Error("x"), new Error("x"), running(snapshot(1, 6000)), { mapped: true, job: null }]);
  await followMapping(options);
  assert.deepEqual(waits, [1000, 1000, 2000, 1000]);
});

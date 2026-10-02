import assert from "node:assert/strict";
import test from "node:test";
import { reconcileCrateScanCursor } from "../lib/crate-scan-resume.ts";

function savedState(overrides = {}) {
  return {
    cursor: 4,
    checked: 4,
    mapped: 2,
    rejected: 1,
    skippedShort: 1,
    skippedKnown: 0,
    compacted: 2,
    rejectedIds: ["elements-reject0000001"],
    skippedShortIds: ["elements-short0000001"],
    crateGeneratedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("an unchanged crate keeps the saved cursor so the scan resumes in place", () => {
  const state = reconcileCrateScanCursor(savedState(), "2026-08-01T00:00:00.000Z");
  assert.equal(state.cursor, 4);
  assert.equal(state.checked, 4);
  assert.equal(state.mapped, 2);
  assert.equal(state.crateGeneratedAt, "2026-08-01T00:00:00.000Z");
});

test("a re-indexed crate restarts the walk so tunes sorted before the cursor are visited", () => {
  // The sorted crate was saved as a b c d e with the cursor sitting after d.
  // Re-indexing inserts b2 at position 2: with the stale positional cursor the
  // resumed walk would begin at e and b2 would never be scanned or mapped.
  const reindexed = ["a", "b", "b2", "c", "d", "e"];
  const stale = savedState({ cursor: 4 });
  assert.ok(!reindexed.slice(stale.cursor).includes("b2"), "the stale cursor hides the inserted tune");
  const state = reconcileCrateScanCursor(stale, "2026-08-08T00:00:00.000Z");
  assert.equal(state.cursor, 0);
  assert.ok(reindexed.slice(state.cursor).includes("b2"));
  assert.equal(state.crateGeneratedAt, "2026-08-08T00:00:00.000Z");
});

test("restarting the walk keeps remembered rejections and short files so they are not re-probed", () => {
  const state = reconcileCrateScanCursor(savedState(), "2026-08-08T00:00:00.000Z");
  assert.deepEqual(state.rejectedIds, ["elements-reject0000001"]);
  assert.deepEqual(state.skippedShortIds, ["elements-short0000001"]);
  assert.equal(state.checked, 0);
  assert.equal(state.mapped, 0);
  assert.equal(state.rejected, 0);
  assert.equal(state.skippedShort, 0);
  assert.equal(state.skippedKnown, 0);
  assert.equal(state.compacted, 0);
});

test("a scan saved before crates were stamped cannot trust its cursor and restarts", () => {
  const state = reconcileCrateScanCursor(savedState({ crateGeneratedAt: null }), "2026-08-08T00:00:00.000Z");
  assert.equal(state.cursor, 0);
  assert.equal(state.crateGeneratedAt, "2026-08-08T00:00:00.000Z");
});

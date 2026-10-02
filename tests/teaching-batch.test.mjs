import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertTransitionTeachingPair } from "../lib/dj-library.ts";
import { durableWriteFile, syncFileForDurability } from "../lib/teaching-batch-recovery.ts";

const routeSource = await readFile(new URL("../app/api/dj-library/teaching/route.ts", import.meta.url), "utf8");
const librarySource = await readFile(new URL("../lib/dj-library.ts", import.meta.url), "utf8");
const recoverySource = await readFile(new URL("../lib/teaching-batch-recovery.ts", import.meta.url), "utf8");
const analysisRouteSource = await readFile(new URL("../app/api/analysis/[id]/route.ts", import.meta.url), "utf8");
const crateRouteSource = await readFile(new URL("../app/api/crate/route.ts", import.meta.url), "utf8");

const validPair = [
  { id: "outgoing", kind: "loop-grid", purpose: "outro-transition", beats: 128 },
  { id: "incoming", kind: "loop-grid", purpose: "intro-loop", beats: 128 },
];

test("transition teaching batches require one ordered, distinct, equal-length pair", () => {
  assert.doesNotThrow(() => assertTransitionTeachingPair(validPair));
  assert.throws(() => assertTransitionTeachingPair(validPair.slice(0, 1)), /exactly one outgoing and one incoming/);
  assert.throws(() => assertTransitionTeachingPair([{ ...validPair[0] }, { ...validPair[1], id: "outgoing" }]), /two different tracks/);
  assert.throws(() => assertTransitionTeachingPair([validPair[1], validPair[0]]), /outgoing then incoming/);
  assert.throws(() => assertTransitionTeachingPair([validPair[0], { ...validPair[1], beats: 96 }]), /same whole beat count/);
  assert.throws(() => assertTransitionTeachingPair([{ ...validPair[0], kind: "cue" }, validPair[1]]), /must be loop grids/);
  assert.throws(() => assertTransitionTeachingPair([{ ...validPair[0], beats: 0 }, { ...validPair[1], beats: 0 }]), /same whole beat count/);
});

test("the transition-pair route stages both files before one SQLite commit and recovers before success", () => {
  const pairSource = routeSource.match(/async function saveTransitionPair[\s\S]*?(?=\nexport async function GET)/)?.[0] ?? "";
  assert.match(routeSource, /action\?: "transition-pair"/);
  assert.match(routeSource, /entries\?: TeachingEditBody\[\]/);
  assert.ok(pairSource.indexOf("stageTeachingBatch(") >= 0);
  assert.ok(pairSource.indexOf("stageTeachingBatch(") < pairSource.indexOf("commitTeachingBatch("));
  assert.ok(pairSource.indexOf("commitTeachingBatch(") < pairSource.indexOf("recoverPendingTeachingBatch()"));
  assert.match(pairSource, /results: edits\.map\(\(edit\) =>/);
  assert.match(pairSource, /moment: moments\.at\(-1\), moments, undoToken: edit\.undoToken/);
});

test("compact records, teaching moments, and the recovery marker share one SQLite transaction", () => {
  const commitSource = librarySource.match(/export async function commitTeachingBatch[\s\S]*?(?=\nexport async function readPendingTeachingBatch)/)?.[0] ?? "";
  assert.match(commitSource, /database\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(commitSource, /storeRecord\(database, record\)/);
  assert.match(commitSource, /storeTeachingMoment\(database, moment\)/);
  assert.match(commitSource, /PENDING_TEACHING_BATCH_META_KEY/);
  assert.ok(commitSource.indexOf("PENDING_TEACHING_BATCH_META_KEY") < commitSource.indexOf('database.exec("COMMIT")'));
  assert.match(commitSource, /INSERT INTO meta \(key, value_json\) VALUES \(\?, \?\)/);
  assert.doesNotMatch(commitSource, /ON CONFLICT/);
  assert.match(commitSource, /catch \(error\) \{\s*database\.exec\("ROLLBACK"\)/);
  assert.match(librarySource, /DELETE FROM meta WHERE key = \? AND value_json = \?/);
});

test("staged files are flushed and pending pairs recover before booth analysis reads", () => {
  const stageSource = routeSource.match(/async function stageTeachingBatch[\s\S]*?(?=\nasync function saveTransitionPair)/)?.[0] ?? "";
  assert.match(stageSource, /durableWriteFile\(path\.join\(directory, `original-/);
  assert.match(stageSource, /durableWriteFile\(path\.join\(directory, `corrected-/);
  assert.match(stageSource, /durableWriteFile\(path\.join\(directory, "manifest\.json"/);
  assert.match(recoverySource, /await handle\.sync\(\)/);
  assert.match(recoverySource, /await syncFileForDurability\(temporary\)/);
  assert.match(recoverySource, /await rename\(temporary, destination\)/);
  assert.match(recoverySource, /await syncFileForDurability\(destination\)/);
  assert.ok(recoverySource.indexOf("try {\n    await copyFile(source, temporary)") < recoverySource.indexOf("finally {\n    await rm(temporary"), "temporary promotion files must be cleaned after every failure point");
  assert.match(analysisRouteSource, /await recoverPendingTeachingBatch\(\)/);
  assert.match(crateRouteSource, /await recoverPendingTeachingBatch\(\)/);
  const teachingGet = routeSource.match(/export async function GET[\s\S]*?(?=\nexport async function POST)/)?.[0] ?? "";
  assert.match(teachingGet, /serializeTeachingMutation\(async \(\) =>/);
  assert.match(teachingGet, /await recoverPendingTeachingBatch\(\)/);
});

test("durability flush opens an existing file with Windows-compatible write access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crowd2-fsync-"));
  const file = path.join(directory, "saved-transition.json");
  try {
    await durableWriteFile(file, JSON.stringify({ saved: true }));
    await syncFileForDurability(file);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { saved: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("all teaching mutations serialize and finish a committed pair before legacy work", () => {
  const postSource = routeSource.match(/export async function POST[\s\S]*?(?=\nexport async function DELETE)/)?.[0] ?? "";
  const deleteSource = routeSource.match(/export async function DELETE[\s\S]*$/)?.[0] ?? "";
  assert.match(routeSource, /__crowd2TeachingMutationTail/);
  assert.match(postSource, /serializeTeachingMutation\(async \(\) =>/);
  assert.match(deleteSource, /serializeTeachingMutation\(async \(\) =>/);
  assert.ok(postSource.indexOf("recoverPendingTeachingBatch()") < postSource.indexOf('body.action === "transition-pair"'));
  assert.ok(postSource.indexOf("recoverPendingTeachingBatch()") < postSource.indexOf("prepareTeachingEdit(body)"));
  assert.ok(deleteSource.indexOf("recoverPendingTeachingBatch()") < deleteSource.indexOf("withoutStoredCuePlacements"));
});

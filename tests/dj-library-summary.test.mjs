import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("lightweight intelligence reads preserve summary values without decoding detail payloads", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "crowd-summary-test-"));
  const originalCwd = process.cwd();
  const originalDataRoot = process.env.CROWD_DATA_ROOT;
  process.chdir(fixture);
  process.env.CROWD_DATA_ROOT = path.join(fixture, "data");
  let database;
  context.after(async () => {
    database?.close();
    globalThis.__crowd2DjLibraryDatabase?.close();
    delete globalThis.__crowd2DjLibraryDatabase;
    process.chdir(originalCwd);
    if (originalDataRoot === undefined) delete process.env.CROWD_DATA_ROOT;
    else process.env.CROWD_DATA_ROOT = originalDataRoot;
    await rm(fixture, { recursive: true, force: true });
  });
  const { rememberQuickBpmIntelligence, readTrackIntelligenceIndex, readTrackIntelligenceSummary } = await import("../lib/dj-library.ts");
  const track = { id: "summary-fixture", name: "Fixture", album: "Artist - Album", source: "built-in", duration: 422, file: "fixture.wav" };
  const detailed = await rememberQuickBpmIntelligence(track, 146.37, .93, { payload: "x".repeat(100_000) });
  const { bassLinePattern, kickDrumInfo, gridInfo, cueInfo, waveformInfo, extra, ...expected } = detailed;
  assert.deepEqual(await readTrackIntelligenceSummary(track.id), expected);
  assert.deepEqual(await readTrackIntelligenceIndex(), [expected]);
  assert.equal(await readTrackIntelligenceSummary("missing-fixture"), null);
  database = new DatabaseSync(path.join(fixture, "data", "dj-library", "crowd-library.sqlite"));
  database.prepare("UPDATE track_intelligence SET extra_json = ? WHERE id = ?").run("{broken optional detail", track.id);
  assert.deepEqual(await readTrackIntelligenceSummary(track.id), expected);
  assert.deepEqual(await readTrackIntelligenceIndex(), [expected]);
});

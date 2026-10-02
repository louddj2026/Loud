import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCompactDjRecord, compactIntelligenceDetails, incompatibilityPairKey } from "../lib/dj-library.ts";

test("compact DJ records retain reusable grid intelligence without the detailed waveform bulk", async () => {
  const analysis = JSON.parse(await readFile(new URL("../public/analysis/03.json", import.meta.url), "utf8"));
  const track = { ...analysis.track, album: "Test Artist - Test Album", source: "built-in", duration: analysis.duration };
  const record = buildCompactDjRecord(track, analysis, { size: 1234, modifiedMs: 5678 });
  const bytes = Buffer.byteLength(JSON.stringify(record));
  assert.equal(record.beatGrid.deltaMs.length, analysis.beats.length - 1);
  assert.equal(record.featureVersion, 2);
  assert.equal(Buffer.from(record.beatFeatures.lowBody, "base64").length, analysis.beats.length - 1);
  assert.equal(Buffer.from(record.beatFeatures.lowAttack, "base64").length, analysis.beats.length - 1);
  assert.equal(Buffer.from(record.beatFeatures.upperAttack, "base64").length, analysis.beats.length - 1);
  assert.equal(record.bassFingerprints.entry.length, 32);
  assert.equal(record.bassFingerprints.exit.length, 32);
  assert.ok(record.cues.entryDropMs > record.cues.entryRunwayMs);
  assert.ok(record.cues.exitHandoffMs > record.cues.exitRunwayMs);
  assert.ok(bytes < 100_000, `compact record was unexpectedly large: ${bytes} bytes`);
});

test("the intelligence row exposes bass, kick, grid, cue, waveform and source detail columns", async () => {
  const analysis = JSON.parse(await readFile(new URL("../public/analysis/03.json", import.meta.url), "utf8"));
  const track = { ...analysis.track, album: "Test Artist - Test Album", source: "built-in", duration: analysis.duration };
  const record = buildCompactDjRecord(track, analysis);
  const details = compactIntelligenceDetails(record);
  assert.deepEqual(details.bassLinePattern.entry, record.bassFingerprints.entry);
  assert.equal(details.kickDrumInfo.beatFeatures.lowAttack, record.beatFeatures.lowAttack);
  assert.deepEqual(details.gridInfo.verification, record.verification);
  assert.deepEqual(details.cueInfo, record.cues);
  assert.deepEqual(details.waveformInfo, record.waveformPreview);
  assert.equal(details.extra.analysisVersion, record.analysisVersion);
});

test("incompatibility keys are symmetric so a rejected pair is blocked in either direction", () => {
  assert.deepEqual(incompatibilityPairKey("tune-a", "tune-b"), ["tune-a", "tune-b"]);
  assert.deepEqual(incompatibilityPairKey("tune-b", "tune-a"), ["tune-a", "tune-b"]);
  assert.throws(() => incompatibilityPairKey("tune-a", "tune-a"), /itself/);
});

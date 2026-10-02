import assert from "node:assert/strict";
import test from "node:test";
import { assessGridQuality, assessGridRetentionQuality } from "../lib/grid-quality.ts";

const grid = (verifiedBeatCoverage, verifiedBlocks, reviewBlocks, noEvidenceBlocks = 0) => ({
  beats: Array.from({ length: 1000 }),
  verification: { verifiedBeatCoverage, verifiedBlocks, reviewBlocks, noEvidenceBlocks },
});

test("retained demo-grid quality remains trusted", () => {
  assert.equal(assessGridQuality(grid(.974, 55, 3, 7)).accepted, true);
  assert.equal(assessGridQuality(grid(.968, 46, 7, 19)).accepted, true);
  assert.equal(assessGridQuality(grid(.996, 47, 1, 14)).accepted, true);
});

test("Midship's disputed grid signature is rejected", () => {
  const result = assessGridQuality(grid(.899, 42, 9, 32));
  assert.equal(result.accepted, false);
  assert.match(result.reasons.join("; "), /below 92%/);
  assert.match(result.reasons.join("; "), /evidenced blocks disagree/);
});

test("a provisional grid is retained without a 48-beat kick-evidence region so manual cues can teach it", () => {
  const blocks = Array.from({ length: 12 }, (_, index) => ({
    start: index * 6,
    end: (index + 1) * 6,
    status: index < 3 ? "verified" : "review",
    evidenceCoverage: .7,
  }));
  const partial = grid(.25, 3, 9);
  partial.duration = 72;
  partial.verification.blocks = blocks;
  const result = assessGridRetentionQuality(partial);
  assert.equal(result.accepted, true);
  assert.equal(result.wholeTrackAccepted, false);
  assert.ok(result.safeTransitionWindows > 0);

  partial.verification.blocks = blocks.map((block) => ({ ...block, status: "review" }));
  const provisional = assessGridRetentionQuality(partial);
  assert.equal(provisional.accepted, true);
  assert.equal(provisional.safeTransitionWindows, 0);
  assert.deepEqual(provisional.reasons, []);
});

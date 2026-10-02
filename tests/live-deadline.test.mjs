import assert from "node:assert/strict";
import test from "node:test";
import { FRESH_SCAN_SECONDS, NEXT_TUNE_SELECTION_SECONDS, liveCueAwareDeadlineMode, liveSearchBudgetSeconds, liveSearchDeadlineMode, nextTuneSelectionPhase, nextTuneSelectionSecondsRemaining, shouldYieldMappingToPreferredMatch } from "../lib/live-deadline.ts";

test("the next-tune clock scans fresh music first and makes a decision within one minute", () => {
  assert.equal(FRESH_SCAN_SECONDS, 40);
  assert.equal(NEXT_TUNE_SELECTION_SECONDS, 60);
  assert.equal(nextTuneSelectionPhase(0), "fresh-scan");
  assert.equal(nextTuneSelectionPhase(39.9), "fresh-scan");
  assert.equal(nextTuneSelectionPhase(40), "mapped-fallback");
  assert.equal(nextTuneSelectionPhase(59.9), "mapped-fallback");
  assert.equal(nextTuneSelectionPhase(60), "decision-due");
  assert.equal(nextTuneSelectionSecondsRemaining(17.5), 42.5);
  assert.equal(nextTuneSelectionSecondsRemaining(61), 0);
});

test("live search stops starting slow mapping jobs before arming a cold start", () => {
  assert.equal(liveSearchDeadlineMode(180), "full-search");
  assert.equal(liveSearchDeadlineMode(90), "mapped-only");
  assert.equal(liveSearchDeadlineMode(30), "cold-start");
});

test("a qualified match moves the search deadline to its preferred runway", () => {
  assert.equal(liveSearchBudgetSeconds(300), 300);
  assert.equal(liveSearchBudgetSeconds(300, 95), 95);
  assert.equal(liveSearchDeadlineMode(liveSearchBudgetSeconds(300, 95)), "mapped-only");
  assert.equal(liveSearchDeadlineMode(liveSearchBudgetSeconds(300, 30)), "cold-start");
  assert.equal(liveSearchBudgetSeconds(80, 200), 80);
});

test("an in-progress mapping yields before it can consume an already-qualified runway", () => {
  assert.equal(shouldYieldMappingToPreferredMatch(false, 90), false);
  assert.equal(shouldYieldMappingToPreferredMatch(true, 180), false);
  assert.equal(shouldYieldMappingToPreferredMatch(true, 110), true);
  assert.equal(shouldYieldMappingToPreferredMatch(true, 30), true);
});

test("a missed runway does not trigger a cold start while the locked cue and track are still ahead", () => {
  assert.equal(liveCueAwareDeadlineMode(180, 0), "mapped-only");
  assert.equal(liveCueAwareDeadlineMode(180, 80), "mapped-only");
  assert.equal(liveCueAwareDeadlineMode(180, 140), "full-search");
  assert.equal(liveCueAwareDeadlineMode(30, 140), "cold-start");
});

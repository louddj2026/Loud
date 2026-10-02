import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const djSource = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");

test("the full-width assisted status and reset bar is not rendered", () => {
  assert.doesNotMatch(djSource, /const assistedPanel =/);
  assert.doesNotMatch(djSource, /\{assistedPanel\}/);
  assert.doesNotMatch(djSource, /STOP PLAYBACK \+ RESET TO READY/);
  assert.doesNotMatch(djSource, /className=\{`assisted-crate-control assisted-primary assisted-utility/);
});

test("deck recycle block reasons stay visible on the deck waveform", () => {
  const blockSource = djSource.match(/const deckRecycleBlockReason = [\s\S]*?\n  \};/)?.[0] ?? "";
  // Greedy to the last backtick on each line: one block reason nests a
  // template literal, so a non-backtick character class would stop early.
  const reasons = blockSource.match(/return `.*`/g) ?? [];
  assert.ok(reasons.length >= 2, "expected the block-reason messages");
  for (const reason of reasons) assert.match(reason, /before replacing it/);
  // Each surviving reason names something real that is still holding the deck:
  // its own transport, or a plan that still has the deck in it. The reason that
  // fired on "playing with no runtime" is gone — nothing was holding the deck
  // in that state and no runtime remained to release it, so it stranded every
  // deck with a Load button that silently did nothing.
  assert.ok(reasons.some((reason) => /is playing/.test(reason)), "the transport reason should survive");
  assert.ok(reasons.some((reason) => /still armed in the live assisted sequence/.test(reason)), "the armed-plan reason should survive");
  assert.match(blockSource, /if \(!runtime\) return null;/);
  assert.match(djSource, /const showLoadHandoff = \/ready\/\.test\(loadStatus\.toLowerCase\(\)\) \|\| \/before replacing it\/\.test\(loadStatus\);/);
});

test("manual Load paths use playback protection and manual replacement handling", () => {
  for (const name of ["openLocalFile", "openTrackPicker", "loadLocalFile"]) {
    const from = djSource.indexOf(`const ${name} =`);
    const to = djSource.indexOf("\n  const ", from + 1);
    const handler = djSource.slice(from, to);
    assert.match(handler, /manualDeckLoadBlockReason\(id\)/);
    assert.doesNotMatch(handler, /finishStoppedSilentOutgoingForLoad/);
  }
  assert.match(djSource, /if \(options\.manual\) prepareManualDeckLoad\(id\);/);
});

test("launching or resetting assisted playback invalidates stale search continuations", () => {
  const launchSource = djSource.match(/const launchAssistedPlayback = async [\s\S]*?(?=  const reportAssistedPlaybackError)/)?.[0] ?? "";
  assert.match(launchSource, /const token = \+\+demoToken\.current;[\s\S]{0,400}?assistedToken\.current \+= 1;/);
  const stopResetSource = djSource.match(/const stopAndResetAssistedPlayback = [\s\S]*?(?=  const skipAssistedIntroPrep)/)?.[0] ?? "";
  assert.match(stopResetSource, /demoToken\.current \+= 1;[\s\S]{0,400}?assistedToken\.current \+= 1;/);
  // The session flag must not be cleared by the reset path.
  assert.match(stopResetSource, /assistedRunning\.current = true;/);
});

test("the unreachable demo planner no longer runs at boot", () => {
  assert.doesNotMatch(djSource, /CROWD2_DEMO_TRACK_IDS/);
  assert.doesNotMatch(djSource, /New set selected: U\.F\.O\./);
});

test("the master output level is a live control", () => {
  assert.match(djSource, /className="settings-master-volume"/);
  assert.match(djSource, /void setMaster\(Number\(event\.currentTarget\.value\)\)/);
});

test("paused pitch scrub prefers the first known positive duration", () => {
  assert.match(djSource, /\[deck\.analysis\?\.duration, track\.duration, session\.audio\.duration\]\s*\n?\s*\.find\(\(value\): value is number => typeof value === "number" && Number\.isFinite\(value\) && value > 0\) \?\? Number\.NaN;/);
  assert.doesNotMatch(djSource, /deck\.analysis\?\.duration \?\? track\.duration \?\? session\.audio\.duration/);
});

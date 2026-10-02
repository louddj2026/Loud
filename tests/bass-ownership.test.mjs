import assert from "node:assert/strict";
import test from "node:test";
import {
  bassOwnerAtBeat,
  bassOwnershipSegments,
  bassSwapWindowAtBeat,
  normaliseBassSwapBeats,
  resizeBassSwapBeats,
  toggleBassSwapBeat,
} from "../lib/bass-ownership.ts";

test("one swap behaves exactly like the old single bass cue", () => {
  // Outgoing owns the low end until the cue, incoming owns it afterwards.
  assert.equal(bassOwnerAtBeat([48], 96, 0), "outgoing");
  assert.equal(bassOwnerAtBeat([48], 96, 47), "outgoing");
  assert.equal(bassOwnerAtBeat([48], 96, 48), "incoming");
  assert.equal(bassOwnerAtBeat([48], 96, 95), "incoming");
  assert.deepEqual(bassOwnershipSegments([48], 96), [
    { startBeat: 0, endBeat: 48, owner: "outgoing" },
    { startBeat: 48, endBeat: 96, owner: "incoming" },
  ]);
});

test("the outgoing tune always owns the bass when the overlap opens", () => {
  // It is the tune the room is already hearing; there is nothing to swap from.
  assert.equal(bassOwnerAtBeat([], 96, 0), "outgoing");
  assert.equal(bassOwnerAtBeat([16, 32, 64], 96, 0), "outgoing");
  assert.deepEqual(normaliseBassSwapBeats([0], 96), []);
});

test("cutting back and forth alternates ownership at every swap", () => {
  const swaps = [16, 32, 48, 64];
  const owners = [0, 16, 32, 48, 64, 95].map((beat) => bassOwnerAtBeat(swaps, 96, beat));
  assert.deepEqual(owners, ["outgoing", "incoming", "outgoing", "incoming", "outgoing", "outgoing"]);
  assert.deepEqual(bassOwnershipSegments(swaps, 96).map((s) => `${s.startBeat}-${s.endBeat}:${s.owner}`), [
    "0-16:outgoing", "16-32:incoming", "32-48:outgoing", "48-64:incoming", "64-96:outgoing",
  ]);
});

test("clicking a beat adds a cut, clicking it again removes it", () => {
  let swaps = [];
  swaps = toggleBassSwapBeat(swaps, 96, 32);
  assert.deepEqual(swaps, [32]);
  swaps = toggleBassSwapBeat(swaps, 96, 64);
  assert.deepEqual(swaps, [32, 64]);
  swaps = toggleBassSwapBeat(swaps, 96, 32);
  assert.deepEqual(swaps, [64]);
});

test("a swap outside the window is refused rather than silently clamped", () => {
  assert.deepEqual(toggleBassSwapBeat([], 96, 0), []);
  assert.deepEqual(toggleBassSwapBeat([], 96, 96), []);
  assert.deepEqual(toggleBassSwapBeat([], 96, -8), []);
  assert.deepEqual(normaliseBassSwapBeats([12, 12, 12], 96), [12]);
  assert.deepEqual(normaliseBassSwapBeats([64, 16, 32], 96), [16, 32, 64]);
  assert.deepEqual(normaliseBassSwapBeats([Number.NaN, 24], 96), [24]);
});

test("the exchange still occupies the middle half of the beat before the swap", () => {
  const window = bassSwapWindowAtBeat([48], 96, 40);
  assert.equal(window.swapBeat, 48);
  assert.ok(Math.abs(window.startBeat - 47.25) < 1e-9);
  assert.ok(Math.abs(window.centreBeat - 47.5) < 1e-9);
  assert.ok(Math.abs(window.endBeat - 47.75) < 1e-9);
});

test("the governing swap is the one being approached or just passed", () => {
  const swaps = [16, 48, 80];
  assert.equal(bassSwapWindowAtBeat(swaps, 96, 0).swapBeat, 16);
  assert.equal(bassSwapWindowAtBeat(swaps, 96, 20).swapBeat, 16);
  assert.equal(bassSwapWindowAtBeat(swaps, 96, 47).swapBeat, 48);
  assert.equal(bassSwapWindowAtBeat(swaps, 96, 90).swapBeat, 80);
  assert.equal(bassSwapWindowAtBeat([], 96, 10), null);
});

test("changing the overlap length keeps cuts in the same musical place", () => {
  assert.deepEqual(resizeBassSwapBeats([32], 64, 128), [64]);
  assert.deepEqual(resizeBassSwapBeats([16, 32, 48], 64, 128), [32, 64, 96]);
  assert.deepEqual(resizeBassSwapBeats([64], 128, 64), [32]);
  // A cut that would land on the window edge after scaling is dropped, not clamped onto it.
  assert.deepEqual(resizeBassSwapBeats([63], 64, 32), [32].filter(() => false));
});

test("the original cue selector still wins when it sets a single beat", async () => {
  const { normaliseAssistedOverlapAutomation, assistedAutomationAtBeat } = await import("../lib/assisted-playback.ts");
  // The booth's cue selector does `{ ...automation, bassSwapBeat: n }`, which
  // carries the old list along. The explicit single cue must replace it, or
  // choosing a new bass cue silently does nothing.
  const base = normaliseAssistedOverlapAutomation({ windowBeats: 128, bassSwapBeat: 32 });
  assert.deepEqual(base.bassSwapBeats, [32]);
  const moved = normaliseAssistedOverlapAutomation({ ...base, bassSwapBeat: 64 });
  assert.deepEqual(moved.bassSwapBeats, [64]);
  assert.equal(assistedAutomationAtBeat(moved, 40).bassSwapped, false);
  assert.equal(assistedAutomationAtBeat(moved, 70).bassSwapped, true);
  // Setting the list explicitly is honoured, including multiple cuts.
  // Per the contract, a caller changing the list sets both.
  const cuts = normaliseAssistedOverlapAutomation({ ...base, bassSwapBeats: [16, 48, 96], bassSwapBeat: 16 });
  assert.deepEqual(cuts.bassSwapBeats, [16, 48, 96]);
  assert.equal(cuts.bassSwapBeat, 16);
});

test("cutting back to the outgoing tune fades the low end the other way", async () => {
  const { assistedAutomationAtBeat, normaliseAssistedOverlapAutomation } = await import("../lib/assisted-playback.ts");
  const automation = normaliseAssistedOverlapAutomation({ windowBeats: 128, bassSwapBeats: [32, 64] });
  // Incoming takes the bass at 32 ...
  assert.equal(assistedAutomationAtBeat(automation, 40).bassOwner, "incoming");
  // ... and hands it back at 64.
  assert.equal(assistedAutomationAtBeat(automation, 70).bassOwner, "outgoing");
  // Mid-exchange before the hand-back, the two low gains cross over.
  // Mid-exchange before the hand-back the two low EQs cross over, and the
  // direction is reversed compared with the first swap.
  const during = assistedAutomationAtBeat(automation, 63.5);
  assert.ok(during.bassSwapProgress > 0 && during.bassSwapProgress < 1);
  const dbToGain = (db) => db <= -60 ? 0 : Math.pow(10, db / 20);
  const out = dbToGain(during.outgoingLow), inc = dbToGain(during.incomingLow);
  assert.ok(Math.abs(out ** 2 + inc ** 2 - 1) < 1e-6, `equal power both ways: out= in=`);
  // The outgoing tune is taking the bass back, so it is rising here.
  const earlier = assistedAutomationAtBeat(automation, 63.3);
  assert.ok(dbToGain(earlier.outgoingLow) < out, "outgoing low rises as it takes the bass back");
});

test("the bass lane shows who holds the low end and toggles a cut on any beat", async () => {
  const { readFile } = await import("node:fs/promises");
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // The lane resolves a click to a beat, so ANY beat can carry a cut rather
  // than a fixed set of buttons — 95 buttons was both unusable and unreadable.
  assert.match(booth, /const beatAt = Math\.round\(fraction \* beats\)/);
  assert.match(booth, /const bassSwapBeats = toggleBassSwapBeat\(automation\.bassSwapBeats, automation\.windowBeats, beatAt\)/);
  // The single cue travels with the list, per the normaliser's contract.
  assert.match(booth, /bassSwapBeat: bassSwapBeats\[0\] \?\? automation\.bassSwapBeat/);
  // The lane sits inside the audition surface, so its clicks must not also
  // start playback from that point.
  assert.match(booth, /event\.stopPropagation\(\);/);
  // Ownership is painted as bands on the lane and washed over the waveform.
  assert.match(booth, /bassOwnershipSegments\(automation\.bassSwapBeats, automation\.windowBeats\)\.map\(\(segment\) => <rect/);
  assert.match(booth, /\.filter\(\(segment\) => segment\.owner !== \(role === "incoming" \? "incoming" : "outgoing"\)\)/);
  // Drawn on the same x-mapping as the wave and its grid, so a cut lands where
  // it looks like it lands.
  assert.match(booth, /x=\{segment\.startBeat \/ Math\.max\(1, beats\) \* width\}/);
  assert.match(css, /\.mix-window-bass-lane\{/);
  assert.doesNotMatch(booth, /mix-window-beat-ruler/);
});

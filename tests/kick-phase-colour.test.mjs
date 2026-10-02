import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KICK_PHASE_ALIGNED,
  KICK_PHASE_EARLY,
  KICK_PHASE_LATE,
  KICK_PHASE_UNKNOWN,
  kickPhaseColour,
} from "../lib/kick-phase-colour.ts";

test("green locked, blue early, red late", () => {
  assert.equal(kickPhaseColour("aligned").colour, KICK_PHASE_ALIGNED);
  assert.equal(kickPhaseColour("incoming-early").colour, KICK_PHASE_EARLY);
  assert.equal(kickPhaseColour("incoming-late").colour, KICK_PHASE_LATE);
  assert.equal(kickPhaseColour("aligned").provisional, false);
});

test("a reading with no direction never implies one", () => {
  // Drifting and unstable are true statements about the pair, but neither
  // means "early" or "late", so they must not borrow those colours.
  for (const status of ["drifting", "unstable", "measuring", "waiting", null, undefined]) {
    assert.equal(kickPhaseColour(status).colour, KICK_PHASE_UNKNOWN, `${status} should stay neutral`);
  }
  assert.equal(kickPhaseColour("measuring").provisional, true);
  assert.equal(kickPhaseColour("drifting").provisional, false);
});

test("phase colour is diagnosis only and never reaches tempo", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  const mixSource = booth.match(/const playTransitionPreviewMix = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(mixSource, "preview mix source should be readable");
  // Once the incoming tune is audible, the span-locked ratio is the only thing
  // permitted to set its rate. The gentle nudge is confined to the silent
  // preroll by design, and the outgoing tune always plays at 1.
  const audible = mixSource.slice(mixSource.indexOf("if (mixOpened) {"));
  assert.ok(audible.length > 0, "audible overlap block should be readable");
  assert.doesNotMatch(audible, /assistedSilentGridNudgeRate/);
  for (const line of audible.split("\n").filter((entry) => /playbackRate\s*=/.test(entry))) {
    assert.match(line, /playbackRate = safeIncomingRate|playbackRate - safeIncomingRate/, `audible rate set from something else: ${line.trim()}`);
  }
  // No phase reading may appear in any rate expression anywhere in the mix.
  for (const line of mixSource.split("\n").filter((entry) => /playbackRate\s*=/.test(entry))) {
    assert.doesNotMatch(line, /kick|phaseColour|phaseStatus/i, `phase reading reached tempo: ${line.trim()}`);
  }
});

test("the preview playheads carry the reading while a mix auditions", async () => {
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  // Measured from the two private players inside the audible overlap.
  assert.match(booth, /const kickUpdate = updateKickPhaseMonitor\(previewKickMonitor, observeKickAgainstKick\(/);
  assert.match(booth, /let previewKickStatus: KickPhaseStatus \| null = null;/);
  // Written to a ref, never to state: the 50 ms mix interval must not rerender
  // the booth, so the playheads pick the colour up in their own frame.
  assert.match(booth, /transitionPreviewPhaseColour\.current = kickPhaseColour\(previewKickStatus\)\.colour;/);
  assert.match(booth, /const transitionPreviewPhaseColour = useRef<string \| null>\(null\);/);
  const timerStart = booth.indexOf("transitionPreviewTimer.current = setInterval");
  const timerEnd = booth.indexOf("}, 50);", timerStart);
  assert.equal(booth.slice(timerStart, timerEnd).includes("setTransitionPreview("), false, "the mix interval must not call setState");
  // The playhead applies it in its animation frame, and clears back to white.
  assert.match(booth, /line\.current\.setAttribute\("stroke", phase \?\? "#fff"\)/);
  assert.match(booth, /transitionPreviewPhaseColour\.current = null;/);
});

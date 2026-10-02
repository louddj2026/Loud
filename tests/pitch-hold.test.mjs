import assert from "node:assert/strict";
import test from "node:test";
import {
  PITCH_HOLD_MAX_PLAYBACK_RATE,
  pitchHoldDurationMs,
  pitchHoldPlaybackRate,
  pitchHoldSmoothstep,
  pitchScrubDistance,
  pitchScrubTarget,
} from "../lib/pitch-hold.ts";

test("pitch-hold deadline is eight beats at the crowd tempo", () => {
  assert.equal(pitchHoldDurationMs(120, 1), 4_000);
  assert.equal(pitchHoldDurationMs(120, 1.25), 3_200);
  assert.equal(pitchHoldDurationMs(90, 1), 16_000 / 3);
});

test("pitch-hold deadline falls back to 120 BPM and a valid base rate", () => {
  assert.equal(pitchHoldDurationMs(0, 1), 4_000);
  assert.equal(pitchHoldDurationMs(Number.NaN, 1.25), 3_200);
  assert.equal(pitchHoldDurationMs(120, 0), 4_000);
});

test("pitch down and up mirror the smoothstep curve", () => {
  const duration = pitchHoldDurationMs(120, 1);
  assert.equal(pitchHoldSmoothstep(0), 0);
  assert.equal(pitchHoldSmoothstep(.5), .5);
  assert.equal(pitchHoldSmoothstep(1), 1);

  assert.equal(pitchHoldPlaybackRate(-1, 1, 0, duration), 1);
  assert.equal(pitchHoldPlaybackRate(-1, 1, duration / 2, duration), .5);
  assert.equal(pitchHoldPlaybackRate(-1, 1, duration, duration), 0);

  assert.equal(pitchHoldPlaybackRate(1, 1, 0, duration), 1);
  assert.equal(pitchHoldPlaybackRate(1, 1, duration / 2, duration), 1.5);
  assert.equal(pitchHoldPlaybackRate(1, 1, duration, duration), 2);
});

test("pitch-hold progress clamps at both ends and pitch up respects its cap", () => {
  const duration = 4_000;
  assert.equal(pitchHoldPlaybackRate(-1, 1, -500, duration), 1);
  assert.equal(pitchHoldPlaybackRate(-1, 1, 8_000, duration), 0);
  assert.equal(pitchHoldPlaybackRate(1, 3, duration, duration), PITCH_HOLD_MAX_PLAYBACK_RATE);
  assert.equal(pitchHoldPlaybackRate(1, 1, duration, duration, 1.75), 1.75);
});

test("paused scrub accelerates before settling at the speed cap", () => {
  const firstSecond = pitchScrubDistance(1_000);
  const secondSecond = pitchScrubDistance(2_000) - firstSecond;
  const thirdSecond = pitchScrubDistance(3_000) - pitchScrubDistance(2_000);
  assert.equal(firstSecond, .75);
  assert.equal(secondSecond, 1.75);
  assert.equal(thirdSecond, 2.75);
  assert.ok(secondSecond > firstSecond);
  assert.ok(thirdSecond > secondSecond);

  const tenthSecond = pitchScrubDistance(10_000) - pitchScrubDistance(9_000);
  const eleventhSecond = pitchScrubDistance(11_000) - pitchScrubDistance(10_000);
  assert.equal(tenthSecond, 8);
  assert.equal(eleventhSecond, 8);
});

test("paused scrub targets move in either direction and clamp to track bounds", () => {
  assert.equal(pitchScrubTarget(20, -1, 1_000, 100), 19.25);
  assert.equal(pitchScrubTarget(20, 1, 1_000, 100), 20.75);
  assert.equal(pitchScrubTarget(1, -1, 10_000, 100), 0);
  assert.equal(pitchScrubTarget(99, 1, 10_000, 100), 100);
  assert.equal(pitchScrubTarget(20, 1, -1_000, 100), 20);
});

test("paused scrub with an unknown duration never teleports to 0:00", () => {
  // duration 0 (fresh local import metadata) — scrub moves from the real
  // playhead instead of collapsing to [0, 0].
  assert.equal(pitchScrubTarget(150, -1, 1_000, 0), 149.25);
  // NaN (media metadata not loaded yet) and negative are equally unknown.
  assert.equal(pitchScrubTarget(150, 1, 1_000, Number.NaN), 150.75);
  assert.equal(pitchScrubTarget(150, 1, 1_000, -30), 150.75);
  // The lower bound still clamps at the track start.
  assert.equal(pitchScrubTarget(.5, -1, 10_000, 0), 0);
  assert.equal(pitchScrubTarget(-5, 1, 0, 0), 0);
});

test("a known duration still clamps the scrub exactly as before", () => {
  assert.equal(pitchScrubTarget(20, -1, 1_000, 100), 19.25);
  assert.equal(pitchScrubTarget(99, 1, 10_000, 100), 100);
});

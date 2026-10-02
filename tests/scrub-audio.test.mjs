import assert from "node:assert/strict";
import test from "node:test";
import {
  SCRUB_MAX_RATE,
  SCRUB_STILL_RATE,
  scrubCommand,
  scrubRate,
  scrubRelease,
  scrubRouting,
  scrubVelocity,
} from "../lib/scrub-audio.ts";

const drag = (perFrame, frames = 6, frameSeconds = .016) =>
  Array.from({ length: frames }, (_, index) => ({ time: 100 + index * perFrame, at: index * frameSeconds }));

test("dragging at record speed reads at record speed", () => {
  // Moving .016 s of track per .016 s of wall clock is rate 1.
  const velocity = scrubVelocity(drag(.016));
  assert.ok(Math.abs(velocity - 1) < 1e-9);
  assert.ok(Math.abs(scrubRate(velocity) - 1) < 1e-9);
});

test("a slow drag pitches down, a fast drag pitches up", () => {
  assert.ok(Math.abs(scrubRate(scrubVelocity(drag(.004))) - .25) < 1e-9);
  assert.ok(Math.abs(scrubRate(scrubVelocity(drag(.032))) - 2) < 1e-9);
});

test("dragging backwards plays backwards", () => {
  const velocity = scrubVelocity(drag(-.016));
  assert.ok(velocity < 0);
  assert.ok(Math.abs(scrubRate(velocity) + 1) < 1e-9);
});

test("holding the platter still is silent, not a drone", () => {
  const held = Array.from({ length: 6 }, (_, index) => ({ time: 100, at: index * .016 }));
  assert.equal(scrubRate(scrubVelocity(held)), 0);
  assert.equal(scrubRate(SCRUB_STILL_RATE / 2), 0);
  assert.equal(scrubRate(-SCRUB_STILL_RATE / 2), 0);
});

test("a thrown platter is clamped instead of screeching", () => {
  assert.equal(scrubRate(400), SCRUB_MAX_RATE);
  assert.equal(scrubRate(-400), -SCRUB_MAX_RATE);
});

test("velocity follows the hand, not the whole gesture", () => {
  // Fast for a while, then slowed right down: the rate must report the slow
  // hand now, otherwise the pitch lags behind what the DJ is doing.
  const samples = [
    ...Array.from({ length: 10 }, (_, index) => ({ time: 100 + index * .05, at: index * .016 })),
  ];
  const slowStart = samples[samples.length - 1];
  for (let index = 1; index <= 5; index += 1) {
    samples.push({ time: slowStart.time + index * .002, at: slowStart.at + index * .016 });
  }
  const velocity = scrubVelocity(samples);
  assert.ok(velocity < .3, `expected the recent slow hand to win, got ${velocity}`);
});

test("pointer jitter inside one frame never becomes infinite pitch", () => {
  assert.equal(scrubVelocity([{ time: 10, at: 5 }, { time: 12, at: 5 }]), 0);
  assert.equal(scrubVelocity([{ time: 10, at: 5 }]), 0);
  assert.equal(scrubVelocity([]), 0);
  assert.equal(scrubVelocity([{ time: Number.NaN, at: 1 }, { time: 3, at: 2 }]), 0);
});

test("release eases back to the deck's own tempo, or to silence", () => {
  const playing = scrubRelease({ wasPlaying: true, deckTempoRate: 1.042 });
  assert.equal(playing.targetRate, 1.042);
  assert.equal(playing.resumes, true);
  assert.ok(playing.rampSeconds > 0);
  const stopped = scrubRelease({ wasPlaying: false, deckTempoRate: 1.042 });
  assert.equal(stopped.targetRate, 0);
  assert.equal(stopped.resumes, false);
  assert.equal(scrubRelease({ wasPlaying: true, deckTempoRate: 0 }).targetRate, 1);
});

test("scrub audio never reaches the crowd", () => {
  const cueing = scrubRouting({ deckCue: true, headphoneMonitor: true });
  assert.deepEqual(cueing, { toCue: true, toMaster: false, reason: "cue-only" });
  for (const state of [{ deckCue: false, headphoneMonitor: true }, { deckCue: true, headphoneMonitor: false }, { deckCue: false, headphoneMonitor: false }]) {
    const routing = scrubRouting(state);
    assert.equal(routing.toMaster, false);
    assert.equal(routing.toCue, false);
  }
});

test("the sound reads from exactly the time under the pointer", () => {
  const command = scrubCommand({ pointerTime: 137.913, velocity: 1, duration: 400 });
  assert.equal(command.position, 137.913);
  assert.equal(command.rate, 1);
});

test("running off either end of the record is silent", () => {
  assert.equal(scrubCommand({ pointerTime: 0, velocity: -1, duration: 400 }).rate, 0);
  assert.equal(scrubCommand({ pointerTime: 400, velocity: 1, duration: 400 }).rate, 0);
  // Dragging back into the record from the edge still sounds.
  assert.equal(scrubCommand({ pointerTime: 0, velocity: 1, duration: 400 }).rate, 1);
  assert.equal(scrubCommand({ pointerTime: 400, velocity: -1, duration: 400 }).rate, -1);
});

test("the position is clamped into the track and never NaN", () => {
  assert.equal(scrubCommand({ pointerTime: -12, velocity: 1, duration: 400 }).position, 0);
  assert.equal(scrubCommand({ pointerTime: 900, velocity: 1, duration: 400 }).position, 400);
  assert.equal(scrubCommand({ pointerTime: Number.NaN, velocity: Number.NaN, duration: 400 }).position, 0);
  assert.equal(scrubCommand({ pointerTime: Number.NaN, velocity: Number.NaN, duration: 400 }).rate, 0);
});

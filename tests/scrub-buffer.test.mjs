import assert from "node:assert/strict";
import test from "node:test";
import { SCRUB_TARGET_SAMPLE_RATE, toScrubSamples } from "../lib/scrub-buffer.ts";

test("stereo is folded to mono, because the platter feeds one monitor bus", () => {
  const left = new Float32Array([1, 1, 0, 0]);
  const right = new Float32Array([0, 0, 1, 1]);
  // No decimation at the target rate, so the mean of the two channels survives.
  const { samples } = toScrubSamples([left, right], SCRUB_TARGET_SAMPLE_RATE);
  assert.equal(samples.length, 4);
  for (const value of samples) assert.ok(Math.abs(value / 32767 - .5) < .001, `${value} is not the mean`);
});

test("decimation averages what it collapses rather than picking one", () => {
  // Picking would alias everything above the new Nyquist back into the band —
  // on a drum track that is the hats returning as a whistle. A full-scale
  // alternating signal is exactly what a picker would get wrong: it would come
  // back as DC at +1 or -1, where averaging correctly cancels it.
  const alternating = new Float32Array(64);
  for (let index = 0; index < alternating.length; index += 1) alternating[index] = index % 2 ? 1 : -1;
  const { samples, sampleRate } = toScrubSamples([alternating], SCRUB_TARGET_SAMPLE_RATE * 2);
  assert.equal(samples.length, 32);
  assert.equal(sampleRate, SCRUB_TARGET_SAMPLE_RATE);
  for (const value of samples) assert.equal(value, 0, "a picked sample would have come back full scale");
});

test("a hot master clamps instead of wrapping", () => {
  // Past ±1 the quantisation would wrap, and a wrap is a click on the loudest
  // part of the tune.
  const hot = new Float32Array([1.4, -1.4, .5]);
  const { samples } = toScrubSamples([hot], SCRUB_TARGET_SAMPLE_RATE);
  assert.equal(samples[0], 32767);
  assert.equal(samples[1], -32767);
  assert.ok(samples[2] > 0 && samples[2] < 32767);
});

test("the decimation factor is whole, so the rate it reports is the rate it produced", () => {
  // 48k against a 22.05k target is a factor of 2, giving 24k — not 22.05k. The
  // worklet reads at whatever rate is reported, so reporting the target rather
  // than the real one would pitch the whole platter by 9%.
  const source = new Float32Array(96);
  const { samples, sampleRate } = toScrubSamples([source], 48_000);
  assert.equal(sampleRate, 24_000);
  assert.equal(samples.length, 48);
  // A rate already below the target is left alone rather than upsampled.
  assert.equal(toScrubSamples([source], 16_000).sampleRate, 16_000);
});

test("nothing to convert is an empty buffer, not a crash", () => {
  assert.equal(toScrubSamples([], 44_100).samples.length, 0);
  assert.equal(toScrubSamples([new Float32Array(0)], 44_100).sampleRate, 0);
  assert.equal(toScrubSamples([new Float32Array(8)], 0).sampleRate, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionPreviewSnapTime, transitionPreviewGridBeats } from '../lib/transition-preview.ts';

const input = {
  duration: 500, enabled: true, overrideArmed: false,
  window: { start: 100.137, end: 153.357 }, windowBeats: 128,
  analysisBeats: Array.from({ length: 1250 }, (_, i) => ({ time: i * .4 })),
};

test('all preview snap targets follow the visible confirmed grid, including its runway', () => {
  const lines = transitionPreviewGridBeats({ ...input.window, beats: 128, from: 96, to: 158 });
  for (const line of lines) {
    for (const offset of [-.13, 0, .13]) {
      const time = transitionPreviewSnapTime({ ...input, time: line.time + offset });
      assert.ok(Math.abs(time - line.time) < 1e-10);
    }
  }
});

test('snap off and grid override retain the chosen point without rewriting analysis or windows', () => {
  const before = structuredClone(input);
  for (const flags of [{ enabled: false }, { overrideArmed: true }]) {
    assert.equal(transitionPreviewSnapTime({ ...input, ...flags, time: 101.234 }), 101.234);
  }
  assert.deepEqual(input, before);
});

test('unmarked previews snap to local analysed beats rather than a synthetic global tempo', () => {
  const unmarked = { ...input, window: { start: null, end: null }, analysisBeats: [{time: 0}, {time: .4}, {time: .9}, {time: 1.5}] };
  assert.equal(transitionPreviewSnapTime({ ...unmarked, time: 1.27 }), 1.5);
  assert.equal(transitionPreviewSnapTime({ ...unmarked, time: .74 }), .9);
  assert.equal(transitionPreviewSnapTime({ ...unmarked, analysisBeats: [], time: 7.13 }), 7.13);
});

test('snapping near track boundaries picks an in-range grid beat', () => {
  const short = { ...input, duration: 2, window: { start: .1, end: 1.7 }, windowBeats: 4 };
  for (const time of [-1, 0, .02]) assert.ok(Math.abs(transitionPreviewSnapTime({ ...short, time }) - .1) < 1e-10);
  for (const time of [1.99, 2, 20]) assert.ok(Math.abs(transitionPreviewSnapTime({ ...short, time }) - 1.7) < 1e-10);
});

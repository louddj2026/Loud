import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTransitionPreviewWindow } from '../lib/transition-preview.ts';
const grid = Array.from({ length: 600 }, (_, i) => ({ time: i * .5, attackTime: i * .5 + .03 }));
test('middle sets half the selected beats on each side and remains anchored when resized', () => {
  for (const windowBeats of [32, 64, 96, 128, 160, 192, 224, 256]) {
    const r = deriveTransitionPreviewWindow({ beats: grid, anchorEdge: 'middle', anchorTime: 150, windowBeats, startPrefersAttack: true });
    assert.equal(r.ok, true);
    assert.equal(r.window.start, 150 - windowBeats * .25);
    assert.equal(r.window.end, 150 + windowBeats * .25);
    assert.equal(r.anchorTime, 150);
    assert.equal(r.landedOnAttack, false);
  }
});
test('middle keeps an unsnapped mark and supports an odd count', () => {
  const r = deriveTransitionPreviewWindow({ beats: grid, anchorEdge: 'middle', anchorTime: 150.123, windowBeats: 33 });
  assert.equal(r.ok, true);
  assert.equal(r.window.start, 141.873);
  assert.equal(r.window.end, 158.373);
  assert.equal(r.anchorTime, 150.123);
});
test('middle walks the local beat grid through tempo changes', () => {
  const changing = Array.from({ length: 300 }, (_, i) => ({time: i <= 150 ? i * .4 : 60 + (i - 150) * .6}));
  const r = deriveTransitionPreviewWindow({ beats: changing, anchorEdge: 'middle', anchorTime: 60, windowBeats: 64 });
  assert.equal(r.ok, true);
  assert.equal(r.window.start, changing[118].time);
  assert.equal(r.window.end, changing[182].time);
  assert.equal(r.anchorTime, 60);
});
test('middle rejects a window that cannot fit on both sides', () => {
  for (const anchorTime of [1, 298]) {
    assert.equal(deriveTransitionPreviewWindow({ beats: grid, anchorEdge: 'middle', anchorTime, windowBeats: 128 }).ok, false);
  }
});

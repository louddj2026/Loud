import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMixSeekPoint, seekAndPlayPreviewPair } from '../lib/preview-paired-seek.ts';

const windows = { outgoing: { start: 300, end: 364 }, incoming: { start: 50, end: 130 }, beats: 128, snap: true };
test('clicks on either waveform map to the same mix beat despite unequal source spans', () => {
  for (const beat of [0, 1, 32, 64, 127, 128]) {
    const expected = { outgoingTime: 300 + beat / 2, incomingTime: 50 + beat * .625, beat };
    assert.deepEqual(previewMixSeekPoint({ ...windows, role: 'outgoing', time: expected.outgoingTime }), expected);
    assert.deepEqual(previewMixSeekPoint({ ...windows, role: 'incoming', time: expected.incomingTime }), expected);
  }
});
test('forward, backward and endpoint jumps preserve both windows and use one snap decision', () => {
  const before = structuredClone(windows);
  for (const beat of [96, 12, 70, 0, 128, 33]) {
    const mapped = previewMixSeekPoint({ ...windows, role: 'incoming', time: 50 + (beat + .1) * .625 });
    assert.equal(mapped.beat, beat);
    assert.equal((mapped.outgoingTime - 300) / 64, (mapped.incomingTime - 50) / 80);
  }
  assert.deepEqual(windows, before);
});
test('free placement stays exact; points outside the overlap clamp to its common endpoints', () => {
  assert.deepEqual(previewMixSeekPoint({ ...windows, role: 'outgoing', time: 312.125, snap: false }), { outgoingTime: 312.125, incomingTime: 65.15625, beat: 24.25 });
  assert.equal(previewMixSeekPoint({ ...windows, role: 'incoming', time: 0 }).beat, 0);
  assert.equal(previewMixSeekPoint({ ...windows, role: 'outgoing', time: 999 }).beat, 128);
  assert.equal(previewMixSeekPoint({ ...windows, outgoing: { start: null, end: null }, role: 'outgoing', time: 310 }), null);
});

class Player extends EventTarget {
  position = 0; seeking = false; readyState = 4; starts = 0; pauses = 0; playbackRate = 1;
  get currentTime() { return this.position; }
  set currentTime(value) { this.position = value; this.seeking = true; }
  land() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  play() { this.starts++; return Promise.resolve(); }
  pause() { this.pauses++; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('neither player starts until both seeks settle, then both play calls are issued together', async () => {
  const outgoing = new Player(), incoming = new Player(); incoming.playbackRate = 1.25;
  let resolveOutgoing;
  outgoing.play = () => { outgoing.starts++; return new Promise(resolve => { resolveOutgoing = resolve; }); };
  const result = seekAndPlayPreviewPair({ outgoing, incoming, outgoingTime: 332, incomingTime: 90, isCurrent: () => true });
  outgoing.land(); await tick(); assert.equal(outgoing.starts + incoming.starts, 0);
  incoming.land(); await tick(); assert.equal(outgoing.starts, 1); assert.equal(incoming.starts, 1);
  resolveOutgoing(); assert.equal(await result, true);
  assert.equal(incoming.playbackRate, 1.25);
});
test('a cancelled seek cannot restart either private player after a later click or close', async () => {
  const outgoing = new Player(), incoming = new Player(); let current = true;
  const result = seekAndPlayPreviewPair({ outgoing, incoming, outgoingTime: 332, incomingTime: 90, isCurrent: () => current });
  current = false; outgoing.land(); incoming.land();
  assert.equal(await result, false); assert.equal(outgoing.starts + incoming.starts, 0);
});
test('a failed paired start pauses both private players instead of leaving one playing alone', async () => {
  const outgoing = new Player(), incoming = new Player(); incoming.play = () => Promise.reject(new Error('decoder failed'));
  const result = seekAndPlayPreviewPair({ outgoing, incoming, outgoingTime: 332, incomingTime: 90, isCurrent: () => true });
  outgoing.land(); incoming.land();
  await assert.rejects(result, /decoder failed/);
  assert.equal(outgoing.pauses, 1); assert.equal(incoming.pauses, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  FOCUS_WAVE_BUFFER_VIEWPORTS,
  FOCUS_WAVE_DRAG_GAIN,
  FOCUS_WAVE_DRAG_REBASE_FRACTION,
  FOCUS_WAVE_DRAG_THRESHOLD_PX,
  FOCUS_WAVE_GLIDE_MAX_WINDOWS_PER_SECOND,
  FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX,
  FOCUS_WAVE_REBASE_FRACTION,
  focusWaveDragThresholdPx,
  focusWaveDragTime,
  focusWaveGlideStep,
  focusWaveShouldRebase,
  focusWaveThrowLimit,
  focusWaveThrowVelocity,
} from "../lib/waveform-gesture.ts";

const drag = (clientX, engaged = false) => focusWaveDragTime({
  anchorX: 500,
  clientX,
  anchorTime: 40,
  elementWidth: 1000,
  windowSeconds: 16,
  duration: 180,
  engaged,
});

test("focused waveform ignores hand jitter before drag engagement", () => {
  assert.deepEqual(drag(500 + FOCUS_WAVE_DRAG_THRESHOLD_PX - 1), { engaged: false, time: 40 });
  assert.deepEqual(drag(500 - FOCUS_WAVE_DRAG_THRESHOLD_PX + 1), { engaged: false, time: 40 });
});

test("focused waveform starts moving smoothly after the drag threshold", () => {
  const right = drag(515);
  const left = drag(485);
  assert.equal(right.engaged, true);
  assert.equal(left.engaged, true);
  // From zero at the threshold, not with a jump — and multiplied by the gain,
  // which is what buys travel across a tune without repeated drags.
  const expectedMovement = (15 - FOCUS_WAVE_DRAG_THRESHOLD_PX) * FOCUS_WAVE_DRAG_GAIN / 1000 * 16;
  assert.equal(right.time, 40 - expectedMovement);
  assert.equal(left.time, 40 + expectedMovement);
});

test("the drag mapping is absolute, so a hand that comes back brings the wave back", () => {
  // Gain multiplies distance from the anchor, never accumulated per move. An
  // accumulating drag with gain drifts, and the wave never returns to where the
  // gesture started however carefully the hand retraces it.
  assert.equal(drag(500, true).time, 40);
  const out = drag(620, true).time;
  assert.equal(drag(500, true).time, 40, "returning to the anchor did not return the time");
  assert.notEqual(out, 40);
  // Equal further pushes give equal further travel — proportional beyond the
  // dead patch, which is subtracted once so the drag starts from zero.
  const perPixel = FOCUS_WAVE_DRAG_GAIN / 1000 * 16;
  const near = 40 - drag(560, true).time;
  const far = 40 - drag(620, true).time;
  assert.ok(Math.abs(near - (60 - FOCUS_WAVE_DRAG_THRESHOLD_PX) * perPixel) < 1e-9);
  assert.ok(Math.abs(far - near - 60 * perPixel) < 1e-9, "travel is not proportional to distance");
});

test("a finger gets a dead patch a mouse does not", () => {
  assert.equal(focusWaveDragThresholdPx("touch"), FOCUS_WAVE_DRAG_THRESHOLD_PX);
  assert.equal(focusWaveDragThresholdPx("mouse"), FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX);
  assert.equal(focusWaveDragThresholdPx("pen"), FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX);
  assert.ok(FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX < FOCUS_WAVE_DRAG_THRESHOLD_PX);
});

test("a throw is the last flick of the hand, not the whole drag", () => {
  const now = 10_000;
  // Swept a long way, then held still for the last 90ms before lifting. That is
  // an instruction to stay put, and averaging the sweep in would throw it anyway.
  const held = focusWaveThrowVelocity([
    { time: 0, at: now - 400 },
    { time: 30, at: now - 100 },
    { time: 30.001, at: now - 50 },
    { time: 30.001, at: now },
  ]);
  assert.ok(Math.abs(held) < .1, `a hand held still threw at ${held} s/s`);
  // Flicked at the end: 2 seconds of track in the last 50ms is 40 s/s.
  const flicked = focusWaveThrowVelocity([
    { time: 0, at: now - 400 },
    { time: 0, at: now - 50 },
    { time: 2, at: now },
  ]);
  assert.ok(Math.abs(flicked - 40) < 1e-9, `flick read as ${flicked} s/s`);
  // Degenerate input is no throw rather than an infinite one.
  assert.equal(focusWaveThrowVelocity([]), 0);
  assert.equal(focusWaveThrowVelocity([{ time: 5, at: now }]), 0);
  assert.equal(focusWaveThrowVelocity([{ time: 5, at: now }, { time: 9, at: now }]), 0);
});

test("a glide settles, and lands in the same place at any frame rate", () => {
  const windowSeconds = 16;
  const coast = (frameMs) => {
    let velocity = 20, travelled = 0;
    for (let step = 0; step < 4000; step += 1) {
      const stepped = focusWaveGlideStep(velocity, frameMs, windowSeconds);
      velocity = stepped.velocity;
      travelled += stepped.delta;
      if (!stepped.moving) break;
    }
    return travelled;
  };
  // A dropped frame must not change where the wave comes to rest.
  const fast = coast(1000 / 60);
  const slow = coast(1000 / 30);
  assert.ok(Math.abs(fast - slow) / fast < .01, `60Hz travelled ${fast}, 30Hz ${slow}`);
  // And it does stop, rather than creeping on at a hundredth of a second.
  assert.equal(focusWaveGlideStep(.0001, 16, windowSeconds).moving, false);
  assert.equal(focusWaveGlideStep(20, 0, windowSeconds).delta, 0);
  assert.equal(focusWaveGlideStep(Number.NaN, 16, windowSeconds).velocity, 0);
});

test("a throw is capped at something recoverable, in screenfuls not seconds", () => {
  assert.equal(focusWaveThrowLimit(16), 16 * FOCUS_WAVE_GLIDE_MAX_WINDOWS_PER_SECOND);
  // In screenfuls so it means the same at every zoom: the widest and closest
  // windows differ by 30×, and a seconds-based cap would mean something
  // different at each.
  assert.ok(focusWaveThrowLimit(64) > focusWaveThrowLimit(2));
});

test("a drag re-anchors far less often than playback, and still inside the buffer", () => {
  // Each re-anchor re-renders the whole surface. At the playback fraction that
  // is four hitches per screenful under a moving finger.
  assert.ok(FOCUS_WAVE_DRAG_REBASE_FRACTION > FOCUS_WAVE_REBASE_FRACTION);
  // The hard ceiling: the buffer is one viewport either side and half a viewport
  // is visible, so the drawn range runs out at 0.5. Past that the wave goes blank.
  assert.ok(
    FOCUS_WAVE_DRAG_REBASE_FRACTION < FOCUS_WAVE_BUFFER_VIEWPORTS - .5,
    `${FOCUS_WAVE_DRAG_REBASE_FRACTION} would drag past the drawn range`,
  );
  assert.equal(focusWaveShouldRebase(40, 40 + 16 * .3, 16, FOCUS_WAVE_DRAG_REBASE_FRACTION), false);
  assert.equal(focusWaveShouldRebase(40, 40 + 16 * .45, 16, FOCUS_WAVE_DRAG_REBASE_FRACTION), true);
  // Playback keeps the tighter fraction, which is what centres the playhead.
  assert.equal(focusWaveShouldRebase(40, 40 + 16 * .3, 16), true);
});

test("focused waveform picks up after only a small intentional movement", () => {
  assert.equal(FOCUS_WAVE_DRAG_THRESHOLD_PX, 3);
  assert.equal(drag(504).engaged, true);
  assert.equal(drag(496).engaged, true);
});

test("an engaged drag remains gripped when the pointer returns near its anchor", () => {
  assert.deepEqual(drag(502, true), { engaged: true, time: 40 });
});

test("focused waveform drag stays inside the track", () => {
  assert.equal(drag(50_000, true).time, 0);
  assert.equal(drag(-50_000, true).time, 180);
});

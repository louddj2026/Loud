import assert from "node:assert/strict";
import test from "node:test";
import {
  waveViewGeometry,
  waveViewRange,
  waveViewScreenX,
  waveViewShouldRebase,
  waveViewSpan,
  waveViewTimeAtScreenX,
  waveViewTransform,
  waveViewX,
} from "../lib/wave-view.ts";

const ZOOMS = [2, 4, 8, 16, 32, 64];
const WIDTHS = [640, 1000, 1440];

// Every element class a scrolling surface draws. They must all be positioned by
// the same call, so this list exists to prove they cannot diverge.
const ELEMENT_TIMES = {
  waveChunkStart: 131.237,
  beatLine: 134.959,
  downbeat: 135.349,
  cueMarker: 136.52,
  windowMarkerX: 135.0,
  windowMarkerZ: 162.27,
  verificationBlockEdge: 140.113,
};

test("every element class resolves through one identical mapping", () => {
  for (const width of WIDTHS) {
    for (const windowSeconds of ZOOMS) {
      const geometry = waveViewGeometry({ width, windowSeconds, anchorTime: 133.3 });
      const viewTime = 135.117;
      for (const [name, time] of Object.entries(ELEMENT_TIMES)) {
        // Local coordinate plus the group transform must equal the direct
        // screen mapping. If any element ever used its own formula this fails.
        const transform = waveViewTransform(geometry, viewTime);
        const offset = Number(transform.match(/translate\((-?[\d.]+) 0\)/)[1]);
        const composed = waveViewX(geometry, time) + offset;
        const direct = waveViewScreenX(geometry, viewTime, time);
        assert.ok(Math.abs(composed - direct) < .01, `${name} diverged at ${width}px / ${windowSeconds}s: ${composed} vs ${direct}`);
      }
    }
  }
});

test("child geometry never depends on the playhead clock", () => {
  const geometry = waveViewGeometry({ width: 1000, windowSeconds: 8, anchorTime: 100 });
  // The same child, queried while the view time runs away, must not move in
  // local space — only the single group transform may respond to the clock.
  const first = waveViewX(geometry, 104.25);
  for (const viewTime of [100, 101.5, 103, 107.75, 120]) {
    void viewTime;
    assert.equal(waveViewX(geometry, 104.25), first);
  }
});

test("rebasing the anchor is a visual no-op for every element", () => {
  const viewTime = 212.481;
  const base = waveViewGeometry({ width: 1000, windowSeconds: 4, anchorTime: 210 });
  for (const anchorTime of [180, 205.5, 212.481, 219, 260]) {
    const rebased = waveViewGeometry({ width: 1000, windowSeconds: 4, anchorTime });
    for (const time of Object.values(ELEMENT_TIMES).map((value) => value + 77)) {
      const before = waveViewScreenX(base, viewTime, time);
      const after = waveViewScreenX(rebased, viewTime, time);
      assert.ok(Math.abs(before - after) < 1e-9, `rebase to ${anchorTime} moved ${time}: ${before} vs ${after}`);
    }
  }
});

test("the view time is always exactly under the stationary playhead", () => {
  for (const windowSeconds of ZOOMS) {
    const geometry = waveViewGeometry({ width: 1000, windowSeconds, anchorTime: 50 });
    for (const viewTime of [0, 12.5, 50, 137.913, 400]) {
      assert.ok(Math.abs(waveViewScreenX(geometry, viewTime, viewTime) - geometry.playheadX) < 1e-9);
    }
  }
});

test("what the user grabs is what the user saw", () => {
  for (const windowSeconds of ZOOMS) {
    const geometry = waveViewGeometry({ width: 1000, windowSeconds, anchorTime: 90 });
    const viewTime = 94.317;
    for (const time of Object.values(ELEMENT_TIMES)) {
      const screenX = waveViewScreenX(geometry, viewTime, time);
      const resolved = waveViewTimeAtScreenX(geometry, viewTime, screenX);
      assert.ok(Math.abs(resolved - time) < 1e-9, `round trip lost ${time} at ${windowSeconds}s: ${resolved}`);
    }
  }
});

test("durations scale with the same pixels-per-second as positions", () => {
  const geometry = waveViewGeometry({ width: 1000, windowSeconds: 16, anchorTime: 0 });
  assert.equal(waveViewSpan(geometry, 1), geometry.pixelsPerSecond);
  const start = 40;
  const end = 43.5;
  assert.ok(Math.abs((waveViewX(geometry, end) - waveViewX(geometry, start)) - waveViewSpan(geometry, end - start)) < 1e-9);
});

test("a half-beat offset is a visible number of pixels, so drift cannot hide", () => {
  // 147.3 BPM: one beat is .4073 s. At a 2 s focus on a 1000 px surface half a
  // beat is over 100 px — the scale the DJ was reading a mis-cue at.
  const geometry = waveViewGeometry({ width: 1000, windowSeconds: 2, anchorTime: 0 });
  const halfBeat = 60 / 147.3 / 2;
  assert.ok(waveViewSpan(geometry, halfBeat) > 100);
});

test("the render range covers the surface plus its overscan", () => {
  const geometry = waveViewGeometry({ width: 1000, windowSeconds: 8, anchorTime: 300 });
  const range = waveViewRange(geometry, 304, 2);
  assert.ok(Math.abs(range.start - (304 - 4 - 2)) < 1e-9);
  assert.ok(Math.abs(range.end - (304 + 4 + 2)) < 1e-9);
  assert.ok(waveViewScreenX(geometry, 304, range.start) < 0);
  assert.ok(waveViewScreenX(geometry, 304, range.end) > geometry.width);
});

test("rebase triggers on distance from the anchor, never on the wall clock", () => {
  const geometry = waveViewGeometry({ width: 1000, windowSeconds: 8, anchorTime: 100 });
  assert.equal(waveViewShouldRebase(geometry, 101.9, 2), false);
  assert.equal(waveViewShouldRebase(geometry, 102.1, 2), true);
  assert.equal(waveViewShouldRebase(geometry, 97.9, 2), true);
  assert.equal(waveViewShouldRebase(geometry, Number.NaN, 2), false);
});

test("degenerate inputs cannot produce NaN geometry", () => {
  const geometry = waveViewGeometry({ width: 0, windowSeconds: 0, anchorTime: Number.NaN });
  assert.ok(Number.isFinite(geometry.pixelsPerSecond));
  assert.ok(Number.isFinite(waveViewX(geometry, Number.NaN)));
  assert.ok(Number.isFinite(waveViewScreenX(geometry, Number.NaN, Number.NaN)));
  assert.ok(Number.isFinite(waveViewTimeAtScreenX(geometry, Number.NaN, Number.NaN)));
  assert.match(waveViewTransform(geometry, Number.NaN), /^translate\(-?[\d.]+ 0\)$/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LOOP_GRID_SNAP_THRESHOLD_BEATS, loopWindowAtGrid, movedLoopWindow } from "../lib/loop-grid.ts";

const beats = Array.from({ length: 20 }, (_, index) => ({ time: index * 0.5 }));

test("loops longer than half a beat snap their start and end to the grid", () => {
  assert.equal(LOOP_GRID_SNAP_THRESHOLD_BEATS, 0.5);
  assert.deepEqual(loopWindowAtGrid(beats, 1.41, 4, 10), { start: 1.5, end: 3.5, snapped: true });
});

test("half-beat and shorter loops keep their exact free-running start", () => {
  assert.deepEqual(loopWindowAtGrid(beats, 1.41, 0.5, 10), { start: 1.41, end: 1.66, snapped: false });
  assert.deepEqual(loopWindowAtGrid(beats, 1.41, 0.25, 10), { start: 1.41, end: 1.535, snapped: false });
});

test("moving a normal loop stays grid-aligned while moving a micro-loop stays free", () => {
  assert.deepEqual(movedLoopWindow(beats, 1.5, 3.5, 4, 1, 10), { start: 3.5, end: 5.5, snapped: true });
  assert.deepEqual(movedLoopWindow(beats, 1.41, 1.66, 0.5, 1, 10), { start: 1.66, end: 1.91, snapped: false });
});

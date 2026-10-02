import assert from "node:assert/strict";
import test from "node:test";
import {
  createBoothLayoutProfile,
  magneticBoothTarget,
  moveBoothModule,
  nearestOpenBoothPlacement,
  placementsOverlap,
  sanitiseBoothLayoutProfile,
  setBoothControlVisible,
  setBoothModuleVisible,
  visibleBoothControls,
} from "../lib/booth-layout.ts";

const controls = [
  { id: "escape", label: "Exit editor", kind: "button", moduleId: "tools", required: true },
  { id: "midi", label: "MIDI setup", kind: "button", moduleId: "tools" },
  { id: "play", label: "Play", kind: "button", moduleId: "transport" },
  { id: "cue", label: "Cue", kind: "button", moduleId: "transport" },
];
const modules = [
  {
    id: "tools",
    label: "Tools",
    controlIds: ["escape", "midi"],
    defaultPlacement: { moduleId: "tools", zone: "header", column: 0, row: 0, span: 4, rowSpan: 1 },
    allowedZones: ["header"],
  },
  {
    id: "transport",
    label: "Transport",
    controlIds: ["play", "cue"],
    defaultPlacement: { moduleId: "transport", zone: "header", column: 4, row: 0, span: 4, rowSpan: 1 },
    allowedZones: ["header", "performance"],
    minSpan: 2,
    maxSpan: 6,
  },
];

test("magnetic target snaps a dragged module to the nearest grid cell", () => {
  assert.deepEqual(magneticBoothTarget({
    moduleId: "transport",
    zone: "performance",
    pointerX: 455,
    pointerY: 138,
    bounds: { left: 100, top: 50, width: 1200, rowHeight: 80 },
    span: 3,
    grabOffsetX: 50,
    grabOffsetY: 20,
  }), {
    moduleId: "transport",
    zone: "performance",
    column: 3,
    row: 1,
    span: 3,
    rowSpan: 1,
  });
});

test("drop collision resolves to the nearest open magnetic space", () => {
  const occupied = [
    { moduleId: "one", zone: "performance", column: 0, row: 0, span: 4, rowSpan: 1 },
    { moduleId: "two", zone: "performance", column: 4, row: 0, span: 4, rowSpan: 1 },
  ];
  const dropped = nearestOpenBoothPlacement(
    { moduleId: "moving", zone: "performance", column: 2, row: 0, span: 4, rowSpan: 1 },
    occupied,
  );
  assert.equal(occupied.some((placement) => placementsOverlap(dropped, placement)), false);
  assert.deepEqual(dropped, {
    moduleId: "moving",
    zone: "performance",
    column: 2,
    row: 1,
    span: 4,
    rowSpan: 1,
  });
});

test("linked modules move as one placement while controls remain individually hideable", () => {
  let profile = createBoothLayoutProfile("mine", "My booth", modules, controls);
  profile = moveBoothModule(profile, "transport", {
    zone: "performance",
    column: 2,
    row: 3,
    span: 5,
    rowSpan: 1,
  }, modules);
  assert.deepEqual(profile.placements.find((placement) => placement.moduleId === "transport"), {
    moduleId: "transport",
    zone: "performance",
    column: 2,
    row: 3,
    span: 5,
    rowSpan: 1,
  });
  profile = setBoothControlVisible(profile, "cue", false, controls);
  assert.deepEqual(visibleBoothControls(profile, "transport", modules), ["play"]);
});

test("a whole module can be hidden, but required escape controls stay available", () => {
  let profile = createBoothLayoutProfile("mine", "My booth", modules, controls);
  profile = setBoothModuleVisible(profile, "tools", false, modules, controls);
  assert.equal(profile.hiddenControlIds.includes("midi"), true);
  assert.equal(profile.hiddenControlIds.includes("escape"), false);
});

test("saved profiles discard stale ids, disallowed zones and collisions", () => {
  const repaired = sanitiseBoothLayoutProfile({
    id: "saved",
    name: "Saved",
    placements: [
      { moduleId: "tools", zone: "wrong", column: 90, row: -4, span: 99, rowSpan: 0 },
      { moduleId: "transport", zone: "header", column: 0, row: 0, span: 4, rowSpan: 1 },
      { moduleId: "removed", zone: "header", column: 0, row: 0, span: 4, rowSpan: 1 },
    ],
    hiddenControlIds: ["escape", "cue", "removed-control"],
    lockedModuleIds: ["transport", "removed"],
  }, modules, controls);
  assert.equal(repaired.hiddenControlIds.includes("escape"), false);
  assert.deepEqual(repaired.hiddenControlIds, ["cue"]);
  assert.deepEqual(repaired.lockedModuleIds, ["transport"]);
  assert.equal(placementsOverlap(repaired.placements[0], repaired.placements[1]), false);
  assert.equal(repaired.placements[0].zone, "header");
});

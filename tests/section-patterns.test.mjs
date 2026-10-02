import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SECTION_LABELS,
  mergeSectionSpans,
  normaliseSectionLabel,
  sectionPattern,
  sectionPatternId,
  sectionPatterns,
  visibleSectionSpans,
} from "../lib/section-patterns.ts";
import { primeSectionLabels, resetSectionLabels, sectionSpansFor } from "../lib/section-labels.ts";

test("every label a section can carry has a pattern on both surfaces", () => {
  for (const surface of ["overview", "focus"]) {
    for (const label of [...SECTION_LABELS, "unknown"]) {
      const pattern = sectionPattern(label, surface);
      assert.ok(pattern.shapes.length > 0, `${surface}/${label} has no shapes`);
      assert.ok(pattern.tile > 0, `${surface}/${label} has no tile size`);
      assert.ok(pattern.opacity > 0 && pattern.opacity <= 1);
    }
  }
});

test("the two surfaces never draw the same label the same way", () => {
  // The point of the pair is that a glance cannot mistake one surface for the
  // other, so an identical tile and shape set on any label is a bug.
  for (const label of SECTION_LABELS) {
    const overview = sectionPattern(label, "overview");
    const focus = sectionPattern(label, "focus");
    assert.notDeepEqual(
      { tile: overview.tile, shapes: overview.shapes },
      { tile: focus.tile, shapes: focus.shapes },
      `${label} is drawn identically on both surfaces`,
    );
  }
});

test("a chorus is the densest fill and a start the sparsest, on both surfaces", () => {
  for (const surface of ["overview", "focus"]) {
    const chorus = sectionPattern("chorus", surface);
    for (const quieter of ["start", "end", "intro", "break", "unknown"]) {
      assert.ok(
        chorus.opacity > sectionPattern(quieter, surface).opacity,
        `${surface}: ${quieter} should not be denser than a chorus`,
      );
    }
  }
});

test("an unrecognised label falls back rather than throwing", () => {
  assert.equal(normaliseSectionLabel("CHORUS"), "chorus");
  assert.equal(normaliseSectionLabel("  verse "), "verse");
  assert.equal(normaliseSectionLabel("breakdown"), "unknown");
  assert.equal(normaliseSectionLabel(null), "unknown");
  assert.equal(sectionPattern("nonsense", "focus").label, "unknown");
});

test("pattern ids are unique per scope, surface and label", () => {
  const ids = new Set();
  for (const scope of ["deck", "preview"]) {
    for (const surface of ["overview", "focus"]) {
      for (const label of [...SECTION_LABELS, "unknown"]) {
        const id = sectionPatternId(scope, surface, label);
        assert.ok(!ids.has(id), `duplicate pattern id ${id}`);
        ids.add(id);
      }
    }
  }
  assert.equal(ids.size, 2 * 2 * (SECTION_LABELS.length + 1));
  assert.equal(sectionPatterns("overview").length, SECTION_LABELS.length + 1);
});

test("neighbouring segments with one label merge into a single span", () => {
  // All-In-One emits uniform 32-beat segments, so a four-phrase chorus arrives as
  // four of them. Unmerged, each is its own clip path and fill on every frame.
  const merged = mergeSectionSpans([
    { start: 0, end: 13.3, label: "intro" },
    { start: 13.3, end: 26.6, label: "chorus" },
    { start: 26.6, end: 39.9, label: "chorus" },
    { start: 39.9, end: 53.2, label: "chorus" },
    { start: 53.2, end: 66.5, label: "verse" },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 13.3, label: "intro" },
    { start: 13.3, end: 53.2, label: "chorus" },
    { start: 53.2, end: 66.5, label: "verse" },
  ]);
});

test("merging tolerates the rounding the stored file carries, but not a real gap", () => {
  const rounded = mergeSectionSpans([
    { start: 0, end: 13.33, label: "chorus" },
    { start: 13.35, end: 26.6, label: "chorus" },
  ]);
  assert.equal(rounded.length, 1, "a 20 ms rounding seam is not a section change");

  const genuine = mergeSectionSpans([
    { start: 0, end: 13.3, label: "chorus" },
    { start: 20, end: 26.6, label: "chorus" },
  ]);
  assert.equal(genuine.length, 2, "a 6.7 second hole is not a rounding seam");
});

test("merging discards spans that carry no time", () => {
  assert.deepEqual(mergeSectionSpans([
    { start: 5, end: 5, label: "chorus" },
    { start: 9, end: 4, label: "verse" },
    { start: Number.NaN, end: 3, label: "verse" },
  ]), []);
});

test("only the visible part of a span is drawn, and it is clipped to the view", () => {
  const spans = [
    { start: 0, end: 30, label: "intro" },
    { start: 30, end: 60, label: "chorus" },
    { start: 60, end: 90, label: "verse" },
  ];
  assert.deepEqual(visibleSectionSpans(spans, 25, 65), [
    { start: 25, end: 30, label: "intro" },
    { start: 30, end: 60, label: "chorus" },
    { start: 60, end: 65, label: "verse" },
  ]);
  assert.deepEqual(visibleSectionSpans(spans, 95, 120), []);
  assert.deepEqual(visibleSectionSpans(spans, 40, 40), []);
});

test("the shipped label file parses, and carries only labels the patterns know", () => {
  const file = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "public", "section-labels.json"), "utf8"));
  const ids = Object.keys(file.tracks ?? {});
  assert.ok(ids.length > 0, "no tracks in the shipped label file");
  const known = new Set([...SECTION_LABELS, "unknown"]);
  for (const [id, spans] of Object.entries(file.tracks)) {
    for (const [start, end, label] of spans) {
      assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start, `${id} has a span with no duration`);
      assert.ok(known.has(label), `${id} carries an unknown label ${label}`);
    }
  }
});

test("a track with no labels draws no patterns rather than failing", () => {
  resetSectionLabels();
  assert.deepEqual(sectionSpansFor("upload-anything"), [], "nothing is drawn before the file loads");

  primeSectionLabels({ tracks: { "upload-a": [[0, 10, "chorus"], [10, 20, "chorus"]] } });
  assert.deepEqual(sectionSpansFor("upload-a"), [{ start: 0, end: 20, label: "chorus" }]);
  assert.deepEqual(sectionSpansFor("upload-missing"), []);
  assert.deepEqual(sectionSpansFor(null), []);
  resetSectionLabels();
});

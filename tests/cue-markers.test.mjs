import assert from "node:assert/strict";
import test from "node:test";
import { buildIntroOutroCues } from "../lib/cue-markers.ts";

const prediction = (time, samples = 12) => ({
  time,
  samples,
  score: 0.82,
  kickScore: 0.91,
  waveformScore: 0.73,
});

const manual = (time) => ({
  time,
  crowdSuggestedTime: time - 0.1,
  nearestCrowdBeatTime: time,
  cueVsCrowdMs: 100,
  cueVsGridMs: 0,
  selectedAt: "2026-07-23T00:00:00.000Z",
});

test("predicted intro and outro evidence stays hidden from the booth waveforms", () => {
  const cues = buildIntroOutroCues({
    duration: 300,
    teaching: {
      predictedEntryCue: prediction(32),
      predictedCue: prediction(260),
    },
  });

  assert.deepEqual(cues, []);
});

test("manual intro and outro remain visible while predictions stay hidden", () => {
  const cues = buildIntroOutroCues({
    duration: 300,
    teaching: {
      preferredEntryCue: manual(48),
      predictedEntryCue: prediction(32),
      preferredCue: manual(240),
      predictedCue: prediction(260),
    },
  });

  assert.deepEqual(cues.map(({ id, label, time }) => ({ id, label, time })), [
    { id: "entry-drop", label: "YOUR INTRO", time: 48 },
    { id: "exit-handoff", label: "YOUR OUTRO", time: 240 },
  ]);
});

test("clamps markers to the real track and sorts them", () => {
  const cues = buildIntroOutroCues({
    duration: 180,
    teaching: {
      preferredEntryCue: manual(999),
      preferredCue: manual(-4),
    },
  });

  assert.deepEqual(cues.map((cue) => cue.time), [0, 180]);
});

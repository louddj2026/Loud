import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOTH_EQ_FILTERS,
  BOOTH_LIMITER,
  BOOTH_PRESERVE_PITCH,
  DEFAULT_DECK_CUE,
  DEFAULT_HEADPHONE_MONITOR,
  HEADPHONE_CUE_BUS_GAIN,
  BOOTH_OUTPUT_LATENCY_HINT,
  SAFE_LOADED_DECK_VOLUME,
  boothRoutingLevels,
  boothVisualTrackTime,
} from "../lib/booth-audio.ts";
import { readFile } from "node:fs/promises";
import {
  BOOTH_METER_FFT_SIZE,
  BOOTH_VISUAL_FRAME_MS,
  BOOTH_WAVEFORM_SAMPLE_LIMIT,
} from "../app/dj/dj-ui-config.ts";

const boothSource = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");

test("the booth requests balanced audio buffering on a busy machine", () => {
  assert.equal(BOOTH_OUTPUT_LATENCY_HINT, "balanced");
});

test("tempo changes use temporary vinyl-style pitch on live and private players", () => {
  assert.equal(BOOTH_PRESERVE_PITCH, false);
  assert.match(boothSource, /function applyBoothPitchMode\(audio: HTMLMediaElement \| null \| undefined\)/);
  assert.match(boothSource, /applyBoothPitchMode\(mainAudio\);\s*applyBoothPitchMode\(shadowAudio\);/);
  assert.match(boothSource, /const prepareTransitionPreviewAudio[\s\S]*?applyBoothPitchMode\(audio\);/);
  assert.match(boothSource, /const setDeckRate[\s\S]*?applyBoothPitchMode\(mediaRef\.current\);/);
  assert.doesNotMatch(boothSource, /originalPreservesPitch/);
});

test("the booth keeps visual analysis within its low-CPU budget", () => {
  assert.equal(BOOTH_VISUAL_FRAME_MS, 66);
  assert.equal(BOOTH_WAVEFORM_SAMPLE_LIMIT, 720);
  assert.equal(BOOTH_METER_FFT_SIZE, 512);
});

test("pressing play keeps the focused waveform on the source position", () => {
  const cuePosition = 64.5;
  assert.equal(boothVisualTrackTime(cuePosition, 180), cuePosition);
  assert.equal(boothVisualTrackTime(-.1, 180), 0);
  assert.equal(boothVisualTrackTime(180.1, 180), 180);
});

test("the booth master catches summed peaks before output", () => {
  assert.deepEqual(BOOTH_LIMITER, {
    threshold: -3,
    knee: 0,
    ratio: 20,
    attack: .003,
    release: .2,
  });
});

test("three-band EQ gives low and high more ownership than the narrowed mid", () => {
  assert.deepEqual(BOOTH_EQ_FILTERS, {
    lowFrequencyHz: 250,
    midFrequencyHz: 1100,
    midQ: 1.15,
    highFrequencyHz: 3500,
  });
  assert.ok(BOOTH_EQ_FILTERS.midQ > 1, "mid band should not spill broadly into bass and treble");
});

test("a newly loaded deck starts with its channel fader fully down", () => {
  assert.equal(SAFE_LOADED_DECK_VOLUME, 0);
});

test("booth startup enables every deck cue and the cue-only monitor", () => {
  assert.equal(DEFAULT_DECK_CUE, true);
  assert.equal(DEFAULT_HEADPHONE_MONITOR, true);
});

test("headphone cue is pre-fader and audible when the channel fader is down", () => {
  const routing = boothRoutingLevels({
    A: { track: { id: "a" }, volume: .85, cue: false },
    B: { track: { id: "b" }, volume: 0, cue: true },
    C: { track: null, volume: 0, cue: false },
  }, ["A", "B", "C"], true);
  assert.equal(routing.A.mainGate, 0);
  assert.equal(routing.A.cueGain, 0);
  assert.equal(routing.B.channelGain, 0);
  assert.equal(routing.B.cueGain, HEADPHONE_CUE_BUS_GAIN);
});

test("multiple headphone cues share safe pre-fader headroom", () => {
  const routing = boothRoutingLevels({
    A: { track: { id: "a" }, volume: 0, cue: true },
    B: { track: { id: "b" }, volume: 0, cue: true },
  }, ["A", "B"], true);
  assert.equal(routing.A.cueGain, HEADPHONE_CUE_BUS_GAIN / 2);
  assert.equal(routing.B.cueGain, HEADPHONE_CUE_BUS_GAIN / 2);
});

test("preview monitor solos private preview by closing every local booth path", () => {
  const routing = boothRoutingLevels({
    A: { track: { id: "a" }, volume: .85, cue: true },
    B: { track: { id: "b" }, volume: .7, cue: true },
  }, ["A", "B"], true, true);
  assert.equal(routing.A.mainGate, 0);
  assert.equal(routing.B.mainGate, 0);
  assert.equal(routing.A.cueGain, 0);
  assert.equal(routing.B.cueGain, 0);
  assert.ok(routing.A.channelGain > 0, "remote/master channel level must remain available");
  assert.ok(routing.B.channelGain > 0, "remote/master channel level must remain available");
});

test("a handed-over tune never inherits silence from the outgoing fader", async () => {
  const { DEFAULT_HANDOFF_VOLUME, SAFE_LOADED_DECK_VOLUME, liveHandoffVolume } = await import("../lib/booth-audio.ts");
  // Decks load at the zero safety fader on purpose, so the handoff must supply
  // a level rather than copying one that is silent.
  assert.equal(SAFE_LOADED_DECK_VOLUME, 0);
  assert.equal(liveHandoffVolume(0), DEFAULT_HANDOFF_VOLUME);
  assert.equal(liveHandoffVolume(.0005), DEFAULT_HANDOFF_VOLUME);
  assert.equal(liveHandoffVolume(Number.NaN), DEFAULT_HANDOFF_VOLUME);
  // A real playing level is matched, so the incoming arrives at the same
  // loudness the room is already hearing.
  assert.equal(liveHandoffVolume(.7), .7);
  assert.equal(liveHandoffVolume(1), 1);
  assert.equal(liveHandoffVolume(1.4), 1);
});

test("master level sits on the booth surface, beside the cue monitor", async () => {
  const { readFile } = await import("node:fs/promises");
  const booth = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const tools = booth.match(/<nav className="workflow-booth-tools"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.ok(tools, "booth tools nav should be readable");
  // It is the one fader reaching the booth, the headphone bus and the crowd
  // stream, so it belongs on the surface rather than inside the settings panel.
  assert.match(tools, /className="booth-master-volume"/);
  assert.ok(
    tools.indexOf("booth-master-volume") < tools.indexOf("header-cue-monitor"),
    "master level should sit to the left of the cue monitor",
  );
  // Same setter as the settings panel, so the two readouts can never disagree.
  assert.equal(booth.match(/void setMaster\(Number\(event\.currentTarget\.value\)\)/g)?.length, 2);
  // The eight controls share a grid; wider labels may receive wider columns.
  assert.match(css, /\.workflow-booth-tools\{\n  display:grid;\n  grid-template-columns:/);
  assert.equal((tools.match(/<(button|a|label)\b/g) ?? []).length, 8);
  // A label is not a button, so it has to be named in the chassis rules or it
  // renders unstyled against its siblings in every skin.
  assert.equal(css.match(/\.workflow-booth-tools>label/g)?.length, 3);
});

// ---------------------------------------------------------------------------
// Fixed per-deck gain (DJ, 29 Aug 2026): no dynamic headroom, no shared sum.
test("a deck's gain depends on its own fader and nothing else", async () => {
  const { BOOTH_CHANNEL_GAIN } = await import("../lib/booth-audio.ts");
  const deck = (volume, track = "tune") => ({ track, volume, cue: false });
  const ids = ["A", "B", "C"];
  const solo = boothRoutingLevels({ A: deck(.85), B: deck(0), C: deck(0, null) }, ids, false);
  const crowded = boothRoutingLevels({ A: deck(.85), B: deck(1), C: deck(1) }, ids, false);
  // Raising every other fader to full must not move deck A by a single bit.
  assert.equal(solo.A.channelGain, crowded.A.channelGain);
  assert.equal(solo.A.channelGain, .85 * BOOTH_CHANNEL_GAIN);
  // The ceiling is low enough that a standard two-deck overlap cannot clip:
  // two handoff-level faders sum below unity before the limiter.
  assert.ok(2 * .85 * BOOTH_CHANNEL_GAIN < 1);
  // An empty deck still contributes nothing.
  assert.equal(solo.C.channelGain, 0);
});

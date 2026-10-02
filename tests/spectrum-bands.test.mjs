import assert from "node:assert/strict";
import test from "node:test";
import { spectrumBands } from "../lib/spectrum-bands.ts";

test("silence produces no lights", () => {
  assert.ok(spectrumBands(new Float32Array(2048).fill(-Infinity), 48000, 4096).every(level => level === 0));
});

test("measured bass lights the left and measured treble lights the right", () => {
  for (const [hz, side] of [[70, "left"], [9000, "right"]]) {
    const bins = new Float32Array(2048).fill(-Infinity);
    bins[Math.round(hz / (48000 / 4096))] = -20;
    const bands = spectrumBands(bins, 48000, 4096);
    const strongest = bands.indexOf(Math.max(...bands));
    assert.ok(Math.max(...bands) > 0);
    assert.ok(side === "left" ? strongest < 16 : strongest >= 32);
  }
});

test("a quieter measured signal produces shorter bars", () => {
  const loud = spectrumBands(new Float32Array(2048).fill(-20), 44100, 4096);
  const quiet = spectrumBands(new Float32Array(2048).fill(-60), 44100, 4096);
  assert.ok(loud.every((level, index) => level > quiet[index]));
});

 test("lamp brightness increases with real measured level and height, and silence is dark", async () => {
  const { spectrumLampAlpha } = await import("../lib/spectrum-bands.ts");
  assert.equal(spectrumLampAlpha(0, 1), 0);
  assert.ok(spectrumLampAlpha(.8, .7) > spectrumLampAlpha(.4, .7));
  assert.ok(spectrumLampAlpha(.8, .7) > spectrumLampAlpha(.8, .2));
  assert.ok(spectrumLampAlpha(1, 1) <= 1);
});

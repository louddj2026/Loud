import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { effectiveBeatPeriodSeconds, effectiveDeckBpm, tempoRateForTargetBpm } from "../lib/booth-audio.ts";

const boothSource = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");

test("142 BPM sped to 143 and 144 BPM slowed to 143 run at the same tempo", () => {
  const targetBpm = 143;
  const slowerSourceBpm = 142;
  const fasterSourceBpm = 144;
  const fasterRate = tempoRateForTargetBpm(slowerSourceBpm, targetBpm);
  const slowerRate = tempoRateForTargetBpm(fasterSourceBpm, targetBpm);

  assert.equal(effectiveDeckBpm(slowerSourceBpm, fasterRate).toFixed(3), "143.000");
  assert.equal(effectiveDeckBpm(fasterSourceBpm, slowerRate).toFixed(3), "143.000");
  assert.ok(Math.abs(effectiveDeckBpm(slowerSourceBpm, fasterRate) - effectiveDeckBpm(fasterSourceBpm, slowerRate)) < 1e-12);
  assert.ok(Math.abs(effectiveBeatPeriodSeconds(slowerSourceBpm, fasterRate) - effectiveBeatPeriodSeconds(fasterSourceBpm, slowerRate)) < 1e-12);
});

test("the booth BPM display and tempo sync use the same effective-tempo calculation", () => {
  assert.match(boothSource, /effectiveDeckBpm\(loopTempoBpm\(deck\) \?\? resolvedBpmAt\(analysis, playheadTime\), effectiveTempoRate\)\.toFixed\(3\)/);
  assert.match(boothSource, /tempoRateForTargetBpm\(targetBpm, effectiveDeckBpm\(referenceBpm, reference\.tempoRate\)\)/);
});

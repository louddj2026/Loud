import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { probeAudioDuration } from "../lib/audio-duration.ts";

function silentWave(seconds, sampleRate = 8000) {
  const dataBytes = Math.ceil(seconds * sampleRate);
  const wave = Buffer.alloc(44 + dataBytes, 128);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(36 + dataBytes, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(dataBytes, 40);
  return wave;
}

test("the crate duration probe distinguishes a full track from an unknown duration", async (context) => {
  const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const executable = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "crowd-audio-duration-"));
  context.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  const fixture = path.join(fixtureDirectory, "full-track.wav");
  await writeFile(fixture, silentWave(301));
  const duration = await probeAudioDuration(executable, fixture);
  assert.ok(duration !== null && duration > 300, `expected a full track duration, received ${duration}`);
  const unknown = await probeAudioDuration(executable, path.join(root, "public", "audio", "missing-file.wav"));
  assert.equal(unknown, null);
});

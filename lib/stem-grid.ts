/**
 * A beat grid fitted to a tune's percussion alone.
 *
 * The stored grid is not consulted, on purpose. The question this answers is
 * whether percussion by itself places a grid the DJ hears as clean, and using the
 * existing grid as a starting point — or even as a tie-breaker — would make the
 * answer meaningless. Whatever comes out of here stands on the drums.
 *
 * How it avoids the trap that has caught every previous attempt: on this material
 * the bassline sits in the same 45-180 Hz band as the kick, so no filter applied
 * to the full mix can separate them — measured over 9,505 onsets, every
 * discriminating range overlapped. HTDemucs removes the bass from the file
 * entirely, so the low band of a drums stem contains the kick and nothing else.
 * No new detector is needed: `analyzeBeatGrid` already fits tempo and phase from
 * a low band, and it has simply never been given a signal where that band is
 * unambiguous.
 *
 * The separation is safe to transfer back to the full tune: drums and no_drums
 * sum to the original with a cross-correlation lag of exactly 0 samples, verified
 * by measurement. The sum is not amplitude-faithful, so only timing is taken.
 *
 * Stems are temporary. The Python side deletes them; nothing here keeps audio.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toWslPath } from "./section-analysis.ts";

/** The rate the library analyses at, so the grid is fitted the same way. */
export const STEM_GRID_SAMPLE_RATE = 4000;
const SEPARATION_TIMEOUT_MS = 8 * 60 * 1000;

export type StemGrid = {
  /** Beat times in seconds, from percussion alone. */
  beats: number[];
  downbeats: number[];
  bpm: number;
  /** Confidence the analyser itself reports, carried but not acted on. */
  verifiedCoverage: number;
  /** How the separation lined up, for provenance. */
  stemFrames: number;
  stemSeconds: number;
  computedAt: string;
};

/**
 * Runs the drums separation and returns the stem as a WAV path inside a scratch
 * directory the caller must remove.
 */
export function separateDrums(audioFile: string, scriptDirectory: string): Promise<{ scratch: string; wav: string; frames: number; seconds: number }> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-stemgrid-"));
  const wav = path.join(scratch, "drums.wav");
  const result = path.join(scratch, "result.json");
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", [
      "-d", "Ubuntu-24.04", "-u", "root", "--",
      "/opt/allin1/bin/python",
      toWslPath(path.join(scriptDirectory, "drums-stem.py")),
      toWslPath(audioFile),
      toWslPath(wav),
      toWslPath(result),
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-1500); });
    const timer = setTimeout(() => { child.kill(); fail(new Error("drum separation timed out")); }, SEPARATION_TIMEOUT_MS);
    const fail = (error: Error) => {
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
      reject(error);
    };
    child.on("error", (error) => fail(new Error(`could not start WSL: ${error.message}`)));
    child.on("close", () => {
      clearTimeout(timer);
      let payload: { ok?: boolean; error?: string; frames?: number; seconds?: number };
      try {
        payload = JSON.parse(readFileSync(result, "utf8"));
      } catch {
        return fail(new Error(stderr.split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? "separation produced no result"));
      }
      if (!payload.ok) return fail(new Error(payload.error ?? "separation failed"));
      resolve({ scratch, wav, frames: payload.frames ?? 0, seconds: payload.seconds ?? 0 });
    });
  });
}

/** Compact form for storage: a first beat and the gaps, like the library's own grid. */
export function packStemGrid(grid: StemGrid) {
  const timesMs = grid.beats.map((time) => Math.round(time * 1000));
  return {
    firstBeatMs: timesMs[0] ?? 0,
    deltaMs: timesMs.slice(1).map((time, index) => time - timesMs[index]),
    downbeats: grid.downbeats,
    bpmX100: Math.round(grid.bpm * 100),
    verifiedCoveragePermille: Math.round(grid.verifiedCoverage * 1000),
    stemFrames: grid.stemFrames,
    stemSeconds: grid.stemSeconds,
    computedAt: grid.computedAt,
  };
}

export type PackedStemGrid = ReturnType<typeof packStemGrid>;

export function unpackStemGrid(packed: PackedStemGrid): number[] {
  const beats = [packed.firstBeatMs / 1000];
  for (const delta of packed.deltaMs) beats.push(beats.at(-1)! + delta / 1000);
  return beats;
}

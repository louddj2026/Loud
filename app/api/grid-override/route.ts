import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "../../../lib/music-library";
import { rememberCompactDjRecord } from "../../../lib/dj-library";
import { extractTemplate, matchTemplate, rephaseBeats, GRID_OVERRIDE_STAMP_RADIUS_SECONDS } from "../../../lib/grid-override";

/**
 * POST { trackId, anchorSeconds } — the GRID OVERRIDE confirm (DJ, 29 Aug
 * 2026). His ear placed the playhead on a kick with snap disarmed; this
 * re-phases the stored grid rigidly onto that point, fingerprints the
 * transient there, re-stamps every kick in the tune from matches to that
 * fingerprint, and persists. Runs ONLY from the explicit press.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");
const SAMPLE_RATE = 8000;

function decodeMono(file: string) {
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const raw = Buffer.concat(chunks);
      if (code !== 0 && !raw.length) return reject(new Error(`ffmpeg exited ${code}`));
      resolve(new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2));
    });
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { trackId?: string; anchorSeconds?: number };
  const trackId = body.trackId ?? "";
  const anchorSeconds = Number(body.anchorSeconds);
  if (!/^[a-z0-9_-]+$/i.test(trackId) || !Number.isFinite(anchorSeconds) || anchorSeconds < 0) {
    return Response.json({ error: "trackId and anchorSeconds are required" }, { status: 400 });
  }
  const track = await getMusicTrack(trackId);
  if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
  const analysisFile = path.join(analysisDirectory, `${trackId}.json`);
  const analysis = await readFile(analysisFile, "utf8").then(JSON.parse).catch(() => null) as Record<string, unknown> | null;
  if (!analysis || !Array.isArray(analysis.beats)) return Response.json({ error: "No analysed grid for that track" }, { status: 404 });

  const mixPath = await resolveMusicPath(track);
  const samples = await decodeMono(mixPath);
  if (anchorSeconds * SAMPLE_RATE >= samples.length) return Response.json({ error: "Anchor is past the end of the tune" }, { status: 400 });

  // 1. Rigid re-phase: the nearest beat lands exactly on the ear's anchor.
  const beats = analysis.beats as Array<Record<string, unknown> & { time: number; nominalTime?: number }>;
  const { shiftSeconds, anchorBeatIndex } = rephaseBeats(beats, anchorSeconds);
  for (const beat of beats) if (typeof beat.nominalTime === "number") beat.nominalTime += shiftSeconds;
  for (const key of ["tempoSections", "phrases"] as const) {
    const spans = analysis[key];
    if (Array.isArray(spans)) for (const span of spans as Array<{ start?: number; end?: number }>) {
      if (typeof span.start === "number") span.start += shiftSeconds;
      if (typeof span.end === "number") span.end += shiftSeconds;
    }
  }
  const verification = analysis.verification as { blocks?: Array<{ start?: number; end?: number }> } | undefined;
  if (verification?.blocks) for (const block of verification.blocks) {
    if (typeof block.start === "number") block.start += shiftSeconds;
    if (typeof block.end === "number") block.end += shiftSeconds;
  }

  // 2. The anchor's transient is the tune's kick fingerprint; find its kin.
  const template = extractTemplate(samples, SAMPLE_RATE, anchorSeconds);
  const matches = matchTemplate(samples, SAMPLE_RATE, template);

  // 3. Re-stamp every beat from the matches — the ear's signature, nothing else.
  let stamped = 0;
  for (const beat of beats) {
    const nearby = matches
      .filter((match) => Math.abs(match.time - beat.time) <= GRID_OVERRIDE_STAMP_RADIUS_SECONDS)
      .sort((left, right) => right.score - left.score)[0];
    if (nearby) {
      stamped += 1;
      const residualMs = (nearby.time - beat.time) * 1000;
      beat.attackTime = nearby.time;
      beat.residualMs = residualMs;
      beat.strength = nearby.score;
      beat.confidence = Math.max(0.3, Math.min(1, nearby.score));
      beat.kickStatus = Math.abs(residualMs) <= 22 ? "aligned" : residualMs > 0 ? "early" : "late";
    } else {
      beat.attackTime = null;
      beat.residualMs = null;
      beat.kickStatus = "inferred";
      beat.confidence = 0.08;
    }
  }

  analysis.gridOverride = {
    anchorSeconds,
    anchorBeatIndex,
    shiftMs: Math.round(shiftSeconds * 1000 * 10) / 10,
    matches: matches.length,
    stamped,
    appliedAt: new Date().toISOString(),
  };
  analysis.generatedAt = new Date().toISOString();

  await writeFile(analysisFile, JSON.stringify(analysis));
  const fileStat = await stat(mixPath).catch(() => null);
  await rememberCompactDjRecord(track, analysis as never, fileStat ? { size: fileStat.size, modifiedMs: Math.round(fileStat.mtimeMs) } : null);

  return Response.json({
    ok: true,
    shiftMs: (analysis.gridOverride as { shiftMs: number }).shiftMs,
    matches: matches.length,
    stamped,
    beats: beats.length,
  });
}

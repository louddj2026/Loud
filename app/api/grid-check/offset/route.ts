import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "../../../../lib/music-library";
import { gridOffsetEvidence } from "../../../../lib/grid-offset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ffmpegExecutable = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const analysisDirectory = path.join(process.cwd(), "public", "analysis");
/** Decoding is per-request, so only the audition window is read. */
const SAMPLE_RATE = 22050;

function decodeWindow(file: string, start: number, seconds: number) {
  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn(ffmpegExecutable, [
      "-hide_banner", "-loglevel", "error",
      "-ss", start.toFixed(3), "-t", seconds.toFixed(3),
      "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-",
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0 && !chunks.length) return reject(new Error(`ffmpeg exited ${code}`));
      const raw = Buffer.concat(chunks);
      resolve(new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2));
    });
  });
}

/** Sub-band onsets: the kick's fundamental, below where basslines carry. */
function lowOnsets(samples: Float32Array) {
  const a = Math.exp(-2 * Math.PI * 90 / SAMPLE_RATE);
  let first = 0, second = 0;
  const sub = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    first += (1 - a) * (samples[index] - first);
    second += (1 - a) * (first - second);
    sub[index] = second;
  }
  const window = Math.round(.015 * SAMPLE_RATE);
  const envelope = new Float32Array(sub.length);
  let energy = 0;
  for (let index = 0; index < sub.length; index += 1) {
    energy += sub[index] ** 2;
    if (index >= window) energy -= sub[index - window] ** 2;
    envelope[index] = Math.sqrt(energy / window);
  }
  const onsets: Array<{ time: number; strength: number }> = [];
  let previous = 0;
  for (let index = 1; index < envelope.length - 1; index += 1) {
    const rise = Math.max(0, envelope[index] - envelope[index - 1]);
    const next = Math.max(0, envelope[index + 1] - envelope[index]);
    if (rise <= previous || rise < next) { previous = rise; continue; }
    onsets.push({ time: index / SAMPLE_RATE, strength: rise });
    previous = rise;
  }
  if (!onsets.length) return onsets;
  // Keep the meaningful rises; a floor of noise peaks would flatten the scoring.
  const strengths = onsets.map((onset) => onset.strength).sort((left, right) => right - left);
  const floor = strengths[Math.min(strengths.length - 1, Math.floor(strengths.length * .25))] * .35;
  return onsets.filter((onset) => onset.strength >= floor);
}

async function readBeats(id: string) {
  const names = await readdir(analysisDirectory).catch(() => [] as string[]);
  const bare = id.replace(/^upload-/, "");
  for (const candidate of [`${id}.json`, `${bare}.json`]) {
    if (!names.includes(candidate)) continue;
    const raw = await readFile(path.join(analysisDirectory, candidate), "utf8").catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const analysis = (parsed.analysis ?? parsed) as { beats?: Array<{ time: number }> };
      return analysis.beats?.map((beat) => beat.time) ?? null;
    } catch { return null; }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId") ?? "";
  const start = Number(url.searchParams.get("start") ?? "0");
  const seconds = Number(url.searchParams.get("seconds") ?? "0");
  if (!trackId || !Number.isFinite(start) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
    return Response.json({ error: "trackId, start and seconds are required" }, { status: 400 });
  }
  try {
    const track = await getMusicTrack(trackId);
    if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
    const beats = await readBeats(trackId);
    if (!beats?.length) return Response.json({ error: "No analysed grid for that track" }, { status: 404 });
    const inWindow = beats.filter((time) => time >= start && time <= start + seconds);
    if (inWindow.length < 8) return Response.json({ error: "Not enough grid in that window" }, { status: 400 });
    const samples = await decodeWindow(await resolveMusicPath(track), start, seconds);
    const onsets = lowOnsets(samples);
    const gaps = inWindow.slice(1).map((time, index) => time - inWindow[index]).sort((left, right) => left - right);
    const period = gaps[gaps.length >> 1] || .414;
    // Onset times are relative to the decoded window; put the grid on the same
    // clock so a shift means the same thing to both.
    const evidence = gridOffsetEvidence(onsets, inWindow.map((time) => time - start), period);
    if (!evidence) return Response.json({ error: "No usable low end in that window" }, { status: 422 });
    return Response.json({ ...evidence, onsets: onsets.length, beats: inWindow.length, periodMs: period * 1000 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not measure that grid" }, { status: 500 });
  }
}

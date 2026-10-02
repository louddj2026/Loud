import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "../../../lib/music-library";

/**
 * POST { trackId, blockStart, blockEnd, copies } — render the REPLICATE
 * splice (DJ, 30 Aug 2026).
 *
 * The preview's copy/paste is only honest if the audio is really edited, so
 * this renders a WAV of the tune with the selected block pasted in again
 * after itself: head up to the block end, the block once per copy, then the
 * tail. ffmpeg decodes the same file the analyser decoded, so the variant's
 * clock and the spliced analysis agree by construction — the same one-clock
 * rule the stems live under. WAV output also means the private player's
 * seeks are sample-true, the same reason the .seekable sidecars exist.
 *
 * Renders are cached by (track, block, copies) under public/analysis/, so a
 * re-open or a draft restore is a cache hit, not a second render.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const replicateDirectory = path.join(process.cwd(), "public", "analysis", "replicate");
const MAX_BLOCK_SECONDS = 120;
const MAX_COPIES = 16;

function renderSplice(input: string, output: string, blockStart: number, blockEnd: number, copies: number) {
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const segments = [
    `[0:a]atrim=end=${blockEnd.toFixed(6)},asetpts=PTS-STARTPTS[head]`,
    ...Array.from({ length: copies }, (_, index) => `[0:a]atrim=start=${blockStart.toFixed(6)}:end=${blockEnd.toFixed(6)},asetpts=PTS-STARTPTS[copy${index}]`),
    `[0:a]atrim=start=${blockEnd.toFixed(6)},asetpts=PTS-STARTPTS[tail]`,
    `[head]${Array.from({ length: copies }, (_, index) => `[copy${index}]`).join("")}[tail]concat=n=${copies + 2}:v=0:a=1[out]`,
  ].join(";");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-filter_complex", segments,
      "-map", "[out]",
      "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
      output,
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `ffmpeg exited ${code}`));
    });
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { trackId?: string; blockStart?: number; blockEnd?: number; copies?: number };
  const trackId = body.trackId ?? "";
  const blockStart = Number(body.blockStart);
  const blockEnd = Number(body.blockEnd);
  const copies = Number(body.copies);
  if (!/^[a-z0-9_-]+$/i.test(trackId)) return Response.json({ error: "trackId is required" }, { status: 400 });
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockStart < 0 || blockEnd <= blockStart) {
    return Response.json({ error: "The selected block runs backwards" }, { status: 400 });
  }
  if (blockEnd - blockStart > MAX_BLOCK_SECONDS) return Response.json({ error: "That block is longer than a replicate should ever be" }, { status: 400 });
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) return Response.json({ error: "copies must be a small whole number" }, { status: 400 });
  const track = await getMusicTrack(trackId);
  if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });
  const sourcePath = await resolveMusicPath(track);

  const digest = createHash("sha1").update(`${trackId}|${blockStart.toFixed(4)}|${blockEnd.toFixed(4)}|${copies}`).digest("hex").slice(0, 12);
  const fileName = `${trackId}-${digest}.wav`;
  const outputPath = path.join(replicateDirectory, fileName);
  const audio = `/analysis/replicate/${fileName}`;
  const pasteSeconds = copies * (blockEnd - blockStart);

  const cached = await stat(outputPath).catch(() => null);
  if (cached && cached.size > 44) {
    return Response.json({ ok: true, audio, pasteSeconds, cached: true });
  }
  await mkdir(replicateDirectory, { recursive: true });
  try {
    await renderSplice(sourcePath, outputPath, blockStart, blockEnd, copies);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The splice could not be rendered" }, { status: 500 });
  }
  const rendered = await stat(outputPath).catch(() => null);
  if (!rendered || rendered.size <= 44) return Response.json({ error: "The splice rendered empty" }, { status: 500 });
  console.log(`[replicate] ${track.name}: block ${blockStart.toFixed(3)}–${blockEnd.toFixed(3)}s ×${copies} → ${fileName} (${(rendered.size / 1048576).toFixed(1)} MB)`);
  return Response.json({ ok: true, audio, pasteSeconds, cached: false });
}

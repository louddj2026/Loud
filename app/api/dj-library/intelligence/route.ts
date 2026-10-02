import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeBeatGrid } from "../../../../lib/beat-grid";
import {
  readIncompatibleTrackIds,
  readTrackIntelligence,
  readTrackIntelligenceIndex,
  readTrackIntelligenceStats,
  rememberQuickBpmIntelligence,
  rememberTrackIncompatibility,
  rememberTrackUsage,
} from "../../../../lib/dj-library";
import { getMusicTrack, resolveMusicPath } from "../../../../lib/music-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sampleRate = 4000;
const ffmpegExecutable = [
  process.env.FFMPEG_PATH,
  path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

function safeId(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe library-intelligence track ID");
  return id;
}

function decodeQuickMono(file: string, startSeconds: number, durationSeconds: number) {
  return new Promise<Float32Array>((resolve, reject) => {
    if (!ffmpegExecutable) {
      reject(new Error("The bundled audio decoder is unavailable"));
      return;
    }
    const child = spawn(ffmpegExecutable, [
      "-hide_banner", "-loglevel", "error",
      "-threads", "1",
      "-ss", startSeconds.toFixed(3),
      "-i", file,
      "-t", durationSeconds.toFixed(3),
      "-vn", "-ac", "1", "-ar", String(sampleRate),
      "-f", "f32le", "pipe:1",
    ], { windowsHide: true });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `Quick BPM decoder exited ${code}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.byteLength < sampleRate * 4 * 8) {
        reject(new Error("The tune is too short for a reliable quick BPM scan"));
        return;
      }
      const copied = Uint8Array.from(bytes).buffer;
      resolve(new Float32Array(copied, 0, Math.floor(copied.byteLength / 4)));
    });
  });
}

async function scanQuickBpm(id: string) {
  const track = await getMusicTrack(safeId(id));
  if (!track) throw new Error("That tune is not in the music library");
  const existing = await readTrackIntelligence(track.id);
  if (existing?.bpm) return { record: existing, cached: true };
  const sourceFile = await resolveMusicPath(track);
  const availableDuration = Math.max(30, track.duration || 90);
  const windowSeconds = Math.min(90, availableDuration);
  const startSeconds = availableDuration > windowSeconds + 20
    ? Math.min(availableDuration - windowSeconds, availableDuration * .25)
    : 0;
  const samples = await decodeQuickMono(sourceFile, startSeconds, windowSeconds);
  const analysis = analyzeBeatGrid(samples, sampleRate);
  const alternatives = analysis.hypotheses.slice(0, 8).map((hypothesis) => ({
    bpm: hypothesis.bpm,
    probability: hypothesis.probability,
    coverage: hypothesis.coverage,
    metricalRelation: hypothesis.metricalRelation,
  }));
  const record = await rememberQuickBpmIntelligence(track, analysis.selected.bpm, analysis.selected.probability, {
    quickScan: {
      startSeconds,
      durationSeconds: samples.length / sampleRate,
      sampleRate,
      selected: {
        bpm: analysis.selected.bpm,
        probability: analysis.selected.probability,
        coverage: analysis.selected.coverage,
        medianResidualMs: analysis.selected.medianResidualMs,
      },
      alternatives,
    },
  });
  return { record, cached: false };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const against = params.get("against");
    if (against) return Response.json({ trackId: safeId(against), incompatibleTrackIds: await readIncompatibleTrackIds(against) });
    const id = params.get("id");
    if (id) return Response.json({ record: await readTrackIntelligence(safeId(id)), incompatibleTrackIds: await readIncompatibleTrackIds(id) });
    const stats = await readTrackIntelligenceStats();
    const records = params.get("records") === "1" ? await readTrackIntelligenceIndex() : undefined;
    return Response.json({ stats, ...(records ? { records } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Library intelligence could not be read" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    action?: "scan-bpm" | "selected" | "played" | "incompatible";
    id?: string;
    relatedId?: string;
    currentId?: string;
    rejectedId?: string;
    currentBpm?: number;
    rejectedBpm?: number;
    reason?: string;
    context?: unknown;
  };
  try {
    if (body.action === "scan-bpm" && body.id) {
      const result = await scanQuickBpm(body.id);
      return Response.json({ ...result, stats: await readTrackIntelligenceStats() });
    }
    if ((body.action === "selected" || body.action === "played") && body.id) {
      const track = await getMusicTrack(safeId(body.id));
      if (!track) return Response.json({ error: "That tune is not in the music library" }, { status: 404 });
      const record = await rememberTrackUsage(track, body.action, body.relatedId ? safeId(body.relatedId) : null, body.context);
      return Response.json({ record, stats: await readTrackIntelligenceStats() });
    }
    if (body.action === "incompatible" && body.currentId && body.rejectedId) {
      const [currentTrack, rejectedTrack] = await Promise.all([
        getMusicTrack(safeId(body.currentId)),
        getMusicTrack(safeId(body.rejectedId)),
      ]);
      if (!currentTrack || !rejectedTrack) return Response.json({ error: "One of those tunes is not in the music library" }, { status: 404 });
      const incompatibility = await rememberTrackIncompatibility(
        currentTrack,
        rejectedTrack,
        Number.isFinite(body.currentBpm) ? body.currentBpm! : null,
        Number.isFinite(body.rejectedBpm) ? body.rejectedBpm! : null,
        body.reason?.trim() || "Marked incompatible by the user",
        body.context,
      );
      return Response.json({ incompatibility, stats: await readTrackIntelligenceStats() });
    }
    return Response.json({ error: "Choose a library-intelligence action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Library intelligence could not be updated" }, { status: 500 });
  }
}

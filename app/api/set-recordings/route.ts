import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Set recordings, two artefacts per set (DJ, 28 Aug 2026 — Traktor-style):
 *  - <id>.webm            master-bus audio as captured (then WAV+MP3 via ffmpeg)
 *  - <id>.actions.json    timestamped deck actions, enough to replay the mix
 *
 * POST ?id=<id>&kind=audio    body: audio/webm bytes (may be sent in one go on stop)
 * POST ?id=<id>&kind=actions  body: JSON action log
 * GET  ?list=1                every set, newest first, each summarised for browsing
 * GET  ?id=<id>&kind=actions  one action log for replay
 * GET  ?id=<id>&kind=audio&format=mp3|wav|webm  the recorded room audio
 *
 * The summary is derived from the action log itself rather than stored beside
 * it, so sets recorded before the browser existed list just as well as new ones.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recordingsRoot = path.join(process.cwd(), "data", "set-recordings");
const SAFE_ID = /^[a-z0-9_-]+$/i;
/** A log past this is read for its head only — no browser needs the whole thing. */
const MAX_SUMMARY_BYTES = 32 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm" };

type LoggedAction = { t?: unknown; kind?: unknown; trackId?: unknown; data?: { trackName?: unknown } };

/** What the REPLAY INPUTS browser shows for one set: when, how long, which tunes. */
async function summarise(id: string) {
  const file = path.join(recordingsRoot, `${id}.actions.json`);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_SUMMARY_BYTES) return { recordedAt: null, actions: 0, durationMs: 0, tracks: [] as string[] };
  const body = await readFile(file, "utf8").catch(() => null);
  if (body === null) return { recordedAt: null, actions: 0, durationMs: 0, tracks: [] as string[] };
  let parsed: { recordedAt?: unknown; actions?: unknown };
  try { parsed = JSON.parse(body); } catch { return { recordedAt: null, actions: 0, durationMs: 0, tracks: [] as string[] }; }
  const actions: LoggedAction[] = Array.isArray(parsed?.actions) ? parsed.actions : Array.isArray(parsed) ? parsed : [];
  const last = actions[actions.length - 1];
  const tracks: string[] = [];
  for (const action of actions) {
    if (action?.kind !== "load") continue;
    const name = typeof action.data?.trackName === "string" ? action.data.trackName
      : typeof action.trackId === "string" ? action.trackId : null;
    if (name && !tracks.includes(name)) tracks.push(name);
  }
  return {
    recordedAt: typeof parsed?.recordedAt === "string" ? parsed.recordedAt : info.mtime.toISOString(),
    actions: actions.length,
    durationMs: typeof last?.t === "number" ? last.t : 0,
    tracks,
  };
}

async function transcode(webmFile: string, base: string) {
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");
  const jobs: Array<Promise<void>> = [];
  for (const [ext, args] of [
    ["wav", ["-c:a", "pcm_s16le"]],
    ["mp3", ["-c:a", "libmp3lame", "-b:a", "320k"]],
  ] as const) {
    jobs.push(new Promise((resolve) => {
      const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", webmFile, ...args, `${base}.${ext}`], { windowsHide: true });
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    }));
  }
  await Promise.all(jobs);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!SAFE_ID.test(id)) return Response.json({ error: "A safe recording id is required" }, { status: 400 });
  await mkdir(recordingsRoot, { recursive: true });

  if (kind === "actions") {
    const body = await request.text();
    try { JSON.parse(body); } catch { return Response.json({ error: "Action log was not JSON" }, { status: 400 }); }
    await writeFile(path.join(recordingsRoot, `${id}.actions.json`), body);
    return Response.json({ saved: true, id, kind });
  }

  if (kind === "audio") {
    const file = path.join(recordingsRoot, `${id}.webm`);
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) return Response.json({ error: "No audio bytes arrived" }, { status: 400 });
    await new Promise<void>((resolve, reject) => {
      const sink = createWriteStream(file);
      sink.on("error", reject);
      sink.on("finish", () => resolve());
      sink.end(bytes);
    });
    // Transcode in the background; the response never waits on ffmpeg.
    void transcode(file, path.join(recordingsRoot, id));
    return Response.json({ saved: true, id, kind, bytes: bytes.length, transcoding: ["wav", "mp3"] });
  }

  return Response.json({ error: "kind must be audio or actions" }, { status: 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  await mkdir(recordingsRoot, { recursive: true });

  if (url.searchParams.get("list")) {
    const names = await readdir(recordingsRoot);
    const ids = [...new Set(names.map((name) => name.replace(/\.(webm|wav|mp3|actions\.json)$/i, "")))];
    const recordings = await Promise.all(ids.map(async (id) => {
      const artefacts: Record<string, number> = {};
      for (const suffix of ["webm", "wav", "mp3", "actions.json"]) {
        const info = await stat(path.join(recordingsRoot, `${id}.${suffix}`)).catch(() => null);
        if (info?.isFile()) artefacts[suffix] = info.size;
      }
      return { id, artefacts, ...(await summarise(id)) };
    }));
    recordings.sort((a, b) => b.id.localeCompare(a.id));
    return Response.json({ recordings });
  }

  const id = url.searchParams.get("id") ?? "";
  if (!SAFE_ID.test(id)) return Response.json({ error: "A safe recording id is required" }, { status: 400 });
  if (url.searchParams.get("kind") === "actions") {
    const body = await readFile(path.join(recordingsRoot, `${id}.actions.json`), "utf8").catch(() => null);
    if (body === null) return Response.json({ error: "No action log for that id" }, { status: 404 });
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  }
  if (url.searchParams.get("kind") === "audio") {
    const format = (url.searchParams.get("format") ?? "mp3").toLowerCase();
    const type = AUDIO_TYPES[format];
    if (!type) return Response.json({ error: "format must be mp3, wav or webm" }, { status: 400 });
    const bytes = await readFile(path.join(recordingsRoot, `${id}.${format}`)).catch(() => null);
    if (bytes === null) return Response.json({ error: `No ${format} for that set` }, { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": type, "Content-Length": String(bytes.length), "Cache-Control": "no-store" },
    });
  }
  return Response.json({ error: "kind must be actions or audio" }, { status: 400 });
}

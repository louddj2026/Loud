import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getMusicTrack, resolveMusicPath } from "../../../../lib/music-library";
// The sidecar logic lives in lib/playback-clock.ts now, because the file this
// route serves DEFINES the booth's time base — analysis must resolve audio
// through the same function or its numbers are lies in booth coordinates.
// (That happened: see the 16 Aug 2026 stem-clock incident documented there.)
import { seekAccuratePath } from "../../../../lib/playback-clock";
import { kickStemPath } from "../../../../lib/kick-hits-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".ogg": "audio/ogg",
};

function safeAudioStream(file: string, start: number, end: number) {
  const source = createReadStream(file, { start, end });
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk) => {
        source.pause();
        if (finished) return;
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        try {
          controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        } catch {
          finished = true;
          source.destroy();
        }
      });
      source.once("end", () => {
        if (finished) return;
        finished = true;
        controller.close();
      });
      source.once("error", (error) => {
        if (finished) return;
        finished = true;
        controller.error(error);
      });
    },
    pull() {
      if (!finished) source.resume();
    },
    cancel() {
      finished = true;
      source.destroy();
    },
  });
}

async function serve(request: Request, context: { params: Promise<{ id: string }> }, head = false) {
  const { id } = await context.params;
  // ?stem=drums serves the separated drums stem from data/kick-stems. Those
  // files were re-cut onto the booth clock (16 Aug) so every grid, kick map
  // and cue keyed by trackId lands sample-true on the stem as well.
  const wantStem = new URL(request.url).searchParams.get("stem");
  if (wantStem === "drums") {
    const stemFile = kickStemPath(id);
    if (!stemFile) return new Response("Invalid track ID", { status: 400 });
    const stemInfo = await stat(stemFile).catch(() => null);
    if (!stemInfo?.isFile()) return new Response("No drums stem for this track", { status: 404 });
    return serveFile(request, stemFile, stemInfo, head);
  }
  // Library lookup happens only for the full mix. A stem needs nothing but its
  // file: a tune uploaded seconds ago is not in the index yet, and probing it
  // used to 404 and silently drop the deck back to the full tune.
  const track = await getMusicTrack(id);
  if (!track) return new Response("Unknown track", { status: 404 });
  const file = await seekAccuratePath(await resolveMusicPath(track));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response("Elements drive or track unavailable", { status: 404 });
  return serveFile(request, file, info, head);
}

function serveFile(request: Request, file: string, info: { size: number }, head: boolean) {
  const type = contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    start = match[1] ? Number(match[1]) : 0;
    end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    status = 206;
  }
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Length": String(end - start + 1),
    "Content-Type": type,
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  if (head) return new Response(null, { status, headers });
  const body = safeAudioStream(file, start, end);
  return new Response(body, { status, headers });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return serve(request, context); }
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) { return serve(request, context, true); }

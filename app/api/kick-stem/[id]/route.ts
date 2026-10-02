import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { kickPlayablePath } from "../../../../lib/kick-hits-store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a track's drum stem so the grid check can tick against isolated drums.
 *
 * A route rather than a file in `public`, for two reasons: Next registers public
 * assets at build time, so a stem produced afterwards would 404 until the next
 * build; and these are working files that should never be part of a shipped
 * bundle.
 *
 * Range requests are honoured because the audition seeks about a third of the way
 * into the file, and a media element that cannot range-request has to buffer from
 * the start before it can play.
 *
 * The stream is built by hand rather than with `Readable.toWeb`. A media element
 * abandons range requests constantly while seeking, and when the client goes away
 * the web controller closes while the file stream is still pushing — which threw
 * `Invalid state: Controller is already closed` as an UNHANDLED exception and took
 * the whole booth down with it. So this owns the plumbing: it stops reading when the
 * consumer cancels, and it never touches a controller it has already closed.
 */

function fileStream(file: string, start?: number, end?: number) {
  let handle: ReturnType<typeof createReadStream> | null = null;
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      handle = createReadStream(file, start === undefined ? undefined : { start, end });
      handle.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          // The consumer went away between chunks; stop rather than throw.
          closed = true;
          handle?.destroy();
        }
      });
      handle.on("end", () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed by a cancel */ }
      });
      handle.on("error", (error) => {
        if (closed) return;
        closed = true;
        try { controller.error(error); } catch { /* nothing left to tell */ }
      });
    },
    cancel() {
      // The audition seeks away or the dialog closes: release the file at once
      // instead of reading the rest of an 80 MB stem into a dead pipe.
      closed = true;
      handle?.destroy();
    },
  });
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // The EQ'd, gated audition when it exists — the ear should hear what the
  // detector sees, not the whole kit.
  const file = kickPlayablePath(id);
  if (!file) return Response.json({ error: "No drum stem for that track" }, { status: 404 });
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return Response.json({ error: "No drum stem for that track" }, { status: 404 });

  const range = request.headers.get("range");
  const match = range?.match(/bytes=(\d*)-(\d*)/);
  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, max-age=0",
  };

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!(start >= 0) || start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } });
    }
    return new Response(fileStream(file, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  return new Response(fileStream(file), { status: 200, headers: { ...headers, "Content-Length": String(info.size) } });
}

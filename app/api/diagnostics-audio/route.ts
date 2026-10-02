import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DJ, 27 Aug 2026: overlap-triggered bus recordings land here for offline
// headroom analysis (master pre-limiter, master post-limiter, cue). Bounded
// store: the newest 24 files stay, older takes are swept on each upload.
const STORE = () => path.join(process.cwd(), "data", "diagnostics-audio");
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const KEEP_NEWEST = 24;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "multipart form expected" }, { status: 400 });
  const bus = String(form.get("bus") ?? "");
  const startedAt = String(form.get("startedAt") ?? "");
  const audio = form.get("audio");
  if (!/^[a-z0-9-]{1,32}$/.test(bus) || !/^\d{10,16}$/.test(startedAt) || !(audio instanceof File)) {
    return Response.json({ error: "bus, startedAt and audio are required" }, { status: 400 });
  }
  if (audio.size > MAX_UPLOAD_BYTES) return Response.json({ error: "recording too large" }, { status: 413 });
  const store = STORE();
  await mkdir(store, { recursive: true });
  const name = `${startedAt}-${bus}.webm`;
  await writeFile(path.join(store, name), Buffer.from(await audio.arrayBuffer()));
  const entries = (await readdir(store)).filter((file) => file.endsWith(".webm")).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - KEEP_NEWEST))) {
    await rm(path.join(store, stale), { force: true }).catch(() => undefined);
  }
  return Response.json({ saved: name, bytes: audio.size });
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "../../../lib/data-root";
import { readTaughtCues } from "../../../lib/dj-library";
import { getMusicTrack } from "../../../lib/music-library";
import { parseCueReviewRecord, type CueReviewRecord } from "../../../lib/cue-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verdictFile = path.join(durableDataRoot, "cue-review.json");

async function readVerdicts(): Promise<Record<string, CueReviewRecord>> {
  const raw = await readFile(verdictFile, "utf8").catch(() => null);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verdicts: Record<string, CueReviewRecord> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const record = parseCueReviewRecord(value);
      if (record) verdicts[id] = record;
    }
    return verdicts;
  } catch {
    // A corrupt verdict file must not take the review down: an empty set simply
    // means everything is still to be judged, which is the honest default.
    return {};
  }
}

async function writeVerdicts(verdicts: Record<string, CueReviewRecord>) {
  await mkdir(path.dirname(verdictFile), { recursive: true });
  // Write-then-rename: a half-written file here would silently discard an
  // evening of listening.
  const temporary = `${verdictFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(verdicts, null, 2)}\n`, "utf8");
  await rename(temporary, verdictFile);
}

export async function GET() {
  try {
    const [taught, verdicts] = await Promise.all([readTaughtCues(), readVerdicts()]);
    // Teaching moments outlive the tracks they were taught on: a cue survives
    // in the table long after its upload has gone. Reviewing is listening, so a
    // cue whose audio cannot be served is not reviewable — offering it anyway
    // opens the panel on silence and looks like a broken player. Resolved
    // through the same lookup the audio route uses, so the two cannot disagree.
    const playable = new Map<string, boolean>();
    for (const cue of taught) {
      if (playable.has(cue.trackId)) continue;
      playable.set(cue.trackId, Boolean(await getMusicTrack(cue.trackId).catch(() => null)));
    }
    const cues = taught.filter((cue) => playable.get(cue.trackId));
    const missing = taught.length - cues.length;
    const missingTracks = [...new Set(taught.filter((cue) => !playable.get(cue.trackId)).map((cue) => cue.name))];
    return Response.json({ cues, verdicts, missing, missingTracks });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read taught cues" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Expected JSON" }, { status: 400 }); }
  const source = (body ?? {}) as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return Response.json({ error: "A cue id is required" }, { status: 400 });
  const record = parseCueReviewRecord({ verdict: source.verdict, decidedAt: new Date().toISOString() });
  if (!record) return Response.json({ error: "verdict must be keep, drop or unsure" }, { status: 400 });
  try {
    const verdicts = await readVerdicts();
    verdicts[id] = record;
    await writeVerdicts(verdicts);
    return Response.json({ ok: true, id, verdict: record.verdict });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the verdict" }, { status: 500 });
  }
}

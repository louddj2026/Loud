import { access } from "node:fs/promises";
import path from "node:path";
import { trackAnalysisUrl } from "../../../lib/analysis-delivery";
import { hasCompactDjRecord, readCompactDjIndex } from "../../../lib/dj-library";
import { getMusicLibrary, publicTrack, trackAudioUrl } from "../../../lib/music-library";
import { recoverPendingTeachingBatch } from "../../../lib/teaching-batch-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");
async function mapped(id: string) {
  const detailed = await access(path.join(analysisDirectory, `${id}.json`)).then(() => true).catch(() => false);
  return detailed && await hasCompactDjRecord(id);
}

export async function GET(request: Request) {
  await recoverPendingTeachingBatch();
  const library = await getMusicLibrary();
  const external = library.tracks.filter((track) => track.source === "elements");
  const remembered = await readCompactDjIndex();
  const rememberedIds = new Set(remembered.map((track) => track.id));
  const album = new URL(request.url).searchParams.get("album");
  if (!album) {
    const counts = new Map<string, number>();
    for (const track of external) counts.set(track.album, (counts.get(track.album) ?? 0) + 1);
    return Response.json({
      connected: external.length > 0,
      trackCount: external.length,
      rememberedTrackCount: remembered.length,
      rememberedExternalTrackCount: external.filter((track) => rememberedIds.has(track.id)).length,
      albums: [...counts].map(([name, count]) => ({ name, count })).sort((left, right) => left.name.localeCompare(right.name)),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const tracks = external.filter((track) => track.album === album);
  return Response.json({ album, tracks: await Promise.all(tracks.map(async (track) => ({
    ...publicTrack(track),
    mapped: await mapped(track.id),
    remembered: rememberedIds.has(track.id),
    audio: trackAudioUrl(track),
    analysis: trackAnalysisUrl(track.id),
  }))) }, { headers: { "Cache-Control": "no-store" } });
}

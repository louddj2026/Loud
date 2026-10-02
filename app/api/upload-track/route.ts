import { trackAnalysisUrl } from "../../../lib/analysis-delivery";
import { publicTrack, registerUploadedTrack, registerUploadedTrackStream, trackAudioUrl } from "../../../lib/music-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export async function POST(request: Request) {
  const streamedName = request.headers.get("x-crowd-filename");
  if (streamedName) {
    const declaredSize = Number(request.headers.get("x-crowd-size") ?? 0);
    if (declaredSize > MAX_UPLOAD_BYTES) return Response.json({ error: "That audio file is larger than the current 300 MB upload limit." }, { status: 413 });
    if (!request.body) return Response.json({ error: "That audio file is empty." }, { status: 400 });
    try {
      const track = await registerUploadedTrackStream(decodeURIComponent(streamedName), request.body, MAX_UPLOAD_BYTES);
      return Response.json({
        ...publicTrack(track),
        mapped: false,
        audio: trackAudioUrl(track),
        analysis: trackAnalysisUrl(track.id),
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The selected file could not be loaded." }, { status: 400 });
    }
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an audio file to load." }, { status: 400 });
  if (!file.size) return Response.json({ error: "That audio file is empty." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "That audio file is larger than the current 300 MB upload limit." }, { status: 413 });
  try {
    const track = await registerUploadedTrack(file.name, new Uint8Array(await file.arrayBuffer()));
    return Response.json({
      ...publicTrack(track),
      mapped: false,
      audio: trackAudioUrl(track),
      analysis: trackAnalysisUrl(track.id),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The selected file could not be loaded." }, { status: 400 });
  }
}

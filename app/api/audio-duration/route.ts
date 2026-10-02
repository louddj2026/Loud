import path from "node:path";
import { probeAudioDuration } from "../../../lib/audio-duration";
import { getMusicTrack, resolveMusicPath } from "../../../lib/music-library";
import { isKnownFullTune, isKnownShortSample } from "../../../lib/track-duration-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const root = process.cwd();
const ffmpegExecutable = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const track = await getMusicTrack(id);
  if (!track) return Response.json({ error: "Unknown track" }, { status: 404 });

  const measured = track.duration > 0
    ? track.duration
    : await probeAudioDuration(ffmpegExecutable, await resolveMusicPath(track));
  const duration = measured && measured > 0 ? measured : null;
  if (duration !== null) track.duration = duration;

  return Response.json({
    id: track.id,
    duration,
    fullTune: duration === null ? null : isKnownFullTune(duration),
    shortSample: isKnownShortSample(duration),
  }, { headers: { "Cache-Control": "no-store" } });
}

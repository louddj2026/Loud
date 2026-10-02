import { readFile } from "node:fs/promises";
import path from "node:path";
import { getMusicTrack } from "../../../../lib/music-library.ts";
import { recoverPendingTeachingBatch } from "../../../../lib/teaching-batch-recovery.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");

function safeAnalysisId(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe analysis track ID");
  return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await recoverPendingTeachingBatch();
    const { id: rawId } = await context.params;
    const id = safeAnalysisId(rawId);
    if (!await getMusicTrack(id)) {
      return Response.json({ error: "That track is not in the music library" }, { status: 404 });
    }
    const analysis = await readFile(path.join(analysisDirectory, `${id}.json`));
    return new Response(analysis, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Track analysis is unavailable";
    const unsafe = message === "Unsafe analysis track ID";
    const recoveryFailure = message.includes("pending transition") || message.includes("teaching batch");
    return Response.json({ error: message }, { status: unsafe ? 400 : recoveryFailure ? 503 : 404 });
  }
}

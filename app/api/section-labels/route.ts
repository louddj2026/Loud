import { allSectionFailures, allSectionSpans, SECTION_ANALYSIS_MAX_ATTEMPTS, sectionLabelVersion } from "../../../lib/section-label-store.ts";
import { enqueueSectionAnalysis, reportBoothIdle, status } from "../../../lib/section-analysis.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET returns the whole label map plus the queue status. The map is a few tens of
 * kilobytes, so it is sent whole and carries a `version` the client can watch
 * instead of re-fetching it on every poll.
 */
export async function GET() {
  return Response.json({
    version: sectionLabelVersion(),
    tracks: allSectionSpans(),
    // Failures travel with the map. Without them a track that can never be
    // analysed shows a plain wave and no explanation for the rest of time, which
    // is indistinguishable from the feature being broken.
    failures: allSectionFailures(),
    maxAttempts: SECTION_ANALYSIS_MAX_ATTEMPTS,
    status: status(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

/**
 * POST does three jobs at once, deliberately: it enqueues a track, carries the
 * booth's playback state, and returns the status. The booth polls this while it
 * waits, which is exactly what keeps the idle report fresh enough to be trusted —
 * a stale "nothing is playing" is what would let a 90-second GPU job start under
 * a live mix.
 */
export async function POST(request: Request) {
  let body: { trackId?: unknown; boothIdle?: unknown };
  try {
    body = await request.json() as { trackId?: unknown; boothIdle?: unknown };
  } catch {
    return Response.json({ error: "That request was not JSON" }, { status: 400 });
  }

  if (typeof body.boothIdle === "boolean") reportBoothIdle(body.boothIdle);

  let queued = false;
  if (body.trackId !== undefined) {
    if (typeof body.trackId !== "string" || !/^[a-z0-9_-]+$/i.test(body.trackId)) {
      return Response.json({ error: "That is not a usable track id" }, { status: 400 });
    }
    queued = enqueueSectionAnalysis(body.trackId);
  }

  return Response.json({
    queued,
    version: sectionLabelVersion(),
    status: status(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

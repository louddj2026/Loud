import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "../../../lib/data-root";
import { parsePreviewDraft, previewDraftHasMarks, previewDraftKey, type PreviewDraft } from "../../../lib/preview-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const draftFile = path.join(durableDataRoot, "preview-drafts.json");
/** Enough history to cover a night's pairs without unbounded growth. */
const MAX_DRAFTS = 64;

async function readDrafts(): Promise<Record<string, PreviewDraft>> {
  const raw = await readFile(draftFile, "utf8").catch(() => null);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const drafts: Record<string, PreviewDraft> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const draft = parsePreviewDraft(value);
      if (draft) drafts[key] = draft;
    }
    return drafts;
  } catch {
    // A corrupt file must never take the DJ's live cues down with it.
    return {};
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outgoing = params.get("outgoing") ?? "";
  const incoming = params.get("incoming") ?? "";
  if (!outgoing || !incoming) return Response.json({ error: "Both track ids are required" }, { status: 400 });
  const drafts = await readDrafts();
  return Response.json(
    { draft: drafts[previewDraftKey(outgoing, incoming)] ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const draft = parsePreviewDraft(await request.json().catch(() => null));
  if (!draft) return Response.json({ error: "That draft could not be read" }, { status: 400 });
  if (!previewDraftHasMarks(draft)) return Response.json({ ok: true, skipped: "no-marks" });
  const drafts = await readDrafts();
  drafts[previewDraftKey(draft.outgoingTrackId, draft.incomingTrackId)] = { ...draft, savedAt: new Date().toISOString() };
  const trimmed = Object.entries(drafts)
    .sort(([, a], [, b]) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")))
    .slice(0, MAX_DRAFTS);
  await mkdir(path.dirname(draftFile), { recursive: true });
  // Write through a temp file: a half-written draft file would lose every
  // pair, not just this one.
  const staging = `${draftFile}.writing`;
  await writeFile(staging, JSON.stringify(Object.fromEntries(trimmed), null, 2), "utf8");
  await rename(staging, draftFile);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

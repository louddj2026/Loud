/**
 * Unapplied Preview coordinates, kept safe across reloads.
 *
 * Marks placed in Preview lived only in React state: closing the panel, a
 * refresh, or a production rebuild discarded them, and the DJ had to re-cue
 * from scratch. Placing four points by ear is the expensive part of the whole
 * workflow, so a draft is written on every change and restored when the same
 * pair reopens. Applied teaching still wins — a draft is only ever a fallback
 * for a pair that has not been committed to the live tracks yet.
 */

export type PreviewDraftWindow = {
  start: number | null;
  end: number | null;
};

/**
 * A saved REPLICATE: which tune's block is copied, where, and how the
 * windows stood before it, so restoring can rebuild the splice exactly and
 * CLEAR can walk it back. Block times are in the ORIGINAL tune's clock.
 */
export type PreviewDraftReplicate = {
  role: "outgoing" | "incoming";
  blockStart: number;
  blockEnd: number;
  copies: number;
  savedBeats: number;
  savedOutgoingWindow: PreviewDraftWindow;
  savedIncomingWindow: PreviewDraftWindow;
};

export type PreviewDraft = {
  outgoingTrackId: string;
  incomingTrackId: string;
  outgoingWindow: PreviewDraftWindow;
  incomingWindow: PreviewDraftWindow;
  beats: number;
  bassSwapBeat?: number;
  replicate?: PreviewDraftReplicate;
  savedAt?: string;
};

/** One draft per ordered pair: the same tunes the other way round is a different mix. */
export function previewDraftKey(outgoingTrackId: string, incomingTrackId: string) {
  return `${outgoingTrackId}::${incomingTrackId}`;
}

// `Number(null)` is 0, so an unmarked edge must be rejected before conversion
// or "nothing placed yet" silently becomes "marked at the start of the track".
function readTime(value: unknown) {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readWindow(value: unknown): PreviewDraftWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { start?: unknown; end?: unknown };
  const safeStart = readTime(candidate.start);
  const safeEnd = readTime(candidate.end);
  // A finished window must run forwards; a half-finished one is still worth
  // keeping, because losing a START the DJ has already placed is the loss.
  if (safeStart !== null && safeEnd !== null && safeEnd <= safeStart) return { start: safeStart, end: null };
  return { start: safeStart, end: safeEnd };
}

/**
 * Accept only what could plausibly have been marked. A malformed or stale
 * draft must never overwrite good coordinates, so anything unreadable is
 * dropped rather than half-applied.
 */
export function parsePreviewDraft(value: unknown): PreviewDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const outgoingTrackId = typeof candidate.outgoingTrackId === "string" ? candidate.outgoingTrackId : "";
  const incomingTrackId = typeof candidate.incomingTrackId === "string" ? candidate.incomingTrackId : "";
  if (!outgoingTrackId || !incomingTrackId) return null;
  const outgoingWindow = readWindow(candidate.outgoingWindow);
  const incomingWindow = readWindow(candidate.incomingWindow);
  if (!outgoingWindow || !incomingWindow) return null;
  const beats = Number(candidate.beats);
  if (!Number.isInteger(beats) || beats < 1 || beats > 512) return null;
  const bassSwapBeat = typeof candidate.bassSwapBeat === "number" ? candidate.bassSwapBeat : Number.NaN;
  const savedAt = typeof candidate.savedAt === "string" ? candidate.savedAt : undefined;
  const replicate = readReplicate(candidate.replicate);
  return {
    outgoingTrackId,
    incomingTrackId,
    outgoingWindow,
    incomingWindow,
    beats,
    ...(Number.isInteger(bassSwapBeat) && bassSwapBeat >= 1 && bassSwapBeat <= beats ? { bassSwapBeat } : {}),
    ...(replicate ? { replicate } : {}),
    ...(savedAt ? { savedAt } : {}),
  };
}

/** A replicate that cannot be rebuilt exactly is dropped whole, never guessed at. */
function readReplicate(value: unknown): PreviewDraftReplicate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const role = candidate.role === "outgoing" || candidate.role === "incoming" ? candidate.role : null;
  const blockStart = readTime(candidate.blockStart);
  const blockEnd = readTime(candidate.blockEnd);
  const copies = Number(candidate.copies);
  const savedBeats = Number(candidate.savedBeats);
  const savedOutgoingWindow = readWindow(candidate.savedOutgoingWindow);
  const savedIncomingWindow = readWindow(candidate.savedIncomingWindow);
  if (!role || blockStart === null || blockEnd === null || blockEnd <= blockStart) return null;
  if (!Number.isInteger(copies) || copies < 1 || copies > 16) return null;
  if (!Number.isInteger(savedBeats) || savedBeats < 1 || savedBeats > 512) return null;
  if (!savedOutgoingWindow || !savedIncomingWindow) return null;
  return { role, blockStart, blockEnd, copies, savedBeats, savedOutgoingWindow, savedIncomingWindow };
}

/** Nothing marked yet is not worth storing, and must not clear a stored draft. */
export function previewDraftHasMarks(draft: PreviewDraft) {
  return draft.outgoingWindow.start !== null
    || draft.outgoingWindow.end !== null
    || draft.incomingWindow.start !== null
    || draft.incomingWindow.end !== null;
}

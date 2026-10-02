/**
 * Reviewing the cues the DJ has taught, before anything learns from them.
 *
 * The taught-cue corpus is the only sizeable set of labels there is, and every
 * measurement of the cue predictor rests on it. But it was gathered over weeks
 * of ordinary use, and a cue placed while experimenting is indistinguishable in
 * the database from one placed deliberately. Training on the bad ones would
 * teach the wrong lesson confidently.
 *
 * So this is a listening pass: play each cue in context, keep or drop it, and
 * record the verdict beside the cue rather than editing the original. Nothing
 * here deletes a teaching moment — a rejected cue stays in the database and is
 * simply not offered to anything that learns.
 *
 * Temporary by intent. When the corpus has been reviewed once, the verdicts are
 * what matters and this can go.
 */

export type CueReviewVerdict = "keep" | "drop" | "unsure";

export type CueReviewItem = {
  /** Stable identity: a track can carry several taught cues. */
  id: string;
  trackId: string;
  name: string;
  role: string;
  time: number;
  bpm: number;
  duration: number;
  taughtAt: string;
};

export type CueReviewRecord = {
  verdict: CueReviewVerdict;
  decidedAt: string;
};

/** How much music to hear before the cue, so the phrase can be felt arriving. */
export const CUE_REVIEW_LEAD_BEATS = 16;
/** And after, so a cue that lands a phrase late is audible as such. */
export const CUE_REVIEW_TAIL_BEATS = 16;

export function cueReviewId(trackId: string, role: string, time: number) {
  return `${trackId}::${role}::${time.toFixed(3)}`;
}

/**
 * The window to audition for a cue.
 *
 * Bounded by the tune: a cue near the start would otherwise ask for a negative
 * seek, which most players answer by silently starting at zero and making a
 * late cue look correct.
 */
export function cueReviewWindow(item: Pick<CueReviewItem, "time" | "bpm" | "duration">) {
  const beat = item.bpm > 0 ? 60 / item.bpm : 60 / 145;
  const start = Math.max(0, item.time - beat * CUE_REVIEW_LEAD_BEATS);
  const end = Math.min(item.duration > 0 ? item.duration : item.time + beat * CUE_REVIEW_TAIL_BEATS, item.time + beat * CUE_REVIEW_TAIL_BEATS);
  return { start, end, beat };
}

const VERDICTS: readonly CueReviewVerdict[] = ["keep", "drop", "unsure"];

export function parseCueReviewRecord(value: unknown): CueReviewRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const verdict = source.verdict;
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict as CueReviewVerdict)) return null;
  const decidedAt = typeof source.decidedAt === "string" ? source.decidedAt : "";
  return { verdict: verdict as CueReviewVerdict, decidedAt };
}

/**
 * The next cue that still needs a verdict.
 *
 * Reviewing is a long listening job, so it resumes where it left off rather
 * than restarting at the top. `after` is the item just decided; the search wraps
 * so a skipped cue is offered again on the next pass instead of being lost.
 */
export function nextCueForReview(
  items: readonly CueReviewItem[],
  verdicts: Readonly<Record<string, CueReviewRecord>>,
  after?: string | null,
) {
  if (!items.length) return null;
  const undecided = (item: CueReviewItem) => {
    const record = verdicts[item.id];
    return !record || record.verdict === "unsure";
  };
  const from = after ? items.findIndex((item) => item.id === after) : -1;
  for (let step = 1; step <= items.length; step += 1) {
    const item = items[(from + step + items.length) % items.length];
    if (undecided(item)) return item;
  }
  return null;
}

export function cueReviewProgress(
  items: readonly CueReviewItem[],
  verdicts: Readonly<Record<string, CueReviewRecord>>,
) {
  let kept = 0, dropped = 0, undecided = 0;
  for (const item of items) {
    const verdict = verdicts[item.id]?.verdict;
    if (verdict === "keep") kept += 1;
    else if (verdict === "drop") dropped += 1;
    else undecided += 1;
  }
  return { total: items.length, kept, dropped, undecided, decided: kept + dropped };
}

/**
 * The cues a learner is allowed to see.
 *
 * Anything not explicitly kept is withheld. An unreviewed corpus therefore
 * trains nothing at all, which is the safe direction to fail in — the whole
 * point of this pass is that unexamined labels were being trusted.
 */
export function keptCues<T extends { id: string }>(
  items: readonly T[],
  verdicts: Readonly<Record<string, CueReviewRecord>>,
) {
  return items.filter((item) => verdicts[item.id]?.verdict === "keep");
}

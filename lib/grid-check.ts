/**
 * Hearing whether the grid sits on the kick.
 *
 * The cue review answered a different question. It played music alone, so a
 * grid that is tens of milliseconds out was inaudible there — what was being
 * judged was whether a cue lands in the right musical place, which is a
 * phrase-level thing seconds wide. Grid phase is a millisecond thing.
 *
 * A tick on every grid beat makes it audible. Sitting inside the kick, the two
 * fuse and you hear one sound; a grid that has slipped produces a flam, and the
 * ear is far better at catching that than at judging an absolute offset. This
 * is the only test where the DJ is actually being asked about phase.
 *
 * It exists to settle whether `auditOffsetMs` means anything. The tracks it
 * rates worst are offered first, so a handful of listens answers the question
 * instead of a hundred.
 */

export type GridCheckItem = {
  trackId: string;
  name: string;
  bpm: number;
  duration: number;
  /** Median |auditOffsetMs| — what the suspicion is based on, shown for honesty. */
  suspectedOffsetMs: number;
  /** Grid beat times, so the tick lands on the grid rather than a fresh guess. */
  beats: number[];
  /** Which grid those beats came from. */
  source?: GridCheckSource;
  /** BPM of the ticked grid, which differs from `bpm` when the source is a stem. */
  gridBpm?: number;
  /**
   * The raw detected kicks, when the ticked beats are a grid fitted to them.
   *
   * Carried so the two can be A/B'd on the same audio: a grid that sounds as good
   * as the kicks it was fitted to is a good grid, and one that drifts where the
   * kicks do not is not.
   */
  kickBeats?: number[];
  /** Share of detected kicks the fitted grid lands on, 0..1. */
  explains?: number;
};

/**
 * Which grid the ticks are playing.
 *
 * `stem` means the beats were fitted to a drums-only separation with no reference
 * to the tune's stored grid — the point being to hear whether percussion alone
 * lands the ticks on the kicks. A verdict on one grid says nothing about the
 * other, so the two are recorded in separate files and never overwrite.
 */
export type GridCheckSource = "stored" | "stem" | "kicks" | "kickgrid";

export type GridCheckVerdict = "clean" | "flam" | "unsure";

export type GridCheckRecord = { verdict: GridCheckVerdict; decidedAt: string };

/** Long enough to judge a flam, short enough to keep the pass moving. */
export const GRID_CHECK_BEATS = 32;

const VERDICTS: readonly GridCheckVerdict[] = ["clean", "flam", "unsure"];

export function parseGridCheckRecord(value: unknown): GridCheckRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const verdict = source.verdict;
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict as GridCheckVerdict)) return null;
  return { verdict: verdict as GridCheckVerdict, decidedAt: typeof source.decidedAt === "string" ? source.decidedAt : "" };
}

/**
 * Where to audition a track's grid.
 *
 * Deliberately not the intro: a tune that opens with no drums gives the ear
 * nothing to compare the tick against, and every track would sound "clean".
 * Starting around a third of the way in lands in the body of the tune, and the
 * window is snapped to a grid beat so the first tick is not itself offset.
 */
/**
 * Detected kicks are not a grid, so the window cannot be snapped to "the first
 * beat past a third of the way in" and expect regular spacing after it. It is
 * still 32 beats' worth of time at the tune's tempo, which is what makes the
 * audition long enough to judge and short enough to sit through.
 */
export function gridCheckWindow(item: Pick<GridCheckItem, "bpm" | "duration" | "beats">) {
  const beat = item.bpm > 0 ? 60 / item.bpm : 60 / 145;
  const target = item.duration > 0 ? item.duration * .35 : beat * 64;
  let start = target;
  for (const time of item.beats) {
    if (time >= target) { start = time; break; }
  }
  return { start, end: start + beat * GRID_CHECK_BEATS, beat };
}

/** The beats a tick should sound on, inside the audition window. */
export function gridCheckTicks(item: Pick<GridCheckItem, "bpm" | "duration" | "beats">) {
  const { start, end } = gridCheckWindow(item);
  return item.beats.filter((time) => time >= start && time <= end);
}

export function nextGridCheck(
  items: readonly GridCheckItem[],
  verdicts: Readonly<Record<string, GridCheckRecord>>,
  after?: string | null,
) {
  if (!items.length) return null;
  const undecided = (item: GridCheckItem) => {
    const record = verdicts[item.trackId];
    return !record || record.verdict === "unsure";
  };
  const from = after ? items.findIndex((item) => item.trackId === after) : -1;
  for (let step = 1; step <= items.length; step += 1) {
    const item = items[(from + step + items.length) % items.length];
    if (undecided(item)) return item;
  }
  return null;
}

/**
 * Does the suspicion survive contact with the ear?
 *
 * The point of the pass: if tracks the metric rates worst sound clean, the
 * metric is not measuring anything audible and the thresholds tuned against it
 * should go. Reported as a comparison rather than a verdict, because a handful
 * of listens is a small sample and should read like one.
 */
export function gridCheckOutcome(
  items: readonly GridCheckItem[],
  verdicts: Readonly<Record<string, GridCheckRecord>>,
) {
  let suspectClean = 0, suspectFlam = 0, quietClean = 0, quietFlam = 0;
  for (const item of items) {
    const verdict = verdicts[item.trackId]?.verdict;
    if (verdict !== "clean" && verdict !== "flam") continue;
    const suspect = item.suspectedOffsetMs > 25;
    if (suspect && verdict === "clean") suspectClean += 1;
    else if (suspect) suspectFlam += 1;
    else if (verdict === "clean") quietClean += 1;
    else quietFlam += 1;
  }
  const judged = suspectClean + suspectFlam + quietClean + quietFlam;
  return {
    judged,
    suspectClean,
    suspectFlam,
    quietClean,
    quietFlam,
    /** True once enough flagged tracks have sounded clean to distrust the metric. */
    metricLooksWrong: suspectClean >= 4 && suspectFlam === 0,
  };
}

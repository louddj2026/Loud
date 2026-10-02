/**
 * Predicted cue points, and how far to trust them.
 *
 * Measured against every mix window the DJ has marked by hand. Each library
 * scan predates the mark it is compared with, so no prediction here has been
 * shown the answer it is judged against. `tests/fixtures/dj-mix-windows.json`
 * holds that ground truth and `tests/cue-prediction.test.mjs` re-derives the
 * hit rates from it, so a change that makes the guessing worse fails the suite.
 *
 * Two corpora, and the second one is the honest number. The rules below were
 * drawn from nine marked mix windows, where they scored 9/9 and 5/5 — but a
 * rule scored on the data it was drawn from is a description, not a forecast.
 * `dj-taught-cues.json` is the real test: 57 cues taught by hand two weeks
 * earlier in a different workflow, every one of them taught after its track was
 * scanned. Where the two disagree, the taught corpus wins.
 *
 * What survived measurement on data it had not seen:
 *
 *  - The scanned exit handoff IS the outgoing window's closing beat, but only
 *    when it falls late in the tune. Believing every handoff is right 76% of
 *    the time; withholding the early ones takes it to 95%. That gap is the
 *    entire feature — a cue silently wrong by four hundred beats is worse than
 *    no cue, and the early ones are wrong by 321 to 498.
 *
 *  - The scanned entry drop sits on a 32-beat phrase boundary against the DJ's
 *    own cue 100% of the time, and on the exact one they chose 75% of the time.
 *    Nothing here computes it; `planDemoSet` already did. What this adds is the
 *    finding that it is worth drawing — and that the quarter it misses, it
 *    misses by whole phrases rather than by drifting off the grid.
 *
 * What did not survive, and is therefore not pretended:
 *
 *  - Which edge of the window the drop belongs on. The DJ uses both placements
 *    and nothing measured so far separates them. The commoner one is proposed
 *    and the other is offered beside it; the choice stays with the DJ.
 *
 *  - Walking an early exit-handoff forward in whole phrases to rescue it. Two
 *    variants were tried and both scored worse than leaving it alone, because
 *    the DJ does not mix out at the last moment the tune can support.
 *
 * The trust fraction below was fitted on thirteen mixes by one DJ in one genre,
 * choosing the threshold after seeing which predictions were right. It then
 * held up on the 57 taught cues it had never seen, which is the only reason it
 * is here — but one DJ and one genre is still the whole of the evidence.
 */

/** Believe a scanned mix-out only once it sits this far into the tune. */
export const CUE_TRUST_TRACK_FRACTION = .7;

/**
 * A hand-marked window and the scan may disagree about tempo. Below this they
 * are the same number; above it one of them is wrong and the mix will drift.
 * Every window that was actually broken sat above 2%, every sound one below
 * 0.5%, so the gap is wide and the threshold is not delicately placed.
 */
export const CUE_GRID_TOLERANCE = .005;

/** How the incoming tune's drop sits against the overlap window. */
export type CueWindowPlacement = "drop-closes" | "drop-opens";

/** The placement the DJ reaches for more often, and so the one proposed first. */
export const CUE_DEFAULT_PLACEMENT: CueWindowPlacement = "drop-closes";

export type PredictedCue = {
  time: number;
  /**
   * `measured` — scored against cues this prediction had not seen, and right
   * far more often than not under these conditions. It is not a promise:
   * roughly one mix-out in twenty and one drop in four still land on the wrong
   * phrase. `unverified` — plausible, but outside the range anything was
   * checked in.
   */
  confidence: "measured" | "unverified";
  /** Plain-language reason, for the readout beside the mark. */
  because: string;
};

export type CueScan = {
  duration: number;
  bpm: number;
  /** Scanned entry drop, in seconds. */
  entryDrop?: number | null;
  /** Scanned exit handoff, in seconds. */
  exitHandoff?: number | null;
  /**
   * The grid's confidence in its own tempo at the cue, 0..1. Carried but not
   * acted on: measured against the DJ's marks it does not separate a sound grid
   * from a broken one. See the note below.
   */
  gridConfidence?: number | null;
};

/**
 * Deliberately not gated on grid confidence, having tried it and measured the
 * cost.
 *
 * The reasoning for a gate was sound — every taught cue came from a tune the
 * scanner was sure about, so nothing below that bar had been tested — but the
 * field turns out not to carry the information. Scored against the DJ's own
 * marks, which are independent evidence of a tune's real tempo, the confidence
 * at the cue is bimodal (100 or 1000 permille, nothing between) and does not
 * separate a sound grid from a broken one: nine windows whose tempo agrees with
 * the scan to within 0.4% sit at 100, and the worst broken window in the set
 * sits at 1000. A 900 bar would have withheld 9 of 21 sound windows to catch 3
 * of 5 broken ones — and those 5 are marking errors that `gridDisagreement`
 * already catches 3 for 3, from arithmetic rather than a confidence score.
 *
 * So the grid's own confidence is not used here. If a better calibrated signal
 * appears, this is the place for it; `gridConfidence` stays on `CueScan` so
 * the value keeps flowing through and can be re-tested against a larger set.
 */

const usable = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Where the incoming tune should meet the window.
 *
 * Offered whenever the scan produced a drop: it matched a window edge in every
 * mix on record, and unlike the mix-out there is no region where it went wrong.
 */
export function predictedEntryCue(scan: CueScan): PredictedCue | null {
  if (!usable(scan.entryDrop) || !usable(scan.duration) || scan.entryDrop > scan.duration) return null;
  return {
    time: scan.entryDrop,
    confidence: "measured",
    because: "the tune's drop",
  };
}

/**
 * Where the outgoing tune should hand over.
 *
 * Withheld when the scan's handoff lands early in the tune. Those were wrong
 * every time — by 321 to 498 beats — and no correction rescued them, so
 * offering nothing is the honest output rather than offering the number anyway.
 */
export function predictedMixOutCue(scan: CueScan): PredictedCue | null {
  if (!usable(scan.exitHandoff) || !usable(scan.duration) || scan.duration <= 0) return null;
  if (scan.exitHandoff > scan.duration) return null;
  if (scan.exitHandoff / scan.duration < CUE_TRUST_TRACK_FRACTION) return null;
  return {
    time: scan.exitHandoff,
    confidence: "measured",
    because: "the tune's handoff, late enough in the track to trust",
  };
}

/**
 * Why no mix-out was offered, for the readout. Silence with no explanation
 * reads as a bug; "found one, did not believe it" reads as a decision.
 */
export function mixOutWithheldReason(scan: CueScan): string | null {
  if (!usable(scan.exitHandoff) || !usable(scan.duration) || scan.duration <= 0) return "no handoff found in this tune";
  if (scan.exitHandoff > scan.duration) return "no handoff found in this tune";
  if (scan.exitHandoff / scan.duration < CUE_TRUST_TRACK_FRACTION) {
    return `handoff sits ${Math.round(scan.exitHandoff / scan.duration * 100)}% through the tune · too early to trust`;
  }
  return null;
}

export type PredictedWindow = {
  outgoingStart: number | null;
  outgoingEnd: number | null;
  incomingStart: number | null;
  incomingEnd: number | null;
  placement: CueWindowPlacement;
  /** True only when both ends came from a cue that measured well. */
  complete: boolean;
  notes: string[];
};

/**
 * Propose all four window coordinates.
 *
 * The incoming side is anchored to its drop and the outgoing to its handoff;
 * in the mixes where both were offered, those two land on the same beat and the
 * old tune hands over exactly as the new one opens up. Either side may come
 * back null — a partial proposal the DJ completes beats a fabricated one.
 */
export function predictedMixWindow(input: {
  outgoing: CueScan;
  incoming: CueScan;
  beats: number;
  placement?: CueWindowPlacement;
}): PredictedWindow {
  const placement = input.placement ?? CUE_DEFAULT_PLACEMENT;
  const notes: string[] = [];
  const beats = Math.max(1, Math.round(input.beats));

  const entry = predictedEntryCue(input.incoming);
  const incomingSpan = beats * 60 / input.incoming.bpm;
  let incomingStart: number | null = null;
  let incomingEnd: number | null = null;
  if (entry && Number.isFinite(incomingSpan) && incomingSpan > 0) {
    if (placement === "drop-closes") {
      incomingStart = entry.time - incomingSpan;
      incomingEnd = entry.time;
    } else {
      incomingStart = entry.time;
      incomingEnd = entry.time + incomingSpan;
    }
    // A window that would start before the tune does cannot be played into.
    if (incomingStart < 0 || incomingEnd > input.incoming.duration) {
      notes.push(`a ${beats}-beat window ${placement === "drop-closes" ? "before" : "after"} the drop runs past the end of the tune`);
      incomingStart = null;
      incomingEnd = null;
    }
  } else {
    notes.push("no drop found in the incoming tune");
  }

  const mixOut = predictedMixOutCue(input.outgoing);
  const outgoingSpan = beats * 60 / input.outgoing.bpm;
  let outgoingStart: number | null = null;
  let outgoingEnd: number | null = null;
  if (mixOut && Number.isFinite(outgoingSpan) && outgoingSpan > 0) {
    outgoingEnd = mixOut.time;
    outgoingStart = mixOut.time - outgoingSpan;
    if (outgoingStart < 0) {
      notes.push(`a ${beats}-beat window before the handoff starts before the tune does`);
      outgoingStart = null;
      outgoingEnd = null;
    }
  } else {
    const reason = mixOutWithheldReason(input.outgoing);
    if (reason) notes.push(reason);
  }

  return {
    outgoingStart,
    outgoingEnd,
    incomingStart,
    incomingEnd,
    placement,
    complete: outgoingStart !== null && outgoingEnd !== null && incomingStart !== null && incomingEnd !== null,
    notes,
  };
}

export type GridDisagreement = {
  declaredBpm: number;
  scannedBpm: number;
  /** Signed fractional difference; positive means the window claims a faster tune. */
  drift: number;
  disagrees: boolean;
  /** Beats the span really holds at the scanned tempo, for the readout. */
  actualBeats: number;
  message: string | null;
};

/**
 * Compare a hand-marked window's own tempo with the scanned one.
 *
 * This never moves a mark and never overrules the window — the window stays the
 * grid. It reports that two numbers disagree, which is arithmetic rather than
 * an opinion about where the mix should go. Every window that drifted in play
 * failed this check, and no sound window did.
 */
export function gridDisagreement(input: {
  windowSeconds: number;
  declaredBeats: number;
  scannedBpm: number;
}): GridDisagreement | null {
  const { windowSeconds, declaredBeats, scannedBpm } = input;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return null;
  if (!Number.isFinite(declaredBeats) || declaredBeats <= 0) return null;
  if (!Number.isFinite(scannedBpm) || scannedBpm <= 0) return null;
  const declaredBpm = declaredBeats * 60 / windowSeconds;
  const drift = declaredBpm / scannedBpm - 1;
  const disagrees = Math.abs(drift) > CUE_GRID_TOLERANCE;
  const actualBeats = windowSeconds * scannedBpm / 60;
  return {
    declaredBpm,
    scannedBpm,
    drift,
    disagrees,
    actualBeats,
    message: disagrees
      ? `window declares ${declaredBpm.toFixed(2)} BPM · scan says ${scannedBpm.toFixed(2)} · that span holds ${actualBeats.toFixed(1)} beats, not ${declaredBeats}`
      : null,
  };
}

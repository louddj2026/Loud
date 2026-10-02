/**
 * Preview Mix audible-overlap phase policy.
 *
 * The confirmed windows are the one tempo authority: their span-locked ratio
 * runs untouched for the whole audible overlap. This module only decides
 * whether the align at X needs to seek at all, records the phase trajectory so
 * a reported flam is diagnosable, and classifies it afterwards. It never bends
 * tempo.
 */

export const PREVIEW_OPEN_SEEK_TOLERANCE_SECONDS = .014;
export const PREVIEW_OVERLAP_RESEEK_SECONDS = .08;
export const PREVIEW_OVERLAP_SAMPLE_EVERY_BEATS = 8;

/**
 * Whether the hard-align at X should actually seek. Seeking a playing media
 * element costs real time while the outgoing keeps rolling, so when the silent
 * preroll has already locked phase inside the same green tolerance the live
 * path uses at cue open, seeking again would CREATE the start-of-mix flam it
 * is meant to prevent.
 */
export function previewOpenSeekDecision(phaseErrorSeconds: number): "keep" | "seek" {
  if (!Number.isFinite(phaseErrorSeconds)) return "keep";
  return Math.abs(phaseErrorSeconds) > PREVIEW_OPEN_SEEK_TOLERANCE_SECONDS ? "seek" : "keep";
}

export type PreviewOverlapSample = {
  beat: number;
  phaseErrorMs: number;
};

export type PreviewOverlapDriftClassification =
  | "locked"
  | "linear-drift"
  | "step"
  | "mixed"
  | "insufficient";

export type PreviewOverlapDriftSummary = {
  classification: PreviewOverlapDriftClassification;
  maxAbsMs: number;
  endMs: number;
  driftMsPerBeat: number;
  stepCount: number;
  sampleCount: number;
};

const STEP_JUMP_MS = 25;
const LOCKED_MS = 10;

/**
 * Classify the phase-error trajectory of one audible overlap so the diagnosis
 * is readable straight from the crowd-live event: a linear ramp points at a
 * window-span selection error (the ratio itself), a step points at a decoder
 * stall, locked means the span authority held.
 */
export function previewOverlapDriftSummary(samples: PreviewOverlapSample[]): PreviewOverlapDriftSummary {
  const usable = samples.filter((sample) =>
    Number.isFinite(sample.beat) && Number.isFinite(sample.phaseErrorMs));
  const sampleCount = usable.length;
  if (sampleCount < 3) {
    return { classification: "insufficient", maxAbsMs: 0, endMs: 0, driftMsPerBeat: 0, stepCount: 0, sampleCount };
  }
  const maxAbsMs = Math.max(...usable.map((sample) => Math.abs(sample.phaseErrorMs)));
  const endMs = usable[usable.length - 1].phaseErrorMs;
  // A step also bends a least-squares fit, so the ramp estimate must be
  // robust to it: measure drift as the mean per-beat delta across the flat
  // stretches only, counting the step jumps separately.
  let stepCount = 0;
  let driftDeltaSum = 0;
  let driftDeltaCount = 0;
  for (let index = 1; index < usable.length; index += 1) {
    const deltaMs = usable[index].phaseErrorMs - usable[index - 1].phaseErrorMs;
    const deltaBeats = usable[index].beat - usable[index - 1].beat;
    if (Math.abs(deltaMs) > STEP_JUMP_MS) {
      stepCount += 1;
    } else if (deltaBeats > 0) {
      driftDeltaSum += deltaMs / deltaBeats;
      driftDeltaCount += 1;
    }
  }
  const driftMsPerBeat = driftDeltaCount > 0 ? driftDeltaSum / driftDeltaCount : 0;
  const beatSpan = usable[usable.length - 1].beat - usable[0].beat;
  const rampMs = Math.abs(driftMsPerBeat * beatSpan);
  let classification: PreviewOverlapDriftClassification;
  if (stepCount > 0) classification = rampMs >= LOCKED_MS ? "mixed" : "step";
  else if (rampMs >= LOCKED_MS) classification = "linear-drift";
  else if (maxAbsMs < LOCKED_MS) classification = "locked";
  else classification = "mixed";
  return { classification, maxAbsMs, endMs, driftMsPerBeat, stepCount, sampleCount };
}


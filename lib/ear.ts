/**
 * The ear: listening primitives shared by the detector, the referee and the cue
 * work. Born 14 Aug 2026 from DJ's instruction — "if we can develop an ear for
 * you, you can hear where cues are, where kicks are... Please make yourself
 * ears."
 *
 * What an ear knows that an envelope does not, all measured on this corpus:
 *  - a psy kick is a SLAP (2-10 kHz crack, over in a few ms) followed by a SUB
 *    (30-90 Hz swell). The slap leads by 5-70 ms depending on the tune, and the
 *    DJ cues to the slap;
 *  - a saturated kickbass pulses at its ~60 Hz fundamental, so unsmoothed
 *    envelopes show 16 ms "transients" that are not events;
 *  - where the drums stop there is nothing to hear, and pretending otherwise is
 *    how phantom kicks appear in silent intros.
 *
 * Implements the Phase-1 work order's Slap-Anchor: the ear does not decide WHICH
 * hits are kicks — the ear-calibrated 30-90 Hz consensus detector keeps that —
 * it decides WHERE each one starts. Strict 1:1: a hit can be re-timed, never
 * added or deleted, so a tune with no usable slaps passes through byte-identical.
 */

/** Slap band, per the work order's constants table. */
const SLAP_LOW_HZ = 2000;
const SLAP_HIGH_HZ = 10000;
export const SLAP_HOP_SECONDS = 0.001;
/** Rise measured against this much recent history. */
const SLAP_HISTORY_STEPS = 20;
/** Threshold statistics window (reused from the low-band detector's design). */
const THRESHOLD_WINDOW_SECONDS = 2;
const THRESHOLD_DEVIATIONS = 5;
const LOCAL_PEAK_SHARE = 0.28;
const THRESHOLD_STRIDE_STEPS = 5;
/** Two slaps closer than this are one crack. */
const SLAP_MINIMUM_GAP_SECONDS = 0.06;
/**
 * Onset refinement: walk back from the crack's raw peak to its start.
 *
 * These MUST match the referee's definition (walk to 25% of the local raw peak,
 * generous cap) — the first shadow run used the design proposal's 15 ms / 0.10
 * and every anchored tune read a systematic −10 ms against the referee, which
 * was not the music disagreeing, it was two onset definitions disagreeing. One
 * ear, one definition of "where a sound starts".
 */
const SLAP_BACKTRACK_SECONDS = 0.030;
const SLAP_BACKTRACK_FLOOR = 0.25;
/** A1 pairing windows around the low-band onset, seconds. */
const PAIR_CORE_EARLY = 0.055;
const PAIR_CORE_LATE = 0.040;
const PAIR_EXTENDED_EARLY = 0.090;
/** Earliest-loud: earliest CORE candidate whose peak is at least this share of the strongest. */
const EARLIEST_LOUD_SHARE = 0.5;
/** A slap further than this ahead of the sub swell is somebody else's transient. */
const SUB_CONFIRM_SECONDS = 0.150;
/** A4: final keep-stronger suppression after re-anchoring, seconds. */
const FINAL_SUPPRESSION_SECONDS = 0.18;

export type SlapOnset = { time: number; strength: number };

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[sorted.length >> 1];
}

/**
 * Slap onsets in a drums stem, at 1 ms resolution.
 *
 * @param samples    Mono PCM of the stem — the 22050 Hz shape decode is right.
 * @param sampleRate Its sample rate.
 * @param sensitivity The one knob, shared in spirit with the low-band detector.
 */
export function detectSlapOnsets(
  samples: Float32Array | readonly number[],
  sampleRate: number,
  sensitivity = 1,
): SlapOnset[] {
  const hop = Math.max(1, Math.round(sampleRate * SLAP_HOP_SECONDS));
  const lowCoefficient = 1 - Math.exp(-2 * Math.PI * Math.min(SLAP_LOW_HZ, sampleRate * 0.45) / sampleRate);
  const highCoefficient = 1 - Math.exp(-2 * Math.PI * Math.min(SLAP_HIGH_HZ, sampleRate * 0.45) / sampleRate);
  let lowA = 0, lowB = 0, highA = 0, highB = 0;
  const envelope: number[] = [];
  let sum = 0, count = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? (samples[index] as number) : 0;
    lowA += lowCoefficient * (sample - lowA);
    lowB += lowCoefficient * (lowA - lowB);
    highA += highCoefficient * (sample - highA);
    highB += highCoefficient * (highA - highB);
    const band = highB - lowB;
    sum += band * band;
    count += 1;
    if (count === hop) {
      envelope.push(Math.sqrt(sum / hop));
      sum = 0;
      count = 0;
    }
  }
  if (envelope.length < 64) return [];

  // Novelty: rise against the recent median, so a sustained sizzle is not an
  // endless onset.
  const rise = new Array<number>(envelope.length).fill(0);
  for (let index = 1; index < envelope.length; index += 1) {
    const from = Math.max(0, index - SLAP_HISTORY_STEPS);
    rise[index] = Math.max(0, envelope[index] - median(envelope.slice(from, index)));
  }

  // Adaptive threshold at a coarse stride (2 s of 1 ms frames per window would
  // be quadratic done naively).
  const windowSteps = Math.max(64, Math.round(THRESHOLD_WINDOW_SECONDS / SLAP_HOP_SECONDS));
  const threshold = new Array<number>(rise.length).fill(0);
  for (let anchor = 0; anchor < rise.length; anchor += THRESHOLD_STRIDE_STEPS) {
    const from = Math.max(0, anchor - (windowSteps >> 1));
    const slice = rise.slice(from, Math.min(rise.length, from + windowSteps));
    const centre = median(slice);
    const deviation = median(slice.map((value) => Math.abs(value - centre)));
    const loudest = slice.reduce((most, value) => Math.max(most, value), 0);
    const level = Math.max((centre + deviation * THRESHOLD_DEVIATIONS) * sensitivity, loudest * LOCAL_PEAK_SHARE * sensitivity);
    for (let step = 0; step < THRESHOLD_STRIDE_STEPS && anchor + step < rise.length; step += 1) threshold[anchor + step] = level;
  }

  // Peak picking with suppression, then backtrack each pick to the crack start.
  const minimumSteps = Math.max(1, Math.round(SLAP_MINIMUM_GAP_SECONDS / SLAP_HOP_SECONDS));
  const backtrackSteps = Math.max(1, Math.round(SLAP_BACKTRACK_SECONDS / SLAP_HOP_SECONDS));
  const onsets: SlapOnset[] = [];
  let lastIndex = -minimumSteps;
  for (let index = 1; index < rise.length - 1; index += 1) {
    if (rise[index] < threshold[index]) continue;
    if (rise[index] < rise[index - 1] || rise[index] < rise[index + 1]) continue;
    if (index - lastIndex < minimumSteps) {
      const previous = onsets.at(-1);
      if (previous && rise[index] > previous.strength) {
        previous.time = index * SLAP_HOP_SECONDS;
        previous.strength = rise[index];
        lastIndex = index;
      }
      continue;
    }
    onsets.push({ time: index * SLAP_HOP_SECONDS, strength: rise[index] });
    lastIndex = index;
  }
  return onsets.map((onset) => {
    const pick = Math.round(onset.time / SLAP_HOP_SECONDS);
    // The crack's raw peak nearby, then back to its start — the referee's walk:
    // keep stepping earlier while the envelope stays above a quarter of the peak.
    let peakAt = pick;
    for (let step = Math.max(0, pick - 2); step < Math.min(envelope.length, pick + 6); step += 1) {
      if (envelope[step] > envelope[peakAt]) peakAt = step;
    }
    let start = peakAt;
    for (let step = peakAt; step > Math.max(0, peakAt - backtrackSteps); step -= 1) {
      if (envelope[step - 1] < envelope[peakAt] * SLAP_BACKTRACK_FLOOR) break;
      start = step - 1;
    }
    return { time: start * SLAP_HOP_SECONDS, strength: onset.strength };
  });
}

/** The slap-band RMS envelope alone, 1 ms frames — the ear's raw material. */
export function slapEnvelope(samples: Float32Array | readonly number[], sampleRate: number): number[] {
  const hop = Math.max(1, Math.round(sampleRate * SLAP_HOP_SECONDS));
  const lowCoefficient = 1 - Math.exp(-2 * Math.PI * Math.min(SLAP_LOW_HZ, sampleRate * 0.45) / sampleRate);
  const highCoefficient = 1 - Math.exp(-2 * Math.PI * Math.min(SLAP_HIGH_HZ, sampleRate * 0.45) / sampleRate);
  let lowA = 0, lowB = 0, highA = 0, highB = 0;
  const envelope: number[] = [];
  let sum = 0, count = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? (samples[index] as number) : 0;
    lowA += lowCoefficient * (sample - lowA);
    lowB += lowCoefficient * (lowA - lowB);
    highA += highCoefficient * (sample - highA);
    highB += highCoefficient * (highA - highB);
    const band = highB - lowB;
    sum += band * band;
    count += 1;
    if (count === hop) { envelope.push(Math.sqrt(sum / hop)); sum = 0; count = 0; }
  }
  return envelope;
}

/**
 * The crack nearest a known hit, heard the way the referee hears it: locally.
 *
 * The first shadow run detected slaps GLOBALLY (adaptive threshold, local-peak
 * share against the loudest rise within 2 s) and only anchored 40-69% of hits —
 * in busy passages, hats and leads own the loudness scale and real cracks fall
 * under the share. But a kick's crack does not compete with the whole passage;
 * it competes with the 40 ms before it. So this listens in a window around the
 * hit with the referee's own rules — rise >= 6 dB over the preceding bed, peak
 * >= 0.3 x the window's own peak, onset = walk back from the raw peak to 25% —
 * one definition of hearing, applied at hit points here and at map points there.
 */
export function localSlapOnset(
  envelope: readonly number[],
  hitTime: number,
  { early = PAIR_CORE_EARLY, late = PAIR_CORE_LATE }: { early?: number; late?: number } = {},
): { time: number; peak: number } | null {
  const hitFrame = Math.round(hitTime / SLAP_HOP_SECONDS);
  const lo = Math.max(1, hitFrame - Math.round(early / SLAP_HOP_SECONDS));
  const hi = Math.min(envelope.length - 2, hitFrame + Math.round(late / SLAP_HOP_SECONDS));
  if (hi <= lo) return null;
  let windowPeak = 0;
  for (let index = lo; index <= hi; index += 1) windowPeak = Math.max(windowPeak, envelope[index]);
  if (windowPeak <= 1e-9) return null;
  const candidates: Array<{ frame: number; peak: number }> = [];
  let index = lo;
  while (index <= hi) {
    if (envelope[index] > envelope[index - 1]) {
      const regionStart = index - 1;
      let j = index;
      while (j < envelope.length - 1 && envelope[j + 1] >= envelope[j]) j += 1;
      let peakAt = regionStart;
      for (let k = Math.max(0, regionStart - 2); k <= Math.min(envelope.length - 1, j + 2); k += 1) {
        if (envelope[k] > envelope[peakAt]) peakAt = k;
      }
      const peak = envelope[peakAt];
      const bedFrom = Math.max(0, regionStart - 40);
      const bedSlice = [...envelope.slice(bedFrom, Math.max(bedFrom + 1, regionStart))].sort((a, b) => a - b);
      const bed = bedSlice[bedSlice.length >> 1] ?? 1e-9;
      const riseDb = 20 * Math.log10(Math.max(peak, 1e-9) / Math.max(bed, 1e-9));
      if (peak >= windowPeak * 0.3 && riseDb >= 6) {
        let start = peakAt;
        const cap = Math.max(0, peakAt - Math.round(SLAP_BACKTRACK_SECONDS / SLAP_HOP_SECONDS));
        for (let k = peakAt; k > cap; k -= 1) {
          if (envelope[k - 1] < peak * SLAP_BACKTRACK_FLOOR) break;
          start = k - 1;
        }
        if (start >= lo - 5) candidates.push({ frame: start, peak });
      }
      index = j + 1;
    } else index += 1;
  }
  if (!candidates.length) return null;
  // Earliest-loud, per amendment A1: the first candidate at least half as loud
  // as the strongest — a layered pair cues on its first crack.
  const strongest = candidates.reduce((most, c) => Math.max(most, c.peak), 0);
  const chosen = candidates.find((c) => c.peak >= strongest * EARLIEST_LOUD_SHARE) ?? candidates[0];
  return { time: chosen.frame * SLAP_HOP_SECONDS, peak: chosen.peak };
}

/** The sub-band (30-90 Hz) RMS envelope at 1 ms frames, from the 4 kHz decode. */
export function subEnvelope(samples: Float32Array | readonly number[], sampleRate: number): number[] {
  const hop = Math.max(1, Math.round(sampleRate * SLAP_HOP_SECONDS));
  const lowCoefficient = 1 - Math.exp(-2 * Math.PI * 30 / sampleRate);
  const highCoefficient = 1 - Math.exp(-2 * Math.PI * 90 / sampleRate);
  let lowA = 0, lowB = 0, highA = 0, highB = 0;
  const envelope: number[] = [];
  let sum = 0, count = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? (samples[index] as number) : 0;
    lowA += lowCoefficient * (sample - lowA);
    lowB += lowCoefficient * (lowA - lowB);
    highA += highCoefficient * (sample - highA);
    highB += highCoefficient * (highA - highB);
    const band = highB - lowB;
    sum += band * band;
    count += 1;
    if (count === hop) { envelope.push(Math.sqrt(sum / hop)); sum = 0; count = 0; }
  }
  return envelope;
}

/**
 * Does a sub bloom behind this moment? A kick's crack is followed by 30-90 Hz
 * energy within ~60 ms; a hat's is not. This is DJ's method verbatim — "use
 * your eye on the wave, use frequencies to confirm" — and it is what lets the
 * anchor say no to a loud hat that happens to live inside the pairing window.
 */
function subConfirms(sub: readonly number[], time: number): boolean {
  const frame = Math.round(time / SLAP_HOP_SECONDS);
  if (frame < 2 || frame >= sub.length - 4) return true; // no evidence either way
  let after = 0;
  for (let index = frame; index <= Math.min(sub.length - 1, frame + 60); index += 1) after = Math.max(after, sub[index]);
  const bedFrom = Math.max(0, frame - 40);
  const bedSlice = [...sub.slice(bedFrom, Math.max(bedFrom + 1, frame))].sort((a, b) => a - b);
  const bed = bedSlice[bedSlice.length >> 1] ?? 1e-9;
  return 20 * Math.log10(Math.max(after, 1e-9) / Math.max(bed, 1e-9)) >= 6;
}

/**
 * Anchor every hit by local listening — CORE window first, EXTENDED reach only
 * when the CORE hears nothing, and every candidate must be sub-confirmed.
 *
 * A4 collapses hits only when two land on the SAME crack, and it does so by
 * reverting the weaker one to its own low-band time rather than deleting it —
 * the fourth shadow run showed deletion breaking roll-heavy tunes (Drum War
 * lost 21 real hits and its IQR tripled). Strict 1:1 means strict: same count
 * out as in, always.
 */
export function anchorHitsLocally(
  hits: readonly { time: number; strength: number }[],
  envelope: readonly number[],
  sub?: readonly number[],
): AnchoredHit[] {
  const anchorOne = (hit: { time: number; strength: number }): AnchoredHit => {
    for (const early of [PAIR_CORE_EARLY, PAIR_EXTENDED_EARLY]) {
      const found = localSlapOnset(envelope, hit.time, { early, late: PAIR_CORE_LATE });
      if (found && hit.time - found.time <= SUB_CONFIRM_SECONDS && (!sub || subConfirms(sub, found.time))) {
        return { time: found.time, strength: hit.strength, anchored: true };
      }
    }
    return { time: hit.time, strength: hit.strength, anchored: false };
  };
  const anchored = hits.map((hit) => ({ original: hit, result: anchorOne(hit) }));
  // Same-crack collapse: two anchors within 20 ms are one crack heard twice.
  // The weaker keeps its own low-band time instead of vanishing.
  anchored.sort((left, right) => left.result.time - right.result.time);
  for (let index = 1; index < anchored.length; index += 1) {
    const previous = anchored[index - 1];
    const current = anchored[index];
    if (current.result.anchored && previous.result.anchored
      && current.result.time - previous.result.time < 0.020) {
      const weaker = current.result.strength <= previous.result.strength ? current : previous;
      weaker.result = { time: weaker.original.time, strength: weaker.original.strength, anchored: false };
    }
  }
  return anchored
    .map(({ result }) => ({ ...result, time: Math.round(result.time * 1000) / 1000 }))
    .sort((left, right) => left.time - right.time);
}

export type AnchoredHit = {
  time: number;
  strength: number;
  /** True when the time is a slap start; false means the low-band time passed through. */
  anchored: boolean;
};

/**
 * Slap-Anchor (work order section 2, amendments A1 + A4).
 *
 * Every low-band hit looks for its crack: first in the CORE window
 * [-55 ms, +40 ms], and only if that is empty in the EXTENDED window back to
 * -90 ms. Among CORE candidates the EARLIEST loud one wins — that is what makes
 * a 20-35 ms layered pair cue on its first crack rather than its centre. A hit
 * with no qualifying slap keeps its own time exactly (the 1:1 invariant), and a
 * final 180 ms keep-stronger pass collapses any adjacency the moves created.
 */
export function anchorHitsToSlaps(
  hits: readonly { time: number; strength: number }[],
  slaps: readonly SlapOnset[],
  { coreEarly = PAIR_CORE_EARLY, coreLate = PAIR_CORE_LATE, extendedEarly = PAIR_EXTENDED_EARLY }: {
    coreEarly?: number; coreLate?: number; extendedEarly?: number;
  } = {},
): AnchoredHit[] {
  const sorted = [...slaps].sort((left, right) => left.time - right.time);
  const anchored: AnchoredHit[] = hits.map((hit) => {
    const pick = (early: number, late: number) => {
      const window = sorted.filter((slap) =>
        slap.time >= hit.time - early && slap.time <= hit.time + late
        // Sub-confirmation: the crack must not run ahead of its sub by more
        // than a kick's whole envelope.
        && hit.time - slap.time <= SUB_CONFIRM_SECONDS);
      if (!window.length) return null;
      const strongest = window.reduce((most, slap) => Math.max(most, slap.strength), 0);
      return window.find((slap) => slap.strength >= strongest * EARLIEST_LOUD_SHARE) ?? null;
    };
    const core = pick(coreEarly, coreLate);
    const extended = core ?? pick(extendedEarly, coreLate);
    return extended
      ? { time: extended.time, strength: hit.strength, anchored: true }
      : { time: hit.time, strength: hit.strength, anchored: false };
  });

  // A4: re-anchoring can pull two hits onto the same crack; keep the stronger.
  anchored.sort((left, right) => left.time - right.time);
  const kept: AnchoredHit[] = [];
  for (const hit of anchored) {
    const previous = kept.at(-1);
    if (previous && hit.time - previous.time < FINAL_SUPPRESSION_SECONDS) {
      if (hit.strength > previous.strength) kept[kept.length - 1] = hit;
      continue;
    }
    kept.push(hit);
  }
  return kept.map((hit) => ({ ...hit, time: Math.round(hit.time * 1000) / 1000 }));
}

import { detectKicks } from "./kick-detect.ts";
import { assessTempoSection, kickTempoSeed, type TempoSectionEvidence } from "./tempo-section-evidence.ts";

export type TempoHypothesis = {
  bpm: number;
  phase: number;
  score: number;
  probability: number;
  coverage: number;
  matchedOnsetRatio: number;
  medianResidualMs: number;
  p90ResidualMs: number;
  continuity: number;
  lowPulseCoverage: number;
  barAccentContrast: number;
  metricalRelation: "primary" | "half" | "double" | "alternative";
};

export type DownbeatHypothesis = { rotation: 0 | 1 | 2 | 3; score: number; probability: number };

export type GridBeat = {
  beat: number;
  time: number;
  nominalTime: number;
  attackTime: number | null;
  residualMs: number | null;
  strength: number;
  confidence: number;
  isDownbeat: boolean;
  beatInBar: 1 | 2 | 3 | 4;
  kickStatus: "aligned" | "early" | "late" | "inferred" | "ambiguous";
  auditOffsetMs: number | null;
  auditStrength: number;
  isPhraseStart: boolean;
  phraseIndex: number | null;
  phraseConfidence: number;
  crashConfidence: number;
  crashHighBed: number;
};

export type PhraseSection = {
  index: number;
  start: number;
  end: number;
  startBeat: number;
  endBeat: number;
  bars: number;
  bpm: number;
  confidence: number;
  anchorOffsetMs: number | null;
  reason: "structural-change" | "crash-confirmed" | "periodic-continuity" | "track-start";
};

export const GRID_ANALYSIS_VERSION = "crowd2-grid-8" as const;

export type BeatGridAnalysis = {
  version: typeof GRID_ANALYSIS_VERSION;
  duration: number;
  sampleRate: number;
  hopSeconds: number;
  mode: "constant" | "piecewise";
  evidenceMode: "multiband-signal" | "beat-model-plus-multiband";
  tempoSections: Array<{ start: number; end: number; bpm: number; confidence: number }>;
  tempoSectionEvidence?: TempoSectionEvidence[];
  selected: TempoHypothesis;
  hypotheses: TempoHypothesis[];
  downbeats: DownbeatHypothesis[];
  beats: GridBeat[];
  phrases: PhraseSection[];
  waveform: number[];
  lowWaveform: number[];
  lowWaveformDetailed: number[];
  bassLowWaveformDetailed: number[];
  bassHighWaveformDetailed: number[];
  lowAttackWaveformDetailed: number[];
  upperAttackWaveformDetailed: number[];
  crashWaveformDetailed: number[];
  kickWaveformDetailed: number[];
  uncertainty: Array<{ start: number; end: number; reason: string }>;
  verification: {
    status: "verified" | "review" | "insufficient-evidence";
    verifiedBeatCoverage: number;
    verifiedBlocks: number;
    reviewBlocks: number;
    noEvidenceBlocks: number;
    blocks: Array<{
      start: number;
      end: number;
      status: "verified" | "review" | "no-evidence";
      evidenceCoverage: number;
      medianResidualMs: number | null;
      p90ResidualMs: number | null;
      driftMs: number | null;
      dominantOffsetMs: number | null;
      phaseDominance: number | null;
      slippedBeats: number;
      ambiguousBeats: number;
      failureReason: "aligned" | "phase-offset" | "tempo-drift" | "ambiguous-kick-family" | "no-kick-evidence";
      bpm: number;
    }>;
  };
};

type Frame = { time: number; low: number; bassLow: number; bassHigh: number; mid: number; high: number; lowOnset: number; upperOnset: number; onset: number; kickEvidence: number };
type Onset = { time: number; strength: number; lowShare: number; lowEnergy: number; transientSupport: number };
type Fit = Omit<TempoHypothesis, "probability" | "metricalRelation"> & { period: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const MIN_KICK_TRANSIENT_SUPPORT = 0.55;
const MIN_PHASE_TRANSIENT_SUPPORT = 0.8;

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * clamp(fraction, 0, 1))] ?? 0;
}

function lowerBoundOnset(onsets: Onset[], time: number) {
  let low = 0;
  let high = onsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (onsets[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBoundTime(times: number[], time: number) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function kickOnsetScore(onset: Onset) {
  return onset.strength
    * (0.35 + clamp(onset.lowEnergy, 0, 1.5))
    * (0.45 + 0.55 * clamp(onset.transientSupport, 0, 1.5));
}

function interpolateAndSlewCorrections(targets: Array<number | null>, maximumStep: number) {
  const trusted = targets.map((value, index) => value === null ? null : index).filter((value): value is number => value !== null);
  if (!trusted.length) return targets.map(() => 0);
  const softened = targets.map((value, index) => {
    if (value === null) return null;
    const neighbourhood = targets.slice(Math.max(0, index - 4), index + 5).filter((item): item is number => item !== null);
    return median(neighbourhood);
  });
  const filled = targets.map((_, index) => {
    const exact = softened[index];
    if (exact !== null) return exact;
    let previous: number | undefined;
    let next: number | undefined;
    for (let cursor = trusted.length - 1; cursor >= 0; cursor -= 1) {
      if (trusted[cursor] < index) { previous = trusted[cursor]; break; }
    }
    for (const trustedIndex of trusted) {
      if (trustedIndex > index) { next = trustedIndex; break; }
    }
    if (previous === undefined) return softened[next!] ?? 0;
    if (next === undefined) return softened[previous] ?? 0;
    const fraction = (index - previous) / Math.max(1, next - previous);
    return (softened[previous] ?? 0) * (1 - fraction) + (softened[next] ?? 0) * fraction;
  });
  const forward = [...filled];
  for (let index = 1; index < forward.length; index += 1) {
    forward[index] = forward[index - 1] + clamp(filled[index] - forward[index - 1], -maximumStep, maximumStep);
  }
  const backward = [...filled];
  for (let index = backward.length - 2; index >= 0; index -= 1) {
    backward[index] = backward[index + 1] + clamp(filled[index] - backward[index + 1], -maximumStep, maximumStep);
  }
  return filled.map((_, index) => (forward[index] + backward[index]) / 2);
}

function modelContinuityCorrections(preliminary: GridBeat[], modelBeats: number[]) {
  if (modelBeats.length < 24) return preliminary.map(() => 0);
  const searchRadius = 0.16;
  const residuals = preliminary.map((beat) => {
    const insertion = lowerBoundTime(modelBeats, beat.nominalTime);
    const candidates = [modelBeats[insertion - 1], modelBeats[insertion]].filter((value): value is number => Number.isFinite(value));
    const nearest = candidates.sort((left, right) => Math.abs(left - beat.nominalTime) - Math.abs(right - beat.nominalTime))[0];
    return nearest !== undefined && Math.abs(nearest - beat.nominalTime) <= searchRadius ? nearest - beat.nominalTime : null;
  });
  const windowRadius = 16;
  const targets = residuals.map((_, centreIndex) => {
    const window = residuals.slice(Math.max(0, centreIndex - windowRadius), centreIndex + windowRadius + 1)
      .filter((value): value is number => value !== null);
    if (window.length < 12) return null;
    const centre = median(window);
    const inliers = window.filter((value) => Math.abs(value - centre) <= 0.035);
    if (inliers.length < 12 || inliers.length / window.length < 0.68) return null;
    const target = median(inliers);
    const spread = percentile(inliers.map((value) => Math.abs(value - target)), 0.9);
    return spread <= 0.026 ? clamp(target, -searchRadius, searchRadius) : null;
  });
  // At 145 BPM a 3 ms-per-beat slope can follow roughly 1% local tempo
  // movement, while still making an instantaneous model error impossible.
  return interpolateAndSlewCorrections(targets, 0.003);
}

function lowAlignmentCorrections(preliminary: GridBeat[], onsets: Onset[]) {
  // Inspect an overlapping neighbourhood around every beat. A 120 ms search
  // range is wide enough to recover an imprecise model phase, but deliberately
  // narrower than half a beat at club tempos: the offbeat bassline must never
  // be mistaken for the kick merely because it is louder.
  const windowRadius = 12;
  const searchRadius = 0.12;
  const binSeconds = 0.01;
  const targets: Array<number | null> = preliminary.map((_, centreIndex) => {
    const from = Math.max(0, centreIndex - windowRadius);
    const to = Math.min(preliminary.length - 1, centreIndex + windowRadius);
    const bins = new Map<number, { score: number; beats: Set<number> }>();
    const candidates: Array<{ beat: number; residual: number; score: number; lowEnergy: number; transientSupport: number }> = [];
    for (let beatIndex = from; beatIndex <= to; beatIndex += 1) {
      const nominalTime = preliminary[beatIndex].nominalTime;
      for (let onsetIndex = lowerBoundOnset(onsets, nominalTime - searchRadius); onsetIndex < onsets.length; onsetIndex += 1) {
        const onset = onsets[onsetIndex];
        if (onset.time > nominalTime + searchRadius) break;
        if (onset.lowEnergy < 0.32 || onset.lowShare < 0.16 || onset.transientSupport < MIN_PHASE_TRANSIENT_SUPPORT) continue;
        const residual = onset.time - nominalTime;
        const score = kickOnsetScore(onset);
        candidates.push({ beat: beatIndex, residual, score, lowEnergy: onset.lowEnergy, transientSupport: onset.transientSupport });
        const bin = Math.round(residual / binSeconds);
        const current = bins.get(bin) ?? { score: 0, beats: new Set<number>() };
        current.score += score;
        current.beats.add(beatIndex);
        bins.set(bin, current);
      }
    }
    if (!bins.size) return null;
    const ranked = [...bins].map(([bin]) => {
      const neighbours = [bin - 1, bin, bin + 1].map((key) => bins.get(key)).filter((item): item is { score: number; beats: Set<number> } => Boolean(item));
      const beats = new Set(neighbours.flatMap((item) => [...item.beats]));
      const score = neighbours.reduce((sum, item) => sum + item.score, 0) * (0.45 + 0.55 * Math.min(1, beats.size / 7));
      return { bin, score, beats };
    }).sort((left, right) => right.score - left.score);
    const peak = ranked[0];
    const competitor = ranked.find((item) => Math.abs(item.bin - peak.bin) >= 5);
    const dominance = peak.score / Math.max(0.001, competitor?.score ?? peak.score * 0.25);
    const peakResidual = peak.bin * binSeconds;
    const selected: Array<{ residual: number; score: number; lowEnergy: number; transientSupport: number }> = [];
    for (let beatIndex = from; beatIndex <= to; beatIndex += 1) {
      const nearest = candidates.filter((item) => item.beat === beatIndex && Math.abs(item.residual - peakResidual) <= 0.03)
        .sort((left, right) => right.score - left.score)[0];
      if (nearest) selected.push(nearest);
    }
    const windowLength = to - from + 1;
    const selectedResiduals = selected.map((item) => item.residual);
    const coverage = selectedResiduals.length / windowLength;
    const target = median(selectedResiduals);
    const spread = percentile(selectedResiduals.map((value) => Math.abs(value - target)), 0.9);
    const medianEnergy = median(selected.map((item) => item.lowEnergy));
    const medianStrength = median(selected.map((item) => item.score));
    const medianTransientSupport = median(selected.map((item) => item.transientSupport));
    return selectedResiduals.length >= 9 && coverage >= 0.45 && spread <= 0.028
      && medianEnergy >= 0.34 && medianStrength >= 0.1 && medianTransientSupport >= 0.12 && dominance >= 1.16
      ? clamp(target, -searchRadius, searchRadius)
      : null;
  });
  // About 2.5 ms of movement per beat is already a 0.6% local tempo change at
  // 145 BPM. Faster movement is almost always a phase-family switch, not a
  // real change of musical tempo.
  return interpolateAndSlewCorrections(targets, 0.0025);
}

type KickPhaseEvidence = {
  coverage: number;
  offset: number | null;
  spread: number | null;
  drift: number | null;
  dominance: number | null;
  strength: number;
};

function dominantKickPhase(
  beats: GridBeat[],
  onsets: Onset[],
  options: { searchRadius?: number; minTransientSupport?: number } = {},
): KickPhaseEvidence {
  if (beats.length < 4) return { coverage: 0, offset: null, spread: null, drift: null, dominance: null, strength: 0 };
  const intervals = beats.slice(1).map((beat, index) => beat.time - beats[index].time).filter((value) => value > 0.2 && value < 1.2);
  const period = intervals.length ? median(intervals) : 0.42;
  const searchRadius = Math.min(options.searchRadius ?? 0.2, period * 0.47);
  const minTransientSupport = options.minTransientSupport ?? MIN_PHASE_TRANSIENT_SUPPORT;
  const binSeconds = 0.01;
  const candidates: Array<{ beat: number; residual: number; score: number }> = [];
  const bins = new Map<number, Map<number, number>>();
  beats.forEach((beat, beatIndex) => {
    for (let onsetIndex = lowerBoundOnset(onsets, beat.time - searchRadius); onsetIndex < onsets.length; onsetIndex += 1) {
      const onset = onsets[onsetIndex];
      if (onset.time > beat.time + searchRadius) break;
      if (onset.lowEnergy < 0.28 || onset.strength < 0.07 || onset.transientSupport < minTransientSupport) continue;
      const residual = onset.time - beat.time;
      const score = kickOnsetScore(onset);
      candidates.push({ beat: beatIndex, residual, score });
      const bin = Math.round(residual / binSeconds);
      const beatScores = bins.get(bin) ?? new Map<number, number>();
      beatScores.set(beatIndex, Math.max(beatScores.get(beatIndex) ?? 0, score));
      bins.set(bin, beatScores);
    }
  });
  if (!bins.size) return { coverage: 0, offset: null, spread: null, drift: null, dominance: null, strength: 0 };
  const ranked = [...bins.keys()].map((bin) => {
    const beatScores = new Map<number, number>();
    for (const neighbour of [bin - 1, bin, bin + 1]) {
      for (const [beat, score] of bins.get(neighbour) ?? []) beatScores.set(beat, Math.max(beatScores.get(beat) ?? 0, score));
    }
    const coverage = beatScores.size / beats.length;
    const score = [...beatScores.values()].reduce((sum, value) => sum + value, 0) * (0.45 + 0.55 * Math.min(1, coverage / 0.65));
    return { bin, score, coverage };
  }).sort((left, right) => right.score - left.score);
  const peak = ranked[0];
  const competitor = ranked.find((item) => Math.abs(item.bin - peak.bin) >= 5);
  const peakResidual = peak.bin * binSeconds;
  const selected = beats.map((_, beatIndex) => candidates.filter((item) => item.beat === beatIndex && Math.abs(item.residual - peakResidual) <= 0.035)
    .sort((left, right) => right.score - left.score)[0]).filter((item): item is { beat: number; residual: number; score: number } => Boolean(item));
  if (!selected.length) return { coverage: 0, offset: null, spread: null, drift: null, dominance: null, strength: 0 };
  const residuals = selected.map((item) => item.residual);
  const offset = median(residuals);
  const spread = percentile(residuals.map((value) => Math.abs(value - offset)), 0.9);
  const midpoint = Math.floor(beats.length / 2);
  const first = selected.filter((item) => item.beat < midpoint).map((item) => item.residual);
  const second = selected.filter((item) => item.beat >= midpoint).map((item) => item.residual);
  const drift = first.length >= 3 && second.length >= 3 ? median(second) - median(first) : null;
  // Coverage over KICK-ACTIVE beats, not every beat: stem evidence (25 Aug
  // 2026) has genuinely silent breakdowns, and counting those in the
  // denominator vetoed phase corrections the evidence unanimously supported
  // (Bella Donna: offset +7ms, spread 6ms, dominance 129 — applied:false at
  // coverage 0.21). A floor keeps a sliver of kicks from anchoring a tune.
  const activeBeats = new Set(candidates.map((item) => item.beat)).size;
  const enoughActive = activeBeats >= Math.max(24, beats.length * 0.08);
  return {
    coverage: enoughActive ? selected.length / Math.max(1, activeBeats) : selected.length / beats.length,
    offset,
    spread,
    drift,
    dominance: peak.score / Math.max(0.001, competitor?.score ?? peak.score * 0.25),
    strength: selected.reduce((sum, item) => sum + item.score, 0) / beats.length,
  };
}

function dominantKickCorrections(beats: GridBeat[], onsets: Onset[]) {
  const blockSize = 16;
  const targets: Array<number | null> = beats.map(() => null);
  for (let start = 0; start < beats.length; start += blockSize) {
    const block = beats.slice(start, start + blockSize);
    const phase = dominantKickPhase(block, onsets, { searchRadius: 0.075, minTransientSupport: MIN_KICK_TRANSIENT_SUPPORT });
    const trusted = phase.offset !== null
      && phase.coverage >= 0.48
      && phase.spread !== null && phase.spread <= 0.032
      && phase.dominance !== null && phase.dominance >= 1.2
      && phase.strength >= 0.1;
    if (!trusted) continue;
    const slope = phase.drift === null ? 0 : clamp(phase.drift / Math.max(4, block.length / 2), -0.005, 0.005);
    const centre = (block.length - 1) / 2;
    for (let index = 0; index < block.length; index += 1) {
      targets[start + index] = clamp(phase.offset! + slope * (index - centre), -0.18, 0.18);
    }
  }
  return interpolateAndSlewCorrections(targets, 0.005);
}

/**
 * Move the whole grid onto the kick.
 *
 * The size of that move used to be capped at a flat 120 ms, which is not a
 * musical quantity: at 143 BPM a beat is 419 ms, so the cap sat at 29% of a
 * beat while `dominantKickPhase` searched out to 47% of one. Tracks whose grid
 * landed further out than the cap had their offset measured, reported in
 * `auditOffsetMs`, and then discarded — the correction returned 0 and the grid
 * was never moved at all. Across the library that left 60 of 110 tracks more
 * than 15 ms off their kicks, the worst of them 174 ms out, which is 42% of a
 * beat and nowhere near the kick it is supposed to mark.
 *
 * The bound is now the same one the search already uses, so anything the phase
 * detector can see, the grid can act on. What stops it snapping onto the
 * offbeat is evidence rather than distance: the offbeat sits half a beat away,
 * so a correction approaching that has to be a clearly dominant phase, not a
 * marginal one.
 */
const LARGE_ANCHOR_MOVE_FRACTION = .25;
/**
 * How far the anchor may move the grid, as a fraction of a beat.
 *
 * The phase detector searches out to 47% of a beat, but a candidate that far
 * out is usually the offbeat bassline rather than a misplaced grid, and it
 * arrives with crushing dominance because the offbeat really is a strong
 * periodic event. Measured across the library, corrections beyond ~36% of a
 * beat broke more grids than they fixed while those inside it were almost all
 * genuine. Dominance cannot separate the two; distance can.
 */
const MAX_ANCHOR_MOVE_FRACTION = .36;
/**
 * Coverage is the share of beats with a qualifying kick onset behind the
 * chosen phase. The floor was 0.35 while the library's well-placed tracks
 * average 0.264 and its badly-placed ones 0.209 — so it refused nearly
 * everything, and grids that came out right did so because the model phase was
 * already right rather than because the anchor helped. Tracks were being turned
 * away holding a spread of 0.019 and a dominance of 9.7.
 */
const MIN_ANCHOR_COVERAGE = .25;
const LARGE_ANCHOR_MIN_DOMINANCE = 1.5;

let lastAnchorDebug: Record<string, unknown> | null = null;
export function readLastAnchorDebug() { return lastAnchorDebug; }
function globalKickAnchorCorrection(beats: GridBeat[], onsets: Onset[]) {
  const phase = dominantKickPhase(beats, onsets);
  const intervals = beats.slice(1).map((beat, index) => beat.time - beats[index].time).filter((value) => value > 0.2 && value < 1.2);
  const period = intervals.length ? median(intervals) : 0.42;
  const maxMove = period * MAX_ANCHOR_MOVE_FRACTION;
  const move = Math.abs(phase.offset ?? 0);
  // A move worth a quarter of a beat or more is a claim that the grid is on
  // the wrong part of the bar. That needs stronger evidence than a nudge.
  const dominanceFloor = move >= period * LARGE_ANCHOR_MOVE_FRACTION ? LARGE_ANCHOR_MIN_DOMINANCE : 1.14;
  const trusted = phase.offset !== null
    && move <= maxMove
    && phase.coverage >= MIN_ANCHOR_COVERAGE
    && phase.spread !== null && phase.spread <= 0.038
    && phase.dominance !== null && phase.dominance >= dominanceFloor
    && phase.strength >= 0.08;
  lastAnchorDebug = { offsetMs: phase.offset === null ? null : Math.round(phase.offset * 1000), coverage: phase.coverage, spreadMs: phase.spread === null ? null : Math.round(phase.spread * 1000), dominance: phase.dominance, strength: phase.strength, applied: trusted };
  return trusted ? phase.offset! : 0;
}

function sustainedKickDriftCorrections(beats: GridBeat[], onsets: Onset[]) {
  const radius = 14;
  const searchRadius = 0.065;
  const targets: Array<number | null> = beats.map((_, centreIndex) => {
    const from = Math.max(0, centreIndex - radius);
    const to = Math.min(beats.length - 1, centreIndex + radius);
    const observations: Array<{ beat: number; residual: number; score: number }> = [];
    for (let beatIndex = from; beatIndex <= to; beatIndex += 1) {
      const time = beats[beatIndex].time;
      const candidates: Array<{ onset: Onset; residual: number; score: number }> = [];
      for (let onsetIndex = lowerBoundOnset(onsets, time - searchRadius); onsetIndex < onsets.length; onsetIndex += 1) {
        const onset = onsets[onsetIndex];
        if (onset.time > time + searchRadius) break;
        const residual = onset.time - time;
        if (onset.transientSupport >= MIN_PHASE_TRANSIENT_SUPPORT) {
          candidates.push({ onset, residual, score: kickOnsetScore(onset) * Math.exp(-Math.abs(residual) / 0.035) });
        }
      }
      const best = candidates.sort((left, right) => right.score - left.score)[0];
      if (best) observations.push({ beat: beatIndex, residual: best.residual, score: best.score });
    }
    const windowLength = to - from + 1;
    if (observations.length < 10 || observations.length / windowLength < 0.45) return null;
    const slopes: number[] = [];
    for (let right = 1; right < observations.length; right += 1) {
      for (let left = Math.max(0, right - 12); left < right; left += 1) {
        const span = observations[right].beat - observations[left].beat;
        if (span >= 4) slopes.push((observations[right].residual - observations[left].residual) / span);
      }
    }
    const slope = slopes.length ? median(slopes) : 0;
    if (Math.abs(slope) > 0.0035) return null;
    const intercept = median(observations.map((item) => item.residual - slope * (item.beat - centreIndex)));
    const errors = observations.map((item) => Math.abs(item.residual - (intercept + slope * (item.beat - centreIndex))));
    const inliers = errors.filter((error) => error <= 0.026).length;
    if (inliers / observations.length < 0.72 || percentile(errors, 0.9) > 0.032) return null;
    return clamp(intercept, -0.05, 0.05);
  });
  return interpolateAndSlewCorrections(targets, 0.0025);
}

/**
 * DJ, 26 Aug 2026 ("try it"): some tunes bend their own clock. Peak
 * Detector sags ~1.4% for ~70 s (192-262 s) and accumulates exactly one
 * beat of slip before re-locking; the bounded corrections above are capped
 * at a fixed distance, so the grid held its lattice and rode up to half a
 * beat off the kicks mid-sag. This tracker walks the tune in time order
 * carrying a running offset, so it can follow an arbitrarily deep sag —
 * but only ever CONTINUOUSLY:
 *  - engagement requires three consecutive trusted 16-beat blocks whose
 *    kick phase keeps growing the same way (>=4 ms per block, >=30 ms
 *    total), so noise or a merely-syncopated section (constant offset,
 *    no growth) can never trip it;
 *  - once engaged it follows at most 4 ms per beat and never jumps, so
 *    the offbeat stays unreachable by construction — path continuity
 *    replaces the amplitude clamp for that protection;
 *  - untrusted blocks (breakdowns) hold the carried offset: missing
 *    passages inherit the trajectory, exactly as everywhere else.
 * On a tune whose clock is straight the tracker never engages and this is
 * a row of zeros.
 */
function sustainedSagPath(beats: GridBeat[], onsets: Onset[]) {
  // 8-beat blocks: a 1.4% sag moves ~8 ms per block, so engagement completes
  // while the kicks are still inside the 75 ms search radius. 16-beat blocks
  // measured the ramp too slowly and the evidence escaped before three
  // trusted readings existed (Peak Detector: coverage fell to zero by 211 s).
  const blockSize = 8;
  const maxStepPerBeat = 0.005;
  const path = new Array<number>(beats.length).fill(0);
  let carried = 0;
  let engaged = false;
  const recent: Array<{ offset: number; blockIndex: number }> = [];
  let blockIndex = -1;
  for (let start = 0; start < beats.length; start += blockSize) {
    blockIndex += 1;
    const block = beats.slice(start, start + blockSize);
    const shifted = carried === 0 ? block : block.map((beat) => ({ ...beat, time: beat.time + carried }));
    const phase = dominantKickPhase(shifted, onsets, { searchRadius: 0.075, minTransientSupport: MIN_KICK_TRANSIENT_SUPPORT });
    const solid = phase.offset !== null
      && phase.spread !== null && phase.spread <= 0.032
      && phase.dominance !== null && phase.dominance >= 1.2;
    // Engagement demands full trust; following accepts thinner coverage —
    // the target is moving, so the radius only half-covers it mid-ramp.
    const engagementTrusted = solid && phase.coverage >= 0.48 && phase.strength >= 0.1;
    const followTrusted = solid && phase.coverage >= 0.3 && phase.strength >= 0.08;
    if (process.env.SAG_DEBUG && block.length && block[0].time > 180 && block[0].time < 280) {
      console.error(`sag-block t=${block[0].time.toFixed(1)} carried=${(carried * 1000).toFixed(0)}ms offset=${phase.offset === null ? "null" : (phase.offset * 1000).toFixed(0)} cov=${phase.coverage.toFixed(2)} spread=${phase.spread === null ? "null" : (phase.spread * 1000).toFixed(0)} str=${phase.strength.toFixed(2)} engage=${engagementTrusted} follow=${followTrusted} engaged=${engaged}`);
    }
    // Coverage flickers every other block mid-ramp (kicks at the search-radius
    // edge come and go), so engagement reads the follow-tier trail through a
    // short recency window rather than demanding consecutive trusted blocks.
    // The growth demand itself is unchanged: three same-sign readings, each
    // >=3 ms beyond the last, >=18 ms total — noise and constant-offset
    // (syncopated) sections still cannot engage it.
    if (!engaged && followTrusted) {
      recent.push({ offset: phase.offset!, blockIndex });
      while (recent.length && recent[0].blockIndex < blockIndex - 5) recent.shift();
      if (recent.length > 4) recent.shift();
      const tail = recent.slice(-3);
      const growing = tail.length === 3
        && Math.sign(tail[2].offset) === Math.sign(tail[0].offset)
        && Math.abs(tail[2].offset) > Math.abs(tail[1].offset) + 0.003
        && Math.abs(tail[1].offset) > Math.abs(tail[0].offset) + 0.003
        && Math.abs(tail[2].offset) - Math.abs(tail[0].offset) >= 0.018;
      if (growing) engaged = true;
    }
    if (engaged && followTrusted) carried += clamp(phase.offset!, -maxStepPerBeat * blockSize, maxStepPerBeat * blockSize);
    for (let index = start; index < Math.min(beats.length, start + blockSize); index += 1) path[index] = carried;
  }
  if (!engaged) return path;
  return interpolateAndSlewCorrections(path, maxStepPerBeat);
}

function auditEveryGridBeat(beats: GridBeat[], onsets: Onset[]) {
  const radius = 8;
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
    const window = beats.slice(Math.max(0, beatIndex - radius), Math.min(beats.length, beatIndex + radius + 1));
    const nearPhase = dominantKickPhase(window, onsets, { searchRadius: 0.075, minTransientSupport: MIN_KICK_TRANSIENT_SUPPORT });
    const nearPhaseIsUsable = nearPhase.offset !== null
      && nearPhase.coverage >= 0.35
      && nearPhase.spread !== null && nearPhase.spread <= 0.04
      && nearPhase.strength >= 0.07;
    // A wide strict scan is diagnostic only. It can say that the established
    // grid has slipped, but it is never fed back into the clock and therefore
    // cannot re-lock the deck to an offbeat bass family.
    const widePhase = nearPhaseIsUsable ? nearPhase : dominantKickPhase(window, onsets);
    const widePhaseIsUsable = !nearPhaseIsUsable
      && widePhase.offset !== null
      && widePhase.coverage >= 0.55
      && widePhase.spread !== null && widePhase.spread <= 0.028
      && widePhase.strength >= 0.11
      && (widePhase.dominance ?? 0) >= 1.55;
    const phase = nearPhaseIsUsable ? nearPhase : widePhase;
    const beat = beats[beatIndex];
    const insertion = lowerBoundOnset(onsets, beat.time);
    const candidates = [onsets[insertion - 1], onsets[insertion], onsets[insertion + 1]]
      .filter((item): item is Onset => Boolean(item) && Math.abs(item.time - beat.time) <= 0.075)
      .sort((left, right) => kickOnsetScore(right) - kickOnsetScore(left));
    // DJ, 25 Aug 2026: the transient-support demand stays for the FIRST look,
    // but a low onset on the beat with weak transient reading (the 4 kHz
    // evidence barely sees the crack on stems) is still a kick to capture,
    // not a beat to shrug at. Grid placement is decided long before this.
    // ...but a beat with NO kick must never earn a mark (DJ: breaks and
    // snare-only beats stay bare). The second chance therefore demands real
    // kick weight in the low band — a snare's low leak reads well under this.
    const nearby = candidates.find((item) => item.transientSupport >= MIN_KICK_TRANSIENT_SUPPORT)
      ?? candidates.find((item) => item.lowEnergy >= 0.34 && item.strength >= 0.09);
    const phaseIsUsable = nearPhaseIsUsable || widePhaseIsUsable;
    const phaseIsUnambiguous = phaseIsUsable && (phase.dominance ?? 0) >= 1.12;
    beat.auditOffsetMs = phase.offset === null ? null : phase.offset * 1000;
    beat.auditStrength = phase.strength;
    if (!phaseIsUsable) beat.kickStatus = nearby ? "ambiguous" : "inferred";
    else if (!phaseIsUnambiguous) beat.kickStatus = "ambiguous";
    else if (nearPhaseIsUsable && Math.abs(phase.offset!) <= 0.022) beat.kickStatus = nearby ? "aligned" : "inferred";
    // Offset is kick minus grid. A positive offset means the grid line arrived
    // early; a negative offset means the grid line arrived late.
    else beat.kickStatus = phase.offset! > 0 ? "early" : "late";
    // DJ, 25 Aug 2026: after the grid is set by the rules above (which stay
    // exactly as they are), a kick onset within the aligned tolerance IS a
    // captured kick — block-phase ambiguity must not paint it amber.
    if (nearby && Math.abs(nearby.time - beat.time) <= 0.022) beat.kickStatus = "aligned";
  }
}

function verifyGrid(beats: GridBeat[], duration: number, onsets: Onset[]): BeatGridAnalysis["verification"] {
  const blocks: BeatGridAnalysis["verification"]["blocks"] = [];
  const blockSize = 16;
  for (let startIndex = 0; startIndex < beats.length; startIndex += blockSize) {
    const block = beats.slice(startIndex, startIndex + blockSize);
    if (!block.length) continue;
    // Verification is deliberately stricter than visualization. A nearby low
    // fluctuation may still be shown for diagnosis, but only a sufficiently
    // sharp, well-aligned attack is allowed to certify a grid block.
    const phase = dominantKickPhase(block, onsets, { searchRadius: 0.075, minTransientSupport: MIN_KICK_TRANSIENT_SUPPORT });
    const evidenceCoverage = phase.coverage;
    const driftMs = phase.drift === null ? null : Math.abs(phase.drift * 1000);
    const intervals = block.slice(1).map((beat, index) => beat.time - block[index].time).filter((interval) => interval > 0.2 && interval < 1.2);
    const bpm = intervals.length ? 60 / median(intervals) : 0;
    const medianResidualMs = phase.offset === null ? null : Math.abs(phase.offset * 1000);
    const p90ResidualMs = phase.spread === null || phase.offset === null ? null : (Math.abs(phase.offset) + phase.spread) * 1000;
    const dominantOffsetMs = phase.offset === null ? null : phase.offset * 1000;
    const slippedBeats = block.filter((beat) => beat.kickStatus === "early" || beat.kickStatus === "late").length;
    const ambiguousBeats = block.filter((beat) => beat.kickStatus === "ambiguous").length;
    const status = evidenceCoverage < 0.28 || phase.strength < 0.065 ? (slippedBeats ? "review" : "no-evidence")
      : medianResidualMs! <= 20 && phase.spread! * 1000 <= 30 && (driftMs === null || driftMs <= 18)
        && (phase.dominance ?? 0) >= 1.16 && slippedBeats === 0 && ambiguousBeats <= 2 ? "verified"
        : "review";
    const failureReason = status === "verified" ? "aligned"
      : status === "no-evidence" ? "no-kick-evidence"
        : driftMs !== null && driftMs > 18 ? "tempo-drift"
          : medianResidualMs !== null && medianResidualMs > 20 ? "phase-offset"
            : "ambiguous-kick-family";
    blocks.push({ start: block[0].time, end: block.at(-1)?.time ?? duration, status, evidenceCoverage, medianResidualMs, p90ResidualMs, driftMs, dominantOffsetMs, phaseDominance: phase.dominance, slippedBeats, ambiguousBeats, failureReason, bpm });
  }
  const verifiedBlocks = blocks.filter((block) => block.status === "verified").length;
  const reviewBlocks = blocks.filter((block) => block.status === "review").length;
  const noEvidenceBlocks = blocks.filter((block) => block.status === "no-evidence").length;
  const evidencedBeats = blocks.filter((block) => block.status !== "no-evidence").reduce((sum, block) => sum + Math.max(1, Math.round(block.evidenceCoverage * blockSize)), 0);
  const verifiedBeats = blocks.filter((block) => block.status === "verified").reduce((sum, block) => sum + Math.max(1, Math.round(block.evidenceCoverage * blockSize)), 0);
  return {
    status: reviewBlocks ? "review" : verifiedBlocks ? "verified" : "insufficient-evidence",
    verifiedBeatCoverage: verifiedBeats / Math.max(1, evidencedBeats),
    verifiedBlocks,
    reviewBlocks,
    noEvidenceBlocks,
    blocks,
  };
}

function softmax(values: number[], temperature = 1) {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp((value - maximum) / Math.max(0.001, temperature)));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
}

function onePoleCoefficient(cutoff: number, sampleRate: number) {
  return 1 - Math.exp(-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate);
}

function frameEvidence(samples: Float32Array, sampleRate: number, hopSeconds: number) {
  const hop = Math.max(8, Math.round(sampleRate * hopSeconds));
  const low45 = onePoleCoefficient(45, sampleRate);
  const low180 = onePoleCoefficient(180, sampleRate);
  const low400 = onePoleCoefficient(400, sampleRate);
  const low800 = onePoleCoefficient(800, sampleRate);
  const lowMid = onePoleCoefficient(Math.min(1600, sampleRate * 0.38), sampleRate);
  // Cascaded one-pole sections give the low-band detector a much steeper
  // roll-off than a single filter. Without this, the broadband edge of a
  // hi-hat leaks into the low envelope and produces a false double-tempo grid.
  let lp45a = 0;
  let lp45b = 0;
  let lp45c = 0;
  let lp180a = 0;
  let lp180b = 0;
  let lp180c = 0;
  let lp400a = 0;
  let lp400b = 0;
  let lp800a = 0;
  let lp800b = 0;
  let lpMidA = 0;
  let lpMidB = 0;
  let lowSum = 0;
  let bassLowSum = 0;
  let bassHighSum = 0;
  let midSum = 0;
  let highSum = 0;
  const energies: Array<{ time: number; low: number; bassLow: number; bassHigh: number; mid: number; high: number }> = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    lp45a += low45 * (sample - lp45a);
    lp45b += low45 * (lp45a - lp45b);
    lp45c += low45 * (lp45b - lp45c);
    lp180a += low180 * (sample - lp180a);
    lp180b += low180 * (lp180a - lp180b);
    lp180c += low180 * (lp180b - lp180c);
    lp400a += low400 * (sample - lp400a);
    lp400b += low400 * (lp400a - lp400b);
    lp800a += low800 * (sample - lp800a);
    lp800b += low800 * (lp800a - lp800b);
    lpMidA += lowMid * (sample - lpMidA);
    lpMidB += lowMid * (lpMidA - lpMidB);
    const low = lp180c - lp45c;
    const bassLow = lp400b - lp180c;
    const bassHigh = lp800b - lp400b;
    const mid = lpMidB - lp180c;
    const high = sample - lpMidB;
    lowSum += low * low;
    bassLowSum += bassLow * bassLow;
    bassHighSum += bassHigh * bassHigh;
    midSum += mid * mid;
    highSum += high * high;
    if ((index + 1) % hop === 0 || index === samples.length - 1) {
      const count = index % hop + 1;
      energies.push({
        time: (index + 1 - count / 2) / sampleRate,
        low: Math.sqrt(lowSum / count),
        bassLow: Math.sqrt(bassLowSum / count),
        bassHigh: Math.sqrt(bassHighSum / count),
        mid: Math.sqrt(midSum / count),
        high: Math.sqrt(highSum / count),
      });
      lowSum = 0;
      bassLowSum = 0;
      bassHighSum = 0;
      midSum = 0;
      highSum = 0;
    }
  }
  const logLow = energies.map((frame) => Math.log1p(frame.low * 1500));
  const logMid = energies.map((frame) => Math.log1p(frame.mid * 900));
  const logHigh = energies.map((frame) => Math.log1p(frame.high * 700));
  const rawLowOnset = logLow.map((value, index) => Math.max(0, value - median(logLow.slice(Math.max(0, index - 4), index))));
  const rawMidOnset = logMid.map((value, index) => Math.max(0, value - median(logMid.slice(Math.max(0, index - 3), index))));
  const rawHighOnset = logHigh.map((value, index) => Math.max(0, value - median(logHigh.slice(Math.max(0, index - 2), index))));
  const rawUpperOnset = energies.map((_, index) => rawMidOnset[index] * 0.85 + rawHighOnset[index] * 0.4);
  const rawOnset = energies.map((_, index) => rawLowOnset[index] * 1.8 + rawUpperOnset[index]);
  const lowScale = percentile(rawLowOnset, 0.97) || 1;
  const upperScale = percentile(rawUpperOnset, 0.97) || 1;
  const onsetScale = percentile(rawOnset, 0.97) || 1;
  return energies.map((energy, index): Frame => {
    const lowOnset = clamp(rawLowOnset[index] / lowScale, 0, 3);
    const upperOnset = clamp(rawUpperOnset[index] / upperScale, 0, 3);
    return {
      ...energy,
      lowOnset,
      upperOnset,
      onset: clamp(rawOnset[index] / onsetScale, 0, 3),
      // A psytrance-style offbeat bass note can have more low-frequency energy
      // than the kick. Do not let low energy alone win: a kick candidate needs
      // the coincident broadband edge of the drum attack. The small floor
      // preserves deliberately soft kicks, while upper-only hats still cannot
      // create evidence without a low body.
      kickEvidence: Math.sqrt(lowOnset * upperOnset)
        * (0.08 + 0.92 * clamp(upperOnset / Math.max(0.08, lowOnset), 0, 2.5)),
    };
  });
}

function pickOnsets(frames: Frame[], hopSeconds: number) {
  const values = frames.map((frame) => frame.onset);
  const lowEnergyScale = percentile(frames.map((frame) => frame.low), 0.95) || 1;
  const centre = median(values);
  const threshold = Math.max(0.12, centre + 1.4 * median(values.map((value) => Math.abs(value - centre))));
  const candidates: Onset[] = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const frame = frames[index];
    if (frame.onset < threshold) continue;
    if (frame.onset < Math.max(values[index - 2], values[index - 1], values[index + 1], values[index + 2])) continue;
    candidates.push({
      time: frame.time,
      strength: frame.onset,
      lowShare: frame.lowOnset / Math.max(0.001, frame.onset),
      lowEnergy: clamp(frame.low / lowEnergyScale, 0, 3),
      transientSupport: clamp(frame.upperOnset / Math.max(0.08, frame.lowOnset), 0, 3),
    });
  }
  const minimumGap = Math.max(0.045, hopSeconds * 3);
  const selected: Onset[] = [];
  for (const onset of candidates) {
    const previous = selected.at(-1);
    if (!previous || onset.time - previous.time >= minimumGap) selected.push(onset);
    else if (onset.strength > previous.strength) selected[selected.length - 1] = onset;
  }
  return selected;
}

function pickLowOnsets(frames: Frame[], hopSeconds: number) {
  const values = frames.map((frame) => frame.lowOnset);
  const lowEnergyScale = percentile(frames.map((frame) => frame.low), 0.95) || 1;
  const centre = median(values);
  const threshold = Math.max(0.11, centre + 1.25 * median(values.map((value) => Math.abs(value - centre))));
  const candidates: Onset[] = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const frame = frames[index];
    if (frame.lowOnset < threshold) continue;
    if (frame.lowOnset < Math.max(values[index - 2], values[index - 1], values[index + 1], values[index + 2])) continue;
    const lowEnergy = clamp(frame.low / lowEnergyScale, 0, 3);
    if (lowEnergy < 0.12) continue;
    candidates.push({
      time: frame.time,
      // A kick-like event has a sharp low-frequency rise and a simultaneous
      // general transient. Slow bass-note movement can still be retained as
      // weak evidence, but cannot dominate a sharp kick cluster.
      strength: frame.kickEvidence,
      lowShare: 1,
      lowEnergy,
      transientSupport: clamp(frame.upperOnset / Math.max(0.08, frame.lowOnset), 0, 3),
    });
  }
  const minimumGap = Math.max(0.055, hopSeconds * 4);
  const selected: Onset[] = [];
  for (const onset of candidates) {
    const previous = selected.at(-1);
    if (!previous || onset.time - previous.time >= minimumGap) selected.push(onset);
    else if (onset.strength * (0.5 + onset.lowEnergy) > previous.strength * (0.5 + previous.lowEnergy)) selected[selected.length - 1] = onset;
  }
  return selected;
}

function autocorrelationTempoSeeds(frames: Frame[], hopSeconds: number) {
  const envelope = frames.map((frame) => frame.onset * (0.7 + 0.3 * clamp(frame.lowOnset, 0, 1.5)));
  const minimumLag = Math.max(2, Math.floor(60 / 210 / hopSeconds));
  const maximumLag = Math.min(envelope.length - 2, Math.ceil(60 / 55 / hopSeconds));
  const results: Array<{ bpm: number; score: number }> = [];
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let product = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let index = lag; index < envelope.length; index += 1) {
      const left = envelope[index];
      const right = envelope[index - lag];
      product += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    const score = product / Math.sqrt(Math.max(1e-9, leftPower * rightPower));
    results.push({ bpm: 60 / (lag * hopSeconds), score });
  }
  return results.filter((item, index) => (
    item.score >= (results[index - 1]?.score ?? -Infinity)
    && item.score >= (results[index + 1]?.score ?? -Infinity)
  )).sort((a, b) => b.score - a.score).slice(0, 16);
}

function intervalTempoSeeds(onsets: Onset[]) {
  const bins = new Map<number, number>();
  for (let right = 1; right < onsets.length; right += 1) {
    for (let left = Math.max(0, right - 12); left < right; left += 1) {
      const interval = onsets[right].time - onsets[left].time;
      if (interval < 0.24 || interval > 4.2) continue;
      for (let beatSpan = 1; beatSpan <= 8; beatSpan += 1) {
        const bpm = 60 * beatSpan / interval;
        if (bpm < 55 || bpm > 210) continue;
        const bin = Math.round(bpm * 5) / 5;
        const weight = Math.sqrt(onsets[left].strength * onsets[right].strength) / beatSpan;
        bins.set(bin, (bins.get(bin) ?? 0) + weight);
      }
    }
  }
  const maximum = Math.max(1, ...bins.values());
  return [...bins.entries()].map(([bpm, value]) => ({ bpm, score: value / maximum }))
    .sort((a, b) => b.score - a.score).slice(0, 24);
}

function phaseSeeds(onsets: Onset[], period: number) {
  const bins = 96;
  const histogram = new Float64Array(bins);
  for (const onset of onsets) {
    const phase = ((onset.time % period) + period) % period;
    const bin = Math.floor(phase / period * bins) % bins;
    histogram[bin] += onset.strength * (0.45 + 0.55 * clamp(onset.lowShare, 0, 1.5) + 0.8 * clamp(onset.lowEnergy, 0, 1.5));
  }
  const smoothed = [...histogram].map((_, index) => (
    histogram[(index + bins - 1) % bins] * 0.25
    + histogram[index] * 0.5
    + histogram[(index + 1) % bins] * 0.25
  ));
  return smoothed.map((score, index) => ({ phase: (index + 0.5) / bins * period, score }))
    .filter((item, index) => item.score >= smoothed[(index + bins - 1) % bins] && item.score >= smoothed[(index + 1) % bins])
    .sort((a, b) => b.score - a.score).slice(0, 3);
}

function robustGridFit(onsets: Onset[], initialBpm: number, initialPhase: number, seedScore: number): Fit | null {
  let period = 60 / initialBpm;
  let phase = initialPhase;
  let assignments: Array<{ onset: Onset; beat: number; residual: number; weight: number }> = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const tolerance = Math.min(0.09, period * 0.22);
    assignments = onsets.map((onset) => {
      const beat = Math.round((onset.time - phase) / period);
      const residual = onset.time - (phase + beat * period);
      const huber = Math.abs(residual) <= 0.025 ? 1 : 0.025 / Math.max(0.025, Math.abs(residual));
      const weight = onset.strength * (0.5 + 0.55 * clamp(onset.lowShare, 0, 1.5) + 0.9 * clamp(onset.lowEnergy, 0, 1.5)) * huber;
      return { onset, beat, residual, weight };
    }).filter((item) => Math.abs(item.residual) <= tolerance);
    if (assignments.length < 8) return null;
    const weightSum = assignments.reduce((sum, item) => sum + item.weight, 0) || 1;
    const beatMean = assignments.reduce((sum, item) => sum + item.beat * item.weight, 0) / weightSum;
    const timeMean = assignments.reduce((sum, item) => sum + item.onset.time * item.weight, 0) / weightSum;
    const denominator = assignments.reduce((sum, item) => sum + item.weight * (item.beat - beatMean) ** 2, 0);
    if (denominator <= 0) return null;
    const nextPeriod = assignments.reduce((sum, item) => sum + item.weight * (item.beat - beatMean) * (item.onset.time - timeMean), 0) / denominator;
    if (nextPeriod < 60 / 215 || nextPeriod > 60 / 50) return null;
    period = nextPeriod;
    phase = median(assignments.map((item) => item.onset.time - item.beat * period));
  }
  const residuals = assignments.map((item) => Math.abs(item.onset.time - (phase + item.beat * period)) * 1000);
  const uniqueBeats = [...new Set(assignments.map((item) => item.beat))].sort((a, b) => a - b);
  const span = Math.max(1, (uniqueBeats.at(-1) ?? 0) - (uniqueBeats[0] ?? 0) + 1);
  const coverage = uniqueBeats.length / span;
  const matchedOnsetRatio = assignments.length / Math.max(1, onsets.length);
  let longest = 1;
  let run = 1;
  for (let index = 1; index < uniqueBeats.length; index += 1) {
    run = uniqueBeats[index] - uniqueBeats[index - 1] <= 2 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const continuity = longest / Math.max(1, uniqueBeats.length);
  const medianResidualMs = median(residuals);
  const p90ResidualMs = percentile(residuals, 0.9);
  const lowAgreement = assignments.reduce((sum, item) => sum + clamp(item.onset.lowShare, 0, 1.5), 0) / Math.max(1, assignments.length);
  // A grid can obtain an artificially high onset-match score by treating hats
  // between kicks as additional beats (the classic double-tempo error). Count
  // how completely the low-frequency attacks occupy the proposed grid. The
  // faster candidate is retained, but a candidate whose kick evidence appears
  // only on every second grid line should not become the primary beat grid.
  const lowBeatCount = new Set(assignments
    .filter((item) => item.onset.lowEnergy >= 0.3)
    .map((item) => item.beat)).size;
  const lowPulseCoverage = lowBeatCount / span;
  const beatLowStrength = new Map<number, number>();
  for (const item of assignments) {
    const value = item.onset.strength * clamp(item.onset.lowEnergy, 0, 1.5);
    beatLowStrength.set(item.beat, Math.max(beatLowStrength.get(item.beat) ?? 0, value));
  }
  const barPositionMeans = [0, 1, 2, 3].map((position) => {
    const values = [...beatLowStrength].filter(([beat]) => ((beat % 4) + 4) % 4 === position).map(([, value]) => value);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  });
  const barAccentContrast = Math.max(...barPositionMeans) - median(barPositionMeans);
  const score = seedScore * 1.6
    + coverage * 5
    + matchedOnsetRatio * 2.8
    + continuity * 0.7
    + lowAgreement * 0.35
    + lowPulseCoverage * 2.8
    - medianResidualMs / 55
    - p90ResidualMs / 180;
  return {
    bpm: 60 / period,
    period,
    phase: ((phase % period) + period) % period,
    score,
    coverage,
    matchedOnsetRatio,
    medianResidualMs,
    p90ResidualMs,
    continuity,
    lowPulseCoverage,
    barAccentContrast,
  };
}

function buildHypotheses(frames: Frame[], onsets: Onset[], hopSeconds: number) {
  // Dense mastered audio can expose dozens of tiny transients per beat. Keep
  // the strongest low-supported event in each short time cell for the costly
  // hypothesis fitting, while retaining every onset for final attack
  // refinement. This bounds runtime without shortening the track or losing
  // evidence from quiet structural sections.
  const fittingOnsets: Onset[] = [];
  const fittingCellSeconds = 0.12;
  for (const onset of onsets) {
    const cell = Math.floor(onset.time / fittingCellSeconds);
    const previous = fittingOnsets.at(-1);
    if (!previous || Math.floor(previous.time / fittingCellSeconds) !== cell) fittingOnsets.push(onset);
    else if (onset.strength * (0.6 + onset.lowEnergy) > previous.strength * (0.6 + previous.lowEnergy)) fittingOnsets[fittingOnsets.length - 1] = onset;
  }
  const seeds = [...autocorrelationTempoSeeds(frames, hopSeconds), ...intervalTempoSeeds(fittingOnsets)];
  const expanded = seeds.flatMap((seed) => [
    seed,
    { bpm: seed.bpm / 2, score: seed.score * 0.82 },
    { bpm: seed.bpm * 2, score: seed.score * 0.86 },
  ]).filter((seed) => seed.bpm >= 55 && seed.bpm <= 210)
    .sort((a, b) => b.score - a.score);
  const deduplicated: Array<{ bpm: number; score: number }> = [];
  for (const seed of expanded) {
    if (!deduplicated.some((item) => Math.abs(item.bpm - seed.bpm) < 0.65)) deduplicated.push(seed);
    if (deduplicated.length >= 20) break;
  }
  const fits: Fit[] = [];
  for (const seed of deduplicated) {
    const period = 60 / seed.bpm;
    for (const phase of phaseSeeds(fittingOnsets, period)) {
      const fit = robustGridFit(fittingOnsets, seed.bpm, phase.phase, seed.score + phase.score / Math.max(1, fittingOnsets.length));
      if (fit && !fits.some((item) => {
        const phaseDelta = Math.abs(item.phase - fit.phase);
        const circularPhaseDelta = Math.min(phaseDelta, Math.max(0, fit.period - phaseDelta));
        return Math.abs(item.bpm - fit.bpm) < 0.08 && circularPhaseDelta < 0.02;
      })) fits.push(fit);
    }
  }
  const scoreOrdered = fits.sort((a, b) => b.score - a.score).slice(0, 8);
  if (scoreOrdered.length === 0) throw new Error("No stable beat-grid hypothesis could be established");
  const nearTied = scoreOrdered.filter((fit) => fit.score >= scoreOrdered[0].score - 0.02);
  const winner = [...nearTied].sort((a, b) => b.barAccentContrast - a.barAccentContrast)[0];
  const ordered = [winner, ...scoreOrdered.filter((fit) => fit !== winner)];
  const probabilities = softmax(ordered.map((fit) => fit.score), 0.35);
  const primary = ordered[0].bpm;
  return ordered.map((fit, index): TempoHypothesis => ({
    ...fit,
    probability: probabilities[index],
    metricalRelation: index === 0
      ? "primary"
      : Math.abs(fit.bpm - primary / 2) < 1 ? "half"
        : Math.abs(fit.bpm - primary * 2) < 1 ? "double"
          : "alternative",
  }));
}

function downbeatHypotheses(beats: GridBeat[], frames: Frame[], hopSeconds: number) {
  const scores = [0, 1, 2, 3].map((rotation) => {
    let score = 0;
    let weight = 0;
    for (const beat of beats) {
      if (((beat.beat - rotation) % 4 + 4) % 4 !== 0) continue;
      const frame = frames[Math.round(beat.time / hopSeconds)];
      const previous = frames[Math.max(0, Math.round(beat.time / hopSeconds) - 2)];
      if (!frame) continue;
      const structuralLift = Math.max(0, frame.low - (previous?.low ?? frame.low)) + Math.max(0, frame.high - (previous?.high ?? frame.high));
      const local = beat.strength * 1.4 + structuralLift * 3 + (beat.attackTime === null ? 0 : 0.25);
      score += local * Math.max(0.2, beat.confidence);
      weight += Math.max(0.2, beat.confidence);
    }
    return { rotation: rotation as 0 | 1 | 2 | 3, score: score / Math.max(1, weight), probability: 0 };
  });
  const probabilities = softmax(scores.map((item) => item.score), 0.2);
  return scores.map((item, index) => ({ ...item, probability: probabilities[index] })).sort((a, b) => b.score - a.score);
}

type PhraseBoundaryCandidate = {
  beatIndex: number;
  barIndex: number;
  score: number;
  confidence: number;
  anchorOffset: number | null;
  reason: PhraseSection["reason"];
};

type BarFeature = { low: number; mid: number; high: number; onset: number; kick: number };

function meanBarFeatures(features: BarFeature[], start: number, end: number): BarFeature {
  const from = Math.max(0, start);
  const to = Math.min(features.length, end);
  if (to <= from) return { low: 0, mid: 0, high: 0, onset: 0, kick: 0 };
  const total = { low: 0, mid: 0, high: 0, onset: 0, kick: 0 };
  for (let index = from; index < to; index += 1) {
    total.low += features[index].low;
    total.mid += features[index].mid;
    total.high += features[index].high;
    total.onset += features[index].onset;
    total.kick += features[index].kick;
  }
  const count = to - from;
  return { low: total.low / count, mid: total.mid / count, high: total.high / count, onset: total.onset / count, kick: total.kick / count };
}

function structuralDistance(left: BarFeature, right: BarFeature) {
  const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(.08, Math.max(a, b));
  return relative(left.low, right.low) * .34
    + relative(left.mid, right.mid) * .19
    + relative(left.high, right.high) * .19
    + relative(left.onset, right.onset) * .15
    + relative(left.kick, right.kick) * .13;
}

type CrashEvidenceScales = { high: number; mid: number };

function meanFrameBand(frames: Frame[], key: "high" | "mid", from: number, to: number) {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(frames.length, Math.max(start + 1, Math.ceil(to)));
  let total = 0;
  for (let index = start; index < end; index += 1) total += frames[index][key];
  return total / Math.max(1, end - start);
}

function frameBandOccupancy(frames: Frame[], key: "high" | "mid", from: number, to: number, threshold: number) {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(frames.length, Math.max(start + 1, Math.ceil(to)));
  let occupied = 0;
  for (let index = start; index < end; index += 1) if (frames[index][key] >= threshold) occupied += 1;
  return occupied / Math.max(1, end - start);
}

function crashCymbalEvidence(frames: Frame[], frameIndex: number, hopSeconds: number, scales: CrashEvidenceScales) {
  const framesFor = (seconds: number) => seconds / hopSeconds;
  const attackFrom = Math.max(0, Math.floor(frameIndex - framesFor(.15)));
  const attackTo = Math.min(frames.length, Math.ceil(frameIndex + framesFor(.18)));
  let attack = 0;
  for (let index = attackFrom; index < attackTo; index += 1) attack = Math.max(attack, frames[index].upperOnset);
  const preHigh = meanFrameBand(frames, "high", frameIndex - framesFor(.62), frameIndex - framesFor(.12)) / scales.high;
  const bodyHigh = meanFrameBand(frames, "high", frameIndex - framesFor(.02), frameIndex + framesFor(.22)) / scales.high;
  const tailHigh = meanFrameBand(frames, "high", frameIndex + framesFor(.22), frameIndex + framesFor(.92)) / scales.high;
  const bodyMid = meanFrameBand(frames, "mid", frameIndex - framesFor(.02), frameIndex + framesFor(.28)) / scales.mid;
  // A crash is a broadband edge followed by a high-frequency wash. Hats can
  // produce the edge, but their short tail cannot supply the sustain term.
  // A ride pattern can supply ongoing high energy, but without a fresh lift
  // and mid-band body it cannot score strongly enough to move a phrase.
  const onset = clamp(attack / 1.35, 0, 1);
  const sustain = clamp((bodyHigh * .38 + tailHigh * .62) / .72, 0, 1);
  const lift = clamp((Math.max(bodyHigh, tailHigh) - preHigh + .02) / .36, 0, 1);
  const denseMixLift = clamp((Math.max(bodyHigh, tailHigh) - preHigh + .08) / .42, 0, 1);
  const broadband = clamp(bodyMid / .78, 0, 1);
  const tailOccupancy = frameBandOccupancy(frames, "high", frameIndex + framesFor(.12), frameIndex + framesFor(.86), Math.max(.16, preHigh * 1.08) * scales.high);
  const continuousWash = clamp((tailOccupancy - .14) / .58, 0, 1);
  const crashTexture = .12 + sustain * .46 + broadband * .18;
  const exposedCrash = onset * crashTexture * (.42 + lift * .58) * (.32 + continuousWash * .68);
  // In an already dense upper-frequency passage there may be no quiet floor
  // from which to measure continuous occupancy. There the crash is still only
  // a *local structural confirmer*, so use its attack/body/tail shape rather
  // than rejecting it merely because the mix was bright beforehand.
  const denseMixCrash = onset * (.18 + sustain * .42 + denseMixLift * .24 + broadband * .16);
  const denseMix = clamp((preHigh - .35) / .2, 0, 1);
  return clamp(exposedCrash * (1 - denseMix) + denseMixCrash * denseMix, 0, 1);
}

function strictPhraseKickAnchor(beats: GridBeat[], beatIndex: number, onsets: Onset[]) {
  const residuals: number[] = [];
  for (let index = beatIndex; index < Math.min(beats.length, beatIndex + 8); index += 1) {
    const beat = beats[index];
    const insertion = lowerBoundOnset(onsets, beat.time - .055);
    let strongest: { residual: number; score: number } | null = null;
    for (let onsetIndex = insertion; onsetIndex < onsets.length; onsetIndex += 1) {
      const onset = onsets[onsetIndex];
      if (onset.time > beat.time + .055) break;
      if (onset.lowEnergy < .32 || onset.transientSupport < MIN_KICK_TRANSIENT_SUPPORT) continue;
      const residual = onset.time - beat.time;
      const score = kickOnsetScore(onset) * Math.exp(-Math.abs(residual) / .025);
      if (!strongest || score > strongest.score) strongest = { residual, score };
    }
    if (strongest) residuals.push(strongest.residual);
  }
  if (residuals.length < 4) return null;
  const centre = median(residuals);
  const inliers = residuals.filter((residual) => Math.abs(residual - centre) <= .018);
  if (inliers.length < 4 || inliers.length / residuals.length < .6) return null;
  const target = median(inliers);
  const spread = percentile(inliers.map((residual) => Math.abs(residual - target)), .9);
  return spread <= .014 ? clamp(target, -.025, .025) : null;
}

function detectPhraseBoundaries(beats: GridBeat[], frames: Frame[], hopSeconds: number, onsets: Onset[]) {
  const bars = beats.map((beat, beatIndex) => ({ beat, beatIndex })).filter(({ beat }) => beat.isDownbeat);
  if (bars.length < 2) return [] as PhraseBoundaryCandidate[];
  const barFeatures = bars.map(({ beat }, barIndex): BarFeature => {
    const estimatedPeriod = beats.length > 1 ? Math.max(.1, beats[1].time - beats[0].time) : .5;
    const end = bars[barIndex + 1]?.beat.time ?? Math.min(frames.length * hopSeconds, beat.time + estimatedPeriod * 4);
    const from = Math.max(0, Math.floor(beat.time / hopSeconds));
    const to = Math.min(frames.length, Math.max(from + 1, Math.ceil(end / hopSeconds)));
    const totals = { low: 0, mid: 0, high: 0, onset: 0, kick: 0 };
    for (let frameIndex = from; frameIndex < to; frameIndex += 1) {
      const frame = frames[frameIndex];
      totals.low += frame.low;
      totals.mid += frame.mid;
      totals.high += frame.high;
      totals.onset += frame.onset;
      totals.kick += frame.kickEvidence;
    }
    const count = Math.max(1, to - from);
    return { low: totals.low / count, mid: totals.mid / count, high: totals.high / count, onset: totals.onset / count, kick: totals.kick / count };
  });
  const crashScales: CrashEvidenceScales = {
    high: percentile(frames.map((frame) => frame.high), .92) || 1,
    mid: percentile(frames.map((frame) => frame.mid), .92) || 1,
  };
  const crashAtBeat = beats.map((beat) => {
    const centre = Math.round(beat.time / hopSeconds);
    const radius = Math.max(1, Math.round(.18 / hopSeconds));
    let evidence = 0;
    // Grid audit may report a local attack a little early or late. Match the
    // cymbal to the musical beat within that audited tolerance instead of
    // demanding that its spectral peak occupy the exact 10 ms grid frame.
    for (let frameIndex = Math.max(0, centre - radius); frameIndex <= Math.min(frames.length - 1, centre + radius); frameIndex += 1) {
      evidence = Math.max(evidence, crashCymbalEvidence(frames, frameIndex, hopSeconds, crashScales));
    }
    return evidence;
  });
  const phraseGridAnchor = (beatIndex: number) => {
    const strict = strictPhraseKickAnchor(beats, beatIndex, onsets);
    if (strict !== null) return strict;
    const beat = beats[beatIndex];
    const residual = beat?.attackTime === null || beat?.attackTime === undefined
      ? null
      : beat.attackTime - beat.time;
    // A sparse phrase opening may not contain the four kicks required by the
    // normal grid anchor. A strong crash plus a strong low transient on the
    // proposed phrase beat is independent evidence for that one exact edge.
    // Keep the tolerance narrow so a cymbal cannot pull the grid to a nearby
    // offbeat or replace the continuity model through a breakdown.
    if (residual === null
      || (crashAtBeat[beatIndex] ?? 0) < .78
      || beat.strength < .7
      || beat.confidence < .65
      || Math.abs(residual) > .014) return null;
    return residual;
  };
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
    beats[beatIndex].crashConfidence = crashAtBeat[beatIndex];
    const frameIndex = Math.round(beats[beatIndex].time / hopSeconds);
    beats[beatIndex].crashHighBed = meanFrameBand(frames, "high", frameIndex - .62 / hopSeconds, frameIndex - .12 / hopSeconds) / crashScales.high;
  }
  const scored = bars.map((bar, barIndex) => {
    if (barIndex === 0) return { ...bar, barIndex, score: Infinity };
    const before = meanBarFeatures(barFeatures, barIndex - 2, barIndex);
    const after = meanBarFeatures(barFeatures, barIndex, barIndex + 2);
    const boundaryFrame = frames[Math.max(0, Math.round(bar.beat.time / hopSeconds))];
    const boundaryAccent = boundaryFrame ? clamp(boundaryFrame.onset + boundaryFrame.kickEvidence, 0, 3) / 3 : 0;
    return { ...bar, barIndex, score: structuralDistance(before, after) + boundaryAccent * .18 };
  });
  const finiteScores = scored.slice(1).map((candidate) => candidate.score).filter(Number.isFinite);
  const threshold = percentile(finiteScores, .72);
  const maximum = Math.max(threshold, ...finiteScores);
  const selected: PhraseBoundaryCandidate[] = [{
    beatIndex: bars[0].beatIndex,
    barIndex: 0,
    score: maximum,
    confidence: .9,
    anchorOffset: phraseGridAnchor(bars[0].beatIndex),
    reason: "track-start",
  }];
  const structural = scored.slice(1).filter((candidate) => candidate.score >= threshold)
    .sort((left, right) => right.score - left.score);
  for (const candidate of structural) {
    if (selected.some((boundary) => Math.abs(boundary.barIndex - candidate.barIndex) < 4)) continue;
    // The downbeat model supplies the bar-level structural proposal, then a
    // nearby crash is allowed to correct its exact beat. This handles a local
    // half-bar reset without letting every cymbal invent a new phrase.
    const originalCrash = crashAtBeat[candidate.beatIndex] ?? 0;
    const crashAnchor = beats.map((beat, beatIndex) => ({ beat, beatIndex, score: crashAtBeat[beatIndex] ?? 0 }))
      .filter(({ beatIndex }) => Math.abs(beatIndex - candidate.beatIndex) <= 2)
      .sort((left, right) => right.score - left.score)[0];
    const crashCorrectsAnchor = Boolean(crashAnchor
      && crashAnchor.beatIndex !== candidate.beatIndex
      && crashAnchor.score >= .52
      && crashAnchor.score >= originalCrash + .04);
    const beatIndex = crashCorrectsAnchor ? crashAnchor!.beatIndex : candidate.beatIndex;
    selected.push({
      beatIndex,
      barIndex: candidate.barIndex,
      score: candidate.score,
      confidence: clamp(.48 + .52 * (candidate.score - threshold) / Math.max(.001, maximum - threshold) + (crashCorrectsAnchor ? .08 : 0), .48, 1),
      anchorOffset: phraseGridAnchor(beatIndex),
      reason: crashCorrectsAnchor ? "crash-confirmed" : "structural-change",
    });
  }
  selected.sort((left, right) => left.barIndex - right.barIndex);
  // Do not let a long, low-novelty passage erase musical counting. Insert a
  // conservative continuity marker only after sixteen uninterrupted bars.
  for (let boundaryIndex = 0; boundaryIndex < selected.length; boundaryIndex += 1) {
    const current = selected[boundaryIndex];
    const nextBar = selected[boundaryIndex + 1]?.barIndex ?? bars.length;
    const gapBars = nextBar - current.barIndex;
    if (gapBars <= 16) continue;
    const targetBar = Math.min(bars.length - 1, current.barIndex + Math.max(8, Math.min(16, Math.round(gapBars / 8) * 4)));
    const nearby = scored.filter((candidate) => candidate.barIndex >= targetBar - 2 && candidate.barIndex <= targetBar + 2
      && candidate.barIndex >= current.barIndex + 4 && candidate.barIndex <= nextBar - 4)
      .sort((left, right) => right.score - left.score)[0] ?? scored[targetBar];
    selected.splice(boundaryIndex + 1, 0, {
      beatIndex: nearby.beatIndex,
      barIndex: nearby.barIndex,
      score: nearby.score,
      confidence: .34,
      anchorOffset: phraseGridAnchor(nearby.beatIndex),
      reason: "periodic-continuity",
    });
  }
  return selected;
}

function phraseAnchorCorrections(length: number, boundaries: PhraseBoundaryCandidate[]) {
  const anchors = boundaries.filter((boundary): boundary is PhraseBoundaryCandidate & { anchorOffset: number } => boundary.anchorOffset !== null)
    .map((boundary) => ({ beatIndex: boundary.beatIndex, correction: boundary.anchorOffset }));
  if (anchors.length < 2) return Array.from({ length }, () => 0);
  return Array.from({ length }, (_, beatIndex) => {
    const nextAnchorIndex = anchors.findIndex((anchor) => anchor.beatIndex >= beatIndex);
    if (nextAnchorIndex === 0) return anchors[0].correction;
    if (nextAnchorIndex === -1) return anchors.at(-1)!.correction;
    const previous = anchors[nextAnchorIndex - 1];
    const next = anchors[nextAnchorIndex];
    const fraction = (beatIndex - previous.beatIndex) / Math.max(1, next.beatIndex - previous.beatIndex);
    return previous.correction * (1 - fraction) + next.correction * fraction;
  });
}

function buildPhraseSections(beats: GridBeat[], boundaries: PhraseBoundaryCandidate[], duration: number): PhraseSection[] {
  return boundaries.map((boundary, phraseIndex) => {
    const next = boundaries[phraseIndex + 1];
    const endIndex = next?.beatIndex ?? beats.length;
    const phraseBeats = beats.slice(boundary.beatIndex, endIndex);
    const localBpms = phraseBeats.slice(1).map((beat, index) => 60 / Math.max(.001, beat.time - phraseBeats[index].time)).filter((bpm) => bpm >= 55 && bpm <= 210);
    const start = beats[boundary.beatIndex]?.time ?? 0;
    const end = next ? beats[next.beatIndex].time : duration;
    for (let beatIndex = boundary.beatIndex; beatIndex < endIndex; beatIndex += 1) {
      beats[beatIndex].phraseIndex = phraseIndex;
      beats[beatIndex].phraseConfidence = boundary.confidence;
    }
    const startBeat = beats[boundary.beatIndex]?.beat ?? 0;
    const endBeat = next ? beats[next.beatIndex].beat : (beats.at(-1)?.beat ?? startBeat) + 1;
    if (beats[boundary.beatIndex]) beats[boundary.beatIndex].isPhraseStart = true;
    return {
      index: phraseIndex,
      start,
      end,
      startBeat,
      endBeat,
      bars: Math.max(1, Math.round((endBeat - startBeat) / 4)),
      bpm: Math.round((median(localBpms) || 0) * 1000) / 1000,
      confidence: boundary.confidence,
      anchorOffsetMs: boundary.anchorOffset === null ? null : Math.round(boundary.anchorOffset * 100000) / 100,
      reason: boundary.reason,
    };
  });
}

function overview(frames: Frame[], key: "low" | "onset" | "kickEvidence", points = 1400) {
  const result: number[] = [];
  const width = Math.max(1, Math.ceil(frames.length / points));
  for (let start = 0; start < frames.length; start += width) {
    result.push(Math.max(...frames.slice(start, start + width).map((frame) => frame[key])));
  }
  const scale = percentile(result, 0.98) || 1;
  return result.map((value) => clamp(value / scale, 0, 1));
}

function fitModelWindow(beats: number[], seedBpm: number) {
  const modelOnsets: Onset[] = beats.map((time) => ({ time, strength: 1, lowShare: 1, lowEnergy: 1, transientSupport: 1 }));
  return phaseSeeds(modelOnsets, 60 / seedBpm)
    .map((seed) => robustGridFit(modelOnsets, seedBpm, seed.phase, 2.5))
    .filter((fit): fit is Fit => fit !== null)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function detectTempoSections(beats: number[], globalBpm: number, duration: number) {
  const windowSeconds = 16;
  const windows: Array<{ start: number; end: number; bpm: number; confidence: number }> = [];
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const local = beats.filter((time) => time >= start - 1 && time <= end + 1);
    const span = Math.min(12, Math.floor((local.length - 1) / 3));
    const bpms: number[] = [];
    if (span >= 4) {
      for (let index = 0; index + span < local.length; index += 1) {
        const bpm = 60 * span / (local[index + span] - local[index]);
        if (bpm >= 55 && bpm <= 210 && bpm >= globalBpm * 0.65 && bpm <= globalBpm * 1.45) bpms.push(bpm);
      }
    }
    const bpm = bpms.length ? median(bpms) : (windows.at(-1)?.bpm ?? globalBpm);
    const deviation = bpms.length ? median(bpms.map((value) => Math.abs(value - bpm))) : 5;
    windows.push({ start, end, bpm, confidence: clamp(1 - deviation / 3, 0.1, 1) });
  }
  const smoothed = windows.map((window, index) => ({
    ...window,
    bpm: median(windows.slice(Math.max(0, index - 1), index + 2).map((item) => item.bpm)),
  }));
  const sections: Array<{ start: number; end: number; bpm: number; confidence: number; samples: number[] }> = [];
  for (let index = 0; index < smoothed.length; index += 1) {
    const window = smoothed[index];
    const current = sections.at(-1);
    const next = smoothed[index + 1];
    const sustainedChange = current
      && Math.abs(window.bpm - median(current.samples)) >= 0.8
      && window.confidence >= 0.55
      && next
      && next.confidence >= 0.55
      && Math.abs(next.bpm - median(current.samples)) >= 0.8
      && Math.abs(next.bpm - window.bpm) < 0.6;
    if (!current || sustainedChange) sections.push({ start: window.start, end: window.end, bpm: window.bpm, confidence: window.confidence, samples: [window.bpm] });
    else {
      current.end = window.end;
      current.samples.push(window.bpm);
      current.bpm = median(current.samples);
      current.confidence = Math.min(current.confidence, window.confidence);
    }
  }
  if (sections.length > 1 && sections.at(-1)!.end - sections.at(-1)!.start < 24) {
    const last = sections.pop()!;
    const previous = sections.at(-1)!;
    previous.end = last.end;
    previous.samples.push(...last.samples);
    previous.bpm = median(previous.samples);
    previous.confidence = Math.min(previous.confidence, last.confidence);
  }
  return sections.map(({ samples: _samples, ...section }) => ({ ...section, bpm: Math.round(section.bpm * 1000) / 1000 }));
}

function fitModelBeats(modelBeats: number[], duration: number) {
  const clean = modelBeats.filter((time) => Number.isFinite(time) && time >= 0 && time <= duration).sort((a, b) => a - b);
  if (clean.length < 32) return null;
  const span = Math.min(16, Math.floor(clean.length / 4));
  const localBpms: number[] = [];
  for (let index = 0; index + span < clean.length; index += 1) {
    const bpm = 60 * span / (clean[index + span] - clean[index]);
    if (bpm >= 55 && bpm <= 210) localBpms.push(bpm);
  }
  if (localBpms.length < 12) return null;
  const seedBpm = median(localBpms);
  const fit = fitModelWindow(clean, seedBpm);
  if (!fit) return null;
  return { fit, beats: clean, tempoSections: detectTempoSections(clean, fit.bpm, duration) };
}

function modelDownbeatHypotheses(beats: GridBeat[], proposals: number[]) {
  const counts = [0, 0, 0, 0];
  let matched = 0;
  for (const proposal of proposals) {
    const nearest = beats.reduce<GridBeat | null>((best, beat) => Math.abs(beat.time - proposal) < Math.abs((best?.time ?? Infinity) - proposal) ? beat : best, null);
    if (!nearest || Math.abs(nearest.time - proposal) > 0.11) continue;
    counts[((nearest.beat % 4) + 4) % 4] += 1;
    matched += 1;
  }
  if (matched < 4) return null;
  const scores = counts.map((count, rotation) => ({ rotation: rotation as 0 | 1 | 2 | 3, score: count / matched, probability: 0 }));
  const probabilities = softmax(scores.map((item) => item.score), 0.12);
  return scores.map((item, index) => ({ ...item, probability: probabilities[index] })).sort((a, b) => b.score - a.score);
}

export function analyzeBeatGrid(samples: Float32Array, sampleRate: number, options: { hopSeconds?: number; modelBeats?: number[]; modelDownbeats?: number[] } = {}): BeatGridAnalysis {
  if (samples.length < sampleRate * 4) throw new Error("At least four seconds of audio is required");
  const hopSeconds = options.hopSeconds ?? 0.01;
  const frames = frameEvidence(samples, sampleRate, hopSeconds);
  const onsets = pickOnsets(frames, hopSeconds);
  const lowOnsets = pickLowOnsets(frames, hopSeconds);
  if (onsets.length < 12) throw new Error("Not enough rhythmic onset evidence");
  const signalHypotheses = buildHypotheses(frames, onsets, hopSeconds);
  const duration = samples.length / sampleRate;
  const model = fitModelBeats(options.modelBeats ?? [], duration);
  const fittedModelHypothesis: TempoHypothesis | null = model ? {
    ...model.fit,
    probability: clamp(0.55 + model.fit.coverage * 0.35 - model.fit.p90ResidualMs / 500, 0.35, 0.92),
    metricalRelation: "primary",
  } : null;
  let hypotheses = model && fittedModelHypothesis
    ? [fittedModelHypothesis, ...signalHypotheses.filter((item) => Math.abs(item.bpm - fittedModelHypothesis.bpm) >= 0.08).map((item) => ({ ...item, probability: item.probability * (1 - fittedModelHypothesis.probability) }))].slice(0, 8)
    : signalHypotheses;
  let selected = hypotheses[0];
  let period = 60 / selected.bpm;
  let tempoSections = model ? model.tempoSections.length === 1
    ? [{ ...model.tempoSections[0], bpm: model.fit.bpm, fit: model.fit }]
    : model.tempoSections.map((section) => {
      const proposals = model.beats.filter((time) => time >= section.start - 2 && time <= section.end + 2);
      const fit = fitModelWindow(proposals, section.bpm);
      return { ...section, bpm: fit?.bpm ?? section.bpm, fit };
    })
    : [{ start: 0, end: duration, bpm: selected.bpm, confidence: selected.probability, fit: null as Fit | null }];
  // Validate rate before phase correction: nudging a wrongly spaced lattice
  // onto one kick only hides the error until the next few beats drift away.
  let tempoSectionEvidence: TempoSectionEvidence[] | undefined;
  if (model && tempoSections.length > 1) {
    const kicks = detectKicks(samples, sampleRate);
    // A contaminated intro can also slightly bias the whole-track estimate.
    // Prefer a long, tightly fitted section near it; the independent kick
    // comparison below still has to prove this reference fits the disputed part.
    let referenceFit = tempoSections
      .filter(section => section.end - section.start >= 32 && section.fit
        && Math.abs(section.bpm / model.fit.bpm - 1) < .008
        && section.fit.coverage >= .8 && section.fit.p90ResidualMs <= 25)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]?.fit ?? model.fit;
    tempoSectionEvidence = tempoSections.map(section => assessTempoSection(section, referenceFit.bpm, kicks));
    if (tempoSectionEvidence.some(check => check.decision === "contradicted-by-kicks")) {
      // Only after a measured contradiction, independently refine the reference.
      // A cold model pass may bias both the local and whole-track estimates.
      const positive = kicks.filter(kick => kick.strength > 0);
      const floor = median(positive.map(kick => kick.strength)) * .3;
      const strongTimes = positive.filter(kick => kick.strength >= floor).map(kick => kick.time);
      const seed = kickTempoSeed(strongTimes, referenceFit.bpm);
      const measuredFit = seed === null ? null : fitModelWindow(strongTimes, seed);
      if (measuredFit && measuredFit.coverage >= .75 && measuredFit.matchedOnsetRatio >= .8
        && measuredFit.p90ResidualMs <= 20 && Math.abs(measuredFit.bpm / referenceFit.bpm - 1) < .008) {
        referenceFit = measuredFit;
        tempoSectionEvidence = tempoSections.map(section => assessTempoSection(section, referenceFit.bpm, kicks, true));
      }
      tempoSections = tempoSections.map((section, index) => tempoSectionEvidence![index].decision === "contradicted-by-kicks"
        ? { ...section, bpm: referenceFit.bpm, fit: referenceFit }
        : section);
      if (tempoSections.every(section => Math.abs(section.bpm - referenceFit.bpm) < .05)) {
        // Do not move a neighbouring section's valid phase merely because its
        // rounded BPM is close. Collapse only when every section was disproved.
        if (tempoSectionEvidence.every(check => check.decision === "contradicted-by-kicks")) {
          tempoSections = [{ start: 0, end: duration, bpm: referenceFit.bpm, confidence: selected.probability, fit: referenceFit }];
        }
        selected = { ...selected, ...referenceFit };
        period = referenceFit.period;
        hypotheses = [selected, ...hypotheses.slice(1)];
      }
    }
  }
  const nominalTimes: number[] = [];
  for (const section of tempoSections) {
    const sectionFit = section.fit ?? (tempoSections.length === 1 ? model?.fit ?? null : null);
    const sectionPeriod = 60 / (sectionFit?.bpm ?? section.bpm);
    const sectionPhase = sectionFit?.phase ?? selected.phase;
    const first = Math.floor((section.start - sectionPhase) / sectionPeriod) - 1;
    const last = Math.ceil((section.end - sectionPhase) / sectionPeriod) + 1;
    for (let beat = first; beat <= last; beat += 1) {
      const time = sectionPhase + beat * sectionPeriod;
      if (time >= section.start && time < section.end && time >= 0 && time <= duration) nominalTimes.push(time);
    }
  }
  nominalTimes.sort((a, b) => a - b);
  const uniqueTimes = nominalTimes.filter((time, index) => index === 0 || time - nominalTimes[index - 1] > 0.18);
  const preliminary: GridBeat[] = uniqueTimes.map((nominalTime, beat) => ({
    beat, time: nominalTime, nominalTime, attackTime: null, residualMs: null,
    strength: 0, confidence: 0.08, isDownbeat: false, beatInBar: 1,
    kickStatus: "inferred", auditOffsetMs: null, auditStrength: 0,
    isPhraseStart: false, phraseIndex: null, phraseConfidence: 0, crashConfidence: 0, crashHighBed: 0,
  }));

  // The model supplies continuity. A strict full-track kick phase establishes
  // the anchor, then a narrow local regression may follow only sustained drift.
  //
  // Continuity is where the beat tracker earns its keep, and it was described
  // here without ever being applied: the grid was generated as phase + n *
  // period and stayed a metronome, so the model contributed a BPM and nothing
  // else. Sampled grids came out with 0.0 ms of jitter on 20 of 25 tracks —
  // correct on a tune locked to a click, unable to follow one that breathes.
  //
  // The model's own beat times cannot simply be adopted instead: they arrive on
  // a 20 ms frame grid, so taking them verbatim would stamp ±10 ms of
  // quantisation noise onto music that does not have it. Following the
  // trajectory rather than the samples is the point — a median across ±16
  // beats, an inlier test, and a 3 ms-per-beat slew, so sustained movement is
  // tracked and a single stray frame cannot bend the grid.
  const continuity = model ? modelContinuityCorrections(preliminary, model.beats) : preliminary.map(() => 0);
  const continuous = preliminary.map((beat, index) => {
    const nominalTime = beat.nominalTime + continuity[index];
    return { ...beat, nominalTime, time: nominalTime };
  });
  const alignmentOnsets = lowOnsets.length >= 12 ? lowOnsets : onsets.filter((onset) => onset.lowEnergy >= 0.3);
  const globalAnchor = globalKickAnchorCorrection(continuous, alignmentOnsets);
  const globallyAnchored = continuous.map((beat) => ({ ...beat, time: beat.nominalTime + globalAnchor }));
  // The sag path is applied OUTSIDE the +/-0.12 clamp: it is continuity-bound
  // and rate-limited instead, and the fine drift below measures against the
  // sagged positions so the two never double-count the same evidence.
  const sagPath = sustainedSagPath(globallyAnchored, alignmentOnsets);
  const sagPeak = sagPath.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  if (lastAnchorDebug) lastAnchorDebug = { ...lastAnchorDebug, sagEngaged: sagPeak > 0, sagPeakMs: Math.round(sagPeak * 1000) };
  const saggedBeats = sagPeak > 0 ? globallyAnchored.map((beat, index) => ({ ...beat, time: beat.time + sagPath[index] })) : globallyAnchored;
  const localDrift = sustainedKickDriftCorrections(saggedBeats, alignmentOnsets);
  const anchorCorrections = localDrift.map((value, index) => clamp(globalAnchor + value, -0.12, 0.12) + sagPath[index]);
  // Missing or ambiguous passages inherit that trajectory; they never trigger
  // a fresh phase search and therefore cannot pull the grid onto an offbeat.
  const correctionRange = percentile(anchorCorrections, 0.9) - percentile(anchorCorrections, 0.1);
  let mode: "constant" | "piecewise" = correctionRange > 0.015 || tempoSections.length > 1 ? "piecewise" : "constant";
  const constantCorrection = median(anchorCorrections);
  // DJ, 27 Aug 2026 ("fix and test"): the audit gained its stem second
  // chance on 25 Aug — a low onset on the beat whose 4 kHz transient reading
  // is weak is still a kick — but the attack STAMP kept the full-mix-only
  // gate, so beats read "aligned" while attackTime stayed null, and every
  // consumer of the stamps (the kick-phase comparator, the preview verdict
  // line) starved at 0-4% usable beats. Same rule, same thresholds as the
  // audit's second chance, applied to the stamp. Grid placement unchanged.
  const stampableKick = (onset: Onset) => (onset.lowEnergy >= 0.32 && onset.transientSupport >= MIN_KICK_TRANSIENT_SUPPORT)
    || (onset.lowEnergy >= 0.34 && onset.strength >= 0.09);
  const beats = continuous.map((beat, index) => {
    const time = beat.nominalTime + (mode === "piecewise" ? anchorCorrections[index] : constantCorrection);
    const nearby = alignmentOnsets.filter((onset) => stampableKick(onset) && Math.abs(onset.time - time) <= 0.07)
      .map((onset) => ({ onset, score: kickOnsetScore(onset) * Math.exp(-Math.abs(onset.time - time) / 0.03) }))
      .sort((a, b) => b.score - a.score)[0];
    const attackTime = nearby?.onset.time ?? null;
    const residualMs = attackTime === null ? null : (attackTime - time) * 1000;
    const confidence = attackTime === null ? 0.08 : clamp(0.35 + nearby.score * 0.42 - Math.abs(residualMs ?? 0) / 140, 0, 1);
    return { ...beat, time, attackTime, residualMs, strength: nearby?.onset.strength ?? 0, confidence };
  });
  const downbeats = modelDownbeatHypotheses(beats, options.modelDownbeats ?? []) ?? downbeatHypotheses(beats, frames, hopSeconds);
  const selectedRotation = downbeats[0].rotation;
  for (const beat of beats) {
    const position = ((beat.beat - selectedRotation) % 4 + 4) % 4;
    beat.beatInBar = (position + 1) as 1 | 2 | 3 | 4;
    beat.isDownbeat = position === 0;
  }
  const phraseBoundaries = detectPhraseBoundaries(beats, frames, hopSeconds, alignmentOnsets);
  const phraseCorrections = phraseAnchorCorrections(beats.length, phraseBoundaries);
  const phraseCorrectionRange = percentile(phraseCorrections, .9) - percentile(phraseCorrections, .1);
  if (phraseCorrectionRange > .015) mode = "piecewise";
  if (phraseCorrections.some((correction) => Math.abs(correction) > .0005)) {
    for (let index = 0; index < beats.length; index += 1) {
      const beat = beats[index];
      beat.time += phraseCorrections[index];
      const nearby = alignmentOnsets.filter((onset) => stampableKick(onset) && Math.abs(onset.time - beat.time) <= .07)
        .map((onset) => ({ onset, score: kickOnsetScore(onset) * Math.exp(-Math.abs(onset.time - beat.time) / .03) }))
        .sort((left, right) => right.score - left.score)[0];
      beat.attackTime = nearby?.onset.time ?? null;
      beat.residualMs = beat.attackTime === null ? null : (beat.attackTime - beat.time) * 1000;
      beat.strength = nearby?.onset.strength ?? 0;
      beat.confidence = beat.attackTime === null ? .08 : clamp(.35 + nearby.score * .42 - Math.abs(beat.residualMs ?? 0) / 140, 0, 1);
    }
  }
  const phrases = buildPhraseSections(beats, phraseBoundaries, duration);
  auditEveryGridBeat(beats, alignmentOnsets);
  const uncertainty: BeatGridAnalysis["uncertainty"] = [];
  let uncertainStart: number | null = null;
  for (const beat of beats) {
    if (beat.confidence < 0.3 && uncertainStart === null) uncertainStart = beat.time;
    if (beat.confidence >= 0.3 && uncertainStart !== null) {
      uncertainty.push({ start: uncertainStart, end: beat.time, reason: "weak or ambiguous percussive evidence" });
      uncertainStart = null;
    }
  }
  if (uncertainStart !== null) uncertainty.push({ start: uncertainStart, end: duration, reason: "weak or ambiguous percussive evidence" });
  const verification = verifyGrid(beats, duration, alignmentOnsets);
  return {
    version: GRID_ANALYSIS_VERSION,
    duration,
    sampleRate,
    hopSeconds,
    mode,
    evidenceMode: model ? "beat-model-plus-multiband" : "multiband-signal",
    tempoSections: tempoSections.map(({ fit: _fit, ...section }) => ({ ...section, bpm: Math.round(section.bpm * 1000) / 1000 })),
    ...(tempoSectionEvidence ? { tempoSectionEvidence } : {}),
    selected,
    hypotheses,
    downbeats,
    beats,
    phrases,
    waveform: overview(frames, "onset"),
    lowWaveform: overview(frames, "low"),
    lowWaveformDetailed: (() => {
      const scale = percentile(frames.map((frame) => frame.low), 0.98) || 1;
      return frames.map((frame) => Math.round(clamp(frame.low / scale, 0, 1) * 1000) / 1000);
    })(),
    // Preserve the bassline harmonics above the kick/sub band. This lets the
    // phrase locator recognise a bassline gap even while the kick continues
    // to keep 45-180 Hz energy high.
    bassLowWaveformDetailed: (() => {
      const scale = percentile(frames.map((frame) => frame.bassLow), 0.98) || 1;
      return frames.map((frame) => Math.round(clamp(frame.bassLow / scale, 0, 1) * 1000) / 1000);
    })(),
    bassHighWaveformDetailed: (() => {
      const scale = percentile(frames.map((frame) => frame.bassHigh), 0.98) || 1;
      return frames.map((frame) => Math.round(clamp(frame.bassHigh / scale, 0, 1) * 1000) / 1000);
    })(),
    lowAttackWaveformDetailed: frames.map((frame) => Math.round(clamp(frame.lowOnset / 2, 0, 1) * 1000) / 1000),
    upperAttackWaveformDetailed: frames.map((frame) => Math.round(clamp(frame.upperOnset / 2, 0, 1) * 1000) / 1000),
    crashWaveformDetailed: (() => {
      const scales: CrashEvidenceScales = {
        high: percentile(frames.map((frame) => frame.high), .92) || 1,
        mid: percentile(frames.map((frame) => frame.mid), .92) || 1,
      };
      return frames.map((_, index) => Math.round(crashCymbalEvidence(frames, index, hopSeconds, scales) * 1000) / 1000);
    })(),
    kickWaveformDetailed: (() => {
      // Widen each 10 ms analysis peak slightly so it remains visible when the
      // booth downsamples a 16-second window to a few hundred SVG points.
      const widened = frames.map((_, index) => Math.max(...frames.slice(Math.max(0, index - 2), index + 3).map((frame) => frame.kickEvidence)));
      const scale = percentile(widened, 0.98) || 1;
      return widened.map((value) => Math.round(clamp(value / scale, 0, 1) * 1000) / 1000);
    })(),
    uncertainty,
    verification,
  };
}

/**
 * Why the kick anchor did or did not move a given grid.
 *
 * `globalKickAnchorCorrection` refuses on any one of four independent grounds
 * and returns a bare 0 either way, so a grid sitting well off its kicks looks
 * identical to one that needed no correction at all. This reports the evidence
 * behind that decision so the two can be told apart, and so a guard that is
 * wrong can be told from evidence that is genuinely weak.
 *
 * Diagnostic only: it computes what the analyser would compute and changes
 * nothing.
 */
export function kickAnchorDiagnostics(samples: Float32Array, sampleRate: number, beatTimes: number[], hopSeconds = 0.01) {
  const frames = frameEvidence(samples, sampleRate, hopSeconds);
  const onsets = pickOnsets(frames, hopSeconds);
  const lowOnsets = pickLowOnsets(frames, hopSeconds);
  const alignmentOnsets = lowOnsets.length >= 12 ? lowOnsets : onsets.filter((onset) => onset.lowEnergy >= 0.3);
  const beats: GridBeat[] = beatTimes.map((time, beat) => ({
    beat, time, nominalTime: time, attackTime: null, residualMs: null,
    strength: 0, confidence: 0, isDownbeat: false, beatInBar: 1,
    kickStatus: "inferred", auditOffsetMs: null, auditStrength: 0,
    isPhraseStart: false, phraseIndex: null, phraseConfidence: 0, crashConfidence: 0, crashHighBed: 0,
  }));
  const phase = dominantKickPhase(beats, alignmentOnsets);
  const intervals = beats.slice(1).map((beat, index) => beat.time - beats[index].time).filter((value) => value > 0.2 && value < 1.2);
  const period = intervals.length ? median(intervals) : 0.42;
  const move = Math.abs(phase.offset ?? 0);
  const dominanceFloor = move >= period * LARGE_ANCHOR_MOVE_FRACTION ? LARGE_ANCHOR_MIN_DOMINANCE : 1.14;
  const fails: string[] = [];
  if (phase.offset === null) fails.push("no phase");
  if (move > period * MAX_ANCHOR_MOVE_FRACTION) fails.push("move");
  if (phase.coverage < MIN_ANCHOR_COVERAGE) fails.push("coverage");
  if (!(phase.spread !== null && phase.spread <= 0.038)) fails.push("spread");
  if (!(phase.dominance !== null && phase.dominance >= dominanceFloor)) fails.push("dominance");
  if (phase.strength < 0.08) fails.push("strength");
  return {
    period,
    offsetMs: phase.offset === null ? null : phase.offset * 1000,
    coverage: phase.coverage,
    spread: phase.spread,
    dominance: phase.dominance,
    strength: phase.strength,
    dominanceFloor,
    onsetCount: alignmentOnsets.length,
    usedLowOnsets: lowOnsets.length >= 12,
    applied: fails.length === 0,
    fails,
  };
}

/**
 * Can a kick be told from an offbeat bass note by its harmonics?
 *
 * `dominantKickPhase` has to choose between two credible phases on tunes with
 * a rolling offbeat bassline, and it sometimes picks the bass: measured across
 * the library, candidates 39-45% of a beat away from an already-correct grid
 * arrived with dominance as high as 8.6. The onset features it chooses from —
 * strength, low energy, transient support — describe how sharp and how loud an
 * event is, not where its energy sits, so a bass pluck can outscore a kick.
 *
 * The frames already separate the kick band from the bassline harmonics above
 * it, and that split is discarded when onsets are built. This reports it so the
 * question can be settled with numbers rather than assumed: for each onset, how
 * much of its energy is below 180 Hz versus in the 180-800 Hz harmonics.
 *
 * Diagnostic only.
 */
export function onsetBandDiagnostics(samples: Float32Array, sampleRate: number, hopSeconds = 0.01) {
  const frames = frameEvidence(samples, sampleRate, hopSeconds);
  const onsets = pickLowOnsets(frames, hopSeconds);
  const frameAt = (time: number) => {
    let best = frames[0];
    for (const frame of frames) if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
    return best;
  };
  return onsets.map((onset) => {
    const frame = frameAt(onset.time);
    const harmonics = frame.bassLow + frame.bassHigh;
    return {
      time: onset.time,
      strength: onset.strength,
      lowEnergy: onset.lowEnergy,
      transientSupport: onset.transientSupport,
      lowShare: onset.lowShare,
      // How concentrated this event is in the kick band rather than the
      // bassline harmonics that sit above it.
      subDominance: frame.low / Math.max(0.0001, frame.low + harmonics),
      low: frame.low,
      bassLow: frame.bassLow,
      bassHigh: frame.bassHigh,
      kickEvidence: frame.kickEvidence,
    };
  });
}

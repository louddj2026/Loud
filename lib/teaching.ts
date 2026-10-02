import type { DemoAnalysis, DemoBeat } from "./demo-set.ts";

export type PreferredCueTeaching = {
  time: number;
  crowdSuggestedTime: number;
  nearestCrowdBeatTime: number;
  cueVsCrowdMs: number;
  cueVsGridMs: number;
  selectedAt: string;
  /**
   * Who put this cue here. Absent means the DJ did, which is the only kind that
   * is evidence.
   *
   * A cue placed from All-In-One's chorus labels is a guess the app made about
   * itself. Mining those as though they were DJ's own marks is the circularity
   * that killed the pre-cue bass dip — 18 of 22 "taught" mix-outs turned out to
   * sit exactly on the app's own `exitHandoff`, so the signal described the
   * phrase locator rather than the DJ. Anything learning from this corpus must
   * skip the ones that are stamped.
   */
  source?: "label-cue";
};

export type ManualCyclePurpose = "cycle" | "intro-loop" | "outro-transition";

export type ManualCycleTeaching = {
  start: number;
  end: number;
  beats: number;
  bpm: number;
  tempoEvidenceWeight?: number;
  tempoAuthority?: "supporting" | "strong" | "decisive";
  crowdBpm: number;
  crowdNearestStart: number;
  crowdNearestEnd: number;
  startVsGridMs: number;
  endVsGridMs: number;
  bpmDelta: number;
  cueEdge?: "start" | "end";
  exitSide?: "before" | "after";
  purpose?: ManualCyclePurpose;
  selectedAt: string;
};

export type AnalysisTeaching = {
  preferredCue?: PreferredCueTeaching;
  preferredEntryCue?: PreferredCueTeaching;
  manualCycle?: ManualCycleTeaching;
  manualIntroCycle?: ManualCycleTeaching;
  manualOutroCycle?: ManualCycleTeaching;
  predictedCue?: LearnedCuePrediction;
  predictedEntryCue?: LearnedCuePrediction;
};

export type LearnedCuePrediction = {
  time: number;
  score: number;
  samples: number;
  kickScore: number;
  waveformScore: number;
};

export function manualWindowPurposeAt(teaching: AnalysisTeaching | undefined, start: number): "intro-loop" | "outro-transition" {
  const legacy = teaching?.manualCycle;
  const intro = teaching?.manualIntroCycle ?? (legacy?.purpose === "intro-loop" ? legacy : undefined);
  const outro = teaching?.manualOutroCycle ?? (legacy?.purpose === "outro-transition" ? legacy : undefined);
  if (!intro && !outro) return "intro-loop";
  if (!intro) return start < outro!.start ? "intro-loop" : "outro-transition";
  if (!outro) return start > intro.start ? "outro-transition" : "intro-loop";
  return start < (intro.start + outro.start) / 2 ? "intro-loop" : "outro-transition";
}

export function withoutStoredCuePlacements<T extends TeachableAnalysis>(analysis: T): T {
  const {
    preferredCue: _preferredCue,
    preferredEntryCue: _preferredEntryCue,
    manualCycle: _manualCycle,
    manualIntroCycle: _manualIntroCycle,
    manualOutroCycle: _manualOutroCycle,
    predictedCue: _predictedCue,
    predictedEntryCue: _predictedEntryCue,
    ...nonPlacementTeaching
  } = analysis.teaching ?? {};
  return { ...analysis, teaching: nonPlacementTeaching } as T;
}

export function withRestoredManualWindows<T extends TeachableAnalysis>(analysis: T, stored: TeachableAnalysis): T {
  const manualCycle = stored.teaching?.manualCycle;
  const manualIntroCycle = stored.teaching?.manualIntroCycle;
  const manualOutroCycle = stored.teaching?.manualOutroCycle;
  if (!manualCycle && !manualIntroCycle && !manualOutroCycle) return analysis;
  return {
    ...analysis,
    teaching: {
      ...analysis.teaching,
      ...(manualCycle ? { manualCycle } : {}),
      ...(manualIntroCycle ? { manualIntroCycle } : {}),
      ...(manualOutroCycle ? { manualOutroCycle } : {}),
    },
  } as T;
}

export type CueTeachingMoment = PreferredCueTeaching & {
  kind: "cue";
  role?: "mix-in" | "mix-out";
  trackId: string;
  semanticLabel?: "kick-cycle-start";
  userFeatures: CueFeatureVector;
  crowdFeatures: CueFeatureVector;
  gridFeatures?: CueFeatureVector;
  cycleEvidence?: CueCycleEvidence;
};

export type CycleTeachingMoment = ManualCycleTeaching & {
  kind: "loop-grid";
  trackId: string;
};

export type TeachingMoment = CueTeachingMoment | CycleTeachingMoment;

export function manualTempoEvidenceWeight(beats: number) {
  if (!Number.isFinite(beats) || beats < 1) return 0;
  return Math.min(16, Math.max(1, beats / 4));
}

export function manualTempoAuthority(beats: number): NonNullable<ManualCycleTeaching["tempoAuthority"]> {
  if (beats >= 64) return "decisive";
  if (beats >= 32) return "strong";
  return "supporting";
}

export function tempoRateAfterManualTempoTeaching(beats: number, currentTempoRate: number) {
  return manualTempoAuthority(beats) === "supporting"
    ? currentTempoRate
    : 1;
}

export function latestAuthoritativeManualTempo(moments: readonly TeachingMoment[]) {
  return moments.find((moment): moment is CycleTeachingMoment =>
    moment.kind === "loop-grid"
    && manualTempoAuthority(moment.beats) !== "supporting"
    && Number.isFinite(moment.start)
    && Number.isFinite(moment.end)
    && moment.end > moment.start
    && Number.isInteger(moment.beats)
  ) ?? null;
}

export type TeachingProfile = {
  totalMoments: number;
  cueMoments: number;
  mixInCueMoments: number;
  mixOutCueMoments: number;
  gridCorrectionMoments: number;
  cycleMoments: number;
  inferredCycleMoments: number;
  learnedCueOffsetMs: number;
  learnedGridOffsetMs: number;
  learnedBpmRatio: number;
  commonCycleBeats: number | null;
  cycleRepeatPattern: LearnedCycleRepeat[];
  kickCyclePattern: LearnedCuePattern | null;
  cuePattern: LearnedCuePattern | null;
  crowdCuePattern: LearnedCuePattern | null;
  entryCuePattern: LearnedCuePattern | null;
  crowdEntryCuePattern: LearnedCuePattern | null;
  correctedGridPattern: LearnedCuePattern | null;
  missedGridPattern: LearnedCuePattern | null;
  theories: TeachingTheory[];
};

export type TeachingTheory = {
  id: string;
  label: string;
  role: "mix-in" | "mix-out" | "cycle" | "grid";
  samples: number;
  userScore: number;
  crowdScore: number;
  lift: number;
  winRate: number;
  status: "forming" | "supported" | "inconclusive" | "contradicted";
};

export type CueFeatureVector = {
  trackPosition: number;
  beatPhase: number;
  beatInBar: number;
  cyclePosition: number;
  phrasePosition: number;
  phraseSpanBeats: number;
  gridConfidence: number;
  lowBefore: number;
  lowAfter: number;
  lowChange: number;
  kickAtCue: number;
  bassLowAtCue?: number;
  bassHighAtCue?: number;
  lowAttackAtCue?: number;
  upperAttackAtCue: number;
  crashAtCue: number;
  lowPattern: number[];
  kickPattern: number[];
  bassLowShape?: number[];
  bassHighShape?: number[];
  kickShape?: number[];
  upperAttackShape?: number[];
  overallLowContext?: number[];
  cycleRepeatPattern: number[];
  cycleRepeatCoverage: number[];
};

export type LearnedCuePattern = CueFeatureVector & { samples: number };

export type CueCycleEvidence = {
  originBeatIndex: number;
  originTime: number;
  testedCycleStarts: number;
  confirmedCycleStarts: number;
  confirmationRatio: number;
  meanSimilarity: number;
  strongestRepeatBeats: number | null;
  repeats: LearnedCycleRepeat[];
  confirmedBeatOffsets: number[];
};

export type LearnedCycleRepeat = {
  beats: number;
  samples: number;
  similarity: number;
  coverage: number;
};

export type TeachableBeat = DemoBeat & {
  nominalTime?: number;
  manualGridAuthoritative?: boolean;
  attackTime?: number | null;
  residualMs?: number | null;
  strength?: number;
  beatInBar?: number;
  phraseIndex?: number | null;
  kickStatus?: "aligned" | "early" | "late" | "inferred" | "ambiguous";
  auditOffsetMs?: number | null;
  auditStrength?: number;
  kickCycleSimilarity?: number;
  kickCycleConfirmed?: boolean;
  kickCycleMatchedTime?: number;
};

export type TeachableAnalysis = Omit<DemoAnalysis, "beats"> & {
  beats: TeachableBeat[];
  teaching?: AnalysisTeaching;
  selected?: { bpm: number; [key: string]: unknown };
  hypotheses?: Array<{ bpm: number; [key: string]: unknown }>;
  bassLowWaveformDetailed?: number[];
  bassHighWaveformDetailed?: number[];
  lowAttackWaveformDetailed?: number[];
  upperAttackWaveformDetailed?: number[];
  crashWaveformDetailed?: number[];
  verification?: {
    blocks?: Array<{ bpm?: number; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function authoritativeManualTempoBpm(teaching: AnalysisTeaching | undefined) {
  // DJ, 25 Aug 2026: the stem-set grid is the only BPM authority. Taught
  // windows keep their implied bpm as reference metadata, but it overrules
  // nothing. (Restore the old body from git/backups to re-enable.)
  void teaching;
  return null;
}

export function storedManualWindows(teaching: AnalysisTeaching | undefined): ManualCycleTeaching[] {
  return [teaching?.manualCycle, teaching?.manualIntroCycle, teaching?.manualOutroCycle]
    .filter((window): window is ManualCycleTeaching =>
      Boolean(window)
      && Number.isFinite(window!.start)
      && Number.isFinite(window!.end)
      && window!.end > window!.start);
}

function insideAnyManualWindow(windows: readonly ManualCycleTeaching[], time: number) {
  return windows.some((window) => time >= window.start - .000001 && time <= window.end + .000001);
}

export function resolvedBpmAt(
  analysis: Pick<TeachableAnalysis, "tempoSections" | "teaching" | "selected">,
  time: number,
) {
  const manualBpm = authoritativeManualTempoBpm(analysis.teaching);
  if (manualBpm !== null) return manualBpm;
  return analysis.tempoSections.find((section) => time >= section.start && time < section.end)?.bpm
    ?? analysis.selected?.bpm
    ?? analysis.tempoSections[0]?.bpm
    ?? 0;
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

export function nearestBeat(analysis: Pick<TeachableAnalysis, "beats">, time: number) {
  if (!analysis.beats.length) return null;
  return analysis.beats.reduce((best, beat) => Math.abs(beat.time - time) < Math.abs(best.time - time) ? beat : best);
}

export function cueTeachingComparison(
  analysis: Pick<TeachableAnalysis, "beats" | "duration">,
  time: number,
  crowdSuggestedTime: number,
  selectedAt = new Date().toISOString(),
): PreferredCueTeaching {
  const exactTime = clamp(time, 0, analysis.duration);
  const crowdTime = clamp(crowdSuggestedTime, 0, analysis.duration);
  const nearest = nearestBeat(analysis, exactTime);
  const nearestCrowdBeatTime = nearest?.time ?? exactTime;
  return {
    time: exactTime,
    crowdSuggestedTime: crowdTime,
    nearestCrowdBeatTime,
    cueVsCrowdMs: Math.round((exactTime - crowdTime) * 1000),
    cueVsGridMs: Math.round((exactTime - nearestCrowdBeatTime) * 1000),
    selectedAt,
  };
}

export function applyCueGridPhase<T extends TeachableAnalysis>(analysis: T, time: number): { analysis: T; shiftMs: number } {
  const exactTime = clamp(time, 0, analysis.duration);
  if (!analysis.beats.length) throw new Error("A mapped beat grid is required before teaching a cue");
  const manualWindows = storedManualWindows(analysis.teaching);
  const anchorIndex = analysis.beats.reduce((best, beat, index, beats) => Math.abs(beat.time - exactTime) < Math.abs(beats[best].time - exactTime) ? index : best, 0);
  const nearest = analysis.beats[anchorIndex];
  const shift = exactTime - nearest.time;
  const influenceBeats = 16;
  const shiftedBeats = analysis.beats.map((beat, index) => {
      const distance = Math.abs(index - anchorIndex);
      const ratio = clamp(distance / influenceBeats, 0, 1);
      // A taught cue may rephase Crowd's own grid, but beats the DJ pinned
      // inside a manual window are authoritative and must stay literal.
      const pinned = beat.manualGridAuthoritative || insideAnyManualWindow(manualWindows, beat.time);
      const weight = pinned ? 0 : 1 - ratio * ratio * (3 - 2 * ratio);
      const shiftedTime = beat.time + shift * weight;
      const attackTime = beat.attackTime;
      return {
        ...beat,
        time: shiftedTime,
        ...(beat.nominalTime !== undefined ? { nominalTime: pinned ? beat.nominalTime : beat.nominalTime + shift } : {}),
        ...(attackTime !== null && attackTime !== undefined ? {
          residualMs: Math.round((attackTime - shiftedTime) * 1000 * 10) / 10,
          auditOffsetMs: Math.round((attackTime - shiftedTime) * 1000 * 10) / 10,
        } : {}),
      };
    });
  return {
    analysis: { ...analysis, beats: shiftedBeats } as T,
    shiftMs: Math.round(shift * 1000),
  };
}

function average(values: number[] | undefined, from: number, to: number) {
  if (!values?.length) return 0;
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(values.length, Math.max(start + 1, Math.ceil(to)));
  let total = 0;
  for (let index = start; index < end; index += 1) total += values[index];
  return total / Math.max(1, end - start);
}

function surroundingBeats(analysis: Pick<TeachableAnalysis, "beats">, time: number) {
  let nextIndex = analysis.beats.findIndex((beat) => beat.time > time);
  if (nextIndex <= 0) nextIndex = nextIndex < 0 ? analysis.beats.length - 1 : 1;
  const previousIndex = Math.max(0, nextIndex - 1);
  const previous = analysis.beats[previousIndex];
  const next = analysis.beats[Math.min(analysis.beats.length - 1, nextIndex)];
  const period = Math.max(.001, next.time - previous.time);
  return { previousIndex, previous, next, period, phase: clamp((time - previous.time) / period, 0, 1) };
}

function normalisedBeatPattern(analysis: TeachableAnalysis, waveform: number[] | undefined, time: number, beats = 16) {
  if (!waveform?.length || !analysis.beats.length) return Array.from({ length: beats }, () => 0);
  const { previousIndex } = surroundingBeats(analysis, time);
  const half = Math.floor(beats / 2);
  const raw = Array.from({ length: beats }, (_, offset) => {
    const index = Math.max(0, Math.min(analysis.beats.length - 2, previousIndex - half + offset));
    return average(waveform, analysis.beats[index].time / analysis.hopSeconds, analysis.beats[index + 1].time / analysis.hopSeconds);
  });
  const scale = Math.max(.0001, ...raw);
  return raw.map((value) => Math.round(value / scale * 1000) / 1000);
}

function phrasePosition(analysis: TeachableAnalysis, time: number, previousIndex: number) {
  const starts = analysis.beats
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => beat.isPhraseStart);
  const previous = [...starts].reverse().find(({ beat }) => beat.time <= time) ?? starts[0];
  const next = starts.find(({ beat }) => beat.time > time);
  if (!previous) return { position: 0, span: 0 };
  const span = Math.max(1, (next?.index ?? analysis.beats.length - 1) - previous.index);
  return { position: clamp((previousIndex - previous.index) / span, 0, 1), span };
}

function normalisedWaveShape(analysis: TeachableAnalysis, waveform: number[] | undefined, fromTime: number, toTime: number, bins = 24) {
  if (!waveform?.length || toTime <= fromTime) return [];
  const hop = Math.max(.001, analysis.hopSeconds);
  const from = clamp(fromTime, 0, analysis.duration) / hop;
  const to = clamp(toTime, 0, analysis.duration) / hop;
  const values = Array.from({ length: bins }, (_, index) => average(waveform, from + (to - from) * index / bins, from + (to - from) * (index + 1) / bins));
  const scale = Math.max(.0001, ...values);
  return values.map((value) => Math.round(value / scale * 1000) / 1000);
}

export const CUE_CYCLE_REPEAT_BEATS = [4, 8, 16, 32, 64] as const;

function cueCycleRepeatSignature(
  analysis: TeachableAnalysis,
  time: number,
  period: number,
  sources: Array<{ waveform: number[] | undefined; weight: number; before: number; after: number }>,
) {
  const anchorIndex = analysis.beats.reduce(
    (best, beat, index, beats) => Math.abs(beat.time - time) < Math.abs(beats[best].time - time) ? index : best,
    0,
  );
  const shapesAt = (candidateTime: number) => sources.map((source) => ({
    shape: normalisedWaveShape(
      analysis,
      source.waveform,
      candidateTime - period * source.before,
      candidateTime + period * source.after,
    ),
    weight: source.weight,
  }));
  const anchorShapes = shapesAt(time);
  const similarities: number[] = [];
  const coverage: number[] = [];

  for (const beatOffset of CUE_CYCLE_REPEAT_BEATS) {
    const candidates = [anchorIndex - beatOffset, anchorIndex + beatOffset]
      .filter((index) => index >= 0 && index < analysis.beats.length)
      .map((index) => {
        const beat = analysis.beats[index];
        const previousTime = analysis.beats[Math.max(0, index - 1)]?.time ?? beat.time - period;
        const nextTime = analysis.beats[Math.min(analysis.beats.length - 1, index + 1)]?.time ?? beat.time + period;
        const localPeriod = Math.max(.05, (nextTime - previousTime) / (index > 0 && index < analysis.beats.length - 1 ? 2 : 1));
        const candidateTime = Number.isFinite(beat.attackTime) && Math.abs(beat.attackTime! - beat.time) <= localPeriod * .55
          ? beat.attackTime!
          : beat.time;
        const candidateShapes = shapesAt(candidateTime);
        const comparisons = anchorShapes.flatMap((anchor, sourceIndex) => {
          const candidate = candidateShapes[sourceIndex];
          return anchor.shape.length && candidate.shape.length
            ? [{ similarity: cosine(anchor.shape, candidate.shape), weight: anchor.weight }]
            : [];
        });
        const totalWeight = comparisons.reduce((total, comparison) => total + comparison.weight, 0);
        return totalWeight
          ? comparisons.reduce((total, comparison) => total + comparison.similarity * comparison.weight, 0) / totalWeight
          : null;
      })
      .filter((similarity): similarity is number => similarity !== null);
    similarities.push(candidates.reduce((total, similarity) => total + similarity, 0) / Math.max(1, candidates.length));
    coverage.push(candidates.length / 2);
  }
  return { similarities, coverage };
}

export function cueFeatureVector(
  analysis: TeachableAnalysis,
  time: number,
  options: { includeCycleRepeats?: boolean } = {},
): CueFeatureVector {
  const exact = clamp(time, 0, analysis.duration);
  const { previousIndex, previous, period, phase } = surroundingBeats(analysis, exact);
  const phrase = phrasePosition(analysis, exact, previousIndex);
  const manual = analysis.teaching?.manualCycle;
  const manualPeriod = manual ? (manual.end - manual.start) / Math.max(1, manual.beats) : period;
  const cyclePosition = manual
    ? modulo((exact - manual.start) / Math.max(.001, manualPeriod), manual.beats) / manual.beats
    : phrase.position;
  const hop = Math.max(.001, analysis.hopSeconds);
  const centre = exact / hop;
  const beatBins = period / hop;
  const lowSource = analysis.bassLowWaveformDetailed?.length ? analysis.bassLowWaveformDetailed : analysis.lowWaveformDetailed;
  const kickSource = analysis.kickWaveformDetailed?.length ? analysis.kickWaveformDetailed : analysis.lowAttackWaveformDetailed;
  const bassLowSource = analysis.bassLowWaveformDetailed?.length ? analysis.bassLowWaveformDetailed : analysis.lowWaveformDetailed;
  const bassHighSource = analysis.bassHighWaveformDetailed?.length ? analysis.bassHighWaveformDetailed : analysis.lowWaveformDetailed;
  const lowAttackSource = analysis.lowAttackWaveformDetailed?.length ? analysis.lowAttackWaveformDetailed : kickSource;
  const lowBefore = average(lowSource, centre - beatBins * 4, centre);
  const lowAfter = average(lowSource, centre, centre + beatBins * 4);
  const cycleRepeat = options.includeCycleRepeats
    ? cueCycleRepeatSignature(analysis, exact, period, [
      { waveform: kickSource, weight: .4, before: .2, after: .55 },
      { waveform: bassLowSource, weight: .22, before: .25, after: .75 },
      { waveform: bassHighSource, weight: .16, before: .25, after: .75 },
      { waveform: lowAttackSource, weight: .14, before: .2, after: .55 },
      { waveform: analysis.upperAttackWaveformDetailed, weight: .08, before: .2, after: .8 },
    ])
    : { similarities: [], coverage: [] };
  const verificationBlock = analysis.verification?.blocks?.find((block) => Number(block.start) <= exact && Number(block.end) >= exact);
  const status = String(verificationBlock?.status ?? "no-evidence");
  const evidenceCoverage = Number(verificationBlock?.evidenceCoverage ?? 0);
  return {
    trackPosition: exact / Math.max(.001, analysis.duration),
    beatPhase: phase,
    beatInBar: modulo((previous.beatInBar ?? modulo(previousIndex, 4) + 1) - 1 + phase, 4) / 4,
    cyclePosition,
    phrasePosition: phrase.position,
    phraseSpanBeats: phrase.span,
    gridConfidence: status === "verified" ? clamp(evidenceCoverage || 1, 0, 1) : status === "review" ? clamp(evidenceCoverage * .5, 0, .5) : 0,
    lowBefore,
    lowAfter,
    lowChange: (lowAfter - lowBefore) / Math.max(.01, lowBefore, lowAfter),
    kickAtCue: average(kickSource, centre - beatBins * .2, centre + beatBins * .35),
    bassLowAtCue: average(bassLowSource, centre - beatBins * .2, centre + beatBins * .5),
    bassHighAtCue: average(bassHighSource, centre - beatBins * .2, centre + beatBins * .5),
    lowAttackAtCue: average(lowAttackSource, centre - beatBins * .15, centre + beatBins * .35),
    upperAttackAtCue: average(analysis.upperAttackWaveformDetailed, centre - beatBins * .2, centre + beatBins * .6),
    crashAtCue: average(analysis.crashWaveformDetailed, centre - beatBins * .2, centre + beatBins * 1.2),
    lowPattern: normalisedBeatPattern(analysis, lowSource, exact),
    kickPattern: normalisedBeatPattern(analysis, kickSource, exact),
    bassLowShape: normalisedWaveShape(analysis, bassLowSource, exact - period * .25, exact + period * .75),
    bassHighShape: normalisedWaveShape(analysis, bassHighSource, exact - period * .25, exact + period * .75),
    kickShape: normalisedWaveShape(analysis, kickSource, exact - period * .2, exact + period * .55),
    upperAttackShape: normalisedWaveShape(analysis, analysis.upperAttackWaveformDetailed, exact - period * .2, exact + period * .8),
    overallLowContext: normalisedWaveShape(analysis, lowSource, exact - Math.max(period * 32, analysis.duration * .06), exact + Math.max(period * 32, analysis.duration * .06), 32),
    cycleRepeatPattern: cycleRepeat.similarities,
    cycleRepeatCoverage: cycleRepeat.coverage,
  };
}

function featureMean(vectors: CueFeatureVector[], key: keyof CueFeatureVector) {
  const values = vectors.map((vector) => Number(vector[key])).filter(Number.isFinite);
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

type CuePatternKey = "lowPattern" | "kickPattern" | "bassLowShape" | "bassHighShape" | "kickShape" | "upperAttackShape" | "overallLowContext" | "cycleRepeatPattern" | "cycleRepeatCoverage";

function patternMean(vectors: CueFeatureVector[], key: CuePatternKey) {
  const populated = vectors.map((vector) => vector[key] ?? []).filter((pattern) => pattern.length > 0);
  const width = Math.max(0, ...populated.map((pattern) => pattern.length));
  return Array.from({ length: width }, (_, index) => populated.reduce((total, pattern) => total + (pattern[index] ?? 0), 0) / Math.max(1, populated.length));
}

function learnedPattern(vectors: CueFeatureVector[]): LearnedCuePattern | null {
  if (!vectors.length) return null;
  return {
    samples: vectors.length,
    trackPosition: featureMean(vectors, "trackPosition"),
    beatPhase: featureMean(vectors, "beatPhase"),
    beatInBar: featureMean(vectors, "beatInBar"),
    cyclePosition: featureMean(vectors, "cyclePosition"),
    phrasePosition: featureMean(vectors, "phrasePosition"),
    phraseSpanBeats: featureMean(vectors, "phraseSpanBeats"),
    gridConfidence: featureMean(vectors, "gridConfidence"),
    lowBefore: featureMean(vectors, "lowBefore"),
    lowAfter: featureMean(vectors, "lowAfter"),
    lowChange: featureMean(vectors, "lowChange"),
    kickAtCue: featureMean(vectors, "kickAtCue"),
    bassLowAtCue: featureMean(vectors, "bassLowAtCue"),
    bassHighAtCue: featureMean(vectors, "bassHighAtCue"),
    lowAttackAtCue: featureMean(vectors, "lowAttackAtCue"),
    upperAttackAtCue: featureMean(vectors, "upperAttackAtCue"),
    crashAtCue: featureMean(vectors, "crashAtCue"),
    lowPattern: patternMean(vectors, "lowPattern"),
    kickPattern: patternMean(vectors, "kickPattern"),
    bassLowShape: patternMean(vectors, "bassLowShape"),
    bassHighShape: patternMean(vectors, "bassHighShape"),
    kickShape: patternMean(vectors, "kickShape"),
    upperAttackShape: patternMean(vectors, "upperAttackShape"),
    overallLowContext: patternMean(vectors, "overallLowContext"),
    cycleRepeatPattern: patternMean(vectors, "cycleRepeatPattern"),
    cycleRepeatCoverage: patternMean(vectors, "cycleRepeatCoverage"),
  };
}

function cosine(left: number[], right: number[]) {
  const count = Math.min(left.length, right.length);
  if (!count) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < count; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return dot / Math.max(.0001, Math.sqrt(leftNorm * rightNorm));
}

export function cuePatternSimilarity(vector: CueFeatureVector, learned: LearnedCuePattern) {
  const closeness = (left: number, right: number, scale = 1) => Math.max(0, 1 - Math.abs(left - right) / Math.max(.0001, scale));
  const weighted: Array<[number, number]> = [
    [closeness(vector.trackPosition, learned.trackPosition, .45), .11],
    [closeness(vector.beatPhase, learned.beatPhase, .5), .04],
    [closeness(vector.beatInBar, learned.beatInBar, .5), .05],
    [closeness(vector.cyclePosition, learned.cyclePosition, .5), .06],
    [closeness(vector.phrasePosition, learned.phrasePosition, .5), .05],
    [closeness(vector.lowChange, learned.lowChange, 1), .08],
    [closeness(vector.kickAtCue, learned.kickAtCue, Math.max(.05, learned.kickAtCue)), .08],
    [closeness(vector.upperAttackAtCue, learned.upperAttackAtCue, Math.max(.05, learned.upperAttackAtCue)), .03],
    [closeness(vector.crashAtCue, learned.crashAtCue, Math.max(.05, learned.crashAtCue)), .03],
    [cosine(vector.lowPattern, learned.lowPattern), .06],
    [cosine(vector.kickPattern, learned.kickPattern), .06],
  ];
  const addOptionalNumber = (left: number | undefined, right: number | undefined, weight: number) => {
    if (Number.isFinite(left) && Number.isFinite(right)) weighted.push([closeness(left!, right!, Math.max(.05, right!)), weight]);
  };
  const addOptionalPattern = (left: number[] | undefined, right: number[] | undefined, weight: number) => {
    if (left?.length && right?.length) weighted.push([cosine(left, right), weight]);
  };
  addOptionalNumber(vector.bassLowAtCue, learned.bassLowAtCue, .06);
  addOptionalNumber(vector.bassHighAtCue, learned.bassHighAtCue, .05);
  addOptionalNumber(vector.lowAttackAtCue, learned.lowAttackAtCue, .07);
  addOptionalPattern(vector.bassLowShape, learned.bassLowShape, .06);
  addOptionalPattern(vector.bassHighShape, learned.bassHighShape, .05);
  addOptionalPattern(vector.kickShape, learned.kickShape, .08);
  addOptionalPattern(vector.upperAttackShape, learned.upperAttackShape, .04);
  addOptionalPattern(vector.overallLowContext, learned.overallLowContext, .08);
  addOptionalPattern(vector.cycleRepeatPattern, learned.cycleRepeatPattern, .08);
  const totalWeight = weighted.reduce((total, item) => total + item[1], 0);
  return weighted.reduce((total, item) => total + item[0] * item[1], 0) / Math.max(.0001, totalWeight);
}

export function kickFingerprintSimilarity(vector: CueFeatureVector, learned: LearnedCuePattern) {
  const closeness = (left: number | undefined, right: number | undefined) => {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return Math.max(0, 1 - Math.abs(left! - right!) / Math.max(.05, Math.abs(right!)));
  };
  const weighted: Array<[number, number]> = [];
  const addNumber = (left: number | undefined, right: number | undefined, weight: number) => {
    const score = closeness(left, right);
    if (score !== null) weighted.push([score, weight]);
  };
  const addShape = (left: number[] | undefined, right: number[] | undefined, weight: number) => {
    if (left?.length && right?.length) weighted.push([cosine(left, right), weight]);
  };
  addNumber(vector.kickAtCue, learned.kickAtCue, .14);
  addNumber(vector.bassLowAtCue, learned.bassLowAtCue, .1);
  addNumber(vector.bassHighAtCue, learned.bassHighAtCue, .08);
  addNumber(vector.lowAttackAtCue, learned.lowAttackAtCue, .1);
  addNumber(vector.upperAttackAtCue, learned.upperAttackAtCue, .05);
  addShape(vector.kickShape, learned.kickShape, .22);
  addShape(vector.bassLowShape, learned.bassLowShape, .1);
  addShape(vector.bassHighShape, learned.bassHighShape, .07);
  addShape(vector.upperAttackShape, learned.upperAttackShape, .05);
  addShape(vector.kickPattern, learned.kickPattern, .09);
  addShape(vector.cycleRepeatPattern, learned.cycleRepeatPattern, .1);
  const totalWeight = weighted.reduce((total, item) => total + item[1], 0);
  return weighted.reduce((total, item) => total + item[0] * item[1], 0) / Math.max(.0001, totalWeight);
}

export function learnedCueCandidates(
  analysis: TeachableAnalysis,
  profile: TeachingProfile | null | undefined,
  role: "mix-in" | "mix-out",
  limit = 2,
): Array<LearnedCuePrediction & { beatIndex: number }> {
  const pattern = (role === "mix-in" ? profile?.entryCuePattern : profile?.cuePattern) ?? profile?.kickCyclePattern;
  if (!pattern || !analysis.beats.length) return [];
  const candidateAt = (beat: TeachableBeat, beatIndex: number, includeCycleRepeats: boolean) => {
    const previousTime = analysis.beats[Math.max(0, beatIndex - 1)]?.time ?? beat.time - .5;
    const nextTime = analysis.beats[Math.min(analysis.beats.length - 1, beatIndex + 1)]?.time ?? beat.time + .5;
    const period = Math.max(.05, (nextTime - previousTime) / (beatIndex > 0 && beatIndex < analysis.beats.length - 1 ? 2 : 1));
    const attackTime = beat.attackTime;
    const time = Number.isFinite(attackTime) && Math.abs(attackTime! - beat.time) <= period * .55 ? attackTime! : beat.time;
    if (time < analysis.duration * .02 || time > analysis.duration * .98) return null;
    const features = cueFeatureVector(analysis, time, { includeCycleRepeats });
    const waveformParts = [
      features.bassLowShape?.length && pattern.bassLowShape?.length ? cosine(features.bassLowShape, pattern.bassLowShape) : null,
      features.bassHighShape?.length && pattern.bassHighShape?.length ? cosine(features.bassHighShape, pattern.bassHighShape) : null,
      features.kickShape?.length && pattern.kickShape?.length ? cosine(features.kickShape, pattern.kickShape) : null,
      features.overallLowContext?.length && pattern.overallLowContext?.length ? cosine(features.overallLowContext, pattern.overallLowContext) : null,
    ].filter((value): value is number => value !== null);
    const waveformScore = waveformParts.reduce((total, value) => total + value, 0) / Math.max(1, waveformParts.length);
    const kickScore = kickFingerprintSimilarity(features, pattern);
    const patternScore = cuePatternSimilarity(features, pattern);
    const score = patternScore * .55 + waveformScore * .2 + kickScore * .25;
    return { time, score, samples: pattern.samples, kickScore, waveformScore, beatIndex };
  };
  const preliminary = analysis.beats
    .map((beat, beatIndex) => candidateAt(beat, beatIndex, false))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.score - left.score);
  const cycleAware = Boolean(pattern.cycleRepeatPattern?.length);
  const candidates = cycleAware
    ? preliminary
      .slice(0, Math.max(32, limit * 16))
      .map((candidate) => candidateAt(analysis.beats[candidate.beatIndex], candidate.beatIndex, true)!)
      .sort((left, right) => right.score - left.score)
    : preliminary;
  if (!candidates.length) return [];
  const threshold = Math.max(.48, candidates[0].score * .84);
  return candidates.filter((candidate) => candidate.score >= threshold).slice(0, Math.max(1, limit));
}

export function applyKickCycleAnchor<T extends TeachableAnalysis>(analysis: T, time: number) {
  const manualWindows = storedManualWindows(analysis.teaching);
  const preserveManualGrid = manualWindows.some((window) => manualTempoAuthority(window.beats) !== "supporting");
  const phaseCorrected = preserveManualGrid ? analysis : applyCueGridPhase(analysis, time).analysis;
  const exactTime = clamp(time, 0, analysis.duration);
  const anchorIndex = phaseCorrected.beats.reduce((best, beat, index, beats) => Math.abs(beat.time - exactTime) < Math.abs(beats[best].time - exactTime) ? index : best, 0);
  const anchorVector = cueFeatureVector(phaseCorrected, exactTime);
  const anchorPattern = { ...anchorVector, samples: 1 } satisfies LearnedCuePattern;
  const matchingAnchors: Array<{ index: number; time: number; similarity: number }> = [];
  const classified = phaseCorrected.beats.map((beat, index) => {
    const relative = index - anchorIndex;
    const beatInBar = modulo(relative, 4) + 1;
    const isDownbeat = beatInBar === 1;
    if (!isDownbeat) return { ...beat, beatInBar, isDownbeat, kickCycleConfirmed: false };
    const previousTime = phaseCorrected.beats[Math.max(0, index - 1)]?.time ?? beat.time - .5;
    const nextTime = phaseCorrected.beats[Math.min(phaseCorrected.beats.length - 1, index + 1)]?.time ?? beat.time + .5;
    const period = Math.max(.05, (nextTime - previousTime) / (index > 0 && index < phaseCorrected.beats.length - 1 ? 2 : 1));
    const searchRadius = Math.min(.14, period * .24);
    // A downbeat inside a user-taught manual window may still be scored as
    // kick-cycle evidence, but only at its taught position.
    const pinned = beat.manualGridAuthoritative || insideAnyManualWindow(manualWindows, beat.time);
    const candidateTimes = index === anchorIndex || pinned
      ? [index === anchorIndex && !pinned ? exactTime : beat.time]
      : [
        beat.time,
        beat.time - searchRadius,
        beat.time - searchRadius / 2,
        beat.time + searchRadius / 2,
        beat.time + searchRadius,
        ...(Number.isFinite(beat.attackTime) && Math.abs(beat.attackTime! - beat.time) <= period * .3 ? [beat.attackTime!] : []),
      ]
        .map((candidate) => clamp(candidate, 0, phaseCorrected.duration))
        .filter((candidate, candidateIndex, candidates) => candidates.findIndex((other) => Math.abs(other - candidate) < .000001) === candidateIndex);
    const match = candidateTimes
      .map((candidateTime) => ({
        time: candidateTime,
        similarity: index === anchorIndex ? 1 : kickFingerprintSimilarity(cueFeatureVector(phaseCorrected, candidateTime), anchorPattern),
      }))
      .sort((left, right) => right.similarity - left.similarity || Math.abs(left.time - beat.time) - Math.abs(right.time - beat.time))[0];
    const candidateTime = match.time;
    const similarity = match.similarity;
    const confirmed = index === anchorIndex || similarity >= .72;
    if (confirmed) matchingAnchors.push({ index, time: candidateTime, similarity });
    return {
      ...beat,
      beatInBar,
      isDownbeat: true,
      isPhraseStart: confirmed || beat.isPhraseStart,
      confidence: index === anchorIndex ? 1 : Math.max(beat.confidence ?? 0, similarity * .9),
      phraseConfidence: confirmed ? Math.max(beat.phraseConfidence ?? 0, similarity) : beat.phraseConfidence,
      kickCycleSimilarity: similarity,
      kickCycleConfirmed: confirmed,
      kickCycleMatchedTime: candidateTime,
    };
  });
  const sortedMatches = [...matchingAnchors].sort((left, right) => left.index - right.index);
  // Every beat inside a user-taught manual window acts as a zero-shift anchor
  // so the interpolation blends to nothing at the window edges instead of
  // dragging taught beats or their neighbours across the boundary.
  const pinnedAnchors = preserveManualGrid ? [] : classified.flatMap((beat, index) =>
    (beat.manualGridAuthoritative || insideAnyManualWindow(manualWindows, beat.time))
      && !matchingAnchors.some((anchor) => anchor.index === index)
      ? [{ index, time: beat.time, similarity: 1 }]
      : []);
  const sortedAnchors = [...sortedMatches, ...pinnedAnchors].sort((left, right) => left.index - right.index);
  const shiftAt = (index: number) => {
    const before = [...sortedAnchors].reverse().find((anchor) => anchor.index <= index);
    const after = sortedAnchors.find((anchor) => anchor.index >= index);
    if (before && after && before.index !== after.index) {
      const progress = (index - before.index) / (after.index - before.index);
      const beforeShift = before.time - classified[before.index].time;
      const afterShift = after.time - classified[after.index].time;
      return beforeShift + (afterShift - beforeShift) * progress;
    }
    const nearest = before ?? after;
    if (!nearest) return 0;
    const distance = Math.abs(index - nearest.index);
    const weight = clamp(1 - distance / 16, 0, 1);
    return (nearest.time - classified[nearest.index].time) * weight;
  };
  const beats = classified.map((beat, index) => {
    const anchor = sortedAnchors.find((item) => item.index === index);
    // Kick matching remains useful evidence, but it may not move a grid whose
    // tempo and phase were explicitly confirmed by the DJ — whether the whole
    // grid is manually locked or only the beats inside a taught window.
    const shiftedTime = preserveManualGrid || beat.manualGridAuthoritative || insideAnyManualWindow(manualWindows, beat.time)
      ? beat.time
      : anchor?.time ?? beat.time + shiftAt(index);
    return {
      ...beat,
      time: shiftedTime,
      ...(beat.nominalTime !== undefined ? { nominalTime: beat.nominalTime + (shiftedTime - beat.time) } : {}),
      ...(beat.attackTime !== null && beat.attackTime !== undefined ? {
        residualMs: Math.round((beat.attackTime - shiftedTime) * 1000 * 10) / 10,
        auditOffsetMs: Math.round((beat.attackTime - shiftedTime) * 1000 * 10) / 10,
      } : {}),
    };
  });
  return {
    analysis: { ...phaseCorrected, beats } as T,
    anchorIndex,
    confirmedCycleStarts: sortedMatches.length,
    matchingKickTimes: sortedMatches.map((anchor) => ({ time: anchor.time, similarity: anchor.similarity })),
    anchorFeatures: anchorVector,
  };
}

export function kickCycleTeachingEvidence(
  analysis: TeachableAnalysis,
  originBeatIndex: number,
  features: CueFeatureVector,
): CueCycleEvidence {
  const tested = analysis.beats
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => Number.isFinite(beat.kickCycleSimilarity));
  const confirmed = tested.filter(({ beat }) => beat.kickCycleConfirmed);
  const repeats = CUE_CYCLE_REPEAT_BEATS.map((beats, index) => ({
    beats,
    samples: features.cycleRepeatCoverage[index] > 0 ? 1 : 0,
    similarity: features.cycleRepeatPattern[index] ?? 0,
    coverage: features.cycleRepeatCoverage[index] ?? 0,
  }));
  const strongest = [...repeats]
    .filter((repeat) => repeat.coverage > 0)
    .sort((left, right) => right.similarity - left.similarity || right.beats - left.beats)[0];
  return {
    originBeatIndex,
    originTime: analysis.beats[originBeatIndex]?.time ?? 0,
    testedCycleStarts: tested.length,
    confirmedCycleStarts: confirmed.length,
    confirmationRatio: confirmed.length / Math.max(1, tested.length),
    meanSimilarity: tested.reduce((total, item) => total + (item.beat.kickCycleSimilarity ?? 0), 0) / Math.max(1, tested.length),
    strongestRepeatBeats: strongest?.beats ?? null,
    repeats,
    confirmedBeatOffsets: confirmed.map(({ index }) => index - originBeatIndex),
  };
}

function closestOriginalBeat(beats: TeachableBeat[], time: number) {
  return beats.reduce((best, beat) => Math.abs(beat.time - time) < Math.abs(best.time - time) ? beat : best, beats[0]);
}

export function applyManualCycleGrid<T extends TeachableAnalysis>(
  analysis: T,
  start: number,
  end: number,
  beats: number,
  crowdBpm: number,
  selectedAt = new Date().toISOString(),
  cueEdge?: "start" | "end",
  exitSide?: "before" | "after",
  purpose?: ManualCyclePurpose,
): { analysis: T; teaching: ManualCycleTeaching } {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("The custom loop end must be after its start");
  if (!Number.isInteger(beats) || beats < 1 || beats > 512) throw new Error("The custom loop must contain between 1 and 512 whole beats");
  if (!analysis.beats.length) throw new Error("A mapped beat grid is required before teaching a loop");
  const loopStart = clamp(start, 0, analysis.duration);
  const loopEnd = clamp(end, 0, analysis.duration);
  if (loopEnd <= loopStart + .02) throw new Error("The custom loop is too short to measure");
  const period = (loopEnd - loopStart) / beats;
  const bpm = 60 / period;
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 260) throw new Error(`That loop implies ${bpm.toFixed(2)} BPM, outside Crowd's supported range`);
  const tempoLocked = manualTempoAuthority(beats) !== "supporting";

  const originalBeats = analysis.beats;
  const crowdNearestStart = nearestBeat(analysis, loopStart)?.time ?? loopStart;
  const crowdNearestEnd = nearestBeat(analysis, loopEnd)?.time ?? loopEnd;
  const startIndex = originalBeats.reduce((best, beat, index, grid) => Math.abs(beat.time - loopStart) < Math.abs(grid[best].time - loopStart) ? index : best, 0);
  const endIndex = startIndex + beats;
  if (endIndex >= originalBeats.length) throw new Error("The mapped grid does not contain enough following beats for that manual loop length");
  const blendBeats = Math.min(16, Math.max(4, Math.round(beats / 2)));
  const smoothWeight = (distance: number) => {
    const ratio = clamp(distance / blendBeats, 0, 1);
    return 1 - ratio * ratio * (3 - 2 * ratio);
  };
  const startShift = loopStart - originalBeats[startIndex].time;
  const locallyCorrected = originalBeats.map((beat, index) => {
    let time = beat.time;
    if (index < startIndex && startIndex - index < blendBeats) {
      time = beat.time + startShift * smoothWeight(startIndex - index);
    } else if (index >= startIndex && index <= endIndex) {
      time = loopStart + (index - startIndex) * period;
    } else if (index > endIndex && index - endIndex < blendBeats) {
      const locallyProjected = loopEnd + (index - endIndex) * period;
      time = beat.time + (locallyProjected - beat.time) * smoothWeight(index - endIndex);
    }
    const insideWindow = index >= startIndex && index <= endIndex;
    const relativeBeat = index - startIndex;
    const cycleEdge = insideWindow && (relativeBeat === 0 || relativeBeat === beats);
    const attackTime = beat.attackTime;
    return {
      ...beat,
      time,
      nominalTime: time,
      ...(insideWindow ? {
        manualGridAuthoritative: true,
        confidence: cycleEdge ? 1 : Math.max(.9, beat.confidence ?? 0),
        isDownbeat: modulo(relativeBeat, 4) === 0,
        beatInBar: modulo(relativeBeat, 4) + 1,
        isPhraseStart: cycleEdge || beat.isPhraseStart,
        phraseConfidence: cycleEdge ? 1 : beat.phraseConfidence,
      } : {}),
      ...(attackTime !== null && attackTime !== undefined ? {
        residualMs: Math.round((attackTime - time) * 1000 * 10) / 10,
        auditOffsetMs: Math.round((attackTime - time) * 1000 * 10) / 10,
      } : {}),
    };
  });
  const generated = tempoLocked
    ? Array.from({
      length: Math.max(1, Math.floor((analysis.duration - loopStart) / period) - Math.ceil(-loopStart / period) + 1),
    }, (_, index) => {
      const firstRelativeBeat = Math.ceil(-loopStart / period);
      const relativeBeat = firstRelativeBeat + index;
      const time = loopStart + relativeBeat * period;
      const sourceBeat = closestOriginalBeat(originalBeats, time);
      const isDownbeat = modulo(relativeBeat, 4) === 0;
      const isPhraseStart = modulo(relativeBeat, 16) === 0 || relativeBeat === 0 || relativeBeat === beats;
      return {
        ...sourceBeat,
        beat: index,
        time,
        nominalTime: time,
        manualGridAuthoritative: true,
        confidence: Math.max(.9, sourceBeat.confidence ?? 0),
        isDownbeat,
        beatInBar: modulo(relativeBeat, 4) + 1,
        isPhraseStart,
        phraseConfidence: isPhraseStart ? 1 : sourceBeat.phraseConfidence,
        ...(sourceBeat.attackTime !== null && sourceBeat.attackTime !== undefined ? {
          residualMs: Math.round((sourceBeat.attackTime - time) * 1000 * 10) / 10,
          auditOffsetMs: Math.round((sourceBeat.attackTime - time) * 1000 * 10) / 10,
        } : {}),
      };
    })
    : locallyCorrected;

  const teaching: ManualCycleTeaching = {
    start: loopStart,
    end: loopEnd,
    beats,
    bpm,
    tempoEvidenceWeight: manualTempoEvidenceWeight(beats),
    tempoAuthority: manualTempoAuthority(beats),
    crowdBpm,
    crowdNearestStart,
    crowdNearestEnd,
    startVsGridMs: Math.round((loopStart - crowdNearestStart) * 1000),
    endVsGridMs: Math.round((loopEnd - crowdNearestEnd) * 1000),
    bpmDelta: bpm - crowdBpm,
    ...(cueEdge ? { cueEdge } : {}),
    ...(exitSide ? { exitSide } : {}),
    ...(purpose ? { purpose } : {}),
    selectedAt,
  };
  const localTempoSections = [
    ...analysis.tempoSections.flatMap((section) => {
      if (section.end <= loopStart || section.start >= loopEnd) return [section];
      return [
        ...(section.start < loopStart ? [{ ...section, end: loopStart }] : []),
        ...(section.end > loopEnd ? [{ ...section, start: loopEnd }] : []),
      ];
    }),
    { start: loopStart, end: loopEnd, bpm, confidence: 1 },
  ].sort((left, right) => left.start - right.start);
  const tempoSections = tempoLocked
    ? [{ start: 0, end: analysis.duration, bpm, confidence: 1 }]
    : localTempoSections;
  const legacyWindow = analysis.teaching?.manualCycle;
  let manualIntroCycle = analysis.teaching?.manualIntroCycle ?? (legacyWindow?.purpose === "intro-loop" ? legacyWindow : undefined);
  let manualOutroCycle = analysis.teaching?.manualOutroCycle ?? (legacyWindow?.purpose === "outro-transition" ? legacyWindow : undefined);
  if (purpose === "intro-loop") {
    if (manualIntroCycle && !manualOutroCycle && teaching.start < manualIntroCycle.start) {
      manualOutroCycle = { ...manualIntroCycle, purpose: "outro-transition" };
    }
    manualIntroCycle = teaching;
  } else if (purpose === "outro-transition") {
    if (manualOutroCycle && !manualIntroCycle && teaching.start > manualOutroCycle.start) {
      manualIntroCycle = { ...manualOutroCycle, purpose: "intro-loop" };
    }
    manualOutroCycle = teaching;
  }
  if (manualIntroCycle && manualOutroCycle && manualIntroCycle.start > manualOutroCycle.start) {
    const earlier = { ...manualOutroCycle, purpose: "intro-loop" as const };
    const later = { ...manualIntroCycle, purpose: "outro-transition" as const };
    manualIntroCycle = earlier;
    manualOutroCycle = later;
  }
  const purposeTeaching = purpose === "intro-loop" || purpose === "outro-transition"
    ? { manualIntroCycle, manualOutroCycle }
    : {};
  const pinnedWindows = [manualIntroCycle, manualOutroCycle, teaching]
    .filter((window): window is ManualCycleTeaching => Boolean(window))
    .filter((window, index, windows) => windows.findIndex((candidate) => Math.abs(candidate.start - window.start) < .000001 && Math.abs(candidate.end - window.end) < .000001) === index)
    .sort((left, right) => left.start - right.start);
  const pinnedBeats = pinnedWindows.reduce((grid, window) => {
    const windowStartIndex = grid.reduce((best, beat, index, beatsGrid) => Math.abs(beat.time - window.start) < Math.abs(beatsGrid[best].time - window.start) ? index : best, 0);
    const windowEndIndex = windowStartIndex + window.beats;
    if (windowEndIndex >= grid.length) return grid;
    const windowPeriod = (window.end - window.start) / window.beats;
    return grid.map((beat, index) => {
      if (index < windowStartIndex || index > windowEndIndex) return beat;
      const relativeBeat = index - windowStartIndex;
      const time = window.start + relativeBeat * windowPeriod;
      const cycleEdge = relativeBeat === 0 || relativeBeat === window.beats;
      return {
        ...beat,
        time,
        nominalTime: time,
        manualGridAuthoritative: true,
        confidence: cycleEdge ? 1 : Math.max(.9, beat.confidence ?? 0),
        isDownbeat: modulo(relativeBeat, 4) === 0,
        beatInBar: modulo(relativeBeat, 4) + 1,
        isPhraseStart: cycleEdge || beat.isPhraseStart,
        phraseConfidence: cycleEdge ? 1 : beat.phraseConfidence,
        ...(beat.attackTime !== null && beat.attackTime !== undefined ? {
          residualMs: Math.round((beat.attackTime - time) * 1000 * 10) / 10,
          auditOffsetMs: Math.round((beat.attackTime - time) * 1000 * 10) / 10,
        } : {}),
      };
    });
  }, generated);
  const selected = tempoLocked && analysis.selected ? {
    ...analysis.selected,
    bpm,
    period,
    phase: modulo(loopStart, period),
    probability: 1,
    metricalRelation: "primary",
    manualTempoEvidenceWeight: teaching.tempoEvidenceWeight,
    manualTempoAuthority: teaching.tempoAuthority,
  } : analysis.selected;
  const hypotheses = tempoLocked && selected && analysis.hypotheses ? [
    selected,
    ...analysis.hypotheses
      .filter((hypothesis) => Math.abs(hypothesis.bpm - bpm) > .01)
      .map((hypothesis) => ({
        ...hypothesis,
        probability: typeof hypothesis.probability === "number"
          ? hypothesis.probability / (1 + teaching.tempoEvidenceWeight!)
          : hypothesis.probability,
      })),
  ] : analysis.hypotheses;
  // DJ, 25 Aug 2026: a saved window records itself — start, end, beats, its
  // implied bpm as reference — but no longer overrules the tune. The grid
  // and BPM stay the stem-set analyser's. pinnedBeats/tempoSections/selected
  // above are still computed (cheap) and deliberately unused.
  void pinnedBeats; void tempoSections; void hypotheses;
  const corrected = {
    ...analysis,
    teaching: { ...analysis.teaching, manualCycle: teaching, ...purposeTeaching },
  } as T;
  return { analysis: corrected, teaching };
}

export type StoredTeachingRestoration<T extends TeachableAnalysis> = {
  analysis: T;
  restoredWindows: ManualCycleTeaching[];
  restoredCues: number;
  failures: string[];
};

function windowSpanMatches(left: ManualCycleTeaching, right: ManualCycleTeaching) {
  return Math.abs(left.start - right.start) < .000001 && Math.abs(left.end - right.end) < .000001;
}

function authoritativeStoredWindows(stored: TeachableAnalysis | null, newestFirstMoments: readonly TeachingMoment[]): ManualCycleTeaching[] {
  const teaching = stored?.teaching;
  if (teaching?.manualIntroCycle || teaching?.manualOutroCycle || teaching?.manualCycle) {
    const purposed = [teaching.manualIntroCycle, teaching.manualOutroCycle]
      .filter((window): window is ManualCycleTeaching => Boolean(window));
    const legacy = teaching.manualCycle;
    return legacy && !purposed.some((window) => windowSpanMatches(window, legacy))
      ? [...purposed, legacy]
      : purposed;
  }
  // Legacy recovery: no stored analysis file survives, so placements are
  // rebuilt from teaching-moment memory — the newest authoritative window per
  // purpose, never just the overall newest, so both halves of a taught
  // transition pair return together.
  const authoritative = newestFirstMoments
    .filter((moment): moment is CycleTeachingMoment =>
      moment.kind === "loop-grid"
      && manualTempoAuthority(moment.beats) !== "supporting"
      && Number.isFinite(moment.start)
      && Number.isFinite(moment.end)
      && moment.end > moment.start
      && Number.isInteger(moment.beats))
    .map(({ kind: _kind, trackId: _trackId, ...window }) => window);
  const intro = authoritative.find((moment) => moment.purpose === "intro-loop");
  const outro = authoritative.find((moment) => moment.purpose === "outro-transition");
  if (!intro && !outro) return authoritative.length ? [authoritative[0]] : [];
  return [intro, outro].filter((window): window is ManualCycleTeaching => Boolean(window));
}

function newestStoredCue(newestFirstMoments: readonly TeachingMoment[], role: "mix-in" | "mix-out"): PreferredCueTeaching | undefined {
  const moment = newestFirstMoments.find((candidate): candidate is CueTeachingMoment =>
    candidate.kind === "cue" && (candidate.role ?? "mix-out") === role);
  if (!moment) return undefined;
  const { time, crowdSuggestedTime, nearestCrowdBeatTime, cueVsCrowdMs, cueVsGridMs, selectedAt } = moment;
  return { time, crowdSuggestedTime, nearestCrowdBeatTime, cueVsCrowdMs, cueVsGridMs, selectedAt };
}

/**
 * Re-apply the DJ's stored teaching to a freshly analysed grid. The stored
 * analysis file is the authoritative record of taught windows and preferred
 * cues; teaching-moment memory is the fallback when no stored file exists.
 * Windows are re-applied oldest-first so the newest taught span remains the
 * tempo authority, and a window the fresh grid cannot host is kept verbatim
 * as teaching evidence instead of being discarded.
 */
export function reapplyStoredTeaching<T extends TeachableAnalysis>(
  automaticAnalysis: T,
  storedAnalysis: TeachableAnalysis | null,
  newestFirstMoments: readonly TeachingMoment[] = [],
): StoredTeachingRestoration<T> {
  const windows = [...authoritativeStoredWindows(storedAnalysis, newestFirstMoments)]
    .sort((left, right) => left.selectedAt.localeCompare(right.selectedAt));
  const restoredWindows: ManualCycleTeaching[] = [];
  const failures: string[] = [];
  let analysis = automaticAnalysis;
  for (const window of windows) {
    try {
      const applied = applyManualCycleGrid(
        analysis,
        window.start,
        window.end,
        window.beats,
        Number.isFinite(window.crowdBpm) && window.crowdBpm > 0 ? window.crowdBpm : analysis.selected?.bpm ?? 0,
        window.selectedAt,
        window.cueEdge,
        window.exitSide,
        window.purpose,
      );
      analysis = applied.analysis;
      restoredWindows.push(applied.teaching);
    } catch (error) {
      // The taught span stays authoritative teaching evidence even when the
      // fresh automatic grid cannot host it; the record survives verbatim.
      failures.push(error instanceof Error ? error.message : "unknown error");
      const slot = window.purpose === "intro-loop"
        ? { manualIntroCycle: window }
        : window.purpose === "outro-transition"
          ? { manualOutroCycle: window }
          : { manualCycle: window };
      analysis = { ...analysis, teaching: { ...analysis.teaching, ...slot } } as T;
      restoredWindows.push(window);
    }
  }
  const preferredCue = storedAnalysis ? storedAnalysis.teaching?.preferredCue : newestStoredCue(newestFirstMoments, "mix-out");
  const preferredEntryCue = storedAnalysis ? storedAnalysis.teaching?.preferredEntryCue : newestStoredCue(newestFirstMoments, "mix-in");
  if (preferredCue || preferredEntryCue) {
    analysis = {
      ...analysis,
      teaching: {
        ...analysis.teaching,
        ...(preferredCue ? { preferredCue } : {}),
        ...(preferredEntryCue ? { preferredEntryCue } : {}),
      },
    } as T;
  }
  return { analysis, restoredWindows, restoredCues: Number(Boolean(preferredCue)) + Number(Boolean(preferredEntryCue)), failures };
}

function median(values: number[], fallback: number) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function testCueTheory(
  id: string,
  label: string,
  role: TeachingTheory["role"],
  moments: CueTeachingMoment[],
  score: (features: CueFeatureVector) => number,
  comparisonFeatures: (moment: CueTeachingMoment) => CueFeatureVector = (moment) => moment.crowdFeatures,
): TeachingTheory {
  const pairs = moments.map((moment) => ({ user: clamp(score(moment.userFeatures), 0, 1), crowd: clamp(score(comparisonFeatures(moment)), 0, 1) }));
  const userScore = pairs.reduce((total, pair) => total + pair.user, 0) / Math.max(1, pairs.length);
  const crowdScore = pairs.reduce((total, pair) => total + pair.crowd, 0) / Math.max(1, pairs.length);
  const winRate = pairs.reduce((total, pair) => total + (pair.user > pair.crowd + .025 ? 1 : Math.abs(pair.user - pair.crowd) <= .025 ? .5 : 0), 0) / Math.max(1, pairs.length);
  const lift = userScore - crowdScore;
  const status = pairs.length < 3
    ? "forming"
    : lift >= .04 && winRate >= .6
      ? "supported"
      : lift <= -.04 && winRate <= .4
        ? "contradicted"
        : "inconclusive";
  return { id, label, role, samples: pairs.length, userScore, crowdScore, lift, winRate, status };
}

function gridCorrectionTheories(moments: CueTeachingMoment[]): TeachingTheory[] {
  const corrections = moments.filter((moment) => Math.abs(moment.cueVsGridMs) >= 8 && moment.gridFeatures);
  const againstMissedGrid = (moment: CueTeachingMoment) => moment.gridFeatures!;
  const positive = corrections.filter((moment) => moment.cueVsGridMs > 0).length;
  const negative = corrections.filter((moment) => moment.cueVsGridMs < 0).length;
  const directionConsistency = corrections.length ? Math.max(positive, negative) / corrections.length : 0;
  const medianOffset = Math.round(median(corrections.map((moment) => moment.cueVsGridMs), 0));
  const direction: TeachingTheory = {
    id: "grid-error-direction",
    label: medianOffset >= 0 ? `Crowd's grid usually landed early by about ${Math.abs(medianOffset)} ms` : `Crowd's grid usually landed late by about ${Math.abs(medianOffset)} ms`,
    role: "grid",
    samples: corrections.length,
    userScore: directionConsistency,
    crowdScore: 0,
    lift: directionConsistency,
    winRate: directionConsistency,
    status: corrections.length < 3 ? "forming" : directionConsistency >= .65 ? "supported" : directionConsistency <= .4 ? "contradicted" : "inconclusive",
  };
  return [
    testCueTheory("grid-kick-anchor", "Stronger kick attack identifies the true beat", "grid", corrections, (features) => features.kickAtCue, againstMissedGrid),
    testCueTheory("grid-upper-anchor", "Crash or upper transient identifies the true beat", "grid", corrections, (features) => Math.max(features.crashAtCue, features.upperAttackAtCue), againstMissedGrid),
    testCueTheory("grid-low-anchor", "Low-frequency pulse identifies the true beat", "grid", corrections, (features) => Math.max(features.lowBefore, features.lowAfter), againstMissedGrid),
    direction,
  ];
}

function cueTheories(entryMoments: CueTeachingMoment[], exitMoments: CueTeachingMoment[]) {
  const boundary = (position: number) => 1 - Math.min(position, 1 - position) * 2;
  const offGrid = (phase: number) => Math.min(phase, 1 - phase) * 2;
  const shared: Array<[string, string, (features: CueFeatureVector) => number]> = [
    ["phrase-edge", "Phrase/cycle edge", (features) => boundary(features.phrasePosition)],
    ["cycle-edge", "Measured cycle boundary", (features) => boundary(features.cyclePosition)],
    ["off-grid", "Intentional between-beat placement", (features) => offGrid(features.beatPhase)],
    ["crash", "Crash or upper-frequency confirmation", (features) => Math.max(features.crashAtCue, features.upperAttackAtCue)],
    ["kick", "Kick-aligned cue line", (features) => features.kickAtCue],
  ];
  const results = [
    ...shared.map(([id, label, score]) => testCueTheory(`out-${id}`, label, "mix-out", exitMoments, score)),
    testCueTheory("out-bass-hole", "Bass falls away at mix-out", "mix-out", exitMoments, (features) => Math.max(0, -features.lowChange)),
    ...shared.map(([id, label, score]) => testCueTheory(`in-${id}`, label, "mix-in", entryMoments, score)),
    testCueTheory("in-bass-return", "Bass arrives after mix-in", "mix-in", entryMoments, (features) => Math.max(0, features.lowChange)),
  ];
  return results.sort((left, right) => {
    const rank = { supported: 3, forming: 2, inconclusive: 1, contradicted: 0 };
    return rank[right.status] - rank[left.status] || right.lift - left.lift;
  });
}

function cycleTheories(moments: CycleTeachingMoment[]): TeachingTheory[] {
  const count = Math.max(1, moments.length);
  const cycleCounts = new Map<number, number>();
  for (const moment of moments) cycleCounts.set(moment.beats, (cycleCounts.get(moment.beats) ?? 0) + 1);
  const mostCommon = [...cycleCounts.values()].sort((left, right) => right - left)[0] ?? 0;
  const standardPhraseCount = moments.filter((moment) => moment.beats === 32 || moment.beats === 64).length;
  const meaningfulBpmCorrections = moments.filter((moment) => Math.abs(moment.bpmDelta) >= .02);
  const positive = meaningfulBpmCorrections.filter((moment) => moment.bpmDelta > 0).length;
  const negative = meaningfulBpmCorrections.filter((moment) => moment.bpmDelta < 0).length;
  const directionConsistency = meaningfulBpmCorrections.length ? Math.max(positive, negative) / meaningfulBpmCorrections.length : 0;
  const edgeMoments = moments.filter((moment) => moment.cueEdge);
  const startEdges = edgeMoments.filter((moment) => moment.cueEdge === "start").length;
  const endEdges = edgeMoments.filter((moment) => moment.cueEdge === "end").length;
  const edgeConsistency = edgeMoments.length ? Math.max(startEdges, endEdges) / edgeMoments.length : 0;
  const releaseMoments = moments.filter((moment) => moment.exitSide);
  const beforeReleases = releaseMoments.filter((moment) => moment.exitSide === "before").length;
  const afterReleases = releaseMoments.filter((moment) => moment.exitSide === "after").length;
  const releaseConsistency = releaseMoments.length ? Math.max(beforeReleases, afterReleases) / releaseMoments.length : 0;
  const make = (id: string, label: string, userScore: number, samples = moments.length): TeachingTheory => ({
    id,
    label,
    role: "cycle",
    samples,
    userScore,
    crowdScore: 0,
    lift: userScore,
    winRate: userScore,
    status: samples < 3 ? "forming" : userScore >= .6 ? "supported" : userScore <= .35 ? "contradicted" : "inconclusive",
  });
  return [
    make("cycle-32-64", "Cycles usually span 32 or 64 beats", standardPhraseCount / count),
    make("cycle-repeat", "A repeatable cycle length is preferred", mostCommon / count),
    make("cycle-bpm-direction", "Grid BPM needs a consistent correction direction", directionConsistency, meaningfulBpmCorrections.length),
    make("cycle-cue-edge", startEdges >= endEdges ? "Loop cue is usually the front edge" : "Loop cue is usually the back edge", edgeConsistency, edgeMoments.length),
    make("cycle-release-side", beforeReleases >= afterReleases ? "Exit loop just before the mix point" : "Exit loop just after the mix point", releaseConsistency, releaseMoments.length),
  ];
}

export function teachingProfile(moments: TeachingMoment[]): TeachingProfile {
  const cueMoments = moments.filter((moment): moment is CueTeachingMoment => moment.kind === "cue");
  const entryCueMoments = cueMoments.filter((moment) => moment.role === "mix-in");
  const exitCueMoments = cueMoments.filter((moment) => moment.role !== "mix-in");
  const gridCorrectionMoments = cueMoments.filter((moment) => Math.abs(moment.cueVsGridMs) >= 8 && moment.gridFeatures);
  const cycleMoments = moments.filter((moment): moment is CycleTeachingMoment => moment.kind === "loop-grid");
  const inferredCycleMoments = entryCueMoments.filter((moment) => moment.cycleEvidence);
  const cycleRepeatPattern = CUE_CYCLE_REPEAT_BEATS.map((beats) => {
    const examples = inferredCycleMoments.flatMap((moment) => {
      const repeat = moment.cycleEvidence?.repeats.find((candidate) => candidate.beats === beats);
      return repeat && repeat.coverage > 0 ? [repeat] : [];
    });
    const totalCoverage = examples.reduce((total, repeat) => total + repeat.coverage, 0);
    return {
      beats,
      samples: examples.length,
      similarity: examples.reduce((total, repeat) => total + repeat.similarity * repeat.coverage, 0) / Math.max(.0001, totalCoverage),
      coverage: totalCoverage / Math.max(1, examples.length),
    };
  });
  const cycleCounts = new Map<number, number>();
  for (const moment of cycleMoments) cycleCounts.set(moment.beats, (cycleCounts.get(moment.beats) ?? 0) + 1);
  const commonCycleBeats = [...cycleCounts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
  return {
    totalMoments: moments.length,
    cueMoments: cueMoments.length,
    mixInCueMoments: entryCueMoments.length,
    mixOutCueMoments: exitCueMoments.length,
    gridCorrectionMoments: gridCorrectionMoments.length,
    cycleMoments: cycleMoments.length,
    inferredCycleMoments: inferredCycleMoments.length,
    learnedCueOffsetMs: Math.round(median(exitCueMoments.map((moment) => moment.cueVsCrowdMs), 0)),
    learnedGridOffsetMs: Math.round(median(gridCorrectionMoments.map((moment) => moment.cueVsGridMs), 0)),
    learnedBpmRatio: median(cycleMoments.filter((moment) => moment.crowdBpm > 0).map((moment) => moment.bpm / moment.crowdBpm), 1),
    commonCycleBeats,
    cycleRepeatPattern,
    kickCyclePattern: learnedPattern((entryCueMoments.length ? entryCueMoments : cueMoments).map((moment) => moment.userFeatures)),
    cuePattern: learnedPattern(exitCueMoments.map((moment) => moment.userFeatures)),
    crowdCuePattern: learnedPattern(exitCueMoments.map((moment) => moment.crowdFeatures)),
    entryCuePattern: learnedPattern(entryCueMoments.map((moment) => moment.userFeatures)),
    crowdEntryCuePattern: learnedPattern(entryCueMoments.map((moment) => moment.crowdFeatures)),
    correctedGridPattern: learnedPattern(gridCorrectionMoments.map((moment) => moment.userFeatures)),
    missedGridPattern: learnedPattern(gridCorrectionMoments.map((moment) => moment.gridFeatures!)),
    theories: [...gridCorrectionTheories(cueMoments), ...cueTheories(entryCueMoments, exitCueMoments), ...cycleTheories(cycleMoments)].sort((left, right) => {
      const rank = { supported: 3, forming: 2, inconclusive: 1, contradicted: 0 };
      return rank[right.status] - rank[left.status] || right.lift - left.lift;
    }),
  };
}

import type { DemoAnalysis } from "./demo-set.ts";

type RundownAnalysis = DemoAnalysis & {
  lowAttackWaveformDetailed?: number[];
  upperAttackWaveformDetailed?: number[];
  verification?: { blocks?: Array<{ start: number; end: number; status: "verified" | "review" | "no-evidence"; evidenceCoverage: number }> };
};

export type RundownLoopPlan = {
  riskScore: number;
  loopStart: number;
  loopEnd: number;
  loopBeats: 4 | 8 | 16;
  triggerIncomingTime: number;
  releaseIncomingTime: number;
  releaseBeatOffset: number;
  confidence: number;
  reason: string;
};

export type RundownPrediction = {
  problemPredicted: boolean;
  riskScore: number;
  safe: boolean;
  loop: RundownLoopPlan | null;
  reason: string;
};

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function average(values: number[], start: number, end: number) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(values.length, Math.ceil(end));
  if (to <= from) return 0;
  let total = 0;
  for (let index = from; index < to; index += 1) total += values[index];
  return total / (to - from);
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function beatIndexAt(analysis: RundownAnalysis, time: number) {
  return analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[best].time - time) ? index : best, 0);
}

function beatValues(analysis: RundownAnalysis, startIndex: number, count: number) {
  const upper = analysis.upperAttackWaveformDetailed ?? analysis.lowAttackWaveformDetailed ?? analysis.lowWaveformDetailed;
  return Array.from({ length: count }, (_, offset) => {
    const index = Math.min(analysis.beats.length - 2, startIndex + offset);
    const start = analysis.beats[index].time / analysis.hopSeconds;
    const end = analysis.beats[index + 1].time / analysis.hopSeconds;
    return {
      low: average(analysis.lowWaveformDetailed, start, end),
      upper: average(upper, start, end),
      phrase: Boolean(analysis.beats[index].isPhraseStart),
    };
  });
}

function normalizedComposite(values: Array<{ low: number; upper: number }>) {
  const lowScale = Math.max(.015, percentile(values.map((value) => value.low), .8));
  const upperScale = Math.max(.01, percentile(values.map((value) => value.upper), .8));
  return values.map((value) => clamp(value.low / lowScale) * .35 + clamp(value.upper / upperScale) * .65);
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const mean = average(values, 0, values.length);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2), 0, values.length));
}

function hasReviewEvidence(analysis: RundownAnalysis, start: number, end: number) {
  return (analysis.verification?.blocks ?? []).some((block) => block.status === "review"
    && block.evidenceCoverage > .08
    && Math.min(end, block.end) > Math.max(start, block.start));
}

export function predictRundownLoop(
  outgoing: RundownAnalysis,
  outgoingHandoff: number,
  incoming: RundownAnalysis,
  incomingDrop: number,
): RundownPrediction {
  const outgoingIndex = beatIndexAt(outgoing, outgoingHandoff);
  const incomingIndex = beatIndexAt(incoming, incomingDrop);
  const available = Math.min(96, outgoing.beats.length - outgoingIndex - 1, incoming.beats.length - incomingIndex - 1);
  if (available < 24) return { problemPredicted: true, riskScore: 1, safe: false, loop: null, reason: "too little mapped rundown remains to make a safe exit plan" };

  const outgoingValues = beatValues(outgoing, outgoingIndex, available);
  const incomingValues = beatValues(incoming, incomingIndex, available);
  const outgoingComposite = normalizedComposite(outgoingValues);
  const incomingComposite = normalizedComposite(incomingValues);
  const outgoingAbsolute = outgoingValues.map((value) => value.low * .35 + value.upper * .65);
  const incomingAbsolute = incomingValues.map((value) => value.low * .35 + value.upper * .65);
  const riskFrom = 8;
  const riskTo = Math.min(64, available);
  const overlap = average(outgoingAbsolute.slice(riskFrom, riskTo).map((value, index) => Math.min(value, incomingAbsolute[riskFrom + index])), 0, riskTo - riskFrom);
  const outgoingPresence = average(outgoingAbsolute, riskFrom, riskTo);
  let competingPhraseStarts = 0;
  let phraseStarts = 0;
  for (let offset = riskFrom; offset < riskTo; offset += 1) {
    const left = outgoingValues[offset].phrase;
    const right = incomingValues[offset].phrase;
    if (left || right) phraseStarts += 1;
    if (left !== right) competingPhraseStarts += 1;
  }
  const phraseConflict = phraseStarts ? competingPhraseStarts / phraseStarts : 0;
  const densityScore = overlap * .65 + outgoingPresence * .3 + phraseConflict * .03;
  // The analysis signals are normalized over the whole tune, so their absolute
  // post-handoff level distinguishes an actually quiet rundown from one that is
  // merely quiet relative to an even louder part of the same track.
  const riskScore = clamp((densityScore - .12) / .18);
  // Normal dance arrangements are both active after a handoff. Reserve the
  // intervention for unusually dense overlap; otherwise a useful long blend
  // would be mistaken for a problem merely because both tracks contain drums.
  const problemPredicted = riskScore >= .67;
  if (!problemPredicted) {
    return { problemPredicted: false, riskScore, safe: true, loop: null, reason: `natural rundown predicted clear (${Math.round(riskScore * 100)}% clutter risk)` };
  }

  const loopCandidates: Array<{ startOffset: number; length: 4 | 8 | 16; score: number }> = [];
  for (const length of [8, 4, 16] as const) {
    for (let startOffset = 8; startOffset + length <= Math.min(48, available); startOffset += 4) {
      const startBeat = outgoing.beats[outgoingIndex + startOffset];
      const endBeat = outgoing.beats[outgoingIndex + startOffset + length];
      if (!startBeat?.isDownbeat || !endBeat || hasReviewEvidence(outgoing, startBeat.time, endBeat.time)) continue;
      const segment = outgoingComposite.slice(startOffset, startOffset + length);
      const level = average(segment, 0, segment.length);
      const stability = clamp(1 - standardDeviation(segment) * 1.6);
      const seam = clamp(1 - Math.abs(segment[0] - segment.at(-1)!) * 1.4);
      const phraseIntrusions = outgoingValues.slice(startOffset + 1, startOffset + length).filter((value) => value.phrase).length;
      const boundaryConfidence = clamp((startBeat.confidence + endBeat.confidence) / 2);
      const score = (1 - level) * .48 + stability * .2 + seam * .17 + boundaryConfidence * .1 + (length === 8 ? .05 : 0) - phraseIntrusions * .08;
      if (score >= .4) loopCandidates.push({ startOffset, length, score });
    }
  }

  const solutions: Array<{ loop: typeof loopCandidates[number]; releaseOffset: number; breakScore: number; score: number }> = [];
  const possibleBreakLevels: number[] = [];
  for (let releaseOffset = 8; releaseOffset + 4 < available; releaseOffset += 4) {
    if (incoming.beats[incomingIndex + releaseOffset]?.isDownbeat) possibleBreakLevels.push(average(incomingComposite, releaseOffset, releaseOffset + 4));
  }
  const quietBreakLevel = Math.min(.58, percentile(possibleBreakLevels, .3) * 1.12);
  for (const loop of loopCandidates) {
    const firstRelease = Math.max(8, loop.startOffset + loop.length);
    for (let releaseOffset = firstRelease; releaseOffset + 4 < available; releaseOffset += 4) {
      const releaseBeat = incoming.beats[incomingIndex + releaseOffset];
      if (!releaseBeat?.isDownbeat) continue;
      const before = average(incomingComposite, Math.max(0, releaseOffset - 4), releaseOffset);
      const during = average(incomingComposite, releaseOffset, releaseOffset + 4);
      const drop = clamp(before - during);
      const breakScore = (1 - during) * .68 + drop * .27 + (releaseBeat.isPhraseStart ? .05 : 0);
      if (during > quietBreakLevel && drop < .2 || breakScore < .4) continue;
      const patiencePenalty = Math.max(0, releaseOffset - 64) / 160;
      solutions.push({ loop, releaseOffset, breakScore, score: loop.score * .58 + breakScore * .42 - patiencePenalty });
    }
  }

  solutions.sort((left, right) => right.score - left.score || left.releaseOffset - right.releaseOffset);
  const best = solutions[0];
  if (!best) {
    return { problemPredicted: true, riskScore, safe: false, loop: null, reason: `rundown clutter risk ${Math.round(riskScore * 100)}%; no neutral loop with a safe primary-track break was found` };
  }
  const loopStart = outgoing.beats[outgoingIndex + best.loop.startOffset].time;
  const loopEnd = outgoing.beats[outgoingIndex + best.loop.startOffset + best.loop.length].time;
  const triggerIncomingTime = incoming.beats[incomingIndex + best.loop.startOffset].time;
  const releaseIncomingTime = incoming.beats[incomingIndex + best.releaseOffset].time;
  const confidence = clamp(best.score);
  const reason = `rundown clutter risk ${Math.round(riskScore * 100)}%; hold a neutral ${best.loop.length}-beat loop and cut it on the new primary break ${best.releaseOffset} beats after handoff`;
  return {
    problemPredicted: true,
    riskScore,
    safe: true,
    loop: { riskScore, loopStart, loopEnd, loopBeats: best.loop.length, triggerIncomingTime, releaseIncomingTime, releaseBeatOffset: best.releaseOffset, confidence, reason },
    reason,
  };
}

import { MIX_HOLD_BEAT_OPTIONS, MIX_RUNWAY_BEAT_OPTIONS, audibleRunwayPhraseEdge, cueLockedTempoRate, findEntryCueCandidates, findExitCueCandidates, planDemoSet, type DemoAnalysis, type DemoCueCandidate, type DemoSetPlan } from "./demo-set.ts";
import { assessRunwayGridCoverage, continuityCoverageSafe, runwayCoverageSafe, type RunwayGridCoverage, type VerificationBlock } from "./runway-grid.ts";
import { predictRundownLoop } from "./rundown-loop.ts";

export { assessRunwayGridCoverage } from "./runway-grid.ts";

export type LiveAnalysis = DemoAnalysis & {
  verification?: {
    verifiedBeatCoverage?: number;
    status?: string;
    blocks?: VerificationBlock[];
  };
};

export type LiveCandidateAssessment = {
  accepted: boolean;
  score: number;
  bassSimilarity: number;
  runwaySimilarity: number;
  blendSimilarity: number;
  incomingRunwayAudienceMuted: boolean;
  tempoShiftPercent: number;
  gridCoverage: number;
  outgoingGridCoverage: RunwayGridCoverage;
  incomingGridCoverage: RunwayGridCoverage;
  transitionGridSafe: boolean;
  rundownSafe: boolean;
  rundownRisk: number;
  rundownReason: string;
  phrasePaired: boolean;
  phraseAlignment: number;
  outgoingBassHole: number;
  expandedPhrasePair: boolean;
  incomingPlayabilitySafe: boolean;
  incomingActiveBassKickBeats: number;
  incomingNextExitHandoff: number | null;
  incomingPlayabilityScore: number;
  phraseAlternatives: Array<{
    runwayBeats: number;
    blendBeats: number;
    exitRunway: number;
    exitHandoff: number;
    entryRunway: number;
    entryDrop: number;
    score: number;
    bassSimilarity: number;
    phraseAlignment: number;
  }>;
  cuePairsTested: number;
  reason: string;
  plan: DemoSetPlan;
};

export type LockedOutgoingCue = {
  beatIndex: number;
  exitRunway: number;
  exitHandoff: number;
  mixOut: number;
  score: number;
};

const MIN_INCOMING_BASS_SIMILARITY = .52;
const MAX_INCOMING_TEMPO_SHIFT_PERCENT = 10;
const MIN_INCOMING_MIX_SCORE = .56;
const URGENT_INCOMING_MIX_SCORE = .45;
const MIN_INCOMING_ACTIVE_BASS_KICK_BEATS = 96;
const IDEAL_INCOMING_ACTIVE_BASS_KICK_BEATS = 160;

export function liveCandidateAccepted(
  assessment: Pick<LiveCandidateAssessment, "accepted" | "score" | "bassSimilarity" | "tempoShiftPercent" | "transitionGridSafe" | "rundownSafe" | "phrasePaired" | "incomingPlayabilitySafe">,
  secondsLeft: number,
  runwayAvailable: boolean,
) {
  // A deadline may relax only the combined preference score. It must never
  // turn a bad phrase pair, disputed grid, unsafe rundown, unusably late entry,
  // incompatible bass pattern, or excessive tempo move into an accepted mix.
  const urgentScoreOnlyFallback = secondsLeft < 105
    && assessment.score >= URGENT_INCOMING_MIX_SCORE
    && assessment.phrasePaired
    && assessment.bassSimilarity >= MIN_INCOMING_BASS_SIMILARITY
    && assessment.tempoShiftPercent <= MAX_INCOMING_TEMPO_SHIFT_PERCENT
    && assessment.transitionGridSafe
    && assessment.rundownSafe
    && assessment.incomingPlayabilitySafe;
  return runwayAvailable && (assessment.accepted || urgentScoreOnlyFallback);
}

function beatTimeAfter(analysis: LiveAnalysis, time: number, beatCount: number) {
  const startIndex = analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[best].time - time) ? index : best, 0);
  return analysis.beats[Math.max(0, Math.min(analysis.beats.length - 1, startIndex + beatCount))]?.time ?? time;
}

function bpmAt(analysis: LiveAnalysis, time: number) {
  return analysis.tempoSections.find((section) => time >= section.start && time < section.end)?.bpm
    ?? analysis.tempoSections[0]?.bpm
    ?? 145;
}

function plausibleCandidates(candidates: DemoCueCandidate[], threshold: number, limit = 10) {
  if (!candidates.length) return [];
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  return candidates.filter((candidate) => candidate.score >= maximum * threshold).slice(0, limit);
}

function phraseRangeCandidates(candidates: DemoCueCandidate[], analysis: LiveAnalysis, minimumPosition: number, maximumPosition: number, buckets = 4, perBucket = 2) {
  const maximum = Math.max(.0001, ...candidates.map((candidate) => candidate.score));
  const grouped = new Map<number, DemoCueCandidate[]>();
  for (const candidate of candidates) {
    const beat = analysis.beats[candidate.beatIndex];
    const position = candidate.time / Math.max(.001, analysis.duration);
    if (!beat?.isPhraseStart || position < minimumPosition || position > maximumPosition) continue;
    const bucket = Math.min(buckets - 1, Math.max(0, Math.floor((position - minimumPosition) / Math.max(.001, maximumPosition - minimumPosition) * buckets)));
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), candidate]);
  }
  return [...grouped.values()].flatMap((items) => items
    .sort((left, right) => {
      const leftBeat = analysis.beats[left.beatIndex];
      const rightBeat = analysis.beats[right.beatIndex];
      const leftStrength = left.score / maximum + (leftBeat?.phraseConfidence ?? 0) * .75;
      const rightStrength = right.score / maximum + (rightBeat?.phraseConfidence ?? 0) * .75;
      return rightStrength - leftStrength;
    })
    .slice(0, perBucket));
}

function mergeCueCandidates(...groups: DemoCueCandidate[][]) {
  const merged = new Map<number, DemoCueCandidate>();
  for (const candidate of groups.flat()) merged.set(candidate.beatIndex, candidate);
  return [...merged.values()];
}

type IncomingPlayability = {
  safe: boolean;
  activeBassKickBeats: number;
  nextExitHandoff: number | null;
  score: number;
};

const beatEnergyCache = new WeakMap<object, number[]>();

function bassKickBeatEnergies(analysis: LiveAnalysis) {
  const cached = beatEnergyCache.get(analysis);
  if (cached) return cached;
  const values = analysis.beats.slice(0, -1).map((beat, index) => {
    const next = analysis.beats[index + 1];
    const from = beat.time / analysis.hopSeconds;
    const to = next.time / analysis.hopSeconds;
    const bass = average([
      analysis.lowWaveformDetailed,
      analysis.bassLowWaveformDetailed,
      analysis.bassHighWaveformDetailed,
    ].filter((waveform): waveform is number[] => Boolean(waveform?.length))
      .map((waveform) => average(waveform, from, to)), 0, analysis.bassLowWaveformDetailed?.length ? 3 : 1);
    const kick = analysis.kickWaveformDetailed?.length ? average(analysis.kickWaveformDetailed, from, to) : 0;
    return bass * .72 + kick * .28;
  });
  beatEnergyCache.set(analysis, values);
  return values;
}

function assessIncomingPlayability(analysis: LiveAnalysis, entryBeatIndex: number, exits: DemoCueCandidate[], plan: DemoSetPlan): IncomingPlayability {
  const energies = bassKickBeatEnergies(analysis);
  const sorted = [...energies].sort((left, right) => left - right);
  const activeThreshold = Math.max(.035, (sorted[Math.floor(sorted.length * .35)] ?? 0) * .55);
  const mixClearBeat = entryBeatIndex + plan.blendBeats;
  const minimumActiveBeats = MIN_INCOMING_ACTIVE_BASS_KICK_BEATS;
  const idealActiveBeats = IDEAL_INCOMING_ACTIVE_BASS_KICK_BEATS;
  let bestPotential: IncomingPlayability = { safe: false, activeBassKickBeats: 0, nextExitHandoff: null, score: 0 };
  for (const exit of [...exits].sort((left, right) => left.time - right.time)) {
    const exitRunwayBeat = exit.beatIndex - plan.runwayBeats;
    if (exitRunwayBeat <= mixClearBeat) continue;
    const runwayStart = analysis.beats[exitRunwayBeat]?.time;
    if (!Number.isFinite(runwayStart)) continue;
    const criticalEnd = beatTimeAfter(analysis, exit.time, 16);
    const mixEnd = beatTimeAfter(analysis, exit.time, plan.blendBeats);
    const runwayCoverage = assessRunwayGridCoverage(analysis, runwayStart, criticalEnd);
    const continuity = assessRunwayGridCoverage(analysis, criticalEnd, mixEnd);
    if (!runwayCoverageSafe(runwayCoverage) || !continuityCoverageSafe(continuity)) continue;
    const activeBassKickBeats = energies.slice(mixClearBeat, exitRunwayBeat)
      .filter((energy) => energy >= activeThreshold).length;
    const safe = activeBassKickBeats >= minimumActiveBeats;
    const score = Math.min(1, activeBassKickBeats / idealActiveBeats);
    // Preserve the first genuinely usable handoff. Looking farther ahead until
    // the counter becomes large would hide the fact that a late entry already
    // consumed an excellent nearer phrase exit.
    if (safe) return { safe, activeBassKickBeats, nextExitHandoff: exit.time, score };
    if (activeBassKickBeats > bestPotential.activeBassKickBeats) bestPotential = { safe, activeBassKickBeats, nextExitHandoff: exit.time, score };
  }
  return bestPotential;
}

function neighbouringPhraseSpan(analysis: LiveAnalysis, beatIndex: number, direction: -1 | 1) {
  for (let index = beatIndex + direction; index >= 0 && index < analysis.beats.length; index += direction) {
    if (analysis.beats[index].isPhraseStart) return Math.abs(index - beatIndex);
  }
  return 0;
}

function basslineEnergyAcrossBeats(analysis: LiveAnalysis, startBeat: number, endBeat: number) {
  const start = analysis.beats[Math.max(0, startBeat)]?.time ?? 0;
  const end = analysis.beats[Math.min(analysis.beats.length - 1, endBeat)]?.time ?? analysis.duration;
  const waveforms = [analysis.lowWaveformDetailed, analysis.bassLowWaveformDetailed, analysis.bassHighWaveformDetailed]
    .filter((waveform): waveform is number[] => Boolean(waveform?.length));
  return average(waveforms.map((waveform) => average(waveform, start / analysis.hopSeconds, end / analysis.hopSeconds)), 0, waveforms.length);
}

function cuePairPhraseAlignment(current: LiveAnalysis, candidate: LiveAnalysis, exit: DemoCueCandidate, entry: DemoCueCandidate, maximumExitScore: number, maximumEntryScore: number) {
  const exitBeat = current.beats[exit.beatIndex];
  const entryBeat = candidate.beats[entry.beatIndex];
  const taughtExit = Number.isFinite(current.teaching?.preferredCue?.time)
    && Math.abs(current.teaching!.preferredCue!.time - exit.time) <= .02;
  const taughtEntry = Number.isFinite(candidate.teaching?.preferredEntryCue?.time)
    && Math.abs(candidate.teaching!.preferredEntryCue!.time - entry.time) <= .02;
  // A human-taught cue is direct phrase evidence even when it deliberately
  // sits between the machine's old beat lines. The incoming side must still
  // begin on a detected phrase edge.
  const phrasePaired = Boolean((taughtExit || exitBeat?.isPhraseStart) && (taughtEntry || entryBeat?.isPhraseStart));
  const phraseConfidence = phrasePaired
    ? Math.sqrt((taughtExit ? 1 : Math.max(0, exitBeat.phraseConfidence ?? 0)) * (taughtEntry ? 1 : Math.max(0, entryBeat.phraseConfidence ?? 0)))
    : 0;
  // A useful hole-to-hole transition aligns the outgoing phrase immediately
  // after its bass-off cue with the incoming phrase immediately before its
  // bass-on cue. Comparing those spans lets the phrase locator recognise a
  // musical gap even when persistent kicks mask it in the low-energy envelope.
  const outgoingHoleBeats = neighbouringPhraseSpan(current, exit.beatIndex, 1);
  const incomingHoleBeats = neighbouringPhraseSpan(candidate, entry.beatIndex, -1);
  const spanAlignment = outgoingHoleBeats && incomingHoleBeats
    ? Math.min(outgoingHoleBeats, incomingHoleBeats) / Math.max(outgoingHoleBeats, incomingHoleBeats)
    : 0;
  const outgoingBefore = basslineEnergyAcrossBeats(current, exit.beatIndex - 16, exit.beatIndex);
  const outgoingAfter = basslineEnergyAcrossBeats(current, exit.beatIndex, exit.beatIndex + 16);
  const outgoingBassHole = Math.max(0, outgoingBefore - outgoingAfter) / Math.max(.01, outgoingBefore, outgoingAfter);
  const incomingBefore = basslineEnergyAcrossBeats(candidate, entry.beatIndex - 16, entry.beatIndex);
  const incomingAfter = basslineEnergyAcrossBeats(candidate, entry.beatIndex, entry.beatIndex + 16);
  const incomingBassReturn = Math.max(0, incomingAfter - incomingBefore) / Math.max(.01, incomingBefore, incomingAfter);
  // Candidate prominence retains the actual structural evidence: entry scores
  // reward a quiet-to-bass rise, while exit scores reward a usable continuing
  // runway. Phrase flags alone are too common to distinguish the best pairing.
  const prominence = ((exit.score / Math.max(.0001, maximumExitScore)) + (entry.score / Math.max(.0001, maximumEntryScore))) / 2;
  const phraseAlignment = phrasePaired
    ? phraseConfidence * .1 + prominence * .1 + spanAlignment * .35 + outgoingBassHole * .4 + incomingBassReturn * .05
    : prominence * .15;
  const expandedPhrasePair = phrasePaired
    && outgoingBassHole >= .25
    && exit.time / Math.max(.001, current.duration) < .52
    && entry.time / Math.max(.001, candidate.duration) > .56;
  return { phrasePaired, phraseAlignment, outgoingBassHole, expandedPhrasePair };
}

function replaceCueTime(plan: DemoSetPlan["tracks"][number], id: string, time: number) {
  return plan.cuePoints.map((cue) => cue.id === id ? { ...cue, time } : cue);
}

function planWithCuePair(base: DemoSetPlan, current: LiveAnalysis, candidate: LiveAnalysis, exit: DemoCueCandidate, entry: DemoCueCandidate, runwayBeats: number, blendBeats: number) {
  const exitRunway = beatTimeAfter(current, exit.time, -runwayBeats);
  const mixOut = beatTimeAfter(current, exit.time, blendBeats);
  const entryRunway = beatTimeAfter(candidate, entry.time, -runwayBeats);
  let outgoingCues = replaceCueTime(base.tracks[0], "exit-runway", exitRunway);
  outgoingCues = outgoingCues.map((cue) => cue.id === "exit-runway"
    ? { ...cue, description: `Start the next deck here, ${runwayBeats} beats before the phrase-edge bass switch.` }
    : cue.id === "exit-handoff" ? { ...cue, time: exit.time }
      : cue.id === "mix-out" ? { ...cue, time: mixOut, description: `End of the ${blendBeats}-beat post-handoff hold; this outgoing deck is now fully removed.` }
        : cue);
  let incomingCues = replaceCueTime(base.tracks[1], "entry-runway", entryRunway);
  incomingCues = incomingCues.map((cue) => cue.id === "entry-runway"
    ? { ...cue, description: `Start silently ${runwayBeats} beats before the phrase-edge bass switch; lock tempo and beat phase before raising mids and highs.` }
    : cue.id === "entry-drop" ? { ...cue, time: entry.time } : cue);
  return {
    ...base,
    runwayBeats,
    blendBeats,
    tracks: [
      { ...base.tracks[0], exitRunway, exitHandoff: exit.time, mixOut, cuePoints: outgoingCues },
      { ...base.tracks[1], entryRunway, entryDrop: entry.time, bpm: bpmAt(candidate, entry.time), cuePoints: incomingCues },
    ],
  };
}

function average(values: number[], start: number, end: number) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(values.length, Math.ceil(end));
  if (to <= from) return 0;
  let total = 0;
  for (let index = from; index < to; index += 1) total += values[index];
  return total / (to - from);
}

function beatPattern(analysis: LiveAnalysis, time: number, beats = 16) {
  const startIndex = analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[best].time - time) ? index : best, 0);
  const output: number[] = [];
  for (let offset = 0; offset < beats; offset += 1) {
    const beat = analysis.beats[Math.min(analysis.beats.length - 2, startIndex + offset)];
    const next = analysis.beats[Math.min(analysis.beats.length - 1, startIndex + offset + 1)];
    output.push(average(analysis.lowWaveformDetailed, beat.time / analysis.hopSeconds, next.time / analysis.hopSeconds));
  }
  return output;
}

export function bassPatternSimilarity(left: number[], right: number[]) {
  const count = Math.min(left.length, right.length);
  if (!count) return 0;
  const scaleLeft = Math.max(...left.slice(0, count), .0001);
  const scaleRight = Math.max(...right.slice(0, count), .0001);
  if (scaleLeft < .01 && scaleRight < .01) return 1;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < count; index += 1) {
    const a = left[index] / scaleLeft;
    const b = right[index] / scaleRight;
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  return dot / Math.max(.0001, Math.sqrt(normLeft * normRight));
}

function assessCuePair(current: { id: string; name: string; analysis: LiveAnalysis }, candidate: { id: string; name: string; analysis: LiveAnalysis }, plan: DemoSetPlan, phrasePair = { phrasePaired: false, phraseAlignment: 0, outgoingBassHole: 0, expandedPhrasePair: false }, incomingPlayability: IncomingPlayability = { safe: false, activeBassKickBeats: 0, nextExitHandoff: null, score: 0 }) {
  let outgoing = plan.tracks[0];
  let incoming = plan.tracks[1];
  // Judge only what the audience will hear around this proposed transition.
  // Whole-track similarity is irrelevant: the outgoing exit runway must fit
  // the incoming runway, and the bass arriving at the handoff must fit the
  // local pattern that was just established.
  const outgoingRunway = beatPattern(current.analysis, outgoing.exitRunway, plan.runwayBeats);
  const incomingRunway = beatPattern(candidate.analysis, incoming.entryRunway, plan.runwayBeats);
  const outgoingHandoff = beatPattern(current.analysis, Math.max(outgoing.exitRunway, outgoing.exitHandoff - plan.runwayBeats * 60 / Math.max(1, outgoing.bpm)), plan.runwayBeats);
  const incomingHandoff = beatPattern(candidate.analysis, incoming.entryDrop, plan.runwayBeats);
  const outgoingBlend = beatPattern(current.analysis, outgoing.exitHandoff, plan.blendBeats);
  const incomingBlend = beatPattern(candidate.analysis, incoming.entryDrop, plan.blendBeats);
  const runwaySimilarity = bassPatternSimilarity(outgoingRunway, incomingRunway);
  const handoffSimilarity = bassPatternSimilarity(outgoingHandoff, incomingHandoff);
  const blendSimilarity = bassPatternSimilarity(outgoingBlend, incomingBlend);
  const incomingRunwayAudienceMuted = audibleRunwayPhraseEdge(candidate.analysis, incoming.entryRunway, incoming.entryDrop) >= incoming.entryDrop - .03;
  // A silent incoming runup is timing preparation, not part of the audible
  // bass-pattern comparison. Judge that option on the phrase-edge handoff and
  // the patient post-swap hold instead of penalising an intentionally empty
  // section that the room cannot hear.
  const bassSimilarity = incomingRunwayAudienceMuted
    ? handoffSimilarity * .7 + blendSimilarity * .3
    : handoffSimilarity * .6 + runwaySimilarity * .15 + blendSimilarity * .25;
  const incomingRate = cueLockedTempoRate(outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop, 1);
  const tempoShiftPercent = Math.abs(incomingRate - 1) * 100;
  const tempoScore = Math.max(0, 1 - tempoShiftPercent / 10);
  const outgoingCriticalEnd = beatTimeAfter(current.analysis, outgoing.exitHandoff, 16);
  const incomingCriticalEnd = beatTimeAfter(candidate.analysis, incoming.entryDrop, 16);
  const outgoingGridCoverage = assessRunwayGridCoverage(current.analysis, outgoing.exitRunway, outgoingCriticalEnd);
  const incomingCombinedGridCoverage = assessRunwayGridCoverage(candidate.analysis, incoming.entryRunway, incomingCriticalEnd);
  const incomingRunwayGridCoverage = assessRunwayGridCoverage(candidate.analysis, incoming.entryRunway, incoming.entryDrop);
  const incomingPostHandoffGridCoverage = assessRunwayGridCoverage(candidate.analysis, incoming.entryDrop, incomingCriticalEnd);
  const outgoingMixEnd = beatTimeAfter(current.analysis, outgoing.exitHandoff, plan.blendBeats);
  const incomingMixEnd = beatTimeAfter(candidate.analysis, incoming.entryDrop, plan.blendBeats);
  const outgoingContinuity = assessRunwayGridCoverage(current.analysis, outgoingCriticalEnd, outgoingMixEnd);
  const incomingContinuity = assessRunwayGridCoverage(candidate.analysis, incomingCriticalEnd, incomingMixEnd);
  // A transition is only as trustworthy as its weaker runway. Whole-track
  // verification remains a library-storage check, not a transition score.
  const incomingCombinedSafe = runwayCoverageSafe(incomingCombinedGridCoverage);
  const silentRunupConfirmedAfterSwap = incomingRunwayAudienceMuted
    && continuityCoverageSafe(incomingRunwayGridCoverage)
    && runwayCoverageSafe(incomingPostHandoffGridCoverage);
  const incomingGridCoverage = incomingCombinedSafe ? incomingCombinedGridCoverage : incomingPostHandoffGridCoverage;
  const gridCoverage = Math.min(outgoingGridCoverage.verifiedEvidenceCoverage, incomingGridCoverage.verifiedEvidenceCoverage);
  const transitionGridSafe = runwayCoverageSafe(outgoingGridCoverage)
    && (incomingCombinedSafe || silentRunupConfirmedAfterSwap)
    && continuityCoverageSafe(outgoingContinuity)
    && continuityCoverageSafe(incomingContinuity);
  const rundown = predictRundownLoop(current.analysis, outgoing.exitHandoff, candidate.analysis, incoming.entryDrop);
  if (rundown.loop) {
    const outgoingCues = outgoing.cuePoints
      .filter((cue) => cue.id !== "mix-out")
      .concat([
        { id: "rundown-loop-start", time: rundown.loop.loopStart, label: "RUNDOWN HOLD", description: `${rundown.loop.loopBeats}-beat neutral outgoing loop; used because the natural rundown is predicted to clutter the new primary tune.`, colour: "#31d6c4" },
        { id: "rundown-loop-end", time: rundown.loop.loopEnd, label: "HOLD END", description: "Beat-aligned end of the neutral outgoing loop.", colour: "#31d6c4" },
      ]);
    const incomingCues = incoming.cuePoints.concat({ id: "rundown-loop-release", time: rundown.loop.releaseIncomingTime, label: "CUT EXIT", description: `Stop the outgoing hold on this new-primary break, ${rundown.loop.releaseBeatOffset} beats after handoff.`, colour: "#f0e45a" });
    outgoing = { ...outgoing, rundownLoop: rundown.loop, cuePoints: outgoingCues };
    incoming = { ...incoming, cuePoints: incomingCues };
    plan = { ...plan, tracks: [outgoing, incoming] };
  }
  if (incomingPlayability.nextExitHandoff !== null) {
    const nextExitHandoff = incomingPlayability.nextExitHandoff;
    const nextExitRunway = beatTimeAfter(candidate.analysis, nextExitHandoff, -32);
    const nextMixOut = beatTimeAfter(candidate.analysis, nextExitHandoff, 64);
    const incomingCues = incoming.cuePoints
      .filter((cue) => !["exit-runway", "exit-handoff", "mix-out"].includes(cue.id))
      .concat([
        { id: "exit-runway", time: nextExitRunway, label: "RUNWAY OUT", description: "Prepare the next deck here, 32 beats before this tune's already-selected bass switch.", colour: "#ffc857" },
        { id: "exit-handoff", time: nextExitHandoff, label: "MIX OUT · BASS OFF", description: "This future bass-swap cue was selected with the tune and remains locked until the playhead passes it.", colour: "#ff6a4a" },
        { id: "mix-out", time: nextMixOut, label: "MIX CLEAR", description: "End of the 64-beat post-handoff hold for this tune's future transition.", colour: "#ab7dff" },
      ]);
    incoming = { ...incoming, exitRunway: nextExitRunway, exitHandoff: nextExitHandoff, mixOut: nextMixOut, cuePoints: incomingCues };
    plan = { ...plan, tracks: [outgoing, incoming] };
  }
  const score = bassSimilarity * .68 + tempoScore * .24 + gridCoverage * .05 + (1 - rundown.riskScore) * .03;
  const accepted = phrasePair.phrasePaired
    && bassSimilarity >= MIN_INCOMING_BASS_SIMILARITY
    && tempoShiftPercent <= MAX_INCOMING_TEMPO_SHIFT_PERCENT
    && transitionGridSafe
    && rundown.safe
    && incomingPlayability.safe
    && score >= MIN_INCOMING_MIX_SCORE;
  return { accepted, score, bassSimilarity, runwaySimilarity, blendSimilarity, incomingRunwayAudienceMuted, tempoShiftPercent, gridCoverage, outgoingGridCoverage, incomingGridCoverage, transitionGridSafe, rundownSafe: rundown.safe, rundownRisk: rundown.riskScore, rundownReason: rundown.reason, ...phrasePair, incomingPlayabilitySafe: incomingPlayability.safe, incomingActiveBassKickBeats: incomingPlayability.activeBassKickBeats, incomingNextExitHandoff: incomingPlayability.nextExitHandoff, incomingPlayabilityScore: incomingPlayability.score, plan };
}

export function assessLiveOpenerExit(analysis: LiveAnalysis) {
  const exits = plausibleCandidates(findExitCueCandidates(analysis), .65, 16);
  const assessed = exits.map((exit) => {
    const start = beatTimeAfter(analysis, exit.time, -32);
    const end = beatTimeAfter(analysis, exit.time, 64);
    const coverage = assessRunwayGridCoverage(analysis, start, end);
    return { exit, start, end, coverage, safe: runwayCoverageSafe(coverage) };
  });
  const safe = assessed.filter((item) => item.safe);
  return {
    accepted: safe.length > 0,
    safeExitWindows: safe.length,
    best: safe.sort((left, right) => right.exit.score - left.exit.score)[0] ?? null,
    bestPotential: assessed.sort((left, right) => right.exit.score - left.exit.score)[0] ?? null,
  };
}

export function selectLockedOutgoingCue(analysis: LiveAnalysis, outgoingNotBefore: number, preferredHandoff?: number): LockedOutgoingCue | null {
  const all = findExitCueCandidates(analysis, { allowEarlyExit: true });
  if (!all.length) return null;
  const maximum = Math.max(...all.map((candidate) => candidate.score), .0001);
  const preferred = Number.isFinite(preferredHandoff)
    ? all.reduce((nearest, candidate) => Math.abs(candidate.time - preferredHandoff!) < Math.abs(nearest.time - preferredHandoff!) ? candidate : nearest)
    : null;
  const preferredIsExact = Boolean(preferred && Math.abs(preferred.time - preferredHandoff!) <= .05);
  const floor = preferredIsExact ? preferred!.time : -Infinity;
  const later = all
    .filter((candidate) => candidate.time > floor + .05 && candidate.score >= maximum * .4)
    .sort((left, right) => left.time - right.time || right.score - left.score);
  const ordered = [...(preferredIsExact ? [preferred!] : []), ...later];
  for (const exit of ordered) {
    const exitRunway = beatTimeAfter(analysis, exit.time, -32);
    const isLockedPreferred = preferredIsExact && exit === preferred;
    // A selected bass-swap cue remains the cue until the playhead actually
    // passes it. Losing its preparation runway may mean no candidate can use
    // it, but that is not permission to silently move the musical decision.
    if (isLockedPreferred ? exit.time <= outgoingNotBefore + .05 : exitRunway <= outgoingNotBefore + 4) continue;
    const criticalEnd = beatTimeAfter(analysis, exit.time, 16);
    const mixOut = beatTimeAfter(analysis, exit.time, 64);
    const critical = assessRunwayGridCoverage(analysis, exitRunway, criticalEnd);
    const continuity = assessRunwayGridCoverage(analysis, criticalEnd, mixOut);
    if (!runwayCoverageSafe(critical) || !continuityCoverageSafe(continuity)) continue;
    return { beatIndex: exit.beatIndex, exitRunway, exitHandoff: exit.time, mixOut, score: exit.score };
  }
  return null;
}

export function assessLiveCandidate(
  current: { id: string; name: string; analysis: LiveAnalysis },
  candidate: { id: string; name: string; analysis: LiveAnalysis },
  options: { outgoingNotBefore?: number; lockedOutgoingHandoff?: number } = {},
): LiveCandidateAssessment {
  const baseline = planDemoSet([current, candidate]);
  // Live pairing may use any structurally sound hole that still has the
  // required runway/blend beats. Raw track percentages must not hide a useful
  // mid-track exit or a later incoming phrase break.
  const normalExits = findExitCueCandidates(current.analysis);
  const normalEntries = findEntryCueCandidates(candidate.analysis);
  const allExits = findExitCueCandidates(current.analysis, { allowEarlyExit: true });
  const allEntries = findEntryCueCandidates(candidate.analysis, { allowLateEntry: true });
  const unlockedExits = mergeCueCandidates(
    plausibleCandidates(normalExits, .58),
    phraseRangeCandidates(allExits, current.analysis, .4, .52, 3, 2),
  );
  const lockedExit = Number.isFinite(options.lockedOutgoingHandoff)
    ? allExits.reduce((nearest, exit) => Math.abs(exit.time - options.lockedOutgoingHandoff!) < Math.abs(nearest.time - options.lockedOutgoingHandoff!) ? exit : nearest, allExits[0])
    : null;
  const exits = (lockedExit && Math.abs(lockedExit.time - options.lockedOutgoingHandoff!) <= .05 ? [lockedExit] : unlockedExits)
    .filter((exit) => beatTimeAfter(current.analysis, exit.time, -baseline.runwayBeats) > (options.outgoingNotBefore ?? -Infinity) + 4);
  const entries = mergeCueCandidates(
    plausibleCandidates(normalEntries, .42, 12),
    phraseRangeCandidates(allEntries, candidate.analysis, .5, .9, 5, 2),
  );
  const futureExits = findExitCueCandidates(candidate.analysis, { allowEarlyExit: true });
  const plans: Array<{ plan: DemoSetPlan; phrasePair: { phrasePaired: boolean; phraseAlignment: number; outgoingBassHole: number; expandedPhrasePair: boolean }; incomingPlayability: IncomingPlayability }> = [];
  for (const exit of exits) {
    for (const entry of entries) {
      for (const runwayBeats of MIX_RUNWAY_BEAT_OPTIONS) {
        for (const blendBeats of MIX_HOLD_BEAT_OPTIONS) {
          if (exit.beatIndex < runwayBeats || entry.beatIndex < runwayBeats) continue;
          if (exit.beatIndex + blendBeats >= current.analysis.beats.length || entry.beatIndex + blendBeats >= candidate.analysis.beats.length) continue;
          const plan = planWithCuePair(baseline, current.analysis, candidate.analysis, exit, entry, runwayBeats, blendBeats);
          if (plan.tracks[0].exitRunway <= (options.outgoingNotBefore ?? -Infinity) + 4) continue;
          plans.push({
            plan,
            phrasePair: cuePairPhraseAlignment(current.analysis, candidate.analysis, exit, entry, allExits[0]?.score ?? exit.score, allEntries[0]?.score ?? entry.score),
            incomingPlayability: assessIncomingPlayability(candidate.analysis, entry.beatIndex, futureExits, plan),
          });
        }
      }
    }
  }
  if (!plans.length) plans.push({ plan: baseline, phrasePair: { phrasePaired: false, phraseAlignment: 0, outgoingBassHole: 0, expandedPhrasePair: false }, incomingPlayability: { safe: false, activeBassKickBeats: 0, nextExitHandoff: null, score: 0 } });
  const assessments = plans.map(({ plan, phrasePair, incomingPlayability }) => assessCuePair(current, candidate, plan, phrasePair, incomingPlayability));
  assessments.sort((left, right) => Number(right.accepted) - Number(left.accepted)
    || Number(right.transitionGridSafe) - Number(left.transitionGridSafe)
    // A neutral-loop exit is a rescue strategy, not a flourish. If an accepted
    // cue pair has a naturally clear rundown, prefer it before comparing score.
    || Number(!right.plan.tracks[0].rundownLoop) - Number(!left.plan.tracks[0].rundownLoop)
    || right.plan.blendBeats - left.plan.blendBeats
    // Candidate discovery is broader than the old raw-position gates, but the
    // winner is still chosen by the established transition fit. Phrase-hole
    // options are retained below for comparison; their location alone cannot
    // force the mix.
    || (Math.abs(right.incomingPlayabilityScore - left.incomingPlayabilityScore) > .15
      ? right.incomingPlayabilityScore - left.incomingPlayabilityScore
      : right.score - left.score)
    || right.incomingPlayabilityScore - left.incomingPlayabilityScore
    || right.score - left.score
    || right.bassSimilarity - left.bassSimilarity
    || Number(right.phrasePaired) - Number(left.phrasePaired)
    || right.phraseAlignment - left.phraseAlignment);
  const best = assessments[0];
  const phraseAlternatives = assessments
    .filter((assessment) => assessment.accepted && assessment.expandedPhrasePair)
    .sort((left, right) => right.score - left.score || right.bassSimilarity - left.bassSimilarity || right.phraseAlignment - left.phraseAlignment)
    .map((assessment) => ({
      runwayBeats: assessment.plan.runwayBeats,
      blendBeats: assessment.plan.blendBeats,
      exitRunway: assessment.plan.tracks[0].exitRunway,
      exitHandoff: assessment.plan.tracks[0].exitHandoff,
      entryRunway: assessment.plan.tracks[1].entryRunway,
      entryDrop: assessment.plan.tracks[1].entryDrop,
      score: assessment.score,
      bassSimilarity: assessment.bassSimilarity,
      phraseAlignment: assessment.phraseAlignment,
    }));
  const cuePairsTested = plans.length;
  const accepted = best.accepted && best.plan.tracks[0].exitRunway > (options.outgoingNotBefore ?? -Infinity) + 4;
  const reason = accepted
    ? `passed assessment after testing ${cuePairsTested} cue pair${cuePairsTested === 1 ? "" : "s"}: ${best.plan.runwayBeats}-beat phrase-edge runup and ${best.plan.blendBeats}-beat post-handoff hold; local transition ${Math.round(best.bassSimilarity * 100)}% (runways ${Math.round(best.runwaySimilarity * 100)}%, mix ${Math.round(best.blendSimilarity * 100)}%); ${best.incomingActiveBassKickBeats} active bass/kick beats retained before the next safe exit; critical grid evidence out ${Math.round(best.outgoingGridCoverage.verifiedEvidenceCoverage * 100)}% / in ${Math.round(best.incomingGridCoverage.verifiedEvidenceCoverage * 100)}%; tempo move ${best.tempoShiftPercent.toFixed(1)}%; ${best.rundownReason}`
    : !best.transitionGridSafe
      ? `passed over after testing ${cuePairsTested} cue pair${cuePairsTested === 1 ? "" : "s"}: no locally safe mix-in/out pairing`
      : !best.rundownSafe
        ? `passed over after testing ${cuePairsTested} cue pairs: ${best.rundownReason}`
      : !best.incomingPlayabilitySafe
        ? `passed over after testing ${cuePairsTested} cue pairs: no entry left enough active bass/kick space to reach the incoming tune's next safe handoff`
      : best.bassSimilarity < MIN_INCOMING_BASS_SIMILARITY
        ? `passed over after testing ${cuePairsTested} cue pairs: best transition-window bass pattern was ${Math.round(best.bassSimilarity * 100)}% compatible`
        : best.tempoShiftPercent > MAX_INCOMING_TEMPO_SHIFT_PERCENT
          ? `passed over after testing ${cuePairsTested} cue pairs: best option needs ${best.tempoShiftPercent.toFixed(1)}% tempo movement`
          : `passed over after testing ${cuePairsTested} cue pairs: combined fit ${Math.round(best.score * 100)}%`;
  return { ...best, accepted, cuePairsTested, phraseAlternatives, reason };
}

export type DemoDeckId = "A" | "B" | "C";

export type DemoBeat = {
  beat: number;
  time: number;
  isDownbeat: boolean;
  confidence: number;
  isPhraseStart?: boolean;
  phraseConfidence?: number;
};

export type DemoAnalysis = {
  duration: number;
  hopSeconds: number;
  track: { id: string; name: string };
  beats: DemoBeat[];
  lowWaveformDetailed: number[];
  bassLowWaveformDetailed?: number[];
  bassHighWaveformDetailed?: number[];
  kickWaveformDetailed?: number[];
  lowAttackWaveformDetailed?: number[];
  upperAttackWaveformDetailed?: number[];
  crashWaveformDetailed?: number[];
  // `confidence` is how sure the grid is of this section's tempo, 0..1. The
  // analyser has always written it; the type omitted it, so nothing could read
  // how much the tempo under a cue is worth trusting. Optional because older
  // stored analyses predate the field.
  tempoSections: Array<{ start: number; end: number; bpm: number; confidence?: number }>;
  teaching?: {
    preferredCue?: { time: number };
    preferredEntryCue?: { time: number };
    manualCycle?: { start: number; end: number; beats: number; bpm: number };
  };
};

export type DemoCuePoint = {
  id: string;
  time: number;
  label: string;
  description: string;
  colour: string;
};

export type DemoTrackPlan = {
  id: string;
  name: string;
  deck: DemoDeckId;
  analysis: DemoAnalysis;
  bpm: number;
  entryRunway: number;
  entryDrop: number;
  skipTo: number;
  exitRunway: number;
  exitHandoff: number;
  mixOut: number;
  rundownLoop?: {
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
  cuePoints: DemoCuePoint[];
};

export type DemoSetPlan = {
  title: string;
  runwayBeats: number;
  blendBeats: number;
  settleBeats: number;
  tracks: DemoTrackPlan[];
};

export const CROWD2_DEMO_TRACK_IDS = ["03", "06", "08"] as const;
export const DEMO_RUNWAY_BEATS = 32;
export const MIX_RUNWAY_BEAT_OPTIONS = [32, 64] as const;
export const DEMO_BLEND_BEATS = 64;
export const MIX_HOLD_BEAT_OPTIONS = [128, 64] as const;
export const DEMO_SETTLE_BEATS = 16;

export function cueLockedTempoRate(outgoingRunway: number, outgoingCue: number, incomingRunway: number, incomingCue: number, outgoingRate = 1) {
  const outgoingSpan = Math.max(.001, outgoingCue - outgoingRunway);
  const incomingSpan = Math.max(.001, incomingCue - incomingRunway);
  return outgoingRate * incomingSpan / outgoingSpan;
}

export function bpmMatchedTempoRate(outgoingBpm: number, incomingBpm: number, outgoingRate = 1) {
  if (!Number.isFinite(outgoingBpm) || outgoingBpm <= 0 || !Number.isFinite(incomingBpm) || incomingBpm <= 0) {
    return Number.isFinite(outgoingRate) && outgoingRate > 0 ? outgoingRate : 1;
  }
  return outgoingBpm * outgoingRate / incomingBpm;
}

export function sourceTimeAlignedToCue(outgoingTime: number, outgoingRunway: number, outgoingCue: number, incomingRunway: number, incomingCue: number) {
  const outgoingSpan = Math.max(.001, outgoingCue - outgoingRunway);
  const incomingSpan = Math.max(.001, incomingCue - incomingRunway);
  return incomingRunway + (outgoingTime - outgoingRunway) / outgoingSpan * incomingSpan;
}

export function audibleRunwayPhraseEdge(analysis: DemoAnalysis, entryRunway: number, entryDrop: number) {
  const nearestIndex = (time: number) => analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[best].time - time) ? index : best, 0);
  const runwayIndex = nearestIndex(entryRunway);
  const dropIndex = nearestIndex(entryDrop);
  // Running the deck is preparation, not permission to send it to the room.
  // Only a detected phrase edge in the final 32 beats may begin the audible
  // pre-handoff blend; otherwise it stays muted until the handoff itself.
  const latePhrase = analysis.beats
    .map((beat, beatIndex) => ({ beat, beatIndex }))
    .filter(({ beat, beatIndex }) => beat.isPhraseStart && beatIndex > runwayIndex && beatIndex >= dropIndex - 32 && beatIndex < dropIndex)
    .at(-1);
  return latePhrase?.beat.time ?? entryDrop;
}

export type DemoCueCandidate = { beatIndex: number; time: number; score: number };
export type DemoCueSearchOptions = { allowEarlyExit?: boolean; allowLateEntry?: boolean };

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

function beatEnergies(analysis: DemoAnalysis) {
  const waveform = analysis.lowWaveformDetailed;
  const hop = Math.max(.001, analysis.hopSeconds);
  return analysis.beats.slice(0, -1).map((beat, index) => average(
    waveform,
    beat.time / hop,
    analysis.beats[index + 1].time / hop,
  ));
}

function meanBeatEnergy(energies: number[], startBeat: number, endBeat: number) {
  return average(energies, startBeat, endBeat);
}

function earliestStrongCandidate(candidates: DemoCueCandidate[], threshold = .66) {
  if (!candidates.length) throw new Error("No phrase-aligned cue candidate was available");
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  const strong = candidates.filter((candidate) => candidate.score >= maximum * threshold);
  return (strong.length ? strong : candidates).reduce((earliest, candidate) => candidate.time < earliest.time ? candidate : earliest);
}

function entryDropCandidates(analysis: DemoAnalysis, energies: number[], options: DemoCueSearchOptions = {}) {
  const energyMedian = percentile(energies, .5);
  const candidates: DemoCueCandidate[] = [];
  analysis.beats.forEach((beat, beatIndex) => {
    if (!beat.isPhraseStart || beatIndex < DEMO_RUNWAY_BEATS + 8 || beatIndex > analysis.beats.length - DEMO_BLEND_BEATS - 8) return;
    const position = beat.time / analysis.duration;
    if (position < .08 || position > (options.allowLateEntry ? .85 : .56)) return;
    const beforeEight = meanBeatEnergy(energies, beatIndex - 8, beatIndex);
    const afterEight = meanBeatEnergy(energies, beatIndex, beatIndex + 8);
    const beforeFour = meanBeatEnergy(energies, beatIndex - 4, beatIndex);
    const afterFour = meanBeatEnergy(energies, beatIndex, beatIndex + 4);
    if (afterEight < energyMedian * .82) return;
    const rise = Math.max(0, afterEight - beforeEight);
    const immediateRise = Math.max(0, afterFour - beforeFour);
    const score = rise * 3 + immediateRise * 2 + afterEight * .5 + (beat.isPhraseStart ? .45 : 0);
    candidates.push({ beatIndex, time: beat.time, score });
  });
  const taughtTime = analysis.teaching?.preferredEntryCue?.time;
  if (Number.isFinite(taughtTime)) {
    const beatIndex = analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - taughtTime!) < Math.abs(analysis.beats[best].time - taughtTime!) ? index : best, 0);
    if (beatIndex >= DEMO_RUNWAY_BEATS && beatIndex + DEMO_BLEND_BEATS < analysis.beats.length) {
      const maximum = Math.max(.0001, ...candidates.map((candidate) => candidate.score));
      candidates.unshift({ beatIndex, time: taughtTime!, score: maximum * 1.35 + 1 });
    }
  }
  if (candidates.length) return candidates;

  const fallback = analysis.beats
    .map((beat, beatIndex) => ({ beat, beatIndex }))
    .filter(({ beat, beatIndex }) => beat.isPhraseStart && beatIndex >= DEMO_RUNWAY_BEATS && beat.time >= analysis.duration * .1 && beat.time <= analysis.duration * .42)
    .map(({ beat, beatIndex }) => ({ beatIndex, time: beat.time, score: meanBeatEnergy(energies, beatIndex, beatIndex + 8) }));
  return fallback;
}

function exitHandoffCandidates(analysis: DemoAnalysis, energies: number[], options: DemoCueSearchOptions = {}) {
  const candidates: DemoCueCandidate[] = [];
  analysis.beats.forEach((beat, beatIndex) => {
    if (!beat.isPhraseStart || beatIndex < DEMO_RUNWAY_BEATS || beatIndex + DEMO_BLEND_BEATS >= analysis.beats.length) return;
    const position = beat.time / analysis.duration;
    if (position < (options.allowEarlyExit ? .4 : .52)) return;
    // A useful outgoing handoff needs an established low-end runway and enough
    // continuing kick/bass material to support the blend after we EQ its bass
    // away. Track percentage is irrelevant once the required beats fit.
    const runwayBass = meanBeatEnergy(energies, beatIndex - DEMO_RUNWAY_BEATS, beatIndex);
    const establishedBass = meanBeatEnergy(energies, beatIndex - 16, beatIndex);
    const immediateBass = meanBeatEnergy(energies, beatIndex, beatIndex + 16);
    const remainingBass = meanBeatEnergy(energies, beatIndex, beatIndex + DEMO_BLEND_BEATS);
    const extendedBeats = Math.min(DEMO_BLEND_BEATS, Math.max(0, energies.length - (beatIndex + DEMO_BLEND_BEATS)));
    const extendedBass = extendedBeats
      ? meanBeatEnergy(energies, beatIndex + DEMO_BLEND_BEATS, beatIndex + DEMO_BLEND_BEATS + extendedBeats) * extendedBeats / DEMO_BLEND_BEATS
      : 0;
    const continuity = Math.min(establishedBass, immediateBass, remainingBass);
    const stability = Math.max(0, 1 - Math.abs(establishedBass - immediateBass));
    // A four-beat bass gap is strong local evidence for the phrase edge, but
    // never a replacement for the edge itself.
    const beforeFour = meanBeatEnergy(energies, beatIndex - 4, beatIndex);
    const afterFour = meanBeatEnergy(energies, beatIndex, beatIndex + 4);
    const nearbyBass = Math.max(
      meanBeatEnergy(energies, beatIndex - 16, beatIndex - 4),
      meanBeatEnergy(energies, beatIndex + 4, beatIndex + 16),
    );
    const fourBeatHole = Math.max(0, nearbyBass - Math.min(beforeFour, afterFour)) / Math.max(.01, nearbyBass);
    const score = runwayBass * .7 + continuity * 1.25 + remainingBass * .45 + extendedBass * .65 + stability * .15 + fourBeatHole * .55 + .45;
    candidates.push({ beatIndex, time: beat.time, score });
  });
  const taughtTime = analysis.teaching?.preferredCue?.time;
  if (Number.isFinite(taughtTime)) {
    const beatIndex = analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - taughtTime!) < Math.abs(analysis.beats[best].time - taughtTime!) ? index : best, 0);
    if (beatIndex >= DEMO_RUNWAY_BEATS && beatIndex + DEMO_BLEND_BEATS < analysis.beats.length) {
      const maximum = Math.max(.0001, ...candidates.map((candidate) => candidate.score));
      candidates.unshift({ beatIndex, time: taughtTime!, score: maximum * 1.35 + 1 });
    }
  }
  if (candidates.length) return candidates;

  const fallback = analysis.beats
    .map((beat, beatIndex) => ({ beat, beatIndex }))
    .filter(({ beat, beatIndex }) => beat.isPhraseStart && beat.time >= analysis.duration * .58 && beatIndex + DEMO_BLEND_BEATS < analysis.beats.length)
    .map(({ beat, beatIndex }) => ({ beatIndex, time: beat.time, score: meanBeatEnergy(energies, beatIndex, beatIndex + 8) }));
  return fallback;
}

export function findEntryCueCandidates(analysis: DemoAnalysis, options: DemoCueSearchOptions = {}) {
  return entryDropCandidates(analysis, beatEnergies(analysis), options).sort((left, right) => right.score - left.score);
}

export function findExitCueCandidates(analysis: DemoAnalysis, options: DemoCueSearchOptions = {}) {
  return exitHandoffCandidates(analysis, beatEnergies(analysis), options).sort((left, right) => right.score - left.score);
}

function findEntryDrop(analysis: DemoAnalysis, energies: number[]) {
  return earliestStrongCandidate(entryDropCandidates(analysis, energies), .6);
}

function findExitHandoff(analysis: DemoAnalysis, energies: number[]) {
  return earliestStrongCandidate(exitHandoffCandidates(analysis, energies), .72);
}

function beatTime(analysis: DemoAnalysis, index: number) {
  return analysis.beats[Math.max(0, Math.min(analysis.beats.length - 1, index))].time;
}

function bpmAt(analysis: DemoAnalysis, time: number) {
  return analysis.tempoSections.find((section) => time >= section.start && time < section.end)?.bpm
    ?? analysis.tempoSections[0]?.bpm
    ?? 145;
}

export function planDemoSet(inputs: Array<{ id: string; name: string; analysis: DemoAnalysis }>): DemoSetPlan {
  if (inputs.length < 2) throw new Error("The automated demo needs at least two mapped tunes");
  const planned = inputs.map((input, order) => {
    const energies = beatEnergies(input.analysis);
    const entry = findEntryDrop(input.analysis, energies);
    const exit = findExitHandoff(input.analysis, energies);
    const entryRunway = beatTime(input.analysis, entry.beatIndex - DEMO_RUNWAY_BEATS);
    const skipTo = beatTime(input.analysis, exit.beatIndex - DEMO_RUNWAY_BEATS * 2);
    const exitRunway = beatTime(input.analysis, exit.beatIndex - DEMO_RUNWAY_BEATS);
    const mixOut = beatTime(input.analysis, exit.beatIndex + DEMO_BLEND_BEATS);
    const isFirst = order === 0;
    const isLast = order === inputs.length - 1;
    const cuePoints: DemoCuePoint[] = [];
    if (isFirst) cuePoints.push({ id: "set-start", time: 0, label: "SET START", description: "Play the first tune from its beginning.", colour: "#d9ff54" });
    else {
      cuePoints.push({ id: "entry-runway", time: entryRunway, label: "RUNWAY IN", description: "Start silently with bass killed; lock tempo and beat phase before raising mids and highs.", colour: "#ff9f43" });
      cuePoints.push({ id: "entry-drop", time: entry.time, label: "MIX IN · BASS ON", description: "Open this tune's bass here as the outgoing bass is killed on the same downbeat.", colour: "#ff4f98" });
    }
    if (!isFirst && !isLast) cuePoints.push({ id: "skip-to", time: skipTo, label: "DEMO SKIP", description: "After the previous mix clears, jump here with 64 beats left before this tune hands over.", colour: "#55a7ff" });
    if (!isLast) {
      cuePoints.push({ id: "exit-runway", time: exitRunway, label: "RUNWAY OUT", description: "Start the next deck here, 32 beats before the bass switch.", colour: "#ffc857" });
      cuePoints.push({ id: "exit-handoff", time: exit.time, label: "MIX OUT · BASS OFF", description: "Kill this tune's bass here while the incoming bass opens on the same downbeat.", colour: "#ff6a4a" });
      cuePoints.push({ id: "mix-out", time: mixOut, label: "MIX CLEAR", description: "End of the 64-beat blend; this outgoing deck is now fully removed.", colour: "#ab7dff" });
    }
    return {
      id: input.id,
      name: input.name,
      deck: (order % 2 === 0 ? "A" : "B") as DemoDeckId,
      analysis: input.analysis,
      bpm: bpmAt(input.analysis, entry.time),
      entryRunway,
      entryDrop: entry.time,
      skipTo,
      exitRunway,
      exitHandoff: exit.time,
      mixOut,
      cuePoints,
    };
  });
  return {
    title: planned.map((track) => track.name).join(" → "),
    runwayBeats: DEMO_RUNWAY_BEATS,
    blendBeats: DEMO_BLEND_BEATS,
    settleBeats: DEMO_SETTLE_BEATS,
    tracks: planned,
  };
}

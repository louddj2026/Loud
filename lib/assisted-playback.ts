import { bassOwnerAtBeat, bassSwapWindowAtBeat, normaliseBassSwapBeats, resizeBassSwapBeats } from "./bass-ownership.ts";
import { bpmMatchedTempoRate, cueLockedTempoRate, type DemoAnalysis, type DemoCuePoint, type DemoSetPlan, type DemoTrackPlan } from "./demo-set.ts";
import type { AnalysisTeaching } from "./teaching.ts";

export type AssistedPlaybackAnalysis = Omit<DemoAnalysis, "teaching"> & { teaching?: AnalysisTeaching };
export type AssistedPlaybackTrack = {
  id: string;
  name: string;
  deck: "A" | "B" | "C";
  analysis: AssistedPlaybackAnalysis;
};

export type AssistedDeckId = AssistedPlaybackTrack["deck"];
const ASSISTED_DECK_ROTATION: readonly AssistedDeckId[] = ["A", "B", "C"];
export const ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS = 8;
export const ASSISTED_SILENT_PREROLL_BEATS = 8;
export const ASSISTED_GRID_GREEN_TOLERANCE_SECONDS = .014;
export const ASSISTED_SILENT_GRID_NUDGE_LIMIT = .008;
export const ASSISTED_BASS_SWITCH_START_FRACTION = .25;
export const ASSISTED_BASS_SWITCH_END_FRACTION = .75;
// Manual assisted sets use one BPM-matching ratio. Kick phase remains visible
// as a diagnostic, but it does not alter tempo or hard-seek at handoff.
export const ASSISTED_CONTINUOUS_GRID_CORRECTION = false;
export const ASSISTED_ENDPOINT_GRID_SNAP = false;
// 32 joined 29 Aug 2026 for the beat-anchored preview windows.
export const ASSISTED_OVERLAP_BEAT_OPTIONS = [32, 64, 96, 128, 160, 192, 224, 256] as const;
export type AssistedOverlapBeats = typeof ASSISTED_OVERLAP_BEAT_OPTIONS[number];
export type AssistedAutomationPoint = {
  beat: number;
  incomingPercent: number;
  outgoingPercent: number;
};
export type AssistedOverlapAutomation = {
  /**
   * Usually one of ASSISTED_OVERLAP_BEAT_OPTIONS, but a REPLICATE (DJ,
   * 30 Aug 2026) legitimately grows an overlap to off-menu counts like 136,
   * so this is a plain count and the option list is a UI matter.
   */
  windowBeats: number;
  /** First swap, kept so older stored automations and readouts keep working. */
  bassSwapBeat: number;
  /**
   * Every beat where bass ownership flips. The outgoing tune owns the low end
   * at beat 0, so one entry reproduces the original single-cue behaviour and
   * more entries let the DJ cut the bass back and forth across the overlap.
   */
  bassSwapBeats: number[];
  points: [AssistedAutomationPoint, AssistedAutomationPoint, AssistedAutomationPoint];
};
export const DEFAULT_ASSISTED_OVERLAP_AUTOMATION: AssistedOverlapAutomation = {
  windowBeats: 64,
  bassSwapBeat: 32,
  bassSwapBeats: [32],
  points: [
    { beat: 0, incomingPercent: 76, outgoingPercent: 100 },
    { beat: 32, incomingPercent: 88, outgoingPercent: 72.5 },
    { beat: 64, incomingPercent: 100, outgoingPercent: 25 },
  ],
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const percentDb = (percent: number) => percent <= 0 ? -60 : 20 * Math.log10(percent / 100);
const gainDb = (gain: number) => gain <= .001 ? -60 : 20 * Math.log10(gain);
export const isAssistedOverlapBeats = (value: number): value is AssistedOverlapBeats => ASSISTED_OVERLAP_BEAT_OPTIONS.some((option) => option === value);

/** Default selected bass cue: the midpoint of the assisted overlap. */
export function assistedBassSwapBeat(windowBeats: number) {
  return Math.max(1, windowBeats / 2);
}

/** The EQ exchange occupies the middle half of the beat before the selected cue. */
export function assistedBassSwitchWindow(bassSwapBeat: number) {
  const cueBeat = Math.max(1, bassSwapBeat);
  const finalBeatStart = cueBeat - 1;
  return {
    startBeat: finalBeatStart + ASSISTED_BASS_SWITCH_START_FRACTION,
    centreBeat: finalBeatStart + .5,
    endBeat: finalBeatStart + ASSISTED_BASS_SWITCH_END_FRACTION,
    cueBeat,
  };
}

export function normaliseAssistedOverlapAutomation(value: unknown): AssistedOverlapAutomation {
  const source = value && typeof value === "object" ? value as Partial<AssistedOverlapAutomation> : {};
  // Any sane whole count is legal — a replicated overlap sits between the
  // menu options — but garbage still falls back to the 64-beat default.
  const requestedBeats = Number(source.windowBeats);
  const windowBeats = Number.isInteger(requestedBeats) && requestedBeats >= 8 && requestedBeats <= 512 ? requestedBeats : 64;
  const defaultBassSwapBeat = assistedBassSwapBeat(windowBeats);
  const storedBassSwapBeat = finite(source.bassSwapBeat, defaultBassSwapBeat);
  // Migrate the brief fixed-final-beat version back to the user's selectable
  // cue. The selector only stores whole beat positions.
  const bassSwapBeat = Math.abs(storedBassSwapBeat - (windowBeats - .5)) < .001
    ? defaultBassSwapBeat
    : clamp(Math.round(storedBassSwapBeat), 1, windowBeats);
  const defaults = DEFAULT_ASSISTED_OVERLAP_AUTOMATION.points.map((point) => ({
    ...point,
    beat: point.beat / DEFAULT_ASSISTED_OVERLAP_AUTOMATION.windowBeats * windowBeats,
  })) as AssistedOverlapAutomation["points"];
  const sourcePoints = Array.isArray(source.points) && source.points.length === 3 ? source.points : defaults;
  const points = sourcePoints.map((point, index) => ({
    // X and Z are the selected window boundaries. Y remains the selected bass
    // cue; only the low-EQ motion is moved into the beat immediately before it.
    beat: index === 0 ? 0 : index === 1 ? bassSwapBeat : windowBeats,
    incomingPercent: clamp(finite(point?.incomingPercent, defaults[index].incomingPercent), 0, 150),
    outgoingPercent: clamp(finite(point?.outgoingPercent, defaults[index].outgoingPercent), 0, 150),
  })) as AssistedOverlapAutomation["points"];
  // An automation stored before ownership existed carries only its single cue,
  // which is exactly a one-entry list. Callers that still set `bassSwapBeat` on
  // a spread — the original cue selector does — must win over the list they
  // carried along unchanged, or selecting a new cue would silently do nothing.
  // Contract: anything changing the ownership list sets `bassSwapBeats` AND
  // `bassSwapBeat` to its first entry. A spread cannot be told apart by value
  // alone, so an explicitly supplied single cue that disagrees with the list is
  // read as the original cue selector moving the one cue.
  const storedList = (source as { bassSwapBeats?: unknown }).bassSwapBeats;
  const listFromSource = Array.isArray(storedList) ? normaliseBassSwapBeats(storedList as number[], windowBeats) : null;
  const singleCueSupplied = Object.prototype.hasOwnProperty.call(source, "bassSwapBeat");
  const singleCueOverridesList = listFromSource !== null
    && singleCueSupplied
    && listFromSource.length > 0
    && listFromSource[0] !== bassSwapBeat;
  const bassSwapBeats = listFromSource === null || singleCueOverridesList
    ? normaliseBassSwapBeats([bassSwapBeat], windowBeats)
    : listFromSource;
  return {
    windowBeats,
    bassSwapBeat: bassSwapBeats[0] ?? bassSwapBeat,
    bassSwapBeats,
    points,
  };
}

export function resizeAssistedOverlapAutomation(value: AssistedOverlapAutomation, windowBeats: number) {
  const current = normaliseAssistedOverlapAutomation(value);
  const scale = windowBeats / current.windowBeats;
  return normaliseAssistedOverlapAutomation({
    windowBeats,
    // Round before normalising so a scaled cue can never land on the legacy
    // windowBeats - .5 migration marker and lose the user's selection.
    bassSwapBeat: clamp(Math.round(current.bassSwapBeat * scale), 1, windowBeats),
    bassSwapBeats: resizeBassSwapBeats(current.bassSwapBeats, current.windowBeats, windowBeats),
    points: current.points.map((point) => ({ ...point, beat: point.beat * scale })),
  });
}

export function assistedAutomationAtBeat(value: AssistedOverlapAutomation, beat: number) {
  const automation = normaliseAssistedOverlapAutomation(value);
  const position = clamp(beat, 0, automation.windowBeats);
  const points = automation.points;
  const rightIndex = points.findIndex((point) => point.beat >= position);
  const right = rightIndex < 0 ? points.at(-1)! : points[rightIndex];
  const left = rightIndex <= 0 ? points[0] : points[rightIndex - 1];
  const progress = right.beat === left.beat ? 1 : clamp((position - left.beat) / (right.beat - left.beat), 0, 1);
  const incomingPercent = left.incomingPercent + (right.incomingPercent - left.incomingPercent) * progress;
  const outgoingPercent = left.outgoingPercent + (right.outgoingPercent - left.outgoingPercent) * progress;
  // Ownership can flip more than once across a long overlap. The exchange
  // being run at this instant is the one governing the nearest swap, and it
  // always hands the low end from whoever held it to whoever takes it — so a
  // cut back to the outgoing tune fades the same way, in the other direction.
  const governing = bassSwapWindowAtBeat(automation.bassSwapBeats, automation.windowBeats, position);
  const bassWindow = governing ?? assistedBassSwitchWindow(automation.bassSwapBeat);
  const bassSwapProgress = clamp((position - bassWindow.startBeat) / Math.max(.001, bassWindow.endBeat - bassWindow.startBeat), 0, 1);
  const bassSwapped = bassSwapProgress >= 1;
  const ownerBeforeSwap = governing
    ? bassOwnerAtBeat(automation.bassSwapBeats, automation.windowBeats, governing.swapBeat - 1)
    : "outgoing";
  const handingOver = Math.cos(bassSwapProgress * Math.PI / 2);
  const takingOver = Math.sin(bassSwapProgress * Math.PI / 2);
  const outgoingBassGain = ownerBeforeSwap === "outgoing" ? handingOver : takingOver;
  const incomingBassGain = ownerBeforeSwap === "outgoing" ? takingOver : handingOver;
  const bassOwner = bassOwnerAtBeat(automation.bassSwapBeats, automation.windowBeats, position);
  return {
    beat: position,
    progress: position / automation.windowBeats,
    bassSwapped,
    bassSwapProgress,
    bassOwner,
    bassSwapBeats: automation.bassSwapBeats,
    bassSwapStartBeat: bassWindow.startBeat,
    bassSwapEndBeat: bassWindow.endBeat,
    beatsUntilBassSwap: Math.max(0, bassWindow.startBeat - position),
    incomingPercent,
    outgoingPercent,
    incomingMidHighGain: incomingPercent / 100,
    outgoingMidHighGain: outgoingPercent / 100,
    incomingMid: percentDb(incomingPercent),
    incomingHigh: percentDb(incomingPercent),
    outgoingMid: percentDb(outgoingPercent),
    outgoingHigh: percentDb(outgoingPercent),
    incomingLow: gainDb(incomingBassGain),
    outgoingLow: gainDb(outgoingBassGain),
  };
}

export function assistedDeckForOrder(order: number): AssistedDeckId {
  const index = ((Math.trunc(order) % ASSISTED_DECK_ROTATION.length) + ASSISTED_DECK_ROTATION.length) % ASSISTED_DECK_ROTATION.length;
  return ASSISTED_DECK_ROTATION[index];
}

/** Map a pair-local plan index back to its A/B/C session order. */
export function assistedLogicalTrackOrder(planTrackIndex: number, orderOffset = 0) {
  return Math.max(0, Math.trunc(orderOffset) + Math.trunc(planTrackIndex));
}

export function assistedPreviousDeck(deck: AssistedDeckId): AssistedDeckId {
  const index = ASSISTED_DECK_ROTATION.indexOf(deck);
  return ASSISTED_DECK_ROTATION[(index - 1 + ASSISTED_DECK_ROTATION.length) % ASSISTED_DECK_ROTATION.length];
}

export function assistedNextDeck(deck: AssistedDeckId): AssistedDeckId {
  const index = ASSISTED_DECK_ROTATION.indexOf(deck);
  return ASSISTED_DECK_ROTATION[(index + 1) % ASSISTED_DECK_ROTATION.length];
}

export function canStartLoadedAssistedSet(loaded: Partial<Record<AssistedDeckId, unknown>>) {
  return Boolean(loaded.A);
}

export function assistedLoadedDeckForOrder(order: number, loaded: Partial<Record<AssistedDeckId, unknown>>): AssistedDeckId | null {
  const deck = assistedDeckForOrder(order);
  return loaded[deck] ? deck : null;
}

type RunupWindow = { start: number; end: number; beats: number };
export const ASSISTED_OVERLAP_START_GAIN = .76;
export const ASSISTED_GAIN_CALIBRATION_BEATS = 8;
export type AssistedMeterSnapshot = {
  rms: number;
  peak: number;
  bassRatio: number;
  brightness: number;
};
export type AssistedGainCalibration = {
  samples: number;
  outgoingRmsSquares: number;
  incomingRmsSquares: number;
  outgoingPeak: number;
  incomingPeak: number;
  outgoingBass: number;
  incomingBass: number;
  outgoingBrightness: number;
  incomingBrightness: number;
};

export function emptyAssistedGainCalibration(): AssistedGainCalibration {
  return {
    samples: 0,
    outgoingRmsSquares: 0,
    incomingRmsSquares: 0,
    outgoingPeak: 0,
    incomingPeak: 0,
    outgoingBass: 0,
    incomingBass: 0,
    outgoingBrightness: 0,
    incomingBrightness: 0,
  };
}

export function addAssistedGainCalibration(
  calibration: AssistedGainCalibration,
  outgoing: AssistedMeterSnapshot,
  incoming: AssistedMeterSnapshot,
) {
  if (outgoing.rms <= .0001 || incoming.rms <= .0001 || outgoing.peak <= .0001 || incoming.peak <= .0001) return calibration;
  return {
    samples: calibration.samples + 1,
    outgoingRmsSquares: calibration.outgoingRmsSquares + outgoing.rms ** 2,
    incomingRmsSquares: calibration.incomingRmsSquares + incoming.rms ** 2,
    outgoingPeak: Math.max(calibration.outgoingPeak, outgoing.peak),
    incomingPeak: Math.max(calibration.incomingPeak, incoming.peak),
    outgoingBass: calibration.outgoingBass + outgoing.bassRatio,
    incomingBass: calibration.incomingBass + incoming.bassRatio,
    outgoingBrightness: calibration.outgoingBrightness + outgoing.brightness,
    incomingBrightness: calibration.incomingBrightness + incoming.brightness,
  };
}

export function averagedAssistedGainCalibration(calibration: AssistedGainCalibration) {
  const samples = calibration.samples;
  if (samples < 1) {
    const empty = { rms: 0, peak: 0, bassRatio: 0, brightness: 0 };
    return { outgoing: empty, incoming: empty };
  }
  return {
    outgoing: {
      rms: Math.sqrt(calibration.outgoingRmsSquares / samples),
      peak: calibration.outgoingPeak,
      bassRatio: calibration.outgoingBass / samples,
      brightness: calibration.outgoingBrightness / samples,
    },
    incoming: {
      rms: Math.sqrt(calibration.incomingRmsSquares / samples),
      peak: calibration.incomingPeak,
      bassRatio: calibration.incomingBass / samples,
      brightness: calibration.incomingBrightness / samples,
    },
  };
}

export function assistedOverlapMix(progress: number, mainVolume: number) {
  const position = Math.max(0, Math.min(1, progress));
  const midHighGain = ASSISTED_OVERLAP_START_GAIN + (1 - ASSISTED_OVERLAP_START_GAIN) * position;
  const midHighDb = 20 * Math.log10(midHighGain);
  return {
    volume: Math.max(0, Math.min(1, mainVolume)),
    low: -60,
    mid: midHighDb,
    high: midHighDb,
    midHighGain,
  };
}

export function assistedOutgoingMidHighEq(progress: number) {
  const position = Math.max(0, Math.min(1, progress));
  const midHighGain = 1 - .35 * position;
  return {
    midHighGain,
    mid: 20 * Math.log10(midHighGain),
    high: 20 * Math.log10(midHighGain),
  };
}

/**
 * DJ, 30 Aug 2026: OFF for now. The calibration measured Shift ~3 dB hot,
 * brought it in at 0.60 instead of the handoff level, and kept it there after
 * the handoff — which reads as "it ducked my incoming deck" from the booth.
 * Flip ASSISTED_GAIN_MATCHING back to true to restore loudness-matched
 * overlaps; the measurement plumbing below stays intact either way.
 */
export const ASSISTED_GAIN_MATCHING = false;

export function assistedFixedGainDecision(
  mainVolume: number,
  outgoing: AssistedMeterSnapshot,
  incoming: AssistedMeterSnapshot,
) {
  if (!ASSISTED_GAIN_MATCHING) {
    return { volume: mainVolume, levelDb: 0, lowDb: 0, midDb: 0, highDb: 0, measured: false as const };
  }
  const usableMeter = outgoing.rms > .0001 && incoming.rms > .0001 && outgoing.peak > .0001 && incoming.peak > .0001;
  const levelDb = usableMeter
    ? Math.max(-3, Math.min(3, .72 * 20 * Math.log10(outgoing.rms / incoming.rms) + .28 * 20 * Math.log10(outgoing.peak / incoming.peak)))
    : 0;
  const highDb = usableMeter
    ? Math.max(-2.5, Math.min(2.5, (outgoing.brightness - incoming.brightness) * 10))
    : 0;
  const midDb = usableMeter
    ? Math.max(-1.5, Math.min(1.5, levelDb * .18 + (incoming.brightness - outgoing.brightness) * 2))
    : 0;
  const lowDb = usableMeter
    ? Math.max(-2, Math.min(2, (outgoing.bassRatio - incoming.bassRatio) * 8))
    : 0;
  return {
    volume: Math.max(0, Math.min(1, mainVolume * 10 ** (levelDb / 20))),
    levelDb,
    lowDb,
    midDb,
    highDb,
    measured: usableMeter,
  };
}

export function assistedRunwayPreviewStart(track: DemoTrackPlan, leadBeats = ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS) {
  const beats = track.analysis.beats;
  const runwayIndex = beats.reduce((best, beat, index) =>
    Math.abs(beat.time - track.exitRunway) < Math.abs(beats[best].time - track.exitRunway) ? index : best, 0);
  const previewBeat = beats[Math.max(0, runwayIndex - Math.max(1, Math.round(leadBeats)))];
  if (previewBeat && previewBeat.time < track.exitRunway) return previewBeat.time;
  return Math.max(0, track.exitRunway - Math.max(1, leadBeats) * 60 / Math.max(1, track.bpm));
}

export function assistedCuePrerollStart(
  analysis: Pick<AssistedPlaybackAnalysis, "beats">,
  cueTime: number,
  bpm: number,
  leadBeats = ASSISTED_SILENT_PREROLL_BEATS,
) {
  const beats = analysis.beats;
  if (beats.length) {
    const cueIndex = beats.reduce((best, beat, index) =>
      Math.abs(beat.time - cueTime) < Math.abs(beats[best].time - cueTime) ? index : best, 0);
    const prerollBeat = beats[Math.max(0, cueIndex - Math.max(1, Math.round(leadBeats)))];
    if (prerollBeat && prerollBeat.time < cueTime) return prerollBeat.time;
  }
  return Math.max(0, cueTime - Math.max(1, leadBeats) * 60 / Math.max(1, bpm));
}

/** Temporary phase bend used only while the incoming channel is muted. */
export function assistedSilentGridNudgeRate(baseRate: number, phaseErrorSeconds: number) {
  const safeBaseRate = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1;
  if (!Number.isFinite(phaseErrorSeconds) || Math.abs(phaseErrorSeconds) <= ASSISTED_GRID_GREEN_TOLERANCE_SECONDS) return safeBaseRate;
  const correction = clamp(
    1 - phaseErrorSeconds * .55,
    1 - ASSISTED_SILENT_GRID_NUDGE_LIMIT,
    1 + ASSISTED_SILENT_GRID_NUDGE_LIMIT,
  );
  return safeBaseRate * correction;
}

function bpmAt(analysis: AssistedPlaybackAnalysis, time: number) {
  const sections = analysis.tempoSections;
  const lastSection = sections.at(-1);
  // Interior boundaries stay half-open (section N end === section N+1 start),
  // but a time at or past the final section's end belongs to that last section.
  return sections.find((section) => time >= section.start && time < section.end)?.bpm
    ?? (lastSection && time >= lastSection.end ? lastSection.bpm : sections[0]?.bpm)
    ?? 0;
}

function optionalRunupWindow(track: AssistedPlaybackTrack, purpose: "intro" | "outro"): RunupWindow | null {
  const teaching = track.analysis.teaching;
  const legacy = teaching?.manualCycle;
  const window = purpose === "intro"
    ? teaching?.manualIntroCycle ?? (legacy?.purpose === "intro-loop" ? legacy : undefined)
    : teaching?.manualOutroCycle ?? (legacy?.purpose === "outro-transition" ? legacy : undefined);
  const label = purpose === "intro" ? "incoming" : "outgoing";
  if (!window) return null;
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end - window.start < .5) {
    throw new Error(`${track.name}'s ${label} run-up window must have a start and a later end`);
  }
  return { start: window.start, end: window.end, beats: Math.max(1, Math.round(window.beats)) };
}

function runupWindow(track: AssistedPlaybackTrack, purpose: "intro" | "outro"): RunupWindow {
  const window = optionalRunupWindow(track, purpose);
  if (window) return window;
  const label = purpose === "intro" ? "incoming" : "outgoing";
  throw new Error(`${track.name} needs a manually selected ${label} run-up window before launch`);
}

function cuePoints(entry: RunupWindow | null, exit: RunupWindow | null): DemoCuePoint[] {
  return [
    ...(entry === null ? [] : [
      { id: "entry-runway", time: entry.start, label: "IN RUN-UP START", description: "Tune starts here when the outgoing run-up starts.", colour: "#ffc857" },
      { id: "entry-drop", time: entry.end, label: "YOUR MIX-IN · WINDOW END", description: "This endpoint lands with the outgoing window endpoint.", colour: "#4cf2b4" },
    ]),
    ...(exit === null ? [] : [
    { id: "exit-runway", time: exit.start, label: "OUT RUN-UP START", description: "The next tune starts its selected run-up here.", colour: "#ffc857" },
    { id: "exit-handoff", time: exit.end, label: "YOUR MIX-OUT · WINDOW END", description: "Both manually selected windows finish together here.", colour: "#ff6a4a" },
    ]),
  ];
}

export function buildAssistedPlaybackPlan(outgoing: AssistedPlaybackTrack, incoming: AssistedPlaybackTrack, automationValue?: AssistedOverlapAutomation): DemoSetPlan {
  const outgoingManualExit = runupWindow(outgoing, "outro");
  const incomingManualEntry = runupWindow(incoming, "intro");
  const automation = automationValue ? normaliseAssistedOverlapAutomation(automationValue) : null;
  const overlapBeats = automation?.windowBeats ?? outgoingManualExit.beats;
  // A beat-count/automation choice may reinterpret the grid inside the selected
  // windows, but the user's exact Preview/booth coordinates are immutable.
  const outgoingExit = automation ? { ...outgoingManualExit, beats: overlapBeats } : outgoingManualExit;
  const incomingEntry = automation ? { ...incomingManualEntry, beats: overlapBeats } : incomingManualEntry;
  // The current transition needs the outgoing tune's Mix Out and the incoming
  // tune's Mix In. The incoming tune's own Mix Out belongs to the next mix.
  const incomingExit = optionalRunupWindow(incoming, "outro");
  const incomingFallbackEnd = Math.max(
    incomingEntry.end,
    incoming.analysis.duration,
    incoming.analysis.beats.at(-1)?.time ?? 0,
  );
  const outgoingBpm = bpmAt(outgoing.analysis, outgoingExit.end);
  const incomingBpm = bpmAt(incoming.analysis, incomingEntry.end);
  // When both confirmed windows carry the same user-selected beat count, their
  // exact spans are the tempo authority; analysis BPM stays reference evidence
  // and must not veto the launch. Compare the manual windows, not the
  // automation-adjusted copies, whose beat counts are overwritten above.
  const tempoRate = outgoingManualExit.beats === incomingManualEntry.beats
    ? cueLockedTempoRate(outgoingExit.start, outgoingExit.end, incomingEntry.start, incomingEntry.end)
    : bpmMatchedTempoRate(outgoingBpm, incomingBpm);
  if (tempoRate < .5 || tempoRate > 2) throw new Error(`${incoming.name}'s BPM cannot be matched safely to ${outgoing.name}`);

  const outgoingEntry = outgoing.analysis.teaching?.manualIntroCycle?.end
    ?? outgoing.analysis.teaching?.preferredEntryCue?.time
    ?? outgoing.analysis.beats.find((beat) => beat.isDownbeat)?.time
    ?? 0;
  const outgoingPlan: DemoTrackPlan = {
    id: outgoing.id,
    name: outgoing.name,
    deck: outgoing.deck,
    analysis: outgoing.analysis,
    bpm: outgoingBpm,
    entryRunway: 0,
    entryDrop: outgoingEntry,
    skipTo: 0,
    exitRunway: outgoingExit.start,
    exitHandoff: outgoingExit.end,
    mixOut: outgoingExit.end,
    cuePoints: cuePoints(null, outgoingExit),
  };
  const incomingPlan: DemoTrackPlan = {
    id: incoming.id,
    name: incoming.name,
    deck: incoming.deck,
    analysis: incoming.analysis,
    bpm: incomingBpm,
    entryRunway: incomingEntry.start,
    entryDrop: incomingEntry.end,
    skipTo: 0,
    exitRunway: incomingExit?.start ?? incomingFallbackEnd,
    exitHandoff: incomingExit?.end ?? incomingFallbackEnd,
    mixOut: incomingExit?.end ?? incomingFallbackEnd,
    cuePoints: cuePoints(incomingEntry, incomingExit),
  };
  return {
    title: `${outgoing.name} → ${incoming.name} · manual run-up windows end together`,
    runwayBeats: overlapBeats,
    blendBeats: 0,
    settleBeats: 16,
    tracks: [outgoingPlan, incomingPlan],
  };
}

function mergeAssistedMiddleTrack(entered: DemoTrackPlan, leaving: DemoTrackPlan) {
  if (entered.id !== leaving.id || entered.deck !== leaving.deck) {
    throw new Error("Adjacent assisted mixes do not share the same middle tune");
  }
  if (leaving.exitRunway <= entered.entryDrop + .001) {
    throw new Error(`${leaving.name}'s Mix Out must start after its Mix In ends`);
  }
  return {
    ...leaving,
    entryRunway: entered.entryRunway,
    entryDrop: entered.entryDrop,
    cuePoints: [
      ...entered.cuePoints.filter((cue) => cue.id.startsWith("entry-")),
      ...leaving.cuePoints.filter((cue) => cue.id.startsWith("exit-")),
    ],
  };
}

export function buildAssistedPlaybackSequence(tracks: AssistedPlaybackTrack[], automationValues?: AssistedOverlapAutomation[]): DemoSetPlan {
  if (tracks.length < 2) throw new Error("An assisted set needs at least two prepared tunes");
  const pairPlans = tracks.slice(0, -1).map((outgoing, index) =>
    buildAssistedPlaybackPlan(outgoing, tracks[index + 1], automationValues?.[index]));
  const plannedTracks: DemoTrackPlan[] = [pairPlans[0].tracks[0]];

  for (let index = 1; index < tracks.length - 1; index += 1) {
    const entered = pairPlans[index - 1].tracks[1];
    const leaving = pairPlans[index].tracks[0];
    plannedTracks.push(mergeAssistedMiddleTrack(entered, leaving));
  }

  plannedTracks.push(pairPlans.at(-1)!.tracks[1]);
  return {
    title: `${tracks.map((track) => track.name).join(" → ")} · complete assisted sequence`,
    runwayBeats: pairPlans[0].runwayBeats,
    blendBeats: 0,
    settleBeats: 0,
    tracks: plannedTracks,
  };
}

export function extendAssistedPlaybackSequence(
  plan: DemoSetPlan,
  outgoing: AssistedPlaybackTrack,
  incoming: AssistedPlaybackTrack,
  automationValue?: AssistedOverlapAutomation,
): DemoSetPlan {
  const entered = plan.tracks.at(-1);
  if (!entered) throw new Error("The assisted sequence has no live tune to extend");
  const pairPlan = buildAssistedPlaybackPlan(outgoing, incoming, automationValue);
  const leaving = pairPlan.tracks[0];
  const next = pairPlan.tracks[1];
  const continued = mergeAssistedMiddleTrack(entered, leaving);
  const trackCount = plan.tracks.length + 1;
  return {
    ...plan,
    title: `Rotating assisted set · ${trackCount} tunes armed`,
    blendBeats: 0,
    settleBeats: 0,
    tracks: [...plan.tracks.slice(0, -1), continued, next],
  };
}

export function assistedPlannedTrackIsReleased(
  tracks: Pick<DemoTrackPlan, "id" | "deck">[],
  transitionIndex: number,
  deck: AssistedDeckId,
  trackId: string,
) {
  let plannedIndex = -1;
  tracks.forEach((track, index) => {
    if (track.deck === deck && track.id === trackId) plannedIndex = index;
  });
  return plannedIndex >= 0 && plannedIndex < transitionIndex;
}

export function playbackContinuationStage(nextTransitionIndex: number, trackCount: number, continuous: boolean) {
  if (nextTransitionIndex >= trackCount - 1) return "complete" as const;
  return continuous ? "primary" as const : "settle" as const;
}

/** Replace one future transition without disturbing either neighbouring mix. */
export function replaceAssistedTransition(
  plan: DemoSetPlan,
  transitionIndex: number,
  replacement: DemoSetPlan,
) {
  const outgoing = plan.tracks[transitionIndex];
  const incoming = plan.tracks[transitionIndex + 1];
  const replacementOutgoing = replacement.tracks[0];
  const replacementIncoming = replacement.tracks[1];
  if (!outgoing || !incoming || !replacementOutgoing || !replacementIncoming) return plan;
  if (outgoing.id !== replacementOutgoing.id || incoming.id !== replacementIncoming.id) return plan;
  const entryCues = (track: DemoTrackPlan) => track.cuePoints.filter((cue) => cue.id.startsWith("entry-"));
  const exitCues = (track: DemoTrackPlan) => track.cuePoints.filter((cue) => !cue.id.startsWith("entry-"));
  const tracks = [...plan.tracks];
  tracks[transitionIndex] = {
    ...replacementOutgoing,
    entryRunway: outgoing.entryRunway,
    entryDrop: outgoing.entryDrop,
    cuePoints: [...entryCues(outgoing), ...exitCues(replacementOutgoing)],
  };
  tracks[transitionIndex + 1] = {
    ...replacementIncoming,
    skipTo: incoming.skipTo,
    exitRunway: incoming.exitRunway,
    exitHandoff: incoming.exitHandoff,
    mixOut: incoming.mixOut,
    rundownLoop: incoming.rundownLoop,
    cuePoints: [...entryCues(replacementIncoming), ...exitCues(incoming)],
  };
  return { ...plan, runwayBeats: replacement.runwayBeats, tracks };
}

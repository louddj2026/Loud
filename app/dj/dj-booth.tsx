"use client";
import { BufferedDeckTransport } from "../../lib/buffered-deck";

import Link from "next/link";
import ControlHelpBubbles, { useControlHelpPreferences } from "./control-help";
import AudioOutputSetup from "./audio-output-setup";
import { DEFAULT_OUTPUT_CONFIG, OUTPUT_STORAGE_KEY, HardwareAudioOutputs, independentOutputs, parseOutputConfig, type OutputConfig } from "../../lib/audio-output";
import ControlSetup, { HotkeyContext, useHotkeyBindings, type SetupMode } from "./control-setup";
import { hotkeyLabel, keyChord, midiEqDb, type ControlAction } from "../../lib/control-bindings";
import TempoStepButton from "./tempo-step-button";
import FocusSpectrum, { type SpectrumSource } from "./focus-spectrum";
import { cueRetriggerTime } from "../../lib/transport-cue";
import { tempoRateAfterBpmStep } from "../../lib/tempo-adjustment";
import { type ChangeEvent, type CSSProperties, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchTrackAnalysis } from "../../lib/analysis-delivery";
import { AUTOMATION_DECK_IDS, BOOTH_METER_FFT_SIZE, BOOTH_VISUAL_DIRECTIONS, BOOTH_VISUAL_FRAME_MS, BOOTH_WAVEFORM_SAMPLE_LIMIT, DECK_IDS, DECK_RESET_REVISION, FOCUS_WAVE_COLOURS, LOOP_SIZES, PHASE_COLOURS, TEMPO_COLOURS, type BoothVisualDirection } from "./dj-ui-config";
import type { Analysis, Cue, DeckId, DeckState, FxType, LoopSize, PhaseStatus, Track } from "./dj-types";
import { blockFraction, formatClock, viewLoadProgress, type LoadStage, type LoadStageId, type LoadStep } from "../../lib/load-progress";
import { describeMappingUpdate, followMapping, MappingRequestError, type MappingUpdate } from "../../lib/mapping-follow";
import { ASSISTED_ENDPOINT_GRID_SNAP, ASSISTED_GAIN_CALIBRATION_BEATS, ASSISTED_GRID_GREEN_TOLERANCE_SECONDS, ASSISTED_OVERLAP_BEAT_OPTIONS, ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS, ASSISTED_SILENT_PREROLL_BEATS, DEFAULT_ASSISTED_OVERLAP_AUTOMATION, addAssistedGainCalibration, assistedAutomationAtBeat, assistedBassSwitchWindow, assistedCuePrerollStart, assistedDeckForOrder, assistedFixedGainDecision, assistedLoadedDeckForOrder, assistedLogicalTrackOrder, assistedNextDeck as nextAssistedDeck, assistedPlannedTrackIsReleased, assistedPreviousDeck, assistedRunwayPreviewStart, assistedSilentGridNudgeRate, averagedAssistedGainCalibration, buildAssistedPlaybackPlan, buildAssistedPlaybackSequence, canStartLoadedAssistedSet, emptyAssistedGainCalibration, extendAssistedPlaybackSequence, isAssistedOverlapBeats, normaliseAssistedOverlapAutomation, playbackContinuationStage, replaceAssistedTransition, resizeAssistedOverlapAutomation, type AssistedAutomationPoint, type AssistedGainCalibration, type AssistedMeterSnapshot, type AssistedOverlapAutomation, type AssistedOverlapBeats } from "../../lib/assisted-playback";
import { ASSISTED_DECISION_LOG_LIMIT, assistedSelectionPool } from "../../lib/assisted-search";
import { ASSISTED_SESSION_STORAGE_KEY, assistedSessionReady, createAssistedSessionSnapshot, parseAssistedSessionSnapshot } from "../../lib/assisted-session";
import { qrSvg } from "../../lib/qr-svg";
import { BOOTH_EQ_FILTERS, BOOTH_LIMITER, BOOTH_OUTPUT_LATENCY_HINT, BOOTH_OUTPUT_TRIM_GAIN, BOOTH_PRESERVE_PITCH, DEFAULT_DECK_CUE, DEFAULT_HEADPHONE_MONITOR, SAFE_LOADED_DECK_VOLUME, boothRoutingLevels, boothVisualTrackTime, effectiveDeckBpm, liveHandoffVolume, tempoRateForTargetBpm } from "../../lib/booth-audio";
import { buildIntroOutroCues } from "../../lib/cue-markers";
import { crowdPeerCanContinue, crowdPollRetryDelay, crowdRtcConfiguration, strengthenCrowdOpusSdp, waitForCrowdIceGathering, type CrowdLinkEvent, type CrowdLinkPost } from "../../lib/crowd-link";
import { audibleRunwayPhraseEdge, cueLockedTempoRate, findEntryCueCandidates, planDemoSet, sourceTimeAlignedToCue, type DemoAnalysis, type DemoSetPlan, type DemoTrackPlan } from "../../lib/demo-set";
import { gridDisagreement, mixOutWithheldReason, predictedEntryCue, predictedMixOutCue } from "../../lib/cue-prediction";
import { gridCheckOutcome, gridCheckTicks, gridCheckWindow, nextGridCheck, type GridCheckItem, type GridCheckRecord, type GridCheckVerdict } from "../../lib/grid-check";
import { assessGridRetentionQuality } from "../../lib/grid-quality";
import { kickPhaseColoursForRoles } from "../../lib/kick-phase-colour";
import { emptyKickPhaseMonitor, kickPhaseReportLabel, observeKickAgainstKick, updateKickPhaseMonitor, type KickPhaseMonitorState, type KickPhaseStatus } from "../../lib/kick-phase-monitor";
import { assessLiveCandidate, assessLiveOpenerExit, liveCandidateAccepted, selectLockedOutgoingCue, type LiveAnalysis, type LockedOutgoingCue } from "../../lib/live-crate";
import { liveCueAwareDeadlineMode, nextTuneSelectionPhase, nextTuneSelectionSecondsRemaining } from "../../lib/live-deadline";
import { uploadLocalTrackFile } from "../../lib/local-track-upload";
import { runupGridDiagnostics } from "../../lib/runup-grid";
import { naturalTempoRate } from "../../lib/tempo-return";
import { authoritativeManualTempoBpm, learnedCueCandidates, manualWindowPurposeAt, resolvedBpmAt, tempoRateAfterManualTempoTeaching, withoutStoredCuePlacements, withRestoredManualWindows, type ManualCyclePurpose, type ManualCycleTeaching, type TeachingProfile } from "../../lib/teaching";
import { isKnownShortSample } from "../../lib/track-duration-policy";
import { bassOwnerAtBeat, bassOwnershipSegments, toggleBassSwapBeat } from "../../lib/bass-ownership";
import { nextBassOverride, overriddenBassLow } from "../../lib/bass-kill";
import { type PreviewDraft } from "../../lib/preview-draft";
import { TRANSITION_PREVIEW_LEAD_BEATS, deriveTransitionPreviewWindow, type TransitionPreviewAnchorEdge, transitionPreviewGridBeats, TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS, TRANSITION_PREVIEW_SILENT_PREROLL_BEATS, selectTransitionPreviewPair, transitionPreviewBeat, transitionPreviewCanCommit, transitionPreviewCrowdAuditionVolume, transitionPreviewLiveArmDecision, transitionPreviewMarkTime, transitionPreviewTempoRate, transitionPreviewWindowReady, type TransitionPreviewLiveRuntimeState, type TransitionPreviewWindow } from "../../lib/transition-preview";
import { PREVIEW_OPEN_SEEK_TOLERANCE_SECONDS, PREVIEW_OVERLAP_RESEEK_SECONDS, PREVIEW_OVERLAP_SAMPLE_EVERY_BEATS, previewOpenSeekDecision, previewOverlapDriftSummary, type PreviewOverlapSample } from "../../lib/preview-overlap-lock";
import { FOCUS_WAVE_DRAG_REBASE_FRACTION, FOCUS_WAVE_GLIDE_STOP_WINDOWS_PER_SECOND, FOCUS_WAVE_THROW_WINDOW_MS, focusWaveBufferedRange, focusWaveChunkPlan, focusWaveDragThresholdPx, focusWaveDragTime, focusWaveGlideStep, focusWaveShouldRebase, focusWaveThrowLimit, focusWaveThrowVelocity, type FocusWaveThrowSample } from "../../lib/waveform-gesture";
import { replicateBlockBeats, replicateMapTime, replicateOccurrences, replicateShiftSeconds, replicateSpliceAnalysis, replicateUnmapTime, type ReplicatePlan } from "../../lib/replicate";
import { diagnosticErrorDetails, reportClientDiagnostic, reportCrowdLiveEvent } from "../../lib/client-diagnostics-client";
import { clippedFocusWaveLabel, focusWaveTrackLabel } from "../../lib/track-labels";
import { loopWindowAtGrid, movedLoopWindow, loopTempoBpm, loopStandbyPosition } from "../../lib/loop-grid";
import { isRecording, isReplaying, listRecordings, readSetFile, recordAction, replayActions, startRecording, startReplay, stopRecording, stopReplay, type ReplayCallbacks, type SetSummary } from "../../lib/set-recorder";
import { boothIsIdle, loadSectionLabels, onSectionLabelsChanged, requestSectionAnalysis, sectionAnalysisGaveUp, sectionAnalysisStatus, sectionAutoAnalyseEnabled, sectionLabelsReady, sectionSpansFor, setBoothIdle, setSectionAutoAnalyse } from "../../lib/section-labels";
import { SECTION_PATTERN_INK, sectionPatternId, sectionPatterns, visibleSectionSpans, type SectionSurface } from "../../lib/section-patterns";
import { applyDrumGrid, drumAnalysisStatus, drumApplyAttempted, drumApplyFor, drumAutoAnalyseEnabled, drumGridFor, forgetDrumApply, onDrumGridChanged, requestDrumAnalysis, setDrumAutoAnalyse } from "../../lib/drum-grid";
import { pitchHoldDurationMs, pitchHoldPlaybackRate, pitchScrubTarget } from "../../lib/pitch-hold";
import { SCRUB_AUDIO_ENABLED, scrubCommand, scrubRouting } from "../../lib/scrub-audio";
import { loadScrubSamples } from "../../lib/scrub-buffer";
import { claimTransitionManualEq, mergeTransitionAutomatedEq, type TransitionManualEqOwnership } from "../../lib/transition-eq-ownership";
import { ReturnToCueIcon, HeadphoneIcon, LoopTransportIcon, PauseTransportIcon, PitchDownIcon, PitchUpIcon, PlayCueTransportIcon, PlayTransportIcon, ZoomInIcon, ZoomOutIcon } from "./transport-icons";

type AutomationDeckId = Extract<DeckId, "A" | "B">;
type BassSwapCueKind = "in" | "out";
type DemoMode = "preparing" | "ready" | "running" | "complete" | "error";
type DemoStage = "primary" | "runway" | "blend" | "settle";
type PreparedDemo = { plan: DemoSetPlan; tracks: Record<string, Track>; assistedAutomations?: AssistedOverlapAutomation[]; rotatingAssisted?: boolean; assistedOrderOffset?: number };
type DeckRestoreLevels = { volume: number; low: number; mid: number; high: number };
type DemoRuntime = { prepared: PreparedDemo; transitionIndex: number; stage: DemoStage; busy: boolean; lastCorrectionAt: number; lastStatusAt: number; settleUntil: number; runwayAudibleFrom?: number; runwayAudible?: boolean; phaseLockTicks?: number; prerollReanchorDone?: boolean; cueOpenScheduled?: boolean; kickPhaseMonitor?: KickPhaseMonitorState; overlapVolume?: number; gainCalibration?: AssistedGainCalibration; gainDecision?: ReturnType<typeof assistedFixedGainDecision>; rundownLoopActive?: boolean; rundownLoopReleased?: boolean; manualEqTransitionIndex?: number; manualEqOwnership?: TransitionManualEqOwnership<DeckId>; incomingRestore?: { deck: DeckId; from: DeckRestoreLevels; to: DeckRestoreLevels; startedAt: number; ms: number };
  /**
   * Manual loops during a transition (DJ, 30 Aug 2026): each completed
   * extra pass of a pair deck's loop adds its beat count to the overlap, so
   * the OTHER tune plays the same number of extra real beats and the
   * automations hold instead of firing early. `loopExtensionBeats` is the
   * total added; the two seconds fields carry the same extension into each
   * deck's own clock domain; `virtualOutgoingTime` is a loop-compensated
   * monotonic copy of the outgoing clock so the automation's beat can never
   * run backwards through a loop pass; `loopWrapMemo` is last tick's
   * element time per deck, for wrap detection.
   */
  loopExtensionBeats?: number; loopExtensionOutgoingSeconds?: number; loopExtensionIncomingSeconds?: number; loopWrapMemo?: Partial<Record<DeckId, number>>; virtualOutgoingTime?: number };
type CrateAlbum = { name: string; count: number };
type CrateScanState = {
  status: "idle" | "running" | "paused" | "complete" | "error";
  totalFiles: number; checked: number; mapped: number; rejected: number; skippedShort: number; skippedKnown: number; compacted: number;
  currentName: string | null; currentStage: string; error: string | null; minimumDurationSeconds: number;
  filesPerHour: number; discoveredSongs: number; estimatedSongsTotal: number | null; estimatedSongsRemaining: number | null;
  estimatedSecondsRemaining: number | null; progressPercent: number;
};
type ScreenWakeLock = { released: boolean; release: () => Promise<void> };
type LiveCrateMode = "loading" | "idle" | "selecting" | "starting" | "searching" | "candidate" | "running" | "error";
type LiveOpener = { track: Track; analysis: Analysis };
type LiveSearchOptions = { waitForDeckClear?: DeckId };
type TempoReturn = { startRate: number; startTrackTime: number; endTrackTime: number; lastAppliedAt: number };
type LoadTrackOptions = {
  preserveTransport?: boolean;
  remember?: boolean;
  /** Called once the deck holds the new tune and its audio is loading (the picker closes here). */
  onAttached?: () => void;
  /** Why no analysis starts with this load, for the deck strip (e.g. the upload saves first). */
  analysisNote?: string;
};
/**
 * One deck's load as the booth really knows it: the deck's own audio element
 * and the advisory analysis, kept apart. `attempt` is the identity — a new
 * load on the deck is a new attempt, and an update for an older one is
 * dropped.
 */
type DeckLoadAnalysis =
  | { state: "none"; note: string }
  | { state: "waiting"; note: string }
  | { state: "mapping"; update: MappingUpdate | null }
  | { state: "fetching"; update: MappingUpdate | null; saved: boolean; startedAt: number }
  | { state: "ready"; update: MappingUpdate | null; saved: boolean; at: number }
  | { state: "failed"; error: string; update: MappingUpdate | null };
type DeckMediaEvent = "metadata" | "canplay" | "error";
type DeckLoad = {
  attempt: number;
  trackId: string;
  trackName: string;
  startedAt: number;
  audio: { state: "loading" | "ready" | "error"; duration: number | null; error: string | null };
  analysis: DeckLoadAnalysis;
};
type ManualWindowPurpose = Extract<ManualCyclePurpose, "intro-loop" | "outro-transition">;
type ManualLoopDialog = { deck: DeckId; trackId: string; trackName: string; start: number; end: number; beats: number; suggestedBeats: number; crowdBpm: number; cueEdge: "start" | "end" | null; exitSide: "before" | "after" | null; purpose: ManualWindowPurpose; automation?: AssistedOverlapAutomation; configurationOnly?: boolean };
type AssistedMode = "idle" | "finding" | "waiting-deck" | "awaiting-cues" | "ready" | "playing" | "error";
type AssistedSource = "random" | "loaded";
type AssistedSelectionContext = { selectedBpm: number; previousTrackId: string | null; previousTrackName: string | null; previousBpm: number | null };
type AssistedCueState = { order: number; deck: DeckId; track: Track; mixInRequired: boolean; mixInSet: boolean; mixOutSet: boolean; introPrepSkipped: boolean; selection: AssistedSelectionContext };
type AssistedPending = { order: number; deck: DeckId; track: Track; analysis: Analysis; selection: AssistedSelectionContext };
type AssistedDeckReset = { trackId: string; currentTime: number; tempoRate: number; volume: number; low: number; mid: number; high: number };
type AssistedReplaySnapshot = { order: number; decks: Partial<Record<DeckId, AssistedDeckReset>> };
type TransitionPreviewRole = "outgoing" | "incoming";
type TransitionPreviewCueSnapshot = {
  /**
   * The shared overlap count AT the moment of the snapshot. Without it,
   * UNDO restored window spans from one beat-count era against another's
   * count — DJ hit it 30 Aug 2026 as a 387.205 BPM readout: a 256-beat
   * incoming span rated against a 96-beat outgoing span (×2.67).
   */
  beats: number;
  outgoingWindow: TransitionPreviewWindow;
  incomingWindow: TransitionPreviewWindow;
  outgoingAnchor: TransitionPreviewAnchorEdge | null;
  incomingAnchor: TransitionPreviewAnchorEdge | null;
  configurationOpen: boolean;
  selectionRole: TransitionPreviewRole | null;
};
/**
 * A live REPLICATE (DJ, 30 Aug 2026): one block of ONE tune, copied in
 * place so its wave doubles and both windows grow by the same beat count.
 * `plan` is in the ORIGINAL tune's clock; `baseAnalysis` is the pristine
 * pre-splice analysis so CLEAR (and a copies change) rebuilds from truth
 * rather than splicing a splice. `saved` is how the windows and shared beat
 * count stood before the paste — the exact state CLEAR walks back to.
 */
type TransitionPreviewReplicate = {
  role: TransitionPreviewRole;
  plan: ReplicatePlan;
  addedBeats: number;
  audio: string;
  baseAnalysis: Analysis;
  saved: { beats: number; outgoingWindow: TransitionPreviewWindow; incomingWindow: TransitionPreviewWindow };
};
type TransitionPreviewState = {
  outgoingDeck: DeckId;
  incomingDeck: DeckId;
  outgoingTrack: Track;
  incomingTrack: Track;
  outgoingAnalysis: Analysis;
  incomingAnalysis: Analysis;
  outgoingWindow: TransitionPreviewWindow;
  incomingWindow: TransitionPreviewWindow;
  /** The edge the DJ marked; the other edge is placed by the beat count. */
  outgoingAnchor: TransitionPreviewAnchorEdge | null;
  incomingAnchor: TransitionPreviewAnchorEdge | null;
  outgoingTime: number;
  incomingTime: number;
  /**
   * Plain number, not AssistedOverlapBeats: a replicate legitimately makes
   * the shared overlap an off-menu count (128 + an 8-beat paste = 136).
   */
  beats: number;
  replicate: TransitionPreviewReplicate | null;
  /** Right-click selection on a preview wave: the block a REPLICATE would copy. */
  replicateSelection: { role: TransitionPreviewRole; start: number; end: number } | null;
  /** First right-click of the two-click selection, waiting for its partner. */
  replicatePending: { role: TransitionPreviewRole; time: number } | null;
  automation: AssistedOverlapAutomation;
  configurationOpen: boolean;
  selectionRole: TransitionPreviewRole | null;
  cueHistory: TransitionPreviewCueSnapshot[];
  audition: TransitionPreviewRole | "mix" | null;
  saving: boolean;
  status: string;
};
type CrowdReaction = { id: string; emoji: string; left: number; drift: number; receivedAt: number };
type LibraryIntelligenceStats = { totalRecords: number; bpmKnown: number; fullScanned: number; selections: number; plays: number; incompatiblePairs: number };
type CueUndoSnapshot = {
  trackId: string;
  deck: Pick<DeckState, "analysis" | "tempoRate" | "cuePoint" | "loopSize" | "loopStart" | "loopEnd" | "loopActive">;
  customLoopStart: number | null;
  customLoopPurpose: ManualWindowPurpose | null;
  serverUndoToken?: string;
};
type AudioGraph = { mainInput: GainNode; shadowInput: GainNode; meter: AnalyserNode; spectrum: AnalyserNode; meterTime: Float32Array<ArrayBuffer>; meterFrequency: Float32Array<ArrayBuffer>; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; dry: GainNode; channel: GainNode; cueChannel: GainNode; loopGate: GainNode; cueLoopGate: GainNode; monitorGate: GainNode; echo: DelayNode; reverb: ConvolverNode; phaser: BiquadFilterNode; drive: WaveShaperNode; echoWet: GainNode; reverbWet: GainNode; phaserWet: GainNode; driveWet: GainNode; activeFx: FxType };
type TransitionPreviewGraph = { source: MediaElementAudioSourceNode; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; output: GainNode };
type PitchHoldSession = {
  trackId: string;
  audio: HTMLAudioElement;
  direction: -1 | 1;
  mode: "playing" | "paused";
  startedAt: number;
  startTime: number;
  durationMs: number;
  baseRate: number;
  latestUnderlyingRate: number;
  frame: number;
  lastAppliedAt: number;
  stoppedByHold: boolean;
};

function savedManualWindow(analysis: Analysis | null, purpose: ManualWindowPurpose) {
  const teaching = analysis?.teaching;
  const legacy = teaching?.manualCycle;
  return purpose === "intro-loop"
    ? teaching?.manualIntroCycle ?? (legacy?.purpose === "intro-loop" ? legacy : undefined)
    : teaching?.manualOutroCycle ?? (legacy?.purpose === "outro-transition" ? legacy : undefined);
}

function loadedPairOrderForIncoming(deck: DeckId) {
  return deck === "B" ? 1 : deck === "C" ? 2 : 3;
}

// v2: the X/Y/Z defaults moved to 100 / 72.5 / 25. Bumping both keys retires
// every curve stored against the old defaults — including its per-track bass
// cue — so each track picks the new curve up. The v1 blobs are left in place,
// unread, rather than deleted.
const ASSISTED_OVERLAP_STORAGE_KEY = "crowd2-assisted-overlap-automation-v2";
const ASSISTED_TRACK_OVERLAPS_STORAGE_KEY = "crowd2-assisted-track-overlap-automations-v2";
const BOOTH_VISUAL_DIRECTION_STORAGE_KEY = "crowd2-visual-direction-v1";
// v2: both defaults flipped from off to on when gridding-and-cueing on load
// became the point rather than an extra. The v1 builds wrote "off" into storage
// on mount — that was the default they were saving — so reading v1 would keep
// every existing booth switched off forever and the chain would never run.
// Bumping the key retires those values; the v1 blobs are left in place, unread.
const SECTION_AUTO_ANALYSE_STORAGE_KEY = "crowd2-section-auto-analyse-v2";
const DRUM_AUTO_ANALYSE_STORAGE_KEY = "crowd2-drum-auto-analyse-v2";
const GRID_SNAP_STORAGE_KEY = "crowd2-grid-snap-v1";
/**
 * How far the music ducks under each grid-check tick.
 *
 * Not silence: the kick has to stay audible or there is nothing to judge the tick
 * against. Enough headroom that the tick stops competing with the kick's own
 * transient, which is exactly where the two collide.
 */
const GRID_CHECK_DUCK_DEPTH = .45;
const WORKFLOW_STAGE_COLOURS = {
  load: "#ffc857",
  "mix-in": "#ff4f98",
  "mix-out": "#ff784f",
  launch: "#4cf2b4",
} as const;
const emptyDeck = (): DeckState => ({ track: null, analysis: null, currentTime: 0, playing: false, cuePreviewing: false, tempoRate: 1, cuePoint: null, loopSize: 16, loopStart: null, loopEnd: null, loopActive: false, cue: DEFAULT_DECK_CUE, volume: SAFE_LOADED_DECK_VOLUME, low: 0, mid: 0, high: 0, fx: "none", wet: 0.25 });
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const mediaReadyForTrack = (media: HTMLMediaElement | null | undefined, track: Track | null | undefined) => {
  if (!media || !track || media.error || media.readyState < 1 || media.networkState === 3) return false;
  const source = media.currentSrc || media.getAttribute("src") || "";
  return Boolean(source && (source === track.audio || source.endsWith(track.audio)));
};
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function postDjCrowdEvent(event: CrowdLinkPost) {
  await fetch("/api/crowd-edge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  });
}
const albumArtist = (album: string) => album.split(/\s+-\s+/)[0].trim().toLowerCase();
function bassSwapCueKind(cue: Cue): BassSwapCueKind | null {
  if (cue.id === "entry-drop") return "in";
  if (cue.id === "exit-handoff" || cue.id === "exit-handoff-review") return "out";
  return null;
}
function deckPlayShortcut(id: DeckId) {
  return id === "A" ? "Q" : id === "B" ? "#" : "C";
}
function deckCueShortcut(id: DeckId) {
  return id === "A" ? "`" : id === "B" ? "Backspace" : "V";
}
function withLockedOutgoingCue(track: DemoTrackPlan, cue: LockedOutgoingCue): DemoTrackPlan {
  return {
    ...track,
    exitRunway: cue.exitRunway,
    exitHandoff: cue.exitHandoff,
    mixOut: cue.mixOut,
    rundownLoop: undefined,
    cuePoints: [
      { id: "exit-runway", time: cue.exitRunway, label: "RUNWAY OUT", description: "Start the selected incoming deck here, 32 beats before the locked bass switch.", colour: "#ffc857" },
      { id: "exit-handoff", time: cue.exitHandoff, label: "MIX OUT · BASS OFF", description: "Locked bass-swap cue. Incoming tunes are selected to fit this point; it will not move before it plays.", colour: "#ff6a4a" },
      { id: "mix-out", time: cue.mixOut, label: "MIX CLEAR", description: "End of the 64-beat outgoing hold after the locked bass switch.", colour: "#ab7dff" },
    ],
  };
}
function shuffled<T>(items: T[]) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

/** A request the booth server has not answered within this long counts as no answer. */
const MAPPING_REQUEST_TIMEOUT_MS = 10_000;
async function fetchWithin(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * DJ, 26 Sep 2026 ("it has to show the real steps of progress - not fake"):
 * the 29 Aug version crept a 0-50 bar on elapsed time between server steps
 * and printed "about Ns left" from a guess — it showed step 15 while the
 * job was at 7. Now every update is the server's own structured progress
 * (lib/load-progress.ts) plus the connection's real state
 * (lib/mapping-follow.ts); nothing on the way to the deck is estimated.
 */
async function ensureMapped(track: Track, onProgress: (update: MappingUpdate) => void, cancelled: () => boolean, protectPlayback = false) {
  if (track.mapped) return track;
  return followMapping<Track>({
    trackName: track.name,
    start: async (recovery) => {
      const response = await fetchWithin("/api/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: track.id, protectPlayback }) }, MAPPING_REQUEST_TIMEOUT_MS);
      if (!response.ok && response.status !== 409) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new MappingRequestError(failure.error ?? `${track.name} could not ${recovery ? "restart" : "start"} mapping`);
      }
    },
    poll: async () => {
      const response = await fetchWithin(`/api/map?id=${encodeURIComponent(track.id)}&v=${Date.now()}`, { cache: "no-store" }, MAPPING_REQUEST_TIMEOUT_MS);
      if (response.status === 404) throw new MappingRequestError(`${track.name} is no longer in the booth library`);
      if (!response.ok) throw new Error(`the booth server answered ${response.status}`);
      return await response.json() as Track;
    },
    onUpdate: onProgress,
    cancelled,
    wait: (milliseconds) => wait(milliseconds).then(() => undefined),
    now: () => Date.now(),
  });
}

function tempoColour(analysis: Analysis, sectionIndex: number) {
  const bpm = analysis.tempoSections[sectionIndex]?.bpm ?? 0;
  const distinct = [...new Set(analysis.tempoSections.map((section) => section.bpm.toFixed(2)))];
  return TEMPO_COLOURS[Math.max(0, distinct.indexOf(bpm.toFixed(2))) % TEMPO_COLOURS.length];
}

function bpmAt(deck: DeckState) {
  return loopTempoBpm(deck) ?? (deck.analysis ? resolvedBpmAt(deck.analysis, deck.currentTime) : 0);
}

function trackSelectionBpm(analysis: Analysis) {
  const manualBpm = authoritativeManualTempoBpm(analysis.teaching);
  if (manualBpm !== null) return manualBpm;
  const longestSection = analysis.tempoSections.reduce((longest, section) => {
    if (!longest) return section;
    return section.end - section.start > longest.end - longest.start ? section : longest;
  }, null as Analysis["tempoSections"][number] | null);
  return longestSection?.bpm ?? 0;
}

function beatPhase(deck: DeckState) {
  const beats = deck.analysis?.beats;
  if (!beats || beats.length < 2) return null;
  let nextIndex = beats.findIndex((beat) => beat.time > deck.currentTime);
  if (nextIndex < 1) nextIndex = nextIndex === -1 ? beats.length - 1 : 1;
  const previous = beats[nextIndex - 1];
  const next = beats[nextIndex];
  const period = Math.max(.001, next.time - previous.time);
  return { fraction: clamp((deck.currentTime - previous.time) / period, 0, 1), period };
}

function comparePhase(target: DeckState, reference: DeckState): PhaseStatus {
  if (!target.playing || !reference.playing) return "uncompared";
  const targetPhase = beatPhase(target);
  const referencePhase = beatPhase(reference);
  if (!targetPhase || !referencePhase) return "uncompared";
  let difference = targetPhase.fraction - referencePhase.fraction;
  if (difference > .5) difference -= 1;
  if (difference < -.5) difference += 1;
  if (Math.abs(difference) <= .035) return "synced";
  return difference > 0 ? "ahead" : "behind";
}

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function preciseTimeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

function TransitionPreviewTimeReadout({ audioRef, fallback, active }: { audioRef: RefObject<HTMLAudioElement | null>; fallback: number; active: boolean }) {
  const [time, setTime] = useState(fallback);
  useEffect(() => {
    const update = () => {
      const media = audioRef.current;
      const hasPrivateSource = Boolean(media?.currentSrc || media?.getAttribute("src"));
      const current = active && hasPrivateSource ? media?.currentTime : undefined;
      setTime(current !== undefined && Number.isFinite(current) ? current : fallback);
    };
    update();
    if (!active) return;
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [active, audioRef, fallback]);
  return preciseTimeLabel(time);
}

function remainingLabel(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "CALCULATING";
  if (seconds <= 0) return "DONE";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.max(1, Math.round(seconds % 3600 / 60));
  return days ? `${days}D ${hours}H` : hours ? `${hours}H ${minutes}M` : `${minutes} MIN`;
}

// `xDecimals` exists because callers do not all draw in pixels. The moving
// wave builds each chunk in SECONDS and scales it by pixels-per-second at
// paint time, so rounding x to one decimal there quantises the audio onto a
// 100 ms lattice while the beat grid and cues stay exact — the wave then
// shears against its own grid, differently in every chunk and at every zoom.
function areaPath(values: number[], width: number, height: number, xDecimals = 1) {
  if (!values.length) return "";
  const middle = height / 2;
  const point = (x: number, y: number) => `${x.toFixed(xDecimals)},${y.toFixed(1)}`;
  const upper = values.map((value, index) => point(index / Math.max(1, values.length - 1) * width, middle - value * middle * 0.86));
  const lower = [...values].reverse().map((value, reverseIndex) => point((values.length - 1 - reverseIndex) / Math.max(1, values.length - 1) * width, middle + value * middle * 0.86));
  return `M${upper.join(" L")} L${lower.join(" L")} Z`;
}

function rampAudioParam(parameter: AudioParam, target: number, now: number, duration = .03) {
  try { parameter.cancelAndHoldAtTime(now); }
  catch { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
  parameter.linearRampToValueAtTime(target, now + duration);
}

function applyBoothPitchMode(audio: HTMLMediaElement | null | undefined) {
  if (audio) audio.preservesPitch = BOOTH_PRESERVE_PITCH;
}

function scheduleAudioParamRamp(parameter: AudioParam, target: number, now: number, endAt: number, duration = .02) {
  const startAt = Math.max(now, endAt - duration);
  try { parameter.cancelAndHoldAtTime(now); }
  catch { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
  parameter.setValueAtTime(parameter.value, startAt);
  parameter.linearRampToValueAtTime(target, Math.max(startAt + .001, endAt));
}

function assistedIncomingPrerollTime(planned: DemoTrackPlan) {
  return assistedCuePrerollStart(planned.analysis, planned.entryRunway, planned.bpm);
}

function withLearnedCuePredictions(analysis: Analysis, profile: TeachingProfile | null) {
  const fresh = withoutStoredCuePlacements(analysis);
  const predictedEntryCue = learnedCueCandidates(fresh, profile, "mix-in", 1)[0];
  const predictedCue = learnedCueCandidates(fresh, profile, "mix-out", 1)[0];
  return {
    ...fresh,
    teaching: {
      ...fresh.teaching,
      ...(predictedEntryCue ? { predictedEntryCue } : {}),
      ...(predictedCue ? { predictedCue } : {}),
    },
  } as Analysis;
}

export const buildCues = buildIntroOutroCues;

function qualityInput(analysis: Analysis) {
  return {
    beats: analysis.beats,
    duration: analysis.duration,
    verification: {
      verifiedBeatCoverage: analysis.verification?.verifiedBeatCoverage ?? 0,
      verifiedBlocks: analysis.verification?.verifiedBlocks ?? 0,
      reviewBlocks: analysis.verification?.reviewBlocks ?? 0,
      noEvidenceBlocks: analysis.verification?.noEvidenceBlocks ?? 0,
      blocks: analysis.verification?.blocks ?? [],
    },
  };
}

function taughtDeckCue(analysis: Analysis) {
  return analysis.teaching?.preferredEntryCue?.time
    ?? analysis.teaching?.preferredCue?.time
    ?? analysis.teaching?.predictedEntryCue?.time
    ?? analysis.teaching?.predictedCue?.time
    ?? null;
}

/**
 * The entry a deck may PARK on: a cue somebody placed — DJ's taught entry or
 * label-cue's — never the learned layer's guess. Measured 16 Aug 2026: the
 * learned predictor (trained on the circular teaching store) guessed 260 s
 * into Gaijinrocker before sections even existed, and the deck parked
 * mid-chorus on it. Markers may show guesses; the playhead only moves for a
 * cue that was actually placed.
 */
function placedEntryCue(analysis: Analysis) {
  return analysis.teaching?.preferredEntryCue?.time ?? null;
}

function OverviewPlayhead({ audioRef, time, start, end, width, height, phaseColourRef }: { audioRef?: RefObject<HTMLAudioElement | null>; phaseColourRef?: RefObject<string | null>; time: number; start: number; end: number; width: number; height: number }) {
  const line = useRef<SVGLineElement | null>(null);
  const moveLine = useCallback((trackTime: number) => {
    const element = line.current;
    if (!element) return;
    const visible = Number.isFinite(trackTime) && trackTime >= start && trackTime <= end;
    element.setAttribute("visibility", visible ? "visible" : "hidden");
    if (!visible) return;
    const position = (trackTime - start) / Math.max(.001, end - start) * width;
    element.setAttribute("x1", position.toFixed(3));
    element.setAttribute("x2", position.toFixed(3));
  }, [end, start, width]);
  useLayoutEffect(() => moveLine(time), [moveLine, time]);
  useEffect(() => {
    if (!audioRef) return;
    let frame = 0;
    let lastUpdate = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastUpdate >= BOOTH_VISUAL_FRAME_MS) {
        lastUpdate = timestamp;
        const media = audioRef.current;
        const hasPrivateSource = Boolean(media?.currentSrc || media?.getAttribute("src"));
        if (media && hasPrivateSource && Number.isFinite(media.currentTime)) moveLine(media.currentTime);
        const phase = phaseColourRef?.current ?? null;
        if (line.current && line.current.getAttribute("stroke") !== (phase ?? "#fff")) {
          line.current.setAttribute("stroke", phase ?? "#fff");
          line.current.setAttribute("stroke-width", phase ? "4" : "3");
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioRef, moveLine, phaseColourRef]);
  const initialVisible = time >= start && time <= end;
  const initialX = (time - start) / Math.max(.001, end - start) * width;
  // DJ, 30 Aug 2026: the deck-shelf controls float over the overview wave
  // with translucent chrome, and a plain 3px white line vanished behind them.
  // Wider stroke + a glow (CSS drop-shadows on .overview-focus-line) keep the
  // playhead readable through every overlay without touching the overlays.
  return <line ref={line} className={audioRef ? "overview-focus-line preview-overview-playhead" : "overview-focus-line"} x1={initialX} x2={initialX} y1="0" y2={height} stroke="#fff" strokeWidth="4" visibility={initialVisible ? "visible" : "hidden"} pointerEvents="none" />;
}

/**
 * Section texture, shared by both wave surfaces.
 *
 * The label is carried by the pattern rather than by a colour, because the wave
 * colour already means the deck, tempo tints already mean a tempo section, and
 * the verification wash already means a suspect grid. A fourth colour scale on
 * the same pixels would be unreadable.
 *
 * The overview and the focus wave deliberately draw the same label differently —
 * coarse marks survive a 60-pixel-high overview, fine ones only work zoomed in —
 * so the two surfaces can never be mistaken for each other.
 */
function useSectionLabels(trackId: string | null | undefined) {
  // A counter rather than the spans themselves: the store is a module cache, so
  // this only needs to say "look again".
  const [revision, setRevision] = useState(0);
  useEffect(() => onSectionLabelsChanged(() => setRevision((value) => value + 1)), []);
  useEffect(() => {
    // Never throws: a missing label feed leaves the waves plain.
    loadSectionLabels();
  }, []);

  const spans = useMemo(() => sectionSpansFor(trackId), [revision, trackId]);

  // A track with no labels gets analysed, once, on demand. The poll below is not
  // just impatience: each request carries whether the booth is quiet, and the
  // server will not start a 90-second GPU job on a stale report of that.
  useEffect(() => {
    // Off unless the booth's ANALYSE SECTIONS switch is on: a GPU separation is
    // not something to start because a tune was loaded.
    if (!sectionAutoAnalyseEnabled()) return;
    // A track that has already used up its attempts is never asked for again;
    // otherwise every load would re-queue the same unreadable file. Nor is a
    // browser-local file, which the server has no copy of to analyse.
    if (!trackId || spans.length || !sectionLabelsReady()) return;
    if (trackId.startsWith("local-") || sectionAnalysisGaveUp(trackId)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (first: boolean) => {
      if (!live) return;
      const status = await requestSectionAnalysis(first ? trackId : null, boothIsIdle());
      if (!live) return;
      const busy = !!status && (status.running !== null || status.queued.length > 0);
      // Keep waiting while there is work; a rejected or finished job stops it.
      if (busy) timer = setTimeout(() => void tick(false), 4000);
    };
    void tick(true);
    return () => { live = false; if (timer) clearTimeout(timer); };
    // `revision` is in here so flipping the switch on acts immediately on the
    // wave already loaded, rather than waiting for the next track.
  }, [trackId, spans.length, revision]);

  return spans;
}

/**
 * The kick map: where the drums actually hit, as detected in the separated stem.
 *
 * Not the grid, and deliberately drawn as a different thing. The grid is a
 * metronome — regular by construction, because its job is tempo and two tunes
 * have to stay locked across a long overlap. This is the record of what was
 * played. On anything with feel the two disagree by a few milliseconds and
 * disagree differently every bar, which is the tune rather than a fault, and the
 * only honest way to answer "is the kick on the grid" is to draw both and let
 * the eye judge.
 */
/**
 * Whether to draw this track's grid lines at all.
 *
 * DJ's instruction, verbatim: "skip step 1." A fresh tune used to load with the
 * library analyser's grid, then grow a kick map, then have the grid snap onto the
 * kicks — and that first grid is an unvouched guess that is sometimes plainly
 * wrong (Red Tide: 169 claimed, 146 measured). So an unvouched analyser grid is
 * not drawn. The wave loads bare, the kick map appears, and the first lines you
 * see are the pink ones fitted to the kicks.
 *
 * A grid that is someone's actual work still draws immediately: a manual window,
 * a drum-applied declaration, or — once the server answers — a stored grid that
 * was held for a reason (judged by ear, or a fit too poor to trust), because a
 * held tune with no lines at all would be unusable.
 */
function useShowGridLines(trackId: string | null | undefined, authoritative: boolean) {
  const [revision, setRevision] = useState(0);
  useEffect(() => onDrumGridChanged(() => setRevision((value) => value + 1)), []);
  return useMemo(() => {
    // A grid that is real work: a manual window, or a drum-applied declaration.
    if (authoritative) return true;
    // 26 Aug 2026 rollout: the grid is the stem-derived product DJ approved,
    // not the old unvouched analyser guess — it draws always. Skip-step-1
    // (kick-map-first) belongs to the pre-stem era; restore from git if the
    // kick chain ever returns.
    return true;
  }, [revision, trackId, authoritative]);
}

function useDrumKicks(trackId: string | null | undefined) {
  const [revision, setRevision] = useState(0);
  useEffect(() => onDrumGridChanged(() => setRevision((value) => value + 1)), []);
  return useMemo(() => {
    const result = drumGridFor(trackId);
    const times = result?.kicks ?? [];
    const strengths = result?.strengths ?? [];
    // Confidence is relative to the tune, not absolute: a quiet mix and a loud
    // one both have kicks that are obviously kicks, and a fixed scale would fade
    // one of them out entirely. The tune's own 90th percentile is full strength.
    const sorted = [...strengths].sort((left, right) => left - right);
    const loud = sorted.length ? Math.max(1, sorted[Math.floor(sorted.length * .9)]) : 1;
    return times.map((time, index) => ({
      time,
      confidence: strengths.length ? Math.min(1, (strengths[index] ?? 0) / loud) : 1,
    }));
  }, [revision, trackId]);
}

/**
 * What to say when a wave has no texture yet. Each state is named, because an
 * untextured wave with no explanation is indistinguishable from a broken one.
 */
function sectionNoticeFor(trackId: string | null | undefined, spanCount: number) {
  if (!trackId || spanCount > 0) return null;
  // A file opened straight from disk never reaches the server, so there is
  // nothing to analyse. Say that, rather than leaving a bare wave.
  if (trackId.startsWith("local-")) return "SECTIONS · NOT AVAILABLE FOR A LOCAL FILE";
  if (sectionAnalysisGaveUp(trackId)) return "SECTIONS · UNAVAILABLE";
  const status = sectionAnalysisStatus();
  // Nothing queued and the switch is off: say why the wave is bare rather than
  // leaving it to be read as a missing feature.
  if (!sectionAutoAnalyseEnabled() && !status?.running && !status?.queued.length) return "SECTIONS · ANALYSE OFF";
  if (!status) return null;
  if (status.running === trackId) return "SECTIONS · ANALYSING";
  if (status.queued.includes(trackId)) return status.waitingForIdle ? "SECTIONS · WAITING FOR SILENCE" : "SECTIONS · QUEUED";
  if (status.running) return "SECTIONS · ANOTHER TUNE FIRST";
  return null;
}

function SectionPatternDefs({ scope, surface, colour }: { scope: string; surface: SectionSurface; colour: string }) {
  return <>{sectionPatterns(surface).map((pattern) => <pattern
    key={pattern.key}
    id={sectionPatternId(scope, surface, pattern.label)}
    width={pattern.tile}
    height={pattern.tile}
    patternUnits="userSpaceOnUse"
  >
    {pattern.shapes.map((shape, index) => shape.shape === "line"
      ? <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={colour} strokeWidth={shape.width} opacity={pattern.opacity} />
      : shape.shape === "circle"
        ? <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={colour} opacity={pattern.opacity} />
        : <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={colour} opacity={pattern.opacity} />)}
  </pattern>)}</>;
}

function OverviewWave({ id, deck, cues, zoom, onSeek, inline = false, scope = "live", audioRef, highlight }: { id: DeckId; deck: DeckState; cues: Cue[]; zoom: number; onSeek: (time: number) => void; inline?: boolean; scope?: string; audioRef?: RefObject<HTMLAudioElement | null>; highlight?: { start: number; end: number; colour: string } | null }) {
  const analysis = deck.analysis;
  const drag = useRef<{ button: number; x: number; centre: number; windowStart: number; span: number; moved: boolean } | null>(null);
  const [viewCentre, setViewCentre] = useState<number | null>(null);
  useEffect(() => setViewCentre(null), [deck.track?.id]);
  // Before the early return: hooks cannot sit behind a condition.
  const sectionSpans = useSectionLabels(deck.track?.id);
  const showGridLines = useShowGridLines(deck.track?.id, authoritativeManualTempoBpm(deck.analysis?.teaching) !== null);
  if (!analysis) return <div className={inline ? "deck-empty-wave inline-overview-empty" : "deck-empty-wave"}>{inline ? null : "LOAD A MAPPED TRACK"}</div>;
  const width = 1000;
  const height = 118;
  const visibleDuration = Math.min(analysis.duration, analysis.duration / Math.max(1, zoom));
  // Keep the visible window inside the real track. The overview has no synthetic
  // silence before 0:00 or after the track end, even when the focus is near an edge.
  const requestedCentre = viewCentre ?? deck.currentTime;
  const start = clamp(requestedCentre - visibleDuration / 2, 0, Math.max(0, analysis.duration - visibleDuration));
  const end = Math.min(analysis.duration, start + visibleDuration);
  const x = (time: number) => (time - start) / Math.max(.001, end - start) * width;
  // Full-mix display wave when the analyser painted one; stem overview otherwise.
  const overviewWaveform = analysis.displayLowWaveform?.length ? analysis.displayLowWaveform : analysis.lowWaveform;
  const sampleCount = Math.min(BOOTH_WAVEFORM_SAMPLE_LIMIT, Math.max(320, Math.ceil((end - start) / Math.max(.001, analysis.duration) * overviewWaveform.length)));
  const values = Array.from({ length: sampleCount }, (_, index) => {
    const time = start + index / Math.max(1, sampleCount - 1) * (end - start);
    const sampleIndex = Math.round(time / Math.max(.001, analysis.duration) * Math.max(0, overviewWaveform.length - 1));
    return overviewWaveform[sampleIndex] ?? 0;
  });
  const path = areaPath(values, width, height);
  const visibleTempoSections = analysis.tempoSections.map((section, index) => ({ section, index })).filter(({ section }) => section.end >= start && section.start <= end);
  const visibleSections = visibleSectionSpans(sectionSpans, start, end);
  const sectionNotice = sectionNoticeFor(deck.track?.id, sectionSpans.length);
  const gridStride = Math.max(1, Math.round(16 / Math.max(1, zoom)));
  const visibleGridBeats = analysis.beats.map((beat, index) => ({ beat, index })).filter(({ beat, index }) => beat.time >= start && beat.time <= end && index % gridStride === 0);
  const authoritativeManualGrid = authoritativeManualTempoBpm(analysis.teaching) !== null;
  const visibleCues = cues.filter((cue) => cue.time >= start && cue.time <= end);
  const pointerDown = (event: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { button: event.button, x: event.clientX, centre: start + visibleDuration / 2, windowStart: start, span: end - start, moved: false };
  };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
    if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (Math.abs(event.clientX - drag.current.x) >= 3) drag.current.moved = true;
    if (drag.current.button === 2 && drag.current.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      const centre = drag.current.centre - (event.clientX - drag.current.x) / rect.width * drag.current.span;
      const half = drag.current.span / 2;
      setViewCentre(clamp(centre, half, Math.max(half, analysis.duration - half)));
    }
  };
  const pointerUp = (event: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickedTime = clamp(gesture.windowStart + (event.clientX - rect.left) / rect.width * gesture.span, 0, analysis.duration);
    if (gesture.button === 0) onSeek(clickedTime);
    else if (!gesture.moved) {
      const half = gesture.span / 2;
      setViewCentre(clamp(clickedTime, half, Math.max(half, analysis.duration - half)));
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerCancel = (event: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={inline ? "wave-shell inline-overview-wave" : "wave-shell"}><svg className="deck-overview" aria-label={inline ? undefined : `Deck ${id} overview waveform. Left click to seek. Right-click drag to pan the viewed portion.`} aria-hidden={inline || undefined} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onPointerDown={inline ? undefined : pointerDown} onPointerMove={inline ? undefined : pointerMove} onPointerUp={inline ? undefined : pointerUp} onPointerCancel={inline ? undefined : pointerCancel} onContextMenu={inline ? undefined : (event) => event.preventDefault()}>
    <defs>
      {visibleTempoSections.map(({ section, index }) => <clipPath id={`deck-${scope}-${id}-tempo-${index}`} key={`deck-${scope}-${id}-clip-${index}`}><rect x={x(Math.max(start, section.start))} y="0" width={Math.max(1, x(Math.min(end, section.end)) - x(Math.max(start, section.start)))} height={height} /></clipPath>)}
      <SectionPatternDefs scope={`${scope}-${id}`} surface="overview" colour={SECTION_PATTERN_INK} />
      {visibleSections.map((span, index) => <clipPath id={`deck-${scope}-${id}-section-${index}`} key={`deck-${scope}-${id}-section-clip-${index}`}><rect x={x(span.start)} y="0" width={Math.max(1, x(span.end) - x(span.start))} height={height} /></clipPath>)}
    </defs>
    <rect width={width} height={height} fill="#080b0a" />
    {deck.loopStart !== null && deck.loopEnd !== null && deck.loopEnd >= start && deck.loopStart <= end && <rect x={x(Math.max(start, deck.loopStart))} width={Math.max(1, x(Math.min(end, deck.loopEnd)) - x(Math.max(start, deck.loopStart)))} height={height} fill={deck.loopActive ? "#ab7dff" : "transparent"} fillOpacity=".28" stroke="#ab7dff" strokeWidth={deck.loopActive ? 4 : 2} strokeDasharray={deck.loopActive ? undefined : "10 7"} />}
    {/* DJ, 29 Aug 2026: the transition span, painted on the whole-tune wave so
        clicking different overlap lengths visibly grows and shrinks the mix. */}
    {highlight && highlight.end >= start && highlight.start <= end && <rect className="overview-transition-span" x={x(Math.max(start, highlight.start))} width={Math.max(2, x(Math.min(end, highlight.end)) - x(Math.max(start, highlight.start)))} height={height} fill={highlight.colour} fillOpacity=".24" stroke={highlight.colour} strokeWidth="2" />}
    <path className="overview-wave-base" d={path} fill={FOCUS_WAVE_COLOURS[id].wave} opacity={visibleTempoSections.length ? ".22" : ".72"} />
    {visibleTempoSections.map(({ index }) => <path key={`deck-${scope}-${id}-tempo-wave-${index}`} d={path} fill={tempoColour(analysis, index)} opacity=".7" clipPath={`url(#deck-${scope}-${id}-tempo-${index})`} />)}
    {/* Section texture last, so it reads over the tempo tint rather than under it. */}
    {visibleSections.map((span, index) => <path key={`deck-${scope}-${id}-section-wave-${index}`} d={path} fill={`url(#${sectionPatternId(`${scope}-${id}`, "overview", span.label)})`} clipPath={`url(#deck-${scope}-${id}-section-${index})`} />)}
    {/* Say so while the labels are being worked out. An untextured wave with no
        explanation reads as a bug; naming the state reads as a decision. */}
    {sectionNotice && <text className="overview-section-notice" x="8" y="13" fill={SECTION_PATTERN_INK} opacity=".66" fontSize="10" letterSpacing="1.4">{sectionNotice}</text>}
    {showGridLines && visibleGridBeats.map(({ beat, index }) => <line className="overview-beat-grid" data-beat-index={index} data-grid-stride={gridStride} key={`overview-grid-${index}`} x1={x(beat.time)} x2={x(beat.time)} y1="0" y2={height} stroke={authoritativeManualGrid ? beat.isDownbeat ? "#ff4f98" : "#55a7ff" : beat.isDownbeat ? "#9eb0a8" : "#6d7b75"} strokeWidth={beat.isDownbeat ? 1.5 : 1} opacity={authoritativeManualGrid ? beat.isDownbeat ? .92 : .68 : beat.isDownbeat ? .62 : .42} />)}
    {visibleCues.map((cue) => {
      const swapKind = bassSwapCueKind(cue);
      const cueX = x(cue.time);
      return <g key={cue.id} className={swapKind ? `bass-swap-cue bass-swap-${swapKind}` : undefined}><line className="cue-marker-line" x1={cueX} x2={cueX} y1="0" y2={height} stroke={cue.colour} strokeWidth="4" />{swapKind && <><circle className="bass-cue-ring" cx={cueX} cy="15" r="15" fill="none" stroke={cue.colour} /><circle className="bass-cue-beacon" cx={cueX} cy="15" r="9" fill={cue.colour} /></>}<text x={cueX + 5} y="108" fill={cue.colour} fontSize="13">{cue.label}</text></g>;
    })}
    <OverviewPlayhead audioRef={audioRef} time={deck.currentTime} start={start} end={end} width={width} height={height} />
  </svg>{inline && <div className="inline-overview-seek" role="button" tabIndex={0} aria-label={`Deck ${id} overall waveform. Click a point to seek there.`} title="CLICK TO SEEK · RIGHT-DRAG TO PAN" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onContextMenu={(event) => event.preventDefault()} />}</div>;
}

const LOAD_STAGE_SHORT: Record<LoadStageId, string> = { queue: "LANE", stem: "DRUM STEM", beats: "BEATS", grid: "GRID", save: "SAVE" };
const LOAD_STATE_MARK = { done: "✓", skipped: "–", failed: "✖", active: "●", pending: "○" } as const;
type LoadMarkState = keyof typeof LOAD_STATE_MARK;
/** Only while the server answered this recently does a step without a fraction show the moving activity marker. */
const LOAD_LIVE_ANSWER_MS = 5000;

/** Re-renders once a second while something is running: elapsed and ages only, never progress. */
function useSecondClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const ageLabel = (milliseconds: number | null) => (milliseconds === null ? "—" : milliseconds < 60_000 ? `${Math.max(0, Math.round(milliseconds / 1000))} s` : formatClock(milliseconds / 1000));

/** What a finished or skipped step can say in a few characters, from its own record only. */
function stepAnnotation(stage: LoadStage, step: LoadStep) {
  if (step.id === "decode" && step.state === "done" && stage.audioSeconds) return formatClock(stage.audioSeconds);
  if (step.id === "blocks" && step.measure?.passBlocks) return `${step.measure.doneInPass}/${step.measure.passBlocks}`;
  if (step.id === "blocks" && step.measure) return `${step.measure.done}`;
  return "";
}

/**
 * One Demucs block per cell: filled when its "end" callback has fired, lit
 * while it is running. Never extrapolated — cells change only on events.
 * Each cell sits at its own place on the lamp gradient, so the fill order
 * reads at a glance. While the server is live a pulse runs along the lit
 * cells only (finished plus the running one), quickening in tenths of the
 * measured fraction; it is an activity accent and never crosses an unlit cell.
 */
function DemucsBlockMeter({ id, stage, step, live }: { id: DeckId; stage: LoadStage; step: LoadStep; live: boolean }) {
  const measure = step.measure;
  const total = measure?.passBlocks ?? null;
  const fraction = blockFraction(measure);
  const percent = fraction === null ? null : Math.floor(fraction * 100);
  const range = measure?.range ? `${formatClock(measure.range[0])}–${formatClock(measure.range[1])}${stage.audioSeconds ? ` of ${formatClock(stage.audioSeconds)}` : ""}` : null;
  const lit = measure ? measure.doneInPass + (measure.current === measure.doneInPass + 1 ? 1 : 0) : 0;
  const pace = fraction === null ? 0 : Math.floor(fraction * 10) / 10;
  return <div className={`deck-load-meter measured${live ? " live" : ""}`}>
    {total !== null && measure ? <div className="deck-load-blocks" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={measure.doneInPass} aria-label={`Deck ${id} Demucs blocks separated`} style={{ "--load-lit": Math.min(1, lit / total), "--load-pace": pace } as CSSProperties}>
      {Array.from({ length: total }, (_, index) => <i key={index} className={index < measure.doneInPass ? "done" : measure.current === index + 1 ? "running" : ""} style={{ "--block-at": `${total > 1 ? (index / (total - 1)) * 100 : 100}%` } as CSSProperties} />)}
      {/* Keyed on the pace band, so a quicker pulse starts cleanly from the first block. */}
      {live && lit > 0 && <span key={pace} className="deck-load-pulse" aria-hidden="true" />}
    </div> : <div className="deck-load-blocks unknown"><i className="running" /></div>}
    <div className="deck-load-meter-copy">
      <b>{measure ? total !== null ? `${measure.doneInPass} / ${total}` : `${measure.done}` : "0"}</b>
      <span>{total !== null ? `blocks separated${percent !== null && measure && measure.doneInPass < total ? ` · ${percent}%` : ""}` : "blocks separated · total not reported"}{measure && measure.passes > 1 ? ` · pass ${measure.pass} of ${measure.passes}` : ""}</span>
      <em>{measure?.current ? `now separating block ${measure.current}${total !== null ? ` of ${total}` : ""}${range ? ` · audio ${range}` : ""}` : measure ? "block finished · next one starting" : "waiting for the first block"}</em>
    </div>
  </div>;
}

/**
 * The deck's loading strip (DJ, 26 Sep 2026: "it needs a progress indicator
 * that fills up as it loads, I cant tell if its frozen" · "that demucs step
 * is too much of a black box"). Everything drawn is a real event from the
 * server or the deck's own media element: which stages and sub-steps have
 * finished, which one is running, Demucs blocks finished over the block
 * count Demucs is running, and how long ago the server last reported. A step
 * with no measurable fraction says so; its marker moves only while the
 * server keeps answering. Audio readiness is shown apart from the advisory
 * analysis: a tune plays as soon as its audio is ready.
 */
function FocusWaveLoadState({ id, deck, status, load, handoff = false }: { id: DeckId; deck: DeckState; status: string; load?: DeckLoad | null; handoff?: boolean }) {
  const structured = load && (!deck.track || deck.track.id === load.trackId) ? load : null;
  const running = Boolean(structured && (structured.analysis.state === "mapping" || structured.analysis.state === "fetching" || structured.audio.state === "loading"));
  const now = useSecondClock(running && !handoff);
  if (!structured) {
    return <div className={handoff ? "deck-load deck-load-handoff" : "deck-load"} aria-live={handoff ? "off" : "polite"}>
      <div className="deck-load-head"><span className="deck-load-deck">DECK {id}</span><b className="deck-load-title">{deck.track?.name ?? "NO TRACK LOADED"}</b></div>
      <p className="deck-load-note">{status || "Choose a tune to load"}</p>
    </div>;
  }
  const { analysis, audio } = structured;
  const update = analysis.state === "mapping" || analysis.state === "fetching" || analysis.state === "ready" || analysis.state === "failed" ? analysis.update : null;
  const snapshot = update?.snapshot ?? null;
  const connection = update?.connection ?? null;
  const failing = Boolean(connection && connection.failures > 0 && analysis.state === "mapping");
  // While the server is not answering, elapsed figures stop at its last answer: nothing is known after it.
  const viewAt = failing && update?.receivedAt ? update.receivedAt : now;
  const view = snapshot && update?.receivedAt ? viewLoadProgress(snapshot, viewAt, update.receivedAt) : null;
  const savedAnalysis = (analysis.state === "fetching" || analysis.state === "ready") && analysis.saved;
  const deckStage: LoadMarkState = analysis.state === "ready" ? "done" : analysis.state === "fetching" ? "active" : analysis.state === "failed" && (!snapshot || snapshot.state === "complete") ? "failed" : "pending";
  const chips: Array<{ key: string; label: string; state: LoadMarkState; note?: string; title?: string }> = savedAnalysis || (!snapshot && analysis.state !== "mapping")
    ? [
        ...(savedAnalysis ? [{ key: "saved", label: "SAVED ANALYSIS", state: "done" as const, note: "found", title: "Mapped earlier: no separation or grid work needed" }] : []),
        { key: "deck", label: "LOAD INTO DECK", state: deckStage },
      ]
    : [
        ...(snapshot?.stages ?? []).map((stage) => ({
          key: stage.id,
          label: LOAD_STAGE_SHORT[stage.id],
          state: stage.state as LoadMarkState,
          note: stage.cached ? "on disk" : stage.id === "stem" ? stepAnnotation(stage, stage.steps.find((step) => step.id === "blocks")!) : "",
          title: stage.detail ?? undefined,
        })),
        { key: "deck", label: "LOAD INTO DECK", state: deckStage },
      ];
  const chipsDone = chips.filter((chip) => chip.state === "done" || chip.state === "skipped").length;
  const stage = view?.stage ?? null;
  const step = view?.step ?? null;
  const answeredAgo = connection?.lastAnswerAt ? now - connection.lastAnswerAt : null;
  const live = analysis.state === "fetching" || (analysis.state === "mapping" && !failing && answeredAgo !== null && answeredAgo < LOAD_LIVE_ANSWER_MS);
  let heading: string;
  let detail: string;
  if (analysis.state === "ready") { heading = "READY"; detail = "Waveform, BPM, beats and downbeats are on the deck"; }
  else if (analysis.state === "fetching") { heading = "LOAD INTO DECK"; detail = savedAnalysis ? "Saved analysis found · downloading its waveform, beats and grid into the deck" : "Analysis finished · downloading its waveform, beats and grid into the deck"; }
  else if (analysis.state === "failed") { heading = "ANALYSIS STOPPED"; detail = analysis.error; }
  else if (analysis.state === "waiting" || analysis.state === "none") { heading = analysis.state === "waiting" ? "ANALYSIS WAITING" : "NO ANALYSIS FOR THIS LOAD"; detail = analysis.note; }
  else if (stage) { heading = `${stage.label}${step ? ` › ${step.label}` : ""}`.toUpperCase(); detail = step?.detail ?? stage.detail ?? ""; }
  else { heading = "REQUESTING ANALYSIS"; detail = "Asking the booth server to start this tune's analysis"; }
  const measuredStep = analysis.state === "mapping" && stage?.id === "stem" && step?.id === "blocks" && step.state === "active" ? step : null;
  const stoppedAt = analysis.state === "failed" && snapshot ? snapshot.stages.find((item) => item.state === "failed") ?? null : null;
  const stoppedStep = stoppedAt?.steps.find((item) => item.state === "failed") ?? null;
  const audioText = audio.state === "ready"
    ? `AUDIO READY${audio.duration ? ` · ${formatClock(audio.duration)}` : ""} · PLAYABLE NOW`
    : audio.state === "error" ? `AUDIO ERROR${audio.error ? ` · ${audio.error}` : ""}` : "AUDIO LOADING";
  const substepStage = stage ?? stoppedAt;
  return <div className={`deck-load deck-load-${analysis.state}${handoff ? " deck-load-handoff" : ""}`} aria-live={handoff ? "off" : "polite"} data-load-attempt={structured.attempt}>
    <div className="deck-load-head">
      <span className="deck-load-deck">DECK {id}</span>
      <b className="deck-load-title">{structured.trackName}</b>
      <span className={`deck-load-audio deck-load-audio-${audio.state}`} title="The deck's own audio element: playable as soon as this is ready, whatever the advisory analysis is doing">{audioText}</span>
    </div>
    <div className="deck-load-kicker">
      <span>GRID &amp; BEAT ANALYSIS · ADVISORY</span>
      <span>{chipsDone} OF {chips.length} STAGES COMPLETE</span>
      {snapshot && snapshot.attempt > 1 && <span className="deck-load-attempt">MAPPING ATTEMPT {snapshot.attempt}</span>}
      {stage?.id === "stem" && stage.attempt > 1 && <span className="deck-load-attempt" title={stage.restartedBecause ?? undefined}>SEPARATOR ATTEMPT {stage.attempt}</span>}
      {update && update.restarts > 0 && <span className="deck-load-attempt">RE-REQUESTED {update.restarts}×</span>}
    </div>
    <ol className="deck-load-stages" aria-label={`Deck ${id} analysis stages`}>
      {chips.map((chip) => <li key={chip.key} className={chip.state} title={chip.title}><i>{LOAD_STATE_MARK[chip.state]}</i>{chip.label}{chip.note ? <small>{chip.note}</small> : null}</li>)}
    </ol>
    {failing && connection && <p className="deck-load-warning" role="alert">NO ANSWER FROM THE BOOTH SERVER FOR {ageLabel(now - (connection.lastAnswerAt ?? connection.failingSince ?? now))} · {connection.failures} REQUEST{connection.failures === 1 ? "" : "S"} FAILED · SHOWING THE LAST PROGRESS IT REPORTED{connection.lastError ? ` (${connection.lastError})` : ""}</p>}
    <div className="deck-load-current">
      <strong>{heading}</strong>
      {detail && <span>{detail}</span>}
      {analysis.state === "failed" && <span className="deck-load-failed-copy">{stoppedAt ? `Stopped at ${stoppedAt.label}${stoppedStep ? ` › ${stoppedStep.label}` : ""}${stoppedStep?.measure?.passBlocks ? ` (${stoppedStep.measure.doneInPass} of ${stoppedStep.measure.passBlocks} blocks had finished)` : ""}. ` : ""}Analysis is advisory: the tune {audio.state === "ready" ? "is loaded and plays without it" : "can still play once its audio is ready"}. Loading it again starts a new attempt from the beginning.</span>}
    </div>
    {measuredStep && stage && <DemucsBlockMeter id={id} stage={stage} step={measuredStep} live={live} />}
    {!measuredStep && (analysis.state === "mapping" || analysis.state === "fetching") && <div className={`deck-load-meter unmeasured${live ? " live" : ""}`}>
      <div className="deck-load-activity"><i /></div>
      <div className="deck-load-meter-copy"><b>{live ? "RUNNING" : failing ? "NO ANSWER" : "WAITING FOR THE SERVER"}</b><span>{stage?.id === "queue" ? "queued · nothing to measure until the lane is free" : "this step reports start and finish only · no fraction to fill"}</span></div>
    </div>}
    {substepStage && substepStage.steps.length > 0 && <ol className="deck-load-steps" aria-label={`${substepStage.label} steps`}>
      {substepStage.steps.map((item) => <li key={item.id} className={item.state} title={item.detail ?? undefined}><i>{LOAD_STATE_MARK[item.state]}</i>{item.label.toUpperCase()}{stepAnnotation(substepStage, item) ? <small>{stepAnnotation(substepStage, item)}</small> : null}</li>)}
    </ol>}
    {view && analysis.state === "mapping" && <p className="deck-load-facts">
      {step ? `STEP RUNNING ${ageLabel(view.stepElapsedMs)}` : stage ? `STAGE RUNNING ${ageLabel(view.stageElapsedMs)}` : ""}
      {` · LAST PROGRESS EVENT ${ageLabel(view.lastEventAgeMs)} AGO`}
      {` · SERVER ANSWERED ${ageLabel(answeredAgo)} AGO`}
      {` · JOB ${ageLabel(view.totalElapsedMs)}`}
      {failing ? " · FROZEN AT THE LAST ANSWER" : ""}
    </p>}
  </div>;
}

function MovingWave({ id, deck, audio, spectrumSource, cues, phaseStatus, loadStatus, load, windowSeconds, onTime, onWindowChange, onScrubChange, onScrubAudio, scope = "live", visualTimeRef, declaredGrid, rightSelect, replicateView, snapOnCommit }: { id: DeckId; deck: DeckState; audio: HTMLAudioElement | null; spectrumSource?: SpectrumSource; cues: Cue[]; phaseStatus: PhaseStatus; loadStatus: string; load?: DeckLoad | null; windowSeconds: number; onTime: (time: number) => void; onWindowChange: (seconds: number) => void; onScrubChange: (scrubbing: boolean) => void; onScrubAudio?: (command: { pointerTime: number; velocity: number; duration: number } | null) => void; scope?: string; visualTimeRef?: { current: number | null }; declaredGrid?: { start: number; end: number; beats: number };
  /**
   * REPLICATE selection (DJ, 30 Aug 2026): right-click owns block marking
   * on the preview waves. Hold-and-drag sweeps a span; a click starts a
   * selection and a second click finishes it. The booth snaps and stores it.
   */
  rightSelect?: { span: { start: number; end: number } | null; pending: number | null; onSpan: (a: number, b: number) => void; onTap: (time: number) => void };
  /** An applied replicate: the pasted passes are outlined on the wave. */
  replicateView?: { plan: ReplicatePlan };
  /**
   * DJ, 30 Aug 2026 ("snap to grid on in booth generally"): the FINAL
   * commit of a drag, throw or glide lands through this — the drag itself
   * stays free, the landing snaps. Absent (the preview passes its own snap
   * downstream), commits land raw exactly as before.
   */
  snapOnCommit?: (time: number) => number }) {
  const analysis = deck.analysis;
  const width = 1000;
  const height = 176;
  const [renderAnchorTime, setRenderAnchorTime] = useState(deck.currentTime);
  const renderAnchorTimeRef = useRef(deck.currentTime);
  const renderTrackIdRef = useRef(deck.track?.id);
  const pointers = useRef(new Map<number, number>());
  const gesture = useRef<{ x: number; time: number; previewTime: number; wasPlaying: boolean; moved: boolean; pinching: boolean; pinchDistance: number; pinchWindow: number; thresholdPx: number; samples: FocusWaveThrowSample[] } | null>(null);
  // REPLICATE right-click selection. These live up here with the other hooks
  // — before the no-analysis early return — because a hook below a
  // conditional return crashes the whole booth the moment a deck loads.
  const rightGesture = useRef<{ x: number; startTime: number; moved: boolean } | null>(null);
  const [rightDraft, setRightDraft] = useState<{ start: number; end: number } | null>(null);
  /** The coast after the hand lifts. Non-zero while the wave is still moving. */
  const glideFrame = useRef(0);
  // A deck swapped out mid-coast must not leave a frame loop painting a wave
  // that is no longer on screen.
  useEffect(() => () => { if (glideFrame.current) cancelAnimationFrame(glideFrame.current); }, []);
  const movingBackLayer = useRef<SVGGElement | null>(null);
  const movingFrontLayer = useRef<SVGGElement | null>(null);
  const movingClipLayer = useRef<SVGGElement | null>(null);
  const movingSectionLayer = useRef<SVGGElement | null>(null);
  const sectionSpans = useSectionLabels(deck.track?.id);
  const waveformChunkCache = useRef(new Map<number, { index: number; startTime: number; endTime: number; path: string }>());
  const waveformChunkAnalysis = useRef<Analysis | null>(null);
  const waveformChunkStride = useRef(0);
  const visualAnchorTime = useRef(deck.currentTime);
  const scrubPaintTime = useRef<number | null>(null);
  const pendingScrubStateTime = useRef<number | null>(null);
  const scrubStateFrame = useRef<number | null>(null);
  const applyVisualTransform = useCallback((trackTime: number) => {
    const offset = -(trackTime - visualAnchorTime.current) / Math.max(.001, windowSeconds) * width;
    const transform = `translate(${offset.toFixed(3)} 0)`;
    movingBackLayer.current?.setAttribute("transform", transform);
    movingFrontLayer.current?.setAttribute("transform", transform);
    movingClipLayer.current?.setAttribute("transform", transform);
    // The section texture is positioned in the same anchor-based space as every
    // other child, so it takes the same transform. Left out, it would sit still
    // while the wave it describes scrolled underneath it.
    movingSectionLayer.current?.setAttribute("transform", transform);
    if (visualTimeRef) visualTimeRef.current = trackTime;
  }, [visualTimeRef, windowSeconds]);
  // ONE clock for this surface. A paused media element's currentTime is the
  // sample that plays next, which is exactly what the white line means, so it
  // stays authoritative whether or not the deck is rolling. Using the booth's
  // 66 ms state clock while paused re-pinned the whole moving layer 0-83 ms
  // behind the audio — a different amount every time, because it depended on
  // the sub-frame moment the DJ hit pause.
  // The src guard is mandatory: preview elements have no source until their
  // private player loads, and an unguarded currentTime of 0 would pin those
  // waveforms at the head of the track and swallow every seek.
  const mediaClockTime = audio && (audio.currentSrc || audio.getAttribute("src")) && Number.isFinite(audio.currentTime)
    ? audio.currentTime
    : null;
  const resolvedTrackTime = mediaClockTime ?? deck.currentTime;
  const resolvedTrackTimeRef = useRef(resolvedTrackTime);
  resolvedTrackTimeRef.current = resolvedTrackTime;
  // This is not a second running clock: while a pointer is held it is the
  // exact time derived from that pointer. It prevents a buffered-range rebase
  // from briefly repainting the paused pre-drag media time before pointer-up
  // commits the same value to the media clock.
  const visualTrackTime = scrubPaintTime.current ?? resolvedTrackTime;
  const publishScrubState = (time: number, immediate = false) => {
    pendingScrubStateTime.current = time;
    if (immediate) {
      if (scrubStateFrame.current !== null) cancelAnimationFrame(scrubStateFrame.current);
      scrubStateFrame.current = null;
      pendingScrubStateTime.current = null;
      // The immediate publish IS the landing: a drag, throw or glide ends
      // here, so this is where the grid catches it (drag frames stay raw).
      const committed = snapOnCommit ? snapOnCommit(time) : time;
      if (committed !== time && audio && (audio.currentSrc || audio.getAttribute("src"))) audio.currentTime = committed;
      onTime(committed);
      return;
    }
    if (scrubStateFrame.current !== null) return;
    scrubStateFrame.current = requestAnimationFrame(() => {
      scrubStateFrame.current = null;
      const pending = pendingScrubStateTime.current;
      pendingScrubStateTime.current = null;
      if (pending !== null) onTime(pending);
    });
  };
  useEffect(() => () => {
    if (scrubStateFrame.current !== null) cancelAnimationFrame(scrubStateFrame.current);
  }, []);
  useLayoutEffect(() => {
    visualAnchorTime.current = renderAnchorTime;
    // Read the authoritative clock at commit, not the earlier React render time.
    applyVisualTransform(scrubPaintTime.current ?? (audio && !audio.paused ? audio.currentTime : visualTrackTime));
  }, [applyVisualTransform, deck.track?.id, renderAnchorTime, visualTrackTime]);
  useEffect(() => {
    if (renderTrackIdRef.current === deck.track?.id) return;
    renderTrackIdRef.current = deck.track?.id;
    renderAnchorTimeRef.current = resolvedTrackTime;
    setRenderAnchorTime(resolvedTrackTime);
  }, [deck.track?.id, resolvedTrackTime]);
  useEffect(() => {
    if (deck.playing && audio && !audio.paused) return;
    if (scrubPaintTime.current !== null) return;
    if (renderAnchorTimeRef.current === resolvedTrackTime) return;
    renderAnchorTimeRef.current = resolvedTrackTime;
    setRenderAnchorTime(resolvedTrackTime);
  }, [audio, deck.playing, deck.track?.id, resolvedTrackTime]);
  useEffect(() => {
    if (!deck.playing || !audio) return;
    let frame = 0;
    const tick = () => {
      // A pointer drag owns the visual transform until it is committed. The
      // deck's playing flag deliberately remains true while its media element
      // is paused for the gesture, so checking that flag alone made this loop
      // repaint the pre-drag time over every pointer move.
      if (!audio.paused && scrubPaintTime.current === null) {
        const trackTime = audio.currentTime;
        if (focusWaveShouldRebase(renderAnchorTimeRef.current, trackTime, windowSeconds)) {
          renderAnchorTimeRef.current = trackTime;
          setRenderAnchorTime(trackTime);
        }
        applyVisualTransform(trackTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [applyVisualTransform, audio, deck.playing, deck.track?.id]);
  const drumKicks = useDrumKicks(deck.track?.id);
  // The kick map and section labels are fetched by track id, so they speak
  // the ORIGINAL tune's clock. Under a replicate they are folded through the
  // paste: kicks inside the copied block are heard once per pass, so they are
  // drawn once per pass, and section boundaries move with the timeline.
  const drumKicksDisplay = useMemo(() => replicateView
    ? drumKicks.flatMap((kick) => replicateOccurrences(replicateView.plan, kick.time).map((time) => ({ ...kick, time })))
    : drumKicks, [drumKicks, replicateView]);
  const showGridLines = useShowGridLines(deck.track?.id, Boolean(declaredGrid) || authoritativeManualTempoBpm(deck.analysis?.teaching) !== null);
  const hasDetailedWaveform = Boolean(analysis?.kickWaveformDetailed?.length || analysis?.lowWaveformDetailed?.length);
  useEffect(() => {
    if (!analysis || hasDetailedWaveform) return;
    reportClientDiagnostic("focus-wave-overview-fallback", { trackId: deck.track?.id, scope, overviewSamples: analysis.lowWaveform.length });
  }, [analysis, deck.track?.id, hasDetailedWaveform, scope]);
  if (!analysis) {
    if (deck.track || loadStatus || load) return <FocusWaveLoadState id={id} deck={deck} status={loadStatus} load={load} />;
    return <div className="moving-wave empty">DECK {id} READY FOR A TRACK</div>;
  }
  const focusTime = renderAnchorTime;
  const playheadTime = resolvedTrackTime;
  // Keep the live playhead at the centre. Empty space before the track starts or
  // after it ends is intentional, just like the scrolling view on a DJ deck.
  const { viewStart: start, viewEnd: end, renderStart, renderEnd } = focusWaveBufferedRange(focusTime, windowSeconds);
  // DJ, 30 Aug 2026: the FULL TUNE's display wave leads when the analyser
  // has painted one (its last, display-only step); the stem envelope stays
  // the fallback for analyses from before that step existed.
  // 26 Aug 2026: prefer the SMOOTH stem low-band envelope over
  // kickWaveformDetailed — that one is onset evidence, 10 ms spikes with
  // zero between, and drawing it made fresh analyses look like needles.
  const detailedWaveform = analysis.displayLowWaveformDetailed?.length
    ? analysis.displayLowWaveformDetailed
    : analysis.lowWaveformDetailed?.length
      ? analysis.lowWaveformDetailed
      : analysis.kickWaveformDetailed?.length
        ? analysis.kickWaveformDetailed
        : analysis.lowWaveform;
  const waveformHopSeconds = hasDetailedWaveform
    ? Math.max(.001, analysis.hopSeconds)
    : Math.max(.001, analysis.duration / Math.max(1, detailedWaveform.length - 1));
  const x = (time: number) => (time - start) / Math.max(.001, end - start) * width;
  const chunkPlan = focusWaveChunkPlan({
    renderStart,
    renderEnd,
    windowSeconds,
    hopSeconds: waveformHopSeconds,
    sampleLength: detailedWaveform.length,
    sampleLimit: BOOTH_WAVEFORM_SAMPLE_LIMIT,
  });
  // Cache paths by immutable, track-relative source chunks. Rebasing now only
  // moves existing SVG nodes and adds/removes whole chunks; it never resamples
  // peaks that the listener has already seen.
  if (waveformChunkAnalysis.current !== analysis || waveformChunkStride.current !== chunkPlan.sampleStride) {
    waveformChunkCache.current.clear();
    waveformChunkAnalysis.current = analysis;
    waveformChunkStride.current = chunkPlan.sampleStride;
  }
  const waveformChunks = chunkPlan.chunks.map((chunk) => {
    const cached = waveformChunkCache.current.get(chunk.index);
    if (cached) return cached;
    // Peak per column, not every Nth sample: point-sampling a decimated
    // waveform drops most kicks at wide zooms and snaps the survivors onto the
    // stride lattice, so the transient the DJ aims at is not the one drawn.
    const values: number[] = [];
    for (let sampleIndex = chunk.startSample; sampleIndex <= chunk.endSample; sampleIndex += chunkPlan.sampleStride) {
      const lastSample = Math.min(chunk.endSample, sampleIndex + chunkPlan.sampleStride - 1);
      let peak = 0;
      for (let scan = sampleIndex; scan <= lastSample; scan += 1) {
        peak = Math.max(peak, Math.abs(Number(detailedWaveform[scan]) || 0));
      }
      values.push(peak);
    }
    const rendered = {
      index: chunk.index,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      // Seconds domain: keep enough precision that a sample lands within a
      // microsecond, which is far under a pixel at every zoom.
      path: areaPath(values, Math.max(0, chunk.endTime - chunk.startTime), height, 6),
    };
    waveformChunkCache.current.set(chunk.index, rendered);
    return rendered;
  });
  const pixelsPerSecond = width / Math.max(.001, end - start);
  const waveformChunkTransform = (chunk: { startTime: number }) => `translate(${x(chunk.startTime).toFixed(3)} 0) scale(${pixelsPerSecond.toFixed(6)} 1)`;
  // A declared window is the grid: inside Preview the lines come from the DJ's
  // own span and beat count, never from the analyser's stored grid.
  const visibleBeats = declaredGrid
    ? transitionPreviewGridBeats({ ...declaredGrid, from: renderStart, to: renderEnd })
    : analysis.beats.filter((beat) => beat.time >= renderStart && beat.time <= renderEnd);
  const authoritativeManualGrid = declaredGrid !== undefined || authoritativeManualTempoBpm(analysis.teaching) !== null;
  const visibleCues = cues.filter((cue) => cue.time >= renderStart && cue.time <= renderEnd);
  const visibleVerification = analysis.verification?.blocks.filter((block) => block.end >= renderStart && block.start <= renderEnd && block.status !== "verified") ?? [];
  const focusColours = FOCUS_WAVE_COLOURS[id];
  // Over the buffered range, not the visible one, so a section edge is already
  // drawn before it scrolls into view.
  const sectionSpansDisplay = replicateView
    ? sectionSpans.map((span) => ({ ...span, start: replicateMapTime(replicateView.plan, span.start), end: replicateMapTime(replicateView.plan, span.end) }))
    : sectionSpans;
  const visibleSections = visibleSectionSpans(sectionSpansDisplay, renderStart, renderEnd);
  const effectiveTempoRate = deck.playing && audio && !audio.paused ? audio.playbackRate : deck.tempoRate;
  const bpmLabel = effectiveDeckBpm(loopTempoBpm(deck) ?? resolvedBpmAt(analysis, playheadTime), effectiveTempoRate).toFixed(3);
  const tempoAdjustmentPercent = (effectiveTempoRate - 1) * 100;
  const tempoAdjustmentLabel = `${tempoAdjustmentPercent > 0 ? "+" : ""}${tempoAdjustmentPercent.toFixed(3)}%`;
  const trackLabel = focusWaveTrackLabel(deck.track);
  const artistLabel = clippedFocusWaveLabel(trackLabel.artist, 24);
  const titleLabel = clippedFocusWaveLabel(trackLabel.title, 34);
  /**
   * Paint a time that came from the hand, or from a glide still carrying it.
   *
   * The re-anchor uses the drag fraction rather than the playback one. Every
   * re-anchor re-renders this whole surface, and at the playback fraction that is
   * four hitches per screenful under a moving finger; the buffer has room for far
   * fewer.
   */
  const paintScrubTime = (time: number, velocity: number, commitAudio = false) => {
    scrubPaintTime.current = time;
    // The sound follows the hand, at the hand's speed: the same number that is
    // drawn is the number the platter reads from.
    onScrubAudio?.({ pointerTime: time, velocity, duration: analysis.duration });
    // Paint from the pointer immediately. Audio seeking and the wider booth
    // state are intentionally coalesced separately so decoder work and React
    // rendering cannot make the waveform feel attached by elastic.
    applyVisualTransform(time);
    if (focusWaveShouldRebase(renderAnchorTimeRef.current, time, windowSeconds, FOCUS_WAVE_DRAG_REBASE_FRACTION)) {
      renderAnchorTimeRef.current = time;
      setRenderAnchorTime(time);
    }
    if (commitAudio && audio) audio.currentTime = time;
    publishScrubState(time, commitAudio);
  };
  const seekFromPointer = (clientX: number, element: SVGSVGElement, commitAudio = false) => {
    if (!gesture.current || gesture.current.pinching) return null;
    const drag = focusWaveDragTime({
      anchorX: gesture.current.x,
      clientX,
      anchorTime: gesture.current.time,
      elementWidth: element.getBoundingClientRect().width,
      windowSeconds,
      duration: analysis.duration,
      engaged: gesture.current.moved,
      thresholdPx: gesture.current.thresholdPx,
    });
    if (!drag.engaged) return gesture.current.previewTime;
    const time = drag.time;
    gesture.current.moved = true;
    gesture.current.previewTime = time;
    // Recent history only: the throw on release is the last flick of the hand,
    // not the average of the whole drag.
    const samples = gesture.current.samples;
    samples.push({ time, at: performance.now() });
    while (samples.length > 2 && samples[0].at < samples[samples.length - 1].at - FOCUS_WAVE_THROW_WINDOW_MS) samples.shift();
    // One velocity estimator for both jobs — the throw on release and the pitch
    // in the headphones. `scrubVelocity` measures the same thing from
    // second-stamped samples; these are millisecond-stamped, and two estimators
    // reading different units is a bug waiting for a quiet night.
    paintScrubTime(time, focusWaveThrowVelocity(samples), commitAudio);
    return time;
  };
  /**
   * Let go and the wave keeps going, shedding speed until it settles.
   *
   * A platter has weight; a surface that stops the instant the hand leaves it
   * does not. The audio is committed once, at the end, because seeking a media
   * element every frame of the coast is exactly the decoder work the drag path
   * goes out of its way to avoid.
   */
  const startGlide = (fromTime: number, velocity: number, wasPlaying: boolean) => {
    const limit = focusWaveThrowLimit(windowSeconds);
    let speed = Math.max(-limit, Math.min(limit, velocity));
    let time = fromTime;
    let last = performance.now();
    const settle = () => {
      glideFrame.current = 0;
      scrubPaintTime.current = null;
      onScrubChange(false);
      // The platter eases back to the deck's own tempo, or to silence if the
      // deck was stopped — `scrubRelease` names which, and the worklet's own
      // ramp keeps either from arriving as a click.
      onScrubAudio?.(null);
      if (audio) audio.currentTime = time;
      publishScrubState(time, true);
      if (wasPlaying) void audio?.play();
    };
    const step = (now: number) => {
      const stepped = focusWaveGlideStep(speed, now - last, windowSeconds);
      last = now;
      speed = stepped.velocity;
      time = Math.min(Math.max(0, time + stepped.delta), Math.max(0, analysis.duration));
      // A coasting platter is still a moving record: the pitch falls away with
      // the speed rather than cutting out the moment the hand leaves.
      paintScrubTime(time, speed);
      // Running out of groove at either end stops it, rather than coasting
      // silently against a wall it cannot pass.
      const atEdge = time <= 0 || time >= analysis.duration;
      if (!stepped.moving || atEdge) return settle();
      glideFrame.current = requestAnimationFrame(step);
    };
    glideFrame.current = requestAnimationFrame(step);
  };
  // Where a pointer sits in track time. The visible view keeps the playhead
  // centred, so the window is simply [trackTime − w/2, trackTime + w/2].
  const timeAtClientX = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const fraction = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const trackTime = scrubPaintTime.current ?? resolvedTrackTimeRef.current;
    return Math.max(0, trackTime - windowSeconds / 2 + fraction * windowSeconds);
  };
  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rightSelect && event.pointerType === "mouse" && event.button === 2) {
      event.preventDefault();
      // Capture is a nicety (keeps a drag alive outside the wave); a pointer
      // that cannot be captured must not kill the selection itself.
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* uncapturable pointer */ }
      rightGesture.current = { x: event.clientX, startTime: timeAtClientX(event.clientX, event.currentTarget), moved: false };
      setRightDraft(null);
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // A hand back on the platter stops it dead, as it would on a deck.
    if (glideFrame.current) {
      cancelAnimationFrame(glideFrame.current);
      glideFrame.current = 0;
      scrubPaintTime.current = null;
      onScrubChange(false);
      onScrubAudio?.(null);
    }
    if (!gesture.current) {
      // Read the clock at event time, not render time: the transform paints at
      // 60 Hz while this component re-renders at the booth's 15 Hz, so a
      // render-scoped anchor starts the drag up to 83 ms behind the finger.
      const anchoredTime = resolvedTrackTimeRef.current;
      const wasPlaying = Boolean(audio && !audio.paused);
      gesture.current = { x: event.clientX, time: anchoredTime, previewTime: anchoredTime, wasPlaying, moved: false, pinching: false, pinchDistance: 0, pinchWindow: windowSeconds, thresholdPx: focusWaveDragThresholdPx(event.pointerType), samples: [] };
      onScrubChange(true);
      audio?.pause();
    }
    pointers.current.set(event.pointerId, event.clientX);
    if (pointers.current.size >= 2) {
      const positions = [...pointers.current.values()];
      gesture.current.pinching = true;
      gesture.current.pinchDistance = Math.max(1, Math.abs(positions[0] - positions[1]));
      gesture.current.pinchWindow = windowSeconds;
    }
  };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rightGesture.current) {
      if (Math.abs(event.clientX - rightGesture.current.x) > 6) rightGesture.current.moved = true;
      if (rightGesture.current.moved) {
        const time = timeAtClientX(event.clientX, event.currentTarget);
        setRightDraft({ start: Math.min(rightGesture.current.startTime, time), end: Math.max(rightGesture.current.startTime, time) });
      }
      return;
    }
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, event.clientX);
    if (pointers.current.size >= 2) {
      const positions = [...pointers.current.values()];
      const distance = Math.max(1, Math.abs(positions[0] - positions[1]));
      onWindowChange(clamp(gesture.current.pinchWindow * gesture.current.pinchDistance / distance, 2, 64));
    } else seekFromPointer(event.clientX, event.currentTarget);
  };
  const pointerEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rightGesture.current) {
      const finished = rightGesture.current;
      rightGesture.current = null;
      setRightDraft(null);
      if (rightSelect) {
        if (finished.moved) rightSelect.onSpan(finished.startTime, timeAtClientX(event.clientX, event.currentTarget));
        else rightSelect.onTap(finished.startTime);
      }
      return;
    }
    if (!gesture.current) return;
    const threw = !gesture.current.pinching && gesture.current.moved;
    // Read the hand's speed before the last move is folded in, then take that
    // move — otherwise the release position lands in the history twice and the
    // throw reads as slower than the hand actually was.
    if (threw) seekFromPointer(event.clientX, event.currentTarget);
    const velocity = threw ? focusWaveThrowVelocity(gesture.current.samples) : 0;
    const from = gesture.current.previewTime;
    const resume = gesture.current.wasPlaying;
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) {
      gesture.current = null;
      if (threw && Math.abs(velocity) >= windowSeconds * FOCUS_WAVE_GLIDE_STOP_WINDOWS_PER_SECOND) {
        // Scrub state stays held: the gesture is still going, just without a
        // hand on it.
        startGlide(from, velocity, resume);
        return;
      }
      scrubPaintTime.current = null;
      onScrubChange(false);
      onScrubAudio?.(null);
      if (threw) {
        if (audio) audio.currentTime = from;
        publishScrubState(from, true);
      }
      if (resume) void audio?.play();
    }
  };
  const pointerCancel = (event: React.PointerEvent<SVGSVGElement>) => {
    if (rightGesture.current) {
      rightGesture.current = null;
      setRightDraft(null);
      return;
    }
    if (!gesture.current) return;
    const { previewTime, wasPlaying, moved } = gesture.current;
    if (moved) {
      if (audio) audio.currentTime = previewTime;
      publishScrubState(previewTime, true);
    }
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) {
      gesture.current = null;
      scrubPaintTime.current = null;
      onScrubChange(false);
      onScrubAudio?.(null);
      if (wasPlaying) void audio?.play();
    }
  };
  // Deck-recycle block reasons all end with "before replacing it"; they must be
  // visible on the deck itself, not only in the assisted panel.
  const showLoadHandoff = /ready/.test(loadStatus.toLowerCase()) || /before replacing it/.test(loadStatus);
  return <div className="moving-wave-shell focus-wave-ready">{spectrumSource && <FocusSpectrum source={spectrumSource} deck={id} />}{showLoadHandoff && <FocusWaveLoadState key={loadStatus} id={id} deck={deck} status={loadStatus} load={load} handoff />}<svg key={deck.track?.id} className="moving-wave" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerEnd}
    onPointerCancel={pointerCancel}
    onLostPointerCapture={pointerCancel}
    onContextMenu={rightSelect ? (event) => event.preventDefault() : undefined}>
    <defs>
      <clipPath id={`moving-${scope}-${id}-wave-shape`}><g ref={movingClipLayer}>{waveformChunks.map((chunk) => <path key={`clip-wave-chunk-${chunk.index}`} d={chunk.path} transform={waveformChunkTransform(chunk)} />)}</g></clipPath>
      {/* The same silhouette without the per-frame transform. The section layer
          below carries that transform itself, so its clip must not also have it
          applied or the two would shift apart by exactly one frame's offset. */}
      <clipPath id={`moving-${scope}-${id}-wave-shape-static`}>{waveformChunks.map((chunk) => <path key={`static-clip-wave-chunk-${chunk.index}`} d={chunk.path} transform={waveformChunkTransform(chunk)} />)}</clipPath>
      <SectionPatternDefs scope={`${scope}-${id}`} surface="focus" colour={SECTION_PATTERN_INK} />
    </defs>
    <rect width={width} height={height} fill="#080b0a" />
    <g ref={movingBackLayer}>
      {visibleVerification.map((block, index) => <rect key={`audit-${index}`} x={x(Math.max(start, block.start))} width={Math.max(1, x(Math.min(end, block.end)) - x(Math.max(start, block.start)))} height={height} fill={block.status === "review" ? "#ff5a67" : "#89948f"} opacity={block.status === "review" ? .13 : .07} />)}
      {deck.loopStart !== null && deck.loopEnd !== null && deck.loopEnd >= renderStart && deck.loopStart <= renderEnd && <rect x={x(Math.max(renderStart, deck.loopStart))} width={Math.max(1, x(Math.min(renderEnd, deck.loopEnd)) - x(Math.max(renderStart, deck.loopStart)))} height={height} fill={deck.loopActive ? "#ab7dff" : "transparent"} fillOpacity=".26" stroke="#ab7dff" strokeWidth={deck.loopActive ? 4 : 2} strokeDasharray={deck.loopActive ? undefined : "10 7"} />}
      {/* REPLICATE: the pasted passes, outlined where the wave now repeats. */}
      {replicateView && Array.from({ length: replicateView.plan.copies }, (_, pass) => {
        const length = replicateView.plan.blockEnd - replicateView.plan.blockStart;
        const passStart = replicateView.plan.blockEnd + pass * length;
        const passEnd = passStart + length;
        if (passEnd < renderStart || passStart > renderEnd || !(length > 0)) return null;
        return <g key={`replica-pass-${pass}`}>
          <rect x={x(Math.max(renderStart, passStart))} width={Math.max(1, x(Math.min(renderEnd, passEnd)) - x(Math.max(renderStart, passStart)))} height={height} fill="#4cf2b4" fillOpacity=".09" stroke="#4cf2b4" strokeWidth="2" strokeDasharray="10 6" />
          <text x={x(passStart) + 6} y="16" fill="#4cf2b4" fontSize="12" opacity=".9">REPLICA {pass + 1}</text>
        </g>;
      })}
      {/* REPLICATE selection: the block right-click is naming right now. */}
      {rightSelect && (rightDraft ?? rightSelect.span) && (() => {
        const span = rightDraft ?? rightSelect.span!;
        if (span.end < renderStart || span.start > renderEnd) return null;
        return <rect x={x(Math.max(renderStart, span.start))} width={Math.max(1, x(Math.min(renderEnd, span.end)) - x(Math.max(renderStart, span.start)))} height={height} fill="#ffd24c" fillOpacity={rightDraft ? .12 : .18} stroke="#ffd24c" strokeWidth="2" strokeDasharray="6 5" />;
      })()}
      {rightSelect && rightSelect.pending !== null && rightSelect.pending >= renderStart && rightSelect.pending <= renderEnd && <line x1={x(rightSelect.pending)} x2={x(rightSelect.pending)} y1="0" y2={height} stroke="#ffd24c" strokeWidth="3" strokeDasharray="4 4" />}
      {waveformChunks.map((chunk) => <path key={`wave-chunk-${chunk.index}`} className="focus-wave-audio-shape" d={chunk.path} transform={waveformChunkTransform(chunk)} fill={focusColours.wave} opacity=".8" />)}
    </g>
    {/* Section texture: one rect per section, masked by the wave silhouette.
        Redrawing every wave chunk once per section instead — the obvious way —
        multiplies full-geometry pattern fills by the number of visible sections,
        and this surface re-composites on every frame of a drag. One rect each is
        the same picture for a fraction of the raster cost. */}
    <g ref={movingSectionLayer} clipPath={`url(#moving-${scope}-${id}-wave-shape-static)`}>
      {visibleSections.map((span, index) => <rect
        key={`section-${index}`}
        x={x(span.start)}
        y="0"
        width={Math.max(1, x(span.end) - x(span.start))}
        height={height}
        fill={`url(#${sectionPatternId(`${scope}-${id}`, "focus", span.label)})`}
      />)}
    </g>
    <g className={`focus-wave-watermark-svg focus-wave-watermark-svg-${id.toLowerCase()}`} aria-hidden="true">
      <g className="focus-wave-watermark-base" fill={focusColours.label} opacity=".48">
        <text className="focus-wave-tempo-adjustment" x="90" y="58" textAnchor="middle">{playheadTime.toFixed(3)}</text>
        <text className="focus-wave-tempo-adjustment" x="90" y="103" textAnchor="middle">{tempoAdjustmentLabel}</text>
        <text className="focus-wave-bpm-value" x="240" y="94" textAnchor="middle">{bpmLabel}</text>
        <text className="focus-wave-bpm-unit" x="240" y="132" textAnchor="middle">BPM</text>
        <text className="focus-wave-artist" x="690" y="75" textAnchor="middle">{artistLabel}</text>
        <text className="focus-wave-title" x="690" y="127" textAnchor="middle">{titleLabel}</text>
      </g>
      <g className="focus-wave-watermark-overlap" fill={focusColours.overlap} opacity=".92" clipPath={`url(#moving-${scope}-${id}-wave-shape)`}>
        <text className="focus-wave-tempo-adjustment" x="90" y="58" textAnchor="middle">{playheadTime.toFixed(3)}</text>
        <text className="focus-wave-tempo-adjustment" x="90" y="103" textAnchor="middle">{tempoAdjustmentLabel}</text>
        <text className="focus-wave-bpm-value" x="240" y="94" textAnchor="middle">{bpmLabel}</text>
        <text className="focus-wave-bpm-unit" x="240" y="132" textAnchor="middle">BPM</text>
        <text className="focus-wave-artist" x="690" y="75" textAnchor="middle">{artistLabel}</text>
        <text className="focus-wave-title" x="690" y="127" textAnchor="middle">{titleLabel}</text>
      </g>
    </g>
    <g ref={movingFrontLayer}>
      {visibleCues.map((cue, index) => {
        const swapKind = bassSwapCueKind(cue);
        const cueX = x(cue.time);
        const atPlayhead = swapKind && Math.abs(cue.time - playheadTime) <= Math.max(.12, .35 * deck.tempoRate);
        return <g key={`cue-${cue.id}`} className={swapKind ? `bass-swap-cue bass-swap-${swapKind}${atPlayhead ? " bass-swap-now" : ""}` : undefined}><line className="cue-marker-line" x1={cueX} x2={cueX} y1="0" y2={height} stroke={cue.colour} strokeWidth="4" strokeDasharray="8 5" />{swapKind && <><circle className="bass-cue-ring" cx={cueX} cy="18" r="19" fill="none" stroke={cue.colour} /><circle className="bass-cue-beacon" cx={cueX} cy="18" r="11" fill={cue.colour} /></>}<text x={Math.min(width - 170, Math.max(5, cueX + 6))} y={height - 8 - index % 2 * 14} fill={cue.colour} fontSize="11">{cue.label}</text></g>;
      })}
      {showGridLines && visibleBeats.map((beat) => <line key={beat.beat} x1={x(beat.time)} x2={x(beat.time)} y1="0" y2={height} stroke={authoritativeManualGrid ? beat.isDownbeat ? "#ff4f98" : "#55a7ff" : PHASE_COLOURS[phaseStatus]} strokeWidth={beat.isDownbeat ? 3 : 1} opacity={beat.isDownbeat ? .95 : .72} />)}
      {showGridLines && !authoritativeManualGrid && analysis.beats.filter((beat) => beat.time >= renderStart && beat.time <= renderEnd && beat.kickStatus && beat.kickStatus !== "inferred").map((beat) => <circle key={`kick-audit-${beat.beat}`} cx={x(beat.time)} cy="12" r="4" fill={beat.kickStatus === "aligned" ? "#4cf2b4" : beat.kickStatus === "early" ? "#ff5a67" : beat.kickStatus === "late" ? "#55a7ff" : "#ffc857"} />)}
      {/* The kick map, along the floor of the wave so it is read against the
          grid lines rather than competing with them. Drawn only when the ticks
          can be told apart: at a wide zoom a thousand of them is a smear, and a
          smear cannot answer "is this kick on that beat". */}
      {(() => {
        const visible = drumKicksDisplay.filter((kick) => kick.time >= renderStart && kick.time <= renderEnd);
        if (!visible.length) return null;
        // Nothing is filtered — a stutter is a real hit and belongs on the record.
        // Confidence is drawn instead: a solid tick was unmistakably a kick, a
        // faint one barely registered, and no threshold of mine decides which of
        // those you are allowed to see.
        //
        // Dense never means hidden. A guard here used to blank the whole map past
        // ~110 visible kicks, so zooming out made it silently vanish — reported
        // as "no drum map has loaded". Zoomed out the ticks just draw thinner;
        // the record is always on the wave.
        const dense = visible.length > width / 9;
        /**
         * Drawn at the detector's own time, with no nudging.
         *
         * A snap-to-drawn-blob lived here briefly, to pull ticks onto the picture.
         * It is gone because the fault was upstream: the detector was reporting
         * the steepest rise, mid-swell, rather than where the kick starts. That is
         * fixed in `kick-detect.ts`, so a second correction here would only
         * double-count it — and the map must be what the detector actually says,
         * or nothing downstream of it can be trusted.
         */
        return <g className="focus-kick-map">{visible.map((kick, index) => <line
          key={`kick-map-${index}`}
          x1={x(kick.time)}
          x2={x(kick.time)}
          y1={height - 12 - 18 * kick.confidence}
          y2={height}
          stroke="#e9f5ef"
          strokeWidth={dense ? 1 : 2}
          opacity={((dense ? .1 : .14) + (dense ? .5 : .72) * kick.confidence).toFixed(3)}
        />)}</g>;
      })()}
    </g>
    <g className="metal-playhead" pointerEvents="none" aria-hidden="true">
      <defs>
        <linearGradient id={`playhead-metal-${scope}-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#72828d" /><stop offset=".5" stopColor="#e5edf2" /><stop offset="1" stopColor="#87959f" />
        </linearGradient>
      </defs>
      <line x1={width / 2} x2={width / 2} y1="0" y2={height} stroke={PHASE_COLOURS[phaseStatus]} strokeWidth="4" opacity=".4" />
      <rect x={width / 2 - 1.25} y="0" width="2.5" height={height} fill={`url(#playhead-metal-${scope}-${id})`} />
    </g>
  </svg></div>;
}

function FocusDeckControls({ id, deck, onLoopToggle, onLoopSize, onLoopMove }: { id: DeckId; deck: DeckState; onLoopToggle: () => void; onLoopSize: (size: LoopSize) => void; onLoopMove: (direction: -1 | 1) => void }) {
  const hotkeys = useContext(HotkeyContext);
  const loopSizeIndex = Math.max(0, LOOP_SIZES.indexOf(deck.loopSize));
  const halfLoopSize = LOOP_SIZES[Math.max(0, loopSizeIndex - 1)];
  const doubleLoopSize = LOOP_SIZES[Math.min(LOOP_SIZES.length - 1, loopSizeIndex + 1)];
  return <div className={`wave-inline-cue-actions wave-inline-cue-actions-${id.toLowerCase()}`} aria-label={`Deck ${id} loop controls`}>
    <button className={deck.loopActive ? "loop-toggle active" : deck.loopStart !== null ? "loop-toggle stored" : "loop-toggle"} aria-label={`Toggle Deck ${id} loop`} aria-pressed={deck.loopActive} disabled={!deck.track || !deck.analysis} onClick={onLoopToggle}><span className="cdj-icon-bezel"><LoopTransportIcon /></span></button>
    <div className="loop-size-options" aria-label={`Deck ${id} loop size`}>
      {LOOP_SIZES.filter((size) => size <= 128).map((size) => <button key={size} className={deck.loopSize === size ? "loop-size-button active" : "loop-size-button"} aria-label={`Set Deck ${id} loop to ${size} beats`} aria-pressed={deck.loopSize === size} disabled={!deck.track} onClick={() => onLoopSize(size as LoopSize)}>{size}</button>)}
    </div>
    <div className="loop-transform-options">
      <button className="loop-scale-half" disabled={!deck.track || loopSizeIndex === 0} onClick={() => onLoopSize(halfLoopSize)} aria-label={`Halve Deck ${id} loop size`}><b>×½</b></button>
      <button className="loop-scale-double" disabled={!deck.track || loopSizeIndex === LOOP_SIZES.length - 1} onClick={() => onLoopSize(doubleLoopSize)} aria-label={`Double Deck ${id} loop size`}><b>×2</b></button>
      <button className="loop-move-back" disabled={deck.loopStart === null} onClick={() => onLoopMove(-1)} aria-label={`Move Deck ${id} loop left`} title={hotkeyLabel(hotkeys[`loop-back:${id}`]) + " keyboard shortcut"}><b>←</b></button>
      <button className="loop-move-forward" disabled={deck.loopStart === null} onClick={() => onLoopMove(1)} aria-label={`Move Deck ${id} loop right`} title={hotkeyLabel(hotkeys[`loop-forward:${id}`]) + " keyboard shortcut"}><b>→</b></button>
    </div>
  </div>;
}

function FocusWaveTransport({ id, deck, audioRef, shadowAudioRef, cues, overviewZoom, focusWindowSeconds, canBeatSync, canTempoSync, mediaDuration, onMediaState, onOverviewZoomChange, onFocusWindowChange, onSeek, onCueToggle, onTempoStep, onWarm, onReturnToCue, onToggle, onPlayCueStart, onPlayCueEnd, onChange, onBend, onBeatSync, onTempoSync, onLoopToggle, onLoopSize, onLoopMove }: { id: DeckId; deck: DeckState; audioRef: RefObject<HTMLAudioElement | null>; shadowAudioRef: RefObject<HTMLAudioElement | null>; cues: Cue[]; overviewZoom: number; focusWindowSeconds: number; canBeatSync: boolean; canTempoSync: boolean; mediaDuration?: number | null; onMediaState?: (media: HTMLAudioElement, kind: DeckMediaEvent) => void; onOverviewZoomChange: (zoom: number) => void; onFocusWindowChange: (seconds: number) => void; onSeek: (time: number) => void; onCueToggle: () => void; onTempoStep: (direction: -1 | 1, deltaBpm: number) => void; onWarm: () => void; onReturnToCue: () => void; onToggle: () => void; onPlayCueStart: () => void; onPlayCueEnd: () => void; onLoad: () => void; onUnload: () => void; onChange: (patch: Partial<DeckState>) => void; onBend: (direction: -1 | 0 | 1) => void; onBeatSync: () => void; onTempoSync: () => void; onLoopToggle: () => void; onLoopSize: (size: LoopSize) => void; onLoopMove: (direction: -1 | 1) => void }) {
  const hotkeys = useContext(HotkeyContext);
  const mappedBpm = bpmAt(deck);
  return <div className={`focus-wave-transport focus-wave-transport-${id.toLowerCase()}`} aria-label={`Deck ${id} waveform transport`}>
    <div className="wave-transport-left">
      <div className="wave-tempo-cue-column">
      <div className="wave-focus-window-zoom" aria-label={`Deck ${id} moving waveform focus zoom`}>
        <button className="wave-zoom-icon" aria-label={`Deck ${id} moving waveform zoom out`} title="Show more time in the moving waveform" disabled={!deck.track || focusWindowSeconds >= 64} onClick={() => onFocusWindowChange(Math.min(64, focusWindowSeconds * 2))}><span className="cdj-icon-bezel"><ZoomOutIcon /></span></button>
        <button className="wave-zoom-icon" aria-label={`Deck ${id} moving waveform zoom in`} title="Show less time in the moving waveform" disabled={!deck.track || focusWindowSeconds <= 2} onClick={() => onFocusWindowChange(Math.max(2, focusWindowSeconds / 2))}><span className="cdj-icon-bezel"><ZoomInIcon /></span></button>
      </div>
      <div className="wave-tempo-cue-stack">
        <button className={deck.cue ? "wave-headphone-cue active" : "wave-headphone-cue"} aria-label={`Deck ${id} headphone cue`} aria-pressed={deck.cue} title={`${hotkeyLabel(hotkeys[`cue:${id}`])} keyboard shortcut`} onClick={onCueToggle}><span className="cdj-icon-bezel"><HeadphoneIcon /></span></button>
        <div className="wave-inline-sync wave-relocated-sync" aria-label={`Deck ${id} pitch bends and sync controls`}>
          <button className="wave-pitch-hold wave-pitch-down" aria-label={`Hold to slow Deck ${id}; while paused, scrub backward`} title="Playing: eight-beat brake · Paused: accelerating reverse scrub" disabled={!deck.track} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onBend(-1); }} onPointerUp={(event) => { onBend(0); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => onBend(0)} onLostPointerCapture={() => onBend(0)} onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); event.stopPropagation(); onBend(-1); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onBend(0); } }} onBlur={() => onBend(0)}><span className="cdj-icon-bezel"><PitchDownIcon /></span><small>PITCH</small></button>
          <button className="wave-pitch-hold wave-pitch-up" aria-label={`Hold to speed Deck ${id}; while paused, scrub forward`} title="Playing: mirrored eight-beat acceleration · Paused: accelerating forward scrub" disabled={!deck.track} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onBend(1); }} onPointerUp={(event) => { onBend(0); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => onBend(0)} onLostPointerCapture={() => onBend(0)} onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); event.stopPropagation(); onBend(1); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onBend(0); } }} onBlur={() => onBend(0)}><span className="cdj-icon-bezel"><PitchUpIcon /></span><small>PITCH</small></button>
          <button className="wave-sync-action wave-sync-tempo" disabled={!canTempoSync} onClick={onTempoSync}>SYNC TEMPO</button>
          <button className="wave-sync-action wave-sync-beat" disabled={!canBeatSync} onClick={onBeatSync}>SYNC BEAT</button>
        </div>
        <div className="wave-tempo-overview-zoom" aria-label={`Deck ${id} overall waveform zoom`}>
          <button className="wave-zoom-icon" aria-label={`Deck ${id} overall waveform zoom out`} title="Zoom overall waveform out" disabled={!deck.track || overviewZoom <= 1} onClick={() => onOverviewZoomChange(Math.max(1, overviewZoom / 2))}><span className="cdj-icon-bezel"><ZoomOutIcon /></span></button>
          <button className="wave-zoom-icon" aria-label={`Deck ${id} overall waveform zoom in`} title="Zoom overall waveform in" disabled={!deck.track || overviewZoom >= 16} onClick={() => onOverviewZoomChange(Math.min(16, overviewZoom * 2))}><span className="cdj-icon-bezel"><ZoomInIcon /></span></button>
        </div>
        <div className="wave-tempo-adjusters" aria-label={`Deck ${id} fine BPM adjusters`}>
          <TempoStepButton key={`down-${deck.track?.id}`} deck={id} direction={-1} disabled={!deck.track || !mappedBpm} onStep={onTempoStep} />
          <TempoStepButton key={`up-${deck.track?.id}`} deck={id} direction={1} disabled={!deck.track || !mappedBpm} onStep={onTempoStep} />
        </div>
      </div>
      </div>
      <button className="wave-play-cue" aria-label={`Play Deck ${id} from cue`} title="While playing: restart from cue. While paused: hold to audition." disabled={!deck.track} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onPlayCueStart(); }} onPointerUp={(event) => { onPlayCueEnd(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={onPlayCueEnd} onLostPointerCapture={onPlayCueEnd} onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); event.stopPropagation(); onPlayCueStart(); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onPlayCueEnd(); } }}><span className="cdj-icon-bezel"><PlayCueTransportIcon /></span></button>
    </div>
    <FocusDeckControls id={id} deck={deck} onLoopToggle={onLoopToggle} onLoopSize={onLoopSize} onLoopMove={onLoopMove} />
    <InlineDeckShelf id={id} deck={deck} audioRef={audioRef} shadowAudioRef={shadowAudioRef} cues={cues} overviewZoom={overviewZoom} mediaDuration={mediaDuration} onMediaState={onMediaState} onSeek={onSeek} onChange={onChange} />
    <button type="button" className="wave-return-cue" aria-label={`Return Deck ${id} to its cue`} title="Return to playback start and pause" disabled={!deck.track} onClick={onReturnToCue}><span className="cdj-icon-bezel"><ReturnToCueIcon /></span></button>
    <button className={deck.playing ? "wave-play-toggle active" : "wave-play-toggle"} aria-label={deck.playing ? `Pause Deck ${id}` : `Play Deck ${id}`} disabled={!deck.track} title={`${hotkeyLabel(hotkeys[`play:${id}`])} keyboard shortcut`} onPointerDown={onWarm} onClick={onToggle}><span className="cdj-icon-bezel">{deck.playing ? <PauseTransportIcon /> : <PlayTransportIcon />}</span></button>
  </div>;
}

function EqDial({ label, value, killed = false, shortcut, onChange }: { label: string; value: number; killed?: boolean; shortcut?: string; onChange: (value: number) => void }) {
  const rotation = -135 + (value + 60) / 72 * 270;
  const displayValue = Math.round(value * 10) / 10;
  return <label className={killed ? "rotary-control killed" : "rotary-control"}><span>{label}</span><div className="rotary-dial" style={{ "--dial-rotation": `${rotation}deg` } as CSSProperties}><input aria-label={`${label} EQ${shortcut ? `, bass kill shortcut ${shortcut}` : ""}`} title={shortcut ? `Bass kill: ${shortcut} · Right-click to reset to 0 dB` : "Right-click to reset to 0 dB"} type="range" min="-60" max="12" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} onContextMenu={(event) => { event.preventDefault(); onChange(0); }} /></div><b>{value === -60 ? "KILL" : `${displayValue > 0 ? "+" : ""}${displayValue.toFixed(1)}`}</b></label>;
}

function VolumeDial({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const rotation = -135 + value * 270;
  return <label className="rotary-control channel-volume-rotary"><span>VOLUME</span><div className="rotary-dial" style={{ "--dial-rotation": `${rotation}deg` } as CSSProperties}><input aria-label="Channel volume" title="Right-click to reset to 85%" type="range" min="0" max="1" step=".01" value={value} onChange={(event) => onChange(Number(event.target.value))} onContextMenu={(event) => { event.preventDefault(); onChange(.85); }} /></div><b>{Math.round(value * 100)}%</b></label>;
}

function InlineDeckShelf({ id, deck, audioRef, shadowAudioRef, cues, overviewZoom, onSeek, onChange, mediaDuration, onMediaState }: { id: DeckId; deck: DeckState; audioRef: RefObject<HTMLAudioElement | null>; mediaDuration?: number | null; onMediaState?: (media: HTMLAudioElement, kind: DeckMediaEvent) => void; shadowAudioRef: RefObject<HTMLAudioElement | null>; cues: Cue[]; overviewZoom: number; onSeek: (time: number) => void; onChange: (patch: Partial<DeckState>) => void }) {
  const hotkeys = useContext(HotkeyContext);
  // Before analysis lands, the deck's own media element knows the real length (uploads carry 0).
  const duration = deck.analysis?.duration ?? (deck.track?.duration || mediaDuration || 0);
  return <section className={`wave-inline-deck-shelf wave-inline-deck-shelf-${id.toLowerCase()}`} aria-label={`Deck ${id} track and mixer controls`}>
    <audio ref={audioRef} src={deck.track?.audio} preload="auto" onEnded={() => onChange({ playing: false })} onLoadedMetadata={(event) => onMediaState?.(event.currentTarget, "metadata")} onCanPlay={(event) => onMediaState?.(event.currentTarget, "canplay")} onError={(event) => onMediaState?.(event.currentTarget, "error")} />
    <audio ref={shadowAudioRef} src={deck.track?.audio} preload="auto" aria-hidden="true" />
    <div className="wave-inline-overview-layer"><OverviewWave id={id} deck={deck} cues={cues} zoom={overviewZoom} onSeek={onSeek} inline /></div>
    <div className="wave-inline-track">
      <small>{timeLabel(deck.currentTime)} / {timeLabel(duration)} · {(deck.tempoRate * 100).toFixed(1)}%</small>
    </div>
    <div className="wave-inline-eq" aria-label={`Deck ${id} three-band EQ`}>
      <div className="wave-inline-eq-bands">
        <EqDial label="Low" value={deck.low} killed={deck.low === -60} shortcut={hotkeyLabel(hotkeys[`bass:${id}`])} onChange={(low) => onChange({ low })} />
        <EqDial label="Mid" value={deck.mid} onChange={(mid) => onChange({ mid })} />
        <EqDial label="High" value={deck.high} onChange={(high) => onChange({ high })} />
      </div>
      <VolumeDial value={deck.volume} onChange={(volume) => onChange({ volume })} />
    </div>
  </section>;
}

function AssistedAutomationEditor({ value, disabled, onChange }: { value: AssistedOverlapAutomation; disabled: boolean; onChange: (next: AssistedOverlapAutomation) => void }) {
  const updatePoint = (index: number, patch: Partial<AssistedAutomationPoint>) => {
    const points = value.points.map((point, pointIndex) => pointIndex === index ? { ...point, ...patch } : point) as AssistedOverlapAutomation["points"];
    onChange(normaliseAssistedOverlapAutomation({ ...value, points }));
  };
  const pointPosition = (index: number) => index === 0
    ? "START · BEAT 0"
    : index === 1
      ? `${value.bassSwapBeats.length ? "BASS CUE" : "MID / HIGH Y"} · BEAT ${value.bassSwapBeat}`
      : `END · BEAT ${value.windowBeats}`;
  return <section className="assisted-automation-editor" aria-label="Assisted overlap automation">
    <div className="assisted-automation-heading"><div><b>MID / HIGH EQ AUTOMATION</b><span>X = WINDOW START · Y = MID/HIGH ANCHOR · Z = WINDOW END</span></div><small>FIXED GAIN CALIBRATION ON</small></div>
    <div className="assisted-automation-grid"><span>POINT</span><span>FIXED POSITION</span><span>INCOMING MID/HIGH</span><span>OUTGOING MID/HIGH</span>{value.points.map((point, index) => <div className="assisted-automation-row" key={index}><b>{["X", "Y", "Z"][index]}</b><strong>{pointPosition(index)}</strong><label><input disabled={disabled} aria-label={`Point ${["X", "Y", "Z"][index]} incoming percent`} type="number" min="0" max="150" step=".5" value={point.incomingPercent} onChange={(event) => updatePoint(index, { incomingPercent: Number(event.target.value) })} /><em>%</em></label><label><input disabled={disabled} aria-label={`Point ${["X", "Y", "Z"][index]} outgoing percent`} type="number" min="0" max="150" step=".5" value={point.outgoingPercent} onChange={(event) => updatePoint(index, { outgoingPercent: Number(event.target.value) })} /><em>%</em></label></div>)}</div>
    <p>Leave the bass lane unmarked to swap the bass kills as the overlap ends. Select a bass cue for an earlier handover. Automation sweeps the two low EQs from 25% to 75% through the beat immediately before that cue; the manual deck bass-kill controls remain available.</p>
  </section>;
}

function RunupGridMapper({ analysis, start, end, beats, crowdBpm, automation, onAutomationChange, audioRef, playheadTime = start, showReferenceGrid = true, onAudition, role = "outgoing", phaseColourRef, rightSelect, replicateView }: { analysis: Analysis | null; start: number; end: number; beats: number; crowdBpm: number; automation?: AssistedOverlapAutomation; onAutomationChange?: (next: AssistedOverlapAutomation) => void; audioRef?: RefObject<HTMLAudioElement | null>; playheadTime?: number; showReferenceGrid?: boolean; onAudition?: (time: number) => void; role?: TransitionPreviewRole; phaseColourRef?: RefObject<string | null>;
  /**
   * REPLICATE selection (DJ, 30 Aug 2026: "after the overlap window is
   * set... that's where the replicate option should be"). Right-click on
   * the pinned window: drag to sweep the block, or click its start then
   * its end. The booth snaps and stores it; this surface just reports raw
   * times inside the pinned span.
   */
  rightSelect?: { span: { start: number; end: number } | null; pending: number | null; onSpan: (a: number, b: number) => void; onTap: (time: number) => void };
  /** An applied replicate: pasted passes outlined where the wave repeats. */
  replicateView?: { plan: ReplicatePlan } }) {
  const [timelineZoom, setTimelineZoom] = useState(1);
  const rightGesture = useRef<{ x: number; startTime: number; moved: boolean } | null>(null);
  const [rightDraft, setRightDraft] = useState<{ start: number; end: number } | null>(null);
  const timelineScroll = useRef<HTMLDivElement | null>(null);
  const timelinePointers = useRef(new Map<number, { x: number; y: number }>());
  const timelineDrag = useRef<{ pointerId: number; x: number; scrollLeft: number } | null>(null);
  const timelinePinch = useRef<{ distance: number; zoom: number } | null>(null);
  const width = 1000;
  const height = 142;
  const middle = height / 2;
  const span = Math.max(.001, end - start);
  const x = (time: number) => clamp((time - start) / span * width, 0, width);
  // Draw the pinned window from the same fine waveform the moving wave uses.
  // `lowWaveform` is a whole-track overview at roughly a third of a second per
  // point — close to a whole beat — so a cue judged against it can look a beat
  // out while the audio underneath is exactly right. Each column takes the peak
  // of the source samples it covers, so a transient cannot alias away.
  const hasDetailedSource = Boolean(analysis?.displayLowWaveformDetailed?.length || analysis?.kickWaveformDetailed?.length || analysis?.lowWaveformDetailed?.length);
  const detailedSource = analysis?.displayLowWaveformDetailed?.length
    ? analysis.displayLowWaveformDetailed
    : analysis?.kickWaveformDetailed?.length
      ? analysis.kickWaveformDetailed
      : analysis?.lowWaveformDetailed?.length
        ? analysis.lowWaveformDetailed
        : analysis?.lowWaveform ?? [];
  const sourceHopSeconds = hasDetailedSource
    ? Math.max(.001, analysis?.hopSeconds ?? .01)
    : Math.max(.001, (analysis?.duration ?? span) / Math.max(1, detailedSource.length - 1));
  const sampleCount = detailedSource.length ? Math.min(BOOTH_WAVEFORM_SAMPLE_LIMIT, width) : 0;
  const columnSeconds = span / Math.max(1, sampleCount - 1);
  const samples: Array<{ time: number; value: number }> = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const time = start + index * columnSeconds;
    const firstIndex = clamp(Math.round((time - columnSeconds / 2) / sourceHopSeconds), 0, detailedSource.length - 1);
    const lastIndex = clamp(Math.round((time + columnSeconds / 2) / sourceHopSeconds), 0, detailedSource.length - 1);
    let peak = 0;
    for (let sourceIndex = Math.min(firstIndex, lastIndex); sourceIndex <= Math.max(firstIndex, lastIndex); sourceIndex += 1) {
      peak = Math.max(peak, Math.abs(Number(detailedSource[sourceIndex]) || 0));
    }
    samples.push({ time, value: clamp(peak, 0, 1) });
  }
  const upper = samples.map(({ time, value }) => `${x(time)},${middle - value * middle * .78}`);
  const lower = [...samples].reverse().map(({ time, value }) => `${x(time)},${middle + value * middle * .78}`);
  const waveformPath = upper.length ? `M${upper.join(" L")} L${lower.join(" L")} Z` : "";
  const visibleBeats = analysis?.beats.filter((beat) => beat.time >= start && beat.time <= end) ?? [];
  const verification = analysis?.verification?.blocks ?? [];
  const diagnostics = runupGridDiagnostics({
    start,
    end,
    beats,
    crowdBpm,
    grid: analysis?.beats ?? [],
    verification,
    hypotheses: analysis?.hypotheses,
  });
  const manualLines = Array.from({ length: Math.max(1, beats) + 1 }, (_, index) => index).filter((index) => index === beats || index % 4 === 0);
  // Ownership is chosen beat by beat, not every fourth beat: a DJ cutting the
  // bass back and forth needs to land a cut on any beat in the phrase. The
  // timeline already scrolls and zooms, which is what makes 96+ buttons usable.
  const bassCueChoices = Array.from({ length: Math.max(0, beats - 1) }, (_, index) => index + 1);
  const bassSwitch = automation?.bassSwapBeats.length ? assistedBassSwitchWindow(automation.bassSwapBeat) : null;
  const timelineWidth = Math.max(640, manualLines.length * 38) * timelineZoom;
  const changeTimelineZoom = (direction: -1 | 1) => setTimelineZoom((current) => clamp(direction > 0 ? current * 1.5 : current / 1.5, 1, 6));
  const pointerDistance = () => {
    const pointers = [...timelinePointers.current.values()];
    return pointers.length < 2 ? 0 : Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  };
  // A tap on the waveform auditions from that exact point. Tracked here rather
  // than with onClick so a drag-to-scroll or a pinch never fires an audition.
  const timelineTap = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  /**
   * Mouse audition. The pointer handlers below are touch/pen only — they exist
   * for drag-scroll and pinch-zoom and bail out on `mouse` — so a mouse click
   * needs its own path or clicking the waveform does nothing at all.
   */
  const timelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onAudition) return;
    // The beat-ruler bass-cue buttons live inside this container and must keep
    // behaving like buttons.
    if ((event.target as HTMLElement | null)?.closest("button")) return;
    const surface = event.currentTarget.querySelector("svg");
    const bounds = surface?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    if (event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    onAudition(start + clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * span);
  };
  // Pixel → window time through the same span everything here draws with.
  const timelineTimeAt = (clientX: number, container: HTMLDivElement) => {
    const bounds = container.querySelector("svg")?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return start;
    return start + clamp((clientX - bounds.left) / bounds.width, 0, 1) * span;
  };
  const timelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (rightSelect && event.pointerType === "mouse" && event.button === 2) {
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* uncapturable pointer */ }
      rightGesture.current = { x: event.clientX, startTime: timelineTimeAt(event.clientX, event.currentTarget), moved: false };
      setRightDraft(null);
      return;
    }
    if (event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timelinePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (timelinePointers.current.size === 1) {
      timelineDrag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: timelineScroll.current?.scrollLeft ?? 0 };
      timelineTap.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    } else {
      timelineTap.current = null;
    }
    if (timelinePointers.current.size === 2) {
      timelinePinch.current = { distance: Math.max(1, pointerDistance()), zoom: timelineZoom };
      timelineDrag.current = null;
    }
  };
  const timelinePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (rightGesture.current) {
      if (Math.abs(event.clientX - rightGesture.current.x) > 6) rightGesture.current.moved = true;
      if (rightGesture.current.moved) {
        const time = timelineTimeAt(event.clientX, event.currentTarget);
        setRightDraft({ start: Math.min(rightGesture.current.startTime, time), end: Math.max(rightGesture.current.startTime, time) });
      }
      return;
    }
    if (!timelinePointers.current.has(event.pointerId)) return;
    timelinePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (timelinePointers.current.size >= 2 && timelinePinch.current) {
      event.preventDefault();
      setTimelineZoom(clamp(timelinePinch.current.zoom * pointerDistance() / timelinePinch.current.distance, 1, 6));
      return;
    }
    const tap = timelineTap.current;
    if (tap && tap.pointerId === event.pointerId
      && (Math.abs(event.clientX - tap.x) > 4 || Math.abs(event.clientY - tap.y) > 4)) {
      tap.moved = true;
    }
    const drag = timelineDrag.current;
    if (drag?.pointerId === event.pointerId && timelineScroll.current) {
      event.preventDefault();
      timelineScroll.current.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    }
  };
  const timelinePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (rightGesture.current) {
      const finished = rightGesture.current;
      rightGesture.current = null;
      setRightDraft(null);
      if (rightSelect) {
        if (finished.moved) rightSelect.onSpan(finished.startTime, timelineTimeAt(event.clientX, event.currentTarget));
        else rightSelect.onTap(finished.startTime);
      }
      return;
    }
    const tap = timelineTap.current;
    if (tap && tap.pointerId === event.pointerId && !tap.moved && onAudition) {
      // Map the pixel to a time through the same start/end span the waveform,
      // grid and playhead are all drawn with, so the audition begins at the
      // sample under the finger.
      const surface = event.currentTarget.querySelector("svg");
      const bounds = surface?.getBoundingClientRect();
      if (bounds && bounds.width > 0) {
        const fraction = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
        onAudition(start + fraction * span);
      }
    }
    timelineTap.current = null;
    timelinePointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (timelinePointers.current.size < 2) timelinePinch.current = null;
    const remaining = [...timelinePointers.current.entries()][0];
    timelineDrag.current = remaining
      ? { pointerId: remaining[0], x: remaining[1].x, scrollLeft: timelineScroll.current?.scrollLeft ?? 0 }
      : null;
  };
  const offsetLabel = (offset: number | null) => offset === null ? "NO OLD GRID" : `${offset >= 0 ? "+" : ""}${offset} ms`;
  return <section className="manual-grid-mapper" aria-label="Run-up grid mapper">
    <div className="manual-grid-heading"><div><b>{automation ? "CONFIRMED MIX IN WINDOW" : "GRID MAPPER"}</b><span>STATIONARY OVERALL WAVEFORM · PINNED START / END{onAudition ? " · CLICK TO PLAY FROM THERE" : ""}</span></div><small>{beats} BEATS = {diagnostics.manualBpm.toFixed(3)} BPM</small></div>
    <div className="mix-window-zoom-controls"><button type="button" aria-label="Zoom waveform out" disabled={timelineZoom <= 1} onClick={() => changeTimelineZoom(-1)}>−</button><button type="button" aria-label="Zoom waveform in" disabled={timelineZoom >= 6} onClick={() => changeTimelineZoom(1)}>+</button></div>
    <div
      ref={timelineScroll}
      className="mix-window-timeline-scroll"
      onClick={timelineClick}
      onPointerDown={timelinePointerDown}
      onPointerMove={timelinePointerMove}
      onPointerUp={timelinePointerEnd}
      onPointerCancel={timelinePointerEnd}
      onWheel={(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        changeTimelineZoom(event.deltaY < 0 ? 1 : -1);
      }}
      onContextMenu={rightSelect ? (event) => event.preventDefault() : undefined}
    ><div className="mix-window-timeline" style={{ minWidth: `${timelineWidth}px` }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Selected Mix In window overall waveform with confirmed four-beat grid">
        <rect width={width} height={height} fill="#070a09" />
        {verification.filter((block) => block.end >= start && block.start <= end && block.status !== "verified").map((block, index) => <rect key={`verification-${index}`} x={x(Math.max(start, block.start))} width={Math.max(1, x(Math.min(end, block.end)) - x(Math.max(start, block.start)))} height={height} fill={block.status === "review" ? "#ff5a67" : "#89948f"} opacity={block.status === "review" ? .1 : .05} />)}
        {waveformPath && <path d={waveformPath} fill="#4cf2b4" opacity=".72" />}
        {/* Where this tune does NOT hold the low end, wash the wave red: the
            bass you can see is not the bass the room will hear. */}
        {automation && bassOwnershipSegments(automation.bassSwapBeats, automation.windowBeats)
          .filter((segment) => segment.owner !== (role === "incoming" ? "incoming" : "outgoing"))
          .map((segment) => <rect
            key={`bass-muted-${segment.startBeat}`}
            x={segment.startBeat / Math.max(1, beats) * width}
            width={Math.max(1, (segment.endBeat - segment.startBeat) / Math.max(1, beats) * width)}
            y="0"
            height={height}
            fill="#ff5a67"
            opacity=".22"
          />)}
        <line x1="0" x2={width} y1={middle} y2={middle} stroke="#29483d" />
        {showReferenceGrid && visibleBeats.map((beat, index) => <line key={`old-${index}`} x1={x(beat.time)} x2={x(beat.time)} y1="0" y2={height} stroke={beat.isDownbeat ? "#ffc857" : "#57645e"} strokeWidth={beat.isDownbeat ? 1.5 : .6} opacity={beat.isDownbeat ? .28 : .12} />)}
        {manualLines.map((index) => <line key={`manual-${index}`} x1={index / Math.max(1, beats) * width} x2={index / Math.max(1, beats) * width} y1="0" y2={height} stroke={index === 0 || index === beats ? "#ff4f98" : "#55a7ff"} strokeWidth={index === 0 || index === beats ? 4 : index % 16 === 0 ? 2.2 : 1.2} opacity={index === 0 || index === beats ? 1 : .72} />)}
        {automation && bassSwitch && <><line x1={bassSwitch.startBeat / Math.max(1, beats) * width} x2={bassSwitch.startBeat / Math.max(1, beats) * width} y1="0" y2={height} stroke="#ff9f43" strokeWidth="2" opacity=".72" /><line x1={bassSwitch.centreBeat / Math.max(1, beats) * width} x2={bassSwitch.centreBeat / Math.max(1, beats) * width} y1="0" y2={height} stroke="#ff9f43" strokeWidth="5" opacity="1" /><line x1={bassSwitch.endBeat / Math.max(1, beats) * width} x2={bassSwitch.endBeat / Math.max(1, beats) * width} y1="0" y2={height} stroke="#ff9f43" strokeWidth="2" opacity=".72" /><line x1={automation.bassSwapBeat / Math.max(1, beats) * width} x2={automation.bassSwapBeat / Math.max(1, beats) * width} y1="0" y2={height} stroke="#ffc857" strokeWidth="3" strokeDasharray="7 4" opacity="1" /></>}
        {/* REPLICATE: pasted passes, outlined where the wave now repeats. */}
        {replicateView && Array.from({ length: replicateView.plan.copies }, (_, pass) => {
          const length = replicateView.plan.blockEnd - replicateView.plan.blockStart;
          const passStart = replicateView.plan.blockEnd + pass * length;
          const passEnd = passStart + length;
          if (passEnd < start || passStart > end || !(length > 0)) return null;
          return <g key={`replica-pass-${pass}`}>
            <rect x={x(passStart)} width={Math.max(1, x(passEnd) - x(passStart))} height={height} fill="#4cf2b4" fillOpacity=".1" stroke="#4cf2b4" strokeWidth="2" strokeDasharray="10 6" />
            <text x={x(passStart) + 6} y="34" fill="#4cf2b4" fontSize="12" opacity=".9">REPLICA {pass + 1}</text>
          </g>;
        })}
        {/* REPLICATE selection: the block right-click is naming right now. */}
        {rightSelect && (rightDraft ?? rightSelect.span) && (() => {
          const selected = rightDraft ?? rightSelect.span!;
          if (selected.end < start || selected.start > end) return null;
          return <rect x={x(selected.start)} width={Math.max(1, x(selected.end) - x(selected.start))} height={height} fill="#ffd24c" fillOpacity={rightDraft ? .12 : .18} stroke="#ffd24c" strokeWidth="2" strokeDasharray="6 5" />;
        })()}
        {rightSelect && rightSelect.pending !== null && rightSelect.pending >= start && rightSelect.pending <= end && <line x1={x(rightSelect.pending)} x2={x(rightSelect.pending)} y1="0" y2={height} stroke="#ffd24c" strokeWidth="3" strokeDasharray="4 4" />}
        <text x="12" y="19" fill="#8fc5ff" fontSize="13">CONFIRMED GRID · EVERY MARKER = 4 BEATS</text>
        <text x="12" y={height - 10} fill="#ff4f98" fontSize="13">X = START</text>
        <text x={width - 90} y={height - 10} fill="#ff4f98" fontSize="13">Z = END</text>
        {audioRef && <OverviewPlayhead audioRef={audioRef} time={playheadTime} start={start} end={end} width={width} height={height} phaseColourRef={phaseColourRef} />}
      </svg>
      {automation && <svg
        className="mix-window-bass-lane"
        viewBox={`0 0 ${width} 30`}
        preserveAspectRatio="none"
        role="group"
        aria-label="Bass ownership across the overlap. Click a beat to cut the bassline there."
        onClick={(event) => {
          if (!onAutomationChange) return;
          // The lane lives inside the audition surface, so its clicks must not
          // also start playback from that point.
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width <= 0) return;
          const fraction = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
          const beatAt = Math.round(fraction * beats);
          const bassSwapBeats = toggleBassSwapBeat(automation.bassSwapBeats, automation.windowBeats, beatAt);
          onAutomationChange(normaliseAssistedOverlapAutomation({
            ...automation,
            bassSwapBeats,
            // The single cue must travel with the list; a spread cannot be told
            // apart by value alone.
            bassSwapBeat: bassSwapBeats[0] ?? automation.bassSwapBeat,
          }));
        }}
      >
        {bassOwnershipSegments(automation.bassSwapBeats, automation.windowBeats).map((segment) => <rect
          key={`bass-own-${segment.startBeat}`}
          x={segment.startBeat / Math.max(1, beats) * width}
          width={Math.max(1, (segment.endBeat - segment.startBeat) / Math.max(1, beats) * width)}
          y="0"
          height="30"
          fill={segment.owner === "outgoing" ? "#0f3a2c" : "#3a1016"}
        />)}
        {manualLines.map((index) => <line
          key={`bass-beat-${index}`}
          x1={index / Math.max(1, beats) * width}
          x2={index / Math.max(1, beats) * width}
          y1={index % 16 === 0 ? 0 : 18}
          y2="30"
          stroke={index % 16 === 0 ? "#55a7ff" : "#2c4a3f"}
          strokeWidth={index % 16 === 0 ? 1.5 : .75}
        />)}
        {automation.bassSwapBeats.map((swap) => <g key={`bass-cut-${swap}`}>
          <line
            x1={swap / Math.max(1, beats) * width}
            x2={swap / Math.max(1, beats) * width}
            y1="0"
            y2="30"
            stroke="#ffc857"
            strokeWidth="3"
          />
          <text
            x={swap / Math.max(1, beats) * width + 4}
            y="12"
            fill="#ffc857"
            fontSize="10"
          >{swap}</text>
        </g>)}
        <text x="6" y="24" fill="#a8ffdf" fontSize="10">OUT BASS</text>
        <text x={width - 6} y="24" fill="#ffb2b8" fontSize="10" textAnchor="end">IN BASS = RED</text>
      </svg>}
    </div></div>
    <div className="manual-grid-readouts">
      <span><small>CONFIRMED BPM · AUTHORITY</small><b>{diagnostics.manualBpm.toFixed(3)}</b><em>{diagnostics.beatDurationMs.toFixed(1)} ms / beat · gospel on save</em></span>
      <span><small>OLD CROWD BPM · REFERENCE</small><b>{diagnostics.crowdBpm > 0 ? diagnostics.crowdBpm.toFixed(3) : "UNKNOWN"}</b><em>{diagnostics.crowdBpm > 0 ? `${diagnostics.bpmCorrectionPercent >= 0 ? "+" : ""}${diagnostics.bpmCorrectionPercent.toFixed(2)}% correction` : "manual window becomes authority"}</em></span>
      <span><small>START VS OLD GRID</small><b>{offsetLabel(diagnostics.startOffsetMs)}</b><em>new cycle origin</em></span>
      <span><small>END VS OLD GRID</small><b>{offsetLabel(diagnostics.endOffsetMs)}</b><em>new beat {beats}</em></span>
      <span><small>OLD WINDOW EVIDENCE</small><b>{diagnostics.verificationStatus.toUpperCase()}</b><em>{diagnostics.mappedBeatsInWindow} beats · {diagnostics.alignedKicksInWindow} aligned kicks</em></span>
    </div>
    {diagnostics.hypotheses.length > 0 && <div className="manual-grid-hypotheses"><span>OLD TEMPO GUESSES · REFERENCE ONLY</span>{diagnostics.hypotheses.map((hypothesis, index) => <b key={`${hypothesis.bpm}-${index}`}>{hypothesis.bpm.toFixed(3)}<small>{hypothesis.probability === undefined ? hypothesis.metricalRelation ?? "alternative" : `${Math.round(hypothesis.probability * 100)}%`}</small></b>)}</div>}
    <p>Your confirmed beat count divided across the exact selected time becomes the authoritative BPM and grid. Pinch over the waveform, or use − / +, to inspect it more closely.</p>
  </section>;
}

export default function DjBooth() {
  const controlHelp = useControlHelpPreferences();
  const hotkeySetup = useHotkeyBindings();
  const hotkeysCurrent = useRef(hotkeySetup.bindings); hotkeysCurrent.current = hotkeySetup.bindings;
  const [controlSetupMode, setControlSetupMode] = useState<SetupMode>(null);
  const controlSetupModeCurrent = useRef(controlSetupMode); controlSetupModeCurrent.current = controlSetupMode;
  const [audioSetupOpen, setAudioSetupOpen] = useState(false);
  const audioSetupOpenCurrent = useRef(false); audioSetupOpenCurrent.current = audioSetupOpen;
  const [outputConfig, setOutputConfig] = useState<OutputConfig>({ ...DEFAULT_OUTPUT_CONFIG });
  const outputConfigCurrent = useRef(outputConfig);
  const hardwareOutputs = useRef<HardwareAudioOutputs | null>(null);
  const [outputFault, setOutputFault] = useState("");
  const outputChanging = useRef(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const recordTap = useRef<MediaStreamAudioDestinationNode | null>(null);
  const [recActive, setRecActive] = useState(false);
  const [recStatus, setRecStatus] = useState("");
  const [replayPickerOpen, setReplayPickerOpen] = useState(false);
  /**
   * GRID OVERRIDE (DJ, 29 Aug 2026, closing the Predator night): armed =
   * snap is OFF for that preview panel so the playhead can sit exactly where
   * the ear says the kick is; confirming re-phases the whole grid onto that
   * point and re-stamps the tune's kicks from the transient fingerprint at
   * the anchor. The ear is the landmark authority; the machine only finds
   * more of what the ear pointed at.
   */
  const [gridOverrideArmed, setGridOverrideArmed] = useState<Record<TransitionPreviewRole, boolean>>({ outgoing: false, incoming: false });
  const [gridOverrideBusy, setGridOverrideBusy] = useState(false);
  const [replicateBusy, setReplicateBusy] = useState(false);
  const [replaySets, setReplaySets] = useState<SetSummary[]>([]);
  const [replaySetsLoading, setReplaySetsLoading] = useState(false);
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>({ A: emptyDeck(), B: emptyDeck(), C: emptyDeck() });
  const [picker, setPicker] = useState<DeckId | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoadingTrackId, setPickerLoadingTrackId] = useState<string | null>(null);
  const [customLoopStarts, setCustomLoopStarts] = useState<Record<DeckId, number | null>>({ A: null, B: null, C: null });
  const [customLoopPurposes, setCustomLoopPurposes] = useState<Record<DeckId, ManualWindowPurpose | null>>({ A: null, B: null, C: null });
  const [fullIntroTracks, setFullIntroTracks] = useState<Record<DeckId, string | null>>({ A: null, B: null, C: null });
  const [cueUndo, setCueUndo] = useState<Record<DeckId, CueUndoSnapshot[]>>({ A: [], B: [], C: [] });
  const [loopTeachingStatus, setLoopTeachingStatus] = useState<Record<DeckId, string>>({ A: "", B: "", C: "" });
  // Each deck's current load, structured (see FocusWaveLoadState); the text status above stays for everything else.
  const [deckLoads, setDeckLoads] = useState<Record<DeckId, DeckLoad | null>>({ A: null, B: null, C: null });
  const deckLoadAttempts = useRef<Record<DeckId, number>>({ A: 0, B: 0, C: 0 });
  const [cueTeachingStatus, setCueTeachingStatus] = useState<Record<DeckId, string>>({ A: "", B: "", C: "" });
  const [overviewZoom, setOverviewZoom] = useState<Record<DeckId, number>>({ A: 1, B: 1, C: 1 });
  const [manualLoopDialog, setManualLoopDialog] = useState<ManualLoopDialog | null>(null);
  const [manualLoopSaving, setManualLoopSaving] = useState(false);
  const manualLoopSavingRef = useRef(false);
  const [cueUndoBusyDeck, setCueUndoBusyDeck] = useState<DeckId | null>(null);
  const cueUndoBusy = useRef(new Set<DeckId>());
  const [assistedChoiceLoadingTrackId, setAssistedChoiceLoadingTrackId] = useState<string | null>(null);
  const [masterVolume, setMasterVolume] = useState(.85);
  const [headphoneMonitor, setHeadphoneMonitor] = useState(DEFAULT_HEADPHONE_MONITOR);
  const [previewMonitor, setPreviewMonitor] = useState(false);
  const [preparedDemo, setPreparedDemo] = useState<PreparedDemo | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>("preparing");
  const demoModeCurrent = useRef<DemoMode>(demoMode);
  const [demoStatus, setDemoStatus] = useState("Choosing a mapped set and analysing its phrase cues");
  const [focusWindowSeconds, setFocusWindowSeconds] = useState<Record<DeckId, number>>({ A: 16, B: 16, C: 16 });
  const [crateAlbums, setCrateAlbums] = useState<CrateAlbum[]>([]);
  const [crateTrackCount, setCrateTrackCount] = useState(0);
  const [rememberedTrackCount, setRememberedTrackCount] = useState(0);
  const [liveMode, setLiveMode] = useState<LiveCrateMode>("loading");
  const [liveStatus, setLiveStatus] = useState("Reading the Elements album crate");
  const [liveDecisions, setLiveDecisions] = useState<string[]>([]);
  const [crateScan, setCrateScan] = useState<CrateScanState | null>(null);
  const [assistedMode, setAssistedMode] = useState<AssistedMode>("idle");
  const assistedModeCurrent = useRef<AssistedMode>(assistedMode);
  const [assistedSource, setAssistedSource] = useState<AssistedSource>("random");
  const [assistedStatus, setAssistedStatus] = useState("Tune 1 can be any random unused tune; BPM and grid analysis are advisory");
  const [kickPhaseStatus, setKickPhaseStatus] = useState("KICKS · ARMED FOR OVERLAP");
  const [assistedCueState, setAssistedCueState] = useState<AssistedCueState | null>(null);
  const [assistedPending, setAssistedPending] = useState<AssistedPending | null>(null);
  const [assistedDecisions, setAssistedDecisions] = useState<string[]>([]);
  const [assistedLaunchedOrder, setAssistedLaunchedOrder] = useState(-1);
  const [assistedOverlapAutomation, setAssistedOverlapAutomation] = useState<AssistedOverlapAutomation>(DEFAULT_ASSISTED_OVERLAP_AUTOMATION);
  const [assistedTrackOverlapAutomations, setAssistedTrackOverlapAutomations] = useState<Record<string, AssistedOverlapAutomation>>({});
  const [teachingProfile, setTeachingProfile] = useState<TeachingProfile | null>(null);
  const [libraryIntelligence, setLibraryIntelligence] = useState<LibraryIntelligenceStats>({ totalRecords: 0, bpmKnown: 0, fullScanned: 0, selections: 0, plays: 0, incompatiblePairs: 0 });
  const [crowdListeners, setCrowdListeners] = useState(0);
  const [crowdReactions, setCrowdReactions] = useState<CrowdReaction[]>([]);
  const [crowdPhoneUrl, setCrowdPhoneUrl] = useState("/crowd");
  const [crowdQrOpen, setCrowdQrOpen] = useState(false);
  // The QR encodes the LAN crowd URL; a relative "/crowd" (network route not
  // answered yet) would scan as garbage on a phone, so no QR until it's real.
  const crowdQrMarkup = useMemo(() => {
    if (!/^https?:\/\//.test(crowdPhoneUrl)) return "";
    try { return qrSvg(crowdPhoneUrl); } catch { return ""; }
  }, [crowdPhoneUrl]);
  const [visualDirection, setVisualDirection] = useState<BoothVisualDirection>("specialist");
  const [workflowDeck, setWorkflowDeck] = useState<DeckId>("A");
  const [workflowAutoselecting, setWorkflowAutoselecting] = useState(false);
  const [workflowResettingDeck, setWorkflowResettingDeck] = useState<DeckId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transitionPreview, setTransitionPreview] = useState<TransitionPreviewState | null>(null);
  // Temporary listening pass over the beat grids. A tick on every grid beat
  // fuses with the kick when the grid is right and flams when it has slipped,
  // which is the only way the ear can be asked about phase at all.
  const [gridCheckOpen, setGridCheckOpen] = useState(false);
  const [gridCheckItems, setGridCheckItems] = useState<GridCheckItem[]>([]);
  const [gridCheckVerdicts, setGridCheckVerdicts] = useState<Record<string, GridCheckRecord>>({});
  const [gridCheckCurrent, setGridCheckCurrent] = useState<GridCheckItem | null>(null);
  const [gridCheckStatus, setGridCheckStatus] = useState("");
  const gridCheckAudio = useRef<HTMLAudioElement>(null);
  const gridCheckStop = useRef<number | null>(null);
  const gridCheckTickNodes = useRef<AudioScheduledSourceNode[]>([]);
  /** The music's own gain, ducked briefly under each tick. */
  const gridCheckDuck = useRef<GainNode | null>(null);
  /**
   * A manual nudge on the ticks, in milliseconds.
   *
   * DJ hears the same small delay on tracks whose grids sit +19.9, -0.8 and
   * -8.5 ms from their detected kicks, so what he is hearing is not the grid — it
   * is a lag between the ticks and the audio. This project has found that before:
   * marks landed 40-180 ms out until playheads were made to follow the heard
   * sample rather than the media clock.
   *
   * Guessing the constant from AudioContext latency semantics is how the last five
   * detectors went wrong. This measures it instead: if one value makes every track
   * fuse, it is playback latency. If each track needs its own, it is the fit.
   */
  const [gridCheckNudgeMs, setGridCheckNudgeMs] = useState(0);
  const gridCheckMediaSource = useRef<MediaElementAudioSourceNode | null>(null);
  const [gridCheckOffset, setGridCheckOffset] = useState<{ shiftMs: number; confident: boolean; rivalShiftMs: number | null; improvement: number } | null>(null);
  const [transitionPreviewFocusSeconds, setTransitionPreviewFocusSeconds] = useState<Record<TransitionPreviewRole, number>>({ outgoing: 16, incoming: 16 });
  const fileInput = useRef<HTMLInputElement>(null);
  const fileLoadDeck = useRef<DeckId>("A");
  const audioA = useRef<HTMLAudioElement>(null);
  const audioB = useRef<HTMLAudioElement>(null);
  const audioC = useRef<HTMLAudioElement>(null);
  const shadowAudioA = useRef<HTMLAudioElement>(null);
  const shadowAudioB = useRef<HTMLAudioElement>(null);
  const shadowAudioC = useRef<HTMLAudioElement>(null);
  const transitionPreviewOutgoingAudio = useRef<HTMLAudioElement>(null);
  const transitionPreviewIncomingAudio = useRef<HTMLAudioElement>(null);
  const transitionPreviewGraphs = useRef<Partial<Record<TransitionPreviewRole, TransitionPreviewGraph>>>({});
  const transitionPreviewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionPreviewSaveInFlight = useRef(false);
  const transitionPreviewCueReturn = useRef<Partial<Record<TransitionPreviewRole, number>>>({});
  const transitionPreviewCueToken = useRef(0);
  const transitionPreviewOutgoingVisualTime = useRef<number | null>(null);
  const transitionPreviewIncomingVisualTime = useRef<number | null>(null);
  const localAudioUrls = useRef<Partial<Record<DeckId, string>>>({});
  const context = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const masterLimiter = useRef<DynamicsCompressorNode | null>(null);
  const cueMonitorMaster = useRef<GainNode | null>(null);
  const cueMonitorLimiter = useRef<DynamicsCompressorNode | null>(null);
  const previewMonitorMaster = useRef<GainNode | null>(null);
  const previewMonitorLimiter = useRef<DynamicsCompressorNode | null>(null);
  const crowdMaster = useRef<GainNode | null>(null);
  const crowdStreamDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const crowdPeers = useRef(new Map<string, RTCPeerConnection>());
  const crowdPeerStartedAt = useRef(new Map<string, number>());
  const crowdPendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const crowdBroadcasterId = useRef("");
  const graphs = useRef<Partial<Record<DeckId, AudioGraph>>>({});
  /**
   * The platter, one per deck.
   *
   * Connected to the deck's own `cueChannel`, so it inherits the routing that is
   * already there: audible only when that deck is cued and the headphones are
   * monitoring, never on the master. `scrubRouting` states that policy and this
   * is how it is enforced — by where the wire goes, not by a check that could be
   * forgotten.
   */
  const scrubNodes = useRef<Partial<Record<DeckId, AudioWorkletNode>>>({});
  const scrubModuleReady = useRef<Promise<void> | null>(null);
  const scrubLoadedTrack = useRef<Partial<Record<DeckId, string | undefined>>>({});
  /** True once the platter on that deck is holding the tune it was given. */
  const scrubReady = useRef<Partial<Record<DeckId, boolean>>>({});
  const sharedImpulse = useRef<AudioBuffer | null>(null);
  const pitchHolds = useRef<Partial<Record<DeckId, PitchHoldSession>>>({});
  const loopWrapPending = useRef<Record<DeckId, boolean>>({ A: false, B: false, C: false });
  const loopSeamError = useRef<Record<DeckId, number>>({ A: 0, B: 0, C: 0 });
  const loopCycleArmed = useRef<Record<DeckId, boolean>>({ A: false, B: false, C: false });
  const loopWrapTimers = useRef<Partial<Record<DeckId, ReturnType<typeof setTimeout>>>>({});
  const loopTransitionToken = useRef<Record<DeckId, number>>({ A: 0, B: 0, C: 0 });
  const lowBeforeKill = useRef<Record<DeckId, number>>({ A: 0, B: 0, C: 0 });
  /**
   * Configured bass keys (default 5/6/7) hold manual bass ownership over every automation stage, including
   * bass swaps and handoffs. Only another toggle, an explicit Low dial move,
   * or replacing/unloading the track releases it. Mid/high automation continues.
   */
  const liveBassOverride = useRef<Partial<Record<DeckId, "kill" | "live">>>({});
  const lastPlaying = useRef<DeckId[]>([]);
  const playbackCues = useRef<Partial<Record<DeckId, { trackId: string; time: number }>>>({});
  const playCueTokens = useRef<Record<DeckId, number>>({ A: 0, B: 0, C: 0 });
  const teachingSessionTrack = useRef<Record<DeckId, string | null>>({ A: null, B: null, C: null });
  const playCuePreviews = useRef<Partial<Record<DeckId, { time: number; audio: HTMLAudioElement; token: number }>>>({});
  const demoRuntime = useRef<DemoRuntime | null>(null);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const emergencyTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoToken = useRef(0);
  const liveToken = useRef(0);
  const liveRunning = useRef(false);
  const assistedToken = useRef(0);
  const assistedRunning = useRef(false);
  const assistedPlaying = useRef(false);
  const assistedOverlapAutomationCurrent = useRef<AssistedOverlapAutomation>(DEFAULT_ASSISTED_OVERLAP_AUTOMATION);
  const assistedTrackOverlapAutomationsCurrent = useRef<Record<string, AssistedOverlapAutomation>>({});
  const assistedReplaySnapshot = useRef<AssistedReplaySnapshot | null>(null);
  const liveOpenerCurrent = useRef<LiveOpener | null>(null);
  const liveSearchStarted = useRef(new Set<string>());
  const liveLockedOutgoing = useRef(new Map<string, LockedOutgoingCue>());
  const waveformScrubbing = useRef<Record<DeckId, boolean>>({ A: false, B: false, C: false });
  const waveformFocusRef = useRef<HTMLElement>(null);
  const workflowDeckCurrent = useRef<DeckId>("A");
  const cueUndoCurrent = useRef(cueUndo);
  const tempoReturns = useRef<Partial<Record<DeckId, TempoReturn>>>({});
  const usedCrateTracks = useRef(new Set<string>());
  const preparedDemoCurrent = useRef<PreparedDemo | null>(null);
  const screenWakeLock = useRef<ScreenWakeLock | null>(null);
  const decksCurrent = useRef(decks);
  workflowDeckCurrent.current = workflowDeck;
  cueUndoCurrent.current = cueUndo;
  const masterVolumeCurrent = useRef(masterVolume);
  const headphoneMonitorCurrent = useRef(headphoneMonitor);
  const previewMonitorCurrent = useRef(previewMonitor);
  // One colour PER playhead (DJ, 30 Aug 2026): green when the tunes are in
  // time; out of time, the slow head goes blue and the fast head goes red —
  // so each pinned window's line names its own tune's part in the flam.
  const transitionPreviewPhaseColourOutgoing = useRef<string | null>(null);
  const transitionPreviewPhaseColourIncoming = useRef<string | null>(null);
  /**
   * Hold-to-nudge on the pinned windows (DJ, 30 Aug 2026): a deck-style
   * pitch bend for the private players, so a flam the playheads paint red
   * and blue can be ridden back to green by ear. ±1.5% while held; the mix
   * loop applies it on its own tick and holds its 80 ms re-seek while a
   * bend is in the DJ's hand, or it would snap the correction straight
   * back out.
   */
  const transitionPreviewBend = useRef<{ role: TransitionPreviewRole; direction: -1 | 1 } | null>(null);
  const transitionPreviewBendFactor = (role: TransitionPreviewRole) => {
    const held = transitionPreviewBend.current;
    return held && held.role === role ? 1 + held.direction * .015 : 1;
  };
  /**
   * 6/7/8 bass kills follow the DJ into the preview (DJ, 30 Aug 2026):
   * with the studio open, the digit for a deck IN the pair kills that
   * PRIVATE player's low band — the live decks stay untouched — and a
   * digit for a deck outside the pair falls through to the booth as ever.
   * The mix loop honours a kill on every tick, so the automation cannot
   * hand the bass back until the DJ does.
   */
  const transitionPreviewBassKill = useRef<{ outgoing: boolean; incoming: boolean }>({ outgoing: false, incoming: false });
  const toggleTransitionPreviewBassKill = (role: TransitionPreviewRole) => {
    const next = !transitionPreviewBassKill.current[role];
    transitionPreviewBassKill.current[role] = next;
    // Immediate audible response on the low band ONLY — mid/high stay in
    // the automation's hands; the mix loop keeps honouring the kill each tick.
    const graph = transitionPreviewGraphs.current[role];
    if (graph && context.current) rampAudioParam(graph.low.gain, next ? -60 : 0, context.current.currentTime, .018);
    setTransitionPreview((current) => current ? { ...current, status: `${role === "outgoing" ? "MIX OUT" : "MIX IN"} bass ${next ? "KILLED" : "restored"} · private players only, live decks untouched` } : current);
    reportCrowdLiveEvent("preview.bass-kill", { role, killed: next });
  };
  const bendTransitionPreview = (role: TransitionPreviewRole, direction: -1 | 0 | 1) => {
    transitionPreviewBend.current = direction === 0 ? null : { role, direction };
    // A solo audition has no pacing loop, so the element is touched
    // directly; during a mix the loop reads the ref within a tick.
    const previewState = transitionPreviewCurrent.current;
    const element = transitionPreviewAudio(role);
    if (element && !element.paused && previewState?.audition === role) element.playbackRate = transitionPreviewBendFactor(role);
    if (direction !== 0) reportCrowdLiveEvent("preview.bend", { role, direction });
  };
  const transitionPreviewCurrent = useRef(transitionPreview);
  // Persist unapplied marks so a refresh or a rebuild never costs a re-cue.
  useEffect(() => {
    if (!transitionPreview) return;
    if (!transitionPreview.outgoingWindow.start && !transitionPreview.incomingWindow.start) return;
    const timer = window.setTimeout(() => saveTransitionPreviewDraft(transitionPreview), 400);
    return () => window.clearTimeout(timer);
  }, [transitionPreview]);
  const mediaRefs = { A: [audioA, shadowAudioA], B: [audioB, shadowAudioB], C: [audioC, shadowAudioC] };
  const activeMedia = useRef<Record<DeckId, 0 | 1>>({ A: 0, B: 0, C: 0 });
  const bufferedDecks = useRef<Partial<Record<DeckId,{trackId:string;transport:BufferedDeckTransport}>>>({});
  const bufferedCycles = useRef<Record<DeckId,number>>({A:0,B:0,C:0});
  const bufferJobs = useRef<Partial<Record<DeckId,Promise<void>>>>({});
  const activeAudio = (id: DeckId) => bufferedDecks.current[id]?.transport.media ?? mediaRefs[id][activeMedia.current[id]].current;
  const standbyAudio = (id: DeckId) => mediaRefs[id][activeMedia.current[id] === 0 ? 1 : 0].current;
  /**
   * Where every deck is, told to the server a few times a minute.
   *
   * DJ asked "where is the tune up to?" and the honest answer was that nothing
   * outside his browser knew. This writes each loaded deck's playhead into the
   * client-diagnostics log so the question is answerable after the fact — by a
   * person or by an assistant reading the log. Cheap on purpose: one line per
   * loaded deck every four seconds, only while a track is loaded.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      for (const id of DECK_IDS) {
        const deck = decksCurrent.current[id];
        if (!deck.track) continue;
        const audio = activeAudio(id);
        reportClientDiagnostic("deck-playhead", {
          deck: id,
          trackId: deck.track.id,
          name: deck.track.name,
          time: Math.round((audio?.currentTime ?? deck.currentTime) * 100) / 100,
          playing: deck.playing, rate: audio?.playbackRate ?? deck.tempoRate, loopStart: deck.loopStart, loopEnd: deck.loopEnd, loopActive: deck.loopActive,
        });
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);
  decksCurrent.current = decks;
  demoModeCurrent.current = demoMode;
  assistedModeCurrent.current = assistedMode;
  masterVolumeCurrent.current = masterVolume;
  headphoneMonitorCurrent.current = headphoneMonitor;
  previewMonitorCurrent.current = previewMonitor;
  transitionPreviewCurrent.current = transitionPreview;
  assistedOverlapAutomationCurrent.current = assistedOverlapAutomation;
  assistedTrackOverlapAutomationsCurrent.current = assistedTrackOverlapAutomations;
  const publishPreparedDemo = (prepared: PreparedDemo | null) => {
    preparedDemoCurrent.current = prepared;
    setPreparedDemo(prepared);
  };
  const assistedAutomationForTrack = (trackId: string, analysis?: Analysis | null) => {
    const saved = assistedTrackOverlapAutomationsCurrent.current[trackId];
    if (saved) return saved;
    const windowBeats = savedManualWindow(analysis ?? null, "intro-loop")?.beats;
    return windowBeats && isAssistedOverlapBeats(windowBeats)
      ? resizeAssistedOverlapAutomation(assistedOverlapAutomationCurrent.current, windowBeats)
      : assistedOverlapAutomationCurrent.current;
  };
  const saveAssistedOverlapAutomation = (next: AssistedOverlapAutomation, trackId?: string) => {
    const normalised = normaliseAssistedOverlapAutomation(next);
    assistedOverlapAutomationCurrent.current = normalised;
    setAssistedOverlapAutomation(normalised);
    localStorage.setItem(ASSISTED_OVERLAP_STORAGE_KEY, JSON.stringify(normalised));
    if (trackId) {
      const byTrack = { ...assistedTrackOverlapAutomationsCurrent.current, [trackId]: normalised };
      assistedTrackOverlapAutomationsCurrent.current = byTrack;
      setAssistedTrackOverlapAutomations(byTrack);
      localStorage.setItem(ASSISTED_TRACK_OVERLAPS_STORAGE_KEY, JSON.stringify(byTrack));
    }
  };
  const analysisPlaybackProtected = DECK_IDS.some((id) => decks[id].playing);
  // Section analysis is a ~90 second GPU job whose first stage is a full HTDemucs
  // separation, so it gets the same protection the library analyser already has:
  // whether anything is playing is known here and nowhere else, and the server
  // refuses to start a job without a fresh report of it.
  useEffect(() => setBoothIdle(!analysisPlaybackProtected), [analysisPlaybackProtected]);
  // Labels already computed always draw; this governs only whether loading a
  // tune asks for new ones.
  // On by default since 13 Aug: the cue is the beat at a chorus start, and the
  // choruses come from these labels. Without them a freshly loaded tune gets a
  // grid and no cue, which is half a feature.
  // DJ, 28 Aug 2026: sections are always on. The switch is gone, and so is
  // the stored "off" - no tune can load without asking for its labels.
  const sectionAutoAnalyse = true;
  useEffect(() => {
    setSectionAutoAnalyse(sectionAutoAnalyse);
    localStorage.setItem(SECTION_AUTO_ANALYSE_STORAGE_KEY, sectionAutoAnalyse ? "on" : "off");
  }, [sectionAutoAnalyse]);
  /**
   * Drum-stem grids, asked for as tunes are loaded.
   *
   * The same silence protection as SECTIONS, because the
   * expensive half is the same HTDemucs separation. What differs is what happens
   * to the result. A grid fitted to a tune's own kicks came back 33 clean of 42 by
   * ear, so it is applied where there is nothing to protect — no verdict, no
   * manual grid, inside the 12 ms flam line — and the server decides that, not
   * this. The cue it suggests is only ever reported: its chorus was right 13/13
   * both ways, its 32-beat phrase was not.
   */
  // Loading a tune is meant to grid it: stem, kicks, fit, apply.
  // DJ, 28 Aug 2026: the drum grid is always on - no switch, no stored "off".
  const drumAutoAnalyse = true;
  // Drum Stem Only was a 25-29 Aug test regime and is REMOVED (DJ, 30 Aug
  // 2026: "I haven't been using that button, so I don't think we need it").
  // Decks always load the full tune, the drawn waves are the full tune, and
  // the grids keep their own foundations — the stem→kicks→grid pipeline is
  // untouched by this; only deck playback and the header toggle are gone.
  const freshAnalysisWiped = useRef(new Set<string>());
  // DJ, 30 Aug 2026: "snap to grid on in booth generally, unless otherwise
  // turned off." ON is the standing state — a fresh browser starts snapped —
  // and the header switch is the one legitimate off. The preview keeps its
  // own snap rules (GRID OVERRIDE arming is its off-switch).
  const [gridSnap, setGridSnap] = useState(true);
  const gridSnapCurrent = useRef(true);
  useEffect(() => {
    const stored = localStorage.getItem(GRID_SNAP_STORAGE_KEY);
    if (stored === "off") setGridSnap(false);
  }, []);
  useEffect(() => {
    gridSnapCurrent.current = gridSnap;
    localStorage.setItem(GRID_SNAP_STORAGE_KEY, gridSnap ? "on" : "off");
  }, [gridSnap]);
  useEffect(() => {
    setDrumAutoAnalyse(drumAutoAnalyse);
    localStorage.setItem(DRUM_AUTO_ANALYSE_STORAGE_KEY, drumAutoAnalyse ? "on" : "off");
  }, [drumAutoAnalyse]);
  const [, setDrumGridRevision] = useState(0);
  useEffect(() => onDrumGridChanged(() => setDrumGridRevision((value) => value + 1)), []);
  // Labels arrive on their own schedule — a separate GPU pass — and the cue that
  // goes on the tune is the beat at a chorus start. So a tune held back for
  // having no choruses yet is asked about again as soon as it has some.
  const [sectionRevision, setSectionRevision] = useState(0);
  useEffect(() => onSectionLabelsChanged(() => setSectionRevision((value) => value + 1)), []);
  const drumCueSummary = (trackId: string) => {
    const cue = drumGridFor(trackId)?.cue;
    const anchor = (proposal: { candidates: Array<{ time: number; phraseOffset: number; onKick: boolean }> } | null | undefined) =>
      proposal?.candidates.find((candidate) => candidate.phraseOffset === 0) ?? proposal?.candidates[0] ?? null;
    const entry = anchor(cue?.mixIn);
    const exit = anchor(cue?.mixOut);
    if (!entry && !exit) return "";
    // Each one sits on a detected kick, not merely on the beat above it — and says
    // so when it could not, which means the beat it wants falls in a drum gap.
    const at = (candidate: { time: number; onKick: boolean }) =>
      `${preciseTimeLabel(candidate.time)}${candidate.onKick ? "" : " (no kick there — on the beat)"}`;
    const parts = [
      ...(entry ? [`mix-in ${at(entry)}`] : []),
      ...(exit ? [`mix-out ${at(exit)}`] : []),
    ];
    // Said as a suggestion, because it is one: the labels name the right chorus
    // and cannot place a boundary inside a 32-beat phrase.
    return ` · suggested ${parts.join(" · ")} — proposed only, not placed, and the phrase either side is an open question`;
  };
  const settleDrumGrid = async (id: DeckId, trackId: string) => {
    const outcome = await applyDrumGrid(trackId, !analysisPlaybackProtected, decksCurrent.current[id].analysis?.duration ?? 0);
    if (!outcome) return;
    const trackName = decksCurrent.current[id].track?.name ?? "That tune";
    const grid = drumGridFor(trackId)?.grid;
    const fit = grid
      ? `${grid.bpm.toFixed(2)} BPM · ${Math.round(grid.medianErrorMs)}ms median error · explains ${Math.round(grid.explains * 100)}% of ${grid.kicksDetected ?? 0} detected kicks`
      : "";
    const cued = outcome.cuesPlaced?.length ? ` · cues placed: ${outcome.cuesPlaced.join(" · ")}` : "";
    if (!outcome.applied) {
      setLoopTeachingStatus((current) => ({
        ...current,
        [id]: `${trackName} · drum grid held — ${outcome.because}${fit ? ` · the fit was ${fit}` : ""}. The mapped grid is unchanged.${cued}`,
      }));
    }
    if (!outcome.analysis) return;
    // Every deck holding this tune, not just the one that asked: two decks on the
    // same track must not end up drawing two different grids for it.
    const corrected = outcome.analysis as Analysis;
    const current = decksCurrent.current;
    const next: Record<DeckId, DeckState> = {
      A: current.A.track?.id === trackId ? { ...current.A, analysis: corrected } : current.A,
      B: current.B.track?.id === trackId ? { ...current.B, analysis: corrected } : current.B,
      C: current.C.track?.id === trackId ? { ...current.C, analysis: corrected } : current.C,
    };
    decksCurrent.current = next;
    setDecks(next);
    // The point of the whole settle for a deck nobody has touched yet: the
    // analysis now carries the auto-selected mix-in cue, so put the playhead
    // on it. The park guard refuses any deck the DJ has played or moved.
    for (const deckId of DECK_IDS) {
      if (next[deckId].track?.id === trackId) parkLoadedDeckAtCue(deckId, (() => { const cue = placedEntryCue(corrected); return cue === null ? null : seatCueOnGrid(corrected, cue); })());
    }
    if (outcome.applied) {
      setLoopTeachingStatus((current) => ({
        ...current,
        [id]: `${trackName} · drum grid applied · ${fit} · ${outcome.because}${cued}`,
      }));
    }
  };
  const cueRetryAfterSections = useRef(new Set<string>());
  const drumLoadedTrackIds = DECK_IDS.map((id) => decks[id].track?.id ?? "").join("|");
  useEffect(() => {
    if (!drumAutoAnalyse) return;
    // A browser-local file never reaches the server, so there is nothing to
    // separate and nothing to grid.
    const loaded = DECK_IDS
      .map((id) => ({ id, trackId: decksCurrent.current[id].track?.id ?? "" }))
      .filter((entry) => entry.trackId && !entry.trackId.startsWith("local-"));
    if (!loaded.length) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = async () => {
      let busy = false;
      for (const { id, trackId } of loaded) {
        if (!live) return;
        // Sections that arrive after a tune's first settle un-stick its cue
        // placement: that apply was cached from before there were labels to
        // cue from, so it placed nothing and the cache blocks the one that
        // could. Forget it once — once per track per session, because a tune
        // label-cue still cannot cue must not re-apply forever.
        const held = decksCurrent.current[id].analysis;
        if (held && drumApplyAttempted(trackId)
          && !held.teaching?.preferredEntryCue && !held.teaching?.preferredCue
          && sectionSpansFor(trackId).length > 0
          && !cueRetryAfterSections.current.has(trackId)) {
          cueRetryAfterSections.current.add(trackId);
          forgetDrumApply(trackId);
        }
        if (!drumGridFor(trackId)?.ready) {
          const status = await requestDrumAnalysis(trackId, !analysisPlaybackProtected, decksCurrent.current[id].analysis?.duration ?? 0);
          if (!live) return;
          busy = busy || (!!status && (status.running !== null || status.queued.length > 0));
        }
        if (drumGridFor(trackId)?.ready && !drumApplyAttempted(trackId)) {
          await settleDrumGrid(id, trackId);
          if (!live) return;
        }
      }
      // The poll is not impatience: each request carries whether the booth is
      // quiet, and the server will not start a separation on a stale report of it.
      if (busy) timer = setTimeout(() => void settle(), 4000);
    };
    void settle();
    return () => { live = false; if (timer) clearTimeout(timer); };
    // `analysisPlaybackProtected` is a dependency so a grid held while a deck was
    // playing is applied once the booth falls quiet, rather than at the next load.
  }, [drumLoadedTrackIds, drumAutoAnalyse, analysisPlaybackProtected, sectionRevision]);
  useEffect(() => {
    void fetch("/api/map", {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protectPlayback: analysisPlaybackProtected,
        warmModel: !analysisPlaybackProtected,
      }),
    }).catch(() => undefined);
  }, [analysisPlaybackProtected]);
  useEffect(() => {
    reportClientDiagnostic("dj-session-start");
    reportCrowdLiveEvent("session.started", {
      visibility: document.visibilityState,
      deckCount: DECK_IDS.length,
    });
    const onWindowError = (event: ErrorEvent) => reportClientDiagnostic("window-error", {
      ...diagnosticErrorDetails(event.error),
      message: event.message || diagnosticErrorDetails(event.error).message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
    const onUnhandledRejection = (event: PromiseRejectionEvent) => reportClientDiagnostic("unhandled-rejection", diagnosticErrorDetails(event.reason));
    const onVisibilityChange = () => reportCrowdLiveEvent("session.visibility", { visibility: document.visibilityState });
    const onPageHide = () => reportCrowdLiveEvent("session.page-hidden", { visibility: document.visibilityState });
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const preview = transitionPreviewCurrent.current;
      const runtime = demoRuntime.current;
      const deckSnapshot = Object.fromEntries(DECK_IDS.flatMap((id) => {
        const deck = decksCurrent.current[id];
        if (!deck.track) return [];
        const audio = activeAudio(id);
        return [[id, {
          trackId: deck.track.id,
          trackName: deck.track.name,
          statePlaying: deck.playing,
          mediaPaused: audio?.paused ?? true,
          mediaEnded: audio?.ended ?? false,
          currentTime: Number((audio?.currentTime ?? deck.currentTime).toFixed(3)),
          playbackRate: Number((audio?.playbackRate ?? deck.tempoRate).toFixed(6)),
          tempoRate: Number(deck.tempoRate.toFixed(6)),
          volume: Number(deck.volume.toFixed(4)),
          eq: { low: deck.low, mid: deck.mid, high: deck.high },
          readyState: audio?.readyState ?? 0,
          networkState: audio?.networkState ?? 0,
        }]];
      }));
      const previewPlayers = ([
        ["outgoing", transitionPreviewOutgoingAudio.current],
        ["incoming", transitionPreviewIncomingAudio.current],
      ] as const).flatMap(([role, audio]) => audio instanceof HTMLAudioElement && audio.dataset.previewSource ? [{
        role,
        paused: audio.paused,
        ended: audio.ended,
        currentTime: Number(audio.currentTime.toFixed(3)),
        playbackRate: Number(audio.playbackRate.toFixed(6)),
        readyState: audio.readyState,
        networkState: audio.networkState,
      }] : []);
      const hasActiveDeck = Object.values(deckSnapshot).some((value) => !(value as { mediaPaused: boolean }).mediaPaused);
      if (!hasActiveDeck && !preview?.audition && !runtime) return;
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      reportCrowdLiveEvent("state.snapshot", {
        visibility: document.visibilityState,
        audioContextState: context.current?.state ?? "not-created",
        monitors: { cue: headphoneMonitorCurrent.current, preview: previewMonitorCurrent.current },
        masterVolume: Number(masterVolumeCurrent.current.toFixed(4)),
        decks: deckSnapshot,
        preview: preview ? {
          audition: preview.audition,
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          players: previewPlayers,
        } : null,
        launch: runtime ? { stage: runtime.stage, transitionIndex: runtime.transitionIndex, busy: runtime.busy } : null,
        memory: memory ? {
          usedJsHeapMb: Math.round(memory.usedJSHeapSize / 1_048_576),
          jsHeapLimitMb: Math.round(memory.jsHeapSizeLimit / 1_048_576),
        } : null,
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    for (const url of Object.values(localAudioUrls.current)) URL.revokeObjectURL(url);
    transitionPreviewCueToken.current += 1;
    if (transitionPreviewTimer.current) clearInterval(transitionPreviewTimer.current);
    transitionPreviewTimer.current = null;
    for (const graph of Object.values(transitionPreviewGraphs.current)) {
      graph?.source.disconnect();
      graph?.low.disconnect();
      graph?.mid.disconnect();
      graph?.high.disconnect();
      graph?.output.disconnect();
    }
    transitionPreviewGraphs.current = {};
    for (const audio of [transitionPreviewOutgoingAudio.current, transitionPreviewIncomingAudio.current]) {
      if (!audio) continue;
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.previewSource;
      audio.load();
    }
  }, []);
  useEffect(() => {
    const syncBoothWidth = () => {
      if (window.matchMedia("(min-width: 1000px)").matches) {
        const usableViewportWidth = document.documentElement.clientWidth;
        document.documentElement.style.setProperty("--booth-layout-width", `${usableViewportWidth / .8 - 30}px`);
      } else {
        document.documentElement.style.removeProperty("--booth-layout-width");
      }
    };
    syncBoothWidth();
    const viewportObserver = new ResizeObserver(syncBoothWidth);
    viewportObserver.observe(document.documentElement);
    window.addEventListener("resize", syncBoothWidth);
    return () => {
      viewportObserver.disconnect();
      window.removeEventListener("resize", syncBoothWidth);
      document.documentElement.style.removeProperty("--booth-layout-width");
    };
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem(ASSISTED_OVERLAP_STORAGE_KEY);
    if (!stored) return;
    try {
      const restored = normaliseAssistedOverlapAutomation(JSON.parse(stored));
      assistedOverlapAutomationCurrent.current = restored;
      setAssistedOverlapAutomation(restored);
    } catch {
      localStorage.removeItem(ASSISTED_OVERLAP_STORAGE_KEY);
    }
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem(ASSISTED_TRACK_OVERLAPS_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid saved mix map");
      const restored = Object.fromEntries(Object.entries(parsed).map(([trackId, automation]) => [
        trackId,
        normaliseAssistedOverlapAutomation(automation),
      ]));
      assistedTrackOverlapAutomationsCurrent.current = restored;
      setAssistedTrackOverlapAutomations(restored);
    } catch {
      localStorage.removeItem(ASSISTED_TRACK_OVERLAPS_STORAGE_KEY);
    }
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem(BOOTH_VISUAL_DIRECTION_STORAGE_KEY);
    if (BOOTH_VISUAL_DIRECTIONS.some((direction) => direction.id === stored)) {
      setVisualDirection(stored as BoothVisualDirection);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(BOOTH_VISUAL_DIRECTION_STORAGE_KEY, visualDirection);
  }, [visualDirection]);

  const restoreLoopGate = (id: DeckId, duration = .014) => {
    const graph = graphs.current[id];
    if (!graph || !context.current) return;
    rampAudioParam(graph.loopGate.gain, 1, context.current.currentTime, duration);
    rampAudioParam(graph.cueLoopGate.gain, 1, context.current.currentTime, duration);
  };
  const cancelLoopTransition = (id: DeckId) => {
    loopSeamError.current[id] = 0;
    loopTransitionToken.current[id] += 1;
    if (loopWrapTimers.current[id]) clearTimeout(loopWrapTimers.current[id]);
    delete loopWrapTimers.current[id];
    loopWrapPending.current[id] = false;
    standbyAudio(id)?.pause();
    const graph = graphs.current[id];
    if (graph && context.current) {
      const active = activeMedia.current[id];
      rampAudioParam(graph.mainInput.gain, !bufferedDecks.current[id] && active === 0 ? 1 : 0, context.current.currentTime, .012);
      rampAudioParam(graph.shadowInput.gain, !bufferedDecks.current[id] && active === 1 ? 1 : 0, context.current.currentTime, .012);
    }
    restoreLoopGate(id);
  };
  const prepareLoopStandby = (id: DeckId, time?: number) => {
    if(bufferedDecks.current[id])return;
    const standby = standbyAudio(id);
    const active = activeAudio(id);
    const deck = decksCurrent.current[id];
    const requestedTime = time ?? deck.loopStart;
    if (!standby || requestedTime === null || requestedTime === undefined) return;
    standby.pause();
    standby.playbackRate = active?.playbackRate ?? deck.tempoRate;
    const isLoopStart = deck.loopActive && deck.loopStart !== null && Math.abs(requestedTime - deck.loopStart) <= .001;
    // Buffer a short muted run-up before a live loop boundary. The standby is
    // already moving when its gain opens, instead of seeking as it becomes audible.
    const target = Math.max(0, requestedTime - (isLoopStart ? .08 * standby.playbackRate + loopSeamError.current[id] : 0));
    const place = () => { if (Math.abs(standby.currentTime - target) > .025) standby.currentTime = target; };
    if (standby.readyState >= 1) place();
    else standby.addEventListener("loadedmetadata", place, { once: true });
  };
  const crossfadeToStandby = (id: DeckId, targetTime: number, expectedLoop?: { start: number; end: number }) => {
    if (loopWrapPending.current[id]) return;
    const current = activeAudio(id);
    const standby = standbyAudio(id);
    const graph = graphs.current[id];
    const audioContext = context.current;
    // Never rescue a live loop by seeking the audible player. If its standby
    // path is unavailable, leave the current player alone and retry next frame.
    if (!current || !standby || !graph || !audioContext) return;
    loopWrapPending.current[id] = true;
    const token = ++loopTransitionToken.current[id];
    const requestedAt = performance.now();
    standby.playbackRate = current.playbackRate;
    const initialLead = expectedLoop ? clamp((expectedLoop.end - current.currentTime) / Math.max(.25, current.playbackRate), 0, .1) : 0;
    const standbyStart = expectedLoop ? loopStandbyPosition(expectedLoop.start, expectedLoop.end, current.currentTime, loopSeamError.current[id]) : targetTime;
    const needsSeek = Math.abs(standby.currentTime - standbyStart) > .025;
    const beginCrossfade = () => void standby.play().then(() => {
      if (token !== loopTransitionToken.current[id]) { standby.pause(); return; }
      const latest = decksCurrent.current[id];
      if (expectedLoop && (!latest.loopActive || latest.loopStart === null || latest.loopEnd === null || Math.abs(latest.loopStart - expectedLoop.start) > .001 || Math.abs(latest.loopEnd - expectedLoop.end) > .001)) {
        standby.pause(); loopWrapPending.current[id] = false; return;
      }
      const nextActive: 0 | 1 = activeMedia.current[id] === 0 ? 1 : 0;
      const now = audioContext.currentTime;
      const lead = expectedLoop ? clamp((expectedLoop.end - current.currentTime) / Math.max(.25, current.playbackRate), 0, .1) : 0;
      const expectedStandbyTime = expectedLoop ? loopStandbyPosition(expectedLoop.start, expectedLoop.end, current.currentTime, loopSeamError.current[id]) : targetTime;
      if (Math.abs(standby.currentTime - expectedStandbyTime) > .025) standby.currentTime = expectedStandbyTime;
      const readyAt = performance.now();
      if (expectedLoop) reportClientDiagnostic("loop-seam-ready", { deck: id, token, start: expectedLoop.start, end: expectedLoop.end, rate: current.playbackRate, currentTime: current.currentTime, standbyTime: standby.currentTime, expectedStandbyTime, seeking: standby.seeking, readyState: standby.readyState, lead, prepareMs: readyAt - requestedAt });
      const fadeStart = now + lead;
      const fadeDuration = .05;
      rampAudioParam(graph.mainInput.gain, nextActive === 0 ? 1 : 0, fadeStart, fadeDuration);
      rampAudioParam(graph.shadowInput.gain, nextActive === 1 ? 1 : 0, fadeStart, fadeDuration);
      loopWrapTimers.current[id] = setTimeout(() => {
        delete loopWrapTimers.current[id];
        if (token !== loopTransitionToken.current[id]) return;
        if (expectedLoop) loopSeamError.current[id] += standby.currentTime - (current.currentTime - (expectedLoop.end - expectedLoop.start));
        if (expectedLoop) reportClientDiagnostic("loop-seam-switch", { deck: id, token, start: expectedLoop.start, end: expectedLoop.end, rate: current.playbackRate, currentTime: current.currentTime, standbyTime: standby.currentTime, seamErrorMs: (standby.currentTime - (current.currentTime - (expectedLoop.end - expectedLoop.start))) / current.playbackRate * 1000, accumulatedErrorMs: loopSeamError.current[id] / current.playbackRate * 1000, switchMs: performance.now() - requestedAt, contextTime: audioContext.currentTime });
        current.pause();
        activeMedia.current[id] = nextActive;
        loopWrapPending.current[id] = false;
        loopCycleArmed.current[id] = decksCurrent.current[id].loopActive;
        prepareLoopStandby(id, decksCurrent.current[id].loopStart ?? targetTime);
      }, Math.ceil((lead + fadeDuration + .012) * 1000));
    }).catch(() => {
      if (token !== loopTransitionToken.current[id]) return;
      loopWrapPending.current[id] = false;
      loopCycleArmed.current[id] = true;
      prepareLoopStandby(id, targetTime);
    });
    let started = false;
    const beginWhenReady = () => {
      if (started || token !== loopTransitionToken.current[id]) return;
      if (standby.readyState < 3) return;
      started = true;
      standby.removeEventListener("seeked", beginWhenReady);
      standby.removeEventListener("canplay", beginWhenReady);
      beginCrossfade();
    };
    if (needsSeek) standby.addEventListener("seeked", beginWhenReady, { once: true });
    standby.addEventListener("canplay", beginWhenReady, { once: true });
    if (needsSeek) standby.currentTime = standbyStart;
    if (!standby.seeking && standby.readyState >= 3) queueMicrotask(beginWhenReady);
    setTimeout(() => {
      if (started || token !== loopTransitionToken.current[id]) return;
      standby.removeEventListener("seeked", beginWhenReady);
      standby.removeEventListener("canplay", beginWhenReady);
      loopWrapPending.current[id] = false;
      loopCycleArmed.current[id] = true;
      prepareLoopStandby(id, targetTime);
    }, 160);
  };
  const softLoopBoundary = (id: DeckId, audio: HTMLAudioElement, deck: DeckState) => {
    const buffered=bufferedDecks.current[id]?.transport;
    if(buffered){const clock=buffered.clock;if(clock.cycle!==bufferedCycles.current[id]){bufferedCycles.current[id]=clock.cycle;reportClientDiagnostic("loop-buffer-wrap",{deck:id,...clock});}return;}
    if (!deck.loopActive || deck.loopStart === null || deck.loopEnd === null || loopWrapPending.current[id]) return;
    const nowInTrack = audio.currentTime;
    if (nowInTrack < deck.loopStart - .05) { loopCycleArmed.current[id] = true; return; }
    if (nowInTrack <= deck.loopEnd + .12) loopCycleArmed.current[id] = true;
    if (!loopCycleArmed.current[id]) return;
    const realSecondsUntilEnd = (deck.loopEnd - nowInTrack) / Math.max(.25, audio.playbackRate);
    if (realSecondsUntilEnd > .08) return;
    loopCycleArmed.current[id] = false;
    crossfadeToStandby(id, deck.loopStart, { start: deck.loopStart, end: deck.loopEnd });
  };
  const softLoopSeek = (id: DeckId, time: number) => {
    const audio = activeAudio(id);
    if (!audio) return;
    if(bufferedDecks.current[id]){audio.currentTime=time;return;}
    cancelLoopTransition(id);
    if (audio.paused) { audio.currentTime = time; prepareLoopStandby(id); return; }
    crossfadeToStandby(id, time);
  };

  useEffect(() => {
    if (picker === null) setPickerSearch("");
  }, [picker]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const payload = await fetch("/api/map", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Crate returned ${response.status}`);
        return response.json() as Promise<{ tracks: Track[] }>;
      });
      if (cancelled) return;
      setTracks(payload.tracks);
      void fetch("/api/network", { cache: "no-store" })
        .then((response) => response.json() as Promise<{ crowdUrl?: string | null }>)
        .then((network) => { if (!cancelled && network.crowdUrl) setCrowdPhoneUrl(network.crowdUrl); })
        .catch(() => undefined);
      void fetch("/api/dj-library/intelligence", { cache: "no-store" })
        .then((response) => response.json() as Promise<{ stats?: LibraryIntelligenceStats }>)
        .then((memory) => { if (!cancelled && memory.stats) setLibraryIntelligence(memory.stats); })
        .catch(() => undefined);
      const profileTrack = payload.tracks.find((track) => track.mapped);
      if (profileTrack) void fetch(`/api/dj-library/teaching?id=${encodeURIComponent(profileTrack.id)}`, { cache: "no-store" })
        .then((response) => response.json() as Promise<{ profile?: TeachingProfile }>)
        .then((teaching) => { if (!cancelled && teaching.profile) setTeachingProfile(teaching.profile); })
        .catch(() => undefined);
      if (localStorage.getItem("crowd2-deck-reset-revision") !== DECK_RESET_REVISION) {
        localStorage.removeItem("crowd2-loaded-tracks");
        localStorage.setItem("crowd2-deck-reset-revision", DECK_RESET_REVISION);
      }
      const saved = JSON.parse(localStorage.getItem("crowd2-loaded-tracks") ?? "{}") as Partial<Record<DeckId, string>>;
      const requested = new URLSearchParams(window.location.search);
      const requestedTracks: Partial<Record<DeckId, string>> = {
        A: requested.get("deckA") ?? undefined,
        B: requested.get("deckB") ?? undefined,
        C: requested.get("deckC") ?? undefined,
      };
      const requestedAssistedOpener = requested.get("assistedOpener") === "1";
      const restoredSession = requestedAssistedOpener ? null : parseAssistedSessionSnapshot(localStorage.getItem(ASSISTED_SESSION_STORAGE_KEY));
      // Decks are restored one after another; a deck still waiting its turn says so, naming the deck ahead.
      const restoring = DECK_IDS.flatMap((id) => {
        const track = payload.tracks.find((item) => item.id === (requestedTracks[id] ?? saved[id]));
        return track ? [{ id, track }] : [];
      });
      if (!cancelled && restoring.length > 1) {
        setLoopTeachingStatus((current) => {
          const next = { ...current };
          restoring.slice(1).forEach((entry, index) => { next[entry.id] = `Waiting to restore ${entry.track.name} · Deck ${restoring[index].id} is loading first`; });
          return next;
        });
      }
      for (const id of DECK_IDS) {
        const requestedTrackId = requestedTracks[id];
        const trackId = requestedTrackId ?? saved[id];
        const track = payload.tracks.find((item) => item.id === trackId);
        if (!track) continue;
        if (!cancelled) {
          const restoreAssistedWindows = Boolean(restoredSession
            && (
              track.id === restoredSession.trackId
              || track.id === restoredSession.selection.previousTrackId
              || restoredSession.source === "loaded" && saved[id] === track.id
            ));
          await loadTrack(id, track, undefined, restoreAssistedWindows, true);
          if (id === "A" && requestedTrackId && requestedAssistedOpener) {
            const loadedAnalysis = decksCurrent.current.A.analysis;
            if (loadedAnalysis) {
              assistedRunning.current = true;
              activateLoadedAssistedChoice({
                order: 0,
                deck: "A",
                track,
                analysis: loadedAnalysis,
                selection: {
                  selectedBpm: trackSelectionBpm(loadedAnalysis),
                  previousTrackId: null,
                  previousTrackName: null,
                  previousBpm: null,
                },
              });
              setAssistedDecisions([`DIRECT OPENER · ${track.name} · Deck A · assisted preparation restored`]);
            }
          }
        }
      }
      if (!requestedAssistedOpener) {
        const restored = restoredSession;
        const restoredTrack = restored ? payload.tracks.find((track) => track.id === restored.trackId) : null;
        const restoredAnalysis = restored ? decksCurrent.current[restored.deck].analysis : null;
        if (restored && restoredTrack && restoredAnalysis && decksCurrent.current[restored.deck].track?.id === restored.trackId) {
          const cueState: AssistedCueState = {
            order: restored.order,
            deck: restored.deck,
            track: restoredTrack,
            mixInRequired: restored.mixInRequired,
            mixInSet: restored.mixInSet,
            mixOutSet: restored.mixOutSet,
            introPrepSkipped: restored.introPrepSkipped,
            selection: restored.selection,
          };
          assistedRunning.current = true;
          assistedPlaying.current = false;
          setAssistedSource(restored.source);
          usedCrateTracks.current = new Set(DECK_IDS.flatMap((deckId) => {
            const loadedId = decksCurrent.current[deckId].track?.id;
            return loadedId ? [loadedId] : [];
          }));
          setAssistedLaunchedOrder(restored.launchedOrder);
          setAssistedCueState(cueState);
          setAssistedMode(assistedSessionReady(restored) ? "ready" : "awaiting-cues");
          setAssistedStatus(`${restoredTrack.name} · assisted preparation restored${restored.wasPlaying ? " after playback was stopped" : ""}`);
          setAssistedDecisions([`RESTORED · ${restoredTrack.name} · Deck ${restored.deck} · manual run-up preparation kept`]);
        }
      }
      if (requestedTracks.A || requestedTracks.B || requestedTracks.C || requestedAssistedOpener) {
        requested.delete("deckA");
        requested.delete("deckB");
        requested.delete("deckC");
        requested.delete("assistedOpener");
        const query = requested.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : "the crate could not be opened";
      setAssistedStatus(`Library unavailable · ${detail}`);
      setLoopTeachingStatus({
        A: `Library unavailable · ${detail}`,
        B: `Library unavailable · ${detail}`,
        C: `Library unavailable · ${detail}`,
      });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => void fetch(`/api/crate-scan?v=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<CrateScanState>)
      .then((state) => {
        if (cancelled) return;
        setCrateScan(state);
        timer = setTimeout(refresh, state.status === "running" ? 2000 : 10_000);
      })
      .catch(() => {
        if (!cancelled) timer = setTimeout(refresh, 10_000);
      });
    refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (assistedCueState) {
      localStorage.setItem(ASSISTED_SESSION_STORAGE_KEY, JSON.stringify(createAssistedSessionSnapshot({
        source: assistedSource,
        order: assistedCueState.order,
        deck: assistedCueState.deck,
        trackId: assistedCueState.track.id,
        mixInRequired: assistedCueState.mixInRequired,
        mixInSet: assistedCueState.mixInSet,
        mixOutSet: assistedCueState.mixOutSet,
        introPrepSkipped: assistedCueState.introPrepSkipped,
        selection: assistedCueState.selection,
        launchedOrder: assistedLaunchedOrder,
        wasPlaying: assistedMode === "playing",
      })));
    }
    if (crateScan?.status !== "running") {
      void screenWakeLock.current?.release();
      screenWakeLock.current = null;
      return;
    }
    let cancelled = false;
    const acquire = () => {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLock> } }).wakeLock;
      if (!wakeLock || document.visibilityState !== "visible" || screenWakeLock.current && !screenWakeLock.current.released) return;
      void wakeLock.request("screen").then((lock) => { if (cancelled) void lock.release(); else screenWakeLock.current = lock; }).catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", acquire); void screenWakeLock.current?.release(); screenWakeLock.current = null; };
  }, [crateScan?.status, assistedCueState, assistedLaunchedOrder, assistedMode, assistedSource]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLiveMode("loading");
      const crate = await fetch("/api/crate", { cache: "no-store" }).then((response) => response.json()) as { connected: boolean; trackCount: number; rememberedTrackCount: number; albums: CrateAlbum[] };
      if (!crate.connected) throw new Error("Elements is not connected or its catalogue is empty");
      if (cancelled) return;
      setCrateAlbums(crate.albums);
      setCrateTrackCount(crate.trackCount);
      setRememberedTrackCount(crate.rememberedTrackCount);
      setLiveMode("idle");
      setLiveStatus(`${crate.trackCount.toLocaleString()} tracks indexed · press Start Live Crate Set to make the first choice`);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setLiveMode("error");
      setLiveStatus(error instanceof Error ? error.message : "The Elements crate could not be read");
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (liveMode === "loading" || liveMode === "idle" || liveMode === "error") return;
    const frame = requestAnimationFrame(() => waveformFocusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [liveMode]);
  useEffect(() => {
    let frame = 0;
    let lastVisualUpdate = 0;
    const tick = (timestamp: number) => {
      const returningRates: Partial<Record<DeckId, number>> = {};
      const completedReturns: DeckId[] = [];
      for (const id of DECK_IDS) {
        const audio = activeAudio(id);
        const deck = decksCurrent.current[id];
        if (audio && deck.playing && !playCuePreviews.current[id]) softLoopBoundary(id, audio, deck);
        const tempoReturn = tempoReturns.current[id];
        if (audio && deck.playing && tempoReturn && timestamp - tempoReturn.lastAppliedAt >= 200) {
          tempoReturn.lastAppliedAt = timestamp;
          const rate = naturalTempoRate(tempoReturn.startRate, tempoReturn.startTrackTime, tempoReturn.endTrackTime, audio.currentTime);
          mediaRefs[id].forEach((mediaRef) => { if (mediaRef.current) mediaRef.current.playbackRate = rate; });
          returningRates[id] = rate;
          if (audio.currentTime >= tempoReturn.endTrackTime || Math.abs(rate - 1) < .00005) completedReturns.push(id);
        }
      }
      // Audio remains sample-timed by Web Audio. Repainting the three waveform
      // decks at roughly 15fps preserves readable motion while leaving CPU/GPU
      // headroom for decoding, time-stretch and analysis.
      if (timestamp - lastVisualUpdate < BOOTH_VISUAL_FRAME_MS) { frame = requestAnimationFrame(tick); return; }
      lastVisualUpdate = timestamp;
      setDecks((current) => {
        const updateTime = (id: DeckId, deck: DeckState, audio: HTMLAudioElement | null) => {
          if (!audio || !deck.playing || waveformScrubbing.current[id]) return deck;
          const currentTime = boothVisualTrackTime(audio.currentTime, deck.analysis?.duration ?? audio.duration);
          const tempoRate = returningRates[id] ?? deck.tempoRate;
          if (Math.abs(currentTime - deck.currentTime) < .004 && tempoRate === deck.tempoRate) return deck;
          return { ...deck, currentTime, tempoRate };
        };
        const next = {
          A: updateTime("A", current.A, activeAudio("A")),
          B: updateTime("B", current.B, activeAudio("B")),
          C: updateTime("C", current.C, activeAudio("C")),
        };
        if (next.A === current.A && next.B === current.B && next.C === current.C) return current;
        decksCurrent.current = next;
        return next;
      });
      for (const id of completedReturns) delete tempoReturns.current[id];
      frame = requestAnimationFrame(tick);
    };
    if (decks.A.playing || decks.B.playing || decks.C.playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [decks.A.playing, decks.B.playing, decks.C.playing]);
  useEffect(() => () => {
    Object.values(pitchHolds.current).forEach((session) => session && cancelAnimationFrame(session.frame));
    pitchHolds.current = {};
    Object.values(loopWrapTimers.current).forEach((timer) => clearTimeout(timer));
    if (demoTimer.current) clearInterval(demoTimer.current);
    for (const id of DECK_IDS) mediaRefs[id].forEach((mediaRef) => mediaRef.current?.pause());
    if (context.current?.state === "running") void context.current.suspend();
  }, []);
  useEffect(() => {
    const cancelPitchHolds = () => DECK_IDS.forEach((id) => endPitchHold(id, false));
    const cancelHiddenPitchHolds = () => { if (document.visibilityState === "hidden") cancelPitchHolds(); };
    window.addEventListener("blur", cancelPitchHolds);
    window.addEventListener("pagehide", cancelPitchHolds);
    document.addEventListener("visibilitychange", cancelHiddenPitchHolds);
    return () => {
      window.removeEventListener("blur", cancelPitchHolds);
      window.removeEventListener("pagehide", cancelPitchHolds);
      document.removeEventListener("visibilitychange", cancelHiddenPitchHolds);
    };
  }, []);

  const makeImpulse = (audioContext: BaseAudioContext) => {
    if (sharedImpulse.current) return sharedImpulse.current;
    const buffer = audioContext.createBuffer(2, Math.round(audioContext.sampleRate * .8), audioContext.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) for (let index = 0; index < buffer.length; index += 1) buffer.getChannelData(channel)[index] = (Math.random() * 2 - 1) * (1 - index / buffer.length) ** 2;
    sharedImpulse.current = buffer;
    return sharedImpulse.current;
  };
  const routeActiveEffect = (graph: AudioGraph, nextFx: FxType) => {
    if (graph.activeFx === nextFx) return;
    const nodeFor = (fx: FxType): AudioNode | null => fx === "echo" ? graph.echo : fx === "reverb" ? graph.reverb : fx === "phaser" ? graph.phaser : fx === "drive" ? graph.drive : null;
    const previousNode = nodeFor(graph.activeFx);
    if (previousNode) { try { graph.high.disconnect(previousNode); } catch { /* already disconnected */ } }
    const nextNode = nodeFor(nextFx);
    if (nextFx === "reverb" && !graph.reverb.buffer) graph.reverb.buffer = makeImpulse(graph.reverb.context);
    if (nextNode) graph.high.connect(nextNode);
    graph.activeFx = nextFx;
  };
  const ensureMasterOutputs = () => {
    const audioContext = context.current ??= new AudioContext({ latencyHint: BOOTH_OUTPUT_LATENCY_HINT });
    // Shared-output mode records the selected local mix. Independent DJ output
    // mode records master only; headphone cue and Preview stay private.
    const roomTap = recordTap.current ??= audioContext.createMediaStreamDestination();
    if (!hardwareOutputs.current) {
      hardwareOutputs.current = new HardwareAudioOutputs(audioContext, undefined, setOutputFault);
      hardwareOutputs.current.recording.connect(roomTap);
      if (independentOutputs(outputConfigCurrent.current)) hardwareOutputs.current.failClosed();
    }
    const outputs = hardwareOutputs.current;
    if (!master.current) {
      master.current = audioContext.createGain();
      master.current.gain.value = masterVolumeCurrent.current;
      masterLimiter.current = audioContext.createDynamicsCompressor();
      masterLimiter.current.threshold.value = BOOTH_LIMITER.threshold;
      masterLimiter.current.knee.value = BOOTH_LIMITER.knee;
      masterLimiter.current.ratio.value = BOOTH_LIMITER.ratio;
      masterLimiter.current.attack.value = BOOTH_LIMITER.attack;
      masterLimiter.current.release.value = BOOTH_LIMITER.release;
      // DJ, 27 Aug 2026: -3 dB trim after the limiter — Chrome's compressor
      // overshoots with makeup gain (+1.87 dBFS true peaks recorded at gig
      // level), so the DAC needs explicit headroom after every limiter.
      const masterTrim = audioContext.createGain();
      masterTrim.gain.value = BOOTH_OUTPUT_TRIM_GAIN;
      master.current.connect(masterLimiter.current);
      masterLimiter.current.connect(masterTrim);
      masterTrim.connect(outputs.master);
    }
    if (!cueMonitorMaster.current) {
      cueMonitorMaster.current = audioContext.createGain();
      cueMonitorMaster.current.gain.value = independentOutputs(outputConfigCurrent.current) ? 1 : masterVolumeCurrent.current;
      cueMonitorLimiter.current = audioContext.createDynamicsCompressor();
      cueMonitorLimiter.current.threshold.value = BOOTH_LIMITER.threshold;
      cueMonitorLimiter.current.knee.value = BOOTH_LIMITER.knee;
      cueMonitorLimiter.current.ratio.value = BOOTH_LIMITER.ratio;
      cueMonitorLimiter.current.attack.value = BOOTH_LIMITER.attack;
      cueMonitorLimiter.current.release.value = BOOTH_LIMITER.release;
      const cueTrim = audioContext.createGain();
      cueTrim.gain.value = BOOTH_OUTPUT_TRIM_GAIN;
      cueMonitorMaster.current.connect(cueMonitorLimiter.current);
      cueMonitorLimiter.current.connect(cueTrim);
      cueTrim.connect(outputs.cue);
    }
    if (!previewMonitorMaster.current) {
      previewMonitorMaster.current = audioContext.createGain();
      previewMonitorMaster.current.gain.value = previewMonitorCurrent.current ? (independentOutputs(outputConfigCurrent.current) ? 1 : masterVolumeCurrent.current) : 0;
      previewMonitorLimiter.current = audioContext.createDynamicsCompressor();
      previewMonitorLimiter.current.threshold.value = BOOTH_LIMITER.threshold;
      previewMonitorLimiter.current.knee.value = BOOTH_LIMITER.knee;
      previewMonitorLimiter.current.ratio.value = BOOTH_LIMITER.ratio;
      previewMonitorLimiter.current.attack.value = BOOTH_LIMITER.attack;
      previewMonitorLimiter.current.release.value = BOOTH_LIMITER.release;
      const previewTrim = audioContext.createGain();
      previewTrim.gain.value = BOOTH_OUTPUT_TRIM_GAIN;
      previewMonitorMaster.current.connect(previewMonitorLimiter.current);
      previewMonitorLimiter.current.connect(previewTrim);
      previewTrim.connect(outputs.preview);
    }
    if (!crowdMaster.current) {
      crowdMaster.current = audioContext.createGain();
      crowdMaster.current.gain.value = masterVolumeCurrent.current;
      crowdStreamDestination.current = audioContext.createMediaStreamDestination();
      crowdMaster.current.connect(crowdStreamDestination.current);
    }
    return { audioContext, localMaster: master.current, cueMonitorOutput: cueMonitorMaster.current, previewMonitorOutput: previewMonitorMaster.current, remoteMaster: crowdMaster.current, stream: crowdStreamDestination.current!.stream };
  };
  const applyRouting = () => {
    const routing = boothRoutingLevels(decksCurrent.current, DECK_IDS, headphoneMonitorCurrent.current, previewMonitorCurrent.current, independentOutputs(outputConfigCurrent.current));
    const now = context.current?.currentTime ?? 0;
    for (const id of DECK_IDS) {
      const graph = graphs.current[id];
      if (!graph) continue;
      rampAudioParam(graph.channel.gain, routing[id].channelGain, now);
      rampAudioParam(graph.monitorGate.gain, routing[id].mainGate, now);
      rampAudioParam(graph.cueChannel.gain, routing[id].cueGain, now);
    }
  };
  const setPreviewMonitorRouting = (next: boolean) => {
    const previous = previewMonitorCurrent.current;
    previewMonitorCurrent.current = next;
    setPreviewMonitor(next);
    const audioContext = context.current;
    if (audioContext && previewMonitorMaster.current) {
      rampAudioParam(previewMonitorMaster.current.gain, next ? (independentOutputs(outputConfigCurrent.current) ? 1 : masterVolumeCurrent.current) : 0, audioContext.currentTime);
    }
    applyRouting();
    if (previous !== next) reportCrowdLiveEvent("monitor.preview.changed", { enabled: next, cueMonitorEnabled: headphoneMonitorCurrent.current });
  };
  useEffect(() => {
    try {
      const saved = parseOutputConfig(localStorage.getItem(OUTPUT_STORAGE_KEY));
      if (saved) {
        outputConfigCurrent.current = saved; setOutputConfig(saved);
        if (independentOutputs(saved)) {
          hardwareOutputs.current?.failClosed();
          setOutputFault("Saved DJ output setup needs reconnecting. Open AUDIO OUTPUTS and apply it before playing.");
        }
      }
    } catch { /* Storage can be disabled. */ }
    const changed = () => {
      void navigator.mediaDevices?.enumerateDevices().then(devices => hardwareOutputs.current?.checkDevices(devices)).catch(error => setOutputFault(String(error.message ?? error)));
    };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => { navigator.mediaDevices?.removeEventListener("devicechange", changed); hardwareOutputs.current?.dispose(); hardwareOutputs.current = null; };
  }, []);
  const outputSetupIdle = () => !DECK_IDS.some(id => decksCurrent.current[id].playing || (activeAudio(id) && !activeAudio(id)!.paused))
    && ![transitionPreviewOutgoingAudio.current, transitionPreviewIncomingAudio.current, gridCheckAudio.current].some(audio => audio && !audio.paused);
  const configureAudioOutputs = async (next: OutputConfig) => {
    if (!outputSetupIdle()) throw new Error("Pause live decks and private auditions before changing hardware outputs. Your cues stay where they are.");
    outputChanging.current = true;
    try {
      const { audioContext } = ensureMasterOutputs();
      await hardwareOutputs.current!.configure(next);
      outputConfigCurrent.current = { ...next }; setOutputConfig({ ...next });
      const monitorLevel = independentOutputs(next) ? 1 : masterVolumeCurrent.current;
      rampAudioParam(cueMonitorMaster.current!.gain, monitorLevel, audioContext.currentTime);
      rampAudioParam(previewMonitorMaster.current!.gain, previewMonitorCurrent.current ? monitorLevel : 0, audioContext.currentTime);
      applyRouting(); setOutputFault("");
      try { localStorage.setItem(OUTPUT_STORAGE_KEY, JSON.stringify(next)); } catch {}
    } catch (error) {
      setOutputFault(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { outputChanging.current = false; }
  };
  const testAudioOutput = (bus: "master" | "cue") => {
    if (!outputSetupIdle()) throw new Error("Pause playback before testing outputs.");
    hardwareOutputs.current?.test(bus);
  };
  const ensureGraph = async (id: DeckId, resume = true) => {
    if (outputChanging.current) throw new Error("Audio outputs are being configured; try Play again when setup completes.");
    if (graphs.current[id]) { if (resume) await context.current?.resume(); return graphs.current[id]!; }
    const mainAudio = mediaRefs[id][0].current;
    const shadowAudio = mediaRefs[id][1].current;
    if (!mainAudio || !shadowAudio) throw new Error("Deck audio is unavailable");
    applyBoothPitchMode(mainAudio);
    applyBoothPitchMode(shadowAudio);
    const { audioContext, localMaster, cueMonitorOutput, remoteMaster } = ensureMasterOutputs();
    const mainSource = audioContext.createMediaElementSource(mainAudio);
    const shadowSource = audioContext.createMediaElementSource(shadowAudio);
    const mainInput = audioContext.createGain(); mainInput.gain.value = activeMedia.current[id] === 0 ? 1 : 0;
    const shadowInput = audioContext.createGain(); shadowInput.gain.value = activeMedia.current[id] === 1 ? 1 : 0;
    const meter = audioContext.createAnalyser(); meter.fftSize = BOOTH_METER_FFT_SIZE; meter.smoothingTimeConstant = .86; meter.minDecibels = -96; meter.maxDecibels = -6;
    // The visual spectrum measures after EQ; calibration keeps its existing pre-EQ meter.
    const spectrum = audioContext.createAnalyser();
    spectrum.fftSize = 4096; spectrum.smoothingTimeConstant = .55;
    const meterTime = new Float32Array(meter.fftSize);
    const meterFrequency = new Float32Array(meter.frequencyBinCount);
    const low = audioContext.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = BOOTH_EQ_FILTERS.lowFrequencyHz;
    const mid = audioContext.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = BOOTH_EQ_FILTERS.midFrequencyHz; mid.Q.value = BOOTH_EQ_FILTERS.midQ;
    const high = audioContext.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = BOOTH_EQ_FILTERS.highFrequencyHz;
    const dry = audioContext.createGain(); dry.gain.value = 1;
    const channel = audioContext.createGain();
    const cueChannel = audioContext.createGain(); cueChannel.gain.value = 0;
    const loopGate = audioContext.createGain(); loopGate.gain.value = 1;
    const cueLoopGate = audioContext.createGain(); cueLoopGate.gain.value = 1;
    const monitorGate = audioContext.createGain(); monitorGate.gain.value = 1;
    const echo = audioContext.createDelay(1); echo.delayTime.value = .28; const feedback = audioContext.createGain(); feedback.gain.value = .32; echo.connect(feedback); feedback.connect(echo);
    const reverb = audioContext.createConvolver(); reverb.normalize = false;
    const phaser = audioContext.createBiquadFilter(); phaser.type = "allpass"; phaser.frequency.value = 900; phaser.Q.value = 4; const lfo = audioContext.createOscillator(); const lfoGain = audioContext.createGain(); lfo.frequency.value = .35; lfoGain.gain.value = 650; lfo.connect(lfoGain); lfoGain.connect(phaser.frequency); lfo.start();
    const drive = audioContext.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < curve.length; i += 1) { const x = i * 2 / (curve.length - 1) - 1; curve[i] = Math.tanh(x * 3); } drive.curve = curve;
    const echoWet = audioContext.createGain(), reverbWet = audioContext.createGain(), phaserWet = audioContext.createGain(), driveWet = audioContext.createGain();
    echoWet.gain.value = 0; reverbWet.gain.value = 0; phaserWet.gain.value = 0; driveWet.gain.value = 0; channel.gain.value = 0;
    mainSource.connect(mainInput); shadowSource.connect(shadowInput); mainInput.connect(low); shadowInput.connect(low); mainInput.connect(meter); shadowInput.connect(meter); low.connect(mid); mid.connect(high); high.connect(dry); high.connect(spectrum); dry.connect(channel); dry.connect(cueChannel); echo.connect(echoWet); echoWet.connect(channel); echoWet.connect(cueChannel); reverb.connect(reverbWet); reverbWet.connect(channel); reverbWet.connect(cueChannel); phaser.connect(phaserWet); phaserWet.connect(channel); phaserWet.connect(cueChannel); drive.connect(driveWet); driveWet.connect(channel); driveWet.connect(cueChannel); channel.connect(loopGate); loopGate.connect(monitorGate); monitorGate.connect(localMaster); loopGate.connect(remoteMaster); cueChannel.connect(cueLoopGate); cueLoopGate.connect(cueMonitorOutput);
    const graph: AudioGraph = { mainInput, shadowInput, meter, spectrum, meterTime, meterFrequency, low, mid, high, dry, channel, cueChannel, loopGate, cueLoopGate, monitorGate, echo, reverb, phaser, drive, echoWet, reverbWet, phaserWet, driveWet, activeFx: "none" };
    const state = decksCurrent.current[id];
    routeActiveEffect(graph, state.fx);
    low.gain.value = state.low; mid.gain.value = state.mid; high.gain.value = state.high;
    const wet = state.fx === "none" ? 0 : state.wet;
    dry.gain.value = 1 - wet * .35;
    echoWet.gain.value = state.fx === "echo" ? wet * .65 : 0; reverbWet.gain.value = state.fx === "reverb" ? wet * .65 : 0; phaserWet.gain.value = state.fx === "phaser" ? wet * .65 : 0; driveWet.gain.value = state.fx === "drive" ? wet * .65 : 0;
    graphs.current[id] = graph;
    void ensureScrubNode(id, audioContext, cueChannel);
    applyRouting();
    if (resume) await audioContext.resume();
    return graph;
  };
  const ensureBufferedLoop = async (id:DeckId) => {
    const deck=decksCurrent.current[id];
    if(!deck.loopActive || !deck.track || bufferedDecks.current[id]?.trackId===deck.track.id)return;
    if(bufferJobs.current[id]){await bufferJobs.current[id];return;}
    const track=deck.track;
    const job=(async()=>{
      const graph=await ensureGraph(id);const ctx=context.current!;
      const response=await fetch(track.audio,{cache:"force-cache"});if(!response.ok)throw new Error("Loop audio could not load");
      const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
      if(decksCurrent.current[id].track?.id!==track.id)return;
      const native=mediaRefs[id][activeMedia.current[id]].current!;
      const wasPlaying=!native.paused;
      const transport=new BufferedDeckTransport(ctx,buffer,native,[graph.low,graph.meter],()=>changeDeck(id,{playing:false}));
      const latest=decksCurrent.current[id];transport.configureLoop(latest.loopActive,latest.loopStart,latest.loopEnd);
      cancelLoopTransition(id);mediaRefs[id].forEach(ref=>ref.current?.pause());
      graph.mainInput.gain.cancelScheduledValues(ctx.currentTime);graph.shadowInput.gain.cancelScheduledValues(ctx.currentTime);
      graph.mainInput.gain.setValueAtTime(0,ctx.currentTime);graph.shadowInput.gain.setValueAtTime(0,ctx.currentTime);
      bufferedDecks.current[id]={trackId:track.id,transport};
      if(wasPlaying)await transport.play();
      changeDeck(id,{currentTime:transport.currentTime});
      reportClientDiagnostic("loop-buffer-ready",{deck:id,trackId:track.id,sampleRate:buffer.sampleRate,duration:buffer.duration});
    })();bufferJobs.current[id]=job;
    try{await job;}finally{if(bufferJobs.current[id]===job)delete bufferJobs.current[id];}
  };
  /**
   * The worklet is loaded once per context and a node made per deck.
   *
   * Failure here is silent on purpose: a booth that cannot build a platter still
   * plays, drags and cues exactly as before. Scrub sound is a monitoring tool, and
   * losing it should never be the thing that takes a deck down mid-set.
   */
  const ensureScrubNode = async (id: DeckId, audioContext: AudioContext, destination: AudioNode) => {
    // Off at the source rather than muted: no worklet fetched, no tune decoded,
    // no 18 MB a deck held for a sound nobody is hearing.
    if (!SCRUB_AUDIO_ENABLED) return null;
    if (scrubNodes.current[id]) return scrubNodes.current[id]!;
    try {
      scrubModuleReady.current ??= audioContext.audioWorklet.addModule("/scrub-worklet.js");
      await scrubModuleReady.current;
      if (scrubNodes.current[id]) return scrubNodes.current[id]!;
      const node = new AudioWorkletNode(audioContext, "platter-scrub", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(destination);
      scrubNodes.current[id] = node;
      // Load from here as well as from the track-change effect. Building this
      // node is asynchronous — the worklet is fetched over the network — and it
      // is started un-awaited from a deck load, so the effect that reacts to the
      // new track almost always runs first and finds no node to give samples to.
      // Whichever of the two arrives second does the work; the marker makes sure
      // only one of them does it.
      void refreshScrubSamples(id);
      return node;
    } catch (error) {
      reportClientDiagnostic("scrub-worklet-unavailable", { deck: id, ...diagnosticErrorDetails(error) });
      return null;
    }
  };
  /** Give the platter whatever tune is on that deck, once. */
  const refreshScrubSamples = async (id: DeckId) => {
    if (!SCRUB_AUDIO_ENABLED) return;
    const track = decksCurrent.current[id].track;
    const node = scrubNodes.current[id];
    const audioContext = context.current;
    if (!track?.audio || !node || !audioContext) return;
    if (scrubLoadedTrack.current[id] === track.id) return;
    scrubLoadedTrack.current[id] = track.id;
    scrubReady.current[id] = false;
    const loaded = await loadScrubSamples(audioContext, track.audio);
    // The deck may have been loaded with something else while this decoded.
    if (decksCurrent.current[id].track?.id !== track.id) return;
    if (!loaded) {
      scrubLoadedTrack.current[id] = undefined;
      reportClientDiagnostic("scrub-samples-unavailable", { deck: id, trackId: track.id });
      return;
    }
    // Transferred, not copied: this is the only reference to those samples from
    // here on, and copying 18 MB per deck would be paid for nothing.
    node.port.postMessage({ type: "load", samples: loaded.samples, sampleRate: loaded.sampleRate }, [loaded.samples.buffer]);
    scrubReady.current[id] = true;
  };
  /**
   * Hand the platter the tune, in the background, once per loaded track.
   *
   * Deliberately not on the deck-load path: decoding a seven-minute file takes a
   * second or two and loading a tune is the moment before playing it. A scrub
   * started before this lands is silent rather than late, which is the same thing
   * the booth did before it had a platter at all.
   */
  useEffect(() => {
    for (const id of DECK_IDS) void refreshScrubSamples(id);
  }, [decks.A.track?.id, decks.B.track?.id, decks.C.track?.id]);
  /**
   * What the hand is doing, sent to the platter.
   *
   * Every decision is `lib/scrub-audio.ts`'s: `scrubCommand` turns a position and
   * a velocity into a read position and a signed rate, holds it silent when the
   * hand is still, and stops it at either end of the record.
   */
  /**
   * Why a drag made no sound.
   *
   * Silence has several honest causes here and they are indistinguishable at the
   * hand, which makes a working platter and a broken one feel identical. Said
   * once per gesture, on the deck's own status line.
   */
  const scrubSilenceReason = (id: DeckId) => {
    if (!scrubNodes.current[id]) return "the platter has not started up on this deck yet";
    if (!scrubReady.current[id]) return "this tune is still being prepared for scrubbing";
    const routing = scrubRouting({ deckCue: decksCurrent.current[id].cue, headphoneMonitor: independentOutputs(outputConfigCurrent.current) || headphoneMonitorCurrent.current });
    if (routing.toCue) return null;
    // Scrub audio never reaches the master — that is the whole point of it being
    // on the cue bus — so with no monitor there is nowhere for it to go.
    return decksCurrent.current[id].cue
      ? "headphone monitor is off, and a scrub never goes to the master"
      : `deck ${id} is not cued, and a scrub never goes to the master`;
  };
  const scrubReported = useRef<Partial<Record<DeckId, boolean>>>({});
  const sendScrubAudio = (id: DeckId, command: { pointerTime: number; velocity: number; duration: number } | null) => {
    // Silent by design while the platter is off, so no status line explains a
    // silence nobody asked about.
    if (!SCRUB_AUDIO_ENABLED) return;
    const node = scrubNodes.current[id];
    if (!command) {
      scrubReported.current[id] = false;
      node?.port.postMessage({ type: "stop" });
      return;
    }
    if (!scrubReported.current[id]) {
      scrubReported.current[id] = true;
      const reason = scrubSilenceReason(id);
      if (reason) setLoopTeachingStatus((current) => ({ ...current, [id]: `Platter silent · ${reason}.` }));
    }
    node?.port.postMessage({ type: "command", ...scrubCommand(command) });
  };
  const transitionPreviewAudio = (role: TransitionPreviewRole) => role === "outgoing"
    ? transitionPreviewOutgoingAudio.current
    : transitionPreviewIncomingAudio.current;
  const prepareTransitionPreviewAudio = async (role: TransitionPreviewRole, track: Track, time: number) => {
    const audio = transitionPreviewAudio(role);
    if (!audio) throw new Error("The private preview player is not ready yet");
    applyBoothPitchMode(audio);
    // A REPLICATE swaps this role's private player onto the server-rendered
    // splice: the same tune with the selected block really pasted in again,
    // so what plays is exactly what the doubled wave shows.
    const replicate = transitionPreviewCurrent.current?.replicate;
    const source = replicate && replicate.role === role ? replicate.audio : track.audio;
    const sourceChanged = audio.dataset.previewSource !== source || !audio.getAttribute("src") || Boolean(audio.error);
    if (sourceChanged) {
      audio.pause();
      audio.preload = "metadata";
      audio.src = source;
      audio.dataset.previewSource = source;
      audio.load();
    }
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          window.clearTimeout(timeout);
          audio.removeEventListener("loadedmetadata", ready);
          audio.removeEventListener("error", failed);
          if (error) reject(error); else resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error(`${track.name}'s private preview source could not load`));
        const timeout = window.setTimeout(() => finish(new Error(`${track.name}'s private preview source timed out`)), 15_000);
        audio.addEventListener("loadedmetadata", ready, { once: true });
        audio.addEventListener("error", failed, { once: true });
      });
    }
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(0, time);
    audio.currentTime = clamp(time, 0, duration);
    return audio;
  };
  const releaseTransitionPreviewAudio = () => {
    for (const audio of [transitionPreviewOutgoingAudio.current, transitionPreviewIncomingAudio.current]) {
      if (!audio) continue;
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.previewSource;
      audio.load();
    }
  };
  const ensureTransitionPreviewGraph = async (role: TransitionPreviewRole) => {
    const existing = transitionPreviewGraphs.current[role];
    if (existing) { await context.current?.resume(); return existing; }
    const audio = transitionPreviewAudio(role);
    if (!audio) throw new Error("The private preview player is not ready yet");
    const { audioContext, previewMonitorOutput } = ensureMasterOutputs();
    const source = audioContext.createMediaElementSource(audio);
    const low = audioContext.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = BOOTH_EQ_FILTERS.lowFrequencyHz;
    const mid = audioContext.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = BOOTH_EQ_FILTERS.midFrequencyHz; mid.Q.value = BOOTH_EQ_FILTERS.midQ;
    const high = audioContext.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = BOOTH_EQ_FILTERS.highFrequencyHz;
    const output = audioContext.createGain(); output.gain.value = 0;
    source.connect(low); low.connect(mid); mid.connect(high); high.connect(output); output.connect(previewMonitorOutput);
    const graph = { source, low, mid, high, output };
    transitionPreviewGraphs.current[role] = graph;
    await audioContext.resume();
    return graph;
  };
  const setTransitionPreviewEq = (role: TransitionPreviewRole, values: { low: number; mid: number; high: number; output?: number }) => {
    const graph = transitionPreviewGraphs.current[role];
    const audioContext = context.current;
    if (!graph || !audioContext) return;
    const now = audioContext.currentTime;
    rampAudioParam(graph.low.gain, values.low, now, .018);
    rampAudioParam(graph.mid.gain, values.mid, now, .018);
    rampAudioParam(graph.high.gain, values.high, now, .018);
    if (values.output !== undefined) rampAudioParam(graph.output.gain, values.output, now, .018);
  };
  const setTransitionPreviewOutput = (role: TransitionPreviewRole, output: number) => {
    const graph = transitionPreviewGraphs.current[role];
    const audioContext = context.current;
    if (!graph || !audioContext) return;
    rampAudioParam(graph.output.gain, output, audioContext.currentTime, .018);
  };
  const stopTransitionPreviewPlayback = (status?: string) => {
    transitionPreviewCueToken.current += 1;
    transitionPreviewPhaseColourOutgoing.current = null;
    transitionPreviewPhaseColourIncoming.current = null;
    transitionPreviewBend.current = null;
    if (transitionPreviewTimer.current) clearInterval(transitionPreviewTimer.current);
    transitionPreviewTimer.current = null;
    const outgoingAudio = transitionPreviewOutgoingAudio.current;
    const incomingAudio = transitionPreviewIncomingAudio.current;
    const priorAudition = transitionPreviewCurrent.current?.audition ?? null;
    const wasPlaying = Boolean(priorAudition || outgoingAudio && !outgoingAudio.paused || incomingAudio && !incomingAudio.paused);
    const outgoingTime = outgoingAudio?.dataset.previewSource && Number.isFinite(outgoingAudio.currentTime) ? outgoingAudio.currentTime : undefined;
    const incomingTime = incomingAudio?.dataset.previewSource && Number.isFinite(incomingAudio.currentTime) ? incomingAudio.currentTime : undefined;
    outgoingAudio?.pause();
    incomingAudio?.pause();
    setTransitionPreviewEq("outgoing", { low: 0, mid: 0, high: 0, output: 0 });
    setTransitionPreviewEq("incoming", { low: 0, mid: 0, high: 0, output: 0 });
    setTransitionPreview((current) => current ? {
      ...current,
      audition: null,
      ...(outgoingTime === undefined ? {} : { outgoingTime }),
      ...(incomingTime === undefined ? {} : { incomingTime }),
      status: status ?? current.status,
    } : current);
    if (wasPlaying) reportCrowdLiveEvent("preview.playback.stopped", {
      audition: priorAudition,
      reason: status ?? "stopped",
      outgoingTime,
      incomingTime,
    });
  };
  const reportTransitionPreviewMediaError = (role: TransitionPreviewRole, audio: HTMLAudioElement) => {
    if (!audio.dataset.previewSource) return;
    const mediaError = audio.error;
    reportClientDiagnostic("transition-preview-media-error", {
      role,
      code: mediaError?.code,
      message: mediaError?.message,
      currentTime: audio.currentTime,
      duration: audio.duration,
      networkState: audio.networkState,
      readyState: audio.readyState,
      source: audio.currentSrc ? new URL(audio.currentSrc).pathname : "",
    });
    reportCrowdLiveEvent("preview.media.error", {
      role,
      code: mediaError?.code,
      message: mediaError?.message,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState,
    });
    stopTransitionPreviewPlayback(mediaError?.message || `${role} private preview media failed`);
  };
  const playTransitionPreviewTrack = async (role: TransitionPreviewRole, requestedTime?: number, restart = false) => {
    const preview = transitionPreview;
    if (!preview) return;
    // The transport button toggles; auditioning a point on the waveform always
    // restarts from that point, so a second click jumps rather than stopping.
    if (preview.audition === role && !restart) { stopTransitionPreviewPlayback("Private track preview paused"); return; }
    stopTransitionPreviewPlayback();
    const token = ++transitionPreviewCueToken.current;
    const track = role === "outgoing" ? preview.outgoingTrack : preview.incomingTrack;
    const time = requestedTime !== undefined ? snapTransitionPreviewTime(preview, role, requestedTime) : (role === "outgoing" ? preview.outgoingTime : preview.incomingTime);
    if (requestedTime !== undefined) seekTransitionPreview(role, time);
    setTransitionPreview((current) => current ? { ...current, status: `Loading ${track.name}'s private player on demandâ€¦` } : current);
    const audio = await prepareTransitionPreviewAudio(role, track, time);
    if (token !== transitionPreviewCueToken.current) return;
    const graph = await ensureTransitionPreviewGraph(role);
    if (token !== transitionPreviewCueToken.current) return;
    graph.low.gain.value = 0; graph.mid.gain.value = 0; graph.high.gain.value = 0;
    setTransitionPreviewEq(role, { low: transitionPreviewBassKill.current[role] ? -60 : 0, mid: 0, high: 0, output: .72 });
    audio.playbackRate = 1;
    await audio.play();
    if (token !== transitionPreviewCueToken.current) { audio.pause(); return; }
    reportClientDiagnostic("transition-preview-track-started", { role, trackId: track.id, time });
    reportCrowdLiveEvent("preview.track.started", { role, trackId: track.id, time, playbackRate: audio.playbackRate, outputGain: .72 });
    setTransitionPreview((current) => current ? { ...current, audition: role, status: `${role === "outgoing" ? "Playing-track" : "Incoming-track"} private preview · Preview Monitor` } : current);
  };
  const startTransitionPreviewCue = async (role: TransitionPreviewRole, requestedTime?: number) => {
    const preview = transitionPreview;
    if (!preview) return;
    stopTransitionPreviewPlayback();
    const token = ++transitionPreviewCueToken.current;
    const track = role === "outgoing" ? preview.outgoingTrack : preview.incomingTrack;
    const cueTime = requestedTime !== undefined ? snapTransitionPreviewTime(preview, role, requestedTime) : (role === "outgoing" ? preview.outgoingTime : preview.incomingTime);
    if (requestedTime !== undefined) seekTransitionPreview(role, cueTime);
    transitionPreviewCueReturn.current[role] = cueTime;
    setTransitionPreview((current) => current ? { ...current, status: `Loading ${track.name}'s private cue player on demand…` } : current);
    const audio = await prepareTransitionPreviewAudio(role, track, cueTime);
    if (token !== transitionPreviewCueToken.current) return;
    const graph = await ensureTransitionPreviewGraph(role);
    if (token !== transitionPreviewCueToken.current) return;
    graph.low.gain.value = 0; graph.mid.gain.value = 0; graph.high.gain.value = 0;
    setTransitionPreviewEq(role, { low: transitionPreviewBassKill.current[role] ? -60 : 0, mid: 0, high: 0, output: .72 });
    audio.playbackRate = 1;
    await audio.play();
    if (token !== transitionPreviewCueToken.current) { audio.pause(); return; }
    reportCrowdLiveEvent("preview.cue.started", { role, trackId: track.id, cueTime });
    setTransitionPreview((current) => current ? { ...current, audition: role, status: `${role === "outgoing" ? "Mix Out" : "Mix In"} cue held at ${preciseTimeLabel(cueTime)} · Preview Monitor` } : current);
  };
  const endTransitionPreviewCue = (role: TransitionPreviewRole) => {
    const returnTime = transitionPreviewCueReturn.current[role];
    transitionPreviewCueToken.current += 1;
    const audio = transitionPreviewAudio(role);
    audio?.pause();
    if (audio && returnTime !== undefined) audio.currentTime = returnTime;
    setTransitionPreviewEq(role, { low: 0, mid: 0, high: 0, output: 0 });
    delete transitionPreviewCueReturn.current[role];
    reportCrowdLiveEvent("preview.cue.returned", { role, returnTime });
    setTransitionPreview((current) => current ? {
      ...current,
      audition: null,
      ...(returnTime === undefined ? {} : { [role === "outgoing" ? "outgoingTime" : "incomingTime"]: returnTime }),
      status: "Private cue returned to its white playhead · live audio untouched",
    } : current);
  };
  const playTransitionPreviewMix = async () => {
    const preview = transitionPreview;
    if (!preview) return;
    if (preview.audition === "mix") { stopTransitionPreviewPlayback("Transition preview paused"); return; }
    if (!transitionPreviewCanCommit(preview.outgoingWindow, preview.incomingWindow, preview.beats)) {
      setTransitionPreview((current) => current ? { ...current, status: "Set START and END on both private players before previewing the mix" } : current);
      return;
    }
    // Preview Mix is an audition action, so make its private bus audible before
    // decoder startup. The live booth/cue gates close locally; remote master is
    // intentionally outside this routing change.
    setPreviewMonitorRouting(true);
    stopTransitionPreviewPlayback();
    const token = ++transitionPreviewCueToken.current;
    setTransitionPreview((current) => current ? { ...current, status: "Loading both private players on demandâ€¦" } : current);
    // 7 August timing baseline: the four selected coordinates stay literal.
    // Preview does not remap either full WAV or invent a second grid.
    const outgoingStart = preview.outgoingWindow.start!;
    const outgoingEnd = preview.outgoingWindow.end!;
    const incomingStart = preview.incomingWindow.start!;
    const incomingEnd = preview.incomingWindow.end!;
    const outgoingBpm = resolvedBpmAt(preview.outgoingAnalysis, outgoingStart);
    const incomingBpm = resolvedBpmAt(preview.incomingAnalysis, incomingStart);
    // The confirmed windows are the grid authority for their spans, so the
    // run-up is counted in the user's own beats. Reading the analyser's grid
    // here would roll a tune in against a tempo the window has replaced.
    const outgoingBeatSeconds = (outgoingEnd - outgoingStart) / Math.max(1, preview.beats);
    const incomingBeatSeconds = (incomingEnd - incomingStart) / Math.max(1, preview.beats);
    const runwayStart = Math.max(0, outgoingStart - TRANSITION_PREVIEW_LEAD_BEATS * outgoingBeatSeconds);
    const incomingLaunchAt = Math.max(0, outgoingStart - TRANSITION_PREVIEW_SILENT_PREROLL_BEATS * outgoingBeatSeconds);
    const incomingPrerollStart = Math.max(0, incomingStart - TRANSITION_PREVIEW_SILENT_PREROLL_BEATS * incomingBeatSeconds);
    const [outgoingAudio, incomingAudio] = await Promise.all([
      prepareTransitionPreviewAudio("outgoing", preview.outgoingTrack, runwayStart),
      prepareTransitionPreviewAudio("incoming", preview.incomingTrack, incomingPrerollStart),
    ]);
    if (token !== transitionPreviewCueToken.current) return;
    await Promise.all([
      ensureTransitionPreviewGraph("outgoing"),
      ensureTransitionPreviewGraph("incoming"),
    ]);
    if (token !== transitionPreviewCueToken.current) return;
    outgoingAudio.currentTime = runwayStart;
    incomingAudio.currentTime = incomingPrerollStart;
    const liveOutgoingAudio = activeAudio(preview.outgoingDeck);
    const liveOutgoingState = decksCurrent.current[preview.outgoingDeck];
    const followsLiveCrowdClock = liveOutgoingState.track?.id === preview.outgoingTrack.id
      && Boolean(liveOutgoingAudio && !liveOutgoingAudio.paused);
    // Loaded decks deliberately begin at a zero safety fader. Preview is an
    // audition of the applied crowd mix, so inherit a real live level when one
    // exists but never let that safety zero mute the private Preview bus.
    const overlapVolume = transitionPreviewCrowdAuditionVolume(liveOutgoingState.volume, followsLiveCrowdClock);
    outgoingAudio.playbackRate = 1;
    // Both confirmed windows contain the same selected beat count, so their
    // exact spans are the Preview grid authority. This keeps every cue literal
    // while making the X and Z grid lines coincide instead of starting locked
    // and drifting on a slightly different analysed-BPM ratio.
    const incomingRate = transitionPreviewTempoRate(preview.outgoingWindow, preview.incomingWindow);
    const safeIncomingRate = clamp(incomingRate, .25, 4);
    incomingAudio.playbackRate = safeIncomingRate;
    const outgoingWindowBpm = preview.beats * 60 / (outgoingEnd - outgoingStart);
    const incomingWindowBpm = preview.beats * 60 / (incomingEnd - incomingStart);
    // Internal evidence only: how far the confirmed windows re-teach tempo
    // away from the analyser's older guess. The windows win — this number is
    // logged for diagnosis, never shown as a warning against the user.
    const analysedRatio = outgoingBpm > 0 && incomingBpm > 0 ? outgoingBpm / incomingBpm : null;
    const spanGridMismatchPercent = analysedRatio === null ? null : (safeIncomingRate / analysedRatio - 1) * 100;
    const opening = assistedAutomationAtBeat(preview.automation, 0);
    // stopTransitionPreviewPlayback() leaves short zero-gain ramps queued on
    // reused Preview graphs. Re-prime every AudioParam through the cancelling
    // helper; assigning `.value` here would let that stale ramp mute Track A a
    // few milliseconds after playback starts while Track B later opens normally.
    setTransitionPreviewEq("outgoing", {
      low: followsLiveCrowdClock ? liveOutgoingState.low : 0,
      mid: followsLiveCrowdClock ? liveOutgoingState.mid : 0,
      high: followsLiveCrowdClock ? liveOutgoingState.high : 0,
      output: overlapVolume,
    });
    setTransitionPreviewEq("incoming", {
      low: opening.incomingLow,
      mid: opening.incomingMid,
      high: opening.incomingHigh,
      output: 0,
    });
    await outgoingAudio.play();
    if (token !== transitionPreviewCueToken.current) { outgoingAudio.pause(); incomingAudio.pause(); return; }
    // Re-anchor after the private browser decoder starts. The incoming private
    // player launches silently four beats before the overlap and opens only at X.
    outgoingAudio.currentTime = runwayStart;
    reportClientDiagnostic("transition-preview-mix-started", {
      outgoingTrackId: preview.outgoingTrack.id,
      incomingTrackId: preview.incomingTrack.id,
      runwayStart,
      outgoingStart,
      outgoingEnd,
      incomingStart,
      incomingEnd,
      requestedLeadBeats: TRANSITION_PREVIEW_LEAD_BEATS,
      outgoingBpm,
      incomingBpm,
      incomingRate: safeIncomingRate,
      actualLeadBeats: (outgoingStart - runwayStart) * outgoingBpm / 60,
      outgoingWindowBpm,
      incomingWindowBpm,
      tempoAuthority: "confirmed-equal-beat-window-spans",
      timeline: "selected-window-span-lock",
    });
    reportCrowdLiveEvent("preview.mix.started", {
      outgoingTrackId: preview.outgoingTrack.id,
      incomingTrackId: preview.incomingTrack.id,
      outgoingDeck: preview.outgoingDeck,
      incomingDeck: preview.incomingDeck,
      runwayStart,
      outgoingStart,
      outgoingEnd,
      incomingStart,
      incomingEnd,
      beats: preview.beats,
      bassSwapBeat: preview.automation.bassSwapBeat,
      outgoingBpm,
      incomingBpm,
      outgoingWindowBpm,
      incomingWindowBpm,
      incomingRate: safeIncomingRate,
      spanGridMismatchPercent: spanGridMismatchPercent === null ? null : Math.round(spanGridMismatchPercent * 100) / 100,
      liveOutgoingVolume: liveOutgoingState.volume,
      auditionVolume: overlapVolume,
      usedSafetyVolumeFallback: liveOutgoingState.volume <= .001,
      followsLiveCrowdClock,
    });
    setTransitionPreview((current) => current ? { ...current, audition: "mix", outgoingTime: runwayStart, incomingTime: incomingPrerollStart, status: `Preview Mix running from ${TRANSITION_PREVIEW_LEAD_BEATS} of your ${preview.beats}-beat window beats before X · ${outgoingWindowBpm.toFixed(2)} → ${incomingWindowBpm.toFixed(2)} BPM · Preview Monitor` } : current);
    let incomingLaunched = false;
    let incomingLaunchPending = false;
    let mixOpened = false;
    let outgoingCut = false;
    let bassSwapStarted = false;
    let bassSwapCompleted = false;
    let finalPrerollReanchorDone = false;
    let appliedAutomation = preview.automation;
    let incomingSilentSeekCount = 0;
    // Audible-overlap phase diagnostics + optional Overlap Lock slaving. The
    // span-locked ratio stays the tempo authority; sampling and any bounded
    // nudge measure against the same literal outgoing→incoming mapping the
    // hard-align at X uses.
      let overlapResyncCount = 0;
    let overlapNextSampleBeat = 0;
    // Kick phase across the audible overlap, purely so the playheads can show
    // whether the incoming kicks are sitting early, late or together. It never
    // touches tempo: the span-locked ratio stays the only authority.
    let previewKickMonitor = emptyKickPhaseMonitor();
    let previewKickStatus: KickPhaseStatus | null = null;
    const overlapSamples: PreviewOverlapSample[] = [];
    const finalPrerollBeat = Math.max(0, outgoingStart - outgoingBeatSeconds);
    const alignedIncomingTime = (outgoingTime: number) => clamp(
      incomingStart + (outgoingTime - outgoingStart) * safeIncomingRate,
      0,
      preview.incomingAnalysis.duration,
    );
    transitionPreviewTimer.current = setInterval(() => {
      try {
      const current = transitionPreviewOutgoingAudio.current;
      const next = transitionPreviewIncomingAudio.current;
      if (!current || !next) return;
      const livePreview = transitionPreviewCurrent.current;
      if (!livePreview
        || livePreview.outgoingTrack.id !== preview.outgoingTrack.id
        || livePreview.incomingTrack.id !== preview.incomingTrack.id) {
        stopTransitionPreviewPlayback("Transition preview changed and stopped safely");
        return;
      }
      if (livePreview.automation !== appliedAutomation) {
        appliedAutomation = livePreview.automation;
        reportCrowdLiveEvent("preview.automation.changed", {
          outgoingTrackId: livePreview.outgoingTrack.id,
          incomingTrackId: livePreview.incomingTrack.id,
          windowBeats: livePreview.automation.windowBeats,
          bassSwapBeat: livePreview.automation.bassSwapBeat,
          whileMixRunning: true,
        });
      }
      if (!incomingLaunched && !incomingLaunchPending && current.currentTime >= incomingLaunchAt - .025) {
        incomingLaunchPending = true;
        next.currentTime = alignedIncomingTime(current.currentTime);
        next.playbackRate = safeIncomingRate;
        void next.play().then(() => {
          if (token !== transitionPreviewCueToken.current) { next.pause(); return; }
          next.currentTime = alignedIncomingTime(current.currentTime);
          incomingLaunched = true;
          incomingLaunchPending = false;
        }).catch((error: unknown) => {
          incomingLaunchPending = false;
          stopTransitionPreviewPlayback(error instanceof Error ? error.message : "Incoming private cue could not launch");
        });
      }
      if (incomingLaunched && !mixOpened && current.currentTime < outgoingStart - .005) {
        const targetTime = alignedIncomingTime(current.currentTime);
        let phaseError = next.currentTime - targetTime;
        if (!finalPrerollReanchorDone && current.currentTime >= finalPrerollBeat - .025) {
          if (Math.abs(phaseError) > .004) {
            next.currentTime = targetTime;
            incomingSilentSeekCount += 1;
          }
          reportCrowdLiveEvent("preview.mix.final-preroll-lock", {
            outgoingTrackId: preview.outgoingTrack.id,
            incomingTrackId: preview.incomingTrack.id,
            outgoingTime: current.currentTime,
            incomingTime: next.currentTime,
            targetIncomingTime: targetTime,
            phaseErrorBeforeMs: Math.round(phaseError * 1000 * 10) / 10,
            silentSeekCount: incomingSilentSeekCount,
          });
          phaseError = 0;
          finalPrerollReanchorDone = true;
          next.playbackRate = safeIncomingRate;
        } else if (!finalPrerollReanchorDone) {
          next.playbackRate = assistedSilentGridNudgeRate(safeIncomingRate, phaseError);
        }
      }
      if (!mixOpened && current.currentTime >= outgoingStart - .005) {
        if (!incomingLaunched) {
          next.currentTime = alignedIncomingTime(current.currentTime);
          next.playbackRate = safeIncomingRate;
          void next.play().catch((error: unknown) => stopTransitionPreviewPlayback(error instanceof Error ? error.message : "Incoming private cue could not launch"));
          incomingLaunched = true;
        }
        const targetTime = alignedIncomingTime(current.currentTime);
        const phaseError = next.currentTime - targetTime;
        // Tolerance-gated hard-align, mirroring the live path's cue-open
        // gate: when the silent preroll already locked phase inside the
        // green tolerance, seeking a playing element again would introduce
        // the very start-of-mix flam the align exists to prevent.
        const openSeek = previewOpenSeekDecision(phaseError) === "seek";
        if (openSeek) {
          next.currentTime = targetTime;
          next.addEventListener("seeked", () => {
            if (token !== transitionPreviewCueToken.current) return;
            const residual = next.currentTime - alignedIncomingTime(current.currentTime);
            if (Math.abs(residual) > PREVIEW_OPEN_SEEK_TOLERANCE_SECONDS) next.currentTime = alignedIncomingTime(current.currentTime);
          }, { once: true });
        }
        next.playbackRate = safeIncomingRate;
        setTransitionPreviewOutput("incoming", overlapVolume);
        mixOpened = true;
        reportCrowdLiveEvent("preview.mix.opened", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          outgoingTime: current.currentTime,
          incomingTime: next.currentTime,
          targetIncomingTime: targetTime,
          phaseErrorMs: Math.round(phaseError * 1000 * 10) / 10,
          silentSeekCount: incomingSilentSeekCount,
          openSeek,
          alignment: openSeek ? "7-august-hard-cue" : "preroll-lock-held",
          auditionVolume: overlapVolume,
        });
      }
      if (mixOpened && !outgoingCut) {
        const beat = transitionPreviewBeat(current.currentTime, preview.outgoingWindow, livePreview.beats);
        const mix = assistedAutomationAtBeat(livePreview.automation, beat);
        setTransitionPreviewEq("outgoing", { low: transitionPreviewBassKill.current.outgoing ? -60 : mix.outgoingLow, mid: mix.outgoingMid, high: mix.outgoingHigh });
        setTransitionPreviewEq("incoming", { low: transitionPreviewBassKill.current.incoming ? -60 : mix.incomingLow, mid: mix.incomingMid, high: mix.incomingHigh });
        if (!bassSwapStarted && mix.bassSwapProgress > 0) {
          bassSwapStarted = true;
          reportCrowdLiveEvent("preview.mix.bass-swap-started", { selectedBeat: livePreview.automation.bassSwapBeat, actualBeat: mix.beat, outgoingLow: mix.outgoingLow, incomingLow: mix.incomingLow });
        }
        if (!bassSwapCompleted && mix.bassSwapProgress >= 1) {
          bassSwapCompleted = true;
          reportCrowdLiveEvent("preview.mix.bass-swap-completed", { selectedBeat: livePreview.automation.bassSwapBeat, actualBeat: mix.beat, outgoingLow: mix.outgoingLow, incomingLow: mix.incomingLow });
        }
        if (!outgoingCut && !next.paused && !next.seeking) {
          // Read the kicks against each other for the playhead colour only.
          const kickUpdate = updateKickPhaseMonitor(previewKickMonitor, observeKickAgainstKick(
            { currentTime: current.currentTime, playbackRate: current.playbackRate, beats: preview.outgoingAnalysis.beats },
            { currentTime: next.currentTime, playbackRate: next.playbackRate, beats: preview.incomingAnalysis.beats },
          ));
          previewKickMonitor = kickUpdate.state;
          if (kickUpdate.report.status !== previewKickStatus) {
            previewKickStatus = kickUpdate.report.status;
            // Written to refs, never to state: this interval must not
            // rerender the booth, so the playheads pick the colour up in their
            // own animation frame exactly as they do the playhead position.
            const headColours = kickPhaseColoursForRoles(previewKickStatus);
            transitionPreviewPhaseColourOutgoing.current = headColours.outgoing;
            transitionPreviewPhaseColourIncoming.current = headColours.incoming;
          }
          const targetTime = alignedIncomingTime(current.currentTime);
          const phaseError = next.currentTime - targetTime;
          if (beat >= overlapNextSampleBeat) {
            overlapNextSampleBeat = beat + PREVIEW_OVERLAP_SAMPLE_EVERY_BEATS;
            overlapSamples.push({ beat, phaseErrorMs: Math.round(phaseError * 1000 * 10) / 10 });
          }
          // The span-locked ratio runs untouched. Only a discrete stall — a
          // decoder hiccup, never a tempo disagreement — earns a single hard
          // re-seek, the same correction class as the align at X. While a
          // pitch bend is held the DJ has the wheel: the re-seek stands down
          // rather than snapping their correction back out.
          if (!transitionPreviewBend.current && Math.abs(phaseError) >= PREVIEW_OVERLAP_RESEEK_SECONDS) {
            next.currentTime = targetTime;
            overlapResyncCount += 1;
            reportCrowdLiveEvent("preview.mix.overlap-resync", {
              outgoingTrackId: preview.outgoingTrack.id,
              incomingTrackId: preview.incomingTrack.id,
              beat,
              phaseErrorMs: Math.round(phaseError * 1000 * 10) / 10,
              resyncCount: overlapResyncCount,
            });
          }
          const incomingRateTarget = safeIncomingRate * transitionPreviewBendFactor("incoming");
          if (Math.abs(next.playbackRate - incomingRateTarget) > .00005) next.playbackRate = incomingRateTarget;
          const outgoingRateTarget = transitionPreviewBendFactor("outgoing");
          if (Math.abs(current.playbackRate - outgoingRateTarget) > .00005) current.playbackRate = outgoingRateTarget;
        }
      }
      if (mixOpened && !outgoingCut && current.currentTime >= outgoingEnd) {
        outgoingCut = true;
        const endpoint = assistedAutomationAtBeat(livePreview.automation, livePreview.automation.windowBeats);
        // DJ, 26 Aug 2026: the end of the window is a bass cut to the
        // incoming tune. Even when the ownership lane leaves the outgoing
        // holding the low end at Z, the tune that keeps playing gets its
        // bass back the instant the outgoing is cut.
        setTransitionPreviewEq("outgoing", { low: -60, mid: -60, high: -60, output: 0 });
        setTransitionPreviewEq("incoming", { low: transitionPreviewBassKill.current.incoming ? -60 : 0, mid: endpoint.incomingMid, high: endpoint.incomingHigh, output: overlapVolume });
        window.setTimeout(() => {
          if (token === transitionPreviewCueToken.current) current.pause();
        }, 90);
        reportClientDiagnostic("transition-preview-outgoing-cut", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          outgoingEnd,
          incomingTime: next.currentTime,
          continuation: "incoming-full-wave-preview-monitor",
        });
        reportCrowdLiveEvent("preview.mix.outgoing-cut", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          outgoingEnd,
          incomingTime: next.currentTime,
          incomingContinues: true,
        });
        // One readable verdict per audition: a linear ramp means the window
        // spans themselves disagree with the music, a step means a decoder
        // stall. This is the evidence trail for any reported overlap flam.
        const driftSummary = previewOverlapDriftSummary(overlapSamples);
        reportCrowdLiveEvent("preview.mix.overlap-drift-summary", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          classification: driftSummary.classification,
          maxAbsMs: Math.round(driftSummary.maxAbsMs * 10) / 10,
          endMs: Math.round(driftSummary.endMs * 10) / 10,
          driftMsPerBeat: Math.round(driftSummary.driftMsPerBeat * 100) / 100,
          stepCount: driftSummary.stepCount,
          sampleCount: driftSummary.sampleCount,
          resyncCount: overlapResyncCount,
          samples: overlapSamples,
        });
      }
      } catch (error) {
        reportClientDiagnostic("transition-preview-mix-tick-error", diagnosticErrorDetails(error));
        reportCrowdLiveEvent("preview.mix.error", diagnosticErrorDetails(error));
        stopTransitionPreviewPlayback(error instanceof Error ? error.message : "Private transition stopped safely");
      }
    }, 50);
  };
  const readDeckMeter = (id: DeckId): AssistedMeterSnapshot => {
    const graph = graphs.current[id];
    const audioContext = context.current;
    if (!graph || !audioContext) return { rms: 0, peak: 0, bassRatio: 0, brightness: 0 };
    graph.meter.getFloatTimeDomainData(graph.meterTime);
    graph.meter.getFloatFrequencyData(graph.meterFrequency);
    let squareSum = 0;
    let peak = 0;
    for (const sample of graph.meterTime) {
      squareSum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    let totalPower = 0;
    let bassPower = 0;
    let highPower = 0;
    const binHz = audioContext.sampleRate / graph.meter.fftSize;
    for (let index = 1; index < graph.meterFrequency.length; index += 1) {
      const decibels = graph.meterFrequency[index];
      if (!Number.isFinite(decibels)) continue;
      const power = 10 ** (decibels / 10);
      const hertz = index * binHz;
      totalPower += power;
      if (hertz <= 220) bassPower += power;
      if (hertz >= 2_500) highPower += power;
    }
    return {
      rms: Math.sqrt(squareSum / Math.max(1, graph.meterTime.length)),
      peak,
      bassRatio: totalPower > 0 ? bassPower / totalPower : 0,
      brightness: totalPower > 0 ? highPower / totalPower : 0,
    };
  };
  useEffect(() => {
    let cancelled = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const reactionTimers = new Set<ReturnType<typeof setTimeout>>();
    const refreshListenerCount = () => setCrowdListeners([...crowdPeers.current.values()].filter((peer) => peer.connectionState === "connected").length);
    const closePeer = (clientId: string) => {
      crowdPeers.current.get(clientId)?.close();
      crowdPeers.current.delete(clientId);
      crowdPeerStartedAt.current.delete(clientId);
      crowdPendingIce.current.delete(clientId);
      refreshListenerCount();
    };
    const offerMasterTo = async (clientId: string) => {
      try {
        const existing = crowdPeers.current.get(clientId);
        const existingAge = Date.now() - (crowdPeerStartedAt.current.get(clientId) ?? 0);
        if (existing && crowdPeerCanContinue(existing.connectionState, existingAge)) return;
        closePeer(clientId);
        const peer = new RTCPeerConnection(crowdRtcConfiguration());
        crowdPeers.current.set(clientId, peer);
        crowdPeerStartedAt.current.set(clientId, Date.now());
        const { stream } = ensureMasterOutputs();
        for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
        peer.onicecandidate = (event) => {
          if (event.candidate) void postDjCrowdEvent({ type: "dj-ice", clientId: "dj", targetId: clientId, data: event.candidate.toJSON() });
        };
        peer.onconnectionstatechange = () => {
          refreshListenerCount();
          void postDjCrowdEvent({
            type: "dj-peer-state",
            clientId: "dj",
            targetId: clientId,
            data: { state: peer.connectionState },
          }).catch(() => undefined);
          if (peer.connectionState === "failed" || peer.connectionState === "closed") closePeer(clientId);
        };
        const offer = await peer.createOffer({ offerToReceiveAudio: false });
        // Music-grade Opus for the crowd leg: in-band FEC, stereo, 256k
        // ceiling - a lost WiFi packet becomes a smudge, not a hole.
        const hardenedOffer = { type: offer.type, sdp: strengthenCrowdOpusSdp(offer.sdp ?? "") } as RTCSessionDescriptionInit;
        await peer.setLocalDescription(hardenedOffer);
        await waitForCrowdIceGathering(peer);
        const gatheredOffer = peer.localDescription
          ? { type: peer.localDescription.type, sdp: strengthenCrowdOpusSdp(peer.localDescription.sdp ?? "") }
          : hardenedOffer;
        await postDjCrowdEvent({ type: "offer", clientId: "dj", targetId: clientId, data: gatheredOffer });
      } catch (error) {
        closePeer(clientId);
        const message = error instanceof Error ? `${error.name}: ${error.message}` : "The browser could not start the live mix";
        await postDjCrowdEvent({ type: "dj-error", clientId: "dj", targetId: clientId, data: { message } }).catch(() => undefined);
        throw error;
      }
    };
    const addReaction = (event: CrowdLinkEvent, acknowledge = true) => {
      const data = event.data as { emoji?: unknown; reactionId?: unknown } | null;
      if (!data || typeof data.emoji !== "string" || data.emoji.length > 12) return;
      const id = typeof data.reactionId === "string" ? data.reactionId : `${event.clientId}-${event.sequence}`;
      const reaction: CrowdReaction = {
        id,
        emoji: data.emoji,
        left: 7 + Math.random() * 86,
        drift: -42 + Math.random() * 84,
        receivedAt: Date.now(),
      };
      setCrowdReactions((current) => [...current.filter((item) => item.id !== id).slice(-29), reaction]);
      if (acknowledge) {
        void postDjCrowdEvent({
          type: "reaction-ack",
          clientId: "dj",
          targetId: event.clientId,
          data: { emoji: data.emoji, reactionId: id },
        });
      }
      const reactionTimer = setTimeout(() => {
        setCrowdReactions((current) => current.filter((item) => item.id !== id));
        reactionTimers.delete(reactionTimer);
      }, 5200);
      reactionTimers.add(reactionTimer);
    };
    const poll = async () => {
      try {
        crowdBroadcasterId.current ||= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const visible = document.visibilityState === "visible" ? "1" : "0";
        const broadcasting = DECK_IDS.some((id) => {
          const audio = activeAudio(id);
          return Boolean(audio && !audio.paused);
        }) ? "1" : "0";
        const response = await fetch(`/api/crowd-edge?role=dj&djId=${encodeURIComponent(crowdBroadcasterId.current)}&visible=${visible}&broadcasting=${broadcasting}&after=${cursor}&wait=1`, { cache: "no-store" });
        if (!response.ok) throw new Error("Crowd link unavailable");
        const payload = await response.json() as { cursor: number; events: CrowdLinkEvent[]; active?: boolean };
        consecutiveFailures = 0;
        cursor = payload.cursor;
        for (const event of payload.events) {
          if (event.type === "reaction") {
            addReaction(event, payload.active !== false);
            continue;
          }
          if (payload.active === false) continue;
          if (event.type === "audience-ready") await offerMasterTo(event.clientId);
          else if (event.type === "audience-left") closePeer(event.clientId);
          else if (event.type === "answer") {
            const peer = crowdPeers.current.get(event.clientId);
            if (!peer || peer.signalingState === "closed") continue;
            await peer.setRemoteDescription(event.data as RTCSessionDescriptionInit);
            for (const candidate of crowdPendingIce.current.get(event.clientId) ?? []) await peer.addIceCandidate(candidate).catch(() => undefined);
            crowdPendingIce.current.delete(event.clientId);
          } else if (event.type === "crowd-ice") {
            const peer = crowdPeers.current.get(event.clientId);
            const candidate = event.data as RTCIceCandidateInit;
            if (peer?.remoteDescription) await peer.addIceCandidate(candidate).catch(() => undefined);
            else crowdPendingIce.current.set(event.clientId, [...crowdPendingIce.current.get(event.clientId) ?? [], candidate]);
          }
        }
      } catch {
        consecutiveFailures += 1;
        // Keep polling; the booth itself must remain usable if a listener disconnects.
      } finally {
        if (!cancelled) timer = setTimeout(poll, Math.max(250, crowdPollRetryDelay(consecutiveFailures)));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      reactionTimers.forEach((reactionTimer) => clearTimeout(reactionTimer));
      crowdPeers.current.forEach((peer) => peer.close());
      crowdPeers.current.clear();
      crowdPeerStartedAt.current.clear();
      crowdPendingIce.current.clear();
    };
  }, []);
  const applyControls = async (id: DeckId, state: DeckState, routingChanged: boolean) => {
    const graph = await ensureGraph(id);
    const now = context.current?.currentTime ?? 0;
    routeActiveEffect(graph, state.fx);
    graph.low.gain.setTargetAtTime(state.low, now, .008); graph.mid.gain.setTargetAtTime(state.mid, now, .008); graph.high.gain.setTargetAtTime(state.high, now, .008);
    const wet = state.fx === "none" ? 0 : state.wet;
    graph.dry.gain.setTargetAtTime(1 - wet * .35, now, .008);
    graph.echoWet.gain.setTargetAtTime(state.fx === "echo" ? wet * .65 : 0, now, .008); graph.reverbWet.gain.setTargetAtTime(state.fx === "reverb" ? wet * .65 : 0, now, .008); graph.phaserWet.gain.setTargetAtTime(state.fx === "phaser" ? wet * .65 : 0, now, .008); graph.driveWet.gain.setTargetAtTime(state.fx === "drive" ? wet * .65 : 0, now, .008);
    if (routingChanged) applyRouting();
  };
  // DJ, 28 Aug 2026: what a recorded set keeps of a deck patch — every dial,
  // fader, EQ, tempo and loop move, so replay moves them exactly as you did.
  // Deliberately absent: currentTime (the transport tick fires it ~15x a second
  // per playing deck and buried the real moves), and playing/cuePreviewing,
  // which replay performs through the transport and stab callbacks rather than
  // restoring as state — a state patch lights the button on a silent deck.
  const RECORDABLE_DECK_FIELDS = ["volume", "low", "mid", "high", "fx", "wet", "tempoRate", "cuePoint", "loopStart", "loopEnd", "loopActive", "loopSize", "cue"] as const;
  const changeDeck = (id: DeckId, patch: Partial<DeckState>) => {
    if ("track" in patch && patch.track?.id !== decksCurrent.current[id].track?.id) {
      bufferedDecks.current[id]?.transport.dispose();delete bufferedDecks.current[id];
      const graph=graphs.current[id],ctx=context.current;if(graph&&ctx){graph.mainInput.gain.setValueAtTime(activeMedia.current[id]===0?1:0,ctx.currentTime);graph.shadowInput.gain.setValueAtTime(activeMedia.current[id]===1?1:0,ctx.currentTime);}
      delete playbackCues.current[id];
      delete liveBassOverride.current[id];
      lowBeforeKill.current[id] = 0;
    }
    if (patch.low !== undefined) {
      patch = { ...patch, low: overriddenBassLow(patch.low, liveBassOverride.current[id], lowBeforeKill.current[id]) };
    }
    if (isRecording()) {
      const data: Record<string, unknown> = {};
      for (const key of RECORDABLE_DECK_FIELDS) if (key in patch) data[key] = (patch as Record<string, unknown>)[key];
      if ("track" in patch) data.trackId = patch.track ? patch.track.id : null;
      if (Object.keys(data).length) recordAction({ kind: "deck-patch", deck: id, data });
    }
    const nextDeck = { ...decksCurrent.current[id], ...patch };
    const next = { ...decksCurrent.current, [id]: nextDeck };
    decksCurrent.current = next;
    const buffered=bufferedDecks.current[id]?.transport;
    if(buffered){
      if("loopActive" in patch||"loopStart" in patch||"loopEnd" in patch)buffered.configureLoop(nextDeck.loopActive,nextDeck.loopStart,nextDeck.loopEnd);
      if(patch.tempoRate!==undefined)buffered.playbackRate=patch.tempoRate;
      if(patch.playing===false)buffered.pause();
    }
    setDecks(next);
    if(patch.loopActive===true&&!buffered)void ensureBufferedLoop(id).catch(error=>setLoopTeachingStatus(current=>({...current,[id]:`Loop audio: ${String(error)}`})));
    const keys = Object.keys(patch);
    if (keys.some((key) => ["volume", "low", "mid", "high", "fx", "wet"].includes(key)) && nextDeck.track) void applyControls(id, nextDeck, keys.includes("volume"));
    else if (keys.some((key) => ["track", "cue"].includes(key))) applyRouting();
  };
  const transitionEqOwnership = (runtime: DemoRuntime) => runtime.manualEqTransitionIndex === runtime.transitionIndex
    ? runtime.manualEqOwnership ?? {}
    : {};
  const changeDeckWithAutomatedEq = (runtime: DemoRuntime, id: DeckId, patch: Partial<DeckState>) => {
    const current = decksCurrent.current[id];
    const resolvedEq = mergeTransitionAutomatedEq(
      transitionEqOwnership(runtime),
      id,
      { low: current.low, mid: current.mid, high: current.high },
      {
        low: patch.low ?? current.low,
        mid: patch.mid ?? current.mid,
        high: patch.high ?? current.high,
      },
    );
    changeDeck(id, { ...patch, ...resolvedEq });
  };
  const changeDeckFromBooth = (id: DeckId, patch: Partial<DeckState>) => {
    if (patch.low !== undefined) delete liveBassOverride.current[id];
    const runtime = demoRuntime.current;
    const eqPatch = { low: patch.low, mid: patch.mid, high: patch.high };
    const claimsEq = Object.values(eqPatch).some((value) => Number.isFinite(value));
    if (runtime && assistedPlaying.current && claimsEq) {
      const outgoing = runtime.prepared.plan.tracks[runtime.transitionIndex];
      const incoming = runtime.prepared.plan.tracks[runtime.transitionIndex + 1];
      const loadedTrackId = decksCurrent.current[id].track?.id;
      if (loadedTrackId && (outgoing?.deck === id && outgoing.id === loadedTrackId || incoming?.deck === id && incoming.id === loadedTrackId)) {
        const priorOwnership = transitionEqOwnership(runtime);
        runtime.manualEqTransitionIndex = runtime.transitionIndex;
        runtime.manualEqOwnership = claimTransitionManualEq(priorOwnership, id, eqPatch);
        reportCrowdLiveEvent("transition.eq-manual-claimed", {
          transitionIndex: runtime.transitionIndex,
          deck: id,
          trackId: loadedTrackId,
          bands: Object.entries(eqPatch).filter(([, value]) => Number.isFinite(value)).map(([band]) => band),
          timingAutomationContinues: true,
        });
      }
    }
    changeDeck(id, patch);
  };
  const cueUndoSnapshot = (id: DeckId): CueUndoSnapshot | null => {
    const deck = decksCurrent.current[id];
    if (!deck.track) return null;
    return {
      trackId: deck.track.id,
      deck: {
        analysis: deck.analysis,
        tempoRate: deck.tempoRate,
        cuePoint: deck.cuePoint,
        loopSize: deck.loopSize,
        loopStart: deck.loopStart,
        loopEnd: deck.loopEnd,
        loopActive: deck.loopActive,
      },
      customLoopStart: customLoopStarts[id],
      customLoopPurpose: customLoopPurposes[id],
    };
  };
  const rememberCueUndo = (id: DeckId, snapshot = cueUndoSnapshot(id)) => {
    if (!snapshot) return;
    const next = { ...cueUndoCurrent.current, [id]: [...cueUndoCurrent.current[id], snapshot] };
    cueUndoCurrent.current = next;
    setCueUndo(next);
  };
  const rememberLoadedTrack = (id: DeckId, trackId: string | null) => {
    const saved = JSON.parse(localStorage.getItem("crowd2-loaded-tracks") ?? "{}") as Partial<Record<DeckId, string>>;
    if (trackId) saved[id] = trackId; else delete saved[id];
    localStorage.setItem("crowd2-loaded-tracks", JSON.stringify(saved));
  };
  const deckRecycleBlockReason = (id: DeckId) => {
    if (decksCurrent.current[id].playing || activeAudio(id) && !activeAudio(id)!.paused) {
      return `Deck ${id} is playing · pause it or wait until it has mixed out before replacing it`;
    }
    if (!assistedPlaying.current) return null;
    const runtime = demoRuntime.current;
    // No runtime means no plan, so there is no armed sequence for this deck to
    // be part of. Refusing here was a dead end: the launch path sets
    // assistedPlaying while clearing the runtime, so a launch that never
    // reached its runtime left every deck permanently unloadable with nothing
    // left running to release them. The deck's own transport is checked above,
    // which is the part that actually needs protecting.
    if (!runtime) return null;
    const loadedTrackId = decksCurrent.current[id].track?.id;
    if (loadedTrackId) {
      const planned = runtime.prepared.plan.tracks.some((track) => track.deck === id && track.id === loadedTrackId);
      if (planned && assistedPlannedTrackIsReleased(runtime.prepared.plan.tracks, runtime.transitionIndex, id, loadedTrackId)) return null;
    }
    const remainsArmed = runtime.prepared.plan.tracks
      .slice(runtime.transitionIndex)
      .some((planned) => planned.deck === id);
    if (!remainsArmed) return null;
    const current = runtime.prepared.plan.tracks[runtime.transitionIndex];
    return `Deck ${id} is still armed in the live assisted sequence${current ? ` while ${current.name} is primary` : ""} · wait until it has mixed out before replacing it`;
  };
  const assistedDeckCanBeRecycled = (id: DeckId) => !deckRecycleBlockReason(id);
  const assertAssistedDeckCanBeRecycled = (id: DeckId) => {
    const reason = deckRecycleBlockReason(id);
    if (!reason) return;
    throw new Error(reason);
  };
  /**
   * A new load on the deck is a new attempt. Its audio state starts from what
   * the deck's media element really says (a kept transport is already loaded).
   */
  const beginDeckLoad = (id: DeckId, track: Track, analysis: DeckLoadAnalysis, audioAlreadyLoaded = false) => {
    const attempt = deckLoadAttempts.current[id] + 1;
    deckLoadAttempts.current[id] = attempt;
    const media = mediaRefs[id][0].current;
    const mediaReady = audioAlreadyLoaded && mediaReadyForTrack(media, track) && (media?.readyState ?? 0) >= 3;
    const mediaDuration = media && mediaReady && Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
    setDeckLoads((current) => ({
      ...current,
      [id]: { attempt, trackId: track.id, trackName: track.name, startedAt: Date.now(), audio: { state: mediaReady ? "ready" : "loading", duration: mediaDuration ?? (track.duration > 0 ? track.duration : null), error: null }, analysis },
    }));
    return attempt;
  };
  /** The analysis side of the load for exactly this tune on this deck; an update for another tune is dropped. */
  const setDeckLoadAnalysis = (id: DeckId, trackId: string, analysis: DeckLoadAnalysis) => {
    setDeckLoads((current) => {
      const load = current[id];
      if (!load || load.trackId !== trackId) return current;
      return { ...current, [id]: { ...load, analysis } };
    });
  };
  /** The deck's own audio element reporting in: its real length and whether it can play. */
  const noteDeckMedia = (id: DeckId, media: HTMLAudioElement, kind: DeckMediaEvent) => {
    const track = decksCurrent.current[id].track;
    const source = media.currentSrc || media.getAttribute("src") || "";
    if (!track || !source || !(source === track.audio || source.endsWith(track.audio))) return;
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
    const failure = media.error ? ["", "loading was aborted", "network error", "could not decode", "format not supported"][media.error.code] ?? "media error" : "media error";
    setDeckLoads((current) => {
      const load = current[id];
      if (!load || load.trackId !== track.id) return current;
      const audio: DeckLoad["audio"] = kind === "error"
        ? { state: "error", duration: load.audio.duration, error: failure }
        : kind === "canplay" || media.readyState >= 3
          ? { state: "ready", duration: duration ?? load.audio.duration, error: null }
          : { ...load.audio, duration: duration ?? load.audio.duration };
      return { ...current, [id]: { ...load, audio } };
    });
  };
  /**
   * Park a freshly loaded, untouched deck at its auto-selected mix-in cue, so
   * the tune sits ready on the entry point instead of at 0:00. Only ever moves
   * a deck that is paused, not cue-previewing and still at the load position —
   * the moment the DJ plays, previews or seeks, the playhead is theirs and an
   * analysis arriving late must not yank it. The media elements may still be
   * loading their new src, so the seek waits for metadata when it has to.
   */
  const parkLoadedDeckAtCue = (id: DeckId, cue: number | null) => {
    if (cue === null || !Number.isFinite(cue) || cue <= 0) return;
    const deck = decksCurrent.current[id];
    if (deck.playing || deck.cuePreviewing || deck.currentTime !== 0) return;
    changeDeck(id, { currentTime: cue });
    for (const mediaRef of mediaRefs[id]) {
      const media = mediaRef.current;
      if (!media) continue;
      const place = () => {
        const latest = decksCurrent.current[id];
        // A later load or a manual move re-owns the playhead; leave it alone.
        if (latest.playing || latest.cuePreviewing || Math.abs(latest.currentTime - cue) > .01) return;
        if (Math.abs(media.currentTime - cue) > .025) media.currentTime = cue;
      };
      if (media.readyState >= 1) place();
      else media.addEventListener("loadedmetadata", place, { once: true });
    }
  };
  const loadTrack = async (id: DeckId, track: Track, approvedAnalysis?: Analysis | null, restoreAssistedWindows = false, analyseAfterLoad = false, options: LoadTrackOptions = {}) => {
    if (isRecording() && track.id.startsWith("upload-")) recordAction({ kind: "load", deck: id, trackId: track.id, data: { trackName: track.name } });
    // DJ, 25 Aug, until further notice: every tune loaded gets its stored
    // analysis WIPED — taught windows included, at his explicit direction —
    // and a fresh mapping from the drums stem. Once per tune per session, or
    // a reload of the same tune would burn another 40-90s analysis.
    if (track.id.startsWith("upload-") && !freshAnalysisWiped.current.has(track.id)) { // wipe-and-fresh runs regardless of the stem-listening toggle (DJ, 26 Aug rollout)
      freshAnalysisWiped.current.add(track.id);
      setLoopTeachingStatus((current) => ({ ...current, [id]: `FRESH ANALYSIS · wiping stored grid for ${track.name} · re-analysing from the drums stem` }));
      await fetch(`/api/map?id=${encodeURIComponent(track.id)}`, { method: "DELETE" }).catch(() => undefined);
      approvedAnalysis = null;
      track = { ...track, mapped: false, analysis: "" };
      reportCrowdLiveEvent("deck.analysis.wiped", { deck: id, trackId: track.id });
    }
    const replacingTrack = decksCurrent.current[id].track?.id !== track.id;
    reportCrowdLiveEvent("deck.load.requested", {
      deck: id,
      trackId: track.id,
      trackName: track.name,
      replacingTrack,
      preserveTransportRequested: Boolean(options.preserveTransport),
      analysisSupplied: Boolean(approvedAnalysis),
    });
    if (replacingTrack) {
      assertAssistedDeckCanBeRecycled(id);
      endPitchHold(id, false);
      if (assistedPlaying.current) assistedReplaySnapshot.current = null;
    }
    const immediateFreshAnalysis = approvedAnalysis ? withLearnedCuePredictions(approvedAnalysis, null) : null;
    const immediateAnalysis = immediateFreshAnalysis && restoreAssistedWindows
      ? withRestoredManualWindows(immediateFreshAnalysis, approvedAnalysis!)
      : immediateFreshAnalysis;
    const preserveTransport = Boolean(options.preserveTransport && decksCurrent.current[id].track?.audio === track.audio);
    if (preserveTransport) {
      const current = decksCurrent.current[id];
      changeDeck(id, { track, analysis: immediateAnalysis ?? current.analysis });
    } else {
      const previousLocalUrl = localAudioUrls.current[id];
      if (previousLocalUrl && previousLocalUrl !== track.audio) {
        URL.revokeObjectURL(previousLocalUrl);
        delete localAudioUrls.current[id];
      }
      teachingSessionTrack.current[id] = null;
      delete playbackCues.current[id];
      playCueTokens.current[id] += 1;
      delete playCuePreviews.current[id];
      cancelLoopTransition(id);
      for (const mediaRef of mediaRefs[id]) { mediaRef.current?.pause(); if (mediaRef.current) { mediaRef.current.currentTime = 0; mediaRef.current.playbackRate = 1; } }
      activeMedia.current[id] = 0;
      loopCycleArmed.current[id] = false;
      const graph = graphs.current[id];
      if (graph && context.current) { graph.mainInput.gain.setValueAtTime(1, context.current.currentTime); graph.shadowInput.gain.setValueAtTime(0, context.current.currentTime); }
      const taughtCue = immediateAnalysis ? taughtDeckCue(immediateAnalysis) : null;
      const predictedCue = immediateAnalysis && taughtCue !== null ? seatCueOnGrid(immediateAnalysis, taughtCue) : null;
      // A deck that has been mixed out is left with its EQ cut to -60 so the
      // outgoing tune vanishes cleanly. Decks are recycled every rotation, so a
      // fresh tune inherited that cut and played to nobody: transport running,
      // volume up, meters moving, total silence in the booth and to the crowd.
      // A new track always starts from a neutral channel.
      changeDeck(id, { track, analysis: immediateAnalysis, currentTime: 0, playing: false, cuePreviewing: false, tempoRate: 1, cuePoint: predictedCue, loopStart: null, loopEnd: null, loopActive: false, volume: SAFE_LOADED_DECK_VOLUME, low: 0, mid: 0, high: 0 });
      setCustomLoopStarts((current) => ({ ...current, [id]: null }));
      setCustomLoopPurposes((current) => ({ ...current, [id]: null }));
      setFullIntroTracks((current) => ({ ...current, [id]: null }));
      setCueUndo((current) => ({ ...current, [id]: [] }));
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Locating ${track.name} · preparing Deck ${id}` }));
      setCueTeachingStatus((current) => ({ ...current, [id]: "" }));
      setOverviewZoom((current) => ({ ...current, [id]: 1 }));
      for (const mediaRef of mediaRefs[id]) {
        const media = mediaRef.current;
        if (!media) continue;
        if (media.getAttribute("src") !== track.audio) media.src = track.audio;
        media.load();
      }
      // A tune loads cued to its auto-selected mix-in point when one is
      // already known; when analysis arrives later, the ready-handlers below
      // do the same for a deck nobody has touched in the meantime. The
      // MARKER may carry a learned guess (predictedCue); the PARK only
      // follows a placed cue.
      parkLoadedDeckAtCue(id, immediateAnalysis ? (() => { const cue = placedEntryCue(immediateAnalysis); return cue === null ? null : seatCueOnGrid(immediateAnalysis, cue); })() : null);
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Loading audio · ${track.name}` }));
      void ensureGraph(id, false);
    }
    // A new attempt on this deck, starting from what is really known: supplied
    // analysis, a saved one to download, a mapping to request, or none yet.
    const savedAtStart = Boolean(!immediateAnalysis && track.mapped);
    beginDeckLoad(id, track, immediateAnalysis
      ? { state: "ready", update: null, saved: true, at: Date.now() }
      : savedAtStart
        ? { state: "fetching", update: null, saved: true, startedAt: Date.now() }
        : analyseAfterLoad
          ? { state: "mapping", update: null }
          : { state: "waiting", note: options.analysisNote ?? "No analysis has been requested for this load yet" }, preserveTransport);
    options.onAttached?.();
    if (options.remember !== false) rememberLoadedTrack(id, track.id);
    reportCrowdLiveEvent("deck.audio.loaded", {
      deck: id,
      trackId: track.id,
      preserveTransport,
      safetyVolume: decksCurrent.current[id].volume,
      analysisReady: Boolean(immediateAnalysis),
    });

    let analysisTrack = track;
    let rawAnalysis = approvedAnalysis ?? null;
    let lastUpdate: MappingUpdate | null = null;
    if (!rawAnalysis && !analysisTrack.mapped && analyseAfterLoad) {
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio loaded · mapping waveform, BPM, beats and downbeats for ${track.name}…` }));
      try {
        analysisTrack = await ensureMapped(
          analysisTrack,
          (update) => {
            if (decksCurrent.current[id].track?.id !== track.id) return;
            lastUpdate = update;
            setDeckLoadAnalysis(id, track.id, { state: "mapping", update });
            setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio loaded · ${describeMappingUpdate(update, Date.now())}` }));
          },
          () => decksCurrent.current[id].track?.id !== track.id,
          DECK_IDS.some((deckId) => decksCurrent.current[deckId].playing),
        );
        setTracks((known) => known.map((item) => item.id === analysisTrack.id ? analysisTrack : item));
      } catch (error) {
        reportCrowdLiveEvent("deck.analysis.failed", { deck: id, trackId: track.id, ...diagnosticErrorDetails(error) });
        if (decksCurrent.current[id].track?.id === track.id) {
          const detail = error instanceof Error ? error.message : "analysis stopped";
          setDeckLoadAnalysis(id, track.id, { state: "failed", error: detail, update: lastUpdate });
          setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio is loaded, but waveform/BPM analysis stopped: ${detail}` }));
        }
        return;
      }
      // No job snapshot at all means the server already had this tune mapped: a saved analysis, not one that just ran.
      setDeckLoadAnalysis(id, track.id, { state: "fetching", update: lastUpdate, saved: !(lastUpdate as MappingUpdate | null)?.snapshot, startedAt: Date.now() });
    }
    if (!rawAnalysis && analysisTrack.mapped) {
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio loaded · loading saved waveform, BPM and grid for ${track.name}…` }));
      rawAnalysis = await fetchTrackAnalysis<Analysis>(analysisTrack.analysis)
        .catch(() => null);
    }
    if (!rawAnalysis || decksCurrent.current[id].track?.id !== track.id) {
      if (decksCurrent.current[id].track?.id === track.id && (analyseAfterLoad || analysisTrack.mapped)) {
        setDeckLoadAnalysis(id, track.id, { state: "failed", error: `No waveform/BPM analysis was returned for ${track.name}`, update: lastUpdate });
      }
      if (analyseAfterLoad && decksCurrent.current[id].track?.id === track.id) {
        setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio is loaded, but no waveform/BPM analysis was returned for ${track.name}.` }));
      }
      return;
    }
    const predictionProfile = await fetch(`/api/dj-library/teaching?exclude=${encodeURIComponent(track.id)}`, { cache: "no-store" })
      .then(async (response): Promise<{ profile?: TeachingProfile }> => response.ok ? response.json() : { profile: undefined })
      .then((payload) => payload.profile ?? null)
      .catch(() => null);
    if (decksCurrent.current[id].track?.id !== track.id) return;
    const freshAnalysis = withLearnedCuePredictions(rawAnalysis, predictionProfile);
    const analysis = restoreAssistedWindows
      ? withRestoredManualWindows(freshAnalysis, rawAnalysis)
      : freshAnalysis;
    // Under stem-only, the mapped track from the server carries the plain
    // audio URL - adopting it verbatim flipped the deck back to the full mix
    // and forced a fresh 100 MB stem download when the watcher swapped it
    // back. The stem URL the deck already plays survives analysis adoption.
    const keepStemAudio = track.audio?.includes("stem=") ? track.audio : null;
    const deckTrack = preserveTransport || keepStemAudio ? { ...analysisTrack, audio: keepStemAudio ?? track.audio } : analysisTrack;
    const resolvedCue = decksCurrent.current[id].cuePoint ?? taughtDeckCue(analysis);
    changeDeck(id, {
      track: deckTrack,
      analysis,
      cuePoint: resolvedCue,
    });
    parkLoadedDeckAtCue(id, (() => { const cue = placedEntryCue(analysis); return cue === null ? null : seatCueOnGrid(analysis, cue); })());
    setDeckLoadAnalysis(id, track.id, { state: "ready", update: lastUpdate, saved: savedAtStart || Boolean(immediateAnalysis) || !(lastUpdate as MappingUpdate | null)?.snapshot, at: Date.now() });
    setLoopTeachingStatus((current) => ({ ...current, [id]: `Waveform, BPM, beats and downbeats ready · ${analysisTrack.name}` }));
    reportCrowdLiveEvent("deck.analysis.ready", {
      deck: id,
      trackId: analysisTrack.id,
      duration: analysis.duration,
      beats: analysis.beats.length,
      bpm: resolvedBpmAt(analysis, 0),
    });
  };
  const hydrateLoadedTrackAnalysis = (id: DeckId, track: Track, analysis: Analysis) => {
    const current = decksCurrent.current[id];
    if (current.track?.id !== track.id) return false;
    const resolvedCue = current.cuePoint ?? taughtDeckCue(analysis);
    changeDeck(id, {
      track,
      analysis,
      cuePoint: resolvedCue,
    });
    parkLoadedDeckAtCue(id, (() => { const cue = placedEntryCue(analysis); return cue === null ? null : seatCueOnGrid(analysis, cue); })());
    setDeckLoads((loads) => {
      const load = loads[id];
      if (!load || load.trackId !== track.id) return loads;
      const update = "update" in load.analysis ? load.analysis.update : null;
      const saved = load.analysis.state === "fetching" || load.analysis.state === "ready" ? load.analysis.saved : false;
      return { ...loads, [id]: { ...load, analysis: { state: "ready", update, saved, at: Date.now() } } };
    });
    setLoopTeachingStatus((statuses) => ({ ...statuses, [id]: `Waveform, BPM, beats and downbeats ready · ${track.name}` }));
    rememberLoadedTrack(id, track.id);
    return true;
  };
  const openTrackPicker = (id: DeckId) => {
    setWorkflowDeck(id);
    const blocked = deckRecycleBlockReason(id);
    if (blocked) {
      setAssistedStatus(blocked);
      setLoopTeachingStatus((current) => ({ ...current, [id]: blocked }));
      return;
    }
    setPickerSearch("");
    setPickerLoadingTrackId(null);
    setPicker(id);
  };
  const finishStoppedSilentOutgoingForLoad = (id: DeckId) => {
    const runtime = demoRuntime.current;
    if (!runtime || runtime.busy || !assistedPlaying.current) return false;
    const outgoing = runtime.prepared.plan.tracks[runtime.transitionIndex];
    const incoming = runtime.prepared.plan.tracks[runtime.transitionIndex + 1];
    const deck = decksCurrent.current[id];
    const outgoingAudio = activeAudio(id);
    const incomingAudio = incoming ? activeAudio(incoming.deck) : null;
    const matchesOutgoing = outgoing?.deck === id && outgoing.id === deck.track?.id;
    const outgoingStoppedAndSilent = !deck.playing && (!outgoingAudio || outgoingAudio.paused) && deck.volume <= .001;
    const incomingHasTakenOver = Boolean(incomingAudio && (!incomingAudio.paused || incomingAudio.ended));
    if (!matchesOutgoing || !outgoingStoppedAndSilent || !incomingHasTakenOver) return false;
    // The room is already hearing only the incoming deck, so the normal
    // 75 ms exit ramp has nothing left to protect. Completing the handoff
    // synchronously advances the plan before the browser must open its file
    // chooser in this same click gesture. This prevents a stopped, zero-fader
    // outgoing deck from being stranded behind a stale runway runtime.
    void finishDemoBlend(runtime, { alreadySilent: true }).catch((error: unknown) => {
      reportCrowdLiveEvent("transition.silent-recycle-failed", {
        deck: id,
        ...diagnosticErrorDetails(error),
      });
    });
    return true;
  };
  const openLocalFile = (id: DeckId) => {
    finishStoppedSilentOutgoingForLoad(id);
    const blocked = deckRecycleBlockReason(id);
    if (blocked) {
      setAssistedStatus(blocked);
      setLoopTeachingStatus((current) => ({ ...current, [id]: blocked }));
      return;
    }
    fileLoadDeck.current = id;
    setWorkflowDeck(id);
    fileInput.current?.click();
  };
  const loadLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const id = fileLoadDeck.current;
    const blocked = deckRecycleBlockReason(id);
    if (blocked) {
      setAssistedStatus(blocked);
      setLoopTeachingStatus((current) => ({ ...current, [id]: blocked }));
      return;
    }
    setPicker(null);
    const localAudioUrl = URL.createObjectURL(file);
    const provisionalTrack: Track = {
      id: `local-${crypto.randomUUID()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      file: file.name,
      duration: 0,
      album: "Local selection",
      source: "uploaded",
      mapped: false,
      audio: localAudioUrl,
      analysis: "",
    };
    try {
      await file.slice(0, Math.min(file.size, 64)).arrayBuffer();
      await loadTrack(id, provisionalTrack, undefined, false, false, { remember: false, analysisNote: "Saving the file to the booth first · analysis starts once it is saved" });
      localAudioUrls.current[id] = localAudioUrl;
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Audio ready now · saving and mapping ${file.name} in the background` }));
      const response = await uploadLocalTrackFile(file, {
        onRetry: (nextAttempt, totalAttempts, delayMs, retryError) => {
          reportCrowdLiveEvent("deck.upload.retry", {
            deck: id,
            fileName: file.name,
            nextAttempt,
            totalAttempts,
            delayMs,
            ...diagnosticErrorDetails(retryError),
          });
          if (decksCurrent.current[id].track?.id === provisionalTrack.id) {
            setLoopTeachingStatus((current) => ({
              ...current,
              [id]: `Audio remains playable · Crowd connection interrupted · retrying save ${nextAttempt}/${totalAttempts}`,
            }));
          }
        },
      });
      const responseText = await response.text();
      const payload = (() => {
        try { return JSON.parse(responseText) as Track & { error?: string }; }
        catch { return { error: responseText.trim() || `Upload returned ${response.status}` } as Track & { error?: string }; }
      })();
      if (!response.ok || payload.error) throw new Error(payload.error || `Upload returned ${response.status}`);
      setTracks((known) => known.some((track) => track.id === payload.id)
        ? known.map((track) => track.id === payload.id ? payload : track)
        : [...known, payload]);
      if (decksCurrent.current[id].track?.id !== provisionalTrack.id) return;
      // DJ, 30 Aug 2026 ("wave and sound out by ~1 beat"): keeping the blob
      // married the deck - and every preview copy cloned from it - to the raw
      // VBR mp3, whose reported position lies by up to ~half a second against
      // the booth clock (measured +181 ms median on Zine Family). The server
      // source is the seek-accurate sidecar, so once the upload lands the
      // deck swaps to it - unless it is audibly PLAYING right now, where a
      // mid-note rebuffer would be worse than the lie; that deck picks up the
      // honest clock on its next load.
      const audioSource = decksCurrent.current[id].playing ? localAudioUrl : payload.audio;
      await loadTrack(id, { ...payload, audio: audioSource }, undefined, false, true, { preserveTransport: true });
    } catch (error) {
      if (decksCurrent.current[id].track?.id !== provisionalTrack.id) URL.revokeObjectURL(localAudioUrl);
      const detail = error instanceof Error ? error.message : "the selected file could not be loaded";
      const friendlyDetail = detail === "Failed to fetch"
        ? "the file could not be read or sent; make it available offline and try again"
        : detail;
      reportCrowdLiveEvent("deck.upload.failed", {
        deck: id,
        fileName: file.name,
        fileSize: file.size,
        ...diagnosticErrorDetails(error),
      });
      const failureStatus = decksCurrent.current[id].track?.id === provisionalTrack.id
        ? `Audio remains playable locally, but Crowd could not save the file · ${friendlyDetail} · press Load to retry`
        : `Load stopped · ${friendlyDetail}`;
      setLoopTeachingStatus((current) => ({ ...current, [id]: failureStatus }));
    }
  };
  const waitForMetadata = (audio: HTMLAudioElement, timeoutMs = 5000) => new Promise<void>((resolve) => {
    if (audio.readyState >= 1) { resolve(); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("loadedmetadata", finish);
      audio.removeEventListener("error", finish);
      resolve();
    };
    audio.addEventListener("loadedmetadata", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
  const setDeckRate = (id: DeckId, tempoRate: number, updateState = true) => {
    if(bufferedDecks.current[id])bufferedDecks.current[id]!.transport.playbackRate=tempoRate;
    delete tempoReturns.current[id];
    const hold = pitchHolds.current[id];
    if (hold && hold.mode === "playing" && hold.trackId === decksCurrent.current[id].track?.id) hold.latestUnderlyingRate = tempoRate;
    else mediaRefs[id].forEach((mediaRef) => {
      applyBoothPitchMode(mediaRef.current);
      if (mediaRef.current && Math.abs(mediaRef.current.playbackRate - tempoRate) > .00005) mediaRef.current.playbackRate = tempoRate;
    });
    if (updateState && Math.abs(decksCurrent.current[id].tempoRate - tempoRate) > .00005) changeDeck(id, { tempoRate });
  };
  const scheduleNaturalTempoReturn = (id: DeckId, planned: DemoTrackPlan) => {
    const audio = activeAudio(id);
    if (!audio || Math.abs(audio.playbackRate - 1) < .0005) { delete tempoReturns.current[id]; return; }
    const startTrackTime = audio.currentTime;
    const endTrackTime = Math.max(startTrackTime + .5, planned.exitRunway);
    tempoReturns.current[id] = { startRate: audio.playbackRate, startTrackTime, endTrackTime, lastAppliedAt: 0 };
    performanceStatus(`${planned.name} · easing ${(audio.playbackRate * 100).toFixed(2)}% toward natural tempo across the full playing section`);
  };
  const loadDemoDeck = async (id: DeckId, planned: DemoTrackPlan, sourceTime: number, role: "primary" | "incoming", preparedOverride?: PreparedDemo) => {
    const prepared = preparedOverride ?? preparedDemoCurrent.current;
    const track = prepared?.tracks[planned.id];
    if (!track) throw new Error(`${planned.name} is no longer available in the mapped crate`);
    playCueTokens.current[id] += 1;
    delete playCuePreviews.current[id];
    cancelLoopTransition(id);
    delete tempoReturns.current[id];
    for (const mediaRef of mediaRefs[id]) {
      const media = mediaRef.current;
      if (!media) continue;
      media.pause();
      if (!media.currentSrc.endsWith(track.audio)) { media.src = track.audio; media.load(); }
      media.playbackRate = 1;
    }
    activeMedia.current[id] = 0;
    loopCycleArmed.current[id] = false;
    const graph = graphs.current[id];
    if (graph && context.current) {
      graph.mainInput.gain.setValueAtTime(1, context.current.currentTime);
      graph.shadowInput.gain.setValueAtTime(0, context.current.currentTime);
    }
    const analysis = planned.analysis as Analysis;
    changeDeck(id, {
      track,
      analysis,
      currentTime: sourceTime,
      playing: false,
      cuePreviewing: false,
      tempoRate: 1,
      cuePoint: taughtDeckCue(analysis) ?? planned.entryDrop,
      loopStart: null,
      loopEnd: null,
      loopActive: false,
      cue: DEFAULT_DECK_CUE,
      volume: SAFE_LOADED_DECK_VOLUME,
      low: role === "primary" ? 0 : -60,
      mid: role === "primary" ? 0 : -24,
      high: role === "primary" ? 0 : -18,
      fx: "none",
      wet: .2,
    });
    await Promise.all(mediaRefs[id].map(async (mediaRef) => { if (mediaRef.current) await waitForMetadata(mediaRef.current); }));
    mediaRefs[id].forEach((mediaRef) => { if (mediaRef.current) mediaRef.current.currentTime = sourceTime; });
    rememberLoadedTrack(id, track.id);
    void ensureGraph(id, false);
  };
  const beatsAfter = (analysis: DemoAnalysis, time: number, beatCount: number) => {
    const startIndex = Math.max(0, analysis.beats.findIndex((beat) => beat.time >= time - .03));
    return analysis.beats[Math.min(analysis.beats.length - 1, startIndex + beatCount)]?.time ?? time;
  };
  const performanceStatus = (text: string) => {
    if (assistedPlaying.current) setAssistedStatus(text);
    else if (liveRunning.current) setLiveStatus(text);
    else setDemoStatus(text);
  };
  const updateDemoCountdown = (runtime: DemoRuntime, text: string, remainingTrackSeconds: number, playbackRate: number) => {
    const now = performance.now();
    if (now - runtime.lastStatusAt < 250) return;
    runtime.lastStatusAt = now;
    const seconds = Math.max(0, remainingTrackSeconds / Math.max(.25, playbackRate));
    performanceStatus(`${text} · ${seconds.toFixed(1)} SEC`);
  };
  const completeDemo = (lastTrack: DemoTrackPlan, runtime: DemoRuntime) => {
    if (demoTimer.current) clearInterval(demoTimer.current);
    demoTimer.current = null;
    demoRuntime.current = null;
    const finalKickReport = updateKickPhaseMonitor(runtime.kickPhaseMonitor ?? emptyKickPhaseMonitor(), null).report;
    reportCrowdLiveEvent("run.completed", {
      mode: assistedPlaying.current ? "assisted" : liveRunning.current ? "live" : "demo",
      lastTrackId: lastTrack.id,
      lastDeck: lastTrack.deck,
      transitionsCompleted: runtime.transitionIndex + 1,
      trackCount: runtime.prepared.plan.tracks.length,
      kickPhase: finalKickReport,
    });
    setKickPhaseStatus(`${kickPhaseReportLabel(finalKickReport)} · LAST PASS`);
    if (assistedPlaying.current) {
      assistedPlaying.current = false;
      setAssistedMode("ready");
      setAssistedStatus(runtime.prepared.plan.tracks.length > 2
        ? `${lastTrack.name} is now live on Deck ${lastTrack.deck} · the complete ${runtime.prepared.plan.tracks.length}-tune set remains ready to replay from Tune A`
        : `${lastTrack.name} is now live on Deck ${lastTrack.deck} · the same pair and windows remain ready to replay, or find the next tune`);
      return;
    }
    setDemoMode("complete");
    setDemoStatus(`DEMO COMPLETE · ${lastTrack.name} remains live on Deck ${lastTrack.deck}`);
  };
  const stopDemo = () => {
    reportCrowdLiveEvent("run.stopped", {
      mode: assistedPlaying.current ? "assisted" : liveRunning.current ? "live" : "demo",
      reason: "manual-stop",
      stage: demoRuntime.current?.stage,
      transitionIndex: demoRuntime.current?.transitionIndex,
    });
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    emergencyTimer.current = null;
    demoTimer.current = null;
    demoRuntime.current = null;
    setKickPhaseStatus("KICKS · ARMED FOR OVERLAP");
    for (const id of AUTOMATION_DECK_IDS) {
      activeAudio(id)?.pause();
      changeDeck(id, { playing: false });
    }
    if (preparedDemoCurrent.current) {
      setDemoMode("ready");
      setDemoStatus(`${preparedDemoCurrent.current.plan.title} · stopped and ready to restart`);
    }
  };
  const beginDemoRunway = async (runtime: DemoRuntime) => {
    const prepared = runtime.prepared;
    if (runtime.busy) return;
    runtime.busy = true;
    const token = demoToken.current;
    const outgoing = prepared.plan.tracks[runtime.transitionIndex];
    const incoming = prepared.plan.tracks[runtime.transitionIndex + 1];
    const wasAssisted = assistedPlaying.current;
    const wasLive = liveRunning.current;
    let outgoingAudioForSafety: HTMLAudioElement | null = null;
    let incomingAudioForFailure: HTMLAudioElement | null = null;
    try {
    const outgoingAudio = activeAudio(outgoing.deck);
    if (!outgoingAudio) throw new Error(`Deck ${outgoing.deck} has no outgoing audio player`);
    outgoingAudioForSafety = outgoingAudio;
    if (decksCurrent.current[outgoing.deck].track?.id !== outgoing.id
      || !mediaReadyForTrack(outgoingAudio, decksCurrent.current[outgoing.deck].track)) {
      throw new Error(`Deck ${outgoing.deck} no longer contains the expected outgoing audio`);
    }
    const incomingPrerollStart = assistedPlaying.current
      ? assistedCuePrerollStart(incoming.analysis, incoming.entryRunway, incoming.bpm)
      : incoming.entryRunway;
    if (decksCurrent.current[incoming.deck].track?.id !== incoming.id) await loadDemoDeck(incoming.deck, incoming, incomingPrerollStart, "incoming", prepared);
    if (token !== demoToken.current || demoRuntime.current !== runtime) return;
    const incomingAudio = activeAudio(incoming.deck);
    if (!incomingAudio) throw new Error(`Deck ${incoming.deck} has no incoming audio player`);
    if (incomingAudio === outgoingAudio
      || decksCurrent.current[incoming.deck].track?.id !== incoming.id
      || !mediaReadyForTrack(incomingAudio, decksCurrent.current[incoming.deck].track)) {
      throw new Error(`Deck ${incoming.deck} no longer contains the expected incoming audio`);
    }
    incomingAudioForFailure = incomingAudio;
    const baseRate = cueLockedTempoRate(
      outgoing.exitRunway,
      outgoing.exitHandoff,
      incoming.entryRunway,
      incoming.entryDrop,
      outgoingAudio.playbackRate,
    );
    const targetTime = sourceTimeAlignedToCue(outgoingAudio.currentTime, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop);
    incomingAudio.currentTime = targetTime;
    setDeckRate(incoming.deck, baseRate);
    await ensureGraph(incoming.deck);
    if (token !== demoToken.current || demoRuntime.current !== runtime) return;
    const incomingGraph = graphs.current[incoming.deck];
    const audioContext = context.current;
    if (incomingGraph && audioContext) {
      incomingGraph.channel.gain.cancelScheduledValues(audioContext.currentTime);
      incomingGraph.channel.gain.setValueAtTime(0, audioContext.currentTime);
    }
    await incomingAudio.play();
    // The shadow mirrors the active clock from the first audible sample, so
    // a later stem swap starts from now rather than a stale park position.
    { const incomingStandby = standbyAudio(incoming.deck); if (incomingStandby && !decksCurrent.current[incoming.deck].loopActive) incomingStandby.currentTime = incomingAudio.currentTime; }
    if (token !== demoToken.current
      || demoRuntime.current !== runtime
      || activeAudio(incoming.deck) !== incomingAudio
      || decksCurrent.current[incoming.deck].track?.id !== incoming.id) {
      incomingAudio.pause();
      return;
    }
    // Recalculate after play() resolves so browser launch latency cannot move the
    // incoming runway away from the outgoing cue pair.
    const launchLockedTime = sourceTimeAlignedToCue(outgoingAudio.currentTime, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop);
    incomingAudio.currentTime = launchLockedTime;
    const transitionAutomation = prepared.assistedAutomations?.[runtime.transitionIndex] ?? assistedOverlapAutomationCurrent.current;
    const assistedCurve = assistedPlaying.current ? assistedAutomationAtBeat(transitionAutomation, 0) : null;
    if (assistedCurve) {
      // Never inherit a silent fader: a deck at the zero safety volume would
      // hand the incoming tune nothing to arrive at.
      runtime.overlapVolume = liveHandoffVolume(decksCurrent.current[outgoing.deck].volume);
      runtime.gainCalibration = emptyAssistedGainCalibration();
      runtime.gainDecision = undefined;
    }
    changeDeckWithAutomatedEq(runtime, incoming.deck, {
      currentTime: launchLockedTime,
      playing: true,
      volume: 0,
      low: assistedCurve?.incomingLow ?? -60,
      mid: assistedCurve?.incomingMid ?? -24,
      high: assistedCurve?.incomingHigh ?? -18,
      tempoRate: baseRate,
    });
    runtime.stage = "runway";
    runtime.lastCorrectionAt = 0;
    runtime.runwayAudibleFrom = audibleRunwayPhraseEdge(incoming.analysis, incoming.entryRunway, incoming.entryDrop);
    runtime.runwayAudible = false;
    runtime.phaseLockTicks = 0;
    runtime.prerollReanchorDone = false;
    runtime.cueOpenScheduled = false;
    runtime.kickPhaseMonitor = emptyKickPhaseMonitor();
    runtime.loopExtensionBeats = 0;
    runtime.loopExtensionOutgoingSeconds = 0;
    runtime.loopExtensionIncomingSeconds = 0;
    runtime.loopWrapMemo = {};
    runtime.virtualOutgoingTime = outgoingAudio.currentTime;
    reportCrowdLiveEvent("transition.preroll-started", {
      mode: assistedPlaying.current ? "assisted" : liveRunning.current ? "live" : "demo",
      transitionIndex: runtime.transitionIndex,
      outgoingTrackId: outgoing.id,
      incomingTrackId: incoming.id,
      outgoingDeck: outgoing.deck,
      incomingDeck: incoming.deck,
      outgoingTime: outgoingAudio.currentTime,
      incomingTime: incomingAudio.currentTime,
      incomingRate: baseRate,
      // DJ, 30 Aug 2026 (the 387 BPM afternoon): both decks' true element
      // rates ride along, so a "why did it slow down" has its answer in the
      // record instead of in poll-delta archaeology.
      outgoingRate: outgoingAudio.playbackRate,
      incomingElementRate: incomingAudio.playbackRate,
      silentPrerollBeats: assistedPlaying.current ? ASSISTED_SILENT_PREROLL_BEATS : 0,
    });
    setKickPhaseStatus(assistedPlaying.current ? "GRID · SILENT PREROLL · LOCKING" : "KICKS · WAITING FOR SHARED ATTACKS");
    runtime.busy = false;
    performanceStatus(assistedPlaying.current
      ? `${incoming.name} silent ${ASSISTED_SILENT_PREROLL_BEATS}-beat preroll · grid phase bend armed · audible at Mix In`
      : `${incoming.name} runway live · bass killed · locking mapped beats before the drop`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "the incoming audio player could not start";
      const incomingDeckStillExpected = incoming.deck !== outgoing.deck
        && decksCurrent.current[incoming.deck].track?.id === incoming.id
        && activeAudio(incoming.deck) === incomingAudioForFailure;
      const failedIncomingAudio = incomingDeckStillExpected && incomingAudioForFailure !== outgoingAudioForSafety
        ? incomingAudioForFailure
        : null;
      failedIncomingAudio?.pause();
      const failedGraph = incomingDeckStillExpected ? graphs.current[incoming.deck] : null;
      const failedContext = context.current;
      if (failedGraph && failedContext) {
        failedGraph.channel.gain.cancelScheduledValues(failedContext.currentTime);
        failedGraph.channel.gain.setValueAtTime(0, failedContext.currentTime);
      }
      if (incomingDeckStillExpected) changeDeck(incoming.deck, { playing: false, volume: 0 });
      reportCrowdLiveEvent("transition.preroll-failed", {
        mode: wasAssisted ? "assisted" : wasLive ? "live" : "demo",
        transitionIndex: runtime.transitionIndex,
        outgoingTrackId: outgoing.id,
        incomingTrackId: incoming.id,
        outgoingDeck: outgoing.deck,
        incomingDeck: incoming.deck,
        ...diagnosticErrorDetails(error),
      });
      if (demoRuntime.current === runtime) {
        if (demoTimer.current) clearInterval(demoTimer.current);
        demoTimer.current = null;
        demoRuntime.current = null;
        setKickPhaseStatus("GRID · PREROLL FAILED · OUTGOING CONTINUES");
        if (wasAssisted) {
          assistedRunning.current = false;
          assistedPlaying.current = false;
          setAssistedMode("error");
          setAssistedStatus(`${incoming.name} could not start its silent preroll · ${detail} · ${outgoing.name} continues untouched`);
        } else if (wasLive) {
          liveRunning.current = false;
          liveToken.current += 1;
          if (emergencyTimer.current) clearInterval(emergencyTimer.current);
          emergencyTimer.current = null;
          setLiveMode("error");
          setLiveStatus(`${incoming.name} could not start its runway · ${detail} · ${outgoing.name} continues untouched`);
        } else {
          setDemoMode("error");
          setDemoStatus(`${incoming.name} could not start its runway · ${detail} · ${outgoing.name} continues untouched`);
        }
      }
    } finally {
      runtime.busy = false;
    }
  };
  const performDemoSkip = async (runtime: DemoRuntime, primary: DemoTrackPlan) => {
    if (runtime.busy) return;
    runtime.busy = true;
    const token = demoToken.current;
    const audio = activeAudio(primary.deck);
    const graph = graphs.current[primary.deck];
    if (!audio) { runtime.busy = false; return; }
    performanceStatus(`${primary.name} · phrase-safe jump to 64 beats before its handoff`);
    if (graph && context.current) rampAudioParam(graph.channel.gain, 0, context.current.currentTime, .055);
    await new Promise((resolve) => setTimeout(resolve, 70));
    if (token !== demoToken.current) return;
    audio.currentTime = primary.skipTo;
    changeDeck(primary.deck, { currentTime: primary.skipTo });
    await new Promise((resolve) => setTimeout(resolve, 35));
    applyRouting();
    runtime.stage = "primary";
    runtime.busy = false;
  };
  const reportAssistedRotationWait = (runtime: DemoRuntime, text: string) => {
    const now = performance.now();
    if (now - runtime.lastStatusAt < 500) return;
    runtime.lastStatusAt = now;
    setAssistedStatus(text);
  };
  const prepareNextAssistedRotation = async (runtime: DemoRuntime) => {
    if (runtime.busy || !assistedPlaying.current || !runtime.prepared.rotatingAssisted) return;
    const prepared = runtime.prepared;
    if (runtime.transitionIndex !== prepared.plan.tracks.length - 1) return;
    const outgoing = prepared.plan.tracks[runtime.transitionIndex];
    const outgoingState = decksCurrent.current[outgoing.deck];
    const outgoingAudio = activeAudio(outgoing.deck);
    if (!outgoingState.track || outgoingState.track.id !== outgoing.id || !outgoingState.analysis || !outgoingAudio) {
      reportAssistedRotationWait(runtime, `Deck ${outgoing.deck} no longer holds ${outgoing.name} · continuous rotation cannot arm the next mix`);
      return;
    }
    const nextDeck = nextAssistedDeck(outgoing.deck);
    const nextState = decksCurrent.current[nextDeck];
    const outgoingWindow = savedManualWindow(outgoingState.analysis, "outro-transition");
    if (!outgoingWindow) {
      reportAssistedRotationWait(runtime, `${outgoing.name} is live · set its Mix Out, then load and set Mix In on replacement Deck ${nextDeck}`);
      return;
    }
    if (!nextState.track || !nextState.analysis) {
      const seconds = Math.max(0, (outgoingWindow.start - outgoingAudio.currentTime) / Math.max(.25, outgoingAudio.playbackRate));
      reportAssistedRotationWait(runtime, `${outgoing.name} is live · Deck ${nextDeck} is free for the replacement tune · Mix Out runway in ${seconds.toFixed(1)} SEC`);
      return;
    }
    if (prepared.plan.tracks.some((planned) => planned.id === nextState.track!.id)) {
      reportAssistedRotationWait(runtime, `Deck ${nextDeck} still contains an already-played tune · unload it and load a fresh replacement`);
      return;
    }
    if (!savedManualWindow(nextState.analysis, "intro-loop")) {
      reportAssistedRotationWait(runtime, `${nextState.track.name} is loaded on Deck ${nextDeck} · set its Mix In before ${outgoing.name}'s Mix Out`);
      return;
    }
    const automation = assistedAutomationForTrack(nextState.track.id, nextState.analysis);
    let extendedPlan: DemoSetPlan;
    try {
      extendedPlan = extendAssistedPlaybackSequence(
        prepared.plan,
        { id: outgoingState.track.id, name: outgoingState.track.name, deck: outgoing.deck, analysis: outgoingState.analysis },
        { id: nextState.track.id, name: nextState.track.name, deck: nextDeck, analysis: nextState.analysis },
        automation,
      );
    } catch (error) {
      reportAssistedRotationWait(runtime, error instanceof Error ? error.message : "The next rotating assisted mix is not ready");
      return;
    }
    const continuedOutgoing = extendedPlan.tracks[runtime.transitionIndex];
    if (outgoingAudio.currentTime >= continuedOutgoing.exitRunway - .04) {
      reportAssistedRotationWait(runtime, `${outgoing.name}'s Mix Out runway has already started · save a fresh later Mix Out to arm ${nextState.track.name}`);
      return;
    }
    runtime.busy = true;
    const token = demoToken.current;
    const updated: PreparedDemo = {
      ...prepared,
      plan: extendedPlan,
      tracks: { ...prepared.tracks, [nextState.track.id]: nextState.track },
      assistedAutomations: [...(prepared.assistedAutomations ?? []), automation],
      rotatingAssisted: true,
    };
    const incoming = extendedPlan.tracks[runtime.transitionIndex + 1];
    try {
      await loadDemoDeck(nextDeck, incoming, assistedIncomingPrerollTime(incoming), "incoming", updated);
    } catch (error) {
      runtime.busy = false;
      reportAssistedRotationWait(runtime, error instanceof Error ? error.message : `Deck ${nextDeck} could not arm the replacement tune`);
      return;
    }
    if (token !== demoToken.current || demoRuntime.current !== runtime) return;
    runtime.prepared = updated;
    publishPreparedDemo(updated);
    runtime.lastStatusAt = 0;
    runtime.busy = false;
    const nextOrder = assistedLogicalTrackOrder(runtime.transitionIndex + 1, updated.assistedOrderOffset);
    setAssistedCueState({
      order: nextOrder,
      deck: nextDeck,
      track: nextState.track,
      mixInRequired: true,
      mixInSet: true,
      mixOutSet: Boolean(savedManualWindow(nextState.analysis, "outro-transition")),
      introPrepSkipped: false,
      selection: {
        selectedBpm: trackSelectionBpm(nextState.analysis),
        previousTrackId: outgoingState.track.id,
        previousTrackName: outgoingState.track.name,
        previousBpm: trackSelectionBpm(outgoingState.analysis),
      },
    });
    usedCrateTracks.current.add(nextState.track.id);
    setAssistedDecisions((items) => [
      `ROTATION ARMED · ${outgoingState.track!.name} → ${nextState.track!.name} · Deck ${outgoing.deck} → Deck ${nextDeck}`,
      ...items,
    ].slice(0, ASSISTED_DECISION_LOG_LIMIT));
    setAssistedStatus(`${outgoing.name} continues live · ${nextState.track.name} is armed on Deck ${nextDeck} · its Mix In will meet ${outgoing.name}'s Mix Out`);
  };
  const finishDemoBlend = async (runtime: DemoRuntime, options: { alreadySilent?: boolean } = {}) => {
    const prepared = runtime.prepared;
    if (runtime.busy) return;
    runtime.busy = true;
    const token = demoToken.current;
    const outgoing = prepared.plan.tracks[runtime.transitionIndex];
    const incoming = prepared.plan.tracks[runtime.transitionIndex + 1];
    const outgoingAudio = activeAudio(outgoing.deck);
    const outgoingGraph = graphs.current[outgoing.deck];
    if (outgoingGraph && context.current) {
      if (options.alreadySilent) outgoingGraph.channel.gain.setValueAtTime(0, context.current.currentTime);
      else rampAudioParam(outgoingGraph.channel.gain, 0, context.current.currentTime, .075);
    }
    if (!options.alreadySilent) await wait(90);
    if (token !== demoToken.current) return;
    outgoingAudio?.pause();
    cancelLoopTransition(outgoing.deck);
    changeDeck(outgoing.deck, { playing: false, volume: 0, low: -60, mid: -60, high: -60, loopActive: false });
    // A blend that ends before the 240 ms exit-restore ramp completes must
    // land the incoming on its final levels, never strand it mid-ramp.
    if (runtime.incomingRestore) {
      changeDeckWithAutomatedEq(runtime, runtime.incomingRestore.deck, { ...runtime.incomingRestore.to });
      runtime.incomingRestore = undefined;
    }
    scheduleNaturalTempoReturn(incoming.deck, incoming);
    reportCrowdLiveEvent("transition.completed", {
      mode: assistedPlaying.current ? "assisted" : liveRunning.current ? "live" : "demo",
      transitionIndex: runtime.transitionIndex,
      outgoingTrackId: outgoing.id,
      incomingTrackId: incoming.id,
      outgoingDeck: outgoing.deck,
      incomingDeck: incoming.deck,
      incomingTime: activeAudio(incoming.deck)?.currentTime,
      incomingRate: activeAudio(incoming.deck)?.playbackRate,
    });
    if (liveRunning.current) {
      if (demoTimer.current) clearInterval(demoTimer.current);
      demoTimer.current = null;
      demoRuntime.current = null;
      runtime.busy = false;
      const incomingTrack = prepared.tracks[incoming.id];
      const lockedCue = liveLockedOutgoing.current.get(incoming.id);
      const primary = lockedCue ? withLockedOutgoingCue(incoming, lockedCue) : incoming;
      // Entry cues from the completed transition are history. While the next
      // tune is being selected, show only the already-locked outgoing cue on
      // the tune that has just become primary.
      publishPreparedDemo(incomingTrack ? {
        plan: { title: `${incoming.name} · next cue locked`, runwayBeats: 32, blendBeats: 64, settleBeats: 16, tracks: [primary] },
        tracks: { [incoming.id]: incomingTrack },
      } : null);
      setLiveMode("searching");
      const searchWasAlreadyRunning = incomingTrack
        ? !startLiveCandidateSearch(incoming, incomingTrack, liveToken.current)
        : false;
      setLiveStatus(searchWasAlreadyRunning
        ? `${incoming.name} is now primary · outgoing deck clear · next-tune search already running`
        : `${incoming.name} is now primary · outgoing deck clear · next-tune search started`);
      return;
    }
    const nextTransitionIndex = runtime.transitionIndex + 1;
    const continuationStage = playbackContinuationStage(
      nextTransitionIndex,
      prepared.plan.tracks.length,
      assistedPlaying.current && prepared.plan.tracks.length > 2,
    );
    if (continuationStage === "complete" && assistedPlaying.current && prepared.rotatingAssisted) {
      runtime.transitionIndex = nextTransitionIndex;
      runtime.manualEqTransitionIndex = nextTransitionIndex;
      runtime.manualEqOwnership = {};
      runtime.stage = "primary";
      runtime.overlapVolume = undefined;
      runtime.gainCalibration = undefined;
      runtime.gainDecision = undefined;
      runtime.kickPhaseMonitor = undefined;
      runtime.lastStatusAt = 0;
      runtime.busy = false;
      lastPlaying.current = [incoming.deck];
      setAssistedLaunchedOrder(assistedLogicalTrackOrder(nextTransitionIndex, prepared.assistedOrderOffset));
      performanceStatus(`${incoming.name} is live on Deck ${incoming.deck} · Deck ${nextAssistedDeck(incoming.deck)} is now the replacement slot for the next rotation`);
      return;
    }
    if (continuationStage === "complete") {
      completeDemo(incoming, runtime);
      return;
    }
    runtime.transitionIndex = nextTransitionIndex;
    runtime.manualEqTransitionIndex = nextTransitionIndex;
    runtime.manualEqOwnership = {};
    setAssistedLaunchedOrder(assistedLogicalTrackOrder(nextTransitionIndex, prepared.assistedOrderOffset));
    const following = prepared.plan.tracks[nextTransitionIndex + 1];
    runtime.stage = continuationStage;
    if (continuationStage === "settle") {
      runtime.settleUntil = beatsAfter(incoming.analysis, activeAudio(incoming.deck)?.currentTime ?? incoming.entryDrop, prepared.plan.settleBeats);
      performanceStatus(`${incoming.name} is primary · holding the clean mix before the demo skip`);
    } else {
      performanceStatus(`${incoming.name} is primary · continuing naturally to its saved Mix Out for ${following.name}`);
    }
    await loadDemoDeck(
      following.deck,
      following,
      assistedPlaying.current ? assistedIncomingPrerollTime(following) : following.entryRunway,
      "incoming",
      prepared,
    );
    if (token !== demoToken.current) return;
    runtime.busy = false;
  };
  const demoTick = () => {
    const runtime = demoRuntime.current;
    if (!runtime || runtime.busy) return;
    const prepared = runtime.prepared;
    const outgoing = prepared.plan.tracks[runtime.transitionIndex];
    const incoming = prepared.plan.tracks[runtime.transitionIndex + 1];
    const outgoingAudio = activeAudio(outgoing.deck);
    if (!outgoingAudio) return;
    if (!incoming) {
      if (assistedPlaying.current && prepared.rotatingAssisted) void prepareNextAssistedRotation(runtime);
      return;
    }
    if (runtime.stage === "primary") {
      const incomingPrerollAt = assistedPlaying.current
        ? assistedCuePrerollStart(outgoing.analysis, outgoing.exitRunway, outgoing.bpm)
        : outgoing.exitRunway;
      updateDemoCountdown(runtime, `${outgoing.name} · next ${assistedPlaying.current ? "silent grid preroll" : "runway"}`, incomingPrerollAt - outgoingAudio.currentTime, outgoingAudio.playbackRate);
      if (outgoingAudio.currentTime >= incomingPrerollAt - .04) void beginDemoRunway(runtime);
      return;
    }
    if (runtime.stage === "settle") {
      updateDemoCountdown(runtime, `${outgoing.name} · clean hold before skip`, runtime.settleUntil - outgoingAudio.currentTime, outgoingAudio.playbackRate);
      if (outgoingAudio.currentTime >= runtime.settleUntil - .04) void performDemoSkip(runtime, outgoing);
      return;
    }
    const incomingAudio = activeAudio(incoming.deck);
    if (!incomingAudio) return;
    // Manual-loop congruence (DJ, 30 Aug 2026): a loop thrown on either
    // pair deck adds its beats to the overlap. Wraps are detected from the
    // element clock jumping back across the loop; each completed extra pass
    // grows the shared beat count and the OTHER tune's clock-domain
    // extension. The virtual outgoing clock absorbs outgoing-side wraps so
    // elapsed beats stay monotonic through every pass.
    {
      const previousVirtual = runtime.virtualOutgoingTime ?? outgoingAudio.currentTime;
      const memo = runtime.loopWrapMemo ??= {};
      let outgoingDelta = memo[outgoing.deck] === undefined ? 0 : outgoingAudio.currentTime - memo[outgoing.deck]!;
      for (const [pairDeck, element] of [[outgoing.deck, outgoingAudio], [incoming.deck, incomingAudio]] as const) {
        const deckState = decksCurrent.current[pairDeck];
        const previousTime = memo[pairDeck];
        if (deckState.loopActive && deckState.loopStart !== null && deckState.loopEnd !== null && previousTime !== undefined) {
          const loopSpan = Math.max(.05, deckState.loopEnd - deckState.loopStart);
          if (previousTime - element.currentTime > loopSpan * .5) {
            const loopBeats = Math.max(1, Math.round(deckState.loopSize));
            runtime.loopExtensionBeats = (runtime.loopExtensionBeats ?? 0) + loopBeats;
            if (pairDeck === incoming.deck) runtime.loopExtensionOutgoingSeconds = (runtime.loopExtensionOutgoingSeconds ?? 0) + loopBeats * 60 / outgoing.bpm;
            else {
              runtime.loopExtensionIncomingSeconds = (runtime.loopExtensionIncomingSeconds ?? 0) + loopBeats * 60 / incoming.bpm;
              outgoingDelta += loopSpan;
            }
            reportCrowdLiveEvent("transition.loop-extended", { deck: pairDeck, loopBeats, totalAddedBeats: runtime.loopExtensionBeats, outgoingTrackId: outgoing.id, incomingTrackId: incoming.id });
          }
        }
        memo[pairDeck] = element.currentTime;
      }
      runtime.virtualOutgoingTime = previousVirtual + Math.max(0, outgoingDelta);
    }
    const pairLoopHeld = decksCurrent.current[outgoing.deck].loopActive || decksCurrent.current[incoming.deck].loopActive;
    if (runtime.stage === "runway") {
      const targetTime = sourceTimeAlignedToCue(outgoingAudio.currentTime, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop)
        + (runtime.loopExtensionIncomingSeconds ?? 0);
      const baseRate = cueLockedTempoRate(
        outgoing.exitRunway,
        outgoing.exitHandoff,
        incoming.entryRunway,
        incoming.entryDrop,
        outgoingAudio.playbackRate,
      );
      const assistedPreroll = assistedPlaying.current && !runtime.runwayAudible && outgoingAudio.currentTime < outgoing.exitRunway - .005;
      const finalPrerollBeat = assistedCuePrerollStart(outgoing.analysis, outgoing.exitRunway, outgoing.bpm, 1);
      let phaseError = incomingAudio.currentTime - targetTime;
      if (assistedPreroll && !runtime.prerollReanchorDone && outgoingAudio.currentTime >= finalPrerollBeat - .025 && !pairLoopHeld) {
        // This seek is inaudible and leaves a full mapped beat for the decoder to
        // run steadily at the exact BPM ratio before the channel opens.
        if (Math.abs(phaseError) > .004) incomingAudio.currentTime = targetTime;
        phaseError = 0;
        runtime.prerollReanchorDone = true;
        setDeckRate(incoming.deck, baseRate, false);
      }
      const kickPhaseUpdate = updateKickPhaseMonitor(
        runtime.kickPhaseMonitor ?? emptyKickPhaseMonitor(),
        observeKickAgainstKick(
          { currentTime: outgoingAudio.currentTime, playbackRate: outgoingAudio.playbackRate, beats: outgoing.analysis.beats },
          { currentTime: incomingAudio.currentTime, playbackRate: incomingAudio.playbackRate, beats: incoming.analysis.beats },
        ),
      );
      runtime.kickPhaseMonitor = kickPhaseUpdate.state;
      const kickPhaseLabel = kickPhaseReportLabel(kickPhaseUpdate.report);
      setKickPhaseStatus((current) => current === kickPhaseLabel ? current : kickPhaseLabel);
      runtime.phaseLockTicks = Math.abs(phaseError) <= ASSISTED_GRID_GREEN_TOLERANCE_SECONDS ? (runtime.phaseLockTicks ?? 0) + 1 : 0;
      const now = performance.now();
      // While a manual loop is in the DJ's hand, corrective seeks and nudges
      // stand down — the loop-extension offsets rejoin the clocks on release.
      if (now - runtime.lastCorrectionAt >= 120 && !pairLoopHeld) {
        runtime.lastCorrectionAt = now;
        if (assistedPlaying.current) {
          const gridNudgeRate = assistedPreroll && outgoingAudio.currentTime < finalPrerollBeat - .025
            ? assistedSilentGridNudgeRate(baseRate, phaseError)
            : baseRate;
          // The bend is deliberately not written into deck BPM state. It exists
          // only while muted and is removed before the Mix In cue.
          setDeckRate(incoming.deck, gridNudgeRate, false);
        } else {
          const correction = clamp(1 - phaseError * .55, .992, 1.008);
          setDeckRate(incoming.deck, baseRate * correction);
        }
      }
      if (assistedPlaying.current) {
        const automation = prepared.assistedAutomations?.[runtime.transitionIndex] ?? assistedOverlapAutomationCurrent.current;
        const overlapVolume = runtime.overlapVolume ?? liveHandoffVolume(decksCurrent.current[outgoing.deck].volume);
        if (!runtime.runwayAudible && outgoingAudio.currentTime < outgoing.exitRunway - .005) {
          runtime.gainCalibration = addAssistedGainCalibration(
            runtime.gainCalibration ?? emptyAssistedGainCalibration(),
            readDeckMeter(outgoing.deck),
            readDeckMeter(incoming.deck),
          );
          if (!runtime.gainDecision && runtime.gainCalibration.samples >= 12) {
            const calibration = averagedAssistedGainCalibration(runtime.gainCalibration);
            runtime.gainDecision = assistedFixedGainDecision(overlapVolume, calibration.outgoing, calibration.incoming);
          }
          const secondsToCue = Math.max(0, (outgoing.exitRunway - outgoingAudio.currentTime) / Math.max(.25, outgoingAudio.playbackRate));
          if (!runtime.cueOpenScheduled && secondsToCue <= .12) {
            if (Math.abs(phaseError) > ASSISTED_GRID_GREEN_TOLERANCE_SECONDS) {
              incomingAudio.currentTime = targetTime;
              phaseError = 0;
            }
            setDeckRate(incoming.deck, baseRate, false);
            const incomingGraph = graphs.current[incoming.deck];
            const audioContext = context.current;
            if (incomingGraph && audioContext) {
              const cueVolume = runtime.gainDecision?.volume ?? overlapVolume;
              scheduleAudioParamRamp(incomingGraph.channel.gain, cueVolume, audioContext.currentTime, audioContext.currentTime + secondsToCue);
              runtime.cueOpenScheduled = true;
            }
          }
          const gridState = Math.abs(phaseError) <= ASSISTED_GRID_GREEN_TOLERANCE_SECONDS ? "GREEN" : phaseError > 0 ? "AHEAD" : "BEHIND";
          const prerollBeatsRemaining = Math.max(0, (outgoing.exitRunway - outgoingAudio.currentTime) * outgoing.bpm * outgoingAudio.playbackRate / 60);
          const prerollStatus = `GRID ${gridState} · SILENT PREROLL ${prerollBeatsRemaining.toFixed(1)} BEATS · BPM RATIO ${(baseRate * 100).toFixed(3)}%`;
          setKickPhaseStatus((current) => current === prerollStatus ? current : prerollStatus);
          updateDemoCountdown(runtime, `${incoming.name} · ${prerollStatus} · ${runtime.gainDecision ? "GAIN READY" : "GAIN CALIBRATING"}`, outgoing.exitRunway - outgoingAudio.currentTime, outgoingAudio.playbackRate);
          return;
        }
        if (!runtime.runwayAudible) {
          if (Math.abs(phaseError) > ASSISTED_GRID_GREEN_TOLERANCE_SECONDS) incomingAudio.currentTime = targetTime;
          setDeckRate(incoming.deck, baseRate);
          runtime.runwayAudible = true;
          const automationStart = assistedAutomationAtBeat(automation, 0);
          const fixedGain = runtime.gainDecision;
          changeDeckWithAutomatedEq(runtime, outgoing.deck, { low: automationStart.outgoingLow, mid: automationStart.outgoingMid, high: automationStart.outgoingHigh });
          changeDeckWithAutomatedEq(runtime, incoming.deck, {
            volume: fixedGain?.volume ?? overlapVolume,
            low: automationStart.incomingLow,
            mid: clamp(automationStart.incomingMid + (fixedGain?.midDb ?? 0), -60, 12),
            high: clamp(automationStart.incomingHigh + (fixedGain?.highDb ?? 0), -60, 12),
            tempoRate: baseRate,
          });
          reportCrowdLiveEvent("transition.mix-opened", {
            mode: "assisted",
            transitionIndex: runtime.transitionIndex,
            outgoingTrackId: outgoing.id,
            incomingTrackId: incoming.id,
            outgoingTime: outgoingAudio.currentTime,
            incomingTime: incomingAudio.currentTime,
            incomingRate: baseRate,
            outgoingRate: outgoingAudio.playbackRate,
            incomingElementRate: incomingAudio.playbackRate,
            overlapVolume: fixedGain?.volume ?? overlapVolume,
            gainDecision: fixedGain ?? null,
          });
          setKickPhaseStatus("GRID GREEN · BPM RATIO LOCKED · CHANNEL OPEN");
        }
        // The automation walks the loop-compensated virtual clock, minus the
        // added beats: through every extra loop pass elapsed and added grow
        // together, so the musical position HOLDS and everything downstream
        // (bass swap, ramps, Z) lands exactly the added count later.
        const outgoingBeatSeconds = Math.max(.001, (outgoing.exitHandoff - outgoing.exitRunway) / Math.max(1, automation.windowBeats));
        const elapsedOverlapBeats = ((runtime.virtualOutgoingTime ?? outgoingAudio.currentTime) - outgoing.exitRunway) / outgoingBeatSeconds;
        const musicalBeat = clamp(elapsedOverlapBeats - (runtime.loopExtensionBeats ?? 0), 0, automation.windowBeats);
        const automationMix = assistedAutomationAtBeat(automation, musicalBeat);
        if (!runtime.gainDecision) {
          runtime.gainCalibration = addAssistedGainCalibration(
            runtime.gainCalibration ?? emptyAssistedGainCalibration(),
            readDeckMeter(outgoing.deck),
            readDeckMeter(incoming.deck),
          );
          const enoughSignal = runtime.gainCalibration.samples >= 12;
          const calibrationWindowComplete = automationMix.beat >= ASSISTED_GAIN_CALIBRATION_BEATS;
          const calibrationExpired = automationMix.beat >= ASSISTED_GAIN_CALIBRATION_BEATS * 2;
          if ((calibrationWindowComplete && enoughSignal) || calibrationExpired) {
            const calibration = averagedAssistedGainCalibration(runtime.gainCalibration);
            runtime.gainDecision = assistedFixedGainDecision(overlapVolume, calibration.outgoing, calibration.incoming);
            changeDeck(incoming.deck, { volume: runtime.gainDecision.volume });
          }
        }
        const fixedGain = runtime.gainDecision;
        changeDeckWithAutomatedEq(runtime, outgoing.deck, { low: automationMix.outgoingLow, mid: automationMix.outgoingMid, high: automationMix.outgoingHigh });
        changeDeckWithAutomatedEq(runtime, incoming.deck, {
          low: automationMix.incomingLow <= -59.9 ? -60 : clamp(automationMix.incomingLow + (fixedGain?.lowDb ?? 0), -60, 12),
          mid: clamp(automationMix.incomingMid + (fixedGain?.midDb ?? 0), -60, 12),
          high: clamp(automationMix.incomingHigh + (fixedGain?.highDb ?? 0), -60, 12),
        });
        const gainStatus = fixedGain
          ? `GAIN LOCK ${fixedGain.levelDb >= 0 ? "+" : ""}${fixedGain.levelDb.toFixed(1)} dB`
          : automationMix.beat >= ASSISTED_GAIN_CALIBRATION_BEATS
            ? "GAIN CAL WAITING FOR SIGNAL"
            : `GAIN CAL ${automationMix.beat.toFixed(1)}/${ASSISTED_GAIN_CALIBRATION_BEATS} BEATS`;
        const bassStatus = automationMix.bassSwapProgress <= 0
          ? `BASS SWITCH IN ${automationMix.beatsUntilBassSwap.toFixed(2)} BEATS`
          : automationMix.bassSwapProgress >= 1
            ? "BASS SWITCHED"
            : `BASS SWITCH ${Math.round(automationMix.bassSwapProgress * 100)}%`;
        updateDemoCountdown(runtime, `${incoming.name} · BEAT ${automationMix.beat.toFixed(2)}/${automation.windowBeats} · ${bassStatus} · ${kickPhaseLabel} · BPM RATIO LOCKED · IN ${Math.round(automationMix.incomingPercent)}% / OUT ${Math.round(automationMix.outgoingPercent)}% · ${gainStatus}`, outgoing.exitHandoff + (runtime.loopExtensionOutgoingSeconds ?? 0) - outgoingAudio.currentTime, outgoingAudio.playbackRate);
      } else {
        const audibleFrom = runtime.runwayAudibleFrom ?? incoming.entryDrop;
        if (!runtime.runwayAudible && targetTime >= audibleFrom - .03 && targetTime <= audibleFrom + .15 && (runtime.phaseLockTicks ?? 0) >= 8) runtime.runwayAudible = true;
        const audibleProgress = runtime.runwayAudible
          ? clamp((targetTime - audibleFrom) / Math.max(.001, incoming.entryDrop - audibleFrom), 0, 1)
          : 0;
        changeDeckWithAutomatedEq(runtime, incoming.deck, { volume: .58 * audibleProgress, low: -60, mid: -24 + 21 * audibleProgress, high: -18 + 18 * audibleProgress });
        updateDemoCountdown(runtime, `${incoming.name} · runway phase lock ${Math.abs(phaseError) <= .014 ? "GREEN" : phaseError > 0 ? "AHEAD" : "BEHIND"} · ${kickPhaseLabel} · ${runtime.runwayAudible ? "MIDS/HIGHS IN" : "AUDIENCE MUTED"}`, outgoing.exitHandoff + (runtime.loopExtensionOutgoingSeconds ?? 0) - outgoingAudio.currentTime, outgoingAudio.playbackRate);
      }
      // An incoming-side loop owes the room extra outgoing beats: Z waits by
      // exactly the added time, so the outgoing plays real material while the
      // incoming's loop debt is repaid (DJ, 30 Aug 2026).
      if (outgoingAudio.currentTime >= outgoing.exitHandoff + (runtime.loopExtensionOutgoingSeconds ?? 0) - (assistedPlaying.current ? 0 : .025)) {
        const exactIncomingTime = sourceTimeAlignedToCue(outgoingAudio.currentTime, outgoing.exitRunway, outgoing.exitHandoff, incoming.entryRunway, incoming.entryDrop);
        const endpointSnapEnabled = !assistedPlaying.current || ASSISTED_ENDPOINT_GRID_SNAP;
        if (endpointSnapEnabled) incomingAudio.currentTime = exactIncomingTime;
        setDeckRate(incoming.deck, baseRate);
        const endpointIncomingTime = endpointSnapEnabled ? exactIncomingTime : incomingAudio.currentTime;
        changeDeckWithAutomatedEq(runtime, outgoing.deck, { low: -60, mid: -60, high: -60 });
        const currentAutomation = prepared.assistedAutomations?.[runtime.transitionIndex] ?? assistedOverlapAutomationCurrent.current;
        const endpointAutomation = assistedPlaying.current
          ? assistedAutomationAtBeat(currentAutomation, currentAutomation.windowBeats)
          : null;
        const fixedGain = assistedPlaying.current ? runtime.gainDecision : null;
        // The automatic handoff restores incoming bass unless the DJ holds
        // an explicit manual bass override.
        // DJ, 27 Aug 2026: ...and that restore RAMPS over ~240 ms instead of
        // stepping. The gig-level recording measured a 12-15 dB snap out of
        // the ease-out trough when EQ, bass and gain-lock volume landed in
        // one instant; the ramp keeps the cut feel without the lurch. The
        // restore starts from the deck's pre-handoff state and the blend
        // tick interpolates to these targets (finishDemoBlend completes it
        // if the blend ends first).
        // A manual bass toggle still owns Low through the handoff restore.
        // With no selected bass cut, the kill swaps at Z, not during the
        // subsequent level-restoration ramp. Manual EQ overrides still win.
        if (endpointAutomation && currentAutomation.bassSwapBeats.length === 0) {
          changeDeckWithAutomatedEq(runtime, incoming.deck, { low: fixedGain?.lowDb ?? 0 });
        }
        const incomingBefore = decksCurrent.current[incoming.deck];
        changeDeckWithAutomatedEq(runtime, incoming.deck, { currentTime: endpointIncomingTime, tempoRate: baseRate });
        runtime.incomingRestore = {
          deck: incoming.deck,
          from: { volume: incomingBefore.volume, low: incomingBefore.low, mid: incomingBefore.mid, high: incomingBefore.high },
          to: {
            volume: fixedGain?.volume ?? runtime.overlapVolume ?? .85,
            low: fixedGain?.lowDb ?? 0,
            mid: endpointAutomation ? clamp(endpointAutomation.incomingMid + (fixedGain?.midDb ?? 0), -60, 12) : 0,
            high: endpointAutomation ? clamp(endpointAutomation.incomingHigh + (fixedGain?.highDb ?? 0), -60, 12) : 0,
          },
          startedAt: Date.now(),
          ms: 240,
        };
        runtime.stage = "blend";
        runtime.rundownLoopActive = false;
        runtime.rundownLoopReleased = false;
        reportCrowdLiveEvent("transition.handoff", {
          mode: assistedPlaying.current ? "assisted" : liveRunning.current ? "live" : "demo",
          outgoingRate: outgoingAudio.playbackRate,
          incomingElementRate: incomingAudio.playbackRate,
          transitionIndex: runtime.transitionIndex,
          outgoingTrackId: outgoing.id,
          incomingTrackId: incoming.id,
          outgoingTime: outgoingAudio.currentTime,
          incomingTime: endpointIncomingTime,
          incomingRate: baseRate,
          endpointSnapEnabled,
        });
        const manualWindowHandoff = assistedPlaying.current && outgoing.mixOut <= outgoing.exitHandoff + .001;
        performanceStatus(manualWindowHandoff
          ? `WINDOW END CUT · ${outgoing.name} → ${incoming.name} · bass EQ sweep before selected cue and X/Y/Z automation complete`
          : `BASS HANDOFF · ${outgoing.name} → ${incoming.name} · holding a ${prepared.plan.blendBeats}-beat EQ blend`);
        if (manualWindowHandoff) void finishDemoBlend(runtime);
      }
      return;
    }
    // DJ, 27 Aug 2026: the exit restore is a RAMP, not a step. The recording
    // measured a ~12-15 dB snap when the incoming's EQ/volume restored
    // instantly out of the ease-out trough at the handoff; interpolating the
    // restore across ~240 ms keeps the cut feel without the lurch.
    const incomingRestore = runtime.incomingRestore;
    if (incomingRestore) {
      const progress = clamp((Date.now() - incomingRestore.startedAt) / incomingRestore.ms, 0, 1);
      const between = (from: number, to: number) => from + (to - from) * progress;
      changeDeckWithAutomatedEq(runtime, incomingRestore.deck, {
        volume: between(incomingRestore.from.volume, incomingRestore.to.volume),
        low: between(incomingRestore.from.low, incomingRestore.to.low),
        mid: between(incomingRestore.from.mid, incomingRestore.to.mid),
        high: between(incomingRestore.from.high, incomingRestore.to.high),
      });
      if (progress >= 1) runtime.incomingRestore = undefined;
    }
    const rundownLoop = outgoing.rundownLoop;
    if (rundownLoop) {
      const incomingTime = incomingAudio.currentTime;
      if (!runtime.rundownLoopActive && incomingTime >= rundownLoop.triggerIncomingTime - .025) {
        runtime.rundownLoopActive = true;
        loopCycleArmed.current[outgoing.deck] = true;
        changeDeckWithAutomatedEq(runtime, outgoing.deck, {
          loopSize: rundownLoop.loopBeats,
          loopStart: rundownLoop.loopStart,
          loopEnd: rundownLoop.loopEnd,
          loopActive: true,
          low: -60,
        });
        prepareLoopStandby(outgoing.deck, rundownLoop.loopStart);
        performanceStatus(`${outgoing.name} · neutral ${rundownLoop.loopBeats}-beat rundown hold active · waiting for ${incoming.name}'s cut`);
      }
      const holdSpan = Math.max(.001, rundownLoop.releaseIncomingTime - incoming.entryDrop);
      const holdProgress = clamp((incomingTime - incoming.entryDrop) / holdSpan, 0, 1);
      changeDeckWithAutomatedEq(runtime, outgoing.deck, {
        volume: .85 - .36 * holdProgress,
        low: -60,
        mid: -30 * holdProgress,
        high: -18 * holdProgress,
      });
      updateDemoCountdown(runtime, `${outgoing.name} · ${runtime.rundownLoopActive ? "neutral hold" : "rundown"} until primary cut`, rundownLoop.releaseIncomingTime - incomingTime, incomingAudio.playbackRate);
      if (!runtime.rundownLoopReleased && incomingTime >= rundownLoop.releaseIncomingTime - .025) {
        runtime.rundownLoopReleased = true;
        performanceStatus(`CUT EXIT · stopping ${outgoing.name} inside ${incoming.name}'s break`);
        void finishDemoBlend(runtime);
      }
      return;
    }
    const blendProgress = clamp((outgoingAudio.currentTime - outgoing.exitHandoff) / Math.max(.001, outgoing.mixOut - outgoing.exitHandoff), 0, 1);
    changeDeckWithAutomatedEq(runtime, outgoing.deck, { volume: .85 * (1 - blendProgress), low: -60, mid: -60 * blendProgress, high: -60 * blendProgress });
    updateDemoCountdown(runtime, `${outgoing.name} · easing out EQ and volume`, outgoing.mixOut - outgoingAudio.currentTime, outgoingAudio.playbackRate);
    if (blendProgress >= .999 || outgoingAudio.currentTime >= outgoing.mixOut - .025) void finishDemoBlend(runtime);
  };
  const startDemo = async () => {
    const prepared = preparedDemoCurrent.current;
    if (!prepared || prepared.plan.tracks.length < 2) return;
    const token = ++demoToken.current;
    if (demoTimer.current) clearInterval(demoTimer.current);
    for (const id of AUTOMATION_DECK_IDS) activeAudio(id)?.pause();
    setPicker(null);
    setDemoMode("running");
    setDemoStatus(`Loading ${prepared.plan.tracks[0].name} from the beginning`);
    const first = prepared.plan.tracks[0];
    const second = prepared.plan.tracks[1];
    await loadDemoDeck(first.deck, first, 0, "primary", prepared);
    if (token !== demoToken.current) return;
    await ensureGraph(first.deck);
    const firstAudio = activeAudio(first.deck);
    if (!firstAudio) throw new Error("The first demo deck is unavailable");
    firstAudio.currentTime = 0;
    setDeckRate(first.deck, 1);
    await firstAudio.play();
    changeDeck(first.deck, { currentTime: 0, playing: true, volume: .85, low: 0, mid: 0, high: 0, tempoRate: 1 });
    const runtime: DemoRuntime = { prepared, transitionIndex: 0, stage: "primary", busy: true, lastCorrectionAt: 0, lastStatusAt: 0, settleUntil: 0 };
    demoRuntime.current = runtime;
    lastPlaying.current = [first.deck];
    await loadDemoDeck(second.deck, second, second.entryRunway, "incoming", prepared);
    if (token !== demoToken.current) return;
    runtime.busy = false;
    demoTimer.current = setInterval(demoTick, 80);
    setDemoStatus(`${first.name} playing from 0:00 · next deck preloaded at its mapped runway`);
  };
  const chooseLiveOpener = async (token: number): Promise<LiveOpener | null> => {
    setLiveMode("selecting");
    // A fresh live-crate run starts by digging and mapping an unseen opener.
    // Remembered tracks are reserved for deadline fallback after playback starts.
    setLiveStatus("Launch pressed · making the first random track choice now");
    const openerAlbums = shuffled(crateAlbums);
    for (const openerAlbum of openerAlbums) {
      if (token !== liveToken.current || !liveRunning.current) return null;
      setLiveStatus(`Opening ${openerAlbum.name} · looking for a track-one intro`);
      const detail = await fetch(`/api/crate?album=${encodeURIComponent(openerAlbum.name)}`, { cache: "no-store" }).then((response) => response.json()) as { tracks: Track[] };
      const opener = shuffled(detail.tracks.filter((track) => !track.mapped))[0];
      if (!opener) continue;
      usedCrateTracks.current.add(opener.id);
      setLiveStatus(`Mapping possible opener · ${openerAlbum.name} / ${opener.name}`);
      let mapped: Track;
      try {
        mapped = await ensureMapped(opener, (update) => setLiveStatus(`Possible opener · ${opener.name} · ${describeMappingUpdate(update, Date.now())}`), () => token !== liveToken.current || !liveRunning.current);
        setTracks((current) => current.some((track) => track.id === mapped.id) ? current.map((track) => track.id === mapped.id ? mapped : track) : [...current, mapped]);
      } catch (error) {
        if (token !== liveToken.current || !liveRunning.current) return null;
        const message = error instanceof Error ? error.message : "mapping failed";
        setLiveDecisions((items) => [`PASS OPENER · ${openerAlbum.name} · ${opener.name} · ${message}`, ...items].slice(0, 7));
        setLiveStatus(`${opener.name} rejected · trying another random album`);
        continue;
      }
      if (token !== liveToken.current || !liveRunning.current) return null;
      const analysis = withoutStoredCuePlacements(await fetchTrackAnalysis<Analysis>(mapped.analysis));
      const gridQuality = assessGridRetentionQuality(qualityInput(analysis));
      const openerExit = assessLiveOpenerExit(analysis as LiveAnalysis);
      const exitTime = openerExit.best?.exit.time ?? 0;
      const bpm = analysis.tempoSections.find((section) => exitTime >= section.start && exitTime < section.end)?.bpm ?? analysis.tempoSections[0]?.bpm ?? 0;
      const credible = gridQuality.accepted && openerExit.accepted && bpm >= 130 && bpm <= 155;
      if (!credible) {
        const reason = gridQuality.accepted && !openerExit.accepted
          ? "no safe, musically plausible outro window"
          : gridQuality.accepted
            ? `${bpm.toFixed(1)} BPM at the outro is outside the live-set range`
          : `grid kept as advisory · ${gridQuality.reasons.join(" · ")}`;
        void fetch("/api/dj-library/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mapped.id, decision: "pass", reason }) });
        setLiveDecisions((items) => [`PASS OPENER · ${mapped.album} · ${mapped.name} · ${reason}`, ...items].slice(0, 7));
        continue;
      }
      const selected = { track: mapped, analysis };
      liveOpenerCurrent.current = selected;
      setLiveDecisions((items) => [`OPENER · ${mapped.album} · ${mapped.name} · ${bpm.toFixed(1)} BPM at outro / ${openerExit.safeExitWindows} safe outro choices`, ...items].slice(0, 7));
      return selected;
    }
    throw new Error("No credible newly mapped opener was found in the available crate");
  };
  const emergencyPlanFor = (track: Track, analysis: Analysis, deck: AutomationDeckId): DemoTrackPlan | null => {
    const exit = assessLiveOpenerExit(analysis as LiveAnalysis).best;
    if (!exit) return null;
    const bpm = analysis.tempoSections.find((section) => exit.exit.time >= section.start && exit.exit.time < section.end)?.bpm
      ?? analysis.tempoSections[0]?.bpm
      ?? 145;
    const firstDownbeat = analysis.beats.find((beat) => beat.isDownbeat)?.time ?? 0;
    return {
      id: track.id,
      name: track.name,
      deck,
      analysis,
      bpm,
      entryRunway: 0,
      entryDrop: firstDownbeat,
      skipTo: 0,
      exitRunway: exit.start,
      exitHandoff: exit.exit.time,
      mixOut: exit.end,
      cuePoints: [
        { id: "cold-start", time: 0, label: "COLD START", description: "Emergency clean start from the beginning after the previous track ends.", colour: "#d9ff54" },
        { id: "exit-runway", time: exit.start, label: "SAFE OUTRO", description: "Verified runway available for the next normal transition.", colour: "#ffc857" },
        { id: "exit-handoff", time: exit.exit.time, label: "MIX OUT · BASS OFF", description: "Kill this tune's bass here while the incoming tune takes over.", colour: "#ff6a4a" },
      ],
    };
  };
  const prepareEmergencyColdStart = async (current: DemoTrackPlan, currentTrack: Track, token: number, preferred?: { track: Track; analysis: Analysis } | null) => {
    if (token !== liveToken.current || !liveRunning.current || emergencyTimer.current) return;
    const outgoingAudio = activeAudio(current.deck);
    if (!outgoingAudio) throw new Error("The outgoing deck is unavailable for the emergency handoff");
    const incomingDeck: AutomationDeckId = current.deck === "A" ? "B" : "A";
    const currentArtist = albumArtist(currentTrack.album);
    const mappedPool = tracks.filter((track) => track.mapped && track.id !== current.id);
    const priority = (track: Track) => (usedCrateTracks.current.has(track.id) ? 2 : 0) + (albumArtist(track.album) === currentArtist ? 1 : 0);
    const fallbackTracks = shuffled(mappedPool).sort((left, right) => priority(left) - priority(right));
    let fallback: { track: Track; plan: DemoTrackPlan } | null = null;
    if (preferred) {
      const plan = emergencyPlanFor(preferred.track, preferred.analysis, incomingDeck);
      if (plan && plan.bpm >= 130 && plan.bpm <= 155) fallback = { track: preferred.track, plan };
    }
    for (const track of fallbackTracks) {
      if (fallback) break;
      if (token !== liveToken.current || !liveRunning.current) return;
      const analysis = withoutStoredCuePlacements(await fetchTrackAnalysis<Analysis>(track.analysis));
      if (!assessGridRetentionQuality(qualityInput(analysis)).accepted) continue;
      const plan = emergencyPlanFor(track, analysis, incomingDeck);
      if (!plan || plan.bpm < 130 || plan.bpm > 155) continue;
      fallback = { track, plan };
      break;
    }
    if (!fallback) {
      setLiveMode("error");
      setLiveStatus("No newly mapped or remembered emergency track with a safe future outro is available");
      return;
    }
    usedCrateTracks.current.add(fallback.track.id);
    const prepared: PreparedDemo = {
      plan: { title: `${current.name} → ${fallback.track.name} · emergency cold start`, runwayBeats: 32, blendBeats: 64, settleBeats: 16, tracks: [fallback.plan] },
      tracks: { [fallback.track.id]: fallback.track },
    };
    publishPreparedDemo(prepared);
    await loadDemoDeck(incomingDeck, fallback.plan, 0, "primary", prepared);
    if (token !== liveToken.current || !liveRunning.current) return;
    setLiveMode("candidate");
    setLiveDecisions((items) => [`EMERGENCY STANDBY · ${fallback!.track.album} · ${fallback!.track.name} · clean start from 0:00`, ...items].slice(0, 7));
    let launching = false;
    let lastStatusAt = 0;
    emergencyTimer.current = setInterval(() => {
      if (launching || token !== liveToken.current || !liveRunning.current) return;
      const secondsLeft = Math.max(0, (current.analysis.duration - outgoingAudio.currentTime) / Math.max(.25, outgoingAudio.playbackRate));
      const now = performance.now();
      if (now - lastStatusAt > 500) {
        lastStatusAt = now;
        setLiveStatus(`Emergency standby ${fallback!.track.name} armed · clean start in ${secondsLeft.toFixed(1)} sec`);
      }
      if (secondsLeft > .06 && !outgoingAudio.ended) return;
      launching = true;
      if (emergencyTimer.current) clearInterval(emergencyTimer.current);
      emergencyTimer.current = null;
      void (async () => {
        const incomingAudio = activeAudio(incomingDeck);
        if (!incomingAudio) throw new Error("The emergency standby deck is unavailable");
        incomingAudio.currentTime = 0;
        setDeckRate(incomingDeck, 1);
        await ensureGraph(incomingDeck);
        await incomingAudio.play();
        outgoingAudio.pause();
        changeDeck(current.deck, { playing: false, volume: 0, low: -60, mid: -60, high: -60 });
        changeDeck(incomingDeck, { currentTime: 0, playing: true, volume: .85, low: 0, mid: 0, high: 0, tempoRate: 1 });
        lastPlaying.current = [incomingDeck];
        setLiveMode("searching");
        setLiveStatus(`${fallback!.track.name} cold-started from 0:00 · no dead air · resuming normal crate search`);
        startLiveCandidateSearch(fallback!.plan, fallback!.track, token);
      })().catch((error: unknown) => {
        setLiveMode("error");
        setLiveStatus(error instanceof Error ? error.message : "Emergency cold start failed");
      });
    }, 25);
  };
  const searchLiveCandidate = async (current: DemoTrackPlan, currentTrack: Track, token: number, options: LiveSearchOptions = {}) => {
    if (!crateAlbums.length || token !== liveToken.current || !liveRunning.current) return;
    const selectionStartedAt = performance.now();
    setLiveMode("searching");
    const currentAudio = activeAudio(current.deck);
    const waitForProtectedDeck = async (status: string) => {
      const protectedDeck = options.waitForDeckClear;
      if (!protectedDeck) return token === liveToken.current && liveRunning.current;
      let announced = false;
      while (token === liveToken.current && liveRunning.current) {
        const protectedAudio = activeAudio(protectedDeck);
        const occupied = demoRuntime.current !== null || Boolean(protectedAudio && !protectedAudio.paused);
        if (!occupied) return true;
        if (!announced) {
          announced = true;
          setLiveStatus(`${status} · waiting for Deck ${protectedDeck} to clear while the current mix finishes`);
        }
        await wait(120);
      }
      return false;
    };
    const currentTrackTime = () => currentAudio?.currentTime ?? decksCurrent.current[current.deck].currentTime;
    const currentPlaybackRate = () => Math.max(.25, currentAudio?.playbackRate ?? 1);
    const secondsRemaining = () => Math.max(0, (current.analysis.duration - currentTrackTime()) / currentPlaybackRate());
    const currentArtist = albumArtist(currentTrack.album);
    const mappedAlbumNames = new Set(tracks.filter((track) => track.mapped && !usedCrateTracks.current.has(track.id)).map((track) => track.album));
    const mappedCounts = new Map<string, number>();
    for (const track of tracks) {
      if (track.mapped) mappedCounts.set(track.album, (mappedCounts.get(track.album) ?? 0) + 1);
    }
    const artistPriority = (album: CrateAlbum) => albumArtist(album.name) === currentArtist ? 1 : 0;
    // "Fresh" means unscanned and unplayed. Matching the current artist is a
    // preference penalty now, not a hard exclusion: safe new music still gets
    // a chance before Crowd falls back to remembered grids.
    const discoveryAlbums = shuffled(crateAlbums.filter((album) => (mappedCounts.get(album.name) ?? 0) < album.count))
      .sort((left, right) => artistPriority(left) - artistPriority(right));
    const mappedAlbums = shuffled(crateAlbums.filter((album) => mappedAlbumNames.has(album.name)))
      .sort((left, right) => artistPriority(left) - artistPriority(right));
    // Explore unseen music while there is time. The remembered pool is a fast
    // fallback phase, not the default source of the next tune.
    const searchAlbums = [...discoveryAlbums, ...mappedAlbums];
    type LiveMatch = { mapped: Track; albumName: string; assessment: ReturnType<typeof assessLiveCandidate>; outgoing: DemoTrackPlan; incoming: DemoTrackPlan };
    let bestMatch: LiveMatch | null = null;
    const liveMatches: LiveMatch[] = [];
    let lockedOutgoing = selectLockedOutgoingCue(current.analysis as LiveAnalysis, currentTrackTime(), current.exitHandoff);
    if (!lockedOutgoing) {
      if (!await waitForProtectedDeck("No later locked cue remains")) return;
      await prepareEmergencyColdStart(current, currentTrack, token, null);
      return;
    }
    let lockedCurrent = withLockedOutgoingCue(current, lockedOutgoing);
    liveLockedOutgoing.current.set(current.id, lockedOutgoing);
    const preferredRunwaySecondsRemaining = () => Math.max(0, (lockedOutgoing!.exitRunway - currentTrackTime()) / currentPlaybackRate());
    const selectionElapsedSeconds = () => Math.max(0, (performance.now() - selectionStartedAt) / 1000);
    const selectionSecondsRemaining = () => nextTuneSelectionSecondsRemaining(selectionElapsedSeconds());
    const selectionPhase = () => nextTuneSelectionPhase(selectionElapsedSeconds());
    const searchDeadlineMode = () => {
      const musicalDeadline = liveCueAwareDeadlineMode(secondsRemaining(), preferredRunwaySecondsRemaining());
      if (musicalDeadline === "cold-start") return "cold-start" as const;
      return selectionPhase() === "fresh-scan" ? "full-search" as const : "mapped-only" as const;
    };
    let bestCleanStart: { track: Track; analysis: Analysis; score: number; fresh: boolean } | null = null;
    let assessedCandidates = 0;
    const publishLockedCueIfPrimary = () => {
      if (demoRuntime.current || decksCurrent.current[current.deck].track?.id !== current.id) return;
      publishPreparedDemo({
        plan: { title: `${current.name} · next cue locked`, runwayBeats: 32, blendBeats: 64, settleBeats: 16, tracks: [lockedCurrent] },
        tracks: { [current.id]: currentTrack },
      });
    };
    const advanceLockedCueOnlyIfPlayed = () => {
      const now = currentTrackTime();
      if (lockedOutgoing!.exitHandoff > now + .05) return true;
      const previous = lockedOutgoing!;
      const next = selectLockedOutgoingCue(current.analysis as LiveAnalysis, now, previous.exitHandoff);
      if (!next || next.exitHandoff <= previous.exitHandoff + .05) return false;
      lockedOutgoing = next;
      lockedCurrent = withLockedOutgoingCue(current, next);
      liveLockedOutgoing.current.set(current.id, next);
      liveMatches.splice(0);
      bestMatch = null;
      publishLockedCueIfPrimary();
      setLiveDecisions((items) => [`CUE ADVANCED · ${current.name} · ${timeLabel(previous.exitHandoff)} played before a match was ready · next locked cue ${timeLabel(next.exitHandoff)}`, ...items].slice(0, 7));
      setLiveStatus(`${current.name} passed its locked ${timeLabel(previous.exitHandoff)} cue · comparing tunes against ${timeLabel(next.exitHandoff)} now`);
      return true;
    };
    const armLiveMatch = async (match: LiveMatch) => {
      const { mapped, albumName, assessment, outgoing, incoming } = match;
      const now = currentAudio?.currentTime ?? decksCurrent.current[current.deck].currentTime;
      if (outgoing.exitRunway <= now + 4) {
        setLiveDecisions((items) => [`PASS · ${albumName} · ${mapped.name} · its chosen mix runway passed while the search continued`, ...items].slice(0, 7));
        return false;
      }
      if (!await waitForProtectedDeck(`${mapped.name} chosen and fully mapped`)) return false;
      const deckReadyAt = currentAudio?.currentTime ?? decksCurrent.current[current.deck].currentTime;
      if (outgoing.exitRunway <= deckReadyAt + 4) {
        setLiveDecisions((items) => [`PASS · ${albumName} · ${mapped.name} · its chosen runway passed before the outgoing deck cleared`, ...items].slice(0, 7));
        return false;
      }
      const prepared: PreparedDemo = {
        plan: { ...assessment.plan, title: `${current.name} → ${mapped.name}`, tracks: [outgoing, incoming] },
        tracks: { [currentTrack.id]: currentTrack, [mapped.id]: mapped },
      };
      setLiveStatus(`${mapped.name} won the comparison · loading muted on Deck ${incoming.deck}`);
      try {
        // The proposed cue sheet stays private while the spare deck loads.
        // Only a fully loaded, still-future runway can become the immutable
        // transition used by the audio clock and the waveform display.
        await loadDemoDeck(incoming.deck, incoming, incoming.entryRunway, "incoming", prepared);
      } catch (error) {
        if (token !== liveToken.current || !liveRunning.current) return false;
        const message = error instanceof Error ? error.message : "deck load failed";
        setLiveDecisions((items) => [`PASS · ${albumName} · ${mapped.name} · spare deck did not load: ${message}`, ...items].slice(0, 7));
        return false;
      }
      if (token !== liveToken.current || !liveRunning.current) return false;
      if (outgoing.exitRunway <= currentTrackTime() + .5) {
        setLiveDecisions((items) => [`PASS · ${albumName} · ${mapped.name} · its runway passed while the spare deck was loading`, ...items].slice(0, 7));
        return false;
      }
      publishPreparedDemo(prepared);
      demoRuntime.current = { prepared, transitionIndex: 0, stage: "primary", busy: false, lastCorrectionAt: 0, lastStatusAt: 0, settleUntil: 0 };
      if (demoTimer.current) clearInterval(demoTimer.current);
      demoTimer.current = setInterval(demoTick, 80);
      void fetch("/api/dj-library/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mapped.id, decision: "keep", score: assessment.score, bassSimilarity: assessment.bassSimilarity, tempoShiftPercent: assessment.tempoShiftPercent, reason: assessment.reason }),
      });
      setLiveDecisions((items) => [`BEST MATCH ON DECK ${incoming.deck} · ${albumName} · ${mapped.name} · bass ${Math.round(assessment.bassSimilarity * 100)}% · ${assessment.reason}`, ...items].slice(0, 7));
      setLiveMode("candidate");
      setLiveStatus(`${mapped.name} ARMED ON DECK ${incoming.deck} · best of ${assessedCandidates} assessed candidates · waiting for ${current.name}'s runway at ${timeLabel(outgoing.exitRunway)}`);
      startLiveCandidateSearch(incoming, mapped, token, { waitForDeckClear: outgoing.deck });
      return true;
    };
    const armBestLiveMatch = async () => {
      while (liveMatches.length) {
        const match = liveMatches.shift()!;
        if (await armLiveMatch(match)) return true;
        bestMatch = liveMatches[0] ?? null;
      }
      bestMatch = null;
      return false;
    };
    const commitPreferredMatchIfDue = async () => {
      if (!bestMatch || searchDeadlineMode() === "full-search") return false;
      const secondsToRunway = preferredRunwaySecondsRemaining() ?? 0;
      setLiveStatus(`${bestMatch.mapped.name} selected before ${current.name}'s preferred runway · ${secondsToRunway.toFixed(1)} sec available to load`);
      return armBestLiveMatch();
    };
    const finishAtSelectionDeadline = async () => {
      if (selectionPhase() !== "decision-due") return false;
      if (await armBestLiveMatch()) return true;
      if (bestCleanStart) {
        setLiveStatus(`One-minute choice made · ${bestCleanStart.track.name} selected as the safe clean-start fallback · waiting for the spare deck`);
      }
      if (!await waitForProtectedDeck("One-minute next-tune deadline reached")) return true;
      setLiveStatus("One-minute choice deadline reached · arming the safest available clean-start fallback");
      await prepareEmergencyColdStart(lockedCurrent, currentTrack, token, bestCleanStart);
      return true;
    };
    for (let albumIndex = 0; albumIndex < searchAlbums.length; albumIndex += 1) {
      const album = searchAlbums[albumIndex];
      const discoveryPhase = albumIndex < discoveryAlbums.length;
      if (token !== liveToken.current || !liveRunning.current) return;
      advanceLockedCueOnlyIfPlayed();
      if (await finishAtSelectionDeadline()) return;
      if (await commitPreferredMatchIfDue()) return;
      const albumDeadlineMode = searchDeadlineMode();
      if (discoveryPhase && albumDeadlineMode === "mapped-only") {
        albumIndex = discoveryAlbums.length - 1;
        continue;
      }
      if (albumDeadlineMode === "cold-start") {
        if (await armBestLiveMatch()) return;
        if (!await waitForProtectedDeck("Emergency next tune prepared")) return;
        await prepareEmergencyColdStart(lockedCurrent, currentTrack, token, bestCleanStart);
        return;
      }
      const selectionLabel = selectionPhase() === "fresh-scan" ? "fresh scan" : "remembered fallback";
      setLiveStatus(`${current.name} remains live · ${selectionLabel} · ${Math.ceil(selectionSecondsRemaining())}s to choose · opening ${album.name}`);
      const detail = await fetch(`/api/crate?album=${encodeURIComponent(album.name)}`, { cache: "no-store" }).then((response) => response.json()) as { tracks: Track[] };
      const albumCandidates = shuffled(detail.tracks).sort((left, right) => discoveryPhase ? Number(left.mapped) - Number(right.mapped) : Number(right.mapped) - Number(left.mapped));
      for (const candidate of albumCandidates) {
        if (token !== liveToken.current || !liveRunning.current) return;
        advanceLockedCueOnlyIfPlayed();
        if (await finishAtSelectionDeadline()) return;
        if (usedCrateTracks.current.has(candidate.id)) continue;
        if (discoveryPhase && candidate.mapped) continue;
        if (!discoveryPhase && !candidate.mapped) continue;
        if (await commitPreferredMatchIfDue()) return;
        const deadlineMode = searchDeadlineMode();
        if (deadlineMode === "cold-start") {
          if (await armBestLiveMatch()) return;
          if (!await waitForProtectedDeck("Emergency next tune prepared")) return;
          await prepareEmergencyColdStart(lockedCurrent, currentTrack, token, bestCleanStart);
          return;
        }
        if (discoveryPhase && deadlineMode === "mapped-only") {
          albumIndex = discoveryAlbums.length - 1;
          break;
        }
        if (deadlineMode === "mapped-only" && !candidate.mapped) {
          setLiveDecisions((items) => [`DEADLINE SKIP · ${candidate.name} · insufficient time to begin a fresh grid scan`, ...items].slice(0, 7));
          continue;
        }
        usedCrateTracks.current.add(candidate.id);
        const candidatePhaseLabel = discoveryPhase ? "fresh scan" : "remembered fallback";
        setLiveStatus(`${current.name} remains live · ${candidatePhaseLabel} ${candidate.name} · ${Math.ceil(selectionSecondsRemaining())}s to choose`);
        let mapped: Track;
        try {
          mapped = await ensureMapped(
            candidate,
            (update) => setLiveStatus(`${current.name} remains live · ${candidatePhaseLabel} ${candidate.name} · ${describeMappingUpdate(update, Date.now())} · ${Math.ceil(selectionSecondsRemaining())}s to choose`),
            () => token !== liveToken.current
              || !liveRunning.current
              || selectionPhase() !== "fresh-scan"
              || searchDeadlineMode() === "cold-start",
          );
          setTracks((known) => known.some((track) => track.id === mapped.id) ? known.map((track) => track.id === mapped.id ? mapped : track) : [...known, mapped]);
        } catch (error) {
          if (token !== liveToken.current || !liveRunning.current) return;
          if (await finishAtSelectionDeadline()) return;
          if (await commitPreferredMatchIfDue()) return;
          if (searchDeadlineMode() === "cold-start") {
            if (await armBestLiveMatch()) return;
            if (!await waitForProtectedDeck("Emergency next tune prepared")) return;
            await prepareEmergencyColdStart(lockedCurrent, currentTrack, token, bestCleanStart);
            return;
          }
          const message = error instanceof Error ? error.message : "mapping failed";
          setLiveDecisions((items) => [`SKIP · ${candidate.name} · ${message}`, ...items].slice(0, 7));
          continue;
        }
        const storedAnalysis = await fetchTrackAnalysis<Analysis>(mapped.analysis);
        const analysis = withoutStoredCuePlacements(storedAnalysis);
        advanceLockedCueOnlyIfPlayed();
        const gridQuality = assessGridRetentionQuality(qualityInput(analysis));
        if (!gridQuality.accepted) {
          setLiveDecisions((items) => [`KEEP GRID / SKIP THIS AUTO-MIX · ${album.name} · ${mapped.name} · ${gridQuality.reasons.join(" · ")}`, ...items].slice(0, 7));
          continue;
        }
        const coldPlan = emergencyPlanFor(mapped, analysis, current.deck === "A" ? "B" : "A");
        if (coldPlan && coldPlan.bpm >= 130 && coldPlan.bpm <= 155) {
          const coldScore = assessLiveOpenerExit(analysis as LiveAnalysis).best?.exit.score ?? 0;
          const shouldReplaceCleanStart = !bestCleanStart
            || (discoveryPhase && !bestCleanStart.fresh)
            || (discoveryPhase === bestCleanStart.fresh && coldScore > bestCleanStart.score);
          if (shouldReplaceCleanStart) bestCleanStart = { track: mapped, analysis, score: coldScore, fresh: discoveryPhase };
        }
        const now = currentAudio?.currentTime ?? decksCurrent.current[current.deck].currentTime;
        const assessment = assessLiveCandidate(
          { id: lockedCurrent.id, name: lockedCurrent.name, analysis: lockedCurrent.analysis as LiveAnalysis },
          { id: mapped.id, name: mapped.name, analysis: analysis as LiveAnalysis },
          { outgoingNotBefore: now, lockedOutgoingHandoff: lockedOutgoing.exitHandoff },
        );
        assessedCandidates += 1;
        const outgoing = assessment.plan.tracks[0];
        const incoming = assessment.plan.tracks[1];
        outgoing.deck = current.deck;
        incoming.deck = current.deck === "A" ? "B" : "A";
        const runwayAvailable = outgoing.exitRunway > now + 4;
        const secondsLeft = Math.max(0, current.analysis.duration - now);
        // Preserve the established matching criteria. Urgency may relax the
        // combined taste score, but never grid or rundown safety.
        const accepted = liveCandidateAccepted(assessment, secondsLeft, runwayAvailable);
        const decisionReason = runwayAvailable
          ? assessment.reason
          : "cue window expired before the spare deck could be committed";
        if (!accepted) {
          void fetch("/api/dj-library/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: mapped.id,
              decision: "pass",
              score: assessment.score,
              bassSimilarity: assessment.bassSimilarity,
              tempoShiftPercent: assessment.tempoShiftPercent,
              reason: decisionReason,
            }),
          });
          setLiveDecisions((items) => [`PASS · ${album.name} · ${mapped.name} · ${decisionReason}`, ...items].slice(0, 7));
          continue;
        }
        const match: LiveMatch = { mapped, albumName: album.name, assessment, outgoing, incoming };
        liveMatches.push(match);
        liveMatches.sort((left, right) => Math.abs(right.assessment.bassSimilarity - left.assessment.bassSimilarity) > .015
          ? right.assessment.bassSimilarity - left.assessment.bassSimilarity
          : right.assessment.score - left.assessment.score);
        bestMatch = liveMatches[0];
        setLiveDecisions((items) => [`MATCH CANDIDATE ${assessedCandidates} · ${mapped.name} · bass ${Math.round(assessment.bassSimilarity * 100)}% / fit ${Math.round(assessment.score * 100)}%`, ...items].slice(0, 7));
        setLiveStatus(`${current.name} remains live · compared ${assessedCandidates} candidates · best bass match ${Math.round(bestMatch.assessment.bassSimilarity * 100)}%`);
        // Once a fresh scan passes the complete transition assessment, it has
        // fulfilled the fresh-first rule. Select it instead of spending the
        // remaining minute mapping additional alternatives.
        if (discoveryPhase && await armBestLiveMatch()) return;
        if (await commitPreferredMatchIfDue()) return;
      }
      const mappedPoolComplete = mappedAlbums.length > 0 && albumIndex === discoveryAlbums.length + mappedAlbums.length - 1;
      const noRememberedFallbackAndDeadlineTight = mappedAlbums.length === 0
        && albumIndex === discoveryAlbums.length - 1
        && searchDeadlineMode() !== "full-search";
      if (bestMatch && (mappedPoolComplete || noRememberedFallbackAndDeadlineTight)) {
        if (await armBestLiveMatch()) return;
      }
    }
    if (await armBestLiveMatch()) return;
    // Exhausting the current candidate pass is not permission to move the
    // outgoing cue. Keep it visible and selected until its actual handoff has
    // played, then begin a fresh comparison pass against the next cue.
    if (lockedOutgoing.exitHandoff > currentTrackTime() + .05 && secondsRemaining() > 45) {
      setLiveStatus(`${current.name} has no ready match for its locked ${timeLabel(lockedOutgoing.exitHandoff)} cue · keeping that cue until it plays`);
      while (token === liveToken.current
        && liveRunning.current
        && lockedOutgoing.exitHandoff > currentTrackTime() + .05
        && secondsRemaining() > 45) {
        await wait(120);
      }
      if (token !== liveToken.current || !liveRunning.current) return;
      if (advanceLockedCueOnlyIfPlayed()) {
        liveSearchStarted.current.delete(current.id);
        startLiveCandidateSearch(lockedCurrent, currentTrack, token, options);
        return;
      }
    }
    if (!await waitForProtectedDeck("Next tune search complete")) return;
    await prepareEmergencyColdStart(lockedCurrent, currentTrack, token, bestCleanStart);
  };
  const startLiveCandidateSearch = (current: DemoTrackPlan, currentTrack: Track, token: number, options: LiveSearchOptions = {}) => {
    if (liveSearchStarted.current.has(current.id)) return false;
    liveSearchStarted.current.add(current.id);
    void searchLiveCandidate(current, currentTrack, token, options).catch((error: unknown) => {
      if (token !== liveToken.current || !liveRunning.current) return;
      setLiveMode("error");
      setLiveStatus(error instanceof Error ? error.message : "The next-tune search stopped unexpectedly");
    });
    return true;
  };
  const startLiveSet = async () => {
    if (liveMode === "loading" || !crateAlbums.length) return;
    const token = ++liveToken.current;
    liveRunning.current = true;
    usedCrateTracks.current.clear();
    liveSearchStarted.current.clear();
    liveLockedOutgoing.current.clear();
    liveOpenerCurrent.current = null;
    setLiveDecisions([]);
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    emergencyTimer.current = null;
    demoTimer.current = null;
    demoRuntime.current = null;
    setPicker(null);
    setManualLoopDialog(null);
    setCustomLoopStarts((current) => ({ ...current, A: null, B: null }));
    setCustomLoopPurposes((current) => ({ ...current, A: null, B: null }));
    setLoopTeachingStatus((current) => ({ ...current, A: "", B: "" }));
    setCueTeachingStatus((current) => ({ ...current, A: "", B: "" }));
    setOverviewZoom((current) => ({ ...current, A: 1, B: 1 }));
    for (const id of AUTOMATION_DECK_IDS) {
      mediaRefs[id].forEach((mediaRef) => mediaRef.current?.pause());
      activeMedia.current[id] = 0;
      changeDeck(id, emptyDeck());
      rememberLoadedTrack(id, null);
    }
    lastPlaying.current = [];
    publishPreparedDemo(null);
    setLiveStatus("Decks cleared · choosing a fresh opener from the saved grid library");
    const opener = await chooseLiveOpener(token);
    if (!opener || token !== liveToken.current || !liveRunning.current) return;
    setLiveMode("starting");
    setLiveStatus(`Loading ${opener.track.name} from the beginning`);
    for (const id of AUTOMATION_DECK_IDS) activeAudio(id)?.pause();
    const openerExit = assessLiveOpenerExit(opener.analysis as LiveAnalysis).best;
    if (!openerExit) throw new Error(`${opener.track.name} no longer has a safe opener exit`);
    const bpm = opener.analysis.tempoSections.find((section) => openerExit.exit.time >= section.start && openerExit.exit.time < section.end)?.bpm
      ?? opener.analysis.tempoSections[0]?.bpm
      ?? 145;
    const openerPlan: DemoTrackPlan = {
      id: opener.track.id,
      name: opener.track.name,
      deck: "A",
      analysis: opener.analysis,
      bpm,
      entryRunway: 0,
      entryDrop: opener.analysis.beats.find((beat) => beat.isDownbeat)?.time ?? 0,
      skipTo: 0,
      exitRunway: openerExit.start,
      exitHandoff: openerExit.exit.time,
      mixOut: openerExit.end,
      cuePoints: [
        { id: "exit-runway", time: openerExit.start, label: "RUNWAY OUT", description: "Start the next deck here, 32 beats before the bass switch.", colour: "#ffc857" },
        { id: "exit-handoff", time: openerExit.exit.time, label: "MIX OUT · BASS OFF", description: "Kill this tune's bass here while the incoming bass opens on the same downbeat.", colour: "#ff6a4a" },
        { id: "mix-out", time: openerExit.end, label: "MIX CLEAR", description: "End of the blend; this outgoing deck is now fully removed.", colour: "#ab7dff" },
      ],
    };
    const prepared: PreparedDemo = { plan: { title: opener.track.name, runwayBeats: 32, blendBeats: 64, settleBeats: 16, tracks: [openerPlan] }, tracks: { [opener.track.id]: opener.track } };
    publishPreparedDemo(prepared);
    await loadDemoDeck("A", openerPlan, 0, "primary", prepared);
    if (token !== liveToken.current) return;
    await ensureGraph("A");
    const audio = activeAudio("A");
    if (!audio) throw new Error("The live opener deck is unavailable");
    audio.currentTime = 0;
    setDeckRate("A", 1);
    await audio.play();
    changeDeck("A", { currentTime: 0, playing: true, volume: .85, low: 0, mid: 0, high: 0, tempoRate: 1 });
    lastPlaying.current = ["A"];
    setLiveMode("searching");
    setLiveStatus(`${openerPlan.name} playing from 0:00 · digging through the next album now`);
    startLiveCandidateSearch(openerPlan, opener.track, token);
  };
  const stopLiveSet = () => {
    liveRunning.current = false;
    liveSearchStarted.current.clear();
    liveLockedOutgoing.current.clear();
    liveToken.current += 1;
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    emergencyTimer.current = null;
    demoTimer.current = null;
    demoRuntime.current = null;
    for (const id of AUTOMATION_DECK_IDS) { activeAudio(id)?.pause(); changeDeck(id, { playing: false }); }
    liveOpenerCurrent.current = null;
    publishPreparedDemo(null);
    setLiveMode("idle");
    setLiveStatus("Stopped · press Start Live Crate Set when you want a fresh first choice");
  };
  const activateLoadedAssistedChoice = (choice: AssistedPending, options: { preserveOpenerChannel?: boolean } = {}) => {
    if (!(choice.order === 0 && options.preserveOpenerChannel)) {
      changeDeck(choice.deck, choice.order === 0
        ? { volume: SAFE_LOADED_DECK_VOLUME, low: 0, mid: 0, high: 0 }
        : { volume: SAFE_LOADED_DECK_VOLUME, low: -60, mid: 0, high: 0 });
    }
    const legacyWindow = choice.analysis.teaching?.manualCycle;
    const introWindow = choice.analysis.teaching?.manualIntroCycle ?? (legacyWindow?.purpose === "intro-loop" ? legacyWindow : undefined);
    const outroWindow = choice.analysis.teaching?.manualOutroCycle ?? (legacyWindow?.purpose === "outro-transition" ? legacyWindow : undefined);
    const fullIntroSelected = choice.order === 0 && fullIntroTracks[choice.deck] === choice.track.id;
    const cueState: AssistedCueState = {
      order: choice.order,
      deck: choice.deck,
      track: choice.track,
      mixInRequired: choice.order > 0,
      mixInSet: fullIntroSelected || Boolean(introWindow),
      mixOutSet: Boolean(outroWindow),
      introPrepSkipped: fullIntroSelected,
      selection: choice.selection,
    };
    const windowsReady = cueState.order === 0 ? cueState.mixOutSet : cueState.mixInSet;
    setAssistedPending(null);
    setAssistedCueState(cueState);
    setAssistedMode(windowsReady ? "ready" : "awaiting-cues");
    setAssistedStatus(windowsReady
      ? choice.order === 0
        ? `${choice.track.name}'s outgoing run-up window is ready · find Tune 2`
        : `${choice.track.name}'s incoming and outgoing run-up windows are ready · Launch will align the two window ends`
      : choice.order === 0
        ? fullIntroSelected
          ? `${choice.track.name} is the full-intro opener · mark only its Mix Out window`
          : `${choice.track.name} loaded on Deck ${choice.deck} · choose Full Intro or mark its Mix In window, then mark its Mix Out window`
        : `${choice.track.name} loaded muted on Deck ${choice.deck} · mark its incoming and outgoing run-up windows`);
    void fetch(`/api/dj-library/teaching?id=${encodeURIComponent(choice.track.id)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ profile?: TeachingProfile }>)
      .then((payload) => { if (payload.profile) setTeachingProfile(payload.profile); })
      .catch(() => undefined);
  };
  const loadAssistedChoice = async (choice: AssistedPending, token: number) => {
    if (!assistedRunning.current || token !== assistedToken.current) return;
    const alreadyLoaded = decksCurrent.current[choice.deck].track?.id === choice.track.id;
    setAssistedStatus(alreadyLoaded
      ? `${choice.track.name} is loaded on Deck ${choice.deck} · attaching the completed analysis without resetting the deck`
      : `${choice.track.name} selected · loading Deck ${choice.deck} from the analysis already reviewed`);
    if (!alreadyLoaded || !hydrateLoadedTrackAnalysis(choice.deck, choice.track, choice.analysis)) {
      await loadTrack(choice.deck, choice.track, choice.analysis);
    }
    if (!assistedRunning.current || token !== assistedToken.current) return;
    activateLoadedAssistedChoice(choice);
  };
  const prepareLoadedAssistedChoice = async (order: number, deck: DeckId, token: number): Promise<AssistedPending> => {
    const loaded = decksCurrent.current[deck];
    if (!loaded.track) throw new Error(`Load your Tune ${order + 1} on Deck ${deck} first`);
    if (loaded.playing && order > 0) throw new Error(`Pause Deck ${deck} before preparing it as the incoming tune`);
    let track = loaded.track;
    let analysis = loaded.analysis;
    const cancelled = () => token !== assistedToken.current || !assistedRunning.current || decksCurrent.current[deck].track?.id !== track.id;
    if (!analysis) {
      setAssistedMode("finding");
      setAssistedStatus(`${track.name} is already loaded on Deck ${deck} · finishing waveform, BPM, beats and downbeats before cue preparation`);
      // The deck already holds this tune, so its strip shows this mapping as it runs.
      const loadedId = track.id;
      let lastUpdate: MappingUpdate | null = null;
      if (!track.mapped) {
        try {
          track = await ensureMapped(track, (update) => {
            lastUpdate = update;
            setAssistedStatus(`${track.name} · ${describeMappingUpdate(update, Date.now())}`);
            if (decksCurrent.current[deck].track?.id === loadedId) setDeckLoadAnalysis(deck, loadedId, { state: "mapping", update });
          }, cancelled);
        } catch (error) {
          if (decksCurrent.current[deck].track?.id === loadedId) setDeckLoadAnalysis(deck, loadedId, { state: "failed", error: error instanceof Error ? error.message : "analysis stopped", update: lastUpdate });
          throw error;
        }
        setTracks((known) => known.map((item) => item.id === track.id ? track : item));
      }
      if (cancelled()) throw new Error("Loaded-tune preparation was cancelled");
      setDeckLoadAnalysis(deck, loadedId, { state: "fetching", update: lastUpdate, saved: !(lastUpdate as MappingUpdate | null)?.snapshot, startedAt: Date.now() });
      const rawAnalysis = withoutStoredCuePlacements(await fetchTrackAnalysis<Analysis>(track.analysis));
      const predictionProfile = await fetch(`/api/dj-library/teaching?exclude=${encodeURIComponent(track.id)}`, { cache: "no-store" })
        .then(async (response): Promise<{ profile?: TeachingProfile }> => response.ok ? response.json() : { profile: undefined })
        .then((payload) => payload.profile ?? null)
        .catch(() => null);
      analysis = withLearnedCuePredictions(rawAnalysis, predictionProfile);
      if (!hydrateLoadedTrackAnalysis(deck, track, analysis)) throw new Error(`${track.name} changed before its analysis could be attached`);
    }
    const previousDeck = assistedPreviousDeck(deck);
    const previous = order > 0 ? decksCurrent.current[previousDeck] : null;
    if (order > 0 && (!previous?.track || !previous.analysis)) {
      throw new Error(`Deck ${previousDeck} must keep the previous assisted tune and its outgoing run-up`);
    }
    return {
      order,
      deck,
      track,
      analysis,
      selection: {
        selectedBpm: trackSelectionBpm(analysis),
        previousTrackId: previous?.track?.id ?? null,
        previousTrackName: previous?.track?.name ?? null,
        previousBpm: previous?.analysis ? trackSelectionBpm(previous.analysis) : null,
      },
    };
  };
  const findAssistedTune = async (order: number, outgoing: AssistedCueState | null, token: number) => {
    if (!assistedRunning.current || token !== assistedToken.current || !tracks.length) return;
    setAssistedMode("finding");
    setAssistedPending(null);
    const targetDeck = assistedDeckForOrder(order);
    setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `Locating Tune ${order + 1} in the crate · preparing Deck ${targetDeck}` }));
    const outgoingDeck = outgoing ? decksCurrent.current[outgoing.deck] : null;
    const outgoingLegacyWindow = outgoingDeck?.analysis?.teaching?.manualCycle;
    const outgoingRunup = outgoingDeck?.analysis?.teaching?.manualOutroCycle
      ?? (outgoingLegacyWindow?.purpose === "outro-transition" ? outgoingLegacyWindow : undefined);
    const lockedOutgoingWindowEnd = outgoingRunup?.end ?? null;
    if (order > 0 && (!outgoingDeck?.track || !outgoingDeck.analysis || lockedOutgoingWindowEnd === null)) {
      throw new Error("Mark the current tune's outgoing run-up window before Crowd searches for the next tune");
    }
    const previousBpm = outgoingDeck?.analysis ? trackSelectionBpm(outgoingDeck.analysis) : null;
    const previousTrack = outgoingDeck?.track ?? null;
    const assessedThisSearch = new Set<string>();
    let assessed = 0;
    const cancelled = () => token !== assistedToken.current || !assistedRunning.current;
    const confirmFullTune = async (track: Track): Promise<Track | null> => {
      if (isKnownShortSample(track.duration)) return null;
      if (track.duration > 0) return track;
      try {
        const response = await fetch(`/api/audio-duration?id=${encodeURIComponent(track.id)}`, { cache: "no-store" });
        const payload = await response.json() as { duration?: number | null; shortSample?: boolean };
        if (payload.shortSample || isKnownShortSample(payload.duration)) return null;
        if (payload.duration && payload.duration > 0) {
          const measured = { ...track, duration: payload.duration };
          setTracks((known) => known.map((item) => item.id === track.id ? { ...item, duration: payload.duration! } : item));
          return measured;
        }
      } catch {
        // Unknown duration is not a rejection. Loading remains more important
        // than refusing a valid tune because metadata could not be measured.
      }
      return track;
    };
    const consider = async (track: Track): Promise<AssistedPending | null> => {
      if (cancelled() || usedCrateTracks.current.has(track.id) || assessedThisSearch.has(track.id)) return null;
      assessedThisSearch.add(track.id);
      let mapped = track;
      try {
        assessed += 1;
        const targetAudio = activeAudio(targetDeck);
        if (!targetAudio || targetAudio.paused) {
          setAssistedStatus(`${mapped.name} selected with no screening · loading Deck ${targetDeck} immediately`);
          await loadTrack(targetDeck, mapped, undefined, false, false, { analysisNote: "Assisted selection requests this tune's analysis next" });
        }
        // The deck's strip follows this tune only while the deck really holds
        // it; with the deck still playing another tune, only the assisted
        // status line reports it.
        const onDeck = () => decksCurrent.current[targetDeck].track?.id === track.id;
        let lastUpdate: MappingUpdate | null = null;
        if (!mapped.mapped) {
          setAssistedStatus(`${mapped.name} is already selected${targetAudio && !targetAudio.paused ? "" : ` and loaded on Deck ${targetDeck}`} · analysis is advisory and cannot reject it`);
          try {
            mapped = await ensureMapped(mapped, (update) => {
              lastUpdate = update;
              setAssistedStatus(`${mapped.name} · ${describeMappingUpdate(update, Date.now())}`);
              if (onDeck()) {
                setDeckLoadAnalysis(targetDeck, track.id, { state: "mapping", update });
                setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `${mapped.name} · ${describeMappingUpdate(update, Date.now())}` }));
              }
            }, cancelled);
          } catch (error) {
            if (onDeck()) setDeckLoadAnalysis(targetDeck, track.id, { state: "failed", error: error instanceof Error ? error.message : "analysis stopped", update: lastUpdate });
            throw error;
          }
          setTracks((known) => known.some((item) => item.id === mapped.id) ? known.map((item) => item.id === mapped.id ? mapped : item) : [...known, mapped]);
        }
        if (cancelled()) return null;
        if (onDeck()) {
          setDeckLoadAnalysis(targetDeck, track.id, { state: "fetching", update: lastUpdate, saved: !(lastUpdate as MappingUpdate | null)?.snapshot, startedAt: Date.now() });
          setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `Loading grid map, BPM, beats and downbeats · ${mapped.name}` }));
        }
        const analysis = withoutStoredCuePlacements(await fetchTrackAnalysis<Analysis>(mapped.analysis));
        const fullBpm = trackSelectionBpm(analysis);
        setAssistedDecisions((items) => [`PICKED · ${mapped.name} · ${fullBpm.toFixed(1)} BPM advisory · no screening`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
        return {
          order,
          deck: targetDeck,
          track: mapped,
          analysis,
          selection: {
            selectedBpm: fullBpm,
            previousTrackId: previousTrack?.id ?? null,
            previousTrackName: previousTrack?.name ?? null,
            previousBpm,
          },
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "could not analyse";
        if (!cancelled()) setAssistedDecisions((items) => [`LOADED, ANALYSIS UNAVAILABLE · ${track.name} · ${detail}`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
        if (decksCurrent.current[targetDeck].track?.id === track.id) {
          throw new Error(`${track.name} is loaded on Deck ${targetDeck}, but its analysis stopped: ${detail}`);
        }
        throw error;
      }
    };

    setAssistedStatus(`Finding Tune ${order + 1} for Deck ${targetDeck}`);
    const payload = await fetch(`/api/map?includeUnknown=1&v=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()) as { tracks: Track[] };
    if (cancelled()) return;
    setTracks(payload.tracks);
    const candidates = shuffled(assistedSelectionPool(payload.tracks, usedCrateTracks.current));
    let chosen: AssistedPending | null = null;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (cancelled()) return;
      const candidate = await confirmFullTune(candidates[candidateIndex]);
      if (!candidate || cancelled()) continue;
      chosen = await consider(candidate);
      if (cancelled()) return;
      if (chosen) break;
    }
    if (cancelled()) return;
    if (!chosen) throw new Error(`No unused full tune was available after checking ${assessed}`);
    usedCrateTracks.current.add(chosen.track.id);
    const chosenBpm = trackSelectionBpm(chosen.analysis);
    setAssistedDecisions((items) => [`SELECTED · ${chosen.track.name} · ${chosenBpm.toFixed(1)} BPM advisory · first random unused tune · zero screening`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
    void fetch("/api/dj-library/intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "selected",
        id: chosen.track.id,
        relatedId: previousTrack?.id ?? null,
        context: { order, bpm: chosenBpm, previousBpm },
      }),
    }).then((response) => response.json() as Promise<{ stats?: LibraryIntelligenceStats }>)
      .then((memory) => { if (memory.stats) setLibraryIntelligence(memory.stats); })
      .catch(() => undefined);
    const pending = chosen;
    const targetAudio = activeAudio(targetDeck);
    if (targetAudio && !targetAudio.paused) {
      setAssistedPending(pending);
      setAssistedMode("waiting-deck");
      setAssistedStatus(`${chosen.track.name} is ready · Deck ${targetDeck} is still playing, so Crowd will not overwrite it`);
      return;
    }
    await loadAssistedChoice(pending, token);
  };
  const startAssistedSet = async () => {
    if (!tracks.length || liveRunning.current || demoMode === "running") return;
    const token = ++assistedToken.current;
    setAssistedSource("random");
    assistedRunning.current = true;
    assistedPlaying.current = false;
    assistedReplaySnapshot.current = null;
    setAssistedLaunchedOrder(-1);
    localStorage.removeItem(ASSISTED_SESSION_STORAGE_KEY);
    usedCrateTracks.current.clear();
    setAssistedDecisions([]);
    setAssistedCueState(null);
    setAssistedPending(null);
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    demoTimer.current = null;
    emergencyTimer.current = null;
    demoRuntime.current = null;
    publishPreparedDemo(null);
    setPicker(null);
    setManualLoopDialog(null);
    setCustomLoopStarts({ A: null, B: null, C: null });
    setCustomLoopPurposes({ A: null, B: null, C: null });
    setLoopTeachingStatus({ A: "", B: "", C: "" });
    setCueTeachingStatus({ A: "", B: "", C: "" });
    for (const id of DECK_IDS) {
      mediaRefs[id].forEach((mediaRef) => mediaRef.current?.pause());
      activeMedia.current[id] = 0;
      changeDeck(id, emptyDeck());
      rememberLoadedTrack(id, null);
    }
    setAssistedStatus("Decks cleared · picking the first random unused tune with no BPM, grid or compatibility screening");
    await findAssistedTune(0, null, token);
  };
  const startAssistedSetFromLoaded = async () => {
    if (!canStartLoadedAssistedSet({
      A: decksCurrent.current.A.track,
      B: decksCurrent.current.B.track,
      C: decksCurrent.current.C.track,
    }) || liveRunning.current || demoMode === "running") {
      throw new Error("Load your first tune on Deck A before adopting the loaded decks");
    }
    const token = ++assistedToken.current;
    assistedRunning.current = true;
    assistedPlaying.current = false;
    assistedReplaySnapshot.current = null;
    setAssistedSource("loaded");
    setAssistedLaunchedOrder(-1);
    localStorage.removeItem(ASSISTED_SESSION_STORAGE_KEY);
    usedCrateTracks.current = new Set(DECK_IDS.flatMap((id) => {
      const trackId = decksCurrent.current[id].track?.id;
      return trackId ? [trackId] : [];
    }));
    setAssistedDecisions([]);
    setAssistedCueState(null);
    setAssistedPending(null);
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    demoTimer.current = null;
    emergencyTimer.current = null;
    demoRuntime.current = null;
    publishPreparedDemo(null);
    setPicker(null);
    setManualLoopDialog(null);
    setCustomLoopStarts({ A: null, B: null, C: null });
    setCustomLoopPurposes({ A: null, B: null, C: null });
    setCueTeachingStatus({ A: "", B: "", C: "" });
    setAssistedMode("finding");
    setAssistedStatus("Adopting your loaded Deck A tune without changing its play position, fader or EQ");
    const choice = await prepareLoadedAssistedChoice(0, "A", token);
    if (token !== assistedToken.current || !assistedRunning.current) return;
    activateLoadedAssistedChoice(choice, { preserveOpenerChannel: true });
    setAssistedDecisions([`YOUR TUNE 1 · ${choice.track.name} · Deck A · same assisted cue and overlap options enabled`]);
  };
  const stopAssistedSet = () => {
    assistedRunning.current = false;
    assistedPlaying.current = false;
    assistedReplaySnapshot.current = null;
    localStorage.removeItem(ASSISTED_SESSION_STORAGE_KEY);
    assistedToken.current += 1;
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    demoTimer.current = null;
    emergencyTimer.current = null;
    demoRuntime.current = null;
    publishPreparedDemo(null);
    setAssistedSource("random");
    setAssistedMode("idle");
    setAssistedCueState(null);
    setAssistedPending(null);
    setAssistedDecisions([]);
    setKickPhaseStatus("KICKS · ARMED FOR OVERLAP");
    for (const id of DECK_IDS) { activeAudio(id)?.pause(); changeDeck(id, { playing: false }); }
    setAssistedStatus("Stopped · the grid and every teaching example remain saved");
  };
  const stopAndResetAssistedPlayback = () => {
    const current = assistedCueState;
    if (!current || current.order < 1) {
      stopAssistedSet();
      return;
    }
    demoToken.current += 1;
    // assistedRunning stays true below (it is the session flag), so bumping
    // assistedToken is the only way to cancel a stale search continuation
    // once the set is stopped and reset to ready.
    assistedToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    if (emergencyTimer.current) clearInterval(emergencyTimer.current);
    demoTimer.current = null;
    emergencyTimer.current = null;
    demoRuntime.current = null;
    const prepared = preparedDemoCurrent.current;
    const stored = assistedReplaySnapshot.current?.order === current.order ? assistedReplaySnapshot.current : null;
    const fallback = prepared ? Object.fromEntries(prepared.plan.tracks.map((planned, index) => [planned.deck, {
      trackId: planned.id,
      currentTime: index === 0 ? current.order === 1 ? 0 : planned.exitRunway : assistedIncomingPrerollTime(planned),
      tempoRate: decksCurrent.current[planned.deck].tempoRate || 1,
      volume: index === 0 ? .85 : SAFE_LOADED_DECK_VOLUME,
      low: index === 0 ? 0 : -60,
      mid: index === 0 ? 0 : -24,
      high: index === 0 ? 0 : -18,
    }])) as Partial<Record<DeckId, AssistedDeckReset>> : {};
    for (const id of DECK_IDS) {
      cancelLoopTransition(id);
      delete tempoReturns.current[id];
      const reset = stored?.decks[id] ?? fallback[id];
      mediaRefs[id].forEach((mediaRef) => {
        const media = mediaRef.current;
        if (!media) return;
        media.pause();
        if (reset && decksCurrent.current[id].track?.id === reset.trackId) {
          media.currentTime = reset.currentTime;
          media.playbackRate = reset.tempoRate;
        }
      });
      if (reset && decksCurrent.current[id].track?.id === reset.trackId) {
        changeDeck(id, {
          currentTime: reset.currentTime,
          tempoRate: reset.tempoRate,
          volume: reset.volume,
          low: reset.low,
          mid: reset.mid,
          high: reset.high,
          playing: false,
          cuePreviewing: false,
          loopActive: false,
        });
      } else {
        changeDeck(id, { playing: false, cuePreviewing: false, loopActive: false });
      }
    }
    lastPlaying.current = [];
    assistedRunning.current = true;
    assistedPlaying.current = false;
    setKickPhaseStatus("KICKS · ARMED FOR OVERLAP");
    setAssistedMode("ready");
    setAssistedStatus(`${current.track.name} · playback stopped and the same assisted set is reset, cued and ready to run again`);
  };
  const skipAssistedIntroPrep = () => {
    setAssistedCueState((current) => {
      if (!current || current.order !== 0 || current.introPrepSkipped) return current;
      cancelLoopTransition(current.deck);
      loopCycleArmed.current[current.deck] = false;
      changeDeck(current.deck, { loopActive: false });
      setCustomLoopStarts((state) => ({ ...state, [current.deck]: null }));
      setCustomLoopPurposes((state) => ({ ...state, [current.deck]: null }));
      setFullIntroTracks((state) => ({ ...state, [current.deck]: current.track.id }));
      setManualLoopDialog((dialog) => dialog?.deck === current.deck && dialog.purpose === "intro-loop" ? null : dialog);
      setLoopTeachingStatus((state) => ({ ...state, [current.deck]: "First-tune intro loop and cue skipped · this opener runs freely from its current position." }));
      setAssistedStatus(`${current.track.name} is a free-running opener · intro preparation skipped · mark only its outgoing run-up window`);
      return { ...current, mixInSet: true, introPrepSkipped: true };
    });
  };
  const requestNextAssistedTune = async () => {
    const current = assistedCueState;
    if (!current || assistedMode !== "ready") return;
    const order = current.order + 1;
    const targetDeck = assistedDeckForOrder(order);
    const loadedTargetDeck = assistedSource === "loaded"
      ? assistedLoadedDeckForOrder(order, {
        A: decksCurrent.current.A.track,
        B: decksCurrent.current.B.track,
        C: decksCurrent.current.C.track,
      })
      : null;
    if (loadedTargetDeck) {
      const token = assistedToken.current;
      const choice = await prepareLoadedAssistedChoice(order, loadedTargetDeck, token);
      if (!assistedRunning.current || token !== assistedToken.current) return;
      setAssistedStatus(`${choice.track.name} was manually loaded on Deck ${loadedTargetDeck} · using it instead of searching the library`);
      await loadAssistedChoice(choice, token);
      setAssistedDecisions((items) => [`YOUR TUNE ${order + 1} · ${choice.track.name} · Deck ${targetDeck} · adopted without track selection`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
      return;
    }
    await findAssistedTune(order, current, assistedToken.current);
  };
  const rejectAssistedTune = async () => {
    const loaded = assistedCueState && assistedCueState.order > 0 ? assistedCueState : null;
    const candidate = assistedPending ?? loaded;
    if (!candidate || candidate.order < 1 || !candidate.selection.previousTrackId || assistedMode === "playing") return;
    const previousDeck = assistedPreviousDeck(candidate.deck);
    const previousState = decksCurrent.current[previousDeck];
    if (!previousState.track || !previousState.analysis || previousState.track.id !== candidate.selection.previousTrackId) {
      throw new Error("The previous tune is no longer loaded, so this incompatibility cannot be tied to the correct pair");
    }
    setAssistedStatus(`Saving ${previousState.track.name} ↔ ${candidate.track.name} as an incompatible pair`);
    const response = await fetch("/api/dj-library/intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "incompatible",
        currentId: previousState.track.id,
        rejectedId: candidate.track.id,
        currentBpm: candidate.selection.previousBpm,
        rejectedBpm: candidate.selection.selectedBpm,
        reason: "Rejected as incompatible in the assisted crate set",
        context: { order: candidate.order, previousDeck, rejectedDeck: candidate.deck },
      }),
    });
    const payload = await response.json() as { stats?: LibraryIntelligenceStats; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "That incompatible pair could not be saved");
    if (payload.stats) setLibraryIntelligence(payload.stats);
    setAssistedDecisions((items) => [
      `INCOMPATIBLE FEEDBACK · ${previousState.track!.name} ↔ ${candidate.track.name} · recorded without blocking either tune`,
      ...items,
    ].slice(0, ASSISTED_DECISION_LOG_LIMIT));
    if (loaded?.track.id === candidate.track.id) unloadTrack(candidate.deck, { reconcileAssisted: false });
    setAssistedCueState(null);
    setAssistedPending(null);
    const previousBpm = trackSelectionBpm(previousState.analysis);
    const outgoing: AssistedCueState = {
      order: candidate.order - 1,
      deck: previousDeck,
      track: previousState.track,
      mixInRequired: candidate.order - 1 > 0,
      mixInSet: true,
      mixOutSet: true,
      introPrepSkipped: candidate.order - 1 === 0,
      selection: {
        selectedBpm: previousBpm,
        previousTrackId: null,
        previousTrackName: null,
        previousBpm: null,
      },
    };
    await findAssistedTune(candidate.order, outgoing, assistedToken.current);
  };
  const preparedLoadedAssistedSequence = (): PreparedDemo | null => {
    const a = decksCurrent.current.A;
    const b = decksCurrent.current.B;
    const c = decksCurrent.current.C;
    if (!a.track || !a.analysis || !b.track || !b.analysis || !c.track || !c.analysis) return null;
    if (!savedManualWindow(a.analysis, "outro-transition")
      || !savedManualWindow(b.analysis, "intro-loop")
      || !savedManualWindow(b.analysis, "outro-transition")
      || !savedManualWindow(c.analysis, "intro-loop")) return null;
    const automations = [
      assistedAutomationForTrack(b.track.id, b.analysis),
      assistedAutomationForTrack(c.track.id, c.analysis),
    ];
    return {
      plan: buildAssistedPlaybackSequence([
        { id: a.track.id, name: a.track.name, deck: "A", analysis: a.analysis },
        { id: b.track.id, name: b.track.name, deck: "B", analysis: b.analysis },
        { id: c.track.id, name: c.track.name, deck: "C", analysis: c.analysis },
      ], automations),
      tracks: {
        [a.track.id]: a.track,
        [b.track.id]: b.track,
        [c.track.id]: c.track,
      },
      assistedAutomations: automations,
      rotatingAssisted: true,
      assistedOrderOffset: 0,
    };
  };
  const launchAssistedPlayback = async (options: { runwayPreview?: boolean; cueState?: AssistedCueState } = {}) => {
    const current = options.cueState ?? assistedCueState;
    const explicitLoadedPair = Boolean(options.cueState);
    const runwayPreviewReady = Boolean(
      options.runwayPreview
      && current
      && current.order > 0
      && current.mixInSet
      && (explicitLoadedPair || assistedMode === "awaiting-cues" || assistedMode === "ready")
    );
    const fullLaunchReady = Boolean(
      !options.runwayPreview
      && current
      && current.order > 0
      && current.mixInSet
      && (explicitLoadedPair || assistedMode === "ready")
    );
    if (!current || (!runwayPreviewReady && !fullLaunchReady)) {
      throw new Error(options.runwayPreview
        ? "Set Tune 2's Mix In window before starting the runway preview"
        : "Set the outgoing tune's Mix Out and the incoming tune's Mix In before launch");
    }
    const incomingDeck = current.deck;
    const outgoingDeck = assistedPreviousDeck(incomingDeck);
    const outgoingState = decksCurrent.current[outgoingDeck];
    const incomingState = decksCurrent.current[incomingDeck];
    if (!outgoingState.track || !outgoingState.analysis || !incomingState.track || !incomingState.analysis) throw new Error("Both assisted decks must be loaded before launch");
    const pairAutomation = assistedAutomationForTrack(incomingState.track.id, incomingState.analysis);
    const pairPlan = buildAssistedPlaybackPlan(
      { id: outgoingState.track.id, name: outgoingState.track.name, deck: outgoingDeck, analysis: outgoingState.analysis },
      { id: incomingState.track.id, name: incomingState.track.name, deck: incomingDeck, analysis: incomingState.analysis },
      pairAutomation,
    );
    const sequencePrepared = options.runwayPreview || current.order > 2 ? null : preparedLoadedAssistedSequence();
    const prepared: PreparedDemo = sequencePrepared ?? {
      plan: pairPlan,
      tracks: { [outgoingState.track.id]: outgoingState.track, [incomingState.track.id]: incomingState.track },
      assistedAutomations: [pairAutomation],
      assistedOrderOffset: Math.max(0, current.order - 1),
    };
    const isFullSequence = prepared.plan.tracks.length > 2;
    const [first, second] = prepared.plan.tracks;
    const playbackRecords = prepared.plan.tracks.slice(0, -1).flatMap((planned, index) => {
      const following = prepared.plan.tracks[index + 1];
      const track = prepared.tracks[planned.id];
      const followingTrack = prepared.tracks[following.id];
      if (!track || !followingTrack) return [];
      return [
        { track, relatedId: followingTrack.id, role: "outgoing", assistedOrder: index + 1 },
        { track: followingTrack, relatedId: track.id, role: "incoming", assistedOrder: index + 1 },
      ];
    });
    void Promise.all(playbackRecords.map(async ({ track, relatedId, role, assistedOrder }) => {
      const response = await fetch("/api/dj-library/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "played", id: track.id, relatedId, context: { assistedOrder, role } }),
      });
      return response.json() as Promise<{ stats?: LibraryIntelligenceStats }>;
    })).then((records) => {
      const latest = records.at(-1)?.stats;
      if (latest) setLibraryIntelligence(latest);
    }).catch(() => undefined);
    const replaySourceTime = options.runwayPreview
      ? assistedRunwayPreviewStart(pairPlan.tracks[0])
      : isFullSequence || current.order === 1 ? 0 : outgoingState.currentTime;
    const resetDecks: Partial<Record<DeckId, AssistedDeckReset>> = {};
    prepared.plan.tracks.forEach((planned, index) => {
      const state = decksCurrent.current[planned.deck];
      if (!state.track || state.track.id !== planned.id) return;
      resetDecks[planned.deck] = {
        trackId: planned.id,
        currentTime: index === 0 ? replaySourceTime : assistedIncomingPrerollTime(planned),
        tempoRate: state.tempoRate || 1,
        volume: index === 0 ? .85 : SAFE_LOADED_DECK_VOLUME,
        low: index === 0 ? 0 : -60,
        mid: index === 0 ? 0 : -24,
        high: index === 0 ? 0 : -18,
      };
    });
    assistedReplaySnapshot.current = {
      order: current.order,
      decks: resetDecks,
    };
    const replayingPair = current.order <= assistedLaunchedOrder;
    if (isFullSequence || replayingPair) {
      for (const id of new Set(prepared.plan.tracks.map((planned) => planned.deck))) {
        activeAudio(id)?.pause();
        changeDeck(id, { playing: false });
      }
    }
    const alreadyPlaying = !isFullSequence
      && !options.runwayPreview
      && Boolean(activeAudio(outgoingDeck) && !activeAudio(outgoingDeck)!.paused);
    if (alreadyPlaying && activeAudio(outgoingDeck)!.currentTime >= pairPlan.tracks[0].exitHandoff - .25) {
      throw new Error(`${pairPlan.tracks[0].name}'s outgoing run-up endpoint has already passed · stop and prepare a fresh assisted run`);
    }
    const token = ++demoToken.current;
    // Launch takes ownership of both decks: invalidate any stale
    // findAssistedTune / prepareLoadedAssistedChoice continuation so it can
    // never load a tune over the running set or rewrite assistedCueState.
    // Nothing in this launch path reads assistedToken (its await guards use
    // demoToken above), so a plain increment is safe.
    assistedToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    demoTimer.current = null;
    demoRuntime.current = null;
    assistedPlaying.current = true;
    setKickPhaseStatus("KICKS · ARMED FOR OVERLAP");
    setAssistedMode("playing");
    setAssistedLaunchedOrder(current.order);
    publishPreparedDemo(prepared);
    reportCrowdLiveEvent("run.launch-requested", {
      mode: "assisted",
      runwayPreview: Boolean(options.runwayPreview),
      fullSequence: isFullSequence,
      trackIds: prepared.plan.tracks.map((track) => track.id),
      decks: prepared.plan.tracks.map((track) => track.deck),
      replaySourceTime,
      transitions: prepared.plan.tracks.length - 1,
      firstWindow: { start: first.exitRunway, end: first.exitHandoff },
      beats: pairAutomation.windowBeats,
      bassSwapBeat: pairAutomation.bassSwapBeat,
    });
    setAssistedStatus(options.runwayPreview
      ? `Runway rehearsal · ${first.name} starts ${ASSISTED_RUNWAY_PREVIEW_LEAD_BEATS} beats before the ${pairAutomation.windowBeats}-beat window · assisted control takes over at the boundary`
      : isFullSequence
        ? `Launching the complete set from ${first.name} at 0:00 · ${prepared.plan.tracks.map((track) => track.name).join(" → ")} · ${prepared.assistedAutomations?.length ?? 0} saved mixes armed`
        : `Launching ${first.name} → ${second.name} · ${pairAutomation.windowBeats}-beat X/Y/Z curve · silent ${ASSISTED_SILENT_PREROLL_BEATS}-beat grid lock · bass EQ sweeps before selected beat ${pairAutomation.bassSwapBeat}`);

    if (!alreadyPlaying) {
      const sourceTime = replaySourceTime;
      await loadDemoDeck(first.deck, first, sourceTime, "primary", prepared);
      if (token !== demoToken.current || !assistedRunning.current) return;
      await ensureGraph(first.deck);
      const outgoingAudio = activeAudio(first.deck);
      if (!outgoingAudio) throw new Error("The outgoing assisted deck is unavailable");
      outgoingAudio.currentTime = sourceTime;
      setDeckRate(first.deck, resetDecks[first.deck]?.tempoRate ?? 1);
      await outgoingAudio.play();
      changeDeck(first.deck, { currentTime: sourceTime, playing: true, volume: .85, low: 0, mid: 0, high: 0 });
    }
    const runtime: DemoRuntime = { prepared, transitionIndex: 0, stage: "primary", busy: true, lastCorrectionAt: 0, lastStatusAt: 0, settleUntil: 0 };
    demoRuntime.current = runtime;
    lastPlaying.current = [first.deck];
    await loadDemoDeck(second.deck, second, assistedIncomingPrerollTime(second), "incoming", prepared);
    if (token !== demoToken.current || !assistedRunning.current) return;
    runtime.busy = false;
    demoTimer.current = setInterval(demoTick, 80);
    reportCrowdLiveEvent("run.started", {
      mode: "assisted",
      runwayPreview: Boolean(options.runwayPreview),
      firstTrackId: first.id,
      firstDeck: first.deck,
      firstTime: activeAudio(first.deck)?.currentTime,
      firstRate: activeAudio(first.deck)?.playbackRate,
      armedIncomingTrackId: second.id,
      armedIncomingDeck: second.deck,
      trackCount: prepared.plan.tracks.length,
    });
    setAssistedStatus(options.runwayPreview
      ? `${first.name} runway preview playing · assisted takeover armed at ${preciseTimeLabel(first.exitRunway)} · ${second.name} preloaded`
      : isFullSequence
        ? `${first.name} playing from 0:00 · ${second.name} and ${prepared.plan.tracks[2].name} are armed for the two saved transitions`
        : `${first.name} playing · ${second.name} preloaded at its silent ${ASSISTED_SILENT_PREROLL_BEATS}-beat preroll · both windows end at ${preciseTimeLabel(first.exitHandoff)}`);
  };
  const reportAssistedPlaybackError = (error: unknown) => {
    reportCrowdLiveEvent("run.failed", { mode: "assisted", ...diagnosticErrorDetails(error) });
    assistedPlaying.current = false;
    demoToken.current += 1;
    if (demoTimer.current) clearInterval(demoTimer.current);
    demoTimer.current = null;
    demoRuntime.current = null;
    for (const id of DECK_IDS) {
      activeAudio(id)?.pause();
      changeDeck(id, { playing: false });
    }
    setAssistedMode("error");
    setAssistedStatus(error instanceof Error ? error.message : "The assisted playback could not launch");
  };
  const unloadTrack = (id: DeckId, options: { reconcileAssisted?: boolean } = {}) => {
    const unloadingTrack = decksCurrent.current[id].track;
    const recyclingLiveDeck = assistedPlaying.current;
    const blocked = deckRecycleBlockReason(id);
    if (blocked) {
      setAssistedStatus(blocked);
      setLoopTeachingStatus((current) => ({ ...current, [id]: blocked }));
      return;
    }
    endPitchHold(id, false);
    if (recyclingLiveDeck) assistedReplaySnapshot.current = null;
    const reconcileAssisted = options.reconcileAssisted !== false && !recyclingLiveDeck;
    const assisted = assistedCueState;
    if (reconcileAssisted && assistedRunning.current && assisted) {
      if (assisted.deck === id && assisted.order > 0) {
        const previousDeck = assistedPreviousDeck(assisted.deck);
        const previous = decksCurrent.current[previousDeck];
        demoToken.current += 1;
        if (demoTimer.current) clearInterval(demoTimer.current);
        if (emergencyTimer.current) clearInterval(emergencyTimer.current);
        demoTimer.current = null;
        emergencyTimer.current = null;
        demoRuntime.current = null;
        assistedPlaying.current = false;
        assistedReplaySnapshot.current = null;
        publishPreparedDemo(null);
        setAssistedPending(null);
        if (previous.track && previous.analysis) {
          const previousOrder = assisted.order - 1;
          setAssistedCueState({
            order: previousOrder,
            deck: previousDeck,
            track: previous.track,
            mixInRequired: previousOrder > 0,
            mixInSet: true,
            mixOutSet: true,
            introPrepSkipped: false,
            selection: {
              selectedBpm: trackSelectionBpm(previous.analysis),
              previousTrackId: null,
              previousTrackName: null,
              previousBpm: null,
            },
          });
          setAssistedMode("ready");
          setAssistedStatus(`${assisted.track.name} unloaded from Deck ${id} · Find Next Tune is ready to replace Tune ${assisted.order + 1}`);
        } else {
          setAssistedCueState(null);
          setAssistedMode("error");
          setAssistedStatus(`Deck ${previousDeck}, the previous assisted tune, is no longer loaded · load a new opener before continuing`);
        }
      } else if (assisted.deck === id || assisted.order > 0 && assistedPreviousDeck(assisted.deck) === id) {
        setAssistedPending(null);
        setAssistedCueState(null);
        setAssistedMode("error");
        setAssistedStatus(`Deck ${id} was part of the active assisted pair · load the missing tune and prepare the set again`);
      }
    }
    playCueTokens.current[id] += 1;
    delete playCuePreviews.current[id];
    cancelLoopTransition(id);
    mediaRefs[id].forEach((mediaRef) => mediaRef.current?.pause());
    const localAudioUrl = localAudioUrls.current[id];
    if (localAudioUrl) {
      URL.revokeObjectURL(localAudioUrl);
      delete localAudioUrls.current[id];
    }
    activeMedia.current[id] = 0;
    loopCycleArmed.current[id] = false;
    teachingSessionTrack.current[id] = null;
    lastPlaying.current = lastPlaying.current.filter((deckId) => deckId !== id);
    changeDeck(id, emptyDeck());
    setCustomLoopStarts((current) => ({ ...current, [id]: null }));
    setCustomLoopPurposes((current) => ({ ...current, [id]: null }));
    setFullIntroTracks((current) => ({ ...current, [id]: null }));
    setCueUndo((current) => ({ ...current, [id]: [] }));
    setLoopTeachingStatus((current) => ({ ...current, [id]: "" }));
    setDeckLoads((current) => ({ ...current, [id]: null }));
    setCueTeachingStatus((current) => ({ ...current, [id]: "" }));
    setOverviewZoom((current) => ({ ...current, [id]: 1 }));
    setManualLoopDialog((current) => current?.deck === id ? null : current);
    rememberLoadedTrack(id, null);
    if (unloadingTrack) reportCrowdLiveEvent("deck.unloaded", {
      deck: id,
      trackId: unloadingTrack.id,
      trackName: unloadingTrack.name,
      recycledDuringLiveSet: recyclingLiveDeck,
    });
    if (recyclingLiveDeck) {
      const primary = demoRuntime.current?.prepared.plan.tracks[demoRuntime.current.transitionIndex];
      setWorkflowDeck(id);
      setAssistedStatus(`Deck ${id} is clear${primary ? ` while ${primary.name} remains live` : ""} · load the replacement tune and set its Mix In`);
    }
  };
  // DJ, 26 Aug 2026: cues snap to the grid. A seek (which also places the
  // cue) lands on the nearest analysed beat when one is within half a beat.
  // The transition preview's private players snap through the same core, each
  // against its own tune's grid — any cue set anywhere lands on a beat.
  const snapTimeToBeats = (beats: Analysis["beats"] | undefined, time: number) => {
    if (!beats || beats.length < 2) return time;
    let low = 0, high = beats.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (beats[mid].time < time) low = mid + 1; else high = mid; }
    const candidates = [beats[low - 1], beats[low]].filter(Boolean);
    const nearest = candidates.reduce((best, beat) => Math.abs(beat.time - time) < Math.abs(best.time - time) ? beat : best, candidates[0]);
    const period = beats[1].time - beats[0].time;
    return Math.abs(nearest.time - time) <= period * 0.5 ? nearest.time : time;
  };
  const snapToGrid = (id: DeckId, time: number) => gridSnapCurrent.current
    ? snapTimeToBeats(decksCurrent.current[id].analysis?.beats, time)
    : time;
  const snapTransitionPreviewTime = (preview: TransitionPreviewState, role: TransitionPreviewRole, time: number) =>
    gridOverrideArmed[role]
      ? time // override armed: the ear places the playhead, snap stands down
      : snapTimeToBeats((role === "outgoing" ? preview.outgoingAnalysis : preview.incomingAnalysis).beats, time);
  const seek = (id: DeckId, rawTime: number, snap = true) => { cancelLoopTransition(id); const time = snap ? snapToGrid(id, rawTime) : rawTime; if (isRecording()) recordAction({ kind: "seek", deck: id, data: { time } }); const audio = activeAudio(id); if (audio) audio.currentTime = time; const deck = decksCurrent.current[id]; loopCycleArmed.current[id] = Boolean(deck.loopActive && deck.loopEnd !== null && time <= deck.loopEnd + .12); prepareLoopStandby(id); changeDeck(id, { currentTime: time }); };
  const playbackCueFor = (id: DeckId) => {
    const deck = decksCurrent.current[id];
    const saved = playbackCues.current[id];
    return saved?.trackId === deck.track?.id ? saved!.time : deck.cuePoint ?? activeAudio(id)?.currentTime ?? deck.currentTime;
  };
  const jumpToPlaybackCue = (id: DeckId, time: number) => {
    const deck = decksCurrent.current[id];
    cancelLoopTransition(id);
    const audio = activeAudio(id);
    if (audio) audio.currentTime = time;
    const loopActive = Boolean(deck.loopActive && deck.loopStart !== null && deck.loopEnd !== null && time >= deck.loopStart && time < deck.loopEnd);
    loopCycleArmed.current[id] = loopActive;
    changeDeck(id, { currentTime: time, loopActive });
    prepareLoopStandby(id, loopActive ? deck.loopStart! : time);
    if (isRecording()) recordAction({ kind: "seek", deck: id, data: { time } });
  };
  const returnToCue = (id: DeckId) => {
    const deck = decksCurrent.current[id];
    if (!deck.track || !activeAudio(id)) return;
    const cue = playbackCueFor(id);
    if (!Number.isFinite(cue)) return;
    endPitchHold(id, false);
    playCueTokens.current[id] += 1;
    delete playCuePreviews.current[id];
    bufferedDecks.current[id]?.transport.pause();
    // Stop both media elements so an in-flight loop swap cannot resume audio.
    mediaRefs[id].forEach((ref) => ref.current?.pause());
    jumpToPlaybackCue(id, cue);
    changeDeck(id, { playing: false, cuePreviewing: false });
    lastPlaying.current = lastPlaying.current.filter((deckId) => deckId !== id);
    if (isRecording()) recordAction({ kind: "pause", deck: id });
    reportCrowdLiveEvent("deck.transport.return-to-cue", { deck: id, trackId: deck.track.id, time: cue, playing: false });
  };
  const startPlayCue = async (id: DeckId) => {
    endPitchHold(id, false);
    const deck = decksCurrent.current[id];
    let audio = activeAudio(id);
    if (!deck.track || !audio || playCuePreviews.current[id]) return;
    if (!audio.paused) {
      const cue = playbackCueFor(id);
      const referenceId = DECK_IDS.find((other) => other !== id && decksCurrent.current[other].track && activeAudio(other) && !activeAudio(other)!.paused);
      const reference = referenceId ? decksCurrent.current[referenceId] : null;
      const time = cueRetriggerTime(cue, deck.analysis?.beats, gridSnapCurrent.current && referenceId && reference
        ? { beats: reference.analysis?.beats, time: activeAudio(referenceId)!.currentTime }
        : null);
      jumpToPlaybackCue(id, time);
      changeDeck(id, { playing: true, cuePreviewing: false });
      reportCrowdLiveEvent("deck.transport.play-cue", { deck: id, cue, time, playing: true, playbackRate: audio.playbackRate, referenceDeck: referenceId ?? null });
      return; // Release must not stop a retrigger made during normal playback.
    }
    if (isRecording()) recordAction({ kind: "stab-start", deck: id });
    const time = Number.isFinite(audio.currentTime) ? audio.currentTime : deck.currentTime;
    const token = ++playCueTokens.current[id];
    playCuePreviews.current[id] = { time, audio, token };
    audio.currentTime = time;
    await Promise.all([ensureGraph(id),ensureBufferedLoop(id)]);
    audio=activeAudio(id)!;
    if (playCuePreviews.current[id]?.token !== token) return;
    try { await audio.play(); }
    catch {
      if (playCuePreviews.current[id]?.token === token) delete playCuePreviews.current[id];
      return;
    }
    if (playCuePreviews.current[id]?.token !== token) { audio.pause(); return; }
    changeDeck(id, { currentTime: time, playing: true, cuePreviewing: true });
    lastPlaying.current = DECK_IDS.filter((deckId) => activeAudio(deckId) && !activeAudio(deckId)!.paused);
  };
  const endPlayCue = (id: DeckId) => {
    if (isRecording()) recordAction({ kind: "stab-end", deck: id });
    const preview = playCuePreviews.current[id];
    if (!preview) return;
    if(bufferedDecks.current[id]){bufferedDecks.current[id]!.transport.pause();bufferedDecks.current[id]!.transport.currentTime=preview.time;}
    playCueTokens.current[id] += 1;
    delete playCuePreviews.current[id];
    mediaRefs[id].forEach((mediaRef) => {
      const media = mediaRef.current;
      if (!media) return;
      media.pause();
      media.currentTime = preview.time;
    });
    loopCycleArmed.current[id] = false;
    changeDeck(id, { currentTime: preview.time, playing: false, cuePreviewing: false });
    prepareLoopStandby(id, decksCurrent.current[id].loopStart ?? preview.time);
    lastPlaying.current = lastPlaying.current.filter((deckId) => deckId !== id);
  };
  const toggle = async (id: DeckId) => {
    endPitchHold(id, false);
    let audio = activeAudio(id);
    if (!audio || !decksCurrent.current[id].track) return;
    const starting = audio.paused;
    const token = ++playCueTokens.current[id];
    const trackId = decksCurrent.current[id].track!.id;
    if (starting) playbackCues.current[id] = { trackId, time: audio.currentTime };
    await Promise.all([ensureGraph(id),starting?ensureBufferedLoop(id):Promise.resolve()]);
    audio=activeAudio(id)!;
    if (playCueTokens.current[id] !== token || decksCurrent.current[id].track?.id !== trackId) return;
    if (starting) {
      const standby = standbyAudio(id);
      // DJ, 30 Aug 2026 (Xenomorph, "out by 8 beats"): the standby's clock had
      // drifted 2.98 s from the active element with no loop armed, and nothing
      // on the play path ever re-synced it - the swap machinery then serves a
      // time the waves aren't drawing. Unlooped, the standby's only job is to
      // mirror the active clock, so play snaps it before anything can sound.
      if (standby && !decksCurrent.current[id].loopActive) standby.currentTime = audio.currentTime;
      if (!bufferedDecks.current[id] && standby?.paused) void standby.play().then(() => { standby.pause(); prepareLoopStandby(id); }).catch(() => undefined);
      await audio.play();
      if (playCueTokens.current[id] !== token) { audio.pause(); return; }
      changeDeck(id, { playing: true });
      if (isRecording()) recordAction({ kind: "play", deck: id });
      reportCrowdLiveEvent("deck.transport.play", {
        deck: id,
        trackId: decksCurrent.current[id].track?.id,
        currentTime: audio.currentTime,
        playbackRate: audio.playbackRate,
        volume: decksCurrent.current[id].volume,
      });
      lastPlaying.current = DECK_IDS.filter((deckId) => activeAudio(deckId) && !activeAudio(deckId)!.paused);
    } else {
      lastPlaying.current = DECK_IDS.filter((deckId) => activeAudio(deckId) && !activeAudio(deckId)!.paused);
      audio.pause();
      changeDeck(id, { playing: false });
      if (isRecording()) recordAction({ kind: "pause", deck: id });
      reportCrowdLiveEvent("deck.transport.pause", {
        deck: id,
        trackId: decksCurrent.current[id].track?.id,
        currentTime: audio.currentTime,
        playbackRate: audio.playbackRate,
      });
    }
  };
  function endPitchHold(id: DeckId, resumeStopped = true) {
    const session = pitchHolds.current[id];
    if (!session) return;
    cancelAnimationFrame(session.frame);
    delete pitchHolds.current[id];
    mediaRefs[id].forEach((mediaRef) => {
      const media = mediaRef.current;
      if (!media) return;
      applyBoothPitchMode(media);
      if (session.mode === "playing") media.playbackRate = session.latestUnderlyingRate;
    });
    if(bufferedDecks.current[id] && session.mode === "playing")bufferedDecks.current[id]!.transport.playbackRate=session.latestUnderlyingRate;
    if (session.stoppedByHold && resumeStopped && decksCurrent.current[id].track?.id === session.trackId) {
      void session.audio.play().then(() => {
        if (decksCurrent.current[id].track?.id !== session.trackId) return;
        changeDeck(id, { playing: true });
        lastPlaying.current = DECK_IDS.filter((deckId) => activeAudio(deckId) && !activeAudio(deckId)!.paused);
      }).catch(() => undefined);
    }
    reportCrowdLiveEvent("deck.pitch-hold.ended", {
      deck: id,
      trackId: session.trackId,
      direction: session.direction,
      mode: session.mode,
      stoppedByHold: session.stoppedByHold,
      restoredRate: session.latestUnderlyingRate,
    });
  }
  function startPitchHold(id: DeckId, direction: -1 | 1) {
    const deck = decksCurrent.current[id];
    const audio = activeAudio(id);
    const track = deck.track;
    if (!audio || !track) return;
    endPitchHold(id, false);
    const mode = audio.paused ? "paused" : "playing";
    const baseRate = Math.max(.0625, audio.playbackRate || deck.tempoRate || 1);
    // DJ, 25 Aug 2026: the grid is the only BPM authority. The old library
    // intelligence figure was the last competing source in the booth; a deck
    // whose analysis has not landed yet simply has no BPM claim.
    const sourceBpm = deck.analysis
      ? resolvedBpmAt(deck.analysis, audio.currentTime)
      : 0;
    const session: PitchHoldSession = {
      trackId: track.id,
      audio,
      direction,
      mode,
      startedAt: performance.now(),
      startTime: audio.currentTime,
      durationMs: pitchHoldDurationMs(sourceBpm, baseRate),
      baseRate,
      latestUnderlyingRate: deck.tempoRate || baseRate,
      frame: 0,
      lastAppliedAt: 0,
      stoppedByHold: false,
    };
    pitchHolds.current[id] = session;
    mediaRefs[id].forEach((mediaRef) => applyBoothPitchMode(mediaRef.current));
    const tick = (now: number) => {
      if (pitchHolds.current[id] !== session || decksCurrent.current[id].track?.id !== session.trackId) {
        endPitchHold(id, false);
        return;
      }
      if (now - session.lastAppliedAt < 40) {
        session.frame = requestAnimationFrame(tick);
        return;
      }
      session.lastAppliedAt = now;
      const elapsedMs = now - session.startedAt;
      if (session.mode === "paused") {
        if (!session.audio.paused) {
          endPitchHold(id, false);
          return;
        }
        // track.duration is 0 for fresh local imports and unknown-duration
        // crate tunes: pick the first positive finite duration so the real
        // media duration still clamps the scrub, and pass NaN (treated as
        // unknown, lower-bound clamp only) when none is known yet.
        const duration = [deck.analysis?.duration, track.duration, session.audio.duration]
          .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0) ?? Number.NaN;
        seek(id, pitchScrubTarget(session.startTime, direction, elapsedMs, duration));
      } else {
        const nextRate = pitchHoldPlaybackRate(direction, session.latestUnderlyingRate, elapsedMs, session.durationMs);
        if (direction < 0 && elapsedMs >= session.durationMs) {
          mediaRefs[id].forEach((mediaRef) => { if (mediaRef.current) mediaRef.current.playbackRate = .0625; });
          session.audio.pause();
          session.stoppedByHold = true;
          changeDeck(id, { playing: false });
          reportCrowdLiveEvent("deck.pitch-hold.stopped", { deck: id, trackId: session.trackId, durationMs: session.durationMs });
          return;
        }
        const browserSafeRate = Math.max(.0625, nextRate);
        if(bufferedDecks.current[id])bufferedDecks.current[id]!.transport.playbackRate=browserSafeRate;
        mediaRefs[id].forEach((mediaRef) => {
          if (mediaRef.current && Math.abs(mediaRef.current.playbackRate - browserSafeRate) > .00005) mediaRef.current.playbackRate = browserSafeRate;
        });
        if (direction > 0 && elapsedMs >= session.durationMs) return;
      }
      session.frame = requestAnimationFrame(tick);
    };
    reportCrowdLiveEvent("deck.pitch-hold.started", {
      deck: id,
      trackId: track.id,
      direction,
      mode,
      sourceBpm: sourceBpm || 120,
      baseRate,
      eightBeatDurationMs: session.durationMs,
    });
    session.frame = requestAnimationFrame(tick);
  }
  const bend = (id: DeckId, direction: -1 | 0 | 1) => {
    if (direction === 0) endPitchHold(id);
    else startPitchHold(id, direction);
  };
  const syncReferenceFor = (id: DeckId) => DECK_IDS.find((candidate) =>
    candidate !== id && decksCurrent.current[candidate].playing && Boolean(decksCurrent.current[candidate].analysis)
  ) ?? DECK_IDS.find((candidate) =>
    candidate !== id && Boolean(decksCurrent.current[candidate].track)
  ) ?? (id === "A" ? "B" : "A");
  const syncBeat = (id: DeckId) => {
    endPitchHold(id, false);
    const referenceId = syncReferenceFor(id);
    const target = { ...decksCurrent.current[id], currentTime: activeAudio(id)?.currentTime ?? decksCurrent.current[id].currentTime };
    const reference = { ...decksCurrent.current[referenceId], currentTime: activeAudio(referenceId)?.currentTime ?? decksCurrent.current[referenceId].currentTime };
    if (!target.analysis?.beats.length || !activeAudio(id)) return;
    const nearest = target.analysis.beats.reduce((best, beat) => Math.abs(beat.time - target.currentTime) < Math.abs(best.time - target.currentTime) ? beat : best, target.analysis.beats[0]);
    const referencePhase = beatPhase(reference);
    let desired = nearest.time;
    if (referencePhase) {
      const candidates = target.analysis.beats.slice(0, -1).map((beat, index) => beat.time + referencePhase.fraction * (target.analysis!.beats[index + 1].time - beat.time));
      desired = candidates.reduce((best, time) => Math.abs(time - target.currentTime) < Math.abs(best - target.currentTime) ? time : best, candidates[0]);
    }
    seek(id, desired, false);
  };
  const syncTempo = (id: DeckId) => {
    const referenceId = syncReferenceFor(id);
    const target = { ...decksCurrent.current[id], currentTime: activeAudio(id)?.currentTime ?? decksCurrent.current[id].currentTime };
    const reference = { ...decksCurrent.current[referenceId], currentTime: activeAudio(referenceId)?.currentTime ?? decksCurrent.current[referenceId].currentTime };
    const audio = activeAudio(id);
    const targetBpm = loopTempoBpm(target) ?? bpmAt(target), referenceBpm = loopTempoBpm(reference) ?? bpmAt(reference);
    if (!audio || !targetBpm || !referenceBpm) return;
    endPitchHold(id, false);
    const tempoRate = clamp(tempoRateForTargetBpm(targetBpm, effectiveDeckBpm(referenceBpm, reference.tempoRate)), .5, 2);
    audio.playbackRate = tempoRate;
    const standby = standbyAudio(id); if (standby) standby.playbackRate = tempoRate;
    changeDeck(id, { tempoRate });
  };
  const stepTempo = (id: DeckId, direction: -1 | 1, deltaBpm: number) => {
    const audio = activeAudio(id);
    const deck = decksCurrent.current[id];
    if (!audio || !deck.analysis) return;
    const sourceBpm = loopTempoBpm(deck) ?? resolvedBpmAt(deck.analysis, audio.currentTime);
    if (!(sourceBpm > 0)) return;
    endPitchHold(id, false);
    const tempoRate = tempoRateAfterBpmStep(sourceBpm, deck.tempoRate, direction, deltaBpm);
    audio.playbackRate = tempoRate;
    const standby = standbyAudio(id); if (standby) standby.playbackRate = tempoRate;
    changeDeck(id, { tempoRate });
  };
  const toggleBassKill = (id: DeckId) => {
    const deck = decksCurrent.current[id];
    if (!deck.track) return;
    const held = liveBassOverride.current[id];
    const next = nextBassOverride(held, deck.low);
    if (next === "kill") lowBeforeKill.current[id] = deck.low;
    else if (held === undefined || demoRuntime.current) lowBeforeKill.current[id] = 0;
    liveBassOverride.current[id] = next;
    changeDeck(id, { low: next === "kill" ? -60 : lowBeforeKill.current[id] });
    reportCrowdLiveEvent("booth.bass-kill", { deck: id, duringMix: Boolean(demoRuntime.current), state: next });
  };
  const toggleCue = (id: DeckId) => changeDeck(id, { cue: !decksCurrent.current[id].cue });
  const toggleHeadphoneMonitor = () => {
    if (independentOutputs(outputConfigCurrent.current)) return;
    const next = !headphoneMonitorCurrent.current;
    headphoneMonitorCurrent.current = next;
    setHeadphoneMonitor(next);
    applyRouting();
    reportCrowdLiveEvent("monitor.cue.changed", { enabled: next, previewMonitorEnabled: previewMonitorCurrent.current });
  };
  const setLoopSize = (id: DeckId, loopSize: LoopSize) => {
    const deck = decksCurrent.current[id];
    if (deck.loopStart === null || !deck.analysis) { changeDeck(id, { loopSize }); return; }
    const window = loopWindowAtGrid(deck.analysis.beats, deck.loopStart, loopSize, deck.analysis.duration);
    if (!window) { changeDeck(id, { loopSize }); return; }
    rememberCueUndo(id);
    changeDeck(id, { loopSize, loopStart: window.start, loopEnd: window.end });
    loopCycleArmed.current[id] = deck.loopActive && deck.currentTime <= window.end + .12;
    prepareLoopStandby(id, window.start);
  };
  const scaleLoopSize = (id: DeckId, direction: -1 | 1) => {
    const loopSize = decksCurrent.current[id].loopSize;
    const exactIndex = LOOP_SIZES.indexOf(loopSize);
    const currentIndex = exactIndex >= 0 ? exactIndex : LOOP_SIZES.reduce((bestIndex, size, index) => Math.abs(size - loopSize) < Math.abs(LOOP_SIZES[bestIndex] - loopSize) ? index : bestIndex, 0);
    const nextIndex = Math.trunc(clamp(currentIndex + direction, 0, LOOP_SIZES.length - 1));
    setLoopSize(id, LOOP_SIZES[nextIndex]);
  };
  const toggleLoop = (id: DeckId) => {
    const deck = decksCurrent.current[id];
    if (deck.loopActive) {
      rememberCueUndo(id);
      cancelLoopTransition(id);
      loopCycleArmed.current[id] = false;
      changeDeck(id, { loopActive: false });
      return;
    }
    if (!deck.analysis || deck.analysis.beats.length < 2) return;
    const rawStart = activeAudio(id)?.currentTime ?? deck.currentTime;
    const window = loopWindowAtGrid(deck.analysis.beats, rawStart, deck.loopSize, deck.analysis.duration);
    if (!window) return;
    rememberCueUndo(id);
    cancelLoopTransition(id);
    changeDeck(id, { loopStart: window.start, loopEnd: window.end, loopActive: true });
    loopCycleArmed.current[id] = true;
    prepareLoopStandby(id, window.start);
  };
  const customLoopPoint = (id: DeckId, requestedPurpose?: ManualWindowPurpose) => {
    const deck = decksCurrent.current[id];
    if (!deck.track || !deck.analysis) return;
    const storedStart = customLoopStarts[id];
    if (storedStart === null) {
      const start = clamp(activeAudio(id)?.currentTime ?? deck.currentTime, 0, deck.analysis.duration);
      const introSkipped = Boolean(assistedCueState?.deck === id && assistedCueState.track.id === deck.track.id && assistedCueState.introPrepSkipped);
      const purpose = requestedPurpose ?? (introSkipped ? "outro-transition" : manualWindowPurposeAt(deck.analysis.teaching, start));
      rememberCueUndo(id);
      cancelLoopTransition(id);
      loopCycleArmed.current[id] = false;
      changeDeck(id, { currentTime: start, loopStart: start, loopEnd: null, loopActive: false });
      setCustomLoopStarts((current) => ({ ...current, [id]: start }));
      setCustomLoopPurposes((current) => ({ ...current, [id]: purpose }));
      setLoopTeachingStatus((current) => ({ ...current, [id]: purpose === "intro-loop"
        ? `Incoming run-up start marked at ${preciseTimeLabel(start)}. Mark the endpoint that should meet the outgoing window end.`
        : `Outgoing run-up start marked at ${preciseTimeLabel(start)}. Mark the endpoint that should meet the incoming window end.` }));
      return;
    }
    const storedPurpose = customLoopPurposes[id];
    if (requestedPurpose && storedPurpose && requestedPurpose !== storedPurpose) {
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Finish the ${storedPurpose === "intro-loop" ? "Mix In" : "Mix Out"} window before starting the other window.` }));
      return;
    }
    const end = clamp(activeAudio(id)?.currentTime ?? deck.currentTime, 0, deck.analysis.duration);
    if (end <= storedStart + .02) {
      setLoopTeachingStatus((current) => ({ ...current, [id]: "The custom end must be later than the marked start." }));
      return;
    }
    rememberCueUndo(id);
    cancelLoopTransition(id);
    loopCycleArmed.current[id] = false;
    changeDeck(id, { currentTime: end, loopActive: false, loopEnd: end });
    const crowdBpm = bpmAt(deck);
    const suggestedBeats = Math.trunc(clamp(Math.round((end - storedStart) * Math.max(1, crowdBpm) / 60), 1, 512));
    const purpose = storedPurpose ?? requestedPurpose ?? manualWindowPurposeAt(deck.analysis.teaching, storedStart);
    const automation = purpose === "intro-loop"
      ? isAssistedOverlapBeats(suggestedBeats)
        ? resizeAssistedOverlapAutomation(assistedAutomationForTrack(deck.track.id, deck.analysis), suggestedBeats)
        : assistedAutomationForTrack(deck.track.id, deck.analysis)
      : undefined;
    setManualLoopDialog({ deck: id, trackId: deck.track.id, trackName: deck.track.name, start: storedStart, end, beats: suggestedBeats, suggestedBeats, crowdBpm, cueEdge: "end", exitSide: "after", purpose, automation });
    setLoopTeachingStatus((current) => ({ ...current, [id]: purpose === "intro-loop"
      ? "Incoming run-up measured. Its endpoint will align with the outgoing run-up endpoint. Confirm its beat count."
      : "Outgoing run-up measured. Its endpoint will align with the incoming run-up endpoint. Confirm its beat count." }));
  };
  const undoLastCue = async (id: DeckId) => {
    const deck = decksCurrent.current[id];
    const history = cueUndoCurrent.current[id];
    const snapshot = history.at(-1);
    if (!deck.track || !snapshot || snapshot.trackId !== deck.track.id) return;
    let restoredAnalysis = snapshot.deck.analysis;
    if (snapshot.serverUndoToken) {
      const response = await fetch("/api/dj-library/teaching", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: snapshot.trackId, undoToken: snapshot.serverUndoToken }),
      });
      const payload = await response.json() as { analysis?: Analysis; profile?: TeachingProfile; error?: string };
      if (!response.ok || !payload.analysis) {
        setLoopTeachingStatus((current) => ({ ...current, [id]: payload.error ?? "Crowd could not undo that saved cue." }));
        return;
      }
      restoredAnalysis = payload.analysis;
      if (payload.profile) setTeachingProfile(payload.profile);
    }
    cancelLoopTransition(id);
    loopCycleArmed.current[id] = false;
    setDeckRate(id, snapshot.deck.tempoRate, false);
    changeDeck(id, { ...snapshot.deck, analysis: restoredAnalysis });
    setCustomLoopStarts((current) => ({ ...current, [id]: snapshot.customLoopStart }));
    setCustomLoopPurposes((current) => ({ ...current, [id]: snapshot.customLoopPurpose }));
    setManualLoopDialog((current) => current?.deck === id ? null : current);
    const nextUndo = { ...cueUndoCurrent.current, [id]: history.slice(0, -1) };
    cueUndoCurrent.current = nextUndo;
    setCueUndo(nextUndo);
    const pointsRemaining = Math.max(0, history.length - 1);
    setLoopTeachingStatus((current) => ({ ...current, [id]: `Undid one cue or overlap-window point.${pointsRemaining ? ` ${pointsRemaining} earlier undo step${pointsRemaining === 1 ? "" : "s"} remain.` : " No earlier cue steps remain."}` }));
  };
  const undoLastCueSafely = async (id: DeckId) => {
    if (cueUndoBusy.current.has(id)) return;
    cueUndoBusy.current.add(id);
    setCueUndoBusyDeck(id);
    try {
      await undoLastCue(id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Crowd could not undo that cue";
      setLoopTeachingStatus((current) => ({ ...current, [id]: `Undo stopped · ${detail}` }));
      setAssistedStatus(`Deck ${id} undo stopped · ${detail}`);
    } finally {
      cueUndoBusy.current.delete(id);
      setCueUndoBusyDeck((current) => current === id ? null : current);
    }
  };
  const resetWorkflowCues = async (id: DeckId) => {
    const selected = decksCurrent.current[id];
    if (!selected.track || !selected.analysis || workflowResettingDeck || assistedMode === "playing") return;
    const trackId = selected.track.id;
    const trackName = selected.track.name;
    const assistedTouchesTrack = Boolean(
      assistedCueState
      && (
        assistedCueState.track.id === trackId
        || assistedCueState.selection.previousTrackId === trackId
      )
    );
    setWorkflowResettingDeck(id);
    setLoopTeachingStatus((current) => ({ ...current, [id]: `Resetting every saved cue and Mix In / Mix Out window for ${trackName}…` }));
    try {
      const response = await fetch("/api/dj-library/teaching", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trackId, resetPlacements: true }),
      });
      const payload = await response.json().catch(() => ({})) as { analysis?: Analysis; profile?: TeachingProfile; error?: string };
      if (!response.ok || !payload.analysis) throw new Error(payload.error ?? "Crowd could not reset those cues.");

      if (assistedTouchesTrack) stopAssistedSet();
      const affectedDecks = DECK_IDS.filter((deckId) => decksCurrent.current[deckId].track?.id === trackId);
      for (const deckId of affectedDecks) {
        endPlayCue(deckId);
        cancelLoopTransition(deckId);
        loopCycleArmed.current[deckId] = false;
        teachingSessionTrack.current[deckId] = null;
      }
      const nextDecks = { ...decksCurrent.current };
      for (const deckId of affectedDecks) {
        nextDecks[deckId] = {
          ...nextDecks[deckId],
          analysis: payload.analysis,
          cuePoint: null,
          loopStart: null,
          loopEnd: null,
          loopActive: false,
        };
      }
      decksCurrent.current = nextDecks;
      setDecks(nextDecks);
      setCustomLoopStarts((current) => {
        const next = { ...current };
        for (const deckId of affectedDecks) next[deckId] = null;
        return next;
      });
      setCustomLoopPurposes((current) => {
        const next = { ...current };
        for (const deckId of affectedDecks) next[deckId] = null;
        return next;
      });
      setFullIntroTracks((current) => {
        const next = { ...current };
        for (const deckId of affectedDecks) next[deckId] = null;
        return next;
      });
      const nextUndo = { ...cueUndoCurrent.current };
      for (const deckId of affectedDecks) nextUndo[deckId] = [];
      cueUndoCurrent.current = nextUndo;
      setCueUndo(nextUndo);
      setManualLoopDialog((dialog) => dialog && affectedDecks.includes(dialog.deck) ? null : dialog);
      setCueTeachingStatus((current) => {
        const next = { ...current };
        for (const deckId of affectedDecks) next[deckId] = "";
        return next;
      });
      setLoopTeachingStatus((current) => {
        const next = { ...current };
        for (const deckId of affectedDecks) {
          next[deckId] = `${trackName} cues reset · Mix In and Mix Out are clear · learned grid and kick evidence retained.`;
        }
        return next;
      });
      if (payload.profile) setTeachingProfile(payload.profile);
      setAssistedStatus(`${trackName}'s cue placements and mix windows are clear · select new points when ready`);
    } catch (error) {
      setLoopTeachingStatus((current) => ({ ...current, [id]: error instanceof Error ? error.message : "Crowd could not reset those cues." }));
    } finally {
      setWorkflowResettingDeck(null);
    }
  };
  const teachCueAtCueLine = async (id: DeckId, role: "mix-in" | "mix-out") => {
    const deck = decksCurrent.current[id];
    if (!deck.track || !deck.analysis) return;
    const undoSnapshot = cueUndoSnapshot(id);
    const time = clamp(activeAudio(id)?.currentTime ?? deck.currentTime, 0, deck.analysis.duration);
    const crowdAnalysis = role === "mix-in"
      ? { ...deck.analysis, teaching: { ...deck.analysis.teaching, preferredEntryCue: undefined } } as Analysis
      : { ...deck.analysis, teaching: { ...deck.analysis.teaching, preferredCue: undefined } } as Analysis;
    const crowdSuggestedTime = role === "mix-in"
      ? deck.analysis.teaching?.predictedEntryCue?.time ?? findEntryCueCandidates(crowdAnalysis, { allowLateEntry: true })[0]?.time ?? time
      : deck.analysis.teaching?.predictedCue?.time ?? assessLiveOpenerExit(crowdAnalysis as LiveAnalysis).best?.exit.time ?? time;
    const label = role === "mix-in" ? "Mix-in" : "Mix-out";
    changeDeck(id, { currentTime: time });
    setCueTeachingStatus((current) => ({ ...current, [id]: `Saving the white cue line at ${preciseTimeLabel(time)}…` }));
    const response = await fetch("/api/dj-library/teaching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deck.track.id, kind: "cue", role, time, crowdSuggestedTime, replacePlacements: teachingSessionTrack.current[id] !== deck.track.id }),
    });
    const payload = await response.json() as {
      analysis?: Analysis;
      teaching?: Analysis["teaching"];
      profile?: TeachingProfile;
      undoToken?: string;
      moment?: {
        cycleEvidence?: {
          confirmedCycleStarts: number;
          strongestRepeatBeats: number | null;
          repeats: Array<{ beats: number; similarity: number; coverage: number }>;
        };
      };
      error?: string;
    };
    if (!response.ok || !payload.analysis) {
      setCueTeachingStatus((current) => ({ ...current, [id]: payload.error ?? `Crowd could not save that ${label.toLowerCase()} cue.` }));
      return;
    }
    if (payload.profile) setTeachingProfile(payload.profile);
    rememberCueUndo(id, undoSnapshot ? { ...undoSnapshot, serverUndoToken: payload.undoToken } : null);
    teachingSessionTrack.current[id] = deck.track.id;
    const corrected = {
      ...payload.analysis,
      teaching: {
        ...payload.analysis.teaching,
        ...(role !== "mix-in" && deck.analysis.teaching?.predictedEntryCue ? { predictedEntryCue: deck.analysis.teaching.predictedEntryCue } : {}),
        ...(role !== "mix-out" && deck.analysis.teaching?.predictedCue ? { predictedCue: deck.analysis.teaching.predictedCue } : {}),
      },
    } as Analysis;
    const current = decksCurrent.current;
    const next: Record<DeckId, DeckState> = {
      A: current.A.track?.id === deck.track.id ? { ...current.A, analysis: corrected } : current.A,
      B: current.B.track?.id === deck.track.id ? { ...current.B, analysis: corrected } : current.B,
      C: current.C.track?.id === deck.track.id ? { ...current.C, analysis: corrected } : current.C,
    };
    next[id] = { ...next[id], currentTime: time, cuePoint: time };
    decksCurrent.current = next;
    setDecks(next);
    const learned = role === "mix-in" ? corrected.teaching?.preferredEntryCue : corrected.teaching?.preferredCue;
    const difference = learned?.cueVsCrowdMs ?? 0;
    const comparison = difference === 0 ? "the same point Crowd suggested" : `${Math.abs(difference)} ms ${difference < 0 ? "earlier" : "later"} than Crowd's suggestion`;
    const gridShift = learned?.cueVsGridMs ?? 0;
    const gridResult = gridShift === 0 ? "grid was already aligned" : `grid shifted ${Math.abs(gridShift)} ms ${gridShift < 0 ? "earlier" : "later"} so a beat lands exactly on your cue`;
    const matchingKicks = corrected.beats.filter((beat) => (beat as { kickCycleConfirmed?: boolean }).kickCycleConfirmed).length;
    const kickExamples = payload.profile?.kickCyclePattern?.samples ?? 0;
    const cycleEvidence = payload.moment?.cycleEvidence;
    const repeatSummary = role === "mix-in" && cycleEvidence
      ? ` · 4/8/16/32/64-beat cycle signatures saved${cycleEvidence.strongestRepeatBeats ? ` · strongest repeat ${cycleEvidence.strongestRepeatBeats} beats` : ""}`
      : "";
    setCueTeachingStatus((state) => ({ ...state, [id]: `${label} kick/cycle start learned at ${preciseTimeLabel(time)} · ${comparison} · ${matchingKicks} matching cycle kick${matchingKicks === 1 ? "" : "s"} anchored across this tune${repeatSummary} · kick library now has ${kickExamples} example${kickExamples === 1 ? "" : "s"} · ${gridResult}.${preparedDemoCurrent.current ? " The currently locked mix remains unchanged." : ""}` }));
    setAssistedCueState((current) => {
      if ((assistedMode !== "awaiting-cues" && assistedMode !== "ready") || !current || current.deck !== id || current.track.id !== deck.track!.id) return current;
      setAssistedStatus(`${current.track.name} · single ${role} cue saved for learning · assisted launch still uses complete manual run-up windows`);
      return current;
    });
  };
  const saveManualLoop = async () => {
    const dialog = manualLoopDialog;
    if (!dialog || !Number.isInteger(dialog.beats) || dialog.beats < 1 || dialog.beats > 512) return;
    if (dialog.configurationOnly) {
      if (!isAssistedOverlapBeats(dialog.beats)) return;
      saveAssistedOverlapAutomation(resizeAssistedOverlapAutomation(dialog.automation ?? assistedAutomationForTrack(dialog.trackId, decksCurrent.current[dialog.deck].analysis), dialog.beats), dialog.trackId);
      setManualLoopDialog(null);
      setWorkflowDeck(dialog.deck);
      setLoopTeachingStatus((current) => ({ ...current, [dialog.deck]: `Mix automation updated for ${dialog.trackName} · ${dialog.beats}-beat window · saved Mix In points unchanged.` }));
      setAssistedStatus(`${dialog.trackName}'s latest Mix In automation is configured · saved cues and grid were not changed`);
      return;
    }
    const deckAnalysis = decksCurrent.current[dialog.deck].analysis;
    const crowdAnalysis = deckAnalysis
      ? { ...deckAnalysis, teaching: { ...deckAnalysis.teaching, preferredCue: undefined, preferredEntryCue: undefined } } as Analysis
      : null;
    const crowdSuggestedTime = crowdAnalysis
      ? dialog.purpose === "intro-loop"
        ? deckAnalysis?.teaching?.predictedEntryCue?.time ?? findEntryCueCandidates(crowdAnalysis, { allowLateEntry: true })[0]?.time ?? dialog.end
        : deckAnalysis?.teaching?.predictedCue?.time ?? assessLiveOpenerExit(crowdAnalysis as LiveAnalysis).best?.exit.time ?? dialog.end
      : dialog.end;
    const response = await fetch("/api/dj-library/teaching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dialog.trackId, kind: "loop-grid", purpose: dialog.purpose, start: dialog.start, end: dialog.end, beats: dialog.beats, crowdBpm: dialog.crowdBpm, crowdSuggestedTime, cueEdge: dialog.cueEdge, exitSide: dialog.exitSide, replacePlacements: teachingSessionTrack.current[dialog.deck] !== dialog.trackId }),
    });
    const payload = await response.json() as { analysis?: Analysis; teaching?: Analysis["teaching"]; profile?: TeachingProfile; undoToken?: string; error?: string };
    if (!response.ok || !payload.analysis) {
      setLoopTeachingStatus((current) => ({ ...current, [dialog.deck]: payload.error ?? "Crowd could not learn that loop." }));
      return;
    }
    const assistedWindowBeats = isAssistedOverlapBeats(dialog.beats) ? dialog.beats : null;
    if (dialog.purpose === "intro-loop" && assistedWindowBeats !== null) {
      saveAssistedOverlapAutomation(resizeAssistedOverlapAutomation(dialog.automation ?? assistedAutomationForTrack(dialog.trackId, deckAnalysis), assistedWindowBeats), dialog.trackId);
    }
    if (payload.profile) setTeachingProfile(payload.profile);
    if (payload.undoToken) {
      setCueUndo((current) => ({
        ...current,
        [dialog.deck]: current[dialog.deck].length
          ? [
            ...current[dialog.deck].slice(0, -1),
            { ...current[dialog.deck].at(-1)!, serverUndoToken: payload.undoToken },
          ]
          : current[dialog.deck],
      }));
    }
    teachingSessionTrack.current[dialog.deck] = dialog.trackId;
    cancelLoopTransition(dialog.deck);
    const corrected = {
      ...payload.analysis,
      teaching: {
        ...payload.analysis.teaching,
        ...(dialog.purpose !== "intro-loop" && deckAnalysis?.teaching?.predictedEntryCue ? { predictedEntryCue: deckAnalysis.teaching.predictedEntryCue } : {}),
        ...(dialog.purpose !== "outro-transition" && deckAnalysis?.teaching?.predictedCue ? { predictedCue: deckAnalysis.teaching.predictedCue } : {}),
      },
    } as Analysis;
    const current = decksCurrent.current;
    const correctedTempoRate = tempoRateAfterManualTempoTeaching(dialog.beats, current[dialog.deck].tempoRate);
    const next: Record<DeckId, DeckState> = {
      A: current.A.track?.id === dialog.trackId ? { ...current.A, analysis: corrected } : current.A,
      B: current.B.track?.id === dialog.trackId ? { ...current.B, analysis: corrected } : current.B,
      C: current.C.track?.id === dialog.trackId ? { ...current.C, analysis: corrected } : current.C,
    };
    next[dialog.deck] = { ...next[dialog.deck], analysis: corrected, currentTime: dialog.end, cuePoint: dialog.end, loopSize: dialog.beats, loopStart: dialog.start, loopEnd: dialog.end, loopActive: false, tempoRate: correctedTempoRate };
    setDeckRate(dialog.deck, correctedTempoRate, false);
    decksCurrent.current = next;
    setDecks(next);
    setCustomLoopStarts((state) => ({ ...state, [dialog.deck]: null }));
    setCustomLoopPurposes((state) => ({ ...state, [dialog.deck]: null }));
    setManualLoopDialog(null);
    loopCycleArmed.current[dialog.deck] = false;
    const correctedBpm = corrected.teaching?.manualCycle?.bpm ?? corrected.tempoSections[0]?.bpm ?? 0;
    const savedIntro = corrected.teaching?.manualIntroCycle;
    const savedOutro = corrected.teaching?.manualOutroCycle;
    const orderedStatus = savedIntro && savedOutro
      ? `Run-ups sorted by tune time · incoming ${preciseTimeLabel(savedIntro.start)}–${preciseTimeLabel(savedIntro.end)} · outgoing ${preciseTimeLabel(savedOutro.start)}–${preciseTimeLabel(savedOutro.end)}`
      : `Run-up saved at ${preciseTimeLabel(dialog.start)}–${preciseTimeLabel(dialog.end)} · add the other window and Crowd will assign earlier = incoming, later = outgoing`;
    const tempoAuthority = dialog.beats >= 64 ? "decisive 16× manual tempo evidence" : dialog.beats >= 32 ? "strong manual tempo evidence" : "supporting manual tempo evidence";
    const tempoRateStatus = correctedTempoRate === 1 && Math.abs(current[dialog.deck].tempoRate - 1) > .0005
      ? " · stale sync/fine-tempo adjustment cleared to 0%"
      : "";
    setLoopTeachingStatus((state) => ({ ...state, [dialog.deck]: `${orderedStatus} · ${dialog.beats} beats · ${correctedBpm.toFixed(3)} BPM · ${tempoAuthority}${tempoRateStatus} · selected boundaries pinned to the remapped grid.` }));
    setAssistedCueState((assisted) => {
      if ((assistedMode !== "awaiting-cues" && assistedMode !== "ready") || !assisted || assisted.deck !== dialog.deck || assisted.track.id !== dialog.trackId) return assisted;
      const updated = {
        ...assisted,
        mixInSet: assisted.mixInRequired ? Boolean(savedIntro) : assisted.mixInSet,
        mixOutSet: Boolean(savedOutro),
      };
      const currentTransitionReady = updated.order === 0 ? updated.mixOutSet : updated.mixInSet;
      if (currentTransitionReady) {
        setAssistedMode("ready");
        setAssistedStatus(updated.order === 0
          ? `${updated.track.name}'s outgoing run-up window is ready · find Tune 2`
          : `${updated.track.name}'s incoming and outgoing run-up windows are ready · launch to align both tracks' window ends`);
      } else if (!savedOutro) {
        setAssistedStatus(`${updated.track.name}'s incoming run-up is saved · runway preview ready · mark its later outgoing run-up for the next transition`);
      } else {
        setAssistedStatus(`${updated.track.name}'s outgoing run-up is ready · its earlier incoming run-up window is still needed`);
      }
      return updated;
    });
  };
  const saveManualLoopSafely = async () => {
    if (manualLoopSavingRef.current) return;
    const dialog = manualLoopDialog;
    if (!dialog) return;
    manualLoopSavingRef.current = true;
    setManualLoopSaving(true);
    try {
      await saveManualLoop();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Crowd could not save that mix window";
      setLoopTeachingStatus((current) => ({ ...current, [dialog.deck]: `Save stopped · ${detail}` }));
      setAssistedStatus(`Deck ${dialog.deck} save stopped · ${detail}`);
    } finally {
      manualLoopSavingRef.current = false;
      setManualLoopSaving(false);
    }
  };
  const moveLoop = (id: DeckId, direction: -1 | 1) => {
    const deck = decksCurrent.current[id];
    if (deck.loopStart === null || deck.loopEnd === null || !deck.analysis) return;
    const window = movedLoopWindow(deck.analysis.beats, deck.loopStart, deck.loopEnd, deck.loopSize, direction, deck.analysis.duration);
    if (!window) return;
    const loopStart = window.start;
    const loopEnd = window.end;
    rememberCueUndo(id);
    cancelLoopTransition(id);
    if (deck.loopActive && direction < 0) {
      const phase = clamp((deck.currentTime - deck.loopStart) / Math.max(.001, deck.loopEnd - deck.loopStart), 0, 1);
      const currentTime = loopStart + phase * (loopEnd - loopStart);
      changeDeck(id, { loopStart, loopEnd, currentTime });
      loopCycleArmed.current[id] = true;
      softLoopSeek(id, currentTime);
      return;
    }
    changeDeck(id, { loopStart, loopEnd });
    if (deck.loopActive) loopCycleArmed.current[id] = true;
    prepareLoopStandby(id, loopStart);
  };
  const toggleBothTransport = async () => {
    const playing = DECK_IDS.filter((id) => activeAudio(id) && !activeAudio(id)!.paused);
    if (playing.length) { lastPlaying.current = playing; playing.forEach((id) => { activeAudio(id)?.pause(); changeDeck(id, { playing: false }); if (isRecording()) recordAction({ kind: "pause", deck: id }); }); return; }
    const remembered = lastPlaying.current.filter((id) => decksCurrent.current[id].track && activeAudio(id));
    const resume = remembered.length ? remembered : DECK_IDS.filter((id) => decksCurrent.current[id].track && decksCurrent.current[id].loopActive && activeAudio(id));
    const launchTokens=Object.fromEntries(resume.map(id=>[id,++playCueTokens.current[id]]));
    // Prepare every graph first. One command launches the complete pair; no individual arming plays.
    await Promise.all(resume.map(async id => {await ensureGraph(id);await ensureBufferedLoop(id);}));
    if(resume.some(id=>playCueTokens.current[id]!==launchTokens[id]))return;
    const starts = resume.map(id => { const active=activeAudio(id)!; playbackCues.current[id]={trackId:decksCurrent.current[id].track!.id,time:active.currentTime}; return {id,active,time:active.currentTime}; });
    const launchAt=context.current!.currentTime+.08;
    const launches = starts.map(({id,active}) => bufferedDecks.current[id]?.transport.play(launchAt) ?? active.play());
    await Promise.all(launches);
    lastPlaying.current=resume;
    for(const {id,time} of starts){changeDeck(id,{playing:true});if(isRecording())recordAction({kind:"play",deck:id});reportClientDiagnostic("deck-shared-start",{deck:id,cue:time,currentTime:activeAudio(id)!.currentTime,rate:activeAudio(id)!.playbackRate,launchAt,buffered:Boolean(bufferedDecks.current[id])});}

  };
  const performControlAction = (action: ControlAction, value?: number) => {
    if (action === "play-all") { void toggleBothTransport(); return; }
    if (action === "overview-out" || action === "overview-in") {
      const id = workflowDeckCurrent.current;
      setOverviewZoom(current => ({ ...current, [id]: clamp(current[id] * (action === "overview-in" ? 2 : .5), 1, 16) })); return;
    }
    const [kind, rawDeck] = action.split(":"); const id = rawDeck as DeckId;
    if (!DECK_IDS.includes(id)) return;
    if (kind === "bass") {
      const preview = transitionPreviewCurrent.current;
      if (preview?.outgoingDeck === id) toggleTransitionPreviewBassKill("outgoing");
      else if (preview?.incomingDeck === id) toggleTransitionPreviewBassKill("incoming");
      else toggleBassKill(id);
    } else if (kind === "play") void toggle(id);
    else if (kind === "cue") toggleCue(id);
    else if (kind === "loop") toggleLoop(id);
    else if (kind === "loop-half" || kind === "loop-double") scaleLoopSize(id, kind === "loop-half" ? -1 : 1);
    else if (kind === "loop-back" || kind === "loop-forward") moveLoop(id, kind === "loop-back" ? -1 : 1);
    else if (value !== undefined && Number.isFinite(value)) {
      if (kind === "volume") changeDeckFromBooth(id, { volume: clamp(value / 127, 0, 1) });
      else if (kind === "low" || kind === "mid" || kind === "high") changeDeckFromBooth(id, { [kind]: midiEqDb(clamp(value, 0, 127)) });
    }
  };
  const controlActionCurrent = useRef(performControlAction); controlActionCurrent.current = performControlAction;
  useEffect(() => {
    const shifts = new Map<string, { action: ControlAction; chorded: boolean }>();
    const handleShortcut = (event: KeyboardEvent) => {
      if (controlSetupModeCurrent.current || audioSetupOpenCurrent.current) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('textarea, select, [contenteditable="true"], input:not([type="range"])');
      if (typing) return;
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.code === "KeyZ") {
        event.preventDefault(); if (!event.repeat) { if (transitionPreviewCurrent.current) undoTransitionPreviewCue(); else void undoLastCueSafely(workflowDeckCurrent.current); } return;
      }
      if (event.key === "Escape" && transitionPreviewCurrent.current) { event.preventDefault(); if (!event.repeat) stepTransitionPreviewBack(); return; }
      if (!/^Shift(Left|Right)$/.test(event.code)) shifts.forEach(value => { value.chorded = true; });
      const chord = keyChord(event);
      const action = (Object.entries(hotkeysCurrent.current).find(([, binding]) => binding === chord)?.[0]) as ControlAction | undefined;
      if (!action) return;
      // Bass overrides stay available on buttons, sliders and during automation.
      if (!action.startsWith("bass:") && target?.closest('input,button,a,[role="button"]')) return;
      event.preventDefault(); if (event.repeat) return;
      if (/^Shift(Left|Right)$/.test(event.code)) { shifts.set(event.code, { action, chorded: false }); return; }
      controlActionCurrent.current(action);
    };
    const release = (event: KeyboardEvent) => {
      const held = shifts.get(event.code); shifts.delete(event.code);
      if (held && !held.chorded && !controlSetupModeCurrent.current && !audioSetupOpenCurrent.current) { event.preventDefault(); controlActionCurrent.current(held.action); }
    };
    const blur = () => shifts.clear();
    window.addEventListener("keydown", handleShortcut); window.addEventListener("keyup", release); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", handleShortcut); window.removeEventListener("keyup", release); window.removeEventListener("blur", blur); };
  }, []);
  // DJ, 26 Aug 2026: master-output meter — a test-regime instrument for the
  // window-exit volume jumps. Taps the master bus before AND after its
  // brickwall limiter (-3 dB, 20:1: two overlapping tunes squash it, so the
  // exit releases it and the survivor swells) plus the preview-monitor bus.
  // Keeps ~2 minutes at 50 ms in window.__masterMeter and reports 1 Hz
  // batches while anything is audible, so an exit can be read back from the
  // server log. Remove with the regime switches when the fault is closed.
  useEffect(() => {
    type MeterTap = { analyser: AnalyserNode; data: Float32Array<ArrayBuffer> };
    // DJ, 27 Aug 2026: the cue/headphone bus joined the taps — the room ran
    // on it all night while the meter listened everywhere else, and three
    // mix-exit captures in a row missed. Measure where the ears are.
    let taps: { pre: MeterTap; post: MeterTap; preview: MeterTap | null; cue: MeterTap | null; cuePre: MeterTap | null } | null = null;
    const ring: { t: number; pre: number; post: number; preview: number | null; cue: number | null; cuePre: number | null }[] = [];
    (window as unknown as { __masterMeter?: unknown }).__masterMeter = ring;
    const makeTap = (audioContext: AudioContext, source: AudioNode): MeterTap => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      return { analyser, data: new Float32Array(analyser.fftSize) };
    };
    const readDb = (tap: MeterTap) => {
      tap.analyser.getFloatTimeDomainData(tap.data);
      let sum = 0;
      for (let i = 0; i < tap.data.length; i += 1) sum += tap.data[i] * tap.data[i];
      const rms = Math.sqrt(sum / tap.data.length);
      return rms <= 1e-5 ? -100 : Math.max(-100, Math.round(20 * Math.log10(rms) * 10) / 10);
    };
    // DJ, 27 Aug 2026 ("record the audio — I suspect it's a headroom
    // issue"): while a live transition runs (runway through 5 s past its
    // completion), three MediaRecorders capture master pre-limiter, master
    // post-limiter and the cue bus, and upload the takes for offline DSP.
    // Combined with the pre/post taps this shows limiter gain-reduction AND
    // the waveform behind it. A recording failure only ever loses the
    // recording — the meter and the audio path are untouched.
    type BusRecorder = { recorder: MediaRecorder; bus: string };
    let recorders: BusRecorder[] | null = null;
    let recordingStopTimer: number | null = null;
    let recordingStartedAt = 0;
    const startRecorders = (audioContext: AudioContext) => {
      try {
        const sources: Array<[string, AudioNode | null]> = [
          ["master-pre", master.current],
          ["master-post", masterLimiter.current],
          ["cue", cueMonitorLimiter.current],
        ];
        recordingStartedAt = Date.now();
        recorders = [];
        for (const [bus, node] of sources) {
          if (!node) continue;
          const destination = audioContext.createMediaStreamDestination();
          node.connect(destination);
          const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192_000 });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
          recorder.onstop = () => {
            try { node.disconnect(destination); } catch { /* graph may already be gone */ }
            const blob = new Blob(chunks, { type: "audio/webm" });
            if (blob.size < 4096) return;
            const body = new FormData();
            body.append("bus", bus);
            body.append("startedAt", String(recordingStartedAt));
            body.append("audio", blob, `${bus}.webm`);
            void fetch("/api/diagnostics-audio", { method: "POST", body }).catch(() => undefined);
          };
          recorder.start(1000);
          recorders.push({ recorder, bus });
        }
        reportCrowdLiveEvent("overlap.recording.started", { buses: recorders.map((item) => item.bus) });
      } catch { recorders = null; }
    };
    const stopRecorders = () => {
      if (!recorders) return;
      for (const { recorder } of recorders) { try { recorder.stop(); } catch { /* already stopped */ } }
      reportCrowdLiveEvent("overlap.recording.stopped", { seconds: Math.round((Date.now() - recordingStartedAt) / 1000) });
      recorders = null;
    };
    const recorderTick = (audioContext: AudioContext) => {
      try {
        const stage = demoRuntime.current?.stage ?? null;
        const overlapActive = stage !== null && stage !== "primary";
        if (overlapActive && recordingStopTimer !== null) { window.clearTimeout(recordingStopTimer); recordingStopTimer = null; }
        if (overlapActive && !recorders) startRecorders(audioContext);
        if (!overlapActive && recorders && recordingStopTimer === null) {
          recordingStopTimer = window.setTimeout(() => { recordingStopTimer = null; stopRecorders(); }, 5000);
        }
      } catch { /* recording must never break the meter */ }
    };
    let tick = 0;
    const timer = window.setInterval(() => {
      const audioContext = context.current;
      if (!audioContext || !master.current || !masterLimiter.current) return;
      taps ??= {
        pre: makeTap(audioContext, master.current),
        post: makeTap(audioContext, masterLimiter.current),
        preview: previewMonitorLimiter.current ? makeTap(audioContext, previewMonitorLimiter.current) : null,
        cue: cueMonitorLimiter.current ? makeTap(audioContext, cueMonitorLimiter.current) : null,
        cuePre: cueMonitorMaster.current ? makeTap(audioContext, cueMonitorMaster.current) : null,
      };
      if (!taps.preview && previewMonitorLimiter.current) taps.preview = makeTap(audioContext, previewMonitorLimiter.current);
      if (!taps.cue && cueMonitorLimiter.current) taps.cue = makeTap(audioContext, cueMonitorLimiter.current);
      if (!taps.cuePre && cueMonitorMaster.current) taps.cuePre = makeTap(audioContext, cueMonitorMaster.current);
      const sample = {
        t: Math.round(performance.now()),
        pre: readDb(taps.pre),
        post: readDb(taps.post),
        preview: taps.preview ? readDb(taps.preview) : null,
        cue: taps.cue ? readDb(taps.cue) : null,
        cuePre: taps.cuePre ? readDb(taps.cuePre) : null,
      };
      recorderTick(audioContext);
      ring.push(sample);
      if (ring.length > 2400) ring.splice(0, ring.length - 2400);
      tick += 1;
      if (tick % 20 !== 0) return;
      const batch = ring.slice(-20);
      if (!batch.some((entry) => entry.post > -70 || (entry.preview ?? -100) > -70 || (entry.cue ?? -100) > -70)) return;
      reportCrowdLiveEvent("master.meter", {
        t0: batch[0].t,
        pre: batch.map((entry) => entry.pre),
        post: batch.map((entry) => entry.post),
        preview: batch.map((entry) => entry.preview),
        cue: batch.map((entry) => entry.cue),
        cuePre: batch.map((entry) => entry.cuePre),
        masterVolume: masterVolumeCurrent.current,
        deckVolumes: Object.fromEntries(DECK_IDS.map((id) => [id, Math.round(decksCurrent.current[id].volume * 100) / 100])),
        transitionStage: demoRuntime.current?.stage ?? null,
      });
    }, 50);
    return () => {
      window.clearInterval(timer);
      if (recordingStopTimer !== null) window.clearTimeout(recordingStopTimer);
      stopRecorders();
      if (taps) for (const tap of [taps.pre, taps.post, taps.preview, taps.cue, taps.cuePre]) tap?.analyser.disconnect();
    };
  }, []);
  // DJ, 26 Aug 2026 (evening): after the assisted mix completed, preview-
  // monitor routing stayed engaged with the panel closed — the master bus
  // (and the crowd stream with it) went silent while the room heard the
  // monitor bus, and a deck play "didn't fire" into the closed main gate.
  // With no panel open and no transition running the monitor bus has no
  // owner, so that state is always stuck: restore main routing.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (previewMonitorCurrent.current && !transitionPreviewCurrent.current && !demoRuntime.current) {
        setPreviewMonitorRouting(false);
        reportCrowdLiveEvent("routing.preview-monitor-unstuck", {});
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  const setMaster = async (value: number) => {
    if (isRecording()) recordAction({ kind: "master-volume", data: { value } });
    setMasterVolume(value);
    masterVolumeCurrent.current = value;
    if (master.current && context.current) {
      const now = context.current.currentTime;
      master.current.gain.cancelScheduledValues(now);
      master.current.gain.setTargetAtTime(value, now, .008);
      cueMonitorMaster.current?.gain.cancelScheduledValues(now);
      cueMonitorMaster.current?.gain.setTargetAtTime(independentOutputs(outputConfigCurrent.current) ? 1 : value, now, .008);
      previewMonitorMaster.current?.gain.cancelScheduledValues(now);
      previewMonitorMaster.current?.gain.setTargetAtTime(previewMonitorCurrent.current ? (independentOutputs(outputConfigCurrent.current) ? 1 : value) : 0, now, .008);
      crowdMaster.current?.gain.cancelScheduledValues(now);
      crowdMaster.current?.gain.setTargetAtTime(value, now, .008);
    } else {
      const loadedDeck = DECK_IDS.find((id) => decksCurrent.current[id].track);
      if (loadedDeck) await ensureGraph(loadedDeck);
    }
  };
  const plannedTrack = (id: DeckId) => preparedDemo?.plan.tracks.find((track) => track.id === decks[id].track?.id);
  const normalisedPickerSearch = pickerSearch.trim().toLowerCase();
  const matchingPickerTracks = picker
    ? tracks.filter((track) => !normalisedPickerSearch || `${track.name} ${track.album} ${track.file}`.toLowerCase().includes(normalisedPickerSearch))
    : [];
  const visiblePickerTracks = matchingPickerTracks.slice(0, 250);
  /**
   * DJ, 30 Aug 2026 (Shift - Dr. Silverman): cue markers are grid citizens.
   * A stored cue placed against an earlier lattice must not float at its old
   * absolute time once a better grid lands - every cue re-seats onto the
   * nearest beat of the CURRENT grid at the moment it is drawn or consumed,
   * so a grid change moves the magenta lines with it, automatically.
   */
  const seatCueOnGrid = (analysis: Analysis | null | undefined, time: number) =>
    analysis?.beats?.length ? snapTimeToBeats(analysis.beats, time) : time;
  const cuesFor = (id: DeckId) => {
    const analysis = decks[id].analysis;
    if (!analysis) return [];
    return buildCues(analysis, plannedTrack(id)).map((cue) => ({ ...cue, time: seatCueOnGrid(analysis, cue.time) }));
  };
  const deckHasSavedWindow = (id: DeckId, purpose: ManualWindowPurpose) => Boolean(savedManualWindow(decks[id].analysis, purpose));
  const loadedManualPairForIncoming = (incomingDeck: DeckId) => {
    const incoming = decks[incomingDeck];
    const outgoingDeck = assistedPreviousDeck(incomingDeck);
    const outgoing = decks[outgoingDeck];
    const incomingWindow = savedManualWindow(incoming.analysis, "intro-loop");
    const outgoingWindow = savedManualWindow(outgoing.analysis, "outro-transition");
    if (!incoming.track || !incoming.analysis || !outgoing.track || !outgoing.analysis || !incomingWindow || !outgoingWindow) return null;
    const nextLogicalOrder = assistedCueState && incomingDeck === assistedDeckForOrder(assistedCueState.order + 1)
      ? assistedCueState.order + 1
      : loadedPairOrderForIncoming(incomingDeck);
    const logicalOrder = assistedCueState?.deck === incomingDeck && assistedCueState.track.id === incoming.track.id
      ? assistedCueState.order
      : nextLogicalOrder;
    const cueState: AssistedCueState = {
      order: logicalOrder,
      deck: incomingDeck,
      track: incoming.track,
      mixInRequired: true,
      mixInSet: true,
      mixOutSet: Boolean(savedManualWindow(incoming.analysis, "outro-transition")),
      introPrepSkipped: false,
      selection: {
        selectedBpm: trackSelectionBpm(incoming.analysis),
        previousTrackId: outgoing.track.id,
        previousTrackName: outgoing.track.name,
        previousBpm: trackSelectionBpm(outgoing.analysis),
      },
    };
    return { cueState, outgoingDeck, incomingWindow };
  };
  const loadedManualPairCandidates = DECK_IDS
    .map(loadedManualPairForIncoming)
    .filter((pair): pair is NonNullable<ReturnType<typeof loadedManualPairForIncoming>> => Boolean(pair))
    .sort((left, right) => Date.parse(right.incomingWindow.selectedAt) - Date.parse(left.incomingWindow.selectedAt));
  const loadedManualPair = loadedManualPairCandidates.find((pair) => pair.cueState.deck === workflowDeck)
    ?? loadedManualPairCandidates[0]
    ?? null;
  const transitionPreviewPair = (() => {
    const pair = (outgoingDeck: DeckId, incomingDeck: DeckId) => {
      const outgoing = decks[outgoingDeck];
      const incoming = decks[incomingDeck];
      return outgoing.track && outgoing.analysis && incoming.track && incoming.analysis
        ? { outgoingDeck, incomingDeck, outgoingTrack: outgoing.track, incomingTrack: incoming.track, outgoingAnalysis: outgoing.analysis, incomingAnalysis: incoming.analysis }
        : null;
    };
    const playingDeck = DECK_IDS.find((id) => decks[id].playing);
    // A stopped booth always begins a fresh rotation with A → B. Historical
    // workflow focus or older saved windows must not silently select B → C or
    // C → A as the first transition.
    const runtime = demoRuntime.current;
    let runtimeOutgoingDeck: DeckId | null = null;
    let runtimePair: ReturnType<typeof pair> = null;
    if (runtime) {
      const outgoing = runtime.prepared.plan.tracks[runtime.transitionIndex];
      const incoming = runtime.prepared.plan.tracks[runtime.transitionIndex + 1];
      if (outgoing && incoming) {
        const livePair = pair(outgoing.deck, incoming.deck);
        if (livePair && livePair.outgoingTrack.id === outgoing.id && livePair.incomingTrack.id === incoming.id) {
          runtimeOutgoingDeck = outgoing.deck;
          runtimePair = livePair;
        }
      }
    }
    const previewPlayingDeck = runtimePair && runtimeOutgoingDeck && decks[runtimeOutgoingDeck].playing
      ? runtimeOutgoingDeck
      : playingDeck ?? null;
    return selectTransitionPreviewPair({
      playingDeck: previewPlayingDeck,
      idlePair: pair("A", "B"),
      runtimeOutgoingDeck,
      runtimePair,
      playingNextPair: previewPlayingDeck ? pair(previewPlayingDeck, nextAssistedDeck(previewPlayingDeck)) : null,
    });
  })();
  /**
   * Placing four points by ear is the expensive part of the workflow, so an
   * unapplied Preview pair is written to the data root on every change and
   * restored when the same pair reopens — across refreshes and rebuilds.
   */
  const saveTransitionPreviewDraft = (preview: TransitionPreviewState) => {
    void fetch("/api/preview-draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outgoingTrackId: preview.outgoingTrack.id,
        incomingTrackId: preview.incomingTrack.id,
        outgoingWindow: preview.outgoingWindow,
        incomingWindow: preview.incomingWindow,
        beats: preview.beats,
        bassSwapBeat: preview.automation.bassSwapBeat,
        bassSwapBeats: preview.automation.bassSwapBeats,
        ...(preview.replicate ? {
          replicate: {
            role: preview.replicate.role,
            blockStart: preview.replicate.plan.blockStart,
            blockEnd: preview.replicate.plan.blockEnd,
            copies: preview.replicate.plan.copies,
            savedBeats: preview.replicate.saved.beats,
            savedOutgoingWindow: preview.replicate.saved.outgoingWindow,
            savedIncomingWindow: preview.replicate.saved.incomingWindow,
          },
        } : {}),
      }),
    }).catch(() => undefined);
  };
  const openTransitionPreview = () => {
    const pair = transitionPreviewPair;
    if (!pair) return;
    transitionPreviewOutgoingVisualTime.current = null;
    transitionPreviewIncomingVisualTime.current = null;
    setPreviewMonitorRouting(true);
    const outgoingSaved = savedManualWindow(pair.outgoingAnalysis, "outro-transition");
    const incomingSaved = savedManualWindow(pair.incomingAnalysis, "intro-loop");
    const savedBeats = incomingSaved?.beats ?? outgoingSaved?.beats;
    const beats = isAssistedOverlapBeats(Number(savedBeats))
      ? Number(savedBeats) as AssistedOverlapBeats
      : assistedAutomationForTrack(pair.incomingTrack.id, pair.incomingAnalysis).windowBeats;
    const automation = resizeAssistedOverlapAutomation(assistedAutomationForTrack(pair.incomingTrack.id, pair.incomingAnalysis), beats);
    const outgoingTime = outgoingSaved?.start ?? activeAudio(pair.outgoingDeck)?.currentTime ?? decksCurrent.current[pair.outgoingDeck].currentTime;
    const incomingTime = incomingSaved?.start ?? 0;
    const outgoingWindow = { start: outgoingSaved?.start ?? null, end: outgoingSaved?.end ?? null };
    const incomingWindow = { start: incomingSaved?.start ?? null, end: incomingSaved?.end ?? null };
    const configurationOpen = transitionPreviewCanCommit(outgoingWindow, incomingWindow, beats);
    const selectionRole: TransitionPreviewRole | null = configurationOpen
      ? null
      : transitionPreviewWindowReady(outgoingWindow) ? "incoming" : "outgoing";
    reportCrowdLiveEvent("preview.opened", {
      outgoingTrackId: pair.outgoingTrack.id,
      incomingTrackId: pair.incomingTrack.id,
      outgoingDeck: pair.outgoingDeck,
      incomingDeck: pair.incomingDeck,
      beats,
      configurationOpen,
      outgoingWindow,
      incomingWindow,
    });
    setTransitionPreview({
      ...pair,
      outgoingWindow,
      incomingWindow,
      outgoingTime,
      incomingTime,
      beats,
      replicate: null,
      replicateSelection: null,
      replicatePending: null,
      automation,
      configurationOpen,
      selectionRole,
      // A restored window is treated as anchored the way it would be marked:
      // the exit by its start, the entry by its finish.
      outgoingAnchor: transitionPreviewWindowReady(outgoingWindow) ? "start" : null,
      incomingAnchor: transitionPreviewWindowReady(incomingWindow) ? "end" : null,
      cueHistory: [],
      audition: null,
      saving: false,
      status: configurationOpen
        ? "Preview Monitor on · Saved mix windows loaded into the private sandbox · live transports untouched"
        : "Preview Monitor on · complete both private windows to open the sandboxed mix editor",
    });
    // Applied teaching wins; a draft only fills in for a pair that has never
    // been committed, so restoring can never overwrite saved coordinates.
    if (!transitionPreviewWindowReady(outgoingWindow) || !transitionPreviewWindowReady(incomingWindow)) {
      const query = new URLSearchParams({ outgoing: pair.outgoingTrack.id, incoming: pair.incomingTrack.id });
      void fetch(`/api/preview-draft?${query}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((result: { draft?: PreviewDraft | null } | null) => {
          const draft = result?.draft;
          if (!draft) return;
          setTransitionPreview((current) => {
            if (!current
              || current.outgoingTrack.id !== draft.outgoingTrackId
              || current.incomingTrack.id !== draft.incomingTrackId) return current;
            // Anything marked since the panel opened is newer than the draft.
            if (transitionPreviewWindowReady(current.outgoingWindow) || transitionPreviewWindowReady(current.incomingWindow)) return current;
            // A replicated draft's count is off-menu on purpose (128 + 8);
            // any sane whole number is welcome back when a replicate rides
            // along to explain it.
            const restoredBeats = isAssistedOverlapBeats(draft.beats) || (draft.replicate && Number.isInteger(draft.beats) && draft.beats >= 8 && draft.beats <= 512)
              ? draft.beats
              : current.beats;
            const bothReady = transitionPreviewWindowReady(draft.outgoingWindow) && transitionPreviewWindowReady(draft.incomingWindow);
            return {
              ...current,
              outgoingWindow: draft.outgoingWindow,
              incomingWindow: draft.incomingWindow,
              beats: restoredBeats,
              automation: normaliseAssistedOverlapAutomation({
                ...resizeAssistedOverlapAutomation(current.automation, restoredBeats),
                ...(draft.bassSwapBeat !== undefined ? { bassSwapBeat: draft.bassSwapBeat } : {}),
                // Undefined retains the old single-cue draft format; [] is a
                // deliberately unmarked lane and must survive reopening.
                bassSwapBeats: draft.bassSwapBeats,
                ...(draft.bassSwapBeat === undefined && draft.bassSwapBeats === undefined ? { bassSwapBeats: [] } : {}),
              }),
              configurationOpen: bothReady,
              selectionRole: bothReady ? null : transitionPreviewWindowReady(draft.outgoingWindow) ? "incoming" : "outgoing",
              status: `Your unapplied cues were restored${draft.savedAt ? ` from ${new Date(draft.savedAt).toLocaleTimeString()}` : ""} · nothing has been sent to the live tracks`,
            };
          });
          // The windows above are in the pasted timeline; rebuild the paste
          // itself (a cache hit on the render) so wave, grid and audio agree.
          if (draft.replicate) void restoreTransitionPreviewReplicate(draft);
        })
        .catch(() => undefined);
    }
  };
  const closeTransitionPreview = () => {
    const preview = transitionPreviewCurrent.current;
    transitionPreviewOutgoingVisualTime.current = null;
    transitionPreviewIncomingVisualTime.current = null;
    stopTransitionPreviewPlayback();
    for (const graph of Object.values(transitionPreviewGraphs.current)) {
      graph?.source.disconnect(); graph?.low.disconnect(); graph?.mid.disconnect(); graph?.high.disconnect(); graph?.output.disconnect();
    }
    transitionPreviewGraphs.current = {};
    releaseTransitionPreviewAudio();
    // Kills are a preview-session gesture, not a setting: the next open
    // starts with both basses live.
    transitionPreviewBassKill.current = { outgoing: false, incoming: false };
    setPreviewMonitorRouting(false);
    setTransitionPreview(null);
    if (preview) reportCrowdLiveEvent("preview.closed", {
      outgoingTrackId: preview.outgoingTrack.id,
      incomingTrackId: preview.incomingTrack.id,
      hadUnsavedCueHistory: preview.cueHistory.length > 0,
    });
  };
  const toggleTransitionPreviewMonitor = () => {
    const next = !previewMonitorCurrent.current;
    setPreviewMonitorRouting(next);
    setTransitionPreview((current) => current ? {
      ...current,
      status: next
        ? "Preview Monitor on · local monitor contains Preview audio only · live and crowd masters untouched"
        : "Preview Monitor off · previous booth monitor routing restored",
    } : current);
  };
  const seekTransitionPreview = (role: TransitionPreviewRole, time: number) => {
    const preview = transitionPreview;
    if (!preview) return;
    const duration = role === "outgoing" ? preview.outgoingAnalysis.duration : preview.incomingAnalysis.duration;
    const bounded = snapTransitionPreviewTime(preview, role, clamp(time, 0, duration));
    const audio = transitionPreviewAudio(role);
    // The whole-track waveform remains seekable before its private decoder is
    // loaded. Store the requested position now; touch media currentTime only
    // once an explicit private Play action has assigned a source.
    if (audio && (audio.currentSrc || audio.getAttribute("src"))) audio.currentTime = bounded;
    setTransitionPreview((current) => current ? { ...current, [role === "outgoing" ? "outgoingTime" : "incomingTime"]: bounded } : current);
  };
  const captureTransitionPreviewMarkTime = (role: TransitionPreviewRole) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview) return 0;
    const outgoing = role === "outgoing";
    const stateTime = outgoing ? preview.outgoingTime : preview.incomingTime;
    const duration = outgoing ? preview.outgoingAnalysis.duration : preview.incomingAnalysis.duration;
    const audio = transitionPreviewAudio(role);
    const displayedTime = outgoing ? transitionPreviewOutgoingVisualTime.current : transitionPreviewIncomingVisualTime.current;
    return transitionPreviewMarkTime({
      playing: Boolean(audio && !audio.paused),
      displayedTime,
      mediaTime: audio?.currentTime,
      stateTime,
      duration,
    });
  };
  /**
   * DJ, 29 Aug 2026: ONE edge is marked, the beat count places the other.
   *
   * Whichever edge is pressed becomes the anchor and does not move again
   * until it is pressed somewhere else. The overlap length walks that tune's
   * OWN grid, beat by beat, so a tune whose tempo sags still gets its true
   * count. For the incoming tune the start is the moment it becomes audible,
   * so it lands on that beat's measured attack - the kick - not the drawn
   * line. Nothing advances to the next window: the DJ tries lengths here and
   * moves on when they are happy.
   */
  const deriveTransitionPreviewWindowFor = (
    preview: TransitionPreviewState,
    role: TransitionPreviewRole,
    anchorEdge: TransitionPreviewAnchorEdge,
    anchorTime: number,
    windowBeats: number,
  ) => deriveTransitionPreviewWindow({
    beats: (role === "outgoing" ? preview.outgoingAnalysis : preview.incomingAnalysis).beats,
    anchorEdge,
    anchorTime,
    windowBeats,
    startPrefersAttack: role === "incoming",
  });
  const markTransitionPreviewWindow = (role: TransitionPreviewRole, edge: "start" | "end", capturedTime?: number) => {
    const preview = transitionPreview;
    if (!preview) return;
    const stateTime = role === "outgoing" ? preview.outgoingTime : preview.incomingTime;
    const playingTime = preview.audition === role || preview.audition === "mix" ? transitionPreviewAudio(role)?.currentTime : undefined;
    const time = snapTransitionPreviewTime(preview, role, capturedTime !== undefined && Number.isFinite(capturedTime)
      ? capturedTime
      : playingTime !== undefined && Number.isFinite(playingTime) ? playingTime : stateTime);
    const derived = deriveTransitionPreviewWindowFor(preview, role, edge, time, preview.beats);
    const roleLabel = role === "outgoing" ? "MIX OUT" : "MIX IN";
    if (!derived.ok) {
      setTransitionPreview((current) => current ? { ...current, status: `${preview.beats} beats from there does not fit - ${derived.reason}. Nothing moved; mark the other end or choose a shorter overlap.` } : current);
      return;
    }
    const key = role === "outgoing" ? "outgoingWindow" : "incomingWindow";
    const anchorKey = role === "outgoing" ? "outgoingAnchor" : "incomingAnchor";
    const windowBpm = preview.beats * 60 / (derived.window.end! - derived.window.start!);
    reportCrowdLiveEvent("preview.window.marked", {
      role,
      edge,
      anchorTime: derived.anchorTime,
      derivedTime: derived.derivedTime,
      beats: preview.beats,
      landedOnAttack: derived.landedOnAttack,
      outgoingTrackId: preview.outgoingTrack.id,
      incomingTrackId: preview.incomingTrack.id,
    });
    setTransitionPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        [key]: derived.window,
        [anchorKey]: edge,
        cueHistory: [...current.cueHistory, {
          beats: current.beats,
          outgoingWindow: current.outgoingWindow,
          incomingWindow: current.incomingWindow,
          outgoingAnchor: current.outgoingAnchor,
          incomingAnchor: current.incomingAnchor,
          configurationOpen: current.configurationOpen,
          selectionRole: current.selectionRole,
        }],
        status: `${roleLabel} ${edge === "start" ? "START" : "FINISH"} anchored at ${preciseTimeLabel(derived.anchorTime)} · ${preview.beats} beats puts the other end at ${preciseTimeLabel(derived.derivedTime)} · ${windowBpm.toFixed(3)} BPM${derived.landedOnAttack ? " · entry on the kick" : ""} · try other lengths, nothing moves on until you say so`,
      };
    });
  };
  const markTransitionPreviewWindowFromPointer = (event: React.PointerEvent<HTMLButtonElement>, role: TransitionPreviewRole, edge: "start" | "end") => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    markTransitionPreviewWindow(role, edge, captureTransitionPreviewMarkTime(role));
  };
  const markTransitionPreviewWindowFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, role: TransitionPreviewRole, edge: "start" | "end") => {
    if (event.repeat || event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    markTransitionPreviewWindow(role, edge, captureTransitionPreviewMarkTime(role));
  };
  /**
   * REPLICATE (DJ, 30 Aug 2026): "copy a section of the tune that doesn't
   * have that extra portion so that it loops... to add the extra beats
   * required to maintain that congruence."
   *
   * The selected block is pasted after itself as a real edit — wave doubled,
   * audio spliced server-side, both windows grown by the same beat count —
   * so the playheads stay aligned left-to-right ("copy/paste situation...
   * that way the playheads are always aligned"). The looped tune's window
   * absorbs the paste; the other tune's window walks the same number of
   * extra beats forward on its own grid, covering the fill that caused all
   * this. One replicate at a time; pressing again with the same block adds
   * one more copy; CLEAR walks everything back to the pre-paste state.
   */
  const extendWindowEndByBeats = (beats: Analysis["beats"], endTime: number | null, addBeats: number) => {
    if (endTime === null || beats.length < 2) return null;
    let index = 0;
    for (let candidate = 1; candidate < beats.length; candidate += 1) {
      if (Math.abs(beats[candidate].time - endTime) < Math.abs(beats[index].time - endTime)) index = candidate;
    }
    const target = index + addBeats;
    return target <= beats.length - 1 ? beats[target].time : null;
  };
  const replicateStatus = (message: string) => setTransitionPreview((current) => current ? { ...current, status: message } : current);
  /**
   * Right-click selection, both grammars: a drag hands in both edges at
   * once; single clicks hand in one edge and wait for the second. Edges
   * snap to the displayed grid so the block is whole beats by construction.
   */
  const commitReplicateSelection = (role: TransitionPreviewRole, rawA: number, rawB: number) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview) return;
    const analysis = role === "outgoing" ? preview.outgoingAnalysis : preview.incomingAnalysis;
    const start = snapTimeToBeats(analysis.beats, Math.min(rawA, rawB));
    const end = snapTimeToBeats(analysis.beats, Math.max(rawA, rawB));
    if (!(end > start + .05)) {
      setTransitionPreview((current) => current ? { ...current, replicatePending: null, status: "That selection collapses to nothing on the grid — sweep at least one whole beat" } : current);
      return;
    }
    const blockBeats = analysis.beats.filter((beat) => beat.time >= start - .001 && beat.time < end - .001).length;
    setTransitionPreview((current) => current ? {
      ...current,
      replicateSelection: { role, start, end },
      replicatePending: null,
      status: `${blockBeats}-beat block selected on ${role === "outgoing" ? "Mix Out" : "Mix In"} · REPLICATE pastes it in again and grows both windows by ${blockBeats} beats`,
    } : current);
    reportCrowdLiveEvent("preview.replicate.selected", { role, start, end, blockBeats });
  };
  const tapReplicateSelection = (role: TransitionPreviewRole, rawTime: number) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview) return;
    const analysis = role === "outgoing" ? preview.outgoingAnalysis : preview.incomingAnalysis;
    const snapped = snapTimeToBeats(analysis.beats, rawTime);
    const pending = preview.replicatePending;
    if (pending && pending.role === role) {
      commitReplicateSelection(role, pending.time, snapped);
      return;
    }
    setTransitionPreview((current) => current ? {
      ...current,
      replicatePending: { role, time: snapped },
      ...(current.replicateSelection?.role === role && !current.replicate ? { replicateSelection: null } : {}),
      status: "Block start marked — right-click again at the block's end (or right-drag in one go)",
    } : current);
  };
  const confirmTransitionPreviewReplicate = async (role: TransitionPreviewRole) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview || replicateBusy) return;
    const outgoing = role === "outgoing";
    const selection = preview.replicateSelection;
    if (!selection || selection.role !== role) { replicateStatus("Right-click the wave first — drag across the block, or click its start then its end"); return; }
    if (!transitionPreviewCanCommit(preview.outgoingWindow, preview.incomingWindow, preview.beats)) { replicateStatus("Mark both mix windows before replicating — the paste grows them together"); return; }
    const existing = preview.replicate;
    if (existing && existing.role !== role) { replicateStatus("One replicate at a time — CLEAR the copied block on the other tune first"); return; }
    const track = outgoing ? preview.outgoingTrack : preview.incomingTrack;
    const otherTrack = outgoing ? preview.incomingTrack : preview.outgoingTrack;
    const base = existing ? existing.baseAnalysis : outgoing ? preview.outgoingAnalysis : preview.incomingAnalysis;
    // Same block again? That is a STACK — one more copy — and needs no
    // coordinate folding: the block's first pass sits exactly where it
    // always did. (Unmapping its end would wrap the seam back onto the
    // start and read a real block as an empty one.)
    const selectionStart = Math.min(selection.start, selection.end);
    const selectionEnd = Math.max(selection.start, selection.end);
    const sameBlock = existing !== null
      && Math.abs(existing.plan.blockStart - selectionStart) < .03
      && Math.abs(existing.plan.blockEnd - selectionEnd) < .03;
    // A NEW selection on the displayed (possibly pasted) timeline folds back
    // into the original tune before snapping to the pristine grid, so a
    // block picked inside a pasted pass still names real source material.
    const toOriginal = (time: number) => existing ? replicateUnmapTime(existing.plan, time) : time;
    const snapBase = (time: number) => snapTimeToBeats(base.beats, time);
    const blockStart = sameBlock ? existing!.plan.blockStart : snapBase(toOriginal(selectionStart));
    const blockEnd = sameBlock ? existing!.plan.blockEnd : snapBase(toOriginal(selectionEnd));
    if (!(blockEnd > blockStart + .05)) { replicateStatus("That selection collapses once it snaps to the grid — sweep at least one whole beat"); return; }
    const plan: ReplicatePlan = sameBlock
      ? { ...existing!.plan, copies: existing!.plan.copies + 1 }
      : { blockStart, blockEnd, copies: 1 };
    const beatsPerCopy = replicateBlockBeats(base.beats, plan);
    if (beatsPerCopy < 1) { replicateStatus("The block must cover at least one whole beat of the grid"); return; }
    const addedBeats = beatsPerCopy * plan.copies;
    const saved = existing ? existing.saved : {
      beats: preview.beats,
      outgoingWindow: preview.outgoingWindow,
      incomingWindow: preview.incomingWindow,
    };
    const savedRoleWindow = outgoing ? saved.outgoingWindow : saved.incomingWindow;
    const savedOtherWindow = outgoing ? saved.incomingWindow : saved.outgoingWindow;
    if (savedRoleWindow.start === null || savedRoleWindow.end === null
      || plan.blockStart < savedRoleWindow.start - .01 || plan.blockEnd > savedRoleWindow.end + .01) {
      replicateStatus("The copied block must sit inside this tune's own mix window — that is the stretch being kept congruent");
      return;
    }
    // The other tune covers the same extra count with REAL audio: its window
    // end walks forward on its own grid, taking in the fill.
    const otherBase = outgoing ? preview.incomingAnalysis : preview.outgoingAnalysis;
    const otherEnd = extendWindowEndByBeats(otherBase.beats, savedOtherWindow.end, addedBeats);
    if (otherEnd === null || savedOtherWindow.start === null) { replicateStatus(`${addedBeats} extra beats runs past the end of ${otherTrack.name} — pick a shorter block`); return; }
    setReplicateBusy(true);
    replicateStatus(`Rendering the splice — ${beatsPerCopy} beats × ${plan.copies}…`);
    try {
      const response = await fetch("/api/replicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, blockStart: plan.blockStart, blockEnd: plan.blockEnd, copies: plan.copies }),
      });
      const payload = await response.json() as { ok?: boolean; audio?: string; pasteSeconds?: number; error?: string };
      if (!response.ok || !payload.ok || !payload.audio) throw new Error(payload.error ?? "The splice could not be rendered");
      const spliced = replicateSpliceAnalysis(base, plan);
      const pasteSeconds = replicateShiftSeconds(plan);
      const nextBeats = saved.beats + addedBeats;
      stopTransitionPreviewPlayback();
      setTransitionPreview((current) => current ? {
        ...current,
        beats: nextBeats,
        [outgoing ? "outgoingAnalysis" : "incomingAnalysis"]: spliced,
        [outgoing ? "outgoingWindow" : "incomingWindow"]: { start: savedRoleWindow.start, end: savedRoleWindow.end! + pasteSeconds },
        [outgoing ? "incomingWindow" : "outgoingWindow"]: { start: savedOtherWindow.start, end: otherEnd },
        automation: resizeAssistedOverlapAutomation(current.automation, nextBeats),
        replicate: { role, plan, addedBeats, audio: payload.audio!, baseAnalysis: base, saved },
        // Track the block's first pass, which sits where it always did, so
        // another press stacks one more copy of the same block.
        replicateSelection: { role, start: plan.blockStart, end: plan.blockEnd },
        replicatePending: null,
        // Window history from before the paste would restore spans that
        // disagree with the new beat count; the paste starts a fresh slate
        // and CLEAR is its undo.
        cueHistory: [],
        status: `REPLICATE ×${plan.copies} — ${beatsPerCopy}-beat block doubled into the wave · overlap ${saved.beats} → ${nextBeats} beats · ${otherTrack.name} extended ${addedBeats} beats to cover its fill · CLEAR walks it back`,
      } : current);
      reportCrowdLiveEvent("preview.replicate.confirmed", {
        role,
        trackId: track.id,
        blockStart: plan.blockStart,
        blockEnd: plan.blockEnd,
        copies: plan.copies,
        addedBeats,
        beats: nextBeats,
        audio: payload.audio,
        cached: (payload as { cached?: boolean }).cached,
      });
    } catch (error) {
      replicateStatus(error instanceof Error ? error.message : "The splice could not be rendered");
    } finally {
      setReplicateBusy(false);
    }
  };
  const clearTransitionPreviewReplicate = () => {
    const preview = transitionPreviewCurrent.current;
    const replicate = preview?.replicate;
    if (!preview || !replicate) return;
    stopTransitionPreviewPlayback();
    setTransitionPreview((current) => current ? {
      ...current,
      [replicate.role === "outgoing" ? "outgoingAnalysis" : "incomingAnalysis"]: replicate.baseAnalysis,
      outgoingWindow: replicate.saved.outgoingWindow,
      incomingWindow: replicate.saved.incomingWindow,
      beats: replicate.saved.beats,
      automation: resizeAssistedOverlapAutomation(current.automation, replicate.saved.beats),
      replicate: null,
      replicateSelection: null,
      replicatePending: null,
      cueHistory: [],
      status: "REPLICATE cleared — the wave, both windows and the beat count stand as they did before the paste",
    } : current);
    reportCrowdLiveEvent("preview.replicate.cleared", { role: replicate.role, ...replicate.plan });
  };
  /** Rebuild a draft's saved replicate: same render (cache hit), same splice. */
  const restoreTransitionPreviewReplicate = async (draft: PreviewDraft) => {
    const info = draft.replicate;
    if (!info) return;
    const opened = transitionPreviewCurrent.current;
    if (!opened || opened.outgoingTrack.id !== draft.outgoingTrackId || opened.incomingTrack.id !== draft.incomingTrackId) return;
    const outgoing = info.role === "outgoing";
    const track = outgoing ? opened.outgoingTrack : opened.incomingTrack;
    const base = outgoing ? opened.outgoingAnalysis : opened.incomingAnalysis;
    const plan: ReplicatePlan = { blockStart: info.blockStart, blockEnd: info.blockEnd, copies: info.copies };
    const addedBeats = replicateBlockBeats(base.beats, plan) * plan.copies;
    const saved = { beats: info.savedBeats, outgoingWindow: info.savedOutgoingWindow, incomingWindow: info.savedIncomingWindow };
    const fallBack = (message: string) => setTransitionPreview((current) => current && !current.replicate ? {
      ...current,
      beats: saved.beats,
      outgoingWindow: saved.outgoingWindow,
      incomingWindow: saved.incomingWindow,
      status: message,
    } : current);
    if (addedBeats < 1) { fallBack("The saved REPLICATE no longer matches this tune's grid — windows restored without it"); return; }
    try {
      const response = await fetch("/api/replicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, blockStart: plan.blockStart, blockEnd: plan.blockEnd, copies: plan.copies }),
      });
      const payload = await response.json() as { ok?: boolean; audio?: string; error?: string };
      if (!response.ok || !payload.ok || !payload.audio) throw new Error(payload.error ?? "splice render failed");
      const spliced = replicateSpliceAnalysis(base, plan);
      setTransitionPreview((current) => {
        if (!current || current.replicate) return current;
        if (current.outgoingTrack.id !== draft.outgoingTrackId || current.incomingTrack.id !== draft.incomingTrackId) return current;
        return {
          ...current,
          [outgoing ? "outgoingAnalysis" : "incomingAnalysis"]: spliced,
          replicate: { role: info.role, plan, addedBeats, audio: payload.audio!, baseAnalysis: base, saved },
          replicateSelection: { role: info.role, start: plan.blockStart, end: plan.blockEnd },
          status: "REPLICATE restored with your windows — the pasted block is back in the wave",
        };
      });
    } catch {
      fallBack("The saved REPLICATE could not be rebuilt — windows restored to their pre-paste marks instead");
    }
  };
  const confirmGridOverride = async (role: TransitionPreviewRole) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview || gridOverrideBusy) return;
    const track = role === "outgoing" ? preview.outgoingTrack : preview.incomingTrack;
    const anchorSeconds = captureTransitionPreviewMarkTime(role);
    setGridOverrideBusy(true);
    setTransitionPreview((current) => current ? { ...current, status: `Reforming the grid onto ${preciseTimeLabel(anchorSeconds)} and matching that kick across the tune…` } : current);
    try {
      const response = await fetch("/api/grid-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, anchorSeconds }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; shiftMs?: number; matches?: number; stamped?: number; beats?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Grid override failed");
      const fresh = await fetchTrackAnalysis<Analysis>(`/api/analysis/${track.id}?v=${Date.now()}`);
      for (const id of DECK_IDS) {
        if (decksCurrent.current[id].track?.id === track.id) changeDeck(id, { analysis: fresh });
      }
      setTransitionPreview((current) => {
        if (!current) return current;
        return {
          ...current,
          outgoingAnalysis: current.outgoingTrack.id === track.id ? fresh : current.outgoingAnalysis,
          incomingAnalysis: current.incomingTrack.id === track.id ? fresh : current.incomingAnalysis,
          status: `Grid reformed: shifted ${payload.shiftMs} ms onto your point · ${payload.stamped} of ${payload.beats} beats matched your kick's signature (${payload.matches} events found)`,
        };
      });
      setGridOverrideArmed((current) => ({ ...current, [role]: false }));
      // DJ, 30 Aug 2026: after a grid change the preview must show ONE truth.
      // The sandbox holds derived copies (pinned-window lattices among them)
      // that a state patch cannot chase down - measured drawing lines ~170 ms
      // off the fresh beats while snap used the new ones. So the preview
      // rebuilds itself: close and reopen re-derives every surface from the
      // updated analysis. Old grid gone, new grid drawn, everywhere.
      closeTransitionPreview();
      window.setTimeout(() => openTransitionPreview(), 150);
    } catch (error) {
      setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Grid override failed" } : current);
    } finally {
      setGridOverrideBusy(false);
    }
  };
  const editTransitionPreviewWindow = (role: TransitionPreviewRole) => {
    stopTransitionPreviewPlayback(`${role === "outgoing" ? "Mix Out" : "Mix In"} window ready to edit on its private waveform`);
    setTransitionPreview((current) => current ? { ...current, configurationOpen: false, selectionRole: role } : current);
  };
  /**
   * DJ, 29 Aug 2026: marking no longer walks the DJ on to the next window.
   * This is the only way forward, pressed once the length feels right.
   */
  const advanceTransitionPreviewSelection = (role: TransitionPreviewRole) => {
    const preview = transitionPreviewCurrent.current;
    if (!preview) return;
    if (role === "outgoing") { editTransitionPreviewWindow("incoming"); return; }
    if (!transitionPreviewWindowReady(preview.outgoingWindow)) { editTransitionPreviewWindow("outgoing"); return; }
    stopTransitionPreviewPlayback();
    setTransitionPreview((current) => current ? {
      ...current,
      configurationOpen: true,
      selectionRole: null,
      status: "Both private windows set · confirm the beat grid, bass cue and mix automation",
    } : current);
  };
  // DJ, 26 Aug 2026: Esc walks the preview back one window at a time —
  // test mix -> Mix In -> Mix Out -> booth.
  const stepTransitionPreviewBack = () => {
    const preview = transitionPreviewCurrent.current;
    if (!preview) return;
    if (preview.configurationOpen) { editTransitionPreviewWindow("incoming"); return; }
    if (preview.selectionRole === "incoming") { editTransitionPreviewWindow("outgoing"); return; }
    closeTransitionPreview();
  };
  const undoTransitionPreviewCue = () => {
    stopTransitionPreviewPlayback();
    reportCrowdLiveEvent("preview.window.undo", { historyLength: transitionPreviewCurrent.current?.cueHistory.length ?? 0 });
    setTransitionPreview((current) => {
      if (!current) return current;
      const snapshot = current.cueHistory.at(-1);
      if (!snapshot) return { ...current, status: "No earlier private cue step to undo" };
      return {
        ...current,
        ...snapshot,
        // The restored count travels with its windows, and the automation is
        // resized to match — windows, count and curve stay one coherent era.
        automation: resizeAssistedOverlapAutomation(current.automation, snapshot.beats),
        cueHistory: current.cueHistory.slice(0, -1),
        status: "Undid the last private cue step · live cue records untouched",
      };
    });
  };
  const resetTransitionPreviewCues = () => {
    stopTransitionPreviewPlayback();
    reportCrowdLiveEvent("preview.windows.reset", {
      outgoingTrackId: transitionPreviewCurrent.current?.outgoingTrack.id,
      incomingTrackId: transitionPreviewCurrent.current?.incomingTrack.id,
    });
    setTransitionPreview((current) => current ? {
      ...current,
      // Windows gone means the paste's bookkeeping is gone with them: the
      // wave returns to the pristine tune, not a paste with no window.
      ...(current.replicate ? { [current.replicate.role === "outgoing" ? "outgoingAnalysis" : "incomingAnalysis"]: current.replicate.baseAnalysis, beats: current.replicate.saved.beats } : {}),
      replicate: null,
      replicateSelection: null,
      replicatePending: null,
      outgoingWindow: { start: null, end: null },
      incomingWindow: { start: null, end: null },
      outgoingAnchor: null,
      incomingAnchor: null,
      configurationOpen: false,
      selectionRole: "outgoing",
      cueHistory: [...current.cueHistory, {
        beats: current.beats,
        outgoingWindow: current.outgoingWindow,
        incomingWindow: current.incomingWindow,
        outgoingAnchor: current.outgoingAnchor,
        incomingAnchor: current.incomingAnchor,
        configurationOpen: current.configurationOpen,
        selectionRole: current.selectionRole,
      }],
      status: "Private Mix Out and Mix In cues reset · live saved cues untouched",
    } : current);
  };
  /**
   * Choosing a length re-places the free edge of every window that has an
   * anchor, so the DJ can click 32 / 64 / 96 and watch the coloured span on
   * the overall waveform grow and shrink before committing to one.
   */
  const setTransitionPreviewOverlapBeats = (beats: AssistedOverlapBeats) => {
    if (transitionPreviewCurrent.current?.replicate) {
      setTransitionPreview((current) => current ? { ...current, status: "The overlap length is owned by the REPLICATE while a block is pasted — CLEAR it first, then pick a new length" } : current);
      return;
    }
    stopTransitionPreviewPlayback();
    reportCrowdLiveEvent("preview.overlap-beats.changed", { from: transitionPreviewCurrent.current?.beats, to: beats });
    setTransitionPreview((current) => {
      if (!current) return current;
      const rebuild = (role: TransitionPreviewRole) => {
        const anchor = role === "outgoing" ? current.outgoingAnchor : current.incomingAnchor;
        const window = role === "outgoing" ? current.outgoingWindow : current.incomingWindow;
        if (!anchor) return { window, note: null as string | null };
        const anchorTime = anchor === "start" ? window.start : window.end;
        if (anchorTime === null) return { window, note: null };
        const derived = deriveTransitionPreviewWindowFor(current, role, anchor, anchorTime, beats);
        if (!derived.ok) return { window, note: `${role === "outgoing" ? "MIX OUT" : "MIX IN"} kept its old length - ${derived.reason}` };
        return { window: derived.window, note: null };
      };
      const outgoing = rebuild("outgoing");
      const incoming = rebuild("incoming");
      const refusals = [outgoing.note, incoming.note].filter(Boolean).join(" · ");
      // Atomic: if the new length does not fit EVERY anchored window, nothing
      // changes - not even the beat count. A half-switch would leave the grid
      // overlay and window-BPM maths counting the new length against spans
      // placed for the old one.
      if (refusals) return { ...current, status: `${beats} beats does not fit - ${refusals} · kept ${current.beats}` };
      return {
        ...current,
        beats,
        outgoingWindow: outgoing.window,
        incomingWindow: incoming.window,
        automation: resizeAssistedOverlapAutomation(current.automation, beats),
        cueHistory: [...current.cueHistory, {
          beats: current.beats,
          outgoingWindow: current.outgoingWindow,
          incomingWindow: current.incomingWindow,
          outgoingAnchor: current.outgoingAnchor,
          incomingAnchor: current.incomingAnchor,
          configurationOpen: current.configurationOpen,
          selectionRole: current.selectionRole,
        }],
        status: refusals || `${beats}-beat overlap · every anchored window re-placed from the end you marked · the coloured span on the overall wave is the transition`,
      };
    });
  };
  const updateTransitionPreviewAutomation = (automation: AssistedOverlapAutomation) => {
    const current = transitionPreviewCurrent.current;
    if (!current) return;
    // Keep the media-clock callback authoritative immediately, without waiting
    // for React to commit the selected bass cue to the next render.
    transitionPreviewCurrent.current = { ...current, automation };
    setTransitionPreview((latest) => latest ? { ...latest, automation } : latest);
    reportCrowdLiveEvent("preview.automation.selected", {
      audition: current.audition,
      fromBassSwapBeat: current.automation.bassSwapBeat,
      bassSwapBeat: automation.bassSwapBeat,
      windowBeats: automation.windowBeats,
    });
  };
  const saveTransitionPreview = async () => {
    const preview = transitionPreview;
    if (!preview || preview.saving || transitionPreviewSaveInFlight.current) return;
    if (!transitionPreviewCanCommit(preview.outgoingWindow, preview.incomingWindow, preview.beats)) {
      setTransitionPreview((current) => current ? { ...current, status: "Both preview players need a START and END before the coordinates can be applied" } : current);
      return;
    }
    // A replicated pair lives in the pasted timeline; the live decks still
    // play the un-pasted tune, and the teaching store must never hold
    // coordinates measured on audio the library does not contain. The full
    // preview mix plays the paste faithfully in here; sending it live is its
    // own build, on its own order.
    if (preview.replicate) {
      setTransitionPreview((current) => current ? { ...current, status: "A REPLICATE lives in the preview only for now — audition the full mix here; applying a pasted mix to the live decks is the next build" } : current);
      return;
    }
    const runtimeAtStart = demoRuntime.current;
    const runnerTokensAtStart = {
      demo: demoToken.current,
      live: liveToken.current,
      assisted: assistedToken.current,
    };
    const runtimeOutgoing = runtimeAtStart?.prepared.plan.tracks[runtimeAtStart.transitionIndex];
    const runtimeIncoming = runtimeAtStart?.prepared.plan.tracks[runtimeAtStart.transitionIndex + 1];
    const editingLiveTransition = Boolean(runtimeAtStart && runtimeOutgoing?.id === preview.outgoingTrack.id && runtimeIncoming?.id === preview.incomingTrack.id);
    const liveOutgoingAudio = activeAudio(preview.outgoingDeck);
    if (editingLiveTransition && runtimeAtStart?.stage !== "primary") {
      setTransitionPreview((current) => current ? { ...current, status: "This live transition has already begun · stop or finish it before replacing its coordinates" } : current);
      return;
    }
    const previewBeatSeconds = (preview.outgoingWindow.end! - preview.outgoingWindow.start!) / preview.beats;
    const requestedSilentPrerollAt = preview.outgoingWindow.start! - previewBeatSeconds * ASSISTED_SILENT_PREROLL_BEATS;
    const selectedOutgoingIsLive = Boolean(
      liveOutgoingAudio
      && !liveOutgoingAudio.paused
      && !liveOutgoingAudio.ended
      && !decksCurrent.current[preview.outgoingDeck].cuePreviewing,
    );
    if (selectedOutgoingIsLive && liveOutgoingAudio!.currentTime >= requestedSilentPrerollAt - TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS) {
      setTransitionPreview((current) => current ? { ...current, status: `The ${ASSISTED_SILENT_PREROLL_BEATS}-beat silent preroll has already started on the live tune · choose a later Mix Out window` } : current);
      return;
    }
    transitionPreviewSaveInFlight.current = true;
    stopTransitionPreviewPlayback();
    reportCrowdLiveEvent("preview.apply.started", {
      outgoingTrackId: preview.outgoingTrack.id,
      incomingTrackId: preview.incomingTrack.id,
      outgoingWindow: preview.outgoingWindow,
      incomingWindow: preview.incomingWindow,
      beats: preview.beats,
      bassSwapBeat: preview.automation.bassSwapBeat,
      editingLiveTransition,
    });
    setTransitionPreview((current) => current ? { ...current, saving: true, status: "Applying private preview coordinates to the live track records…" } : current);
    const saveWindowEntry = (track: Track, analysis: Analysis, purpose: ManualWindowPurpose, window: TransitionPreviewWindow) => ({
      id: track.id,
      kind: "loop-grid" as const,
      purpose,
      start: window.start,
      end: window.end,
      beats: preview.beats,
      crowdBpm: resolvedBpmAt(analysis, window.start!),
      crowdSuggestedTime: window.end,
      replacePlacements: false,
    });
    let savedToLiveTracks = false;
    try {
      const response = await fetch("/api/dj-library/teaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition-pair",
          entries: [
            saveWindowEntry(preview.outgoingTrack, preview.outgoingAnalysis, "outro-transition", preview.outgoingWindow),
            saveWindowEntry(preview.incomingTrack, preview.incomingAnalysis, "intro-loop", preview.incomingWindow),
          ],
        }),
      });
      const payload = await response.json() as {
        results?: Array<{ id: string; analysis: Analysis; teaching?: Analysis["teaching"]; moment?: unknown; moments?: unknown[]; undoToken?: string }>;
        profile?: TeachingProfile;
        error?: string;
      };
      const outgoingResult = payload.results?.find((result) => result.id === preview.outgoingTrack.id);
      const incomingResult = payload.results?.find((result) => result.id === preview.incomingTrack.id);
      if (!response.ok || !outgoingResult?.analysis || !incomingResult?.analysis) {
        throw new Error(payload.error ?? "The two Preview windows could not be saved together");
      }
      savedToLiveTracks = true;
      const outgoingAnalysis = outgoingResult.analysis!;
      const incomingAnalysis = incomingResult.analysis!;
      const nextDecks = { ...decksCurrent.current };
      for (const id of DECK_IDS) {
        if (nextDecks[id].track?.id === preview.outgoingTrack.id) nextDecks[id] = { ...nextDecks[id], analysis: outgoingAnalysis };
        if (nextDecks[id].track?.id === preview.incomingTrack.id) nextDecks[id] = { ...nextDecks[id], analysis: incomingAnalysis };
      }
      decksCurrent.current = nextDecks;
      setDecks(nextDecks);
      saveAssistedOverlapAutomation(preview.automation, preview.incomingTrack.id);
      teachingSessionTrack.current[preview.outgoingDeck] = preview.outgoingTrack.id;
      teachingSessionTrack.current[preview.incomingDeck] = preview.incomingTrack.id;
      if (payload.profile) setTeachingProfile(payload.profile);
      const replacement = buildAssistedPlaybackPlan(
        { id: preview.outgoingTrack.id, name: preview.outgoingTrack.name, deck: preview.outgoingDeck, analysis: outgoingAnalysis },
        { id: preview.incomingTrack.id, name: preview.incomingTrack.name, deck: preview.incomingDeck, analysis: incomingAnalysis },
        preview.automation,
      );
      const replacementOutgoing = replacement.tracks[0];
      const replacementIncoming = replacement.tracks[1];
      const silentPrerollAt = assistedCuePrerollStart(
        replacementOutgoing.analysis,
        replacementOutgoing.exitRunway,
        replacementOutgoing.bpm,
      );
      // A finished rotation leaves its runtime in place ready for the next
      // assisted hop. When the DJ is driving by hand that runtime is stale the
      // moment its outgoing tune is no longer the one playing — and leaving it
      // there blocked every later Apply with "another transition is already
      // armed" until the page was reloaded. Retire it instead of refusing.
      const staleRuntime = demoRuntime.current;
      const staleOutgoing = staleRuntime?.prepared.plan.tracks[staleRuntime.transitionIndex];
      // A runtime still at "primary" is armed and waiting; it has not touched
      // the output. Whether its outgoing tune happens to be the one playing is
      // beside the point — replacing it changes nothing the room can hear, and
      // the mix the DJ is pushing right now is the later instruction. Only a
      // runtime that has begun its swap is protected, below.
      if (staleRuntime && !staleRuntime.busy && staleRuntime.stage === "primary") {
        if (demoTimer.current) clearInterval(demoTimer.current);
        demoTimer.current = null;
        demoRuntime.current = null;
        demoToken.current += 1;
        // Retiring the stale runtime is this save's own doing. The race guard
        // below compares these tokens against the ones captured on entry to
        // spot a runner that appeared while the save was in flight — so
        // leaving our own bump visible made Apply report a foreign runner
        // that does not exist and refuse to arm. Re-baseline it: an external
        // change still trips the guard, ours does not.
        runnerTokensAtStart.demo = demoToken.current;
        reportCrowdLiveEvent("transition.stale-runtime-released", {
          outgoingTrackId: staleOutgoing?.id,
          incomingTrackId: staleRuntime.prepared.plan.tracks[staleRuntime.transitionIndex + 1]?.id,
          transitionIndex: staleRuntime.transitionIndex,
          replacedBy: `${preview.outgoingTrack.id}->${preview.incomingTrack.id}`,
        });
      }
      const runtimeAfterSave = demoRuntime.current;
      const runtimeOutgoingAfterSave = runtimeAfterSave?.prepared.plan.tracks[runtimeAfterSave.transitionIndex];
      const runtimeIncomingAfterSave = runtimeAfterSave?.prepared.plan.tracks[runtimeAfterSave.transitionIndex + 1];
      const runtimeMatchesPreview = Boolean(
        runtimeAfterSave
        && runtimeOutgoingAfterSave?.id === preview.outgoingTrack.id
        && runtimeIncomingAfterSave?.id === preview.incomingTrack.id
        && assistedPlaying.current,
      );
      const runtimeState: TransitionPreviewLiveRuntimeState = !runtimeAfterSave
        ? "none"
        : runtimeMatchesPreview
          ? runtimeAfterSave.stage === "primary" ? "matching-primary" : "matching-started"
          : "other";
      const outgoingStateAfterSave = decksCurrent.current[preview.outgoingDeck];
      const incomingStateAfterSave = decksCurrent.current[preview.incomingDeck];
      const outgoingAudioAfterSave = activeAudio(preview.outgoingDeck);
      const incomingAudioAfterSave = activeAudio(preview.incomingDeck);
      const decksMatch = outgoingStateAfterSave.track?.id === preview.outgoingTrack.id
        && incomingStateAfterSave.track?.id === preview.incomingTrack.id;
      const outgoingPlaying = Boolean(
        outgoingAudioAfterSave
        && mediaReadyForTrack(outgoingAudioAfterSave, outgoingStateAfterSave.track)
        && !outgoingAudioAfterSave.paused
        && !outgoingAudioAfterSave.ended
        && !outgoingStateAfterSave.cuePreviewing,
      );
      const incomingReady = mediaReadyForTrack(incomingAudioAfterSave, incomingStateAfterSave.track);
      const incomingStopped = Boolean(incomingAudioAfterSave?.paused && !incomingStateAfterSave.cuePreviewing);
      const runnerChangedDuringSave = demoToken.current !== runnerTokensAtStart.demo
        || liveToken.current !== runnerTokensAtStart.live
        || assistedToken.current !== runnerTokensAtStart.assisted;
      const matchingRuntimeOwnsAssistedRunner = runtimeMatchesPreview
        && demoRuntime.current === runtimeAfterSave
        && assistedPlaying.current;
      // Apply is a deliberate instruction, so it outranks anything that is
      // merely armed, hunting or waiting. Only a swap already in the room may
      // refuse it — yanking that would be audible. In particular an auto-DJ
      // set being switched on, and the runner looking for its next track or
      // waiting on a free deck, no longer block: none of them are making a
      // sound, and blocking on them meant no Apply could ever land during a
      // live set.
      // DJ, 26 Aug 2026 (night): a completed transition (or a restored
      // session) can leave the runner FLAGS set with no runtime behind them —
      // and that ghost blocked Apply with "different-runner" while the booth
      // sat silent. A swap "already in the room" requires an actual live
      // runtime; flags without demoRuntime are a ghost and cannot refuse.
      const assistedOverlapUnderway = assistedPlaying.current && demoRuntime.current !== null && !matchingRuntimeOwnsAssistedRunner;
      const conflictingRunnerActive = runnerChangedDuringSave
        || assistedOverlapUnderway
        || (demoModeCurrent.current === "running" && demoRuntime.current !== null && !runtimeMatchesPreview);
      // Name the holder. "Another runner is active" with no way to tell which
      // one leaves nothing to act on when the block is genuine.
      const conflictingRunnerDetail = runnerChangedDuringSave ? "a runner started while Apply was saving"
        : assistedOverlapUnderway ? "an assisted overlap is already underway"
        : (demoModeCurrent.current === "running" && demoRuntime.current !== null && !runtimeMatchesPreview) ? "a demo run is playing a different pair"
        : null;
      const liveArmDecision = transitionPreviewLiveArmDecision({
        runtimeState,
        decksMatch,
        outgoingPlaying,
        incomingReady,
        incomingStopped,
        runtimeHealthy: !runtimeAfterSave?.busy,
        outgoingTime: outgoingAudioAfterSave?.currentTime ?? outgoingStateAfterSave.currentTime,
        silentPrerollAt,
        otherRunnerActive: conflictingRunnerActive,
      });
      const nextLogicalOrder = assistedCueState && assistedDeckForOrder(assistedCueState.order + 1) === preview.incomingDeck
        ? assistedCueState.order + 1
        : loadedPairOrderForIncoming(preview.incomingDeck);
      const savedOrder = assistedCueState?.deck === preview.incomingDeck && assistedCueState.track.id === preview.incomingTrack.id
        ? assistedCueState.order
        : nextLogicalOrder;
      const savedCueState: AssistedCueState = {
        order: savedOrder,
        deck: preview.incomingDeck,
        track: preview.incomingTrack,
        mixInRequired: true,
        mixInSet: true,
        mixOutSet: Boolean(savedManualWindow(incomingAnalysis, "outro-transition")),
        introPrepSkipped: false,
        selection: {
          selectedBpm: trackSelectionBpm(incomingAnalysis),
          previousTrackId: preview.outgoingTrack.id,
          previousTrackName: preview.outgoingTrack.name,
          previousBpm: trackSelectionBpm(outgoingAnalysis),
        },
      };
      const pairPrepared: PreparedDemo = {
        plan: replacement,
        tracks: {
          [preview.outgoingTrack.id]: decksMatch ? outgoingStateAfterSave.track! : preview.outgoingTrack,
          [preview.incomingTrack.id]: decksMatch ? incomingStateAfterSave.track! : preview.incomingTrack,
        },
        assistedAutomations: [preview.automation],
        rotatingAssisted: true,
        assistedOrderOffset: Math.max(0, savedOrder - 1),
      };
      let armedLiveTransition = false;
      if (liveArmDecision.action === "update" && runtimeAfterSave) {
        const assistedAutomations = [...(runtimeAfterSave.prepared.assistedAutomations ?? [])];
        assistedAutomations[runtimeAfterSave.transitionIndex] = preview.automation;
        const updated: PreparedDemo = {
          ...runtimeAfterSave.prepared,
          plan: replaceAssistedTransition(runtimeAfterSave.prepared.plan, runtimeAfterSave.transitionIndex, replacement),
          assistedAutomations,
        };
        runtimeAfterSave.prepared = updated;
        runtimeAfterSave.manualEqTransitionIndex = runtimeAfterSave.transitionIndex;
        runtimeAfterSave.manualEqOwnership = {};
        publishPreparedDemo(updated);
        if (!demoTimer.current) demoTimer.current = setInterval(demoTick, 80);
        armedLiveTransition = demoRuntime.current === runtimeAfterSave && demoTimer.current !== null;
      } else if (liveArmDecision.action === "arm") {
        demoToken.current += 1;
        assistedToken.current += 1;
        if (demoTimer.current) clearInterval(demoTimer.current);
        demoTimer.current = null;
        assistedRunning.current = true;
        assistedPlaying.current = true;
        assistedReplaySnapshot.current = null;
        publishPreparedDemo(pairPrepared);
        demoRuntime.current = {
          prepared: pairPrepared,
          transitionIndex: 0,
          stage: "primary",
          busy: false,
          lastCorrectionAt: 0,
          lastStatusAt: 0,
          settleUntil: 0,
        };
        setAssistedCueState(savedCueState);
        setAssistedPending(null);
        setAssistedSource("loaded");
        setAssistedMode("playing");
        setAssistedLaunchedOrder(savedOrder);
        setKickPhaseStatus("GRID · LIVE TRANSITION ARMED");
        lastPlaying.current = [preview.outgoingDeck];
        usedCrateTracks.current.add(preview.outgoingTrack.id);
        usedCrateTracks.current.add(preview.incomingTrack.id);
        setAssistedDecisions((items) => [
          `PREVIEW APPLIED · ${preview.outgoingTrack.name} → ${preview.incomingTrack.name} · live watcher armed without moving Deck ${preview.outgoingDeck}`,
          ...items,
        ].slice(0, ASSISTED_DECISION_LOG_LIMIT));
        demoTimer.current = setInterval(demoTick, 80);
        armedLiveTransition = demoRuntime.current !== null && demoTimer.current !== null;
      } else if (decksMatch && liveArmDecision.action === "save-only") {
        if (runtimeAfterSave && demoRuntime.current === runtimeAfterSave) {
          demoToken.current += 1;
          if (demoTimer.current) clearInterval(demoTimer.current);
          demoTimer.current = null;
          demoRuntime.current = null;
        }
        publishPreparedDemo(pairPrepared);
        setAssistedCueState(savedCueState);
        assistedRunning.current = true;
        assistedPlaying.current = false;
        setAssistedSource("loaded");
        setAssistedMode("ready");
      }
      if (armedLiveTransition && liveArmDecision.action === "arm") {
        reportCrowdLiveEvent("preview.apply.armed", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          outgoingDeck: preview.outgoingDeck,
          incomingDeck: preview.incomingDeck,
          outgoingTime: outgoingAudioAfterSave?.currentTime,
          silentPrerollAt,
          mixOutAt: replacementOutgoing.exitRunway,
          mixEndAt: replacementOutgoing.exitHandoff,
          incomingPrerollAt: assistedIncomingPrerollTime(replacementIncoming),
          timerMs: 80,
        });
        reportCrowdLiveEvent("transition.armed", {
          source: "preview-apply",
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          outgoingTime: outgoingAudioAfterSave?.currentTime,
          silentPrerollAt,
        });
      }
      const notArmedReason = (() => {
        switch (liveArmDecision.reason) {
          case "live-transition-started": return "the existing live transition is already running on its prior coordinates; these new coordinates are saved for the next run";
          case "different-runtime": return "another transition is already armed";
          case "runtime-busy": return "the existing transition watcher is still busy and cannot be safely replaced";
          case "different-runner": return conflictingRunnerDetail ?? "another live or demo runner is active";
          case "decks-changed": return "the loaded deck pair changed while Apply was saving";
          case "outgoing-not-playing": return "the outgoing tune is not currently playing";
          case "incoming-unavailable": return "the incoming deck's audio file is not ready or is no longer available";
          case "incoming-not-stopped": return "the incoming deck is already playing or unavailable";
          case "silent-preroll-passed": return `the ${ASSISTED_SILENT_PREROLL_BEATS}-beat silent-preroll point passed while Apply was saving`;
          default: return "the live watcher was not eligible";
        }
      })();
      const applyStatus = armedLiveTransition
        ? "SAVED TO LIVE TRACKS · LIVE TRANSITION ARMED · live playhead untouched"
        : `SAVED TO LIVE TRACKS · NOT ARMED · ${notArmedReason}`;
      const returnToBoothAfterApply = liveArmDecision.action !== "blocked";
      setAssistedStatus(armedLiveTransition
        ? `${preview.outgoingTrack.name} → ${preview.incomingTrack.name} · live watcher armed for the ${ASSISTED_SILENT_PREROLL_BEATS}-beat silent preroll at ${preciseTimeLabel(silentPrerollAt)} · current playhead untouched`
        : `${preview.outgoingTrack.name} → ${preview.incomingTrack.name} · saved but not armed · ${notArmedReason}`);
      if (!returnToBoothAfterApply) {
        setTransitionPreview((current) => current ? {
          ...current,
          outgoingAnalysis,
          incomingAnalysis,
          saving: false,
          status: applyStatus,
        } : current);
      }
      reportCrowdLiveEvent("preview.apply.succeeded", {
        outgoingTrackId: preview.outgoingTrack.id,
        incomingTrackId: preview.incomingTrack.id,
        beats: preview.beats,
        editingLiveTransition,
        armedLiveTransition,
        liveArmAction: liveArmDecision.action,
        liveArmReason: liveArmDecision.reason,
        outgoingTime: outgoingAudioAfterSave?.currentTime,
        silentPrerollAt,
      });
      if (returnToBoothAfterApply) closeTransitionPreview();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "the live watcher could not be armed";
      if (savedToLiveTracks) {
        reportCrowdLiveEvent("preview.apply.arm-failed", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          ...diagnosticErrorDetails(error),
        });
        reportCrowdLiveEvent("preview.apply.succeeded", {
          outgoingTrackId: preview.outgoingTrack.id,
          incomingTrackId: preview.incomingTrack.id,
          beats: preview.beats,
          editingLiveTransition,
          armedLiveTransition: false,
          liveArmAction: "error",
        });
        setAssistedStatus(`${preview.outgoingTrack.name} → ${preview.incomingTrack.name} · saved but not armed · ${detail}`);
        setTransitionPreview((current) => current ? { ...current, saving: false, status: `SAVED TO LIVE TRACKS · NOT ARMED · ${detail}` } : current);
      } else {
        reportCrowdLiveEvent("preview.apply.failed", diagnosticErrorDetails(error));
        setTransitionPreview((current) => current ? { ...current, saving: false, status: detail } : current);
      }
    } finally {
      transitionPreviewSaveInFlight.current = false;
    }
  };
  const loadedThreeTuneSequenceReady = Boolean(
    (!assistedCueState || assistedCueState.order <= 2)
    && loadedManualPairForIncoming("B")
    && loadedManualPairForIncoming("C"),
  );
  const liveActive = liveMode === "selecting" || liveMode === "starting" || liveMode === "searching" || liveMode === "candidate" || liveMode === "running";
  const assistedActive = assistedMode === "finding" || assistedMode === "waiting-deck" || assistedMode === "awaiting-cues" || assistedMode === "ready" || assistedMode === "playing";
  const assistedButtonLabel = assistedMode === "playing" ? "STOP + RESET TO READY" : assistedActive ? "STOP ASSISTED CRATE SET" : assistedMode === "error" ? "RETRY RANDOM ASSISTED SET" : "START RANDOM ASSISTED SET";
  const loadedPairCanLaunch = Boolean(loadedManualPair && assistedMode !== "playing");
  const sessionPairCanLaunch = Boolean(
    assistedMode === "ready"
    && assistedCueState
    && assistedCueState.order > 0
    && assistedCueState.mixInSet
  );
  const assistedPairReady = sessionPairCanLaunch || loadedPairCanLaunch;
  const assistedPairReplay = assistedPairReady && Boolean(
    assistedReplaySnapshot.current
    && assistedCueState
    && assistedCueState.order <= assistedLaunchedOrder,
  );
  const assistedCanFindNext = assistedMode === "ready" && Boolean(
    assistedCueState
    && assistedCueState.mixOutSet
    && (assistedCueState.order === 0 || assistedCueState.order <= assistedLaunchedOrder)
  );
  const loadedDeckTracks = { A: decks.A.track, B: decks.B.track, C: decks.C.track };
  const assistedNextDeck = assistedCueState ? assistedDeckForOrder(assistedCueState.order + 1) : null;
  const assistedNextLoadedDeck = assistedSource === "loaded" && assistedCueState
    ? assistedLoadedDeckForOrder(assistedCueState.order + 1, loadedDeckTracks)
    : null;
  const assistedNextLoadedTrack = assistedNextLoadedDeck ? decks[assistedNextLoadedDeck].track : null;
  const assistedRejectable = assistedMode !== "playing"
    ? assistedPending ?? (assistedCueState && assistedCueState.order > 0 ? assistedCueState : null)
    : null;
  const assistedLaunchLabel = assistedMode === "playing"
    ? "ASSISTED SET PLAYING"
    : loadedThreeTuneSequenceReady
      ? assistedPairReplay ? "REPLAY 3-TUNE SET · A → B → C" : "LAUNCH 3-TUNE SET · A → B → C"
      : assistedPairReplay ? "REPLAY SAME ASSISTED SET" : "LAUNCH ASSISTED SET PLAYING";
  const assistedManualLoopDialog = manualLoopDialog
    && assistedCueState?.deck === manualLoopDialog.deck
    && assistedCueState.track.id === manualLoopDialog.trackId
    && (assistedMode === "awaiting-cues" || assistedMode === "ready")
    ? manualLoopDialog
    : null;
  const mixInAutomationDialog = manualLoopDialog?.purpose === "intro-loop"
    ? manualLoopDialog
    : null;
  const manualLoopBeatChoices = assistedManualLoopDialog || mixInAutomationDialog
    ? [...ASSISTED_OVERLAP_BEAT_OPTIONS]
    : [4, 8, 16, 32, ...ASSISTED_OVERLAP_BEAT_OPTIONS];
  const manualLoopAutomation = mixInAutomationDialog && isAssistedOverlapBeats(mixInAutomationDialog.beats)
    ? resizeAssistedOverlapAutomation(mixInAutomationDialog.automation ?? assistedOverlapAutomation, mixInAutomationDialog.beats)
    : mixInAutomationDialog?.automation ?? assistedOverlapAutomation;
  const updateManualLoopBeatCount = (beats: number) => setManualLoopDialog((current) => {
    if (!current) return current;
    const automation = current.automation && isAssistedOverlapBeats(beats)
      ? resizeAssistedOverlapAutomation(current.automation, beats)
      : current.automation;
    return { ...current, beats, automation };
  });
  const assistedStartDisabled = !tracks.length || liveActive || demoMode === "running" || crateScan?.status === "running";
  const assistedLoadedStartDisabled = assistedStartDisabled || assistedActive || !canStartLoadedAssistedSet(loadedDeckTracks);
  const toggleAssistedSet = () => {
    if (assistedMode === "playing") { stopAndResetAssistedPlayback(); return; }
    if (assistedActive) { stopAssistedSet(); return; }
    void startAssistedSet().catch((error: unknown) => {
      assistedRunning.current = false;
      setAssistedMode("error");
      setAssistedStatus(error instanceof Error ? error.message : "The assisted set could not start");
    });
  };
  const adoptLoadedTunes = () => {
    void startAssistedSetFromLoaded().catch((error: unknown) => {
      assistedRunning.current = false;
      setAssistedMode("error");
      setAssistedStatus(error instanceof Error ? error.message : "The loaded tunes could not be adopted");
    });
  };
  const retryAssistedLaunch = () => {
    if (assistedMode !== "error") return;
    const current = assistedCueState;
    if (current && current.order > 0 && current.mixInSet) {
      // The failed launch left the assisted cue state intact: relaunch the same
      // pair. launchAssistedPlayback takes the explicit cue state, so the retry
      // does not depend on sessionPairCanLaunch (false while mode is "error").
      assistedRunning.current = true;
      setAssistedMode("ready");
      void launchAssistedPlayback({ cueState: current }).catch(reportAssistedPlaybackError);
      return;
    }
    // No intact pair: reuse the start/stop/retry toggle, whose label logic
    // already covers the "error" mode (RETRY RANDOM ASSISTED SET).
    toggleAssistedSet();
  };
  const loadedAssistedAvailable = canStartLoadedAssistedSet(loadedDeckTracks);
  const latestMixIn = DECK_IDS
    .map((id): { deck: DeckId; track: Track; analysis: Analysis; window: ManualCycleTeaching } | null => {
      const deck = decks[id];
      if (!deck.track || !deck.analysis) return null;
      const teaching = deck.analysis.teaching;
      const legacyWindow = teaching?.manualCycle;
      const window = teaching?.manualIntroCycle ?? (legacyWindow?.purpose === "intro-loop" ? legacyWindow : undefined);
      return window ? { deck: id, track: deck.track, analysis: deck.analysis, window } : null;
    })
    .filter((item): item is { deck: DeckId; track: Track; analysis: Analysis; window: ManualCycleTeaching } => Boolean(item))
    .sort((left, right) => Date.parse(right.window.selectedAt) - Date.parse(left.window.selectedAt))[0] ?? null;
  const openLatestMixAutomation = () => {
    if (!latestMixIn) return;
    const saved = latestMixIn.window;
    const beats = isAssistedOverlapBeats(saved.beats)
      ? saved.beats
      : assistedOverlapAutomationCurrent.current.windowBeats;
    setWorkflowDeck(latestMixIn.deck);
    setManualLoopDialog({
      deck: latestMixIn.deck,
      trackId: latestMixIn.track.id,
      trackName: latestMixIn.track.name,
      start: saved.start,
      end: saved.end,
      beats,
      suggestedBeats: saved.beats,
      crowdBpm: saved.crowdBpm || saved.bpm,
      cueEdge: saved.cueEdge ?? null,
      exitSide: saved.exitSide ?? null,
      purpose: "intro-loop",
      automation: resizeAssistedOverlapAutomation(assistedAutomationForTrack(latestMixIn.track.id, latestMixIn.analysis), beats),
      configurationOnly: true,
    });
  };
  const deckUsesFullIntro = (id: DeckId) => {
    const deck = decks[id];
    return Boolean(deck.track && (
      fullIntroTracks[id] === deck.track.id
      || (
        assistedCueState?.deck === id
        && assistedCueState.track.id === deck.track.id
        && assistedCueState.introPrepSkipped
      )
    ));
  };
  const workflowStageForDeck = (id: DeckId) => {
    if (!decks[id].track) return "load";
    if (manualLoopDialog?.deck === id) return manualLoopDialog.purpose === "intro-loop" ? "mix-in" : "mix-out";
    if (!deckHasSavedWindow(id, "intro-loop") && !deckUsesFullIntro(id)) return "mix-in";
    if (loadedManualPairForIncoming(id)) return "launch";
    if (!deckHasSavedWindow(id, "outro-transition")) return "mix-out";
    return "launch";
  };
  const workflowStage = workflowStageForDeck(workflowDeck);
  // DJ, 28 Aug 2026: Mix In, Mix Out and Launch left the strip — those marks
  // are made in the PREVIEW flow now. Load (with Autoselect) is the whole rail.
  const workflowStages = [
    { id: "load", label: "Load" },
  ] as const;
  // A deck past Load has no card of its own any more, so it reads as complete.
  const workflowStageIndex = workflowStages.some((stage) => stage.id === workflowStage)
    ? workflowStages.findIndex((stage) => stage.id === workflowStage)
    : workflowStages.length;
  const selectedWorkflowDeck = decks[workflowDeck];
  const workflowPrimaryLabel = workflowStage === "load"
    ? `LOAD DECK ${workflowDeck} TUNE`
    : workflowStage === "mix-in"
      ? customLoopStarts[workflowDeck] === null ? "MARK START" : "MARK END"
      : workflowStage === "mix-out"
        ? customLoopStarts[workflowDeck] === null ? "MARK START" : "MARK END"
        : assistedMode === "playing"
          ? "STOP + RESET ASSISTED SET"
          : assistedPairReady
            ? assistedLaunchLabel
            : `DECK ${workflowDeck} READY · SELECT NEXT DECK`;
  const launchAvailableAssistedPair = (options: { runwayPreview?: boolean } = {}) => {
    const cueState = sessionPairCanLaunch && assistedCueState
      ? assistedCueState
      : loadedManualPair?.cueState ?? null;
    if (!cueState) {
      reportAssistedPlaybackError(new Error("Set the outgoing tune's Mix Out and the incoming tune's Mix In before launch"));
      return;
    }
    if (cueState !== assistedCueState) {
      const outgoingDeck = assistedPreviousDeck(cueState.deck);
      assistedRunning.current = true;
      assistedPlaying.current = false;
      assistedReplaySnapshot.current = null;
      setAssistedSource("loaded");
      setAssistedCueState(cueState);
      setAssistedPending(null);
      setAssistedMode("ready");
      const outgoingTrack = decks[outgoingDeck].track;
      if (outgoingTrack) usedCrateTracks.current.add(outgoingTrack.id);
      usedCrateTracks.current.add(cueState.track.id);
      setAssistedDecisions((items) => [
        `MANUAL PAIR ARMED Â· ${outgoingTrack?.name ?? `Deck ${outgoingDeck}`} â†’ ${cueState.track.name}`,
        ...items,
      ].slice(0, ASSISTED_DECISION_LOG_LIMIT));
    }
    void launchAssistedPlayback({ ...options, cueState }).catch(reportAssistedPlaybackError);
  };
  const activateWorkflowPrimary = () => {
    if (workflowStage === "load") {
      openTrackPicker(workflowDeck);
      return;
    }
    if (workflowStage === "mix-in" || workflowStage === "mix-out") {
      customLoopPoint(workflowDeck, workflowStage === "mix-in" ? "intro-loop" : "outro-transition");
      waveformFocusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (assistedMode === "playing") {
      stopAndResetAssistedPlayback();
      return;
    }
    if (assistedPairReady) {
      launchAvailableAssistedPair();
      return;
    }
  };
  const autoselectWorkflowTune = async () => {
    if (workflowAutoselecting) return;
    const targetDeck = workflowDeck;
    setWorkflowAutoselecting(true);
    setAssistedStatus(`Autoselecting an unused full tune from the crate for Deck ${targetDeck}`);
    setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `Locating an unused full tune in the crate · preparing Deck ${targetDeck}` }));
    try {
      const payload = await fetch(`/api/map?includeUnknown=1&v=${Date.now()}`, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Crate returned ${response.status}`);
        return response.json() as Promise<{ tracks: Track[] }>;
      });
      setTracks(payload.tracks);
      const loadedIds = new Set(DECK_IDS.map((id) => decksCurrent.current[id].track?.id).filter((id): id is string => Boolean(id)));
      const candidates = shuffled(assistedSelectionPool(payload.tracks, usedCrateTracks.current))
        .filter((track) => !loadedIds.has(track.id));
      let chosen: Track | null = null;
      for (const candidate of candidates) {
        if (isKnownShortSample(candidate.duration)) continue;
        if (candidate.duration > 0) {
          chosen = candidate;
          break;
        }
        try {
          const durationResponse = await fetch(`/api/audio-duration?id=${encodeURIComponent(candidate.id)}`, { cache: "no-store" });
          const durationPayload = await durationResponse.json() as { duration?: number | null; shortSample?: boolean };
          if (durationPayload.shortSample || isKnownShortSample(durationPayload.duration)) continue;
          chosen = durationPayload.duration && durationPayload.duration > 0 ? { ...candidate, duration: durationPayload.duration } : candidate;
          break;
        } catch {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) throw new Error("No unused full tune is currently available in the crate");
      await loadTrack(targetDeck, chosen, undefined, false, true);
      usedCrateTracks.current.add(chosen.id);
      setAssistedDecisions((items) => [`AUTOSELECTED · ${chosen.name} · Deck ${targetDeck} · unused full tune from crate`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
      setWorkflowDeck(targetDeck);
      setAssistedStatus(`${chosen.name} autoselected from the crate and loaded on Deck ${targetDeck}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Autoselect stopped";
      setAssistedStatus(`Deck ${targetDeck} autoselect stopped · ${detail}`);
      setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `Autoselect stopped · ${detail}` }));
      setAssistedDecisions((items) => [`AUTOSELECT STOPPED · Deck ${targetDeck} · ${detail}`, ...items].slice(0, ASSISTED_DECISION_LOG_LIMIT));
    } finally {
      setWorkflowAutoselecting(false);
    }
  };
  const loadPickedTrack = async (targetDeck: DeckId, track: Track) => {
    if (pickerLoadingTrackId) return;
    setPickerLoadingTrackId(track.id);
    try {
      // The picker closes as soon as the deck holds the tune, so its loading
      // strip — audio readiness and the real analysis progress — is visible
      // instead of a modal that said only "LOADING…" for the whole analysis.
      await loadTrack(targetDeck, track, undefined, false, true, {
        onAttached: () => {
          setPicker((current) => current === targetDeck ? null : current);
          setPickerLoadingTrackId((current) => current === track.id ? null : current);
        },
      });
      setPicker((current) => current === targetDeck ? null : current);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "the selected tune could not be loaded";
      setAssistedStatus(`Deck ${targetDeck} load stopped · ${detail}`);
      setLoopTeachingStatus((current) => ({ ...current, [targetDeck]: `Load stopped · ${detail}` }));
    } finally {
      setPickerLoadingTrackId((current) => current === track.id ? null : current);
    }
  };
  const workflowPrimaryDisabled = workflowStage === "mix-in" || workflowStage === "mix-out"
    ? !selectedWorkflowDeck.track || !selectedWorkflowDeck.analysis
    : workflowStage === "launch"
      ? assistedMode !== "playing" && !assistedPairReady
      : false;
  const workflowCanUndoCue = Boolean(
    decks[workflowDeck].track
    && cueUndo[workflowDeck].at(-1)?.trackId === decks[workflowDeck].track?.id
  );
  const workflowCanResetCues = Boolean(
    selectedWorkflowDeck.track
    && selectedWorkflowDeck.analysis
    && workflowResettingDeck === null
    && assistedMode !== "playing"
  );
  const workflowFullIntroSelected = Boolean(
    selectedWorkflowDeck.track
    && fullIntroTracks[workflowDeck] === selectedWorkflowDeck.track.id
  );
  const matchingAssistedOpener = Boolean(
    assistedCueState?.order === 0
    && assistedCueState.deck === workflowDeck
    && assistedCueState.track.id === selectedWorkflowDeck.track?.id
  );
  const workflowCanUseFullIntro = Boolean(
    workflowDeck === "A"
    && selectedWorkflowDeck.track
    && (!assistedActive || matchingAssistedOpener)
  );
  const selectWorkflowFullIntro = () => {
    const deck = decksCurrent.current[workflowDeck];
    if (!workflowCanUseFullIntro || !deck.track) return;
    if (matchingAssistedOpener) {
      if (!assistedCueState?.introPrepSkipped) skipAssistedIntroPrep();
      return;
    }
    if (fullIntroTracks[workflowDeck] === deck.track.id) {
      setFullIntroTracks((current) => ({ ...current, [workflowDeck]: null }));
      setLoopTeachingStatus((current) => ({ ...current, [workflowDeck]: "Full Intro cleared · mark the Mix In window if this tune needs one." }));
      return;
    }
    rememberCueUndo(workflowDeck);
    cancelLoopTransition(workflowDeck);
    loopCycleArmed.current[workflowDeck] = false;
    changeDeck(workflowDeck, { loopActive: false });
    setCustomLoopStarts((current) => ({ ...current, [workflowDeck]: null }));
    setCustomLoopPurposes((current) => ({ ...current, [workflowDeck]: null }));
    setManualLoopDialog((dialog) => dialog?.deck === workflowDeck && dialog.purpose === "intro-loop" ? null : dialog);
    setFullIntroTracks((current) => ({ ...current, [workflowDeck]: deck.track!.id }));
    setLoopTeachingStatus((current) => ({ ...current, [workflowDeck]: `Full Intro selected · ${deck.track!.name} is Tune 1 and automix will not look for a Mix In window.` }));
    setAssistedStatus(`${deck.track.name} marked as the full-intro opener on Deck ${workflowDeck} · mark its Mix Out window next`);
  };
  const workflowConfigMixHint = latestMixIn
    ? `DECK ${latestMixIn.deck} · ${latestMixIn.track.name}`
    : "SET A MIX IN FIRST";
  const loadPendingAssistedChoice = async () => {
    const pending = assistedPending;
    if (!pending || assistedChoiceLoadingTrackId) return;
    setAssistedChoiceLoadingTrackId(pending.track.id);
    try {
      await loadAssistedChoice(pending, assistedToken.current);
    } catch (error) {
      setAssistedStatus(error instanceof Error ? error.message : "That assisted tune could not be loaded");
    } finally {
      setAssistedChoiceLoadingTrackId(null);
    }
  };
  const transitionPreviewDeckState = (role: TransitionPreviewRole): DeckState | null => {
    if (!transitionPreview) return null;
    const outgoing = role === "outgoing";
    const deckId = outgoing ? transitionPreview.outgoingDeck : transitionPreview.incomingDeck;
    const track = outgoing ? transitionPreview.outgoingTrack : transitionPreview.incomingTrack;
    const analysis = outgoing ? transitionPreview.outgoingAnalysis : transitionPreview.incomingAnalysis;
    const time = outgoing ? transitionPreview.outgoingTime : transitionPreview.incomingTime;
    const window = outgoing ? transitionPreview.outgoingWindow : transitionPreview.incomingWindow;
    const tempoRate = !outgoing && transitionPreviewCanCommit(transitionPreview.outgoingWindow, transitionPreview.incomingWindow, transitionPreview.beats)
      ? transitionPreviewTempoRate(transitionPreview.outgoingWindow, transitionPreview.incomingWindow)
      : 1;
    return {
      ...decks[deckId],
      track,
      analysis,
      currentTime: time,
      playing: transitionPreview.audition === role || transitionPreview.audition === "mix",
      cuePreviewing: transitionPreview.audition === role && transitionPreviewCueReturn.current[role] !== undefined,
      tempoRate,
      cuePoint: window.end ?? window.start ?? time,
      loopSize: transitionPreview.beats,
      loopStart: window.start,
      loopEnd: window.end,
      loopActive: false,
      cue: false,
      volume: .72,
      low: 0,
      mid: 0,
      high: 0,
      fx: "none",
      wet: 0,
    };
  };
  // Where the scanner thinks the two cues are. Computed once per pair: the
  // entry and exit searches are per-track, so pairing the two here gives the
  // same numbers the library cached, which is what the hit rates were measured
  // against. Throws when a tune has no phrase-aligned candidate at all, and a
  // missing prediction is a normal outcome rather than an error.
  const transitionPreviewScan = useMemo(() => {
    if (!transitionPreview) return null;
    try {
      const plan = planDemoSet([
        { id: transitionPreview.outgoingTrack.id, name: transitionPreview.outgoingTrack.name, analysis: transitionPreview.outgoingAnalysis as DemoAnalysis },
        { id: transitionPreview.incomingTrack.id, name: transitionPreview.incomingTrack.name, analysis: transitionPreview.incomingAnalysis as DemoAnalysis },
      ]);
      // How sure the grid is of its own tempo where the cue actually falls.
      // Everything the prediction was scored against came from tunes the
      // scanner was confident about, so a doubtful grid has to travel with the
      // number rather than be assumed away.
      const confidenceAt = (analysis: Analysis, time: number) =>
        analysis.tempoSections.find((section) => time >= section.start && time < section.end)?.confidence
          ?? analysis.tempoSections[0]?.confidence
          ?? null;
      return {
        outgoing: { duration: transitionPreview.outgoingAnalysis.duration, bpm: plan.tracks[0].bpm, exitHandoff: plan.tracks[0].exitHandoff, entryDrop: plan.tracks[0].entryDrop, gridConfidence: confidenceAt(transitionPreview.outgoingAnalysis, plan.tracks[0].exitHandoff) },
        incoming: { duration: transitionPreview.incomingAnalysis.duration, bpm: plan.tracks[1].bpm, exitHandoff: plan.tracks[1].exitHandoff, entryDrop: plan.tracks[1].entryDrop, gridConfidence: confidenceAt(transitionPreview.incomingAnalysis, plan.tracks[1].entryDrop) },
      };
    } catch {
      return null;
    }
  }, [transitionPreview]);
  /**
   * Play a track with a tick on every grid beat.
   *
   * The tick is scheduled on the audio clock rather than fired from timers:
   * a setTimeout tick would wander by its own few milliseconds and the flam
   * being listened for is smaller than that. Playback position is sampled once
   * playback has actually begun, and every tick is placed relative to it.
   *
   * Routed straight to the destination, deliberately. This is a measuring tool
   * and it must not inherit a booth mute, a cue-monitor gate or a fader.
   */
  const stopGridCheck = () => {
    if (gridCheckStop.current !== null) { window.clearTimeout(gridCheckStop.current); gridCheckStop.current = null; }
    for (const node of gridCheckTickNodes.current) { try { node.stop(); } catch { /* already finished */ } }
    gridCheckTickNodes.current = [];
    gridCheckAudio.current?.pause();
  };
  const playGridCheck = async (item: GridCheckItem, shiftMs = 0, beatsOverride?: number[], nudgeOverride?: number) => {
    const audio = gridCheckAudio.current;
    if (!audio) return;
    stopGridCheck();
    const { start, end } = gridCheckWindow(item);
    // Detected kicks are judged against the drum stem itself. The whole point is
    // to hear whether a tick sits on a kick, and isolated drums make that far
    // easier than the same tick buried in a full mix.
    const source = item.source === "kicks" || item.source === "kickgrid"
      ? `/api/kick-stem/${encodeURIComponent(item.trackId)}`
      : `/api/audio/${encodeURIComponent(item.trackId)}`;
    if (audio.getAttribute("src") !== source) {
      audio.setAttribute("src", source);
      audio.load();
      await new Promise<void>((resolve) => {
        const ready = () => { audio.removeEventListener("loadedmetadata", ready); resolve(); };
        audio.addEventListener("loadedmetadata", ready);
        // A transcode through /api/audio can take longer than four seconds on a
        // long tune; giving up early is what leaves the element unseekable.
        window.setTimeout(ready, 12000);
      });
    }
    try {
      audio.currentTime = start;
      const { audioContext } = ensureMasterOutputs();
      if (audioContext.state === "suspended") await audioContext.resume();
      // Route the music through a gain node once, so each tick can duck it. A
      // media element can only ever be given to createMediaElementSource once,
      // hence the ref rather than building this per play.
      if (!gridCheckMediaSource.current) {
        try {
          gridCheckMediaSource.current = audioContext.createMediaElementSource(audio);
          gridCheckDuck.current = audioContext.createGain();
          gridCheckMediaSource.current.connect(gridCheckDuck.current);
          gridCheckDuck.current.connect(hardwareOutputs.current!.audition);
        } catch {
          audio.pause();
          throw new Error("The grid audition could not be routed privately.");
        }
      }
      await audio.play();
      gridCheckDuck.current?.gain.cancelScheduledValues(audioContext.currentTime);
      gridCheckDuck.current?.gain.setValueAtTime(1, audioContext.currentTime);
      // Wait for the seek to actually land before reading the position. Read too
      // early and `currentTime` is still 0 while the beats are two minutes into
      // the tune, so every tick gets scheduled beyond the window and then
      // cancelled by stopGridCheck — the track plays and nothing ticks.
      await new Promise<void>((resolve) => {
        if (Math.abs(audio.currentTime - start) < .25) return resolve();
        const landed = () => { audio.removeEventListener("seeked", landed); resolve(); };
        audio.addEventListener("seeked", landed);
        window.setTimeout(landed, 2000);
      });
      // Both clocks read together, after the seek, or they describe different moments.
      const clockAt = audioContext.currentTime;
      const playingFrom = audio.currentTime;
      if (Math.abs(playingFrom - start) > 1) {
        // Say it rather than tick against the wrong part of the tune: a tick that
        // does not line up would be read as a bad grid.
        setGridCheckStatus(`That track would not seek to the window (asked ${start.toFixed(1)}s, got ${playingFrom.toFixed(1)}s)`);
        stopGridCheck();
        return;
      }
      // An override lets the same audition be ticked with the raw detected kicks
      // instead of the fitted grid, so the two can be compared without the audio,
      // the window or the ducking changing between them.
      const audition = gridCheckWindow(item);
      const ticks = beatsOverride
        ? beatsOverride.filter((time) => time >= audition.start && time <= audition.end)
        : gridCheckTicks(item);
      for (const beat of ticks) {
        // The nudge moves the ticks, not the audio, so it measures the lag between
        // them without changing what is being judged. Taken as an argument because
        // a click sets state and replays in the same breath, and the state would
        // still hold the previous value.
        const nudge = nudgeOverride ?? gridCheckNudgeMs;
        const when = clockAt + (beat + (shiftMs + nudge) / 1000 - playingFrom);
        if (when < clockAt) continue;
        // A short high blip: it has to be audible against a kick without
        // masking it, so the ear can judge whether the two arrive together.
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(2400, when);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(.32, when + .001);
        gain.gain.exponentialRampToValueAtTime(.0001, when + .028);
        oscillator.connect(gain);
        gain.connect(hardwareOutputs.current!.audition);
        oscillator.start(when);
        oscillator.stop(when + .04);
        gridCheckTickNodes.current.push(oscillator);
        // Duck the music under each tick. The tick and the kick collide exactly
        // where the judgement is made, which is the worst place for them to mask
        // each other. Ducking is deliberately faster than the ear's ability to
        // localise it — a 6 ms dip is heard as the tick being clearer, not as the
        // music moving, so it cannot fake or hide a flam.
        if (gridCheckDuck.current) {
          const duck = gridCheckDuck.current.gain;
          duck.setValueAtTime(1, Math.max(clockAt, when - .012));
          duck.linearRampToValueAtTime(GRID_CHECK_DUCK_DEPTH, when - .006);
          duck.setValueAtTime(GRID_CHECK_DUCK_DEPTH, when + .022);
          duck.linearRampToValueAtTime(1, when + .06);
        }
      }
      gridCheckStop.current = window.setTimeout(stopGridCheck, Math.max(500, (end - start) * 1000));
    } catch (error) {
      setGridCheckStatus(error instanceof Error ? error.message : "Could not play that track");
    }
  };
  /**
   * Ask where the grid would sit if it followed the low end.
   *
   * Measured over the same window that is about to play, so the correction on
   * offer is the one being listened to rather than a whole-track average.
   */
  const measureGridOffset = async (item: GridCheckItem) => {
    const { start, end } = gridCheckWindow(item);
    try {
      const response = await fetch(`/api/grid-check/offset?trackId=${encodeURIComponent(item.trackId)}&start=${start.toFixed(3)}&seconds=${(end - start).toFixed(3)}`, { cache: "no-store" });
      const payload = await response.json() as { shiftMs?: number; confident?: boolean; rivalShiftMs?: number | null; improvement?: number; error?: string };
      if (payload.error || typeof payload.shiftMs !== "number") { setGridCheckOffset(null); return; }
      setGridCheckOffset({ shiftMs: payload.shiftMs, confident: Boolean(payload.confident), rivalShiftMs: payload.rivalShiftMs ?? null, improvement: payload.improvement ?? 1 });
    } catch { setGridCheckOffset(null); }
  };
  const openGridCheck = async () => {
    setGridCheckOpen(true);
    setGridCheckStatus("Loading grids…");
    try {
      const response = await fetch("/api/grid-check", { cache: "no-store" });
      const payload = await response.json() as { items?: GridCheckItem[]; verdicts?: Record<string, GridCheckRecord>; total?: number; unheard?: number; error?: string };
      if (payload.error) { setGridCheckStatus(payload.error); return; }
      const items = payload.items ?? [];
      const verdicts = payload.verdicts ?? {};
      setGridCheckItems(items);
      setGridCheckVerdicts(verdicts);
      const next = nextGridCheck(items, verdicts);
      setGridCheckCurrent(next);
      setGridCheckOffset(null);
      if (next) void measureGridOffset(next);
      // Say how many are left. Running out with no warning reads as the feature
      // ending, when it means the queue is finished.
      const remaining = payload.unheard ?? items.filter((item) => !verdicts[item.trackId]).length;
      setGridCheckStatus(next
        ? remaining > 1 ? `${remaining} grids still unheard` : "last unheard grid"
        : items.length ? `Every grid has a verdict · ${items.length} heard.` : "No analysed tracks to check.");
      if (next) void playGridCheck(next);
    } catch (error) {
      setGridCheckStatus(error instanceof Error ? error.message : "Could not load grids");
    }
  };
  const closeGridCheck = () => { stopGridCheck(); setGridCheckOpen(false); };
  useEffect(() => {
    if (!gridCheckOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeGridCheck(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gridCheckOpen]);
  const decideGridCheck = async (verdict: GridCheckVerdict) => {
    const item = gridCheckCurrent;
    if (!item) return;
    const optimistic = { ...gridCheckVerdicts, [item.trackId]: { verdict, decidedAt: new Date().toISOString() } };
    setGridCheckVerdicts(optimistic);
    const next = nextGridCheck(gridCheckItems, optimistic, item.trackId);
    setGridCheckCurrent(next);
    setGridCheckOffset(null);
    if (next) void measureGridOffset(next);
    setGridCheckStatus(next ? "" : "Every grid has a verdict.");
    if (next) void playGridCheck(next); else stopGridCheck();
    try {
      const response = await fetch("/api/grid-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Which grid was judged, so a verdict on a percussion-fitted grid cannot
        // overwrite one given for the library's own.
        body: JSON.stringify({ trackId: item.trackId, verdict, source: item.source ?? "stored" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setGridCheckStatus(payload.error ?? "That verdict did not save");
      }
    } catch (error) {
      setGridCheckStatus(error instanceof Error ? error.message : "That verdict did not save");
    }
  };
  const transitionPreviewCues = (role: TransitionPreviewRole): Cue[] => {
    if (!transitionPreview) return [];
    const outgoing = role === "outgoing";
    const analysis = outgoing ? transitionPreview.outgoingAnalysis : transitionPreview.incomingAnalysis;
    const window = outgoing ? transitionPreview.outgoingWindow : transitionPreview.incomingWindow;
    const privateCues: Cue[] = [];
    // The predicted cue, drawn only where it earned the right to be believed:
    // the incoming drop landed on a window edge in every mix on record, while
    // the outgoing handoff is only offered once it sits late in the tune.
    // A replicate moves this role's display onto the pasted timeline, so
    // cues recorded against the original clock — scan predictions and the
    // taught intro/outro marks — are mapped through the paste. A mark inside
    // the copied block is real audio in every pass, so it appears once per
    // pass, exactly like the kicks it sits on.
    const replicate = transitionPreview.replicate?.role === role ? transitionPreview.replicate : null;
    const scan = outgoing ? transitionPreviewScan?.outgoing : transitionPreviewScan?.incoming;
    const predicted = scan ? (outgoing ? predictedMixOutCue(scan) : predictedEntryCue(scan)) : null;
    if (predicted) {
      privateCues.push({
        id: `preview-${role}-predicted`,
        time: replicate ? replicateMapTime(replicate.plan, predicted.time) : predicted.time,
        label: outgoing ? "PREDICTED MIX OUT" : "PREDICTED DROP",
        description: `Suggested from the scan · ${predicted.because}. Nothing moves unless you mark it.`,
        colour: "#8fa3ad",
      });
    }
    if (window.start !== null) privateCues.push({ id: `preview-${role}-start`, time: window.start, label: outgoing ? "MIX OUT START" : "MIX IN START", description: "Private preview window start", colour: "#ffc857" });
    if (window.end !== null) privateCues.push({ id: `preview-${role}-end`, time: window.end, label: outgoing ? "MIX OUT END" : "MIX IN END", description: "Private preview window end", colour: outgoing ? "#ff784f" : "#4cf2b4" });
    const trackCues = replicate
      ? buildCues(analysis).flatMap((cue) => replicateOccurrences(replicate.plan, cue.time).map((time, occurrence) => occurrence === 0
        ? { ...cue, time }
        : { ...cue, time, id: `${cue.id}-replica-${occurrence}` }))
      : buildCues(analysis);
    return [...trackCues, ...privateCues];
  };
  /**
   * Report when a marked window's own tempo and the scanned tempo disagree.
   *
   * This never moves a mark and never overrules the window — the window is
   * still the grid. It says two numbers disagree, which is arithmetic, not an
   * opinion about where the mix belongs. Every window that drifted in play
   * failed this check and no sound one did, so it is worth saying out loud at
   * the moment the mark is set rather than two beats into the mix.
   */
  const transitionPreviewGridNotice = (role: TransitionPreviewRole) => {
    if (!transitionPreview) return null;
    const outgoing = role === "outgoing";
    const window = outgoing ? transitionPreview.outgoingWindow : transitionPreview.incomingWindow;
    const scan = outgoing ? transitionPreviewScan?.outgoing : transitionPreviewScan?.incoming;
    if (!scan || window.start === null || window.end === null) return null;
    const check = gridDisagreement({
      windowSeconds: window.end - window.start,
      declaredBeats: transitionPreview.beats,
      scannedBpm: scan.bpm,
    });
    if (!check?.disagrees) return null;
    return <p className="transition-preview-grid-notice" role="status">
      <b>CHECK THIS WINDOW</b>
      <span>{check.message}</span>
    </p>;
  };
  const transitionPreviewCueButton = (role: TransitionPreviewRole, cueTime?: number) => <button
    type="button"
    className="transition-preview-play-cue"
    aria-label={`Hold to play the ${role === "outgoing" ? "Mix Out" : "Mix In"} preview cue`}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); void startTransitionPreviewCue(role, cueTime).catch((error: unknown) => setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Private cue could not start" } : current)); }}
    onPointerUp={(event) => { endTransitionPreviewCue(role); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => endTransitionPreviewCue(role)}
    onLostPointerCapture={() => endTransitionPreviewCue(role)}
    onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); event.stopPropagation(); void startTransitionPreviewCue(role, cueTime); } }}
    onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); endTransitionPreviewCue(role); } }}
  ><span className="cdj-icon-bezel"><PlayCueTransportIcon /></span><small>HOLD · RETURNS TO CUE</small></button>;
  const transitionPreviewCard = (role: TransitionPreviewRole) => {
    if (!transitionPreview) return null;
    const outgoing = role === "outgoing";
    const deckId = outgoing ? transitionPreview.outgoingDeck : transitionPreview.incomingDeck;
    const track = outgoing ? transitionPreview.outgoingTrack : transitionPreview.incomingTrack;
    const analysis = outgoing ? transitionPreview.outgoingAnalysis : transitionPreview.incomingAnalysis;
    const time = outgoing ? transitionPreview.outgoingTime : transitionPreview.incomingTime;
    const window = outgoing ? transitionPreview.outgoingWindow : transitionPreview.incomingWindow;
    const anchorEdge = outgoing ? transitionPreview.outgoingAnchor : transitionPreview.incomingAnchor;
    const audioRef = outgoing ? transitionPreviewOutgoingAudio : transitionPreviewIncomingAudio;
    const visualTimeRef = outgoing ? transitionPreviewOutgoingVisualTime : transitionPreviewIncomingVisualTime;
    const sandboxDeck = transitionPreviewDeckState(role)!;
    const cues = transitionPreviewCues(role);
    const previewLabel = outgoing ? "Mix Out" : "Mix In";
    return <section className={`transition-preview-deck transition-preview-${role}`}>
      <header><div><small>{outgoing ? "PLAYING TRACK · PRIVATE MIX OUT COPY" : "NEXT TRACK · PRIVATE MIX IN COPY"}</small><b>{track.name}</b></div><strong><TransitionPreviewTimeReadout audioRef={audioRef} fallback={time} active={transitionPreview.audition === role || transitionPreview.audition === "mix"} /></strong></header>
      <div className="transition-preview-focus-tools">
        <b>{transitionPreviewFocusSeconds[role]} SEC FOCUS</b>
        <div className="transition-preview-focus-zoom wave-focus-window-zoom" aria-label={`${previewLabel} moving waveform focus zoom`}>
          <button type="button" className="wave-zoom-icon" aria-label={`${previewLabel} preview moving waveform zoom out`} title="Show more time in the preview moving waveform" disabled={transitionPreviewFocusSeconds[role] >= 64} onClick={() => setTransitionPreviewFocusSeconds((current) => ({ ...current, [role]: Math.min(64, current[role] * 2) }))}><span className="cdj-icon-bezel"><ZoomOutIcon /></span></button>
          <button type="button" className="wave-zoom-icon" aria-label={`${previewLabel} preview moving waveform zoom in`} title="Show less time in the preview moving waveform" disabled={transitionPreviewFocusSeconds[role] <= 2} onClick={() => setTransitionPreviewFocusSeconds((current) => ({ ...current, [role]: Math.max(2, current[role] / 2) }))}><span className="cdj-icon-bezel"><ZoomInIcon /></span></button>
        </div>
      </div>
      <div className="transition-preview-moving-wave"><MovingWave id={deckId} deck={sandboxDeck} audio={audioRef.current} cues={cues} phaseStatus={(() => { const partner = transitionPreviewDeckState(role === "outgoing" ? "incoming" : "outgoing"); return partner ? comparePhase(sandboxDeck, partner) : "uncompared"; })()} loadStatus="" windowSeconds={transitionPreviewFocusSeconds[role]} onTime={(nextTime) => seekTransitionPreview(role, nextTime)} onWindowChange={(seconds) => setTransitionPreviewFocusSeconds((current) => ({ ...current, [role]: seconds }))} onScrubChange={() => {}} scope={`preview-${role}`} visualTimeRef={visualTimeRef} declaredGrid={window.start !== null && window.end !== null ? { start: window.start, end: window.end, beats: transitionPreview.beats } : undefined}
        replicateView={transitionPreview.replicate?.role === role ? { plan: transitionPreview.replicate.plan } : undefined} /></div>
      <div className="transition-preview-overview-wave"><div className="transition-preview-overview-label">WHOLE TRACK WAVEFORM · CLICK ANYWHERE TO SEEK · WHITE LINE FOLLOWS PRIVATE PLAYBACK</div><OverviewWave id={deckId} deck={sandboxDeck} cues={cues} zoom={1} onSeek={(nextTime) => seekTransitionPreview(role, nextTime)} scope={`preview-${role}`} audioRef={audioRef} highlight={window.start !== null && window.end !== null ? { start: window.start, end: window.end, colour: outgoing ? "#ff784f" : "#4cf2b4" } : null} /></div>
      <div className="transition-preview-window-readout"><span>{outgoing ? "START MIX OUT" : "START MIX IN"} <b>{window.start === null ? "—" : preciseTimeLabel(window.start)}</b></span><span>{outgoing ? "FINISH MIX OUT" : "FINISH MIX IN"} <b>{window.end === null ? "—" : preciseTimeLabel(window.end)}</b></span></div>
      {transitionPreviewGridNotice(role)}
      <div className="transition-preview-transport-actions">
        <button type="button" aria-pressed={transitionPreview.audition === role} aria-label={transitionPreview.audition === role ? `Pause ${previewLabel} preview` : `Play ${previewLabel} preview`} onClick={() => void playTransitionPreviewTrack(role).catch((error: unknown) => setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Private player could not start" } : current))}><span className="cdj-icon-bezel">{transitionPreview.audition === role ? <PauseTransportIcon /> : <PlayTransportIcon />}</span><small>PREVIEW MONITOR</small></button>
        {transitionPreviewCueButton(role)}
        <button type="button" className={`transition-preview-set-start ${anchorEdge === "start" ? "anchored" : ""}`} onPointerDown={(event) => markTransitionPreviewWindowFromPointer(event, role, "start")} onKeyDown={(event) => markTransitionPreviewWindowFromKeyboard(event, role, "start")}>{outgoing ? "START MIX OUT" : "START MIX IN"}<small>{anchorEdge === "start" ? "ANCHOR · AT WHITE PLAYHEAD" : `AT PLAYHEAD · +${transitionPreview.beats} BEATS SETS FINISH`}</small></button>
        <button type="button" className={`transition-preview-set-finish ${anchorEdge === "end" ? "anchored" : ""}`} onPointerDown={(event) => markTransitionPreviewWindowFromPointer(event, role, "end")} onKeyDown={(event) => markTransitionPreviewWindowFromKeyboard(event, role, "end")}>{outgoing ? "FINISH MIX OUT" : "FINISH MIX IN"}<small>{anchorEdge === "end" ? "ANCHOR · AT WHITE PLAYHEAD" : `AT PLAYHEAD · ${outgoing ? `−${transitionPreview.beats} BEATS SETS START` : `START LANDS ON THE KICK −${transitionPreview.beats} BEATS BACK`}`}</small></button>
        <button type="button" className={gridOverrideArmed[role] ? "transition-preview-grid-override armed" : "transition-preview-grid-override"} disabled={gridOverrideBusy} onClick={() => {
          if (gridOverrideArmed[role]) { void confirmGridOverride(role); }
          else setGridOverrideArmed((current) => ({ ...current, [role]: true }));
        }}>{gridOverrideBusy ? "REFORMING…" : gridOverrideArmed[role] ? "GRID OVERRIDE CONFIRMED" : "GRID OVERRIDE"}<small>{gridOverrideArmed[role] ? "REFORMS GRID TO PLAYHEAD · MATCHES THIS KICK TUNE-WIDE" : "SNAP OFF · PLACE PLAYHEAD ON A KICK BY EAR"}</small></button>
      </div>
      <div className="transition-preview-selection-length">
        <div className="transition-preview-beats"><b>OVERLAP</b>{ASSISTED_OVERLAP_BEAT_OPTIONS.map((beats) => <button type="button" key={beats} className={transitionPreview.beats === beats ? "active" : ""} onClick={() => setTransitionPreviewOverlapBeats(beats)}>{beats}</button>)}<small>BEATS · RE-PLACES THE FREE END FROM YOUR ANCHOR</small></div>
        <button type="button" className="transition-preview-selection-next" disabled={window.start === null || window.end === null} onClick={() => advanceTransitionPreviewSelection(role)}>{outgoing ? "USE THIS MIX OUT →" : "USE THIS MIX IN →"}<small>{outgoing ? "THEN SET THE MIX IN" : "OPEN THE MIX EDITOR"}</small></button>
      </div>
    </section>;
  };
  const transitionPreviewWindowPanel = (role: TransitionPreviewRole, allowAutomation = false) => {
    if (!transitionPreview) return null;
    const outgoing = role === "outgoing";
    const track = outgoing ? transitionPreview.outgoingTrack : transitionPreview.incomingTrack;
    const analysis = outgoing ? transitionPreview.outgoingAnalysis : transitionPreview.incomingAnalysis;
    const window = outgoing ? transitionPreview.outgoingWindow : transitionPreview.incomingWindow;
    const audioRef = outgoing ? transitionPreviewOutgoingAudio : transitionPreviewIncomingAudio;
    const playheadTime = outgoing ? transitionPreview.outgoingTime : transitionPreview.incomingTime;
    if (!transitionPreviewWindowReady(window)) return null;
    return <section className={`transition-preview-window-panel transition-preview-window-${role}`}>
      <header><div><small>{outgoing ? "PINNED MIX OUT WINDOW" : "PINNED MIX IN WINDOW"}</small><b>{track.name}</b><span>{preciseTimeLabel(window.start!)} → {preciseTimeLabel(window.end!)}</span></div><div>
        {/* Pitch bends, left of play (DJ, 30 Aug 2026): ride a red/blue
            flam back to green by ear, exactly like a hand on the platter. */}
        {([-1, 1] as const).map((direction) => <button
          key={`bend-${direction}`}
          type="button"
          className="transition-preview-bend"
          aria-label={`Hold to ${direction < 0 ? "slow" : "speed up"} the ${outgoing ? "Mix Out" : "Mix In"} private player`}
          title={`Hold: nudge this tune ${direction < 0 ? "slower" : "faster"} by 1.5% while the mix plays`}
          disabled={transitionPreview.audition !== "mix" && transitionPreview.audition !== role}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* uncapturable */ } bendTransitionPreview(role, direction); }}
          onPointerUp={(event) => { bendTransitionPreview(role, 0); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => bendTransitionPreview(role, 0)}
          onLostPointerCapture={() => bendTransitionPreview(role, 0)}
          onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); event.stopPropagation(); bendTransitionPreview(role, direction); } }}
          onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); bendTransitionPreview(role, 0); } }}
          onBlur={() => bendTransitionPreview(role, 0)}
        ><span className="cdj-icon-bezel">{direction < 0 ? <PitchDownIcon /> : <PitchUpIcon />}</span><small>PITCH</small></button>)}
        <button type="button" aria-pressed={transitionPreview.audition === role} aria-label={transitionPreview.audition === role ? `Pause ${outgoing ? "Mix Out" : "Mix In"} window preview` : `Play ${outgoing ? "Mix Out" : "Mix In"} window preview`} onClick={() => void playTransitionPreviewTrack(role, window.start!).catch((error: unknown) => setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Private window could not start" } : current))}><span className="cdj-icon-bezel">{transitionPreview.audition === role ? <PauseTransportIcon /> : <PlayTransportIcon />}</span></button>
        {transitionPreviewCueButton(role, window.start!)}
        <button type="button" onClick={() => editTransitionPreviewWindow(role)}>EDIT CUES</button>
      </div></header>
      <RunupGridMapper
        analysis={analysis}
        start={window.start!}
        end={window.end!}
        beats={transitionPreview.beats}
        crowdBpm={resolvedBpmAt(analysis, window.start!)}
        automation={allowAutomation ? transitionPreview.automation : undefined}
        onAutomationChange={allowAutomation ? updateTransitionPreviewAutomation : undefined}
        audioRef={audioRef}
        playheadTime={playheadTime}
        showReferenceGrid={false}
        role={role}
        phaseColourRef={role === "outgoing" ? transitionPreviewPhaseColourOutgoing : transitionPreviewPhaseColourIncoming}
        onAudition={(time) => void playTransitionPreviewTrack(role, time, true).catch((error: unknown) => setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Private player could not start" } : current))}
        rightSelect={{
          span: transitionPreview.replicateSelection?.role === role ? { start: transitionPreview.replicateSelection.start, end: transitionPreview.replicateSelection.end } : null,
          pending: transitionPreview.replicatePending?.role === role ? transitionPreview.replicatePending.time : null,
          onSpan: (a, b) => commitReplicateSelection(role, a, b),
          onTap: (time) => tapReplicateSelection(role, time),
        }}
        replicateView={transitionPreview.replicate?.role === role ? { plan: transitionPreview.replicate.plan } : undefined}
      />
    </section>;
  };

  /**
   * REPLAY INPUTS — every recorded set is a file on disk, so a set is browsed
   * for and picked here rather than being "whatever was last". The booth then
   * re-performs it through its own functions: the dials move, the faders ride
   * and the stabs fire exactly as they did when it was recorded.
   */
  const replayCallbacks: ReplayCallbacks = {
    load: (deck, trackId) => { const track = tracks.find((item) => item.id === trackId); if (track) return loadTrack(deck as DeckId, track); },
    deckPatch: (deck, patch) => changeDeck(deck as DeckId, patch as Partial<DeckState>),
    play: (deck) => { if (!decksCurrent.current[deck as DeckId].playing) void toggle(deck as DeckId); },
    pause: (deck) => { if (decksCurrent.current[deck as DeckId].playing) void toggle(deck as DeckId); },
    seek: (deck, time) => seek(deck as DeckId, time),
    stabStart: (deck) => void startPlayCue(deck as DeckId),
    stabEnd: (deck) => endPlayCue(deck as DeckId),
    masterVolume: (value) => void setMaster(value),
    status: (text) => setRecStatus(text),
  };
  const refreshReplaySets = async () => {
    setReplaySetsLoading(true);
    try { setReplaySets(await listRecordings()); }
    finally { setReplaySetsLoading(false); }
  };
  const openReplayPicker = () => { setReplayPickerOpen(true); void refreshReplaySets(); };
  const replaySavedSet = (id: string) => { setReplayPickerOpen(false); void startReplay(id, replayCallbacks); };
  const replaySetFromDisk = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const set = await readSetFile(file);
      setReplayPickerOpen(false);
      replayActions(set.actions, replayCallbacks, file.name);
    } catch (error) {
      setRecStatus(error instanceof Error ? error.message : "That file is not a set");
    }
  };
  const setLengthLabel = (durationMs: number) => {
    const seconds = Math.round(durationMs / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
  };
  return <HotkeyContext.Provider value={hotkeySetup.bindings}><main className={`booth-page visual-${visualDirection}`}>
    {audioSetupOpen && <AudioOutputSetup current={outputConfig} onApply={configureAudioOutputs} onTest={testAudioOutput} onClose={() => { hardwareOutputs.current?.stopTest(); setAudioSetupOpen(false); }} />}
    {outputFault && <div className="audio-output-fault" role="alert"><span>{outputFault}</span><button type="button" onClick={() => setAudioSetupOpen(true)}>AUDIO OUTPUTS</button></div>}
    <ControlSetup blocked={audioSetupOpen} mode={controlSetupMode} onClose={() => setControlSetupMode(null)} hotkeys={hotkeySetup.bindings} onSaveHotkeys={hotkeySetup.save} onAction={performControlAction} />
    <ControlHelpBubbles {...controlHelp} />
    {crowdQrOpen && crowdQrMarkup && <div className="crowd-qr-overlay" role="dialog" aria-modal="true" aria-label="Loudlink QR code" onClick={() => setCrowdQrOpen(false)}>
      <div className="crowd-qr-card" dangerouslySetInnerHTML={{ __html: crowdQrMarkup }} />
      <b>{crowdPhoneUrl}</b>
      <small>PHONES SCAN TO JOIN THE LIVE MIX · TAP ANYWHERE TO CLOSE</small>
    </div>}
    {transitionPreview && <div className="transition-preview-overlay" role="presentation"><section className="transition-preview-studio" role="dialog" aria-modal="true" aria-labelledby="transition-preview-title">
      <audio
        ref={transitionPreviewOutgoingAudio}
        preload="none"
        onError={(event) => reportTransitionPreviewMediaError("outgoing", event.currentTarget)}
        onEnded={() => stopTransitionPreviewPlayback("Private track preview ended")}
      />
      <audio
        ref={transitionPreviewIncomingAudio}
        preload="none"
        onError={(event) => reportTransitionPreviewMediaError("incoming", event.currentTarget)}
        onEnded={() => stopTransitionPreviewPlayback("Private track preview ended")}
      />
      <div className="transition-preview-head"><div><p className="eyebrow">PREVIEW MONITOR · LIVE MASTER ISOLATED</p><h2 id="transition-preview-title">{transitionPreview.configurationOpen ? "COMPARE OVERLAP + AUTOMATION" : transitionPreview.selectionRole === "incoming" ? "SELECT MIX IN WINDOW" : "SELECT MIX OUT WINDOW"}</h2><span>{transitionPreview.outgoingTrack.name} → {transitionPreview.incomingTrack.name}</span></div><div className="transition-preview-head-actions"><button type="button" className={previewMonitor ? "preview-monitor-toggle active" : "preview-monitor-toggle"} aria-pressed={previewMonitor} onClick={toggleTransitionPreviewMonitor}><span className="cdj-icon-bezel"><HeadphoneIcon /></span><b>{previewMonitor ? "PREVIEW MONITOR ON" : "PREVIEW MONITOR OFF"}</b><small>{previewMonitor ? "PREVIEW AUDIO ONLY" : "BOOTH MONITOR MIX"}</small></button><button type="button" className="transition-preview-return" onClick={closeTransitionPreview}>RETURN TO BOOTH</button></div></div>
      {transitionPreview.selectionRole === "outgoing" && <div className="transition-preview-selection">{transitionPreviewCard("outgoing")}</div>}
      {transitionPreview.selectionRole === "incoming" && <div className="transition-preview-selection"><div className="transition-preview-pinned">{transitionPreviewWindowPanel("outgoing")}</div>{transitionPreviewCard("incoming")}</div>}
      {transitionPreview.configurationOpen && <>
      <section className="transition-preview-automation transition-preview-configuration">
        <p className="manual-loop-copy">This is the same flow as the second Mix In point: compare the two exact cropped windows and their grids, choose the bass-swap beat exactly as before, then set the existing X/Y/Z EQ automation.</p>
        <div className="transition-preview-beats"><b>OVERLAP WINDOW</b>{ASSISTED_OVERLAP_BEAT_OPTIONS.map((beats) => <button type="button" key={beats} className={transitionPreview.beats === beats ? "active" : ""} onClick={() => setTransitionPreviewOverlapBeats(beats)}>{beats}</button>)}</div>
      </section>
      <section className="transition-preview-window-comparison">{transitionPreviewWindowPanel("outgoing")}{transitionPreviewWindowPanel("incoming", true)}</section>
      <section className="transition-preview-automation transition-preview-xyz"><AssistedAutomationEditor value={transitionPreview.automation} disabled={transitionPreview.saving} onChange={updateTransitionPreviewAutomation} /></section>
      </>}
      <p className={/NOT ARMED|not armed|could not|failed|outside Crowd|Play past/i.test(transitionPreview.status) ? "transition-preview-status status-shout" : "transition-preview-status"} aria-live="polite">{transitionPreview.status}</p>
      {transitionPreview.configurationOpen && <div className="transition-preview-primary-actions configured">
        <button type="button" onClick={() => editTransitionPreviewWindow("outgoing")}>EDIT MIX OUT<small>PRIVATE COPY</small></button>
        <button type="button" onClick={() => editTransitionPreviewWindow("incoming")}>EDIT MIX IN<small>PRIVATE COPY</small></button>
        {/* REPLICATE lives HERE, with the finished windows and the mix
            audition (DJ, 30 Aug 2026): right-click a block on either
            pinned window above, then the bare verb. */}
        <button type="button" className={transitionPreview.replicate ? "transition-preview-replicate active" : "transition-preview-replicate"} disabled={replicateBusy || !transitionPreview.replicateSelection} onClick={() => { const selection = transitionPreview.replicateSelection; if (selection) void confirmTransitionPreviewReplicate(selection.role); }}>{replicateBusy ? "SPLICING…" : "REPLICATE"}</button>
        {transitionPreview.replicate && <button type="button" className="transition-preview-replicate-clear" onClick={clearTransitionPreviewReplicate}>CLEAR ×{transitionPreview.replicate.plan.copies}</button>}
        {transitionPreview.configurationOpen && <button type="button" className="transition-preview-play-mix" disabled={!transitionPreviewCanCommit(transitionPreview.outgoingWindow, transitionPreview.incomingWindow, transitionPreview.beats)} onClick={() => void playTransitionPreviewMix().catch((error: unknown) => setTransitionPreview((current) => current ? { ...current, status: error instanceof Error ? error.message : "Private transition could not start" } : current))}>{transitionPreview.audition === "mix" ? `PAUSE ${transitionPreview.beats}-BEAT PREVIEW MIX` : `PREVIEW ${transitionPreview.beats}-BEAT MIX`}<small>FULL-WAVE CROWD SIMULATION · STARTS {TRANSITION_PREVIEW_LEAD_BEATS} BEATS BEFORE X · AUTO-OPENS PREVIEW MONITOR</small></button>}
        {transitionPreview.configurationOpen && <button type="button" className="transition-preview-save" disabled={transitionPreview.saving || !transitionPreviewCanCommit(transitionPreview.outgoingWindow, transitionPreview.incomingWindow, transitionPreview.beats)} onClick={() => void saveTransitionPreview()}>{transitionPreview.saving ? "APPLYING…" : "APPLY WINDOWS + AUTOMATION TO LIVE TRACKS"}<small>DOES NOT SEEK OR PAUSE LIVE AUDIO</small></button>}
      </div>}
      <div className="transition-preview-utility-actions"><button type="button" disabled={!transitionPreview.cueHistory.length} onClick={undoTransitionPreviewCue}>UNDO CUE</button><button type="button" onClick={resetTransitionPreviewCues}>RESET CUES</button><button type="button" onClick={closeTransitionPreview}>RETURN TO BOOTH</button></div>
    </section></div>}
    {replayPickerOpen && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReplayPickerOpen(false); }}><section className="settings-panel replay-picker-panel" role="dialog" aria-modal="true" aria-labelledby="crowd-replay-title">
      <div className="settings-panel-head"><div><p className="eyebrow">RECORDED SETS</p><h2 id="crowd-replay-title">REPLAY INPUTS</h2></div><button type="button" onClick={() => setReplayPickerOpen(false)}>CLOSE</button></div>
      <p className="replay-picker-status">{recStatus || "Pick a set and the booth re-performs it — your loads, faders, EQ, tempo and stabs, on your schedule."}</p>
      <div className="replay-picker-actions">
        <button type="button" disabled={replaySetsLoading} onClick={() => void refreshReplaySets()}>{replaySetsLoading ? "READING…" : "REFRESH"}</button>
        <label className="replay-picker-file">OPEN SET FILE…<input type="file" accept=".json,application/json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void replaySetFromDisk(file); }} /></label>
        {isReplaying() && <button type="button" className="replay-picker-stop" onClick={() => { stopReplay(); setRecStatus("Replay stopped"); }}>STOP REPLAY</button>}
      </div>
      <div className="replay-picker-list">
        {!replaySets.length && !replaySetsLoading && <p className="replay-picker-empty">No sets recorded yet — hit ● RECORD INPUTS before your next mix and this list fills up.</p>}
        {replaySets.map((set) => <div className="replay-picker-row" key={set.id}>
          <div className="replay-picker-row-body">
            <b>{set.recordedAt ? new Date(set.recordedAt).toLocaleString() : set.id}</b>
            <small>{[`${set.actions} actions`, set.durationMs ? setLengthLabel(set.durationMs) : null, set.artefacts["mp3"] ? `${Math.max(1, Math.round(set.artefacts["mp3"] / 1048576))} MB mp3` : set.artefacts["webm"] ? "audio transcoding…" : "no audio"].filter(Boolean).join(" · ")}</small>
            {set.tracks.length > 0 && <small className="replay-picker-tunes">{set.tracks.join(" → ")}</small>}
          </div>
          <div className="replay-picker-row-actions">
            {Boolean(set.artefacts["mp3"]) && <a href={`/api/set-recordings?id=${encodeURIComponent(set.id)}&kind=audio&format=mp3`} target="_blank" rel="noreferrer">AUDIO</a>}
            <button type="button" disabled={!set.actions} onClick={() => replaySavedSet(set.id)}>REPLAY</button>
          </div>
        </div>)}
      </div>
    </section></div>}
    {settingsOpen && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="crowd-settings-title">
      <div className="settings-panel-head"><div><p className="eyebrow">LOUD</p><h2 id="crowd-settings-title">SETTINGS</h2></div><button type="button" onClick={() => setSettingsOpen(false)}>CLOSE</button></div>

      <div className="settings-controller-wizards"><button type="button" onClick={() => { setSettingsOpen(false); setAudioSetupOpen(true); }}>AUDIO OUTPUT SETUP</button><button type="button" onClick={() => { setSettingsOpen(false); setControlSetupMode("hotkeys"); }}>HOTKEY SETUP WIZARD</button><button type="button" onClick={() => { setSettingsOpen(false); setControlSetupMode("midi"); }}>MIDI CONTROLLER WIZARD</button></div>
      <section className="settings-control-help" aria-label="Control explanations"><label><input type="checkbox" checked={controlHelp.preferences.enabled} onChange={(event) => controlHelp.setEnabled(event.target.checked)} /><span><b>CONTROL EXPLANATIONS</b><small>Show a help bubble after hovering for a moment.</small></span></label><button type="button" onClick={controlHelp.reset}>RESTORE DISMISSED TIPS</button></section>
      <div className="visual-direction-console settings-visual-direction" aria-label="Booth visual direction">
        <div><b>VISUAL DIRECTION</b><span>LIVE BOOTH SKIN</span></div>
        <div>{BOOTH_VISUAL_DIRECTIONS.map((direction) => <button key={direction.id} className={visualDirection === direction.id ? "active" : ""} aria-pressed={visualDirection === direction.id} title={`${direction.label}: ${direction.description}`} onClick={() => setVisualDirection(direction.id)}><b>{direction.shortLabel}</b><small>{direction.label}</small></button>)}</div>
      </div>
      <label className="settings-master-volume">
        <div><b>MASTER LEVEL</b><span>{Math.round(masterVolume * 100)}%</span></div>
        <input type="range" min={0} max={1} step={.01} value={masterVolume} aria-label="Master output level" onChange={(event) => { void setMaster(Number(event.currentTarget.value)); }} />
      </label>
    </section></div>}
    <div className="booth-frame">
    <section className="performance-command-deck" aria-label="Assisted-set primary workflow">
      <div className="workflow-deck-switcher" aria-label="Select the deck whose track flow is shown">
        <div><b>TRACK FLOW</b><span>SELECT DECK</span></div>
        <div>{DECK_IDS.map((id) => {
          const stage = workflowStageForDeck(id);
          const bpm = decks[id].track && decks[id].analysis ? bpmAt(decks[id]) * decks[id].tempoRate : 0;
          const style = { "--workflow-stage-colour": WORKFLOW_STAGE_COLOURS[stage] } as CSSProperties;
          const deckDescription = decks[id].track
            ? bpm > 0 ? `${decks[id].track.name}, ${bpm.toFixed(3)} BPM` : `${decks[id].track.name}, analysis pending`
            : "empty";
          return <button type="button" key={id} style={style} className={`workflow-deck workflow-deck-${id.toLowerCase()} workflow-deck-stage-${stage} ${workflowDeck === id ? "active" : ""}`} aria-label={`Deck ${id}, ${deckDescription}, ${stage} stage`} aria-pressed={workflowDeck === id} onClick={() => setWorkflowDeck(id)}><span>{id}</span><b>{bpm > 0 ? `${bpm.toFixed(3)} BPM` : ""}</b></button>;
        })}</div>
      </div>
      <div className="workflow-rail" aria-label="Track load stage">
        {workflowStages.map((stage, index) => {
          const complete = index < workflowStageIndex;
          const active = index === workflowStageIndex;
          if (stage.id === "load") {
            const stateClass = active ? "active" : complete ? "complete" : "waiting";
            return <div className={`workflow-load-action-stack ${stateClass}`} key={stage.id}>
              <button type="button" className={`workflow-stage workflow-stage-load ${stateClass} workflow-stage-action workflow-manual-load`} aria-current={active ? "step" : undefined} onClick={() => openLocalFile(workflowDeck)}><span>{complete ? "✓" : index + 1}</span><div><b>Load</b></div></button>
              <button type="button" className="workflow-stage workflow-stage-load workflow-stage-action workflow-autoselect" disabled title="Autoselect (Coming soon)"><span>↻</span><div><b>Autoselect <small>(Coming soon)</small></b></div></button>
            </div>;
          }
        })}
      </div>
      <nav className="workflow-booth-tools" aria-label="Booth master controls">
        <label className="booth-master-volume" title="Master output level — house mix and LoudLink; independent headphones have their own level">
          <b>MASTER<span>{Math.round(masterVolume * 100)}%</span></b>
          <input type="range" min={0} max={1} step={.01} value={masterVolume} aria-label="Master output level" onChange={(event) => { void setMaster(Number(event.currentTarget.value)); }} />
        </label>
        <button className={headphoneMonitor && !independentOutputs(outputConfig) ? "header-cue-monitor active" : "header-cue-monitor"} disabled={independentOutputs(outputConfig)} title={independentOutputs(outputConfig) ? "Dedicated headphone output: deck cue buttons feed headphones automatically; Private Preview temporarily replaces that feed." : "Switch the shared local output between master and headphone cue"} aria-pressed={independentOutputs(outputConfig) || headphoneMonitor} onClick={toggleHeadphoneMonitor}><span className="cdj-icon-bezel"><HeadphoneIcon /></span><b>{independentOutputs(outputConfig) ? "CUE · HARDWARE" : headphoneMonitor ? "CUE MONITOR ON" : "CUE MONITOR OFF"}</b></button>
        <button type="button" className="crowd-qr-toggle" disabled={!crowdQrMarkup} onClick={() => setCrowdQrOpen(true)} aria-label="Enlarge Loudlink QR code" title={crowdQrMarkup ? `Show QR for ${crowdPhoneUrl}` : "Waiting for the LAN crowd URL"}>{crowdQrMarkup ? <span className="crowd-qr-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: crowdQrMarkup }} /> : <span>QR</span>}<small>SCAN TO JOIN</small></button>
        <button type="button" className={recActive ? "header-cue-monitor active" : "header-cue-monitor"} aria-pressed={recActive} onClick={() => {
          if (isRecording()) {
            void stopRecording().then((result) => { setRecActive(false); setRecStatus(result ? `saved ${result.id} · ${result.actions} actions · ${Math.round(result.audioBytes / 1048576)} MB audio → WAV/MP3` : "nothing was recording"); });
          } else {
            void ensureGraph("A").catch(() => undefined).then(() => { const id = startRecording(recordTap.current); setRecActive(true); setRecStatus(`REC ${id}`); });
          }
        }}>{recActive ? "■ STOP" : "● RECORD INPUTS"}</button>
        <button type="button" className={isReplaying() ? "header-cue-monitor active" : "header-cue-monitor"} onClick={openReplayPicker}>REPLAY INPUTS</button>
        <button type="button" className={gridSnap ? "header-cue-monitor active" : "header-cue-monitor"} aria-pressed={gridSnap} onClick={() => setGridSnap((on) => !on)}>SNAP TO GRID</button>
        <button type="button" className="workflow-runway-preview" disabled={!transitionPreviewPair || Boolean(transitionPreview)} onClick={openTransitionPreview}>PRIVATE PREVIEW</button>
        <button type="button" className="brand-mark brand-settings-button" aria-label="Open Loud settings menu" title="SETTINGS" onClick={() => setSettingsOpen(true)}><span className="brand-settings-monogram">LOUD</span><span className="brand-settings-menu" aria-hidden="true"><i /><i /><i /></span></button>
      </nav>
    </section>
    {gridCheckOpen && <div className="cue-review-overlay" role="dialog" aria-label="Beat grid check">
      <section className="cue-review-panel">
        <header>
          <div><small>GRID CHECK · TEMPORARY</small><b>Does the tick land on the kick, or flam against it?</b></div>
          <button type="button" onClick={closeGridCheck}>CLOSE</button>
        </header>
        {(() => {
          const outcome = gridCheckOutcome(gridCheckItems, gridCheckVerdicts);
          return <div className="cue-review-progress">
            <span>JUDGED <b>{outcome.judged}</b></span>
            <span>FLAGGED · CLEAN <b>{outcome.suspectClean}</b></span>
            <span>FLAGGED · FLAM <b>{outcome.suspectFlam}</b></span>
            <span>OF <b>{gridCheckItems.length}</b></span>
          </div>;
        })()}
        {gridCheckCurrent ? <div className="cue-review-card">
          <div className="cue-review-track">
            <b>{gridCheckCurrent.name}</b>
            {/* Which grid is ticking has to be on screen: a verdict is only
                meaningful if it is clear what was judged, and a stem grid can
                disagree with the stored one by a whole tempo. */}
            {gridCheckCurrent.source === "kickgrid"
              ? <span><b className="cue-review-source">GRID FROM KICKS</b> · {(gridCheckCurrent.gridBpm ?? 0).toFixed(3)} BPM fitted to {gridCheckCurrent.kickBeats?.length ?? 0} detected kicks
                {typeof gridCheckCurrent.explains === "number" ? ` · lands on ${(gridCheckCurrent.explains * 100).toFixed(0)}% of them` : ""}
                {gridCheckCurrent.bpm > 0 ? ` · stored says ${gridCheckCurrent.bpm.toFixed(2)}` : ""} — does every tick sit on a kick, all the way through?</span>
              : gridCheckCurrent.source === "kicks"
              ? <span><b className="cue-review-source">DETECTED KICKS</b> · {gridCheckCurrent.beats.length} hits found in the drum stem, no grid and no tempo
                {gridCheckCurrent.gridBpm ? ` · their spacing implies ${gridCheckCurrent.gridBpm.toFixed(2)}` : ""} — is there a tick on every kick, and no tick anywhere else?</span>
              : gridCheckCurrent.source === "stem"
                ? <span><b className="cue-review-source">FROM DRUMS ONLY</b> · {(gridCheckCurrent.gridBpm ?? 0).toFixed(2)} BPM fitted to the kick stem
                  {gridCheckCurrent.bpm > 0 ? ` · stored grid says ${gridCheckCurrent.bpm.toFixed(2)}` : ""} — does the tick sit on the kick?</span>
                : <span>{gridCheckCurrent.bpm > 0 ? `${gridCheckCurrent.bpm.toFixed(2)} BPM · ` : ""}
                  the tune&apos;s own grid — does the tick sit on the kick?</span>}
          </div>
          <div className="cue-review-ab">
            <button type="button" className="cue-review-replay" onClick={() => void playGridCheck(gridCheckCurrent, 0)}>
              {gridCheckCurrent.source === "kickgrid" ? "PLAY GRID" : "PLAY CURRENT"}
              <small>{gridCheckCurrent.source === "kickgrid" ? "FITTED TO THE KICKS" : "GRID AS IT IS"}</small>
            </button>
            {/* The A/B: same audio, same window, ticks on the raw kicks instead of
                the grid. A grid that sounds as good as the kicks it came from is a
                good grid; one that drifts where the kicks do not is not. */}
            {gridCheckCurrent.kickBeats?.length ? <button type="button" className="cue-review-replay" onClick={() => void playGridCheck(gridCheckCurrent, 0, gridCheckCurrent.kickBeats)}>
              PLAY KICKS<small>EVERY DETECTED HIT</small>
            </button> : null}
            {/* Move the ticks earlier or later against the same audio. If one value
                fuses every track, the delay is playback latency and belongs in the
                scheduler, not in the grid. */}
            {[-20, -12, -6, 0, 6].map((nudge) => <button
              key={`nudge-${nudge}`}
              type="button"
              className={gridCheckNudgeMs === nudge ? "cue-review-proposed" : "cue-review-replay"}
              onClick={() => { setGridCheckNudgeMs(nudge); void playGridCheck(gridCheckCurrent, 0, undefined, nudge); }}
            >
              {nudge > 0 ? `+${nudge}` : nudge}ms
              <small>{nudge === 0 ? "AS FITTED" : nudge < 0 ? "TICK EARLIER" : "TICK LATER"}</small>
            </button>)}
            <button type="button" className="cue-review-proposed" disabled={!gridCheckOffset} onClick={() => gridCheckOffset && void playGridCheck(gridCheckCurrent, gridCheckOffset.shiftMs)}>
              PLAY PROPOSED
              <small>{gridCheckOffset
                ? `${gridCheckOffset.shiftMs >= 0 ? "+" : ""}${gridCheckOffset.shiftMs.toFixed(0)}ms${gridCheckOffset.confident ? "" : " · ambiguous"}`
                : "measuring…"}</small>
            </button>
          </div>
          {gridCheckOffset && !gridCheckOffset.confident ? <p className="cue-review-status">
            The low end here supports more than one phase{gridCheckOffset.rivalShiftMs !== null ? ` — ${gridCheckOffset.shiftMs.toFixed(0)}ms and ${gridCheckOffset.rivalShiftMs.toFixed(0)}ms score alike` : ""}. Trust your ear over the number.
          </p> : null}
          <div className="cue-review-actions">
            <button type="button" className="cue-review-keep" onClick={() => void decideGridCheck("clean")}>CLEAN<small>TICK ON THE KICK</small></button>
            <button type="button" className="cue-review-drop" onClick={() => void decideGridCheck("flam")}>FLAM<small>GRID IS OFF</small></button>
            <button type="button" className="cue-review-skip" onClick={() => void decideGridCheck("unsure")}>SKIP<small>CANNOT TELL</small></button>
            <button type="button" className="cue-review-close" onClick={closeGridCheck}>DONE<small>STOP AND CLOSE</small></button>
          </div>
        </div> : <p className="cue-review-empty">{gridCheckStatus || "Nothing left to check."}</p>}
        {(() => {
          const outcome = gridCheckOutcome(gridCheckItems, gridCheckVerdicts);
          return outcome.metricLooksWrong
            ? <p className="cue-review-status">Every flagged grid so far sounds clean. That is the answer: the metric is not measuring anything audible.</p>
            : null;
        })()}
        {gridCheckCurrent && gridCheckStatus ? <p className="cue-review-status">{gridCheckStatus}</p> : null}
        <audio ref={gridCheckAudio} preload="none" />
      </section>
    </div>}
    <section ref={waveformFocusRef} className="waveform-focus">
      <div className="crowd-reaction-layer" aria-live="polite" aria-label="Live crowd reactions">{crowdReactions.map((reaction) => <span key={reaction.id} className="crowd-reaction-bubble" style={{ left: `${reaction.left}%`, "--crowd-drift": `${reaction.drift}px` } as CSSProperties}>{reaction.emoji}</span>)}</div>
      {DECK_IDS.map((id) => {
        const audioRef = id === "A" ? audioA : id === "B" ? audioB : audioC;
        const shadowAudioRef = id === "A" ? shadowAudioA : id === "B" ? shadowAudioB : shadowAudioC;
        const deckCues = cuesFor(id);
        const referenceDeck = decks[syncReferenceFor(id)];
        return <div className={`focus-lane focus-${id.toLowerCase()}`} key={`moving-${id}`}><div className="focus-moving-body"><MovingWave id={id} deck={decks[id]} spectrumSource={() => { const graph = graphs.current[id]; return graph ? { analyser: graph.spectrum, playing: Boolean(activeAudio(id) && !activeAudio(id)!.paused) } : null; }} audio={activeAudio(id)} cues={deckCues} phaseStatus={comparePhase(decks[id], referenceDeck)} loadStatus={loopTeachingStatus[id]} load={deckLoads[id]} windowSeconds={focusWindowSeconds[id]} onWindowChange={(seconds) => setFocusWindowSeconds((current) => ({ ...current, [id]: seconds }))} onTime={(currentTime) => changeDeck(id, { currentTime })} onScrubChange={(scrubbing) => { waveformScrubbing.current[id] = scrubbing; }} onScrubAudio={(command) => sendScrubAudio(id, command)} snapOnCommit={(time) => snapToGrid(id, time)} /><FocusWaveTransport id={id} deck={decks[id]} audioRef={audioRef} shadowAudioRef={shadowAudioRef} mediaDuration={deckLoads[id]?.trackId === decks[id].track?.id ? deckLoads[id]?.audio.duration ?? null : null} onMediaState={(media, kind) => noteDeckMedia(id, media, kind)} cues={deckCues} overviewZoom={overviewZoom[id]} focusWindowSeconds={focusWindowSeconds[id]} canBeatSync={Boolean(decks[id].analysis?.beats.length)} canTempoSync={Boolean(bpmAt(decks[id]) && bpmAt(referenceDeck))} onOverviewZoomChange={(zoom) => setOverviewZoom((current) => ({ ...current, [id]: zoom }))} onFocusWindowChange={(seconds) => setFocusWindowSeconds((current) => ({ ...current, [id]: seconds }))} onSeek={(time) => seek(id, time)} onCueToggle={() => toggleCue(id)} onTempoStep={(direction, deltaBpm) => stepTempo(id, direction, deltaBpm)} onWarm={() => { void ensureGraph(id); }} onReturnToCue={() => returnToCue(id)} onToggle={() => void toggle(id)} onPlayCueStart={() => void startPlayCue(id)} onPlayCueEnd={() => endPlayCue(id)} onLoad={() => openLocalFile(id)} onUnload={() => unloadTrack(id)} onChange={(patch) => changeDeckFromBooth(id, patch)} onBend={(direction) => bend(id, direction)} onTempoSync={() => syncTempo(id)} onBeatSync={() => syncBeat(id)} onLoopToggle={() => toggleLoop(id)} onLoopSize={(size) => setLoopSize(id, size)} onLoopMove={(direction) => moveLoop(id, direction)} /></div></div>;
      })}
    </section>
    </div>
    <input ref={fileInput} type="file" hidden accept=".mp3,.wav,.flac,.m4a,.mp4,.aiff,.aif,.ogg,.ape,audio/*" onChange={(event) => void loadLocalFile(event)} />
    {picker && <div className="track-picker" role="dialog" aria-modal="true" aria-label={`Load Deck ${picker}`}><div>
      <div className="picker-head"><h2>LOAD DECK {picker}</h2><div className="picker-actions">
        <button type="button" disabled={Boolean(pickerLoadingTrackId)} onClick={() => openLocalFile(picker)}>IMPORT AUDIO FILE</button>
        <button type="button" onClick={() => setPicker(null)}>CLOSE</button>
      </div></div>
      <label className="picker-search">SEARCH THE WHOLE LIBRARY<input autoFocus value={pickerSearch} disabled={Boolean(pickerLoadingTrackId)} onChange={(event) => setPickerSearch(event.target.value)} placeholder="Track, artist, album or filename" /></label>
      <p className="picker-count">{matchingPickerTracks.length.toLocaleString()} loadable tune{matchingPickerTracks.length === 1 ? "" : "s"}{matchingPickerTracks.length > visiblePickerTracks.length ? ` · showing first ${visiblePickerTracks.length}` : ""}</p>
      {visiblePickerTracks.length ? visiblePickerTracks.map((track) => <button type="button" className="track-choice" key={track.id} disabled={Boolean(pickerLoadingTrackId)} onClick={() => void loadPickedTrack(picker, track)}><b>{track.name}</b><span>{pickerLoadingTrackId === track.id ? "LOADING…" : "Loads now · waveform + BPM follow"}</span></button>) : <div className="no-mapped"><p>{tracks.length ? "No tune matches that search." : "The library is still connecting. Close and reopen this picker in a moment if it stays empty."}</p>{!tracks.length && <Link href="/">OPEN LIBRARY</Link>}</div>}
    </div></div>}
    {manualLoopDialog && <div className="track-picker manual-loop-dialog" role="dialog" aria-modal="true" aria-label={`Teach manual transition window on Deck ${manualLoopDialog.deck}`}><div>
      <div className="picker-head"><div><p className="eyebrow">TEACH CROWD · DECK {manualLoopDialog.deck}</p><h3>{manualLoopDialog.configurationOnly ? "Config Mix" : mixInAutomationDialog ? "Confirm Mix In + mix automation" : "Confirm this manual window"}</h3></div><button type="button" disabled={manualLoopSaving} onClick={() => setManualLoopDialog(null)}>CANCEL</button></div>
      <p className="manual-loop-copy">{manualLoopDialog.configurationOnly ? <>Editing the automation attached to the most recently saved Mix In for <b>{manualLoopDialog.trackName}</b>. Its saved points at <b>{manualLoopDialog.start.toFixed(3)}s</b> and <b>{manualLoopDialog.end.toFixed(3)}s</b> will not move; its confirmed beat count and authoritative BPM stay fixed.</> : <>{manualLoopDialog.purpose === "intro-loop" ? <>The incoming run-up starts at <b>{manualLoopDialog.start.toFixed(3)}s</b> and reaches its shared endpoint at <b>{manualLoopDialog.end.toFixed(3)}s</b> in {manualLoopDialog.trackName}.</> : <>The outgoing run-up starts at <b>{manualLoopDialog.start.toFixed(3)}s</b> and reaches its shared endpoint at <b>{manualLoopDialog.end.toFixed(3)}s</b> in {manualLoopDialog.trackName}.</>} Crowd makes the two selected window ends land together. Your confirmed beat count across this exact elapsed time becomes the authoritative BPM and grid.{mixInAutomationDialog && <> Select Y as the bass cue beat. The low EQs sweep between 25% and 75% through the beat immediately before it, while X/Y/Z drives the mid/high curve.</>}</>}</p>
      <div className="manual-loop-presets">{manualLoopBeatChoices.map((beats) => <button type="button" key={beats} disabled={manualLoopDialog.configurationOnly || manualLoopSaving} className={manualLoopDialog.beats === beats ? "active" : ""} onClick={() => updateManualLoopBeatCount(beats)}>{beats}</button>)}</div>
      <label className="manual-loop-beats">BEAT COUNT<input disabled={manualLoopDialog.configurationOnly || manualLoopSaving} type="number" min="1" max="512" step="1" value={manualLoopDialog.beats} onChange={(event) => updateManualLoopBeatCount(Number(event.target.value))} /></label>
      <div className="manual-loop-question"><b>{manualLoopDialog.purpose === "intro-loop" ? "INCOMING RUN-UP" : "OUTGOING RUN-UP"}</b><span>The front edge starts this tune's selected run-up. The back edge is the shared handoff: it will land at the same wall-clock moment as the other tune's window end.</span><div><span className="manual-loop-marker active">RUN-UP · START<small>{preciseTimeLabel(manualLoopDialog.start)}</small></span><span className="manual-loop-marker active">SHARED · END<small>{preciseTimeLabel(manualLoopDialog.end)}</small></span></div></div>
      <RunupGridMapper
        analysis={decks[manualLoopDialog.deck].analysis}
        start={manualLoopDialog.start}
        end={manualLoopDialog.end}
        beats={manualLoopDialog.beats}
        crowdBpm={manualLoopDialog.crowdBpm}
        automation={mixInAutomationDialog ? manualLoopAutomation : undefined}
        onAutomationChange={mixInAutomationDialog ? (automation) => setManualLoopDialog((current) => current ? { ...current, automation } : current) : undefined}
      />
      {mixInAutomationDialog && <AssistedAutomationEditor value={manualLoopAutomation} disabled={manualLoopSaving} onChange={(automation) => setManualLoopDialog((current) => current ? { ...current, automation } : current)} />}
      <button type="button" className="save-manual-loop" disabled={manualLoopSaving || !Number.isInteger(manualLoopDialog.beats) || manualLoopDialog.beats < 1 || manualLoopDialog.beats > 512 || Boolean((assistedManualLoopDialog || mixInAutomationDialog) && !isAssistedOverlapBeats(manualLoopDialog.beats))} onClick={() => void saveManualLoopSafely()}>{manualLoopSaving ? "SAVING…" : manualLoopDialog.configurationOnly ? "SAVE MIX AUTOMATION" : mixInAutomationDialog ? "SAVE MIX IN, GRID & MIX AUTOMATION" : "SAVE RUN-UP, GRID & LEARN"}</button>
    </div></div>}
  </main></HotkeyContext.Provider>;
}

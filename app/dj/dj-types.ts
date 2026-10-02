import type { DemoAnalysis, DemoCuePoint } from "../../lib/demo-set";
import type { LoadProgressSnapshot } from "../../lib/load-progress";
import type { AnalysisTeaching } from "../../lib/teaching";

export type DeckId = "A" | "B" | "C";

/**
 * The legacy summary of a mapping job. The real, structured progress travels
 * beside it as Track.loadProgress (lib/load-progress.ts); nothing here is an
 * estimate or a step scale any more.
 */
export type MappingJob = {
  jobId?: string;
  attempt?: number;
  state: "running" | "complete" | "error";
  stage: string;
  detail: string;
  startedAt: number;
  stageStartedAt?: number;
  error?: string;
};

export type TrackIntelligence = {
  bpm: number | null;
  bpmConfidence: number | null;
  bpmSource: "quick-scan" | "full-map" | null;
  bpmScannedAt: string | null;
  fullScannedAt: string | null;
  selectedCount: number;
  playedCount: number;
  rejectedCount: number;
  incompatibleCount: number;
};

export type Track = {
  id: string;
  name: string;
  file: string;
  duration: number;
  album: string;
  source: "built-in" | "elements" | "uploaded";
  mapped: boolean;
  audio: string;
  analysis: string;
  job?: MappingJob | null;
  /** Single-track GET only: the latest mapping job's real stages and steps, with the server clock. */
  loadProgress?: LoadProgressSnapshot | null;
  intelligence?: TrackIntelligence | null;
};

export type Beat = {
  beat: number;
  time: number;
  isDownbeat: boolean;
  confidence: number;
  isPhraseStart?: boolean;
  phraseIndex?: number | null;
  phraseConfidence?: number;
  attackTime?: number | null;
  kickStatus?: "aligned" | "early" | "late" | "inferred" | "ambiguous";
  auditOffsetMs?: number | null;
};

export type VerificationBlock = {
  start: number;
  end: number;
  status: "verified" | "review" | "no-evidence";
  evidenceCoverage: number;
  failureReason?: string;
};

export type Analysis = Omit<DemoAnalysis, "beats" | "teaching"> & {
  beats: Beat[];
  lowWaveform: number[];
  kickWaveformDetailed?: number[];
  /**
   * Display-only full-mix waves (DJ, 30 Aug 2026): painted as the
   * analyser's LAST step from the FULL MIX, purely so the booth can draw
   * the whole tune. No calculation may read these — evidence consumers
   * stay on the stem-fed arrays.
   */
  displayLowWaveformDetailed?: number[];
  displayLowWaveform?: number[];
  selected?: { bpm: number; probability?: number; [key: string]: unknown };
  hypotheses?: Array<{ bpm: number; probability?: number; metricalRelation?: string; [key: string]: unknown }>;
  teaching?: AnalysisTeaching;
  verification?: {
    blocks: VerificationBlock[];
    verifiedBeatCoverage?: number;
    verifiedBlocks?: number;
    reviewBlocks?: number;
    noEvidenceBlocks?: number;
    status?: string;
  };
};

export type Cue = DemoCuePoint;
export type FxType = "none" | "echo" | "reverb" | "phaser" | "drive";
export type LoopSize = number;
export type PhaseStatus = "ahead" | "behind" | "synced" | "uncompared";

export type DeckState = {
  track: Track | null;
  analysis: Analysis | null;
  currentTime: number;
  playing: boolean;
  cuePreviewing: boolean;
  tempoRate: number;
  cuePoint: number | null;
  loopSize: LoopSize;
  loopStart: number | null;
  loopEnd: number | null;
  loopActive: boolean;
  cue: boolean;
  volume: number;
  low: number;
  mid: number;
  high: number;
  fx: FxType;
  wet: number;
};

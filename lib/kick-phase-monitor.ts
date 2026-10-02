export type KickEvidenceBeat = {
  beat: number;
  time: number;
  attackTime?: number | null;
  confidence?: number;
  isDownbeat?: boolean;
  kickStatus?: "aligned" | "early" | "late" | "inferred" | "ambiguous";
};

export type KickDeckClock = {
  currentTime: number;
  playbackRate: number;
  beats: KickEvidenceBeat[];
};

export type KickPairObservation = {
  pairKey: string;
  outgoingBeat: number;
  incomingBeat: number;
  outgoingAttackTime: number;
  incomingAttackTime: number;
  offsetMs: number;
  confidence: number;
};

export type KickPhaseSample = KickPairObservation;

export type KickPhaseMonitorState = {
  lastPairKey: string | null;
  samples: KickPhaseSample[];
};

export type KickPhaseStatus =
  | "waiting"
  | "measuring"
  | "aligned"
  | "incoming-early"
  | "incoming-late"
  | "drifting"
  | "unstable";

export type KickPhaseReport = {
  status: KickPhaseStatus;
  sampleCount: number;
  offsetMs: number | null;
  latestOffsetMs?: number | null;
  jitterMs: number | null;
  driftMsPer16Beats: number | null;
  confidence: number;
};

const MAX_PAIR_SEPARATION_SECONDS = .14;
const EVIDENCE_WINDOW_SECONDS = .72;
const MAX_HISTORY = 24;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function kickCandidates(clock: KickDeckClock) {
  const rate = Math.max(.25, Math.abs(clock.playbackRate) || 1);
  return clock.beats.flatMap((beat) => {
    if (!Number.isFinite(beat.attackTime)) return [];
    if (beat.kickStatus === "inferred" || beat.kickStatus === "ambiguous") return [];
    const wallOffset = (Number(beat.attackTime) - clock.currentTime) / rate;
    if (Math.abs(wallOffset) > EVIDENCE_WINDOW_SECONDS) return [];
    const confidence = clamp(Number(beat.confidence) || .35, .08, 1);
    return [{ beat, attackTime: Number(beat.attackTime), wallOffset, confidence }];
  });
}

/**
 * Compares the analysed audible kick attacks nearest the two live playheads.
 * Positive offset means the incoming kick will arrive after the outgoing kick.
 */
export function observeKickAgainstKick(outgoing: KickDeckClock, incoming: KickDeckClock): KickPairObservation | null {
  const outgoingKicks = kickCandidates(outgoing);
  const incomingKicks = kickCandidates(incoming);
  const pairs = outgoingKicks.flatMap((outgoingKick) => incomingKicks.flatMap((incomingKick) => {
    const separation = incomingKick.wallOffset - outgoingKick.wallOffset;
    if (Math.abs(separation) > MAX_PAIR_SEPARATION_SECONDS) return [];
    const centreDistance = Math.abs((incomingKick.wallOffset + outgoingKick.wallOffset) / 2);
    const downbeatMismatch = outgoingKick.beat.isDownbeat === incomingKick.beat.isDownbeat ? 0 : .025;
    const score = Math.abs(separation) + centreDistance * .12 + downbeatMismatch;
    return [{
      score,
      observation: {
        pairKey: `${outgoingKick.beat.beat}:${incomingKick.beat.beat}`,
        outgoingBeat: outgoingKick.beat.beat,
        incomingBeat: incomingKick.beat.beat,
        outgoingAttackTime: outgoingKick.attackTime,
        incomingAttackTime: incomingKick.attackTime,
        offsetMs: separation * 1000,
        confidence: Math.sqrt(outgoingKick.confidence * incomingKick.confidence),
      },
    }];
  }));
  return pairs.sort((left, right) => left.score - right.score)[0]?.observation ?? null;
}

export function emptyKickPhaseMonitor(): KickPhaseMonitorState {
  return { lastPairKey: null, samples: [] };
}

function reportFromSamples(samples: KickPhaseSample[]): KickPhaseReport {
  if (!samples.length) {
    return { status: "waiting", sampleCount: 0, offsetMs: null, latestOffsetMs: null, jitterMs: null, driftMsPer16Beats: null, confidence: 0 };
  }
  const offsets = samples.map((sample) => sample.offsetMs);
  const offsetMs = median(offsets);
  const jitterMs = median(offsets.map((offset) => Math.abs(offset - offsetMs)));
  const confidence = median(samples.map((sample) => sample.confidence));
  const firstBeat = samples[0].outgoingBeat;
  const points = samples.map((sample) => ({ x: sample.outgoingBeat - firstBeat, y: sample.offsetMs }));
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  const slopeMsPerBeat = denominator > 0
    ? points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator
    : 0;
  const beatSpan = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
  const driftMsPer16Beats = beatSpan >= 8 ? slopeMsPerBeat * 16 : null;
  const status: KickPhaseStatus = samples.length < 2
    ? "measuring"
    : confidence < .22 || jitterMs > 28
      ? "unstable"
      : driftMsPer16Beats !== null && Math.abs(driftMsPer16Beats) > 18
        ? "drifting"
        : Math.abs(offsetMs) <= 15
          ? "aligned"
          : offsetMs > 0 ? "incoming-late" : "incoming-early";
  return { status, sampleCount: samples.length, offsetMs, latestOffsetMs: samples.at(-1)?.offsetMs ?? null, jitterMs, driftMsPer16Beats, confidence };
}

export function updateKickPhaseMonitor(state: KickPhaseMonitorState, observation: KickPairObservation | null) {
  if (!observation || observation.pairKey === state.lastPairKey) {
    return { state, report: reportFromSamples(state.samples) };
  }
  const samples = [...state.samples, observation].slice(-MAX_HISTORY);
  const nextState = { lastPairKey: observation.pairKey, samples };
  return { state: nextState, report: reportFromSamples(samples) };
}

export function kickPhaseReportLabel(report: KickPhaseReport) {
  const offset = report.offsetMs === null ? null : Math.round(Math.abs(report.offsetMs));
  if (report.status === "waiting") return "KICKS · WAITING FOR SHARED ATTACKS";
  if (report.status === "measuring") return `KICKS · MEASURING${offset === null ? "" : ` · ${offset} MS`}`;
  if (report.status === "aligned") return `KICKS LOCKED · ${offset} MS · ${report.sampleCount} HITS`;
  if (report.status === "incoming-early") return `KICK FLAM · INCOMING ${offset} MS EARLY`;
  if (report.status === "incoming-late") return `KICK FLAM · INCOMING ${offset} MS LATE`;
  if (report.status === "drifting") {
    const drift = Math.round(report.driftMsPer16Beats ?? 0);
    return `KICK DRIFT · ${drift >= 0 ? "+" : ""}${drift} MS / 16 BEATS`;
  }
  return `KICKS UNSTABLE · ${Math.round(report.jitterMs ?? 0)} MS JITTER`;
}

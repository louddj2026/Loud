export type RunupGridBeat = {
  time: number;
  isDownbeat: boolean;
  kickStatus?: "aligned" | "early" | "late" | "inferred" | "ambiguous";
};

export type RunupGridVerificationBlock = {
  start: number;
  end: number;
  status: "verified" | "review" | "no-evidence";
  evidenceCoverage?: number;
};

export type RunupGridInput = {
  start: number;
  end: number;
  beats: number;
  crowdBpm: number;
  grid: RunupGridBeat[];
  verification?: RunupGridVerificationBlock[];
  hypotheses?: Array<{ bpm: number; probability?: number; metricalRelation?: string }>;
};

const nearestOffsetMs = (grid: RunupGridBeat[], time: number) => {
  if (!grid.length) return null;
  const nearest = grid.reduce((best, beat) => Math.abs(beat.time - time) < Math.abs(best.time - time) ? beat : best);
  return Math.round((time - nearest.time) * 1000);
};

export function runupGridDiagnostics(input: RunupGridInput) {
  const span = Math.max(.001, input.end - input.start);
  const manualBpm = input.beats * 60 / span;
  const windowGrid = input.grid.filter((beat) => beat.time >= input.start && beat.time <= input.end);
  const overlappingVerification = (input.verification ?? []).filter((block) => block.end >= input.start && block.start <= input.end);
  const verificationStatus = overlappingVerification.some((block) => block.status === "review")
    ? "review"
    : overlappingVerification.some((block) => block.status === "no-evidence")
      ? "no-evidence"
      : overlappingVerification.length
        ? "verified"
        : "unavailable";
  const verificationCoverage = overlappingVerification.length
    ? overlappingVerification.reduce((sum, block) => sum + Number(block.evidenceCoverage ?? 0), 0) / overlappingVerification.length
    : null;
  const hypotheses = (input.hypotheses ?? [])
    .filter((hypothesis) => Number.isFinite(hypothesis.bpm) && hypothesis.bpm > 0)
    .filter((hypothesis, index, list) => list.findIndex((candidate) => Math.abs(candidate.bpm - hypothesis.bpm) < .01) === index)
    .slice(0, 4);
  return {
    manualBpm,
    beatDurationMs: 60_000 / manualBpm,
    crowdBpm: input.crowdBpm,
    bpmCorrectionPercent: input.crowdBpm > 0 ? (manualBpm / input.crowdBpm - 1) * 100 : 0,
    startOffsetMs: nearestOffsetMs(input.grid, input.start),
    endOffsetMs: nearestOffsetMs(input.grid, input.end),
    mappedBeatsInWindow: windowGrid.length,
    mappedDownbeatsInWindow: windowGrid.filter((beat) => beat.isDownbeat).length,
    alignedKicksInWindow: windowGrid.filter((beat) => beat.kickStatus === "aligned").length,
    verificationStatus,
    verificationCoverage,
    hypotheses,
  };
}

export type VerificationBlock = {
  start: number;
  end: number;
  status: "verified" | "review" | "no-evidence";
  evidenceCoverage: number;
  failureReason?: string;
};

type GridEvidenceBeat = {
  time: number;
  attackTime?: number | null;
  residualMs?: number | null;
  strength?: number;
  isPhraseStart?: boolean;
  phraseConfidence?: number;
};

export type RunwayGridCoverage = {
  verifiedEvidenceCoverage: number;
  evidenceAvailability: number;
  reviewRatio: number;
  evidencedSeconds: number;
  windowSeconds: number;
};

export const MIN_RUNWAY_VERIFIED_COVERAGE = .9;
// A runway may contain a breakdown, but it still needs a kick-bearing section
// somewhere in the local window to establish phase before continuity takes over.
export const MIN_RUNWAY_EVIDENCE_AVAILABILITY = .12;
export const MAX_RUNWAY_REVIEW_RATIO = .18;

export function assessRunwayGridCoverage(
  analysis: { duration: number; beats?: GridEvidenceBeat[]; verification?: { blocks?: VerificationBlock[] } },
  start: number,
  end: number,
): RunwayGridCoverage {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(analysis.duration, Math.max(start, end));
  const windowSeconds = Math.max(.001, to - from);
  const blocks = analysis.verification?.blocks ?? [];
  const overlappingBlocks = blocks.filter((block) => block.end > from && block.start < to);
  let verifiedEvidence = 0;
  let reviewEvidence = 0;
  for (const block of blocks) {
    const overlap = Math.max(0, Math.min(to, block.end) - Math.max(from, block.start));
    if (!overlap || block.status === "no-evidence") continue;
    const evidence = overlap * Math.max(0, Math.min(1, block.evidenceCoverage));
    if (block.status === "verified") verifiedEvidence += evidence;
    else reviewEvidence += evidence;
  }
  const evidencedSeconds = verifiedEvidence + reviewEvidence;
  const ordinary = {
    verifiedEvidenceCoverage: evidencedSeconds > 0 ? verifiedEvidence / evidencedSeconds : 0,
    evidenceAvailability: evidencedSeconds / windowSeconds,
    reviewRatio: evidencedSeconds > 0 ? reviewEvidence / evidencedSeconds : 1,
    evidencedSeconds,
    windowSeconds,
  };
  const beats = analysis.beats?.filter((beat) => beat.time >= from && beat.time <= to) ?? [];
  const attackBeats = beats.filter((beat) => beat.attackTime !== null
    && beat.attackTime !== undefined
    && (beat.strength ?? 0) >= .35
    && beat.residualMs !== null
    && beat.residualMs !== undefined);
  const aligned = attackBeats.filter((beat) => Math.abs(beat.residualMs!) <= 14);
  const strongConflicts = attackBeats.filter((beat) => Math.abs(beat.residualMs!) >= 35 && (beat.strength ?? 0) >= .55);
  const phraseConfirmed = beats.some((beat) => beat.isPhraseStart && (beat.phraseConfidence ?? 0) >= .65);
  const explicitlyDisputed = overlappingBlocks.some((block) => block.status === "review"
    && block.failureReason
    && block.failureReason !== "ambiguous-kick-family"
    && block.failureReason !== "no-kick-evidence");
  const alignedSpan = aligned.length > 1 ? aligned.at(-1)!.time - aligned[0].time : 0;
  const directPhraseConsensus = phraseConfirmed
    && aligned.length >= 4
    && aligned.length / Math.max(1, attackBeats.length) >= .72
    && strongConflicts.length <= Math.max(1, Math.floor(aligned.length * .15))
    && alignedSpan >= 1.2
    && !explicitlyDisputed;
  if (!directPhraseConsensus) return ordinary;
  // The block audit is deliberately suspicious of sparse passages and can
  // label a coherent grid "ambiguous" when an offbeat bass family also exists.
  // At a phrase edge, four or more tightly clustered attacks supply the phase
  // evidence directly. This is a reclassification of ambiguous/no-evidence
  // blocks, never an override of an explicitly conflicting grid audit.
  return {
    verifiedEvidenceCoverage: 1,
    evidenceAvailability: Math.max(ordinary.evidenceAvailability, aligned.length / Math.max(1, beats.length)),
    reviewRatio: 0,
    evidencedSeconds: Math.max(ordinary.evidencedSeconds, windowSeconds * aligned.length / Math.max(1, beats.length)),
    windowSeconds,
  };
}

export function runwayCoverageSafe(coverage: RunwayGridCoverage) {
  return coverage.verifiedEvidenceCoverage >= MIN_RUNWAY_VERIFIED_COVERAGE
    && coverage.evidenceAvailability >= MIN_RUNWAY_EVIDENCE_AVAILABILITY
    && coverage.reviewRatio <= MAX_RUNWAY_REVIEW_RATIO;
}

// Once tempo and phase have been established by a verified kick-bearing zone,
// a breakdown may legitimately provide no new evidence. Silence is therefore
// safe here; only evidence that actively disagrees with the grid is a failure.
export function continuityCoverageSafe(coverage: RunwayGridCoverage) {
  return coverage.evidencedSeconds < .001 || coverage.reviewRatio <= MAX_RUNWAY_REVIEW_RATIO;
}

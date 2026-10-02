import { assessRunwayGridCoverage, runwayCoverageSafe, type VerificationBlock } from "./runway-grid.ts";

export type GridQualityInput = {
  beats: Array<unknown>;
  duration?: number;
  verification: {
    verifiedBeatCoverage: number;
    verifiedBlocks: number;
    reviewBlocks: number;
    noEvidenceBlocks: number;
    blocks?: VerificationBlock[];
  };
};

export type GridRetentionAssessment = {
  accepted: boolean;
  wholeTrackAccepted: boolean;
  safeTransitionWindows: number;
  reasons: string[];
};

export const GRID_ACCEPTANCE_VERSION = "crowd2-manual-cue-grid-learning-3";

export type GridQualityAssessment = {
  accepted: boolean;
  verifiedBeatCoverage: number;
  reviewRatio: number;
  evidencedBlocks: number;
  reasons: string[];
};

export const MIN_TRUSTED_GRID_COVERAGE = .92;
export const MAX_TRUSTED_REVIEW_RATIO = .15;
export const MIN_TRUSTED_VERIFIED_BLOCKS = 12;
export const MIN_TRUSTED_BEATS = 256;

export function assessGridQuality(analysis: GridQualityInput): GridQualityAssessment {
  const verification = analysis.verification;
  const evidencedBlocks = verification.verifiedBlocks + verification.reviewBlocks;
  const reviewRatio = verification.reviewBlocks / Math.max(1, evidencedBlocks);
  const reasons: string[] = [];
  if (analysis.beats.length < MIN_TRUSTED_BEATS) reasons.push(`only ${analysis.beats.length} mapped beats`);
  if (verification.verifiedBlocks < MIN_TRUSTED_VERIFIED_BLOCKS) reasons.push(`only ${verification.verifiedBlocks} independently verified 16-beat blocks`);
  if (verification.verifiedBeatCoverage < MIN_TRUSTED_GRID_COVERAGE) reasons.push(`${Math.round(verification.verifiedBeatCoverage * 1000) / 10}% verified beat coverage is below 92%`);
  if (reviewRatio > MAX_TRUSTED_REVIEW_RATIO) reasons.push(`${Math.round(reviewRatio * 1000) / 10}% of evidenced blocks disagree with the proposed grid`);
  return {
    accepted: reasons.length === 0,
    verifiedBeatCoverage: verification.verifiedBeatCoverage,
    reviewRatio,
    evidencedBlocks,
    reasons,
  };
}

export function assessGridRetentionQuality(analysis: GridQualityInput): GridRetentionAssessment {
  const wholeTrack = assessGridQuality(analysis);
  const blocks = analysis.verification.blocks ?? [];
  const duration = analysis.duration ?? blocks.at(-1)?.end ?? 0;
  let safeTransitionWindows = 0;
  // Fresh kick evidence is required across the 32-beat approach and first
  // 16 beats after the handoff. The later blend may hold the established tempo
  // through a breakdown, so storage no longer demands six uninterrupted blocks.
  for (let index = 0; index + 2 < blocks.length; index += 1) {
    const coverage = assessRunwayGridCoverage(
      { duration, verification: { blocks } },
      blocks[index].start,
      blocks[index + 2].end,
    );
    if (runwayCoverageSafe(coverage)) safeTransitionWindows += 1;
  }
  const reasons: string[] = [];
  if (analysis.beats.length < MIN_TRUSTED_BEATS) reasons.push(`only ${analysis.beats.length} mapped beats`);
  return {
    accepted: reasons.length === 0,
    wholeTrackAccepted: wholeTrack.accepted,
    safeTransitionWindows,
    reasons,
  };
}

export type TempoSectionEvidence = {
  start: number;
  end: number;
  candidateBpm: number;
  referenceBpm: number;
  windows: number;
  referenceWins: number;
  candidateWins: number;
  decision: "keep" | "contradicted-by-kicks" | "insufficient-evidence" | "unconfirmed-edge";
};

/** Measure periodic support with a free phase, independently of the proposed grid. */
function pulseSupport(times: number[], bpm: number) {
  const period = 60 / bpm;
  const tolerance = Math.min(.02, period * .05);
  let best = 0;
  for (const phase of times) {
    const indices = new Set<number>();
    let matched = 0;
    for (const time of times) {
      const index = Math.round((time - phase) / period);
      if (Math.abs(time - phase - index * period) <= tolerance) {
        indices.add(index);
        matched += 1;
      }
    }
    const expected = (times.at(-1)! - times[0]) / period + 1;
    best = Math.max(best, Math.min(matched / times.length, indices.size / expected));
  }
  return best;
}

/**
 * A veto, not a new beat picker: change a proposed tempo only when independent
 * drum attacks repeatedly support the reference and contradict the proposal.
 * Missing kicks, ambiguous subdivisions and a single fill cannot trigger it.
 * Phase is deliberately free so a correct tempo with an offset is not rejected.
 */
export function assessTempoSection(
  section: { start: number; end: number; bpm: number },
  referenceBpm: number,
  kicks: readonly { time: number; strength: number }[],
  precision = false,
): TempoSectionEvidence {
  const result: TempoSectionEvidence = {
    start: section.start, end: section.end, candidateBpm: section.bpm, referenceBpm,
    windows: 0, referenceWins: 0, candidateWins: 0, decision: "keep",
  };
  if (!Number.isFinite(referenceBpm) || referenceBpm <= 0 || !Number.isFinite(section.bpm)
    || section.bpm <= 0 || Math.abs(section.bpm / referenceBpm - 1) < (precision ? .0005 : .008)) return result;
  // Small rate errors need longer observations to distinguish drift from jitter.
  const windowSeconds = precision && Math.abs(section.bpm / referenceBpm - 1) < .008 ? 64 : 16;
  let previousReferenceWin = false;
  let consecutiveReferenceWins = false;
  for (let start = section.start; start + windowSeconds <= section.end + .000001; start += windowSeconds) {
    const local = kicks.filter(kick => kick.time >= start && kick.time < start + windowSeconds
      && Number.isFinite(kick.time) && Number.isFinite(kick.strength) && kick.strength > 0);
    const peak = Math.max(0, ...local.map(kick => kick.strength));
    const times = local.filter(kick => kick.strength >= peak * .3).map(kick => kick.time).sort((a, b) => a - b);
    if (times.length < 16 || times.at(-1)! - times[0] < windowSeconds / 2) {
      previousReferenceWin = false;
      continue;
    }
    result.windows += 1;
    const reference = pulseSupport(times, referenceBpm);
    const candidate = pulseSupport(times, section.bpm);
    const referenceWins = reference >= .8 && candidate <= .55 && reference - candidate >= .3;
    if (referenceWins) {
      result.referenceWins += 1;
      consecutiveReferenceWins ||= previousReferenceWin;
    }
    if (candidate >= .8 && candidate - reference >= .2) result.candidateWins += 1;
    previousReferenceWin = referenceWins;
  }
  result.decision = consecutiveReferenceWins && result.candidateWins === 0
    && result.referenceWins / result.windows >= .6
    ? "contradicted-by-kicks"
    : result.windows < 2 ? "insufficient-evidence" : "keep";
  return result;
}

/** Multi-beat intervals suppress detector quantisation, missing kicks and fills. */
export function kickTempoSeed(times: readonly number[], referenceBpm: number) {
  const periods: number[] = [];
  for (let left = 0; left < times.length; left += 1) {
    for (let right = left + 1; right < times.length; right += 1) {
      const span = times[right] - times[left];
      const beats = Math.round(span * referenceBpm / 60);
      if (beats > 32) break;
      if (beats >= 8) periods.push(span / beats);
    }
  }
  if (periods.length < 64) return null;
  periods.sort((a, b) => a - b);
  return 60 / periods[Math.floor(periods.length / 2)];
}

/**
 * REPLICATE (DJ, 30 Aug 2026): congruence when one tune throws an extra
 * bar.
 *
 * Some tunes insert a fill — an extra 1/2/4/8 beats at the end of a cycle —
 * and from that fill onward their crashes land late against the other tune.
 * The fix is not to cut the fill but to MATCH it: a clean block of the
 * regular tune is copied in place, doubling that stretch of wave, so both
 * tunes run long by the same count and every crash after the fill lines up
 * again.
 *
 * The copy is a real edit, not a playback trick. The waveform block appears
 * twice on screen, the playhead walks left-to-right through it, and the
 * audio the private player runs is a server-rendered splice of the same
 * cut. Original-tune coordinates ("O-time") describe the plan; everything
 * displayed after the paste lives in the variant timeline ("V-time"), which
 * is O-time shifted by the paste length past the block's end.
 */

export type ReplicatePlan = {
  /** Block start, in seconds of the ORIGINAL tune. A beat time. */
  blockStart: number;
  /** Block end (exclusive), in seconds of the ORIGINAL tune. A beat time. */
  blockEnd: number;
  /** How many EXTRA passes of the block are pasted after its first play. */
  copies: number;
};

export function replicateBlockSeconds(plan: ReplicatePlan) {
  return Math.max(0, plan.blockEnd - plan.blockStart);
}

/** Total seconds added to the tune: copies × block length. */
export function replicateShiftSeconds(plan: ReplicatePlan) {
  return plan.copies * replicateBlockSeconds(plan);
}

/**
 * O-time → V-time for a single event. Everything before the block's end sits
 * where it always was (the first pass of the block IS the original); the
 * moment at blockEnd and everything after it happens later by the paste.
 */
export function replicateMapTime(plan: ReplicatePlan, time: number) {
  return time < plan.blockEnd ? time : time + replicateShiftSeconds(plan);
}

/**
 * Every V-time at which an O-time event is heard. An event inside the block
 * plays once per pass: its original position plus one echo per pasted copy.
 */
export function replicateOccurrences(plan: ReplicatePlan, time: number): number[] {
  const block = replicateBlockSeconds(plan);
  if (!(block > 0)) return [time];
  if (time >= plan.blockStart && time < plan.blockEnd) {
    const times = [time];
    for (let copy = 1; copy <= plan.copies; copy += 1) times.push(time + copy * block);
    return times;
  }
  return [replicateMapTime(plan, time)];
}

/**
 * V-time → O-time. Positions inside a pasted pass fold back into the block
 * they are a copy of, so a selection made on the doubled wave still names
 * real source material.
 */
export function replicateUnmapTime(plan: ReplicatePlan, time: number) {
  const block = replicateBlockSeconds(plan);
  const shift = replicateShiftSeconds(plan);
  if (!(block > 0) || time < plan.blockEnd) return time;
  if (time < plan.blockEnd + shift) return plan.blockStart + (time - plan.blockEnd) % block;
  return time - shift;
}

/**
 * Splice a fixed-hop sample array the same way the audio is spliced: head up
 * to the block end, the block's samples once per copy, then the tail.
 */
export function replicateSpliceArray(values: readonly number[], hopSeconds: number, plan: ReplicatePlan): number[] {
  if (!values.length || !(hopSeconds > 0)) return values.slice();
  const startIndex = Math.max(0, Math.min(values.length, Math.round(plan.blockStart / hopSeconds)));
  const endIndex = Math.max(startIndex, Math.min(values.length, Math.round(plan.blockEnd / hopSeconds)));
  const block = values.slice(startIndex, endIndex);
  const spliced = values.slice(0, endIndex);
  for (let copy = 0; copy < plan.copies; copy += 1) spliced.push(...block);
  spliced.push(...values.slice(endIndex));
  return spliced;
}

/**
 * Move a span's endpoints across the paste. A span that contains the block
 * end stretches to cover the pasted passes — the tune really does spend
 * longer inside that section now.
 */
export function replicateSpliceSpan<T extends { start: number; end: number }>(span: T, plan: ReplicatePlan): T {
  return {
    ...span,
    start: replicateMapTime(plan, span.start),
    end: replicateMapTime(plan, span.end),
  };
}

type ReplicateBeat = { time: number; nominalTime?: number; attackTime?: number | null };

/**
 * Splice a beat list. Beats inside the block are duplicated into every
 * pasted pass with their kick stamps intact — the audio there is a perfect
 * copy, so the measurements still describe it. Beats at or after the block
 * end shift by the paste, and because the block spans whole beats the
 * spacing runs unbroken across both seams.
 */
export function replicateSpliceBeats<T extends ReplicateBeat>(beats: readonly T[], plan: ReplicatePlan): T[] {
  const block = replicateBlockSeconds(plan);
  const shift = replicateShiftSeconds(plan);
  const before = beats.filter((beat) => beat.time < plan.blockEnd);
  const inBlock = beats.filter((beat) => beat.time >= plan.blockStart && beat.time < plan.blockEnd);
  const after = beats.filter((beat) => beat.time >= plan.blockEnd);
  const moved = (beat: T, by: number): T => ({
    ...beat,
    time: beat.time + by,
    ...(typeof beat.nominalTime === "number" && Number.isFinite(beat.nominalTime) ? { nominalTime: beat.nominalTime + by } : {}),
    ...(typeof beat.attackTime === "number" && Number.isFinite(beat.attackTime) ? { attackTime: beat.attackTime + by } : {}),
  });
  const spliced: T[] = before.map((beat) => ({ ...beat }));
  for (let copy = 1; copy <= plan.copies; copy += 1) {
    for (const beat of inBlock) spliced.push(moved(beat, copy * block));
  }
  for (const beat of after) spliced.push(moved(beat, shift));
  return spliced;
}

/** How many grid beats one pass of the block contains. */
export function replicateBlockBeats(beats: readonly { time: number }[], plan: ReplicatePlan) {
  return beats.filter((beat) => beat.time >= plan.blockStart - .001 && beat.time < plan.blockEnd - .001).length;
}

type ReplicateAnalysisShape = {
  duration: number;
  hopSeconds?: number;
  beats: ReplicateBeat[];
  lowWaveform?: number[];
  lowWaveformDetailed?: number[];
  kickWaveformDetailed?: number[];
  tempoSections?: Array<{ start: number; end: number }>;
  phrases?: Array<{ start: number; end: number }>;
  verification?: { blocks?: Array<{ start: number; end: number }> } | null;
};

/**
 * The whole analysis, spliced. The result is what a fresh analysis of the
 * pasted audio would honestly say, built without re-analysing: duration
 * grows by the paste, the drawn waveforms carry the doubled block, beats
 * duplicate through it, and every span-shaped record moves with the map.
 * The input is never mutated — CLEAR restores it byte-for-byte.
 */
export function replicateSpliceAnalysis<T extends ReplicateAnalysisShape>(analysis: T, plan: ReplicatePlan): T {
  const shift = replicateShiftSeconds(plan);
  const duration = analysis.duration + shift;
  const detailedHop = analysis.hopSeconds && analysis.hopSeconds > 0 ? analysis.hopSeconds : .01;
  const spliced: T = {
    ...analysis,
    duration,
    beats: replicateSpliceBeats(analysis.beats, plan),
  };
  if (analysis.lowWaveform?.length) {
    // The overview array's hop is implicit: the whole tune over its length.
    const overviewHop = analysis.duration / Math.max(1, analysis.lowWaveform.length - 1);
    spliced.lowWaveform = replicateSpliceArray(analysis.lowWaveform, overviewHop, plan);
  }
  if (analysis.lowWaveformDetailed?.length) spliced.lowWaveformDetailed = replicateSpliceArray(analysis.lowWaveformDetailed, detailedHop, plan);
  if (analysis.kickWaveformDetailed?.length) spliced.kickWaveformDetailed = replicateSpliceArray(analysis.kickWaveformDetailed, detailedHop, plan);
  if (Array.isArray(analysis.tempoSections)) spliced.tempoSections = analysis.tempoSections.map((section) => replicateSpliceSpan(section, plan));
  if (Array.isArray(analysis.phrases)) spliced.phrases = analysis.phrases.map((phrase) => replicateSpliceSpan(phrase, plan));
  if (analysis.verification?.blocks) {
    spliced.verification = {
      ...analysis.verification,
      blocks: analysis.verification.blocks.map((block) => replicateSpliceSpan(block, plan)),
    };
  }
  return spliced;
}

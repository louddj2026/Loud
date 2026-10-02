/**
 * How far a pointer must travel before the wave starts moving.
 *
 * A finger resting on glass wanders a pixel or two and a mouse does not, so the
 * dead patch that rejects that wander should not be charged to both. At 1 px a
 * mouse drag starts the moment the hand does.
 */
export const FOCUS_WAVE_DRAG_THRESHOLD_PX = 3;
export const FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX = 1;

export function focusWaveDragThresholdPx(pointerType?: string) {
  return pointerType === "touch" ? FOCUS_WAVE_DRAG_THRESHOLD_PX : FOCUS_WAVE_MOUSE_DRAG_THRESHOLD_PX;
}

/**
 * How far the wave travels per pixel of hand, as a multiple of one-to-one.
 *
 * At 1:1 a full sweep of the surface moves exactly one screenful, so crossing a
 * tune means dragging, lifting, and dragging again. The gain buys travel at the
 * cost of resolution: at 1.8 a pixel is 1.8 pixels of wave, which at an 8 s window
 * across 1000 px is 14 ms of track — still finer than the 35 ms that decides
 * whether a kick is on a beat, so a cue can still be landed by hand.
 */
export const FOCUS_WAVE_DRAG_GAIN = 1.8;

export const FOCUS_WAVE_BUFFER_VIEWPORTS = 1;
export const FOCUS_WAVE_REBASE_FRACTION = .25;
/**
 * The same question asked during a drag, where re-anchoring is expensive.
 *
 * Each re-anchor re-renders the whole surface — chunk plan, paths, sections — so
 * doing it every quarter window is a hitch four times per screenful under the
 * hand. There is room to spend: the buffer is a whole viewport either side and
 * half a viewport is visible, so the drawn range only runs out at **0.5**. 0.4
 * keeps a tenth of a window in hand and re-anchors 40% as often.
 */
export const FOCUS_WAVE_DRAG_REBASE_FRACTION = .4;
export const FOCUS_WAVE_CHUNK_POINTS = 96;

/**
 * How a throw sheds speed: the fraction of its velocity left after one second.
 *
 * Exponential rather than linear, because a linear stop arrives as a jolt at a
 * definite moment and this has to arrive as a settle. At 0.06 a throw has spent
 * 94% of itself in the first second and is under the stop threshold shortly after,
 * which is a glide with weight rather than a slide on ice.
 */
export const FOCUS_WAVE_GLIDE_DECAY_PER_SECOND = .06;
/** Slower than this is not visibly moving, so the glide has arrived. */
export const FOCUS_WAVE_GLIDE_STOP_WINDOWS_PER_SECOND = .05;
/**
 * The throw is capped at this many screenfuls a second.
 *
 * A flick that leaves the hand at 20 windows a second is a slip, not an
 * instruction, and launching to the end of the tune from one is unrecoverable.
 */
export const FOCUS_WAVE_GLIDE_MAX_WINDOWS_PER_SECOND = 2.5;
/**
 * How much of the recent hand movement becomes the throw.
 *
 * Short enough that the throw is the last flick rather than the average of the
 * whole drag — a hand that sweeps and then stops dead before lifting has asked
 * for no glide at all, and a longer window would give it one.
 */
export const FOCUS_WAVE_THROW_WINDOW_MS = 90;

export type FocusWaveChunk = {
  index: number;
  startSample: number;
  endSample: number;
  startTime: number;
  endTime: number;
};

export function focusWaveBufferedRange(anchorTime: number, windowSeconds: number) {
  const safeWindow = Math.max(.001, windowSeconds);
  const viewStart = anchorTime - safeWindow / 2;
  const viewEnd = anchorTime + safeWindow / 2;
  const padding = safeWindow * FOCUS_WAVE_BUFFER_VIEWPORTS;
  return {
    viewStart,
    viewEnd,
    renderStart: viewStart - padding,
    renderEnd: viewEnd + padding,
  };
}

export function focusWaveChunkPlan({
  renderStart,
  renderEnd,
  windowSeconds,
  hopSeconds,
  sampleLength,
  sampleLimit,
  pointsPerChunk = FOCUS_WAVE_CHUNK_POINTS,
}: {
  renderStart: number;
  renderEnd: number;
  windowSeconds: number;
  hopSeconds: number;
  sampleLength: number;
  sampleLimit: number;
  pointsPerChunk?: number;
}) {
  const safeLength = Math.max(0, Math.floor(sampleLength));
  const safeHop = Math.max(.001, hopSeconds);
  const safeWindow = Math.max(.001, windowSeconds);
  const safeLimit = Math.max(1, Math.floor(sampleLimit));
  const safeChunkPoints = Math.max(8, Math.floor(pointsPerChunk));
  const bufferedSamples = safeWindow * (1 + FOCUS_WAVE_BUFFER_VIEWPORTS * 2) / safeHop;
  // This stride is a property of the zoom level, never of the moving render
  // anchor. Consequently a source sample always lands in the same chunk and
  // at the same local x coordinate as playback advances.
  const sampleStride = Math.max(1, Math.ceil(bufferedSamples / safeLimit));
  const samplesPerChunk = sampleStride * safeChunkPoints;
  if (!safeLength || renderEnd < 0 || renderStart > (safeLength - 1) * safeHop) {
    return { sampleStride, samplesPerChunk, chunks: [] as FocusWaveChunk[] };
  }

  const lastSourceSample = safeLength - 1;
  const firstSample = Math.min(lastSourceSample, Math.max(0, Math.floor(renderStart / safeHop)));
  const lastSample = Math.min(lastSourceSample, Math.max(0, Math.ceil(renderEnd / safeHop)));
  const firstChunk = Math.floor(firstSample / samplesPerChunk);
  const lastChunk = Math.floor(lastSample / samplesPerChunk);
  const chunks: FocusWaveChunk[] = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const startSample = index * samplesPerChunk;
    if (startSample > lastSourceSample) break;
    const endSample = Math.min(lastSourceSample, startSample + samplesPerChunk);
    chunks.push({
      index,
      startSample,
      endSample,
      startTime: startSample * safeHop,
      endTime: endSample * safeHop,
    });
  }
  return { sampleStride, samplesPerChunk, chunks };
}

export function focusWaveShouldRebase(
  anchorTime: number,
  playheadTime: number,
  windowSeconds: number,
  fraction = FOCUS_WAVE_REBASE_FRACTION,
) {
  return Math.abs(playheadTime - anchorTime) >= Math.max(.05, windowSeconds * fraction);
}

export type FocusWaveThrowSample = {
  /** Track time under the pointer. */
  time: number;
  /** Wall clock of the sample, in milliseconds. */
  at: number;
};

/**
 * The speed the hand was moving when it let go, in track-seconds per second.
 *
 * Measured over the last `FOCUS_WAVE_THROW_WINDOW_MS` rather than the whole
 * gesture: a hand that sweeps across and then holds still before lifting has
 * asked for the wave to stay where it put it, and averaging the sweep in would
 * throw it anyway.
 */
export function focusWaveThrowVelocity(
  samples: readonly FocusWaveThrowSample[],
  windowMs = FOCUS_WAVE_THROW_WINDOW_MS,
) {
  const usable = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.at));
  if (usable.length < 2) return 0;
  const newest = usable[usable.length - 1];
  let oldest = usable[usable.length - 2];
  for (let index = usable.length - 2; index >= 0; index -= 1) {
    if (newest.at - usable[index].at > Math.max(1, windowMs)) break;
    oldest = usable[index];
  }
  const elapsedMs = newest.at - oldest.at;
  if (elapsedMs <= 0) return 0;
  return (newest.time - oldest.time) / (elapsedMs / 1000);
}

/**
 * Clamp a throw to something recoverable, in track-seconds per second.
 *
 * Expressed in screenfuls so it means the same thing at every zoom: a throw is
 * fast when it crosses the visible wave quickly, not when it crosses a number of
 * seconds, and the two differ by 30× between the closest and widest window.
 */
export function focusWaveThrowLimit(windowSeconds: number) {
  return Math.max(.001, windowSeconds) * FOCUS_WAVE_GLIDE_MAX_WINDOWS_PER_SECOND;
}

/**
 * One frame of coasting: where the wave gets to, and how fast it is still going.
 *
 * The distance is the integral of an exponential decay across the frame rather
 * than velocity × time, so the glide travels the same distance whether it is
 * stepped at 60 Hz or 30 Hz. A dropped frame changes nothing about where it
 * lands.
 */
export function focusWaveGlideStep(velocity: number, frameMs: number, windowSeconds: number) {
  const seconds = Math.max(0, frameMs) / 1000;
  const stopSpeed = Math.max(.001, windowSeconds) * FOCUS_WAVE_GLIDE_STOP_WINDOWS_PER_SECOND;
  if (!Number.isFinite(velocity) || Math.abs(velocity) < stopSpeed || seconds <= 0) {
    return { velocity: 0, delta: 0, moving: false };
  }
  const decay = Math.pow(FOCUS_WAVE_GLIDE_DECAY_PER_SECOND, seconds);
  const next = velocity * decay;
  // ∫v·kᵗ dt over the frame, k being the per-second decay.
  const delta = velocity * (decay - 1) / Math.log(FOCUS_WAVE_GLIDE_DECAY_PER_SECOND);
  return { velocity: next, delta, moving: Math.abs(next) >= stopSpeed };
}

export function focusWaveDragTime({
  anchorX,
  clientX,
  anchorTime,
  elementWidth,
  windowSeconds,
  duration,
  engaged = false,
  thresholdPx = FOCUS_WAVE_DRAG_THRESHOLD_PX,
  gain = FOCUS_WAVE_DRAG_GAIN,
}: {
  anchorX: number;
  clientX: number;
  anchorTime: number;
  elementWidth: number;
  windowSeconds: number;
  duration: number;
  engaged?: boolean;
  thresholdPx?: number;
  gain?: number;
}) {
  const pointerDelta = clientX - anchorX;
  const shouldEngage = engaged || Math.abs(pointerDelta) >= thresholdPx;
  if (!shouldEngage) return { engaged: false, time: anchorTime };

  const effectiveDelta = Math.abs(pointerDelta) <= thresholdPx
    ? 0
    : pointerDelta - Math.sign(pointerDelta) * thresholdPx;
  // The mapping stays absolute — anchor to pointer — rather than accumulating
  // per move. Gain multiplies distance, so returning the hand to where the drag
  // started returns the wave to where it started, however fast it went in
  // between. An accumulating drag with gain drifts and never comes home.
  const time = anchorTime - effectiveDelta * gain / Math.max(1, elementWidth) * windowSeconds;
  return {
    engaged: true,
    time: Math.min(Math.max(0, time), Math.max(0, duration)),
  };
}

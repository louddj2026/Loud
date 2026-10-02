/**
 * The platter, as an audio worklet.
 *
 * This is the consumer `lib/scrub-audio.ts` was written for, and it holds no
 * policy of its own: it is given a position and a signed rate and it reads the
 * tune at that speed, backwards when the rate is negative, silent when it is
 * zero. Every decision about what the rate should be — velocity, limits, release,
 * routing — lives in that module and is tested without an AudioContext.
 *
 * It is a real worklet rather than a `playbackRate` on the media element because
 * a media element cannot play backwards at all, and a platter that only goes
 * forwards is not a platter.
 *
 * Loaded from `public/`, so it is a plain script with no build step: an
 * AudioWorklet module is fetched by URL and evaluated in a scope of its own, and
 * anything added to `public/` is invisible until the next production build.
 */

/** How quickly the output finds its level, in seconds. Short, but not a step. */
const GAIN_RAMP_SECONDS = .005;
/**
 * How quickly the read speed follows a new command.
 *
 * This is the difference between a platter and a machine gun. Commands arrive
 * about once a frame, and a hand moving across glass is not smooth at that
 * timescale — the speed measured over the last few pointer events jumps around
 * even during a steady drag. Snapping the read rate to each one frequency-
 * modulates the tune at ~60 Hz, which is heard as a warble sitting on top of
 * everything, not as speed. Sliding to it over 40 ms tracks the hand closely
 * enough to feel attached and averages that jitter away.
 */
const RATE_SLIDE_SECONDS = .04;
/**
 * How far the sound may drift from the drawn playhead before it is pulled back.
 *
 * The pointer owns the position — the number under the hand and the number you
 * hear have to be the same one. But snapping to it on every message, at 60 Hz
 * against 128-sample blocks, re-reads the buffer mid-cycle and that is heard as
 * zipper noise. So it free-runs at the commanded rate and only re-seeks when it
 * has genuinely come adrift, which is a seek rather than a drag.
 */
const RESYNC_SECONDS = .03;

class PlatterScrubProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Mono PCM as 16-bit, which halves what a seven-minute tune costs to hold. */
    this.samples = null;
    this.sampleRate = 0;
    /** Fractional read head, in source samples. */
    this.read = 0;
    /** What is actually being read at, sliding toward `targetRate`. */
    this.rate = 0;
    this.targetRate = 0;
    this.gain = 0;
    this.targetGain = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === "load") {
        this.samples = message.samples instanceof Int16Array ? message.samples : null;
        this.sampleRate = Number(message.sampleRate) || 0;
        this.read = 0;
        this.rate = 0;
        this.targetRate = 0;
        return;
      }
      if (message.type === "command") {
        const position = Number(message.position);
        const rate = Number(message.rate);
        this.targetRate = Number.isFinite(rate) ? rate : 0;
        this.targetGain = this.targetRate === 0 ? 0 : 1;
        if (this.samples && this.sampleRate > 0 && Number.isFinite(position)) {
          const wanted = position * this.sampleRate;
          if (Math.abs(wanted - this.read) > RESYNC_SECONDS * this.sampleRate) this.read = wanted;
        }
        return;
      }
      if (message.type === "stop") {
        this.targetRate = 0;
        this.targetGain = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const channel = output[0];
    const frames = channel.length;
    const samples = this.samples;

    if (!samples || !this.sampleRate) {
      channel.fill(0);
      for (let index = 1; index < output.length; index += 1) output[index].fill(0);
      return true;
    }

    const rampPerFrame = 1 / Math.max(1, GAIN_RAMP_SECONDS * sampleRate);
    // One-pole slide, per output frame, so the pitch bends into a new speed
    // rather than stepping onto it.
    const rateSlide = 1 - Math.exp(-1 / Math.max(1, RATE_SLIDE_SECONDS * sampleRate));
    const last = samples.length - 1;

    for (let index = 0; index < frames; index += 1) {
      this.rate += (this.targetRate - this.rate) * rateSlide;
      // One output frame is 1/sampleRate of wall time, which at this rate is
      // `rate` seconds of tune, which is this many source samples.
      const step = this.rate * this.sampleRate / sampleRate;
      this.gain += Math.max(-rampPerFrame, Math.min(rampPerFrame, this.targetGain - this.gain));
      // Running out of groove at either end makes no sound, exactly as it would
      // on a record — and stops the read head walking off the buffer.
      if (this.read <= 0 && step < 0) { this.read = 0; this.targetGain = 0; }
      if (this.read >= last && step > 0) { this.read = last; this.targetGain = 0; }
      const base = Math.floor(this.read);
      const nextIndex = base + 1 <= last ? base + 1 : last;
      const fraction = this.read - base;
      // Linear interpolation: at any rate other than exactly 1 the read head sits
      // between samples, and taking the nearest one is audible as grain.
      const value = (samples[base] * (1 - fraction) + samples[nextIndex] * fraction) / 32768;
      channel[index] = value * this.gain;
      this.read += step;
      if (this.read < 0) this.read = 0;
      else if (this.read > last) this.read = last;
    }
    // Mono source, every output channel the same: this is a monitor feed, and a
    // scrub is not the place to be spending memory on stereo.
    for (let index = 1; index < output.length; index += 1) output[index].set(channel);
    return true;
  }
}

registerProcessor("platter-scrub", PlatterScrubProcessor);

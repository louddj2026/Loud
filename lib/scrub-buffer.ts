/**
 * The tune, in the form the platter reads it.
 *
 * Scrub audio needs the samples themselves — a media element cannot be played
 * backwards, so the only way to hear the record under the hand is to hold the
 * PCM and read it. That costs memory on a booth laptop with three decks loaded,
 * so this is deliberately not the mastering copy:
 *
 *  - **mono**, because it feeds one monitor bus and stereo would double the cost
 *    for a difference nobody scrubs to hear;
 *  - **16-bit**, which halves it again and is far below the noise floor of a
 *    sound that is being pitched around by hand;
 *  - **decimated to ~22 kHz**, giving 11 kHz of bandwidth. Scrubbing pitches
 *    everything up, so the top end is where the least information is: at 4× a
 *    2 kHz hat is already at 8 kHz. Slow scrubs, where the low end carries, keep
 *    everything that matters.
 *
 * Together that is about 18 MB for a seven-minute tune instead of 145 MB. If it
 * ever needs to be full quality, `SCRUB_TARGET_SAMPLE_RATE` is the one number to
 * change and the worklet needs no edit at all.
 */

/** What the samples are decimated towards. See the note above on bandwidth. */
export const SCRUB_TARGET_SAMPLE_RATE = 22050;

export type ScrubSamples = {
  samples: Int16Array;
  sampleRate: number;
};

/**
 * Downmix to mono, decimate, and quantise — the whole conversion in one pass so
 * a seven-minute tune is walked once rather than three times.
 *
 * Decimation is by a whole factor and averages the samples it collapses rather
 * than picking one of them. Picking would alias every frequency above the new
 * Nyquist straight back down into the audible band, which on a drum track is the
 * hats reappearing as a whistle.
 */
export function toScrubSamples(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  targetSampleRate = SCRUB_TARGET_SAMPLE_RATE,
): ScrubSamples {
  const usable = channels.filter((channel) => channel && channel.length);
  if (!usable.length || !(sourceSampleRate > 0)) return { samples: new Int16Array(0), sampleRate: 0 };
  const factor = Math.max(1, Math.round(sourceSampleRate / Math.max(1, targetSampleRate)));
  const length = Math.floor(usable[0].length / factor);
  const samples = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const from = index * factor;
    let total = 0;
    for (let step = 0; step < factor; step += 1) {
      const at = from + step;
      for (const channel of usable) total += channel[at] ?? 0;
    }
    const mean = total / (factor * usable.length);
    // Clamp before quantising: a track mastered hot goes past ±1 and wrapping
    // that would be a click on the loudest part of the tune.
    const clamped = mean > 1 ? 1 : mean < -1 ? -1 : mean;
    samples[index] = Math.round(clamped * 32767);
  }
  return { samples, sampleRate: sourceSampleRate / factor };
}

/**
 * Fetch and decode a track into scrub samples.
 *
 * Decoding is done through the booth's own context so the decode lands at the
 * context's rate and nothing has to be resampled twice. The audio has almost
 * certainly been fetched already by the deck's media element, so this normally
 * comes from the HTTP cache rather than the network.
 */
export async function loadScrubSamples(
  context: BaseAudioContext,
  url: string,
  signal?: AbortSignal,
): Promise<ScrubSamples | null> {
  try {
    const response = await fetch(url, { cache: "force-cache", signal });
    if (!response.ok) return null;
    const encoded = await response.arrayBuffer();
    const decoded = await context.decodeAudioData(encoded);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const scrub = toScrubSamples(channels, decoded.sampleRate);
    return scrub.samples.length ? scrub : null;
  } catch {
    // A deck that cannot be scrubbed still plays. Silence is the fallback, never
    // a broken load.
    return null;
  }
}

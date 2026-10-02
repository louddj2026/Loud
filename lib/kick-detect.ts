/**
 * Individual kick hits in a drums-only stem.
 *
 * No tempo, no grid, no assumption that hits are evenly spaced. Each kick is
 * found on its own merits, so the result can be ticked and judged without a grid
 * fit standing in the way. A drifting grid can still sound clean over a 32-beat
 * audition; a wrongly placed hit cannot hide.
 *
 * This is only tractable because the input is separated drums. On a full mix the
 * bassline occupies the same 45-180 Hz band as the kick and no threshold can tell
 * them apart — measured over 9,505 onsets, every discriminating range overlapped.
 * With the bass gone, a rise in the low band is a kick.
 *
 * An earlier attempt at this fired roughly twice per beat, implying 293 BPM on a
 * 142 BPM tune. Two causes, both addressed here: a fixed threshold that tracked
 * neither the tune's level nor its changes, and suppression too short to reject
 * the second peak of a single kick's decay.
 */

/**
 * The band a kick's fundamental lives in.
 *
 * Measured, not assumed: profiling kick windows in separated drums put the
 * fundamental at 54-76 Hz with the bulk of its energy inside 43-108 Hz. The first
 * version of this reached to 120 Hz and caught snare and tom bodies with it,
 * firing 2,278 times on a tune with roughly 1,000 beats.
 */
const LOW_HZ = 30;
const HIGH_HZ = 90;
/** 5 ms steps: fine enough that quantisation is inaudible against a kick. */
export const KICK_HOP_SECONDS = 0.005;
/**
 * Suppression window.
 *
 * At 142 BPM a beat is 423 ms and a 16th is 106 ms, so 110 ms let a second peak
 * through on almost every kick. 180 ms still admits a genuine double-kick at
 * 8th-note spacing while rejecting the decay of a single one.
 */
const MINIMUM_GAP_SECONDS = 0.18;
/** How far back a pick may walk to find its kick's start. */
const ONSET_BACKTRACK_SECONDS = 0.08;
/** Walking back stops once the envelope is this small a share of the kick's peak. */
const ONSET_FLOOR_SHARE = 0.12;
/** Local history the onset function measures a rise against. */
const HISTORY_STEPS = 8;
/** Window the adaptive threshold is computed over, so a quiet passage still yields hits. */
const THRESHOLD_WINDOW_SECONDS = 2;
/**
 * How far above the local spread a rise must sit.
 *
 * Three deviations admitted roughly two hits per beat. A kick is the loudest thing
 * in this band by a wide margin, so the bar can be high without losing them.
 */
const THRESHOLD_DEVIATIONS = 5;
/** And it must be a real event relative to the loudest hits nearby, not just above noise. */
const LOCAL_PEAK_SHARE = 0.28;

/**
 * The band that tells a kick from the rest of the kit.
 *
 * A kick is nearly all fundamental with a short thud; a snare, rim, clap or hat
 * carries most of its energy up here. DJ heard smaller percussion being taken for
 * kicks, and this is why: the stem was being decoded at 4 kHz, so everything above
 * 2 kHz — the very thing that distinguishes them — was absent from the signal.
 * Detection now runs at a rate that can see it.
 */
const TOP_LOW_HZ = 2000;
const TOP_HIGH_HZ = 9000;
/** Minimum share of a hit's energy that must be in the kick band rather than the top. */
const LOW_DOMINANCE = 0.72;
/** And a hit must not be a ghost note: this fraction of the median accepted hit. */
const STRENGTH_FLOOR = 0.22;
/** Window either side of a candidate that its spectral shape is measured over. */
const SHAPE_WINDOW_SECONDS = 0.04;
/**
 * Two rates, for two different jobs.
 *
 * Peak-picking is tuned at 4 kHz and works there — implied tempo within 2% of
 * stored BPM on 15 of 17 tracks, confirmed by ear. Moving it to a higher rate
 * broke it outright (3-4x too many hits), so it stays.
 *
 * The shape gate needs to see above 2 kHz, which 4 kHz cannot represent at all.
 * So the top band is measured from a separate, higher-rate decode of the same
 * stem and only ever consulted to accept or reject a peak that has already been
 * found. Nothing about the peak-picking changes.
 */
export const KICK_PICK_SAMPLE_RATE = 4000;
export const KICK_SHAPE_SAMPLE_RATE = 22050;

export type KickHit = { time: number; strength: number };

function onePole(cutoff: number, sampleRate: number) {
  return 1 - Math.exp(-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45) / sampleRate);
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[sorted.length >> 1];
}

/**
 * Band-limited energy per hop.
 *
 * Cascaded one-pole sections, and the band taken as the difference of two
 * lowpasses — the same shape `analyzeBeatGrid` uses, so the two agree about what
 * "the low band" means.
 */
export function kickEnvelope(samples: Float32Array | readonly number[], sampleRate: number) {
  return bandEnvelopes(samples, sampleRate).kick;
}

/**
 * Kick-band and top-band energy per hop, from one pass over the samples.
 *
 * Both are differences of cascaded one-pole lowpasses, the same shape
 * `analyzeBeatGrid` uses, so "the low band" means the same thing in both places.
 */
export function bandEnvelopes(samples: Float32Array | readonly number[], sampleRate: number) {
  const hop = Math.max(1, Math.round(sampleRate * KICK_HOP_SECONDS));
  const lowCoefficient = onePole(LOW_HZ, sampleRate);
  const highCoefficient = onePole(HIGH_HZ, sampleRate);
  const topLowCoefficient = onePole(TOP_LOW_HZ, sampleRate);
  const topHighCoefficient = onePole(TOP_HIGH_HZ, sampleRate);
  let lowA = 0, lowB = 0, highA = 0, highB = 0;
  let topLowA = 0, topLowB = 0, topHighA = 0, topHighB = 0;
  let kickSum = 0, topSum = 0, count = 0;
  const kick: number[] = [];
  const top: number[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    lowA += lowCoefficient * (sample - lowA);
    lowB += lowCoefficient * (lowA - lowB);
    highA += highCoefficient * (sample - highA);
    highB += highCoefficient * (highA - highB);
    topLowA += topLowCoefficient * (sample - topLowA);
    topLowB += topLowCoefficient * (topLowA - topLowB);
    topHighA += topHighCoefficient * (sample - topHighA);
    topHighB += topHighCoefficient * (topHighA - topHighB);
    const kickBand = highB - lowB;
    const topBand = topHighB - topLowB;
    kickSum += kickBand * kickBand;
    topSum += topBand * topBand;
    count += 1;
    if (count === hop) {
      kick.push(Math.sqrt(kickSum / hop));
      top.push(Math.sqrt(topSum / hop));
      kickSum = 0;
      topSum = 0;
      count = 0;
    }
  }
  return { kick, top };
}

/**
 * Kick times, in seconds.
 *
 * `sensitivity` scales the adaptive threshold: lower finds more hits. It is a
 * single knob on purpose — a detector with five thresholds cannot be reasoned
 * about, and the last one that had them measured an artifact.
 */
export function detectKicks(
  samples: Float32Array | readonly number[],
  sampleRate: number,
  { sensitivity = 1, shape }: {
    sensitivity?: number;
    /** A higher-rate decode of the same audio, for the top-band gate only. */
    shape?: { samples: Float32Array | readonly number[]; sampleRate: number };
  } = {},
): KickHit[] {
  const envelope = bandEnvelopes(samples, sampleRate).kick;
  /**
   * Both bands of the gate come from ONE decode, or the comparison is meaningless.
   *
   * The first version of this measured the kick band from the 4 kHz decode and the
   * top band from the 22 kHz one. A one-pole band-difference has a gain that
   * depends on its cutoffs relative to the sample rate, so those two numbers were
   * in different units and the dominance threshold between them was arbitrary. It
   * rejected real kicks and kept other hits, and DJ heard exactly that.
   *
   * Peak-picking still uses the 4 kHz envelope, because that is the version he
   * confirmed clean. The gate is a separate, self-consistent measurement.
   */
  const gate = shape ? bandEnvelopes(shape.samples, shape.sampleRate) : null;
  if (envelope.length < 32) return [];

  // Rise against the recent past, so a sustained low note does not read as a hit.
  const rise = new Array<number>(envelope.length).fill(0);
  for (let index = 1; index < envelope.length; index += 1) {
    const from = Math.max(0, index - HISTORY_STEPS);
    rise[index] = Math.max(0, envelope[index] - median(envelope.slice(from, index)));
  }

  // Threshold follows the tune rather than sitting at a fixed level: a breakdown
  // and a full drop should both give up their kicks.
  const windowSteps = Math.max(8, Math.round(THRESHOLD_WINDOW_SECONDS / KICK_HOP_SECONDS));
  const threshold = new Array<number>(rise.length).fill(0);
  for (let index = 0; index < rise.length; index += 1) {
    const from = Math.max(0, index - (windowSteps >> 1));
    const slice = rise.slice(from, Math.min(rise.length, from + windowSteps));
    const centre = median(slice);
    const deviation = median(slice.map((value) => Math.abs(value - centre)));
    // Two bars to clear: above the local noise, and a decent share of the
    // loudest hits nearby. The second is what rejects the small stuff a purely
    // statistical threshold lets through in a busy passage.
    const loudestNearby = slice.reduce((most, value) => Math.max(most, value), 0);
    threshold[index] = Math.max(
      (centre + deviation * THRESHOLD_DEVIATIONS) * sensitivity,
      loudestNearby * LOCAL_PEAK_SHARE * sensitivity,
    );
  }

  const minimumSteps = Math.max(1, Math.round(MINIMUM_GAP_SECONDS / KICK_HOP_SECONDS));
  const hits: KickHit[] = [];
  let lastIndex = -minimumSteps;
  for (let index = 1; index < rise.length - 1; index += 1) {
    if (rise[index] < threshold[index]) continue;
    // A true peak, not a shoulder on the way up or down.
    if (rise[index] < rise[index - 1] || rise[index] < rise[index + 1]) continue;
    if (index - lastIndex < minimumSteps) {
      // Within the suppression window: keep whichever is stronger, so the leading
      // edge of a kick wins over its decay but a genuinely louder hit is not lost.
      const previous = hits.at(-1);
      if (previous && rise[index] > previous.strength) {
        previous.time = index * KICK_HOP_SECONDS;
        previous.strength = rise[index];
        lastIndex = index;
      }
      continue;
    }
    hits.push({ time: index * KICK_HOP_SECONDS, strength: rise[index] });
    lastIndex = index;
  }

  // Shape gate. A kick is nearly all fundamental; a snare, rim, clap or hat puts
  // most of its energy in the top band. Rejecting on that is far more reliable
  // than rejecting on loudness, because a loud snare passes any volume gate.
  const shapeSteps = Math.max(1, Math.round(SHAPE_WINDOW_SECONDS / KICK_HOP_SECONDS));
  const energyAround = (series: readonly number[], index: number) => {
    let total = 0;
    for (let step = index; step < Math.min(series.length, index + shapeSteps); step += 1) total += series[step] * series[step];
    return total;
  };
  const shaped = !gate ? hits : hits.filter((hit) => {
    // Every envelope is on the same 5 ms hop whatever its source rate, so a time
    // indexes into any of them.
    const index = Math.round(hit.time / KICK_HOP_SECONDS);
    const low = energyAround(gate.kick, index);
    const high = energyAround(gate.top, index);
    const total = low + high;
    return total <= 0 ? false : low / total >= LOW_DOMINANCE;
  });

  // Volume gate, relative to what survived, and only when asked for. A ghost note
  // is a real kick played quietly and the ear does not hear it as a beat — but a
  // gate that fires on the wrong hits is worse than none, so it travels with the
  // shape gate rather than applying unconditionally.
  const typical = median(shaped.map((hit) => hit.strength));
  const kept = !gate ? shaped : shaped.filter((hit) => hit.strength >= typical * STRENGTH_FLOOR);

  /**
   * Backtrack every hit to the START of its kick.
   *
   * The pick above lands on the steepest RISE — the middle of the kick's swell —
   * which DJ saw on the wave immediately: "I think you have the kicks mapped to
   * where the kick ends. We need it so it captures the whole kick including the
   * start." Measured against the drawn kick-band blobs, picks sat 30–45 ms after
   * the blob's leading edge, differently per tune.
   *
   * So from each pick, walk back down the envelope to where the swell begins:
   * stop at the local minimum (the envelope stops falling as we walk back) or
   * where energy has dropped to a small share of the kick's own peak. The time a
   * DJ cues to is where the drum starts, and now that is the time recorded.
   */
  const backtrackSteps = Math.max(1, Math.round(ONSET_BACKTRACK_SECONDS / KICK_HOP_SECONDS));
  const started = kept.map((hit) => {
    const pick = Math.round(hit.time / KICK_HOP_SECONDS);
    let peak = 0;
    for (let step = pick; step < Math.min(envelope.length, pick + 4); step += 1) peak = Math.max(peak, envelope[step]);
    let onset = pick;
    for (let step = pick; step > Math.max(0, pick - backtrackSteps); step -= 1) {
      if (envelope[step - 1] >= envelope[step]) break;
      onset = step - 1;
      if (envelope[onset] <= peak * ONSET_FLOOR_SHARE) break;
    }
    return { ...hit, time: onset * KICK_HOP_SECONDS };
  });

  const loudest = started.reduce((most, hit) => Math.max(most, hit.strength), 0) || 1;
  return started.map((hit) => ({ time: Math.round(hit.time * 1000) / 1000, strength: Math.round(hit.strength / loudest * 1000) / 1000 }));
}

/**
 * What the spacing implies, reported for sanity only.
 *
 * Never used to place anything: a kick pattern with stutters or triplet fills has
 * spacings that imply the wrong tempo, which is exactly how the last grid attempt
 * landed on 96 BPM for a 144 BPM tune.
 */
export function impliedTempo(hits: readonly KickHit[]) {
  if (hits.length < 8) return null;
  const gaps = hits.slice(1).map((hit, index) => hit.time - hits[index].time).filter((gap) => gap > 0);
  const spacing = median(gaps);
  return spacing > 0 ? Math.round(60 / spacing * 100) / 100 : null;
}

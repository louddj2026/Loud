export const BOOTH_OUTPUT_LATENCY_HINT = "balanced" as const;
// Temporary vinyl-style tempo mode: changing playback rate also changes pitch.
// Keep this as one switch so pitch-preserving time stretch can be trialled again
// without hunting through the live and private Preview player paths.
export const BOOTH_PRESERVE_PITCH = false;
// DJ, 30 Aug 2026 ("tunes can load in at 85%"): loads arrive at the
// standard handoff level instead of the old zero-fader safety. The play
// press remains the intent gate - a loaded deck is silent until played -
// but the fader no longer needs riding up from nothing on every load.
export const SAFE_LOADED_DECK_VOLUME = .85;
export const DEFAULT_DECK_CUE = true;
export const DEFAULT_HEADPHONE_MONITOR = true;
export const HEADPHONE_CUE_BUS_GAIN = .72;
export const BOOTH_EQ_FILTERS = {
  lowFrequencyHz: 250,
  midFrequencyHz: 1100,
  midQ: 1.15,
  highFrequencyHz: 3500,
} as const;
export const BOOTH_LIMITER = {
  threshold: -3,
  knee: 0,
  ratio: 20,
  attack: .003,
  release: .2,
} as const;

// DJ, 27 Aug 2026: measured at gig level, the cue bus recorded +1.87 dBFS
// true peaks â€” Chrome's DynamicsCompressor overshoots and adds makeup gain,
// so the "limiter" alone does not stop the DAC clipping. A fixed trim after
// every limiter keeps true peaks under about -1 dBFS. Linear gain for -3 dB.
export const BOOTH_OUTPUT_TRIM_DB = -3;
export const BOOTH_OUTPUT_TRIM_GAIN = Math.pow(10, BOOTH_OUTPUT_TRIM_DB / 20);

/** The BPM the room actually hears after the media element's playback rate. */
export function effectiveDeckBpm(sourceBpm: number, playbackRate: number) {
  return sourceBpm * playbackRate;
}

/** Playback rate required to make a source grid run at the requested audible BPM. */
export function tempoRateForTargetBpm(sourceBpm: number, targetBpm: number) {
  return sourceBpm > 0 ? targetBpm / sourceBpm : 1;
}

/** Wall-clock seconds between beats at the audible, rate-adjusted tempo. */
export function effectiveBeatPeriodSeconds(sourceBpm: number, playbackRate: number) {
  const bpm = effectiveDeckBpm(sourceBpm, playbackRate);
  return bpm > 0 ? 60 / bpm : Number.POSITIVE_INFINITY;
}

export function boothVisualTrackTime(mediaTime: number, duration: number) {
  const boundedDuration = Number.isFinite(duration) ? Math.max(0, duration) : Number.MAX_SAFE_INTEGER;
  const sourceTime = Number.isFinite(mediaTime) ? mediaTime : 0;
  return Math.max(0, Math.min(boundedDuration, sourceTime));
}

type RoutableDeck = {
  track: unknown;
  volume: number;
  cue: boolean;
};

/**
 * DJ, 29 Aug 2026: fixed per-deck gain, like a hardware mixer.
 *
 * The old dynamic headroom divided a shared budget by the SUM of every loaded
 * deck's fader â€” so raising a fader anywhere ducked the playing deck (deck
 * meters are pre-fader, so the drop only ever showed at the master). Gone.
 * A deck's level now depends on its own fader and nothing else.
 *
 * The ceiling is set low instead: two decks at the .85 handoff fader sum to
 * .94 pre-limiter, so a normal overlap needs no riding and no automatic duck.
 * Three decks flat out reach ~1.4 and that is exactly what the master limiter
 * and the -3 dB output trim are for. Want the room louder? The master fader
 * has the headroom.
 */
export const BOOTH_CHANNEL_GAIN = .55;

export function boothRoutingLevels<Id extends string>(
  decks: Record<Id, RoutableDeck>,
  deckIds: readonly Id[],
  headphoneMonitor: boolean,
  previewMonitor = false,
  independentHeadphones = false,
) {
  const cued = deckIds.filter((id) => decks[id].track && decks[id].cue);
  const cueGain = HEADPHONE_CUE_BUS_GAIN / Math.max(1, cued.length);
  return Object.fromEntries(deckIds.map((id) => {
    const deck = decks[id];
    return [id, {
      channelGain: deck.track ? deck.volume * BOOTH_CHANNEL_GAIN : 0,
      mainGate: independentHeadphones ? 1 : previewMonitor || headphoneMonitor ? 0 : 1,
      cueGain: !previewMonitor && (independentHeadphones || headphoneMonitor) && deck.track && deck.cue ? cueGain : 0,
    }];
  })) as Record<Id, { channelGain: number; mainGate: number; cueGain: number }>;
}

/** Level a handed-over tune opens at when the outgoing fader cannot supply one. */
export const DEFAULT_HANDOFF_VOLUME = .85;

/**
 * The level the incoming tune should reach at its Mix In cue.
 *
 * A loaded deck starts at the zero safety fader deliberately, so a tune can
 * never arrive in the room before the DJ intends it. The handoff then has to
 * raise it â€” and it cannot simply inherit the outgoing fader, because a deck
 * sitting at or near zero would hand the incoming tune silence and the mix
 * would appear to run with nothing audible.
 */
export function liveHandoffVolume(outgoingVolume: number) {
  if (!Number.isFinite(outgoingVolume) || outgoingVolume <= .001) return DEFAULT_HANDOFF_VOLUME;
  return Math.min(1, outgoingVolume);
}

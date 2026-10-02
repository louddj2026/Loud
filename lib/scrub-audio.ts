/**
 * Platter scrub policy.
 *
 * Dragging a focus waveform should sound like a hand on a record: the audio
 * under the playhead, warped to the speed the hand is moving, backwards when
 * the hand goes backwards, silent when the hand stops. This module owns the
 * decisions — velocity, rate, release, routing — so they can be tested without
 * an AudioContext. The worklet that consumes them only interpolates samples.
 *
 * Scrub audio is a monitoring tool, so it is deliberately confined to the cue
 * bus: a DJ can drag a live deck to check that the sound matches the drawn
 * wave, and the crowd keeps hearing the master untouched.
 */

/**
 * Whether the platter makes any sound at all. **Off.**
 *
 * DJ heard the first working version — 13 Aug — and called it unhinged, which it
 * was: the ceiling below was 8, and because the drag maps hand travel to wave
 * travel with gain, an ordinary sweep implies fifty times playback, so 8 was not
 * a limit occasionally reached but the rate you heard nearly always. It also had
 * no rate smoothing, so the speed stepped to a fresh value every frame and
 * frequency-modulated the tune at about 60 Hz.
 *
 * Both are fixed below and in the worklet, and **neither fix has been heard**.
 * Off until it is judged by ear rather than by argument, which on this project is
 * the only thing that has ever settled a sound. Turning it back on is this one
 * flag: nothing is fetched, decoded or held while it is false.
 */
export const SCRUB_AUDIO_ENABLED = false;

/**
 * Beyond this the platter is being thrown; faster reads are noise, not music.
 *
 * Was 8, which turned out to be the rate you heard almost all the time rather
 * than a limit you occasionally reached. The drag maps hand travel to wave travel
 * with gain, so an ordinary sweep across a 16-second window implies fifty times
 * playback — the ceiling is not an edge case, it is the normal case, and at 8 it
 * is a shriek. At 2.5 a fast drag is still obviously fast and still obviously the
 * tune, which is the whole point of scrubbing to the sound.
 */
export const SCRUB_MAX_RATE = 2.5;
/** Slower than this the hand is effectively still, and a record would go quiet. */
export const SCRUB_STILL_RATE = .02;
/** Velocity is averaged over this window so per-frame pointer jitter is not pitch. */
export const SCRUB_VELOCITY_WINDOW_SECONDS = .08;
/** Release eases rather than jumps, the way a platter picks its speed back up. */
export const SCRUB_RESUME_SECONDS = .12;
export const SCRUB_STOP_SECONDS = .08;

export type ScrubSample = {
  /** Track time under the pointer. */
  time: number;
  /** Wall clock of the sample, in seconds. */
  at: number;
};

/**
 * Track-seconds per wall-second across the recent pointer history. Positive is
 * forwards. Samples older than the window are ignored so the rate follows the
 * hand rather than the whole gesture.
 */
export function scrubVelocity(samples: ScrubSample[], windowSeconds = SCRUB_VELOCITY_WINDOW_SECONDS) {
  const usable = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.at));
  if (usable.length < 2) return 0;
  const newest = usable[usable.length - 1];
  const window = Math.max(.001, windowSeconds);
  // Walk back to the oldest sample still inside the window, keeping at least
  // one pair so a slow drag still reports motion.
  let oldest = usable[usable.length - 2];
  for (let index = usable.length - 2; index >= 0; index -= 1) {
    if (newest.at - usable[index].at > window) break;
    oldest = usable[index];
  }
  const elapsed = newest.at - oldest.at;
  if (elapsed <= 0) return 0;
  return (newest.time - oldest.time) / elapsed;
}

/**
 * The playback rate the worklet should read at. Negative means reverse; zero
 * means the record is held still and should be silent rather than droning.
 */
export function scrubRate(velocity: number) {
  if (!Number.isFinite(velocity)) return 0;
  if (Math.abs(velocity) < SCRUB_STILL_RATE) return 0;
  return Math.max(-SCRUB_MAX_RATE, Math.min(SCRUB_MAX_RATE, velocity));
}

export type ScrubRelease = {
  targetRate: number;
  rampSeconds: number;
  resumes: boolean;
};

/**
 * What happens when the hand comes off. A deck that was playing eases back to
 * its own tempo rate; a stopped deck settles to silence.
 */
export function scrubRelease(input: { wasPlaying: boolean; deckTempoRate: number }): ScrubRelease {
  const tempoRate = Number.isFinite(input.deckTempoRate) && input.deckTempoRate > 0 ? input.deckTempoRate : 1;
  return input.wasPlaying
    ? { targetRate: tempoRate, rampSeconds: SCRUB_RESUME_SECONDS, resumes: true }
    : { targetRate: 0, rampSeconds: SCRUB_STOP_SECONDS, resumes: false };
}

export type ScrubRouting = {
  toCue: boolean;
  toMaster: boolean;
  reason: "cue-only" | "silent-no-monitor";
};

/**
 * Scrub audio never reaches the master. When the deck is not being monitored
 * there is nowhere for it to go, and it stays silent rather than surprising
 * the room.
 */
export function scrubRouting(input: { deckCue: boolean; headphoneMonitor: boolean }): ScrubRouting {
  const audible = Boolean(input.deckCue && input.headphoneMonitor);
  return audible
    ? { toCue: true, toMaster: false, reason: "cue-only" }
    : { toCue: false, toMaster: false, reason: "silent-no-monitor" };
}

/**
 * Read position for the next block. The pointer owns the position outright —
 * the drawn playhead and the sound must be the same number — but the rate is
 * what the ear hears, so both travel together to the worklet.
 */
export function scrubCommand(input: {
  pointerTime: number;
  velocity: number;
  duration: number;
}) {
  const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0;
  const position = Number.isFinite(input.pointerTime)
    ? Math.max(0, duration > 0 ? Math.min(duration, input.pointerTime) : input.pointerTime)
    : 0;
  const rate = scrubRate(input.velocity);
  // Holding the platter at either end of the record makes no sound, exactly as
  // running out of groove would.
  const atEdge = duration > 0 && ((position <= 0 && rate < 0) || (position >= duration && rate > 0));
  return { position, rate: atEdge ? 0 : rate };
}

export type TransitionPreviewWindow = {
  start: number | null;
  end: number | null;
};

/**
 * Select the pair Preview should edit. Once audio is running, the physical
 * playing-deck rotation outranks stale cue/workflow history. A runtime pair is
 * authoritative only while its outgoing deck is still the playing deck.
 */
export function selectTransitionPreviewPair<TDeck, TPair>(input: {
  playingDeck: TDeck | null;
  idlePair: TPair | null;
  runtimeOutgoingDeck: TDeck | null;
  runtimePair: TPair | null;
  playingNextPair: TPair | null;
}) {
  if (input.playingDeck === null) return input.idlePair;
  if (input.runtimePair !== null && input.runtimeOutgoingDeck === input.playingDeck) return input.runtimePair;
  // While a deck is live, Preview must never reopen a completed historical
  // transition. If its successor is not ready yet, leave Preview disabled.
  return input.playingNextPair;
}

export function transitionPreviewMarkTime(input: {
  playing: boolean;
  displayedTime?: number | null;
  mediaTime?: number | null;
  stateTime: number;
  duration: number;
}) {
  // While playback is moving, the painted playhead is the user's authority.
  // Falling back to the newer media clock would reintroduce pointer-release
  // latency whenever rendering is under load. A paused deck instead uses its
  // exact state clock, which is the stationary white line the user can see.
  const candidates = input.playing
    ? [input.displayedTime, input.mediaTime, input.stateTime]
    : [input.stateTime, input.mediaTime, input.displayedTime];
  const selected = candidates.find((time): time is number => typeof time === "number" && Number.isFinite(time)) ?? 0;
  return Math.max(0, Math.min(Math.max(0, input.duration), selected));
}


export type TransitionPreviewGridBeat = {
  beat: number;
  time: number;
  isDownbeat: boolean;
};

/**
 * The grid a confirmed window declares.
 *
 * A window IS its tempo statement: the DJ says "this span is N beats", so the
 * beat length is span/N and beat zero is the start. Everything drawn or timed
 * inside Preview follows from that, and the analyser's stored grid — which has
 * been observed 8.7% wrong on a correctly marked tune — is never consulted.
 * Beats extend either side of the window so the run-up and the tail sit on the
 * same ruler as the overlap.
 */
export function transitionPreviewGridBeats(input: {
  start: number;
  end: number;
  beats: number;
  from: number;
  to: number;
}): TransitionPreviewGridBeat[] {
  const { start, end, beats, from, to } = input;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  if (!Number.isFinite(beats) || beats <= 0) return [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const beatSeconds = (end - start) / beats;
  if (!(beatSeconds > 0)) return [];
  const first = Math.floor((from - start) / beatSeconds);
  const last = Math.ceil((to - start) / beatSeconds);
  // A pathological zoom must not ask for a million lines.
  if (last - first > 20000) return [];
  const grid: TransitionPreviewGridBeat[] = [];
  for (let beat = first; beat <= last; beat += 1) {
    const time = start + beat * beatSeconds;
    if (time < 0) continue;
    // The window start is beat zero and a downbeat: it is where the DJ says
    // the phrase begins, so bars are counted from there in both directions.
    grid.push({ beat, time, isDownbeat: ((beat % 4) + 4) % 4 === 0 });
  }
  return grid;
}

export const TRANSITION_PREVIEW_LEAD_BEATS = 8;
// The incoming private player rolls silently for the same 8 beats the
// outgoing runway plays, giving the clock lock twice the settle room of the
// live path's 4-beat preroll. It still opens audibly only at X.
export const TRANSITION_PREVIEW_SILENT_PREROLL_BEATS = 8;
export const TRANSITION_PREVIEW_DEFAULT_CROWD_VOLUME = .85;
export const TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS = .25;

export type TransitionPreviewLiveRuntimeState = "none" | "matching-primary" | "matching-started" | "other";
export type TransitionPreviewLiveArmDecision = {
  action: "arm" | "update" | "save-only" | "blocked";
  reason: "ready" | "live-transition-started" | "different-runtime" | "runtime-busy" | "different-runner" | "decks-changed" | "outgoing-not-playing" | "incoming-unavailable" | "incoming-not-stopped" | "silent-preroll-passed";
};

/**
 * Decide whether Apply can attach the saved Preview pair to the existing booth
 * clock. This is deliberately pure so an async save can re-check every mutable
 * transport condition before it claims that the live mix is armed.
 */
export function transitionPreviewLiveArmDecision(input: {
  runtimeState: TransitionPreviewLiveRuntimeState;
  decksMatch: boolean;
  outgoingPlaying: boolean;
  incomingReady: boolean;
  incomingStopped: boolean;
  runtimeHealthy: boolean;
  outgoingTime: number;
  silentPrerollAt: number;
  otherRunnerActive: boolean;
}): TransitionPreviewLiveArmDecision {
  if (input.runtimeState === "matching-started") return { action: "blocked", reason: "live-transition-started" };
  if (input.runtimeState === "other") return { action: "blocked", reason: "different-runtime" };
  if (input.runtimeState === "matching-primary") {
    if (!input.runtimeHealthy) return { action: "blocked", reason: "runtime-busy" };
    if (input.otherRunnerActive) return { action: "blocked", reason: "different-runner" };
    if (!input.decksMatch) return { action: "blocked", reason: "decks-changed" };
    if (!input.outgoingPlaying) return { action: "save-only", reason: "outgoing-not-playing" };
    if (!input.incomingReady) return { action: "blocked", reason: "incoming-unavailable" };
    if (!input.incomingStopped) return { action: "blocked", reason: "incoming-not-stopped" };
    if (!Number.isFinite(input.outgoingTime) || !Number.isFinite(input.silentPrerollAt) || input.outgoingTime >= input.silentPrerollAt - TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS) {
      return { action: "blocked", reason: "silent-preroll-passed" };
    }
    return { action: "update", reason: "ready" };
  }
  if (input.otherRunnerActive) return { action: "blocked", reason: "different-runner" };
  if (!input.decksMatch) return { action: "save-only", reason: "decks-changed" };
  if (!input.outgoingPlaying) return { action: "save-only", reason: "outgoing-not-playing" };
  if (!input.incomingReady) return { action: "blocked", reason: "incoming-unavailable" };
  if (!input.incomingStopped) return { action: "blocked", reason: "incoming-not-stopped" };
  if (!Number.isFinite(input.outgoingTime) || !Number.isFinite(input.silentPrerollAt) || input.outgoingTime >= input.silentPrerollAt - TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS) {
    return { action: "blocked", reason: "silent-preroll-passed" };
  }
  return { action: "arm", reason: "ready" };
}

export function transitionPreviewCrowdAuditionVolume(liveVolume: number, followsLiveCrowdClock: boolean) {
  if (!followsLiveCrowdClock || !Number.isFinite(liveVolume) || liveVolume <= .001) return TRANSITION_PREVIEW_DEFAULT_CROWD_VOLUME;
  return Math.min(1, liveVolume);
}

export function transitionPreviewWindowReady(window: TransitionPreviewWindow) {
  return Number.isFinite(window.start)
    && Number.isFinite(window.end)
    && window.start! >= 0
    && window.end! > window.start!;
}

export function transitionPreviewTempoRate(
  outgoing: TransitionPreviewWindow,
  incoming: TransitionPreviewWindow,
) {
  if (!transitionPreviewWindowReady(outgoing) || !transitionPreviewWindowReady(incoming)) return 1;
  const outgoingSpan = outgoing.end! - outgoing.start!;
  const incomingSpan = incoming.end! - incoming.start!;
  return incomingSpan / outgoingSpan;
}

export function transitionPreviewBeat(
  currentTime: number,
  window: TransitionPreviewWindow,
  beats: number,
) {
  if (!transitionPreviewWindowReady(window) || !Number.isFinite(currentTime) || !Number.isFinite(beats)) return 0;
  const progress = (currentTime - window.start!) / (window.end! - window.start!);
  return Math.max(0, Math.min(Math.max(1, beats), progress * Math.max(1, beats)));
}

export function transitionPreviewCanCommit(
  outgoing: TransitionPreviewWindow,
  incoming: TransitionPreviewWindow,
  beats: number,
) {
  return transitionPreviewWindowReady(outgoing)
    && transitionPreviewWindowReady(incoming)
    && Number.isInteger(beats)
    && beats > 0;
}

/** Which edge of a window the DJ marked. The other edge is derived from it. */
export type TransitionPreviewAnchorEdge = "start" | "middle" | "end";

export type TransitionPreviewGridBeat2 = { time: number; attackTime?: number | null };

export type TransitionPreviewDerivedWindow =
  | { ok: true; window: TransitionPreviewWindow; anchorTime: number; derivedTime: number; landedOnAttack: boolean }
  | { ok: false; reason: string };

/**
 * How far a beat's measured attack may sit from its own grid line and still be
 * trusted as that beat's kick. Matches the drift clamp the grid itself uses: a
 * stamp further out than this is measuring something else.
 */
export const TRANSITION_PREVIEW_ATTACK_TOLERANCE_SECONDS = .12;

/**
 * Place a mix window from ONE marked edge and a beat count (DJ, 29 Aug 2026).
 *
 * The DJ marks one end — start or finish, their choice — and the overlap length
 * places the other. Beats are WALKED on the tune's own grid rather than derived
 * from a nominal BPM, so a tune whose tempo sags still gets its true 64 beats.
 *
 * `startPrefersAttack` is for the incoming tune: its start is the moment the
 * tune becomes audible, so it lands on that beat's measured attack — the kick —
 * rather than the drawn grid line, whenever the two are close enough that the
 * stamp is plainly measuring the same beat.
 */
export function deriveTransitionPreviewWindow(input: {
  beats: readonly TransitionPreviewGridBeat2[];
  anchorEdge: TransitionPreviewAnchorEdge;
  anchorTime: number;
  windowBeats: number;
  startPrefersAttack?: boolean;
}): TransitionPreviewDerivedWindow {
  const { beats, anchorEdge, anchorTime, windowBeats } = input;
  if (!Number.isFinite(anchorTime)) return { ok: false, reason: "that mark has no time" };
  if (!Number.isInteger(windowBeats) || windowBeats <= 0) return { ok: false, reason: "choose an overlap length first" };
  if (beats.length < 2) return { ok: false, reason: "this tune has no grid to count beats on" };

  let anchorIndex = 0;
  for (let index = 1; index < beats.length; index += 1) {
    if (Math.abs(beats[index].time - anchorTime) < Math.abs(beats[anchorIndex].time - anchorTime)) anchorIndex = index;
  }
  if (anchorEdge === "middle") {
    // Count half the chosen beats either side; keep the literal mark when snap
    // is off, without shifting an incoming start independently onto an attack.
    const first = anchorIndex - windowBeats / 2;
    const last = anchorIndex + windowBeats / 2;
    if (first < 0 || last > beats.length - 1) return { ok: false, reason: "half the overlap does not fit on each side of the middle" };
    const timeAt = (index: number) => {
      const low = Math.floor(index), high = Math.ceil(index);
      return beats[low].time + (beats[high].time - beats[low].time) * (index - low);
    };
    const offset = anchorTime - beats[anchorIndex].time;
    const start = timeAt(first) + offset;
    const end = timeAt(last) + offset;
    if (!(start >= 0 && end > start && end <= beats[beats.length - 1].time)) return { ok: false, reason: "the centred overlap runs outside this tune's grid" };
    return { ok: true, window: { start, end }, anchorTime, derivedTime: end, landedOnAttack: false };
  }
  const derivedIndex = anchorEdge === "start" ? anchorIndex + windowBeats : anchorIndex - windowBeats;
  if (derivedIndex < 0) return { ok: false, reason: `${windowBeats} beats runs off the front of the tune` };
  if (derivedIndex > beats.length - 1) return { ok: false, reason: `${windowBeats} beats runs past the end of the tune` };

  const startIndex = Math.min(anchorIndex, derivedIndex);
  const endIndex = Math.max(anchorIndex, derivedIndex);
  const startBeat = beats[startIndex];
  const attack = input.startPrefersAttack
    && typeof startBeat.attackTime === "number"
    && Number.isFinite(startBeat.attackTime)
    && Math.abs(startBeat.attackTime - startBeat.time) <= TRANSITION_PREVIEW_ATTACK_TOLERANCE_SECONDS
    ? startBeat.attackTime
    : null;
  const start = Math.max(0, attack ?? startBeat.time);
  const end = beats[endIndex].time;
  if (!(end > start)) return { ok: false, reason: "that would make a window with no length" };
  return {
    ok: true,
    window: { start, end },
    anchorTime: anchorEdge === "start" ? start : end,
    derivedTime: anchorEdge === "start" ? end : start,
    landedOnAttack: attack !== null,
  };
}

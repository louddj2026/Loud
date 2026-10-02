/**
 * The drum-stem grid, asked for on deck load and reported back to the booth.
 *
 * The chain behind it is a separation, a kick detection and a consensus fit —
 * ~35 s of GPU the first time, then seconds from the cached stem. Loading a tune
 * is the moment before playing it, so nothing here blocks a deck load: every
 * accessor answers synchronously from the cache and a tune with no result yet
 * simply keeps the grid it already has.
 *
 * Whether the booth is quiet is not tracked twice. It is a property of the whole
 * booth and `section-labels.ts` already owns it, so both analysers read the same
 * report and the same trust window governs both.
 *
 * The grid is applied where there is nothing to protect; the cue is only ever
 * proposed. That asymmetry is measured, not cautious: a grid fitted to a tune's
 * own kicks came back 33 clean of 42 by ear, while the cue's chorus is right every
 * time and its 32-beat phrase is not.
 */
import type { LabelCueProposal } from "./label-cue.ts";
import { boothIsIdle } from "./section-labels.ts";

const ENDPOINT = "/api/drum-analysis";

export type DrumAnalysisStatus = {
  running: string | null;
  runningName: string | null;
  stage: "separating" | "detecting" | "fitting" | null;
  queued: string[];
  completed: number;
  failed: number;
  lastError: string | null;
  boothIdle: boolean;
  waitingForIdle: boolean;
};

export type DrumGridProposal = {
  bpm: number;
  firstBeatMs: number;
  beatCount: number;
  /** Share of detected kicks the grid lands on, 0..1. */
  explains: number;
  /** Share of grid beats with a kick on them, 0..1. */
  covered: number;
  medianErrorMs: number;
  kicksDetected: number | null;
  computedAt: string;
};

export type DrumGridApplied = {
  applied: boolean;
  /** Said in the booth either way: a held grid is never a silence. */
  because: string;
  analysis?: unknown;
  undoToken?: string;
  bpm?: number;
  /** Cues placed on the tune, said plainly. Empty when there were none to place. */
  cuesPlaced?: string[];
  /** A refusal about this moment — a live deck, or labels not in yet. */
  retry?: boolean;
};

/** Both roles: the rule anchors an entry and an exit on opposite choruses. */
export type DrumCueProposals = {
  mixIn: LabelCueProposal | null;
  mixOut: LabelCueProposal | null;
};

export type DrumGridResult = {
  ready: boolean;
  grid: DrumGridProposal | null;
  cue: DrumCueProposals | null;
  sections: number;
  /**
   * The kick map, in seconds — where the drums hit, as detected.
   *
   * A separate thing from the grid and deliberately so. The grid is a metronome:
   * regular by construction, because its job is tempo and two tunes have to stay
   * locked across a long overlap. This is the record of what the drummer or the
   * producer actually did, which on anything with feel is a few milliseconds off
   * the beat and different every bar. Drawing both is the only honest answer to
   * "is the kick on the grid" — sometimes it genuinely is not, and that is the
   * tune rather than a fault.
   */
  kicks: readonly number[];
  /**
   * How hard each kick hit, 0..1000, matching `kicks`.
   *
   * Carried so the wave can draw confidence rather than apply a cutoff. Nothing
   * is removed from the map: a stutter is a real hit, and a detection at strength
   * 2 is noise, and the difference between those two is exactly what an eye
   * settles faster than a threshold.
   */
  strengths: readonly number[];
};

type Feed = {
  trackId?: string;
  ready?: boolean;
  grid?: DrumGridProposal;
  cue?: DrumCueProposals | null;
  sections?: number;
  /** Whole milliseconds on the wire; seconds everywhere in the booth. */
  kicks?: number[];
  kickStrengths?: number[];
  queued?: boolean;
  apply?: DrumGridApplied;
  status?: DrumAnalysisStatus;
};

const results = new Map<string, DrumGridResult>();
/** One apply attempt per track per session, whatever its outcome. */
const applied = new Map<string, DrumGridApplied>();
let latestStatus: DrumAnalysisStatus | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

export function onDrumGridChanged(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * On unless switched off — the opposite of section labelling, deliberately.
 *
 * Loading a tune is meant to grid it: separate the drums, fit to the kicks,
 * apply. The separation is ~35 s of GPU and it waits for silence, but it is the
 * point of the feature rather than an extra, so the switch exists to stop it and
 * not to start it.
 */
let autoAnalyseOnLoad = true;

export function setDrumAutoAnalyse(enabled: boolean) {
  if (autoAnalyseOnLoad === enabled) return;
  autoAnalyseOnLoad = enabled;
  // Announce it: flipping the switch on should act on the tune already loaded.
  announce();
}

export function drumAutoAnalyseEnabled() {
  return autoAnalyseOnLoad;
}

function absorb(feed: Feed) {
  if (feed.status) latestStatus = feed.status;
  if (feed.trackId) {
    const previous = results.get(feed.trackId);
    results.set(feed.trackId, {
      ready: feed.ready === true,
      grid: feed.grid ?? null,
      cue: feed.cue ?? null,
      sections: feed.sections ?? 0,
      // An apply response carries no kick map, so keep the one already held
      // rather than blanking the wave the moment a grid lands.
      kicks: feed.kicks ? feed.kicks.map((ms) => ms / 1000) : previous?.kicks ?? [],
      strengths: feed.kicks ? feed.kickStrengths ?? [] : previous?.strengths ?? [],
    });
    // A refusal that was about the moment is not remembered, so a grid held
    // because a deck was live is applied when the booth next falls quiet.
    if (feed.apply && !feed.apply.retry) applied.set(feed.trackId, feed.apply);
  }
  announce();
}

/** Synchronous, and null until this track has been asked about. */
export function drumGridFor(trackId: string | null | undefined): DrumGridResult | null {
  return trackId ? results.get(trackId) ?? null : null;
}

export function drumApplyFor(trackId: string | null | undefined): DrumGridApplied | null {
  return trackId ? applied.get(trackId) ?? null : null;
}

export function drumAnalysisStatus() {
  return latestStatus;
}

/**
 * Ask about a track, and carry whether the booth is quiet.
 *
 * With no track id it is a heartbeat, which is how a poll waiting on a job keeps
 * the idle report inside its trust window. Never throws: a booth that cannot reach
 * the analyser draws the grid it already has.
 */
export async function requestDrumAnalysis(trackId: string | null, idle = boothIsIdle(), durationSeconds = 0) {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      // The deck's own duration travels with the ask. Uploaded tracks carry zero
      // in the library index, and the cue proposal needs a real length to place a
      // position in the tune against.
      body: JSON.stringify({ ...(trackId ? { trackId } : {}), boothIdle: idle, durationSeconds }),
    });
    if (!response.ok) return null;
    const feed = await response.json() as Feed;
    absorb(feed);
    return feed.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Put the fitted grid on the tune, if the server agrees there is nothing to
 * protect.
 *
 * Every refusal — a grid already judged by ear, a manual grid, a fit outside the
 * flam line, a tempo that disagrees metrically — is decided server-side, where the
 * verdict file and the stored analysis are. The booth asks once and reports what
 * came back.
 */
export async function applyDrumGrid(trackId: string, idle = boothIsIdle(), durationSeconds = 0): Promise<DrumGridApplied | null> {
  if (!trackId || applied.has(trackId)) return applied.get(trackId) ?? null;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ trackId, apply: true, boothIdle: idle, durationSeconds }),
    });
    if (!response.ok) return null;
    const feed = await response.json() as Feed;
    absorb(feed);
    return feed.apply ?? null;
  } catch {
    return null;
  }
}

/** True once this track has been asked to apply, whatever the answer was. */
export function drumApplyAttempted(trackId: string | null | undefined) {
  return !!trackId && applied.has(trackId);
}

/**
 * Forget a remembered apply so the settle loop asks again.
 *
 * Exists for one situation: a tune was gridded before its section labels
 * arrived, so the apply that was cached placed no cues — there were no labels
 * to cue from — and the cache then blocks the re-apply that could. The caller
 * decides when that situation holds (and must rate-limit itself; forgetting on
 * every render would re-apply forever on a tune label-cue cannot cue).
 */
export function forgetDrumApply(trackId: string | null | undefined) {
  return !!trackId && applied.delete(trackId);
}

/** Test seam. */
export function resetDrumGrids() {
  results.clear();
  applied.clear();
  latestStatus = null;
  autoAnalyseOnLoad = true;
  listeners.clear();
}

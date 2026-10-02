import { summariseLoadProgress, type LoadProgressSnapshot } from "./load-progress.ts";

/**
 * Following one tune's mapping job from the booth: request it, then ask the
 * server where it is until it is mapped, stopped or cancelled.
 *
 * DJ, 26 Sep 2026: the old loop threw on the first failed poll (one network
 * blip killed the load) and dressed the wait up with a creeping step and an
 * "about Ns left" countdown. Here, every update carries the last snapshot the
 * server actually sent and the connection's own state, so the deck can say
 * "no answer from the booth server for 23 s" apart from "Demucs block 38 of
 * 62" — an unresponsive server is never shown as slow work, or the reverse.
 *
 * Pure apart from the injected fetches, clock and wait, so it is testable.
 */

export type MappingConnection = {
  /** Client time of the last request the server answered. */
  lastAnswerAt: number | null;
  /** Consecutive requests without an answer; 0 while the server answers. */
  failures: number;
  failingSince: number | null;
  lastError: string | null;
};

export type MappingUpdate = {
  /** The last snapshot the server sent — kept, unchanged, while the connection fails. */
  snapshot: LoadProgressSnapshot | null;
  /** Client time that snapshot arrived. */
  receivedAt: number | null;
  connection: MappingConnection;
  /** Jobs requested again after the server lost them (a restarted server). */
  restarts: number;
};

/** The server answered and refused: not a connection problem, so not retried. */
export class MappingRequestError extends Error {}

export type MappedTrackState = {
  mapped: boolean;
  job?: { state?: string; error?: string } | null;
  loadProgress?: LoadProgressSnapshot | null;
};

export type FollowMappingOptions<T extends MappedTrackState> = {
  trackName: string;
  /** POST the job (recovery = the server had lost it). Throws MappingRequestError for a refusal. */
  start: (recovery: boolean) => Promise<void>;
  /** GET the track's state. Throws on no answer (network, timeout). */
  poll: () => Promise<T>;
  onUpdate: (update: MappingUpdate) => void;
  cancelled: () => boolean;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
  intervalMs?: number;
  /** Stop only after the server has not answered for this long. */
  giveUpAfterMs?: number;
  maxRestarts?: number;
};

export const MAPPING_POLL_INTERVAL_MS = 1000;
export const MAPPING_GIVE_UP_AFTER_MS = 120_000;

export async function followMapping<T extends MappedTrackState>(options: FollowMappingOptions<T>): Promise<T> {
  const interval = options.intervalMs ?? MAPPING_POLL_INTERVAL_MS;
  const giveUpAfter = options.giveUpAfterMs ?? MAPPING_GIVE_UP_AFTER_MS;
  const maxRestarts = options.maxRestarts ?? 2;
  let snapshot: LoadProgressSnapshot | null = null;
  let receivedAt: number | null = null;
  let restarts = 0;
  const connection: MappingConnection = { lastAnswerAt: null, failures: 0, failingSince: null, lastError: null };
  const publish = () => options.onUpdate({ snapshot, receivedAt, connection: { ...connection }, restarts });
  const answered = () => {
    connection.lastAnswerAt = options.now();
    connection.failures = 0;
    connection.failingSince = null;
    connection.lastError = null;
  };
  const noAnswer = (error: unknown) => {
    if (error instanceof MappingRequestError) throw error;
    const now = options.now();
    connection.failures += 1;
    connection.failingSince ??= now;
    connection.lastError = error instanceof Error ? error.message : String(error);
    publish();
    if (now - connection.failingSince >= giveUpAfter) {
      const lastKnown = snapshot ? ` · last known: ${summariseLoadProgress(snapshot)}` : "";
      throw new Error(`The booth server has not answered for ${Math.round((now - connection.failingSince) / 1000)} s (${connection.failures} requests)${lastKnown}`);
    }
  };
  const backoff = () => Math.min(5000, interval * Math.max(1, connection.failures));
  const checkCancelled = () => { if (options.cancelled()) throw new Error("mapping cancelled"); };

  for (;;) {
    checkCancelled();
    try { await options.start(false); answered(); break; }
    catch (error) { noAnswer(error); await options.wait(backoff()); }
  }
  publish();
  for (;;) {
    checkCancelled();
    let current: T;
    try { current = await options.poll(); }
    catch (error) { noAnswer(error); await options.wait(backoff()); continue; }
    answered();
    const incoming = current.loadProgress ?? null;
    // A different job id is a new attempt and replaces the old one outright;
    // the same job only ever moves forward.
    if (incoming && (!snapshot || incoming.jobId !== snapshot.jobId || incoming.serverNow >= snapshot.serverNow)) {
      snapshot = incoming;
      receivedAt = options.now();
    }
    publish();
    if (current.job?.state === "error") throw new Error(current.job.error ?? `${options.trackName} mapping stopped`);
    if (current.mapped) return current;
    if (!current.job) {
      if (restarts >= maxRestarts) throw new Error(`${options.trackName}'s mapping worker repeatedly disappeared before the tune could load`);
      restarts += 1;
      try { await options.start(true); answered(); } catch (error) { noAnswer(error); }
      publish();
      await options.wait(500);
      continue;
    }
    await options.wait(interval);
  }
}

/** One line for a status field that is not the deck panel (live mode, assisted status). */
export function describeMappingUpdate(update: MappingUpdate, clientNow: number) {
  const where = update.snapshot ? summariseLoadProgress(update.snapshot) : "Requesting analysis";
  const { connection } = update;
  if (connection.failures > 0 && connection.failingSince !== null) {
    const silent = Math.round((clientNow - (connection.lastAnswerAt ?? connection.failingSince)) / 1000);
    return `No answer from the booth server for ${silent} s · last known: ${where}`;
  }
  return update.restarts ? `${where} · analysis re-requested ${update.restarts}×` : where;
}

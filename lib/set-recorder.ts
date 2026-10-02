/**
 * Set recording and replay — Traktor's two modes, DJ 28 Aug 2026.
 *
 * AUDIO: the booth hands `startRecording` a tap node on the master bus
 * (post-limiter, post-trim: exactly the room signal). MediaRecorder captures
 * webm/opus locally; stop() uploads the blob and the server transcodes to
 * WAV + MP3.
 *
 * ACTIONS: the booth calls `recordAction` from its own choke points
 * (loadTrack, changeDeck patches, transport, stabs, seeks, loops). Every set
 * is a file on disk — `<id>.actions.json` — so a set recorded tonight can be
 * browsed for and replayed next week: `listRecordings()` is the browse,
 * `startReplay(id)` loads one back by name, and `replayActions()` takes a log
 * handed straight from a file the DJ picked off disk. Replay feeds the
 * actions back through callbacks the booth registers, on the original
 * schedule — the booth reproduces the mix itself, exactly as the grid rules
 * would have it, rather than replaying a bounce.
 *
 * The module is deliberately booth-agnostic: no imports from dj-booth, all
 * coupling via the callbacks object.
 */

export type SetAction = {
  /** milliseconds since recording start */
  t: number;
  kind: "load" | "deck-patch" | "play" | "pause" | "seek" | "stab-start" | "stab-end" | "master-volume" | "note";
  deck?: string;
  trackId?: string;
  /** JSON-safe payload; deck-patch carries the changeDeck patch minus functions */
  data?: Record<string, unknown>;
};

/** One recorded set as the browser lists it. */
export type SetSummary = {
  id: string;
  recordedAt: string | null;
  actions: number;
  durationMs: number;
  tracks: string[];
  artefacts: Record<string, number>;
};

export type ReplayCallbacks = {
  load: (deck: string, trackId: string) => Promise<void> | void;
  deckPatch: (deck: string, patch: Record<string, unknown>) => void;
  play: (deck: string) => void;
  pause: (deck: string) => void;
  seek: (deck: string, time: number) => void;
  stabStart: (deck: string) => void;
  stabEnd: (deck: string) => void;
  masterVolume: (value: number) => void;
  status: (text: string) => void;
};

type RecorderState = {
  id: string | null;
  startedAt: number;
  actions: SetAction[];
  media: MediaRecorder | null;
  chunks: Blob[];
};

const state: RecorderState = { id: null, startedAt: 0, actions: [], media: null, chunks: [] };
let replayTimers: Array<ReturnType<typeof setTimeout>> = [];
let replayingLabel: string | null = null;

export function recordingId() { return state.id; }
export function isRecording() { return state.id !== null; }
export function isReplaying() { return replayingLabel !== null; }
export function replayingSet() { return replayingLabel; }

export function recordAction(action: Omit<SetAction, "t">) {
  if (!state.id) return;
  state.actions.push({ t: Math.round(performance.now() - state.startedAt), ...action });
}

export function startRecording(tap: MediaStreamAudioDestinationNode | null) {
  if (state.id) return state.id;
  const stamp = new Date();
  state.id = `set-${stamp.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  state.startedAt = performance.now();
  state.actions = [];
  state.chunks = [];
  if (tap) {
    try {
      const media = new MediaRecorder(tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 256_000 });
      media.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
      media.start(4000); // gather in 4s chunks so a crash loses seconds, not the set
      state.media = media;
    } catch {
      state.media = null; // audio capture unavailable; the action log still records
    }
  }
  recordAction({ kind: "note", data: { note: "recording started" } });
  return state.id;
}

export async function stopRecording(): Promise<{ id: string; actions: number; audioBytes: number } | null> {
  const id = state.id;
  if (!id) return null;
  recordAction({ kind: "note", data: { note: "recording stopped" } });
  const actions = state.actions.slice();
  const media = state.media;
  state.id = null;
  state.media = null;

  let audioBytes = 0;
  if (media && media.state !== "inactive") {
    const flushed = new Promise<void>((resolve) => { media.onstop = () => resolve(); });
    media.stop();
    await flushed;
    const blob = new Blob(state.chunks, { type: "audio/webm" });
    audioBytes = blob.size;
    if (blob.size) {
      await fetch(`/api/set-recordings?id=${encodeURIComponent(id)}&kind=audio`, { method: "POST", body: blob })
        .catch(() => undefined);
    }
  }
  state.chunks = [];
  await fetch(`/api/set-recordings?id=${encodeURIComponent(id)}&kind=actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), actions }),
  }).catch(() => undefined);
  return { id, actions: actions.length, audioBytes };
}

/** Every set on disk, newest first — what the REPLAY INPUTS browser lists. */
export async function listRecordings(): Promise<SetSummary[]> {
  const payload = await fetch("/api/set-recordings?list=1")
    .then((response) => response.ok ? response.json() as Promise<{ recordings: SetSummary[] }> : null)
    .catch(() => null);
  return payload?.recordings ?? [];
}

/** Reads a set file the DJ picked off disk. Throws with a readable reason. */
export async function readSetFile(file: File): Promise<{ actions: SetAction[]; recordedAt: string | null }> {
  const text = await file.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${file.name} is not a set file (not JSON)`); }
  const body = (parsed ?? {}) as { actions?: unknown; recordedAt?: unknown };
  const actions = Array.isArray(body.actions)
    ? body.actions as SetAction[]
    : Array.isArray(parsed) ? parsed as SetAction[] : null;
  if (!actions?.length) throw new Error(`${file.name} holds no actions`);
  if (typeof actions[0]?.t !== "number") throw new Error(`${file.name} is not a Crowd2 set file`);
  return { actions, recordedAt: typeof body.recordedAt === "string" ? body.recordedAt : null };
}

export function stopReplay() {
  for (const timer of replayTimers) clearTimeout(timer);
  replayTimers = [];
  replayingLabel = null;
}

/**
 * Drives the booth from an action log.
 *
 * Two fields never replay as raw state, whatever the log says: `playing` goes
 * through the transport callbacks (a state patch would light the button while
 * the deck stayed silent) and `currentTime` is dropped (the tune's own
 * playback carries position; deliberate jumps arrive as `seek`). Logs
 * recorded before 28 Aug 2026 carry both, so the stripping happens here and
 * not only at the recording end.
 */
export function replayActions(actions: SetAction[], callbacks: ReplayCallbacks, label: string) {
  stopReplay();
  if (!actions.length) { callbacks.status("That set holds no actions"); return false; }
  replayingLabel = label;
  callbacks.status(`Replaying ${label} · ${actions.length} actions · the booth drives itself`);
  for (const action of actions) {
    replayTimers.push(setTimeout(() => {
      switch (action.kind) {
        case "load": if (action.deck && action.trackId) void callbacks.load(action.deck, action.trackId); break;
        case "deck-patch": {
          if (!action.deck || !action.data) break;
          const patch = { ...action.data };
          const playing = patch.playing;
          delete patch.playing;
          delete patch.currentTime;
          delete patch.cuePreviewing;
          if (Object.keys(patch).length) callbacks.deckPatch(action.deck, patch);
          if (playing === true) callbacks.play(action.deck);
          if (playing === false) callbacks.pause(action.deck);
          break;
        }
        case "play": if (action.deck) callbacks.play(action.deck); break;
        case "pause": if (action.deck) callbacks.pause(action.deck); break;
        case "seek": if (action.deck && typeof action.data?.time === "number") callbacks.seek(action.deck, action.data.time as number); break;
        case "stab-start": if (action.deck) callbacks.stabStart(action.deck); break;
        case "stab-end": if (action.deck) callbacks.stabEnd(action.deck); break;
        case "master-volume": if (typeof action.data?.value === "number") callbacks.masterVolume(action.data.value as number); break;
        default: break;
      }
    }, action.t));
  }
  const last = actions[actions.length - 1];
  replayTimers.push(setTimeout(() => { replayingLabel = null; callbacks.status(`Replay of ${label} finished`); }, last.t + 500));
  return true;
}

/** Loads one saved set by id and replays it. */
export async function startReplay(id: string, callbacks: ReplayCallbacks) {
  const payload = await fetch(`/api/set-recordings?id=${encodeURIComponent(id)}&kind=actions`)
    .then((response) => response.ok ? response.json() as Promise<{ actions: SetAction[] }> : null)
    .catch(() => null);
  if (!payload?.actions?.length) {
    callbacks.status(`No action log found for ${id}`);
    return false;
  }
  return replayActions(payload.actions, callbacks, id);
}

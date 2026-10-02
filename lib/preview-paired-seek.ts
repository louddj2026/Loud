import type { TransitionPreviewWindow } from "./transition-preview.ts";

/** One overlap fraction maps to both literal source windows, even at different tempos. */
export function previewMixSeekPoint(input: {
  role: "outgoing" | "incoming";
  time: number;
  outgoing: TransitionPreviewWindow;
  incoming: TransitionPreviewWindow;
  beats: number;
  snap: boolean;
}) {
  const { outgoing, incoming } = input;
  if (!Number.isFinite(input.time) || !Number.isFinite(input.beats) || input.beats <= 0) return null;
  if (outgoing.start === null || outgoing.end === null || incoming.start === null || incoming.end === null) return null;
  if (![outgoing.start, outgoing.end, incoming.start, incoming.end].every(Number.isFinite)
    || outgoing.end <= outgoing.start || incoming.end <= incoming.start) return null;
  const selected = input.role === "outgoing" ? outgoing : incoming;
  let fraction = Math.max(0, Math.min(1, (input.time - selected.start!) / (selected.end! - selected.start!)));
  if (input.snap) fraction = Math.round(fraction * input.beats) / input.beats;
  return {
    outgoingTime: outgoing.start + fraction * (outgoing.end - outgoing.start),
    incomingTime: incoming.start + fraction * (incoming.end - incoming.start),
    beat: fraction * input.beats,
  };
}

type PrivatePlayer = Pick<HTMLAudioElement, "currentTime" | "seeking" | "readyState" | "addEventListener" | "removeEventListener" | "play" | "pause">;

/** Both private decoders must land before either receives play(). */
export async function seekAndPlayPreviewPair(input: {
  outgoing: PrivatePlayer;
  incoming: PrivatePlayer;
  outgoingTime: number;
  incomingTime: number;
  isCurrent: () => boolean;
}) {
  const land = (audio: PrivatePlayer, time: number) => new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      audio.removeEventListener("seeked", ready);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("loadeddata", ready);
      audio.removeEventListener("error", failed);
      if (error) reject(error); else resolve();
    };
    const ready = () => { if (!audio.seeking && audio.readyState >= 2) finish(); };
    const failed = () => finish(new Error("A private preview player could not seek"));
    const timeout = setTimeout(() => finish(new Error("The private preview seek timed out")), 10_000);
    audio.addEventListener("seeked", ready);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("loadeddata", ready);
    audio.addEventListener("error", failed);
    try {
      if (Math.abs(audio.currentTime - time) > .000001) audio.currentTime = time;
      ready();
    } catch (error) { finish(error instanceof Error ? error : new Error("Private preview seek failed")); }
  });
  try {
    await Promise.all([land(input.outgoing, input.outgoingTime), land(input.incoming, input.incomingTime)]);
    if (!input.isCurrent()) return false;
    // Issue both starts in one turn, never await one before starting the other.
    await Promise.all([input.outgoing.play(), input.incoming.play()]);
    return input.isCurrent();
  } catch (error) {
    if (input.isCurrent()) { input.outgoing.pause(); input.incoming.pause(); throw error; }
    return false;
  }
}

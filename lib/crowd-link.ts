export const CROWD_LINK_REACTIONS = ["🔥", "🫶", "😮", "🌀", "💥", "🚀", "💚", "👀"] as const;
export const CROWD_PEER_NEGOTIATION_TIMEOUT_MS = 15_000;
// Longer than the listener's negotiation timeout so a repeated audience-ready
// beacon cannot tear down a legitimate slow mobile negotiation mid-flight.
export const CROWD_PEER_RETRY_GRACE_MS = 20_000;
export const CROWD_AUDIENCE_READY_INTERVAL_MS = 10_000;
export const CROWD_POLL_RETRY_BASE_MS = 500;
export const CROWD_POLL_RETRY_MAX_MS = 8_000;
/**
 * Give host and server-reflexive candidates time to land in the SDP itself.
 *
 * CrowdLink used to publish the offer/answer immediately and depend entirely
 * on separate trickle-ICE POSTs. A brief mobile fetch failure could therefore
 * deliver both descriptions but no viable cross-device candidate. We still
 * trickle candidates, but the normal path now carries them in one self-
 * contained signalling message as well.
 */
export const CROWD_ICE_GATHER_TIMEOUT_MS = 4_000;

export async function waitForCrowdIceGathering(
  peer: RTCPeerConnection,
  timeoutMs = CROWD_ICE_GATHER_TIMEOUT_MS,
) {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, Math.max(0, timeoutMs));
    peer.addEventListener("icegatheringstatechange", onStateChange);
    // Cover a completion that raced the listener registration.
    onStateChange();
  });
}

export function crowdPeerCanContinue(state: RTCPeerConnectionState, ageMs: number) {
  return state === "connected"
    || ((state === "new" || state === "connecting") && ageMs < CROWD_PEER_RETRY_GRACE_MS);
}

export function crowdPollRetryDelay(failureCount: number) {
  if (failureCount <= 0) return 0;
  return Math.min(
    CROWD_POLL_RETRY_MAX_MS,
    CROWD_POLL_RETRY_BASE_MS * (2 ** Math.min(failureCount - 1, 8)),
  );
}

export function crowdRtcConfiguration(): RTCConfiguration {
  return {
    // Local-network sharing needs no external address-discovery service.
    // A future internet mode must explicitly configure an authenticated relay.
    iceServers: [],
    iceCandidatePoolSize: 2,
  };
}

export type CrowdLinkEventType =
  | "audience-ready"
  | "audience-left"
  | "offer"
  | "answer"
  | "dj-ice"
  | "dj-error"
  | "dj-peer-state"
  | "crowd-ice"
  | "crowd-error"
  | "reaction"
  | "reaction-ack";

export type CrowdLinkEvent = {
  sequence: number;
  type: CrowdLinkEventType;
  clientId: string;
  targetId?: string;
  data?: unknown;
  sentAt: number;
};

export type CrowdLinkPost = Omit<CrowdLinkEvent, "sequence" | "sentAt">;

const DJ_AUTHORISED_EVENT_TYPES = new Set<CrowdLinkEventType>([
  "offer",
  "dj-ice",
  "dj-error",
  "dj-peer-state",
  "reaction-ack",
]);

export function crowdLinkEventRequiresDjAuth(type: CrowdLinkEventType) {
  return DJ_AUTHORISED_EVENT_TYPES.has(type);
}

export function crowdLinkEventIsForDj(event: CrowdLinkEvent) {
  return event.type === "audience-ready"
    || event.type === "audience-left"
    || event.type === "answer"
    || event.type === "crowd-ice"
    || event.type === "crowd-error"
    || event.type === "reaction";
}

export function crowdLinkEventIsForListener(event: CrowdLinkEvent, clientId: string) {
  return event.targetId === clientId
    && (event.type === "offer" || event.type === "dj-ice" || event.type === "dj-error" || event.type === "dj-peer-state" || event.type === "reaction-ack");
}

/**
 * DJ, 29 Aug 2026 ("audio on the laptop keeps dropping out - please
 * strengthen"): how long a peer in the "disconnected" state is left alone
 * before anyone renegotiates. WebRTC's disconnected is usually a transient
 * WiFi blip that self-heals in a couple of seconds; the old behaviour asked
 * the booth for a fresh peer immediately, turning every blip into a
 * multi-second teardown-and-renegotiate dropout.
 */
export const CROWD_PEER_DISCONNECT_GRACE_MS = 12_000;
/**
 * Receiver-side jitter cushion. The crowd stream trades latency for calm —
 * a remote listener never notices 2.5 s of delay, but WiFi burst-loss longer
 * than the buffer is an audible hole no FEC can fill. Raised 0.25 -> 1.0 ->
 * 2.5 across the dropout hunts of 29-30 Aug 2026 at DJ's direction.
 */
export const CROWD_JITTER_TARGET_SECONDS = 2.5;
/** Media watchdog: consider the stream stalled after this long with no bytes. */
export const CROWD_MEDIA_STALL_MS = 6_000;

/**
 * Harden the Opus leg of an SDP for music over lossy WiFi: in-band FEC so a
 * lost packet is partially recoverable from its neighbour, stereo, and a
 * music-grade bitrate ceiling. Existing unrelated fmtp params are kept.
 */
export function strengthenCrowdOpusSdp(sdp: string) {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!rtpmap) return sdp;
  const payload = rtpmap[1];
  const wanted = ["useinbandfec=1", "stereo=1", "sprop-stereo=1", "maxaveragebitrate=256000"];
  const fmtpPattern = new RegExp(`a=fmtp:${payload} ([^\r\n]*)`);
  const existing = sdp.match(fmtpPattern);
  if (existing) {
    const kept = existing[1].split(";").map((param) => param.trim()).filter(Boolean)
      .filter((param) => !wanted.some((add) => add.split("=")[0] === param.split("=")[0]));
    return sdp.replace(fmtpPattern, `a=fmtp:${payload} ${[...kept, ...wanted].join(";")}`);
  }
  return sdp.replace(
    new RegExp(`(a=rtpmap:${payload} opus/48000/2\r?\n)`),
    `$1a=fmtp:${payload} ${wanted.join(";")}\r\n`,
  );
}

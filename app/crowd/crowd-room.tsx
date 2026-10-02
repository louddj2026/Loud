"use client";

import Link from "next/link";
import { createListenerWakeLock, type ListenerWakeState } from "../../lib/listener-wake-lock";
import { useEffect, useRef, useState } from "react";
import { reportClientDiagnostic } from "../../lib/client-diagnostics-client";
import { BOOTH_VISUAL_DIRECTIONS, type BoothVisualDirection } from "../dj/dj-ui-config";
import { PauseTransportIcon, PlayTransportIcon } from "../dj/transport-icons";
import {
  CROWD_AUDIENCE_READY_INTERVAL_MS,
  CROWD_JITTER_TARGET_SECONDS,
  CROWD_LINK_REACTIONS,
  CROWD_MEDIA_STALL_MS,
  CROWD_PEER_DISCONNECT_GRACE_MS,
  CROWD_PEER_NEGOTIATION_TIMEOUT_MS,
  crowdPollRetryDelay,
  strengthenCrowdOpusSdp,
  crowdRtcConfiguration,
  waitForCrowdIceGathering,
  type CrowdLinkEvent,
  type CrowdLinkPost,
} from "../../lib/crowd-link";

type ListeningState = "idle" | "connecting" | "ready" | "live" | "waiting" | "error";
type CopyState = "idle" | "copied" | "error";

function newCrowdId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function postCrowdEvent(event: CrowdLinkPost) {
  const response = await fetch("/api/crowd-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`Crowd link returned ${response.status}`);
  return response.json() as Promise<{ sequence: number }>;
}

export default function CrowdRoom() {
  const [visualDirection, setVisualDirection] = useState<BoothVisualDirection>("specialist");
  const [clientId, setClientId] = useState("");
  const [listening, setListening] = useState<ListeningState>("idle");
  const [wantsAudio, setWantsAudio] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [lastReaction, setLastReaction] = useState("");
  const [connectionDetail, setConnectionDetail] = useState("");
  const [reactionStatus, setReactionStatus] = useState("Tap a reaction. Let the DJ feel the room.");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [wakeState, setWakeState] = useState<ListenerWakeState>("off");
  const playbackActions = useRef({ play: () => {}, pause: () => {}, recover: () => {} });
  const recoveryInFlight = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const fallbackPlaybackRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const cursor = useRef(0);
  const wantsAudioRef = useRef(false);
  const listenRequestInFlight = useRef(false);
  // Dropout resilience (DJ, 29 Aug 2026): when the peer went "disconnected"
  // and whether media bytes are still arriving. A transient WiFi blip is
  // ridden out in place; only a blip that outlives the grace, a stalled
  // stream, or a hard failure asks the booth for a fresh peer.
  const peerDisconnectedAt = useRef<number | null>(null);
  const mediaWatch = useRef<{ timer: ReturnType<typeof setInterval>; lastBytes: number; lastGrowth: number } | null>(null);
  const disconnectFallbackPlayback = () => {
    fallbackPlaybackRef.current?.disconnect();
    fallbackPlaybackRef.current = null;
  };
  const primeCrowdPlayback = async () => {
    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    let context = playbackContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContextConstructor();
      playbackContextRef.current = context;
    }
    context.onstatechange = () => {
      if (context.state !== "running" && wantsAudioRef.current && fallbackPlaybackRef.current) playbackActions.current.recover();
    };
    if (context.state !== "running") await context.resume();
    // iOS Safari only grants audio output while handling the user's tap. A
    // silent frame consumes that grant now, before the remote stream exists.
    const unlock = context.createBufferSource();
    unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
    unlock.connect(context.destination);
    unlock.start();
    return context;
  };
  const startFallbackPlayback = async (stream: MediaStream, mayResume: boolean) => {
    let context = playbackContextRef.current;
    if ((!context || context.state === "closed") && mayResume) context = await primeCrowdPlayback();
    if (!context) return false;
    if (context.state !== "running") {
      if (!mayResume) return false;
      try { await context.resume(); } catch { return false; }
    }
    if (!wantsAudioRef.current) return false;
    disconnectFallbackPlayback();
    const source = context.createMediaStreamSource(stream);
    source.connect(context.destination);
    fallbackPlaybackRef.current = source;
    return true;
  };
  const playReceivedAudio = async (stream: MediaStream, mayResumeFallback = false) => {
    const audio = audioRef.current;
    if (!audio) return false;
    if (audio.srcObject !== stream) audio.srcObject = stream;
    if (!wantsAudioRef.current) return false;
    audio.defaultMuted = false;
    audio.muted = false;
    audio.volume = 1;
    try {
      await audio.play();
      if (!wantsAudioRef.current) { audio.pause(); return false; }
      if (!audio.paused) {
        disconnectFallbackPlayback();
        setListening("live");
        setConnectionDetail("Local audio path connected · playback started");
        return true;
      }
    } catch {
      // WebKit commonly rejects this because negotiation completed after the
      // tap. The already-unlocked Web Audio context below carries the stream.
    }
    if (await startFallbackPlayback(stream, mayResumeFallback)) {
      setListening("live");
      setConnectionDetail("Local audio path connected · iPhone playback started");
      return true;
    }
    setListening("ready");
    setConnectionDetail("Audio is connected · tap Play connected audio");
    return false;
  };
  const clearReceivedAudio = () => {
    disconnectFallbackPlayback();
    const audio = audioRef.current;
    if (!audio) return;
    const stream = audio.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    audio.pause();
    audio.srcObject = null;
  };

  useEffect(() => {
    const syncBoothStyle = () => {
      try {
        const stored = localStorage.getItem("crowd2-visual-direction-v1");
        if (BOOTH_VISUAL_DIRECTIONS.some((direction) => direction.id === stored)) {
          setVisualDirection(stored as BoothVisualDirection);
        }
      } catch { /* The default booth palette also works without browser storage. */ }
    };
    syncBoothStyle();
    window.addEventListener("storage", syncBoothStyle);
    return () => window.removeEventListener("storage", syncBoothStyle);
  }, []);

  useEffect(() => {
    // Boot beacon: a crowd page that renders but never logs this line is a
    // stale cached shell whose script never ran — the "dead button" disease.
    // The stamp below is what the inline stale-shell watcher in page.tsx
    // checks before declaring the page a zombie.
    (window as typeof window & { __crowd2Hydrated?: boolean }).__crowd2Hydrated = true;
    reportClientDiagnostic("crowd-page-boot", { userAgent: navigator.userAgent });
    setClientId(newCrowdId());
    void fetch("/api/network", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ crowdUrl?: string | null }>)
      .then((network) => setShareUrl(network.crowdUrl || window.location.href))
      .catch(() => setShareUrl(window.location.href));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const handleOffer = async (event: CrowdLinkEvent) => {
      peerRef.current?.close();
      clearReceivedAudio();
      setConnectionDetail("Booth answered · negotiating the local audio path");
      const peer = new RTCPeerConnection(crowdRtcConfiguration());
      peerRef.current = peer;
      const connectionTimer = setTimeout(() => {
        if (peerRef.current === peer && peer.connectionState !== "connected") {
          peer.close();
          peerRef.current = null;
          clearReceivedAudio();
          setListening("waiting");
          setConnectionDetail("Audio path timed out · Loud is asking the booth to try again");
        }
      }, CROWD_PEER_NEGOTIATION_TIMEOUT_MS);
      peer.ontrack = (trackEvent) => {
        // A quarter-second jitter cushion: the crowd stream happily trades
        // latency for fewer audible holes on lossy WiFi.
        try { (trackEvent.receiver as unknown as { jitterBufferTarget?: number }).jitterBufferTarget = CROWD_JITTER_TARGET_SECONDS; } catch { /* older engines */ }
        const stream = trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
        void playReceivedAudio(stream);
      };
      peer.onicecandidate = (iceEvent) => {
        if (iceEvent.candidate) void postCrowdEvent({ type: "crowd-ice", clientId, targetId: "dj", data: iceEvent.candidate.toJSON() });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          clearTimeout(connectionTimer);
          peerDisconnectedAt.current = null;
          setConnectionDetail("Local audio path connected");
          setListening((audioRef.current && !audioRef.current.paused) || fallbackPlaybackRef.current ? "live" : "ready");
        } else if (peer.connectionState === "failed") {
          clearTimeout(connectionTimer);
          if (peerRef.current === peer) peerRef.current = null;
          clearReceivedAudio();
          peerDisconnectedAt.current = Date.now() - CROWD_PEER_DISCONNECT_GRACE_MS;
          setListening("waiting");
          setConnectionDetail("The audio path failed · asking the booth for a fresh one");
        } else if (peer.connectionState === "disconnected") {
          // Usually a transient blip that self-heals; ride it out in place.
          // The announce loop only renegotiates once the grace expires.
          clearTimeout(connectionTimer);
          peerDisconnectedAt.current ??= Date.now();
          setConnectionDetail("Network hiccup · riding it out before asking for a new path");
        }
      };
      // Media watchdog: state can say "connected" while no audio arrives.
      // Bytes stalled past the limit = a real dropout; close so the announce
      // loop renegotiates instead of sitting silent forever.
      if (mediaWatch.current) clearInterval(mediaWatch.current.timer);
      mediaWatch.current = {
        lastBytes: 0,
        lastGrowth: Date.now(),
        timer: setInterval(() => {
          const watch = mediaWatch.current;
          if (!watch || peerRef.current !== peer) return;
          if (peer.connectionState !== "connected") return;
          void peer.getStats().then((report) => {
            let bytes = 0;
            report.forEach((entry) => {
              if ((entry as { type?: string }).type === "inbound-rtp") bytes += (entry as { bytesReceived?: number }).bytesReceived ?? 0;
            });
            if (bytes > watch.lastBytes) {
              watch.lastBytes = bytes;
              watch.lastGrowth = Date.now();
            } else if (Date.now() - watch.lastGrowth > CROWD_MEDIA_STALL_MS) {
              clearInterval(watch.timer);
              mediaWatch.current = null;
              peer.close();
              if (peerRef.current === peer) peerRef.current = null;
              clearReceivedAudio();
              peerDisconnectedAt.current = Date.now() - CROWD_PEER_DISCONNECT_GRACE_MS;
              setListening("waiting");
              setConnectionDetail("The stream stalled · asking the booth for a fresh audio path");
            }
          }).catch(() => undefined);
        }, 2000),
      };
      await peer.setRemoteDescription(event.data as RTCSessionDescriptionInit);
      for (const candidate of pendingIce.current.splice(0)) await peer.addIceCandidate(candidate).catch(() => undefined);
      const answer = await peer.createAnswer();
      const hardened = { type: answer.type, sdp: strengthenCrowdOpusSdp(answer.sdp ?? "") } as RTCSessionDescriptionInit;
      await peer.setLocalDescription(hardened);
      await waitForCrowdIceGathering(peer);
      const gatheredAnswer = peer.localDescription
        ? { type: peer.localDescription.type, sdp: strengthenCrowdOpusSdp(peer.localDescription.sdp ?? "") }
        : hardened;
      await postCrowdEvent({ type: "answer", clientId, targetId: "dj", data: gatheredAnswer });
    };
    const poll = async () => {
      try {
        const response = await fetch(`/api/crowd-link?role=crowd&clientId=${encodeURIComponent(clientId)}&after=${cursor.current}&wait=1`, { cache: "no-store" });
        if (!response.ok) throw new Error("Crowd link is unavailable");
        const payload = await response.json() as { cursor: number; events: CrowdLinkEvent[] };
        consecutiveFailures = 0;
        cursor.current = payload.cursor;
        for (const event of payload.events) {
          if (event.type === "offer") await handleOffer(event);
          if (event.type === "dj-error") {
            const detail = event.data as { message?: unknown } | null;
            setListening("error");
            setConnectionDetail(typeof detail?.message === "string" ? detail.message : "The booth could not start the live mix");
          }
          if (event.type === "dj-peer-state") {
            const detail = event.data as { state?: unknown } | null;
            if (detail?.state === "connected") {
              const audio = audioRef.current;
              const stream = audio?.srcObject;
              if (stream instanceof MediaStream) void playReceivedAudio(stream);
            }
          }
          if (event.type === "reaction-ack") {
            const detail = event.data as { emoji?: unknown } | null;
            const emoji = typeof detail?.emoji === "string" ? detail.emoji : "";
            setReactionStatus(`Booth received ${emoji}`.trim());
          }
          if (event.type === "dj-ice") {
            const candidate = event.data as RTCIceCandidateInit;
            if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(candidate).catch(() => undefined);
            else pendingIce.current.push(candidate);
          }
        }
      } catch (error) {
        consecutiveFailures += 1;
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        // Signalling can be throttled in the background while WebRTC audio is healthy.
        const audioPlaying = Boolean(audioRef.current && !audioRef.current.paused) || Boolean(fallbackPlaybackRef.current && playbackContextRef.current?.state === "running");
        if (wantsAudioRef.current && !audioPlaying) {
          setListening("waiting");
          setConnectionDetail(`Phone audio setup stopped: ${message}`);
        }
        void postCrowdEvent({ type: "crowd-error", clientId, targetId: "dj", data: { message } }).catch(() => undefined);
      } finally {
        if (!cancelled) timer = setTimeout(poll, crowdPollRetryDelay(consecutiveFailures));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      peerRef.current?.close();
      peerRef.current = null;
      clearReceivedAudio();
      if (mediaWatch.current) { clearInterval(mediaWatch.current.timer); mediaWatch.current = null; }
    };
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !wantsAudio || listening === "live") return;
    const announce = () => void postCrowdEvent({ type: "audience-ready", clientId, data: { userAgent: navigator.userAgent } });
    const timer = setInterval(() => {
      const peerState = peerRef.current?.connectionState;
      const graceExpired = peerDisconnectedAt.current !== null && Date.now() - peerDisconnectedAt.current >= CROWD_PEER_DISCONNECT_GRACE_MS;
      if (!peerRef.current || peerState === "failed" || peerState === "closed" || (peerState === "disconnected" && graceExpired)) announce();
    }, CROWD_AUDIENCE_READY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [clientId, wantsAudio, listening]);

  useEffect(() => {
    if (!clientId) return;
    const leave = () => {
      const body = new Blob([JSON.stringify({ type: "audience-left", clientId, targetId: "dj" })], { type: "application/json" });
      navigator.sendBeacon("/api/crowd-link", body);
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [clientId]);

  // DJ, 26 Aug 2026: strict autoplay (phones, and desktops with the policy
  // hardened) refuses the play() that runs after async WebRTC negotiation —
  // by then the tap's user activation is spent, and DURING negotiation the
  // main button is disabled, so a second tap feels dead. Once the stream is
  // connected, ANY press on the page is the play gesture.
  useEffect(() => {
    if (listening !== "ready" || !wantsAudio) return;
    const resume = () => {
      const stream = audioRef.current?.srcObject;
      if (!(stream instanceof MediaStream)) return;
      void primeCrowdPlayback()
        .then(() => playReceivedAudio(stream, true))
        .catch(() => undefined);
    };
    document.addEventListener("pointerdown", resume);
    return () => document.removeEventListener("pointerdown", resume);
  }, [listening, wantsAudio]);

  // A real wake lock reports whether the screen is actually protected. Hidden
  // pages lose it by browser policy; returning reacquires it without touching audio.
  useEffect(() => {
    const controller = createListenerWakeLock({
      request: navigator.wakeLock ? () => navigator.wakeLock.request("screen") : undefined,
      visible: () => document.visibilityState === "visible",
      report: setWakeState,
    });
    controller.setEnabled(wantsAudio && listening === "live");
    const refresh = () => void controller.refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("pointerdown", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("pointerdown", refresh);
      controller.dispose();
    };
  }, [wantsAudio, listening]);

  // Switching tabs never disconnects or pauses the receiver. If the browser
  // interrupted it, make one recovery attempt per lifecycle event, retaining
  // the user's explicit pause choice. OS media controls use that same choice.
  useEffect(() => {
    const recover = () => playbackActions.current.recover();
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("pageshow", recover);
    window.addEventListener("online", recover);
    const session = navigator.mediaSession;
    if (session) {
      if (typeof MediaMetadata !== "undefined") session.metadata = new MediaMetadata({ title: "LoudLink · Live mix", artist: "Loud" });
      for (const [action, handler] of [
        ["play", () => playbackActions.current.play()],
        ["pause", () => playbackActions.current.pause()],
        ["stop", () => playbackActions.current.pause()],
      ] as const) {
        try { session.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
      }
    }
    return () => {
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("pageshow", recover);
      window.removeEventListener("online", recover);
      if (session) {
        for (const action of ["play", "pause", "stop"] as const) {
          try { session.setActionHandler(action, null); } catch { /* Unsupported action. */ }
        }
        session.metadata = null;
        session.playbackState = "none";
      }
    };
  }, []);
  useEffect(() => {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = listening === "live" && wantsAudio ? "playing" : wantsAudio || listening === "ready" ? "paused" : "none";
  }, [listening, wantsAudio]);

  const startListening = async () => {
    reportClientDiagnostic("crowd-page-listen-click", {
      listening,
      hasStream: Boolean(audioRef.current?.srcObject),
      inFlight: listenRequestInFlight.current,
      userAgent: navigator.userAgent,
    });
    if (listenRequestInFlight.current || listening === "connecting") return;
    listenRequestInFlight.current = true;
    // This call begins synchronously inside the button click. That timing is
    // essential on iPhone; waiting for the WebRTC offer spends user activation.
    const audioUnlock = primeCrowdPlayback().catch(() => null);
    wantsAudioRef.current = true;
    setWantsAudio(true);
    const audio = audioRef.current;
    if (audio?.srcObject && peerRef.current?.connectionState === "connected") {
      try {
        await audioUnlock;
        const stream = audio.srcObject;
        if (stream instanceof MediaStream && await playReceivedAudio(stream, true)) return;
      } catch {
        setListening("ready");
        setConnectionDetail("Audio is connected · tap the play control below");
      } finally {
        listenRequestInFlight.current = false;
      }
      return;
    }
    if (audio?.srcObject) clearReceivedAudio();
    setListening("connecting");
    setConnectionDetail("Phone reached Loud · waiting for the DJ booth to answer");
    try {
      await audioUnlock;
      if (clientId) await postCrowdEvent({ type: "audience-ready", clientId, data: { userAgent: navigator.userAgent } });
    } catch {
      setListening("error");
      setConnectionDetail("The phone could not reach the booth link");
    } finally {
      listenRequestInFlight.current = false;
    }
  };
  const pauseListening = () => {
    wantsAudioRef.current = false;
    setWantsAudio(false);
    disconnectFallbackPlayback();
    audioRef.current?.pause();
    void playbackContextRef.current?.suspend().catch(() => undefined);
    setListening("ready");
    setConnectionDetail("Audio is connected · playback paused");
  };
  const recoverPlayback = async () => {
    if (!wantsAudioRef.current || recoveryInFlight.current) return;
    const audio = audioRef.current;
    const stream = audio?.srcObject;
    if (!audio || !(stream instanceof MediaStream) || !stream.active) return;
    if (!audio.paused && !fallbackPlaybackRef.current) return;
    recoveryInFlight.current = true;
    try {
      // Prefer the native media element: mobile OS background media support
      // is stronger than an AudioContext-only path. Never create a second feed.
      await playReceivedAudio(stream, true);
      if (!wantsAudioRef.current) pauseListening();
    } catch {
      if (wantsAudioRef.current) {
        setListening("ready");
        setConnectionDetail("Browser interrupted playback · tap Play Mix to resume");
      }
    } finally { recoveryInFlight.current = false; }
  };
  playbackActions.current = {
    play: () => { void startListening(); },
    pause: pauseListening,
    recover: () => { void recoverPlayback(); },
  };
  const toggleListening = async () => {
    if (listening === "live") pauseListening();
    else await startListening();
  };

  const react = async (emoji: string) => {
    if (!clientId) return;
    setLastReaction(emoji);
    setReactionStatus(`Sending ${emoji}…`);
    try {
      await postCrowdEvent({
        type: "reaction",
        clientId,
        targetId: "dj",
        data: { emoji, reactionId: newCrowdId() },
      });
      setReactionStatus(`Sent ${emoji} · waiting for the booth`);
    } catch {
      setReactionStatus(`${emoji} could not reach Loud`);
    }
    setTimeout(() => setLastReaction((current) => current === emoji ? "" : current), 850);
  };
  const copyLink = async () => {
    const target = shareUrl || window.location.href;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(target);
        setCopyState("copied");
        return;
      } catch {
        // LAN pages may not have secure-context clipboard access.
      }
    }
    const field = document.createElement("textarea");
    field.value = target;
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    setCopyState(copied ? "copied" : "error");
  };
  const handleAudioPlay = () => {
    if (!wantsAudioRef.current) { audioRef.current?.pause(); return; }
    disconnectFallbackPlayback();
    setListening("live");
    setConnectionDetail("Local audio path connected · playback started");
  };
  const handleAudioPause = () => {
    if (!wantsAudioRef.current) return;
    if (fallbackPlaybackRef.current) return;
    if (audioRef.current?.srcObject instanceof MediaStream && audioRef.current.srcObject.active && !audioRef.current.ended) {
      void recoverPlayback();
      return;
    }
    setListening(audioRef.current?.srcObject ? "ready" : "waiting");
    setConnectionDetail(audioRef.current?.srcObject
      ? "Audio is connected · playback paused"
      : "The live mix ended · waiting for the DJ booth");
  };

  const statusCopy = listening === "live"
    ? "LIVE MIX IS PLAYING"
    : listening === "ready"
      ? "AUDIO CONNECTED · TAP TO PLAY"
    : listening === "connecting"
      ? "CONNECTING TO THE BOOTH"
      : listening === "waiting"
        ? "WAITING FOR THE DJ BOOTH"
        : listening === "error"
          ? "CONNECTION NEEDS ANOTHER TRY"
          : "READY WHEN YOU ARE";

  return <main className={`crowd-room visual-${visualDirection}`}>
    <header><div className="brand-mark"><span>LOUD</span></div><div className="booth-brand"><p className="eyebrow">LOUD / LISTENER DECK</p><h1>LOUDLINK</h1></div><nav><Link href="/dj">DJ BOOTH</Link></nav></header>
    <section className="crowd-hero">
      <p className="eyebrow">THE OTHER SIDE OF THE BOOTH</p>
      <h2>Is it Loud in here<br /> <span>or is it just me....</span></h2>
      <p>Listen live. React when it hits. Your reactions light up the DJ’s decks.</p>
    </section>
    <section className={`crowd-listen-card ${listening}`}>
      <div className="crowd-live-orb" aria-hidden="true" />
      <div aria-live="polite"><small>01 / LIVE MIX</small><b>{statusCopy}</b><span>{connectionDetail || (listening === "live" ? "You’re listening to the booth’s live mix" : "The DJ booth needs to be open to join the mix")}</span></div>
      <button type="button" className={listening === "live" ? "crowd-play active" : "crowd-play"} disabled={!clientId || listening === "connecting"} onClick={() => void toggleListening()}><span className="cdj-icon-bezel">{listening === "live" ? <PauseTransportIcon /> : <PlayTransportIcon />}</span><b>{listening === "live" ? "PAUSE MIX" : listening === "connecting" ? "CONNECTING…" : listening === "ready" ? "PLAY MIX" : "JOIN THE MIX"}</b></button>
      <audio ref={audioRef} autoPlay playsInline aria-label="Loud live DJ mix" onPlay={handleAudioPlay} onPause={handleAudioPause} onEnded={handleAudioPause} onEmptied={handleAudioPause} />
      {wantsAudio && listening === "live" && <p role="status">{wakeState === "held" ? "Screen kept awake while LoudLink is visible · audio continues when you switch tabs" : wakeState === "background" ? "Background audio active · screen wake protection returns when you reopen LoudLink" : "Audio continues when you switch tabs · screen wake protection unavailable in this browser or connection"}</p>}
    </section>
    <section className="crowd-feedback">
      <div><p className="eyebrow">02 / REACTION DECK</p><h3>Let the booth feel it.</h3><span aria-live="polite">{reactionStatus}</span></div>
      <div className="crowd-emoji-grid">{CROWD_LINK_REACTIONS.map((emoji) => <button type="button" key={emoji} disabled={!clientId} className={lastReaction === emoji ? "sent" : ""} onClick={() => void react(emoji)} aria-label={`Send ${emoji} reaction`}>{emoji}</button>)}</div>
    </section>
    <section className="crowd-share">
      <div><small>03 / BRING YOUR CROWD</small><b>{shareUrl || "/crowd"}</b></div>
      <button type="button" onClick={() => void copyLink()}>{copyState === "copied" ? "COPIED ✓" : copyState === "error" ? "COPY FAILED · RETRY" : "COPY LINK"}</button>
    </section>
  </main>;
}

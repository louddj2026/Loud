import assert from "node:assert/strict";
import test from "node:test";
import {
  CROWD_PEER_RETRY_GRACE_MS,
  crowdLinkEventIsForDj,
  crowdLinkEventIsForListener,
  crowdLinkEventRequiresDjAuth,
  crowdPeerCanContinue,
  crowdPollRetryDelay,
  waitForCrowdIceGathering,
} from "../lib/crowd-link.ts";

const event = (type, targetId) => ({ sequence: 1, type, clientId: "listener-a", targetId, sentAt: Date.now() });

test("DJ receives listener presence, answers, ICE and reactions", () => {
  for (const type of ["audience-ready", "audience-left", "answer", "crowd-ice", "reaction"]) {
    assert.equal(crowdLinkEventIsForDj(event(type)), true, type);
  }
  assert.equal(crowdLinkEventIsForDj(event("offer", "listener-a")), false);
});

test("each crowd listener only receives its own offer and DJ ICE", () => {
  assert.equal(crowdLinkEventIsForListener(event("offer", "listener-a"), "listener-a"), true);
  assert.equal(crowdLinkEventIsForListener(event("dj-ice", "listener-a"), "listener-a"), true);
  assert.equal(crowdLinkEventIsForListener(event("dj-error", "listener-a"), "listener-a"), true);
  assert.equal(crowdLinkEventIsForListener(event("reaction-ack", "listener-a"), "listener-a"), true);
  assert.equal(crowdLinkEventIsForListener(event("offer", "listener-b"), "listener-a"), false);
  assert.equal(crowdLinkEventIsForListener(event("reaction", "listener-a"), "listener-a"), false);
});

test("only booth-originated events require the private DJ token", () => {
  for (const type of ["offer", "dj-ice", "dj-error", "dj-peer-state", "reaction-ack"]) {
    assert.equal(crowdLinkEventRequiresDjAuth(type), true, type);
  }
  for (const type of ["audience-ready", "audience-left", "answer", "crowd-ice", "crowd-error", "reaction"]) {
    assert.equal(crowdLinkEventRequiresDjAuth(type), false, type);
  }
});

test("an in-progress crowd peer survives the audience retry window", () => {
  assert.equal(crowdPeerCanContinue("connected", CROWD_PEER_RETRY_GRACE_MS * 2), true);
  assert.equal(crowdPeerCanContinue("new", CROWD_PEER_RETRY_GRACE_MS - 1), true);
  assert.equal(crowdPeerCanContinue("connecting", CROWD_PEER_RETRY_GRACE_MS - 1), true);
  assert.equal(crowdPeerCanContinue("connecting", CROWD_PEER_RETRY_GRACE_MS), false);
  assert.equal(crowdPeerCanContinue("failed", 0), false);
});

test("crowd polling retries immediately after success and backs off after failures", () => {
  assert.equal(crowdPollRetryDelay(0), 0);
  assert.equal(crowdPollRetryDelay(1), 500);
  assert.equal(crowdPollRetryDelay(2), 1_000);
  assert.equal(crowdPollRetryDelay(5), 8_000);
  assert.equal(crowdPollRetryDelay(50), 8_000);
});

test("ICE gathering waits for a self-contained description", async () => {
  class FakePeer extends EventTarget {
    iceGatheringState = "gathering";
  }
  const peer = new FakePeer();
  const waiting = waitForCrowdIceGathering(peer, 1_000);
  peer.iceGatheringState = "complete";
  peer.dispatchEvent(new Event("icegatheringstatechange"));
  await waiting;
  assert.equal(peer.iceGatheringState, "complete");
});

test("ICE gathering has a bounded fallback when STUN is unavailable", async () => {
  class FakePeer extends EventTarget {
    iceGatheringState = "gathering";
  }
  const started = Date.now();
  await waitForCrowdIceGathering(new FakePeer(), 5);
  assert.ok(Date.now() - started < 500);
});

// ---------------------------------------------------------------------------
// Dropout strengthening (DJ, 29 Aug 2026): the Opus hardener.
test("strengthenCrowdOpusSdp adds FEC, stereo and a music bitrate to a bare opus leg", async () => {
  const { strengthenCrowdOpusSdp } = await import("../lib/crowd-link.ts");
  const bare = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\n";
  const hardened = strengthenCrowdOpusSdp(bare);
  assert.match(hardened, /a=fmtp:111 useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000\r\n/);
  assert.match(hardened, /a=rtcp-fb:111 transport-cc/);
});

test("strengthenCrowdOpusSdp merges with an existing fmtp without duplicating", async () => {
  const { strengthenCrowdOpusSdp } = await import("../lib/crowd-link.ts");
  const existing = "a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0\r\n";
  const hardened = strengthenCrowdOpusSdp(existing);
  assert.match(hardened, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);
  assert.doesNotMatch(hardened, /useinbandfec=0/);
  // Idempotent: hardening twice changes nothing further.
  assert.equal(strengthenCrowdOpusSdp(hardened), hardened);
});

test("strengthenCrowdOpusSdp leaves non-opus sdp untouched", async () => {
  const { strengthenCrowdOpusSdp } = await import("../lib/crowd-link.ts");
  const video = "a=rtpmap:96 VP8/90000\r\n";
  assert.equal(strengthenCrowdOpusSdp(video), video);
});

 test("local LoudLink does not contact external STUN services", async () => {
  const { crowdRtcConfiguration } = await import("../lib/crowd-link.ts");
  assert.deepEqual(crowdRtcConfiguration().iceServers, []);
});

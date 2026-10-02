import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/crowd-link/route.ts";

const endpoint = "http://localhost/api/crowd-link";
const token = "test-dj-token";

test("an inactive DJ long poll waits instead of creating a success retry loop", async (context) => {
  const previousToken = process.env.CROWD_DJ_TOKEN;
  const relayState = globalThis.__crowd2CrowdLink;
  const lease = { activeDjId: relayState.activeDjId, activeDjSeenAt: relayState.activeDjSeenAt, activeDjBroadcasting: relayState.activeDjBroadcasting, activeDjVisible: relayState.activeDjVisible };
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    Object.assign(relayState, lease);
    if (previousToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = previousToken;
  });
  const auth = { Authorization: `Bearer ${token}` };
  await GET(new Request(`${endpoint}?role=dj&djId=performance-active&broadcasting=1`, { headers: auth }));
  const initial = await GET(new Request(`${endpoint}?role=dj&djId=performance-inactive`, { headers: auth }));
  const { cursor } = await initial.json();
  let resolved = false;
  const waiting = GET(new Request(`${endpoint}?role=dj&djId=performance-inactive&after=${cursor}&wait=1`, { headers: auth }))
    .then((response) => { resolved = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(resolved, false);
  await POST(new Request(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "reaction", clientId: "performance-listener", data: { emoji: "🔥" } }),
  }));
  const payload = await (await waiting).json();
  assert.equal(payload.active, false);
  assert.equal(payload.events.length, 1);
});

test("a visible booth takes the lease from a hidden non-broadcasting tab", async (context) => {
  const previousToken = process.env.CROWD_DJ_TOKEN;
  const relayState = globalThis.__crowd2CrowdLink;
  const lease = { activeDjId: relayState.activeDjId, activeDjSeenAt: relayState.activeDjSeenAt, activeDjBroadcasting: relayState.activeDjBroadcasting, activeDjVisible: relayState.activeDjVisible };
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    Object.assign(relayState, lease);
    if (previousToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = previousToken;
  });
  Object.assign(relayState, {
    activeDjId: "hidden-booth",
    activeDjSeenAt: Date.now(),
    activeDjBroadcasting: false,
    activeDjVisible: false,
  });
  const response = await GET(new Request(`${endpoint}?role=dj&djId=visible-booth&visible=1&broadcasting=0`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const payload = await response.json();
  assert.equal(payload.active, true);
  assert.equal(relayState.activeDjId, "visible-booth");
  assert.equal(relayState.activeDjVisible, true);
});

test("an inactive booth preserves listener events for a later handover", async (context) => {
  const previousToken = process.env.CROWD_DJ_TOKEN;
  const relayState = globalThis.__crowd2CrowdLink;
  const snapshot = {
    activeDjId: relayState.activeDjId,
    activeDjSeenAt: relayState.activeDjSeenAt,
    activeDjBroadcasting: relayState.activeDjBroadcasting,
    activeDjVisible: relayState.activeDjVisible,
    sequence: relayState.sequence,
    events: [...relayState.events],
  };
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    Object.assign(relayState, snapshot, { events: snapshot.events });
    if (previousToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = previousToken;
  });
  Object.assign(relayState, {
    activeDjId: "current-booth",
    activeDjSeenAt: Date.now(),
    activeDjBroadcasting: true,
    activeDjVisible: true,
  });
  const after = relayState.sequence;
  await POST(new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "audience-ready", clientId: "waiting-listener" }),
  }));
  const inactive = await GET(new Request(`${endpoint}?role=dj&djId=next-booth&visible=1&after=${after}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const inactivePayload = await inactive.json();
  assert.equal(inactivePayload.active, false);
  assert.equal(inactivePayload.cursor, after);
  relayState.activeDjSeenAt = Date.now() - 16_000;
  const active = await GET(new Request(`${endpoint}?role=dj&djId=next-booth&visible=1&after=${inactivePayload.cursor}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const activePayload = await active.json();
  assert.equal(activePayload.active, true);
  assert.equal(activePayload.events.some((event) => event.type === "audience-ready" && event.clientId === "waiting-listener"), true);
});

function request(path, options = {}) {
  return new Request(`${endpoint}${path}`, options);
}

test("the public relay protects booth reads and booth-originated writes", async (context) => {
  const original = process.env.CROWD_DJ_TOKEN;
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    if (original === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = original;
  });

  const unauthorisedRead = await GET(request("?role=dj&djId=test-dj&after=0"));
  assert.equal(unauthorisedRead.status, 401);

  const unauthorisedOffer = await POST(request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "offer", clientId: "dj", targetId: "listener-a", data: {} }),
  }));
  assert.equal(unauthorisedOffer.status, 401);

  const audienceReady = await POST(request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "audience-ready", clientId: "listener-a" }),
  }));
  assert.equal(audienceReady.status, 200);
});

test("long polling wakes only when a targeted listener event arrives", async (context) => {
  const original = process.env.CROWD_DJ_TOKEN;
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    if (original === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = original;
  });

  const initial = await GET(request("?role=crowd&clientId=listener-long-poll&after=0"));
  const { cursor } = await initial.json();
  const waiting = GET(request(`?role=crowd&clientId=listener-long-poll&after=${cursor}&wait=1`));

  await POST(request("", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "offer",
      clientId: "dj",
      targetId: "listener-long-poll",
      data: { type: "offer", sdp: "test" },
    }),
  }));

  const response = await Promise.race([
    waiting,
    new Promise((_, reject) => setTimeout(() => reject(new Error("long poll did not wake")), 1_000)),
  ]);
  const payload = await response.json();
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].type, "offer");
  assert.equal(payload.events[0].targetId, "listener-long-poll");
});

test("the relay fails closed for DJ traffic when CROWD_DJ_TOKEN is unset", async (context) => {
  const originalToken = process.env.CROWD_DJ_TOKEN;
  const originalOptIn = process.env.CROWD_ALLOW_ANONYMOUS_DJ;
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.CROWD_DJ_TOKEN;
  delete process.env.CROWD_ALLOW_ANONYMOUS_DJ;
  process.env.NODE_ENV = "production";
  context.after(() => {
    if (originalToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = originalToken;
    if (originalOptIn === undefined) delete process.env.CROWD_ALLOW_ANONYMOUS_DJ;
    else process.env.CROWD_ALLOW_ANONYMOUS_DJ = originalOptIn;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  const anonymousRead = await GET(request("?role=dj&djId=fail-closed-dj&after=0"));
  assert.equal(anonymousRead.status, 401);

  const forgedOffer = await POST(request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "offer", clientId: "impostor", targetId: "listener-a", data: {} }),
  }));
  assert.equal(forgedOffer.status, 401);

  const forgedIce = await POST(request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "dj-ice", clientId: "impostor", targetId: "listener-a", data: {} }),
  }));
  assert.equal(forgedIce.status, 401);

  const audienceReady = await POST(request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "audience-ready", clientId: "listener-fail-closed" }),
  }));
  assert.equal(audienceReady.status, 200);
});

test("an empty CROWD_DJ_TOKEN counts as unset and still fails closed", async (context) => {
  const originalToken = process.env.CROWD_DJ_TOKEN;
  const originalOptIn = process.env.CROWD_ALLOW_ANONYMOUS_DJ;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.CROWD_DJ_TOKEN = "   ";
  delete process.env.CROWD_ALLOW_ANONYMOUS_DJ;
  process.env.NODE_ENV = "production";
  context.after(() => {
    if (originalToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = originalToken;
    if (originalOptIn === undefined) delete process.env.CROWD_ALLOW_ANONYMOUS_DJ;
    else process.env.CROWD_ALLOW_ANONYMOUS_DJ = originalOptIn;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  const anonymousRead = await GET(request("?role=dj&djId=blank-token-dj&after=0"));
  assert.equal(anonymousRead.status, 401);
});

test("anonymous DJ mode requires the explicit CROWD_ALLOW_ANONYMOUS_DJ opt-in", async (context) => {
  const originalToken = process.env.CROWD_DJ_TOKEN;
  const originalOptIn = process.env.CROWD_ALLOW_ANONYMOUS_DJ;
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.CROWD_DJ_TOKEN;
  process.env.CROWD_ALLOW_ANONYMOUS_DJ = "1";
  process.env.NODE_ENV = "production";
  context.after(() => {
    if (originalToken === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = originalToken;
    if (originalOptIn === undefined) delete process.env.CROWD_ALLOW_ANONYMOUS_DJ;
    else process.env.CROWD_ALLOW_ANONYMOUS_DJ = originalOptIn;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  const optedInRead = await GET(request("?role=dj&djId=opt-in-dj&after=0"));
  assert.equal(optedInRead.status, 200);
  const payload = await optedInRead.json();
  assert.equal(payload.active, true);
});

test("a same-length wrong token is rejected by the timing-safe comparison", async (context) => {
  const original = process.env.CROWD_DJ_TOKEN;
  process.env.CROWD_DJ_TOKEN = token;
  context.after(() => {
    if (original === undefined) delete process.env.CROWD_DJ_TOKEN;
    else process.env.CROWD_DJ_TOKEN = original;
  });

  const wrongToken = token.slice(0, -1) + (token.endsWith("n") ? "m" : "n");
  const rejected = await GET(request("?role=dj&djId=wrong-token-dj&after=0", {
    headers: { Authorization: `Bearer ${wrongToken}` },
  }));
  assert.equal(rejected.status, 401);

  const accepted = await GET(request("?role=dj&djId=wrong-token-dj&after=0", {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(accepted.status, 200);
});

import { timingSafeEqual } from "node:crypto";

import {
  crowdLinkEventIsForDj,
  crowdLinkEventIsForListener,
  crowdLinkEventRequiresDjAuth,
  type CrowdLinkEvent,
  type CrowdLinkEventType,
  type CrowdLinkPost,
} from "../../../lib/crowd-link.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CrowdLinkState = {
  sequence: number;
  events: CrowdLinkEvent[];
  activeDjId?: string | null;
  activeDjSeenAt?: number;
  activeDjBroadcasting?: boolean;
  activeDjVisible?: boolean;
  waiters: Map<string, Set<() => void>>;
};
const globalCrowdLink = globalThis as typeof globalThis & { __crowd2CrowdLink?: CrowdLinkState };
const state: CrowdLinkState = globalCrowdLink.__crowd2CrowdLink ??= {
  sequence: 0,
  events: [],
  waiters: new Map<string, Set<() => void>>(),
};
state.waiters ??= new Map();
const eventTypes = new Set<CrowdLinkEventType>([
  "audience-ready",
  "audience-left",
  "offer",
  "answer",
  "dj-ice",
  "dj-error",
  "dj-peer-state",
  "crowd-ice",
  "crowd-error",
  "reaction",
  "reaction-ack",
]);
let missingDjTokenWarned = false;

function anonymousDjIsExplicitlyAllowed() {
  return process.env.CROWD_ALLOW_ANONYMOUS_DJ === "1"
    || process.env.NODE_ENV === "development";
}

function djRequestIsAuthorised(request: Request) {
  const expected = process.env.CROWD_DJ_TOKEN?.trim();
  if (!expected) {
    const allowed = anonymousDjIsExplicitlyAllowed();
    if (!missingDjTokenWarned) {
      missingDjTokenWarned = true;
      console.warn(allowed
        ? "[crowd-link] CROWD_DJ_TOKEN is unset: DJ endpoints are OPEN (anonymous DJ mode). Never expose this relay publicly without a token."
        : "[crowd-link] CROWD_DJ_TOKEN is unset: refusing all DJ requests. Set CROWD_DJ_TOKEN, or set CROWD_ALLOW_ANONYMOUS_DJ=1 for a trusted private network.");
    }
    return allowed;
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expectedBytes = Buffer.from(expected);
  return presented.length === expectedBytes.length && timingSafeEqual(presented, expectedBytes);
}

function waitForEvent(key: string, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const listeners = state.waiters.get(key);
      listeners?.delete(done);
      if (listeners?.size === 0) state.waiters.delete(key);
      resolve();
    };
    const listeners = state.waiters.get(key) ?? new Set<() => void>();
    listeners.add(done);
    state.waiters.set(key, listeners);
    timer = setTimeout(done, timeoutMs);
  });
}

function notify(key: string) {
  for (const done of [...state.waiters.get(key) ?? []]) done();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const clientId = params.get("clientId") ?? "";
  const djId = params.get("djId") ?? "";
  const djVisible = params.get("visible") === "1";
  const djBroadcasting = params.get("broadcasting") === "1";
  const wait = params.get("wait") === "1";
  const after = Math.max(0, Number(params.get("after")) || 0);
  if (role !== "dj" && role !== "crowd") return Response.json({ error: "role must be dj or crowd" }, { status: 400 });
  if (role === "crowd" && !clientId) return Response.json({ error: "clientId is required" }, { status: 400 });
  if (role === "dj" && !djRequestIsAuthorised(request)) {
    return Response.json({ error: "DJ authentication failed" }, { status: 401 });
  }
  if (role === "dj" && !djId) {
    return Response.json({ cursor: state.sequence, events: [], active: false, reloadRequired: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (role === "dj" && djId) {
    const now = Date.now();
    const leaseExpired = !state.activeDjSeenAt || now - state.activeDjSeenAt > 15_000;
    const shouldClaim = !state.activeDjId
      || state.activeDjId === djId
      || leaseExpired
      || (djBroadcasting && !state.activeDjBroadcasting)
      || (djVisible && !state.activeDjVisible && !state.activeDjBroadcasting);
    if (shouldClaim) {
      state.activeDjId = djId;
      state.activeDjSeenAt = now;
      state.activeDjBroadcasting = djBroadcasting;
      state.activeDjVisible = djVisible;
    }
    if (state.activeDjId !== djId) {
      // An inactive booth must also wait: immediate success plus a zero-delay
      // client retry otherwise creates two HTTP requests per round trip.
      if (wait) await waitForEvent("dj", 4_000);
      const freshAfter = now - 30_000;
      const reactions = state.events.filter((event) =>
        event.sequence > after
        && event.sentAt >= freshAfter
        && event.type === "reaction"
      );
      // Do not advance an inactive booth over listener/ICE events. If this tab
      // becomes active after a reload or lease handover it must still be able to
      // answer the audience already waiting. Reactions are the only events an
      // inactive booth consumes, so advance only through those.
      const inactiveCursor = reactions.reduce((latest, event) => Math.max(latest, event.sequence), after);
      return Response.json({ cursor: inactiveCursor, events: reactions, active: false, visible: djVisible }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const collectEvents = () => {
    const freshAfter = Date.now() - 30_000;
    return state.events.filter((event) =>
      event.sequence > after
      && event.sentAt >= freshAfter
      && (role === "dj" ? crowdLinkEventIsForDj(event) : crowdLinkEventIsForListener(event, clientId))
    );
  };
  let events = collectEvents();
  if (wait && events.length === 0) {
    await waitForEvent(role === "dj" ? "dj" : `crowd:${clientId}`, role === "dj" ? 4_000 : 20_000);
    events = collectEvents();
    if (role === "dj" && state.activeDjId === djId) state.activeDjSeenAt = Date.now();
  }
  return Response.json({ cursor: state.sequence, events, ...(role === "dj" ? { active: true } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) return Response.json({ error: "Event is too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as CrowdLinkPost | null;
  if (!body || !eventTypes.has(body.type) || typeof body.clientId !== "string" || !body.clientId) {
    return Response.json({ error: "Invalid Crowd link event" }, { status: 400 });
  }
  if (crowdLinkEventRequiresDjAuth(body.type) && !djRequestIsAuthorised(request)) {
    return Response.json({ error: "DJ authentication failed" }, { status: 401 });
  }
  const event: CrowdLinkEvent = {
    sequence: ++state.sequence,
    type: body.type,
    clientId: body.clientId.slice(0, 120),
    ...(body.targetId ? { targetId: body.targetId.slice(0, 120) } : {}),
    data: body.data,
    sentAt: Date.now(),
  };
  if (event.type === "crowd-error" || event.type === "dj-peer-state") {
    console.warn(`[crowd-link] ${event.type} ${event.clientId} -> ${event.targetId ?? "-"}: ${JSON.stringify(event.data)}`);
  }
  state.events.push(event);
  if (state.events.length > 1200) state.events.splice(0, state.events.length - 900);
  if (crowdLinkEventIsForDj(event)) notify("dj");
  if (event.targetId) notify(`crowd:${event.targetId}`);
  return Response.json({ sequence: event.sequence });
}

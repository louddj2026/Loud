type ClientDiagnosticDetails = Record<string, unknown>;

let diagnosticSessionId: string | null = null;
let diagnosticSequence = 0;

function currentDiagnosticSessionId() {
  if (diagnosticSessionId) return diagnosticSessionId;
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  diagnosticSessionId = `${Date.now().toString(36)}-${randomPart}`;
  return diagnosticSessionId;
}

function safeDiagnosticValue(value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "string") return value.slice(0, 8_000);
  if (value === null || ["number", "boolean", "undefined"].includes(typeof value)) return value;
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return String(value).slice(0, 8_000); }
}

/**
 * Events queue locally and flush with retry, because fire-and-forget lied.
 *
 * 16 Aug 2026: three analysis jobs choked the server for ~2 minutes, every
 * in-flight diagnostic died silently, and the telemetry stream never came
 * back for the rest of the session — DJ recorded the booth on video and
 * there was no deck state on record to match it against. Two causes: each
 * event was its own fire-and-forget fetch (a failure was swallowed and the
 * event lost forever), and `keepalive: true` on every heartbeat let hung
 * requests exhaust the browser's keepalive quota, after which every further
 * send rejects instantly. So: no keepalive, a bounded queue, and a flusher
 * that retries — a server stall now backfills, with the original `at`
 * timestamps intact, the moment it recovers.
 */
const QUEUE_LIMIT = 600;
const queue: unknown[] = [];
let flushing = false;
let flusher: ReturnType<typeof setInterval> | null = null;

async function flushClientDiagnostics() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const delivered = await fetch("/api/client-diagnostics", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queue[0]),
      }).then((response) => response.ok, () => false);
      if (!delivered) break; // keep the event; the interval retries.
      queue.shift();
    }
  } finally {
    flushing = false;
  }
}

export function reportClientDiagnostic(kind: string, details: ClientDiagnosticDetails = {}) {
  if (typeof window === "undefined") return;
  const payload = {
    schemaVersion: 1,
    kind,
    at: new Date().toISOString(),
    page: window.location.pathname,
    sessionId: currentDiagnosticSessionId(),
    sequence: ++diagnosticSequence,
    performanceMs: Math.round(performance.now()),
    details: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, safeDiagnosticValue(value)])),
  };
  try {
    queue.push(payload);
    // Oldest events drop first past the cap — a bounded gap in a long outage
    // beats an unbounded queue in a tab that might live all night.
    if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
    flusher ??= setInterval(() => void flushClientDiagnostics(), 4000);
    void flushClientDiagnostics();
  } catch {
    // A diagnostic failure must never become another booth failure.
  }
}

export function reportCrowdLiveEvent(event: string, details: ClientDiagnosticDetails = {}) {
  reportClientDiagnostic("crowd-live", { event, mode: event.startsWith("preview.") ? "preview" : "booth", ...details });
}

export function diagnosticErrorDetails(reason: unknown) {
  if (reason instanceof Error) return { name: reason.name, message: reason.message, stack: reason.stack };
  return { message: typeof reason === "string" ? reason : String(reason) };
}

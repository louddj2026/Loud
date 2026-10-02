import { appendClientDiagnostic } from "../../../lib/client-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DIAGNOSTIC_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  try {
    const browserRejected = fetchSite && fetchSite !== "same-origin" && fetchSite !== "none";
    const nonBrowserRejected = !fetchSite && origin && new URL(origin).host !== requestUrl.host;
    if (browserRejected || nonBrowserRejected) return new Response("Cross-origin diagnostic rejected", { status: 403 });
  } catch {
    return new Response("Invalid diagnostic origin", { status: 400 });
  }
  const text = await request.text();
  if (text.length > MAX_DIAGNOSTIC_REQUEST_BYTES) return new Response("Diagnostic too large", { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { return new Response("Invalid diagnostic", { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return new Response("Invalid diagnostic", { status: 400 });
  // The receipt time is server authority and cannot be replaced by a caller.
  await appendClientDiagnostic({ ...(body as Record<string, unknown>), receivedAt: new Date().toISOString() });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

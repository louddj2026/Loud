export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function edgeUnavailable() {
  return Response.json({ error: "The private booth proxy is disabled on the public edge" }, { status: 404 });
}

function targetUrl(request: Request) {
  const configured = process.env.CROWD_EDGE_URL?.trim();
  const target = new URL("/api/crowd-link", configured || request.url);
  target.search = new URL(request.url).search;
  return target;
}

function edgeHeaders(contentType?: string | null) {
  const headers = new Headers({ Accept: "application/json" });
  if (contentType) headers.set("Content-Type", contentType);
  const token = process.env.CROWD_DJ_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function relay(response: Response) {
  const headers = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export async function GET(request: Request) {
  if (process.env.CROWD_DEPLOYMENT_ROLE === "edge") return edgeUnavailable();
  const response = await fetch(targetUrl(request), {
    headers: edgeHeaders(),
    cache: "no-store",
  });
  return relay(response);
}

export async function POST(request: Request) {
  if (process.env.CROWD_DEPLOYMENT_ROLE === "edge") return edgeUnavailable();
  const body = await request.text();
  const response = await fetch(targetUrl(request), {
    method: "POST",
    headers: edgeHeaders(request.headers.get("content-type") || "application/json"),
    body,
    cache: "no-store",
  });
  return relay(response);
}

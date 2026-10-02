import { rememberCompactDecision, type CompactMixDecision } from "../../../../lib/dj-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as CompactMixDecision & { id?: string };
  if (!body.id || !["keep", "pass", "good", "great"].includes(body.decision)) {
    return Response.json({ error: "A track and valid decision are required" }, { status: 400 });
  }
  const remembered = await rememberCompactDecision(body.id, body);
  return Response.json({ remembered }, { status: remembered ? 200 : 404 });
}

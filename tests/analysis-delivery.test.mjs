import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/analysis/[id]/route.ts";
import { trackAnalysisUrl } from "../lib/analysis-delivery.ts";

test("analysis URLs use the runtime API instead of newly generated public routes", () => {
  assert.equal(trackAnalysisUrl("elements-a690a6475c4cf2"), "/api/analysis/elements-a690a6475c4cf2");
  assert.equal(trackAnalysisUrl("space boogie"), "/api/analysis/space%20boogie");
});

test("runtime analysis endpoint returns live JSON with a JSON content type", async () => {
  const id = "elements-a690a6475c4cf2";
  const response = await GET(
    new Request(`http://localhost${trackAnalysisUrl(id)}`),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/i);
  const analysis = await response.json();
  assert.equal(analysis.track.id, id);
});

test("runtime analysis endpoint returns JSON errors instead of an HTML 404 page", async () => {
  const response = await GET(
    new Request("http://localhost/api/analysis/not-a-real-track"),
    { params: Promise.resolve({ id: "not-a-real-track" }) },
  );
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/i);
  assert.equal(typeof (await response.json()).error, "string");
});

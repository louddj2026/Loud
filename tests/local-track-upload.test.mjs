import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS, uploadLocalTrackFile } from "../lib/local-track-upload.ts";

function uploadableFile() {
  return Object.assign(new Blob(["audio"], { type: "audio/wav" }), { name: "Dune - Firewall.wav" });
}

test("a local track upload survives a transient server restart without losing the selected file", async () => {
  const calls = [];
  const waits = [];
  const retries = [];
  const response = new Response("ok", { status: 200 });
  const result = await uploadLocalTrackFile(uploadableFile(), {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (calls.length < 3) throw new TypeError("Failed to fetch");
      return response;
    },
    sleeper: async (milliseconds) => { waits.push(milliseconds); },
    onRetry: (...details) => retries.push(details),
  });

  assert.equal(result, response);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS.slice(0, 2));
  assert.deepEqual(retries.map(([attempt, total, delay]) => [attempt, total, delay]), [
    [2, 5, 500],
    [3, 5, 1_000],
  ]);
  assert.equal(calls[0].url, "/api/upload-track");
  assert.equal(calls[0].options.headers["X-Crowd-Filename"], "Dune%20-%20Firewall.wav");
  assert.equal(calls[0].options.headers["X-Crowd-Size"], "5");
  assert.equal(calls[0].options.body.size, 5);
});

test("a persistent network failure is returned after bounded retries", async () => {
  let calls = 0;
  const failure = new TypeError("Failed to fetch");
  await assert.rejects(() => uploadLocalTrackFile(uploadableFile(), {
    fetcher: async () => { calls += 1; throw failure; },
    sleeper: async () => undefined,
  }), failure);
  assert.equal(calls, LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS.length + 1);
});

test("HTTP upload errors are returned immediately for the caller to explain", async () => {
  let calls = 0;
  const response = new Response("unsupported", { status: 415 });
  const result = await uploadLocalTrackFile(uploadableFile(), {
    fetcher: async () => { calls += 1; return response; },
  });
  assert.equal(result, response);
  assert.equal(calls, 1);
});

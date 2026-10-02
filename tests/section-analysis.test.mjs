import assert from "node:assert/strict";
import test from "node:test";
import { BOOTH_IDLE_TRUST_MS, toWslPath } from "../lib/section-analysis.ts";

test("Windows paths cross into WSL, including other drives and spaces", () => {
  // The crate lives on D: and the project on C:, so both have to translate.
  assert.equal(toWslPath("D:\\Music\\Atmos\\Atmos - Klein Aber Doctor.mp3"), "/mnt/d/Music/Atmos/Atmos - Klein Aber Doctor.mp3");
  assert.equal(toWslPath("C:\\Users\\DJ\\project\\scripts\\section-analyse.py"), "/mnt/c/Users/DJ/project/scripts/section-analyse.py");
  // Non-ASCII survives: arguments are passed as argv, never through a shell.
  assert.equal(toWslPath("D:\\Music\\Altöm\\track.mp3"), "/mnt/d/Music/Altöm/track.mp3");
  // Forward slashes are already acceptable input.
  assert.equal(toWslPath("D:/Music/x.wav"), "/mnt/d/Music/x.wav");
});

test("the idle report has a trust window rather than being sticky", () => {
  // A stale "nothing is playing" is exactly what would let a 90-second GPU job
  // start under a live mix, so the window has to be short enough to matter and
  // long enough to survive the client's poll interval of 4 s.
  assert.ok(BOOTH_IDLE_TRUST_MS >= 10_000, "too short to survive a poll gap");
  assert.ok(BOOTH_IDLE_TRUST_MS <= 60_000, "too long to be a meaningful guard");
});

test("the analysis script discards tempo and phase before Node can see them", async () => {
  // The one invariant worth a test in the Python bridge: All-In-One's BPM is
  // integer-only and its downbeats sit ~29 ms off a verified grid, so they must
  // never reach the booth. Assert the script never emits them.
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const source = readFileSync(path.join(import.meta.dirname, "..", "scripts", "section-analyse.py"), "utf8");
  const forbidden = ["\"bpm\"", "'bpm'", "\"downbeats\"", "'downbeats'", "\"beats\"", "'beats'"];
  for (const key of forbidden) {
    assert.ok(!source.includes(key), `the bridge must not emit ${key}`);
  }
  assert.ok(source.includes("segments"), "the bridge must emit segments");
});

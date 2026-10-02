import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { localBeatThisInstall } from "../lib/beat-this-runtime.ts";

const mapRouteSource = await readFile(new URL("../app/api/map/route.ts", import.meta.url), "utf8");

test("the analyzer finds Crowd2's durable local Python environment without launcher overrides", () => {
  const localAppData = path.join("C:", "Users", "DJ", "AppData", "Local");
  const install = localBeatThisInstall(localAppData);
  assert.deepEqual(install, {
    python: path.join(localAppData, "Crowd2", "analysis-env", "Scripts", "python.exe"),
    packages: path.join(localAppData, "Crowd2", "analysis-env", "Lib", "site-packages"),
  });
  assert.match(mapRouteSource, /localInstall\.python/);
  assert.match(mapRouteSource, /localInstall\.packages/);
});

test("the local analyzer fallback is inert when LOCALAPPDATA is unavailable", () => {
  assert.deepEqual(localBeatThisInstall(""), { python: null, packages: null });
});

test("mapping cleanup cannot replace the original analyzer error", () => {
  const cleanup = mapRouteSource.match(/catch \(error\) \{[\s\S]*?Crowd2 could not finish failed-mapping cleanup[\s\S]*?throw error;[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(cleanup, /catch \(cleanupError\)/);
  assert.match(cleanup, /throw error;/);
});

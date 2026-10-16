#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const host = process.env.LOUD_HOST?.trim() || "0.0.0.0";
const port = process.env.LOUD_PORT?.trim() || "3201";

console.log(`Starting Loud's precompiled booth on http://localhost:${port}/dj`);
console.log("LoudLink will be available to devices on this trusted local network.");

const childEnv = {
  ...process.env,
  // A local production build otherwise rejects the booth's signalling calls
  // when the user has not configured a private relay token. A configured
  // CROWD_DJ_TOKEN still takes precedence in the route's authentication.
  CROWD_ALLOW_ANONYMOUS_DJ: process.env.CROWD_ALLOW_ANONYMOUS_DJ ?? "1",
};
if (!childEnv.CROWD2_DIST_DIR && existsSync(".next-production/BUILD_ID")) {
  childEnv.CROWD2_DIST_DIR = ".next-production";
}

const child = spawn(process.execPath, [nextCli, "start", "--hostname", host, "-p", port], {
  stdio: "inherit",
  env: childEnv,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

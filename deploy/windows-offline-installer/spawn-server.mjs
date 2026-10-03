import { closeSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [serverRoot, logs, pidFile] = process.argv.slice(2);
if (!serverRoot || !logs || !pidFile) throw new Error("serverRoot, logs and pidFile are required");
const stdout = openSync(path.join(logs, "booth.out.log"), "a");
const stderr = openSync(path.join(logs, "booth.err.log"), "a");
const child = spawn(process.execPath, [path.join(serverRoot, "server.js")], {
  cwd: serverRoot,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", stdout, stderr],
  env: process.env,
});
child.unref();
closeSync(stdout);
closeSync(stderr);
writeFileSync(pidFile, `${JSON.stringify({ pid: child.pid, port: Number(process.env.PORT), executable: process.execPath, serverRoot }, null, 2)}\n`);

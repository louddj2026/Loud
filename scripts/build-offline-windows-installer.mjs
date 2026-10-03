#!/usr/bin/env node
import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.resolve(process.env.LOUD_OFFLINE_WORK || path.join(root, "..", "..", "offline-installer"));
const stage = path.join(work, "build-source");
const payload = path.join(work, "payload");
const output = path.join(work, "release");
const workspaceCacheRoot = path.resolve(root, "..", "..");
const localDownloadCache = path.join(workspaceCacheRoot, "windows-installer", "downloads");
const downloads = path.resolve(process.env.LOUD_INSTALLER_DOWNLOADS || (existsSync(localDownloadCache) ? localDownloadCache : path.join(work, "downloads")));
const analysisSource = path.resolve(process.env.LOUD_ANALYSIS_SOURCE || path.join(workspaceCacheRoot, "runtimes", "crowd2-analysis"));
const pythonSource = path.resolve(process.env.LOUD_PYTHON_SOURCE || path.join(workspaceCacheRoot, "runtimes", "python", "cpython-3.12.10-windows-x86_64-none"));
const installerSource = path.join(root, "deploy", "windows-offline-installer");
const skipBuild = process.argv.includes("--reuse-app-build");
const restrictedDemucsCheckpoint = "955717e8-8726e21a.th";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build the Loud installer on Windows x64.");
for (const required of [analysisSource, pythonSource, installerSource]) {
  if (!existsSync(required)) throw new Error(`Missing build input: ${required}`);
}

function run(command, args, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifiedDownload(url, file, expected) {
  if (existsSync(file) && await digest(file) === expected) return;
  console.log(`Downloading ${path.basename(file)}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 100).toString().toLowerCase().includes("<!doctype html")) {
    const link = bytes.toString().match(/content="5; url=([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    if (!link || new URL(link).protocol !== "https:" || new URL(link).hostname !== "downloads.sourceforge.net") {
      throw new Error(`Unexpected download page: ${url}`);
    }
    const actual = await fetch(link);
    if (!actual.ok) throw new Error(`Archive download failed: ${actual.status}`);
    bytes = Buffer.from(await actual.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`Checksum mismatch: ${url}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}

function copyFilter(file) {
  const pieces = file.split(path.sep);
  const name = path.basename(file);
  if (pieces.includes("__pycache__") || pieces.includes(".git") || /\.(pyc|pyo|tsbuildinfo|log)$/i.test(name)) return false;
  if (name === "runtime.json" || name === restrictedDemucsCheckpoint) return false;
  return true;
}

async function copy(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true, dereference: true, filter: copyFilter });
}

async function removeGeneratedPythonFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") await fs.rm(full, { recursive: true, force: true });
      else await removeGeneratedPythonFiles(full);
    } else if (/\.(pyc|pyo)$/i.test(entry.name)) {
      await fs.rm(full, { force: true });
    }
  }
}

await fs.rm(payload, { recursive: true, force: true });
if (!skipBuild) await fs.rm(stage, { recursive: true, force: true });
await Promise.all([stage, payload, downloads, output].map((directory) => fs.mkdir(directory, { recursive: true })));
const spec = JSON.parse(await fs.readFile(path.join(installerSource, "downloads.json"), "utf8"));

if (!skipBuild) {
  for (const directory of ["app", "lib", "scripts", "public"]) await copy(path.join(root, directory), path.join(stage, directory));
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs", "next.config.ts", "LICENSE"]) {
    if (existsSync(path.join(root, name))) await copy(path.join(root, name), path.join(stage, name));
  }
  console.log("Installing the locked JavaScript build in an isolated staging directory.");
  await run(process.env.ComSpec, ["/d", "/s", "/c", "pnpm.cmd install --frozen-lockfile --config.node-linker=hoisted"], stage);
  const buildEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const key of Object.keys(buildEnv)) if (key.startsWith("CROWD_") || key.startsWith("NEXT_PUBLIC_")) delete buildEnv[key];
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], stage, buildEnv);
}

const standalone = path.join(stage, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) throw new Error("The production standalone server was not produced.");
await copy(standalone, path.join(payload, "app"));
await copy(path.join(stage, ".next", "static"), path.join(payload, "app", ".next", "static"));
await copy(path.join(stage, "public"), path.join(payload, "app", "public"));
await copy(path.join(stage, "scripts"), path.join(payload, "app", "scripts"));
await copy(path.join(stage, "lib"), path.join(payload, "app", "lib"));
await copy(path.join(stage, "node_modules", "ffmpeg-static", "ffmpeg.exe"), path.join(payload, "app", "node_modules", "ffmpeg-static", "ffmpeg.exe"));
await fs.mkdir(path.join(payload, "app", "data"), { recursive: true });
await fs.mkdir(path.join(payload, "app", "public", "analysis"), { recursive: true });

for (const name of ["common.ps1", "setup.ps1", "launch.ps1", "launch-hidden.vbs", "audio-bridge-hidden.vbs", "spawn-server.mjs", "stop.ps1", "select-music.ps1", "verify.ps1", "downloads.json"]) {
  await copy(path.join(installerSource, name), path.join(payload, name));
}

for (const name of ["node", "uv", "nsis"]) {
  const item = spec[name];
  const archive = path.join(downloads, item.file);
  await verifiedDownload(item.url, archive, item.sha256);
  const expanded = path.join(downloads, name);
  await fs.rm(expanded, { recursive: true, force: true });
  await fs.mkdir(expanded, { recursive: true });
  await run(path.join(process.env.SystemRoot, "System32", "tar.exe"), ["-xf", archive, "-C", expanded]);
  if (name === "node") await copy(path.join(expanded, item.directory, "node.exe"), path.join(payload, "runtime", "node.exe"));
  if (name === "uv") await copy(path.join(expanded, "uv.exe"), path.join(payload, "runtime", "uv.exe"));
}

console.log("Copying the verified native analysis runtime (excluding the restricted Demucs checkpoint).");
await copy(path.join(analysisSource, "env"), path.join(payload, "analysis", "env"));
await copy(pythonSource, path.join(payload, "analysis", "python", "cpython-3.12.10-windows-x86_64-none"));
await copy(path.join(analysisSource, "torch"), path.join(payload, "analysis", "torch"));
await copy(path.join(analysisSource, "ffprobe"), path.join(payload, "analysis", "ffprobe"));
const bundledCheckpoint = path.join(payload, "analysis", "torch", "hub", "checkpoints", restrictedDemucsCheckpoint);
if (existsSync(bundledCheckpoint)) throw new Error("The restricted Demucs checkpoint must not be included in the public installer.");

const bundledPythonHome = path.join(payload, "analysis", "python", "cpython-3.12.10-windows-x86_64-none");
const bundledVenvConfig = path.join(payload, "analysis", "env", "pyvenv.cfg");
let venvConfig = await fs.readFile(bundledVenvConfig, "utf8");
venvConfig = venvConfig.replace(/^home\s*=.*$/m, `home = ${bundledPythonHome}`);
await fs.writeFile(bundledVenvConfig, venvConfig);
const uv = path.join(payload, "runtime", "uv.exe");
const bundledPython = path.join(payload, "analysis", "env", "Scripts", "python.exe");
await run(uv, ["pip", "install", "--python", bundledPython, "--link-mode", "copy", "sounddevice==0.5.3", "websockets==15.0.1"], root);
await run(bundledPython, ["-c", "import beat_this, demucs, numpy, sounddevice, torch, torchaudio, websockets; print('bundled Python packages verified')"], root, {
  ...process.env,
  TORCH_HOME: path.join(payload, "analysis", "torch"),
});
await removeGeneratedPythonFiles(path.join(payload, "analysis"));
venvConfig = await fs.readFile(bundledVenvConfig, "utf8");
venvConfig = venvConfig.replace(/^home\s*=.*$/m, "home = __LOUD_PYTHON_HOME__");
await fs.writeFile(bundledVenvConfig, venvConfig);

const notices = path.join(payload, "notices");
await fs.mkdir(notices, { recursive: true });
await copy(path.join(root, "LICENSE"), path.join(notices, "Loud-License.txt"));
await copy(path.join(downloads, "node", spec.node.directory, "LICENSE"), path.join(notices, "Node.txt"));
await copy(path.join(pythonSource, "LICENSE.txt"), path.join(notices, "Python.txt"));
for (const source of [
  [path.join(stage, "node_modules", "ffmpeg-static", "LICENSE"), "ffmpeg-static.txt"],
  [path.join(stage, "node_modules", "ffmpeg-static", "ffmpeg.exe.LICENSE"), "FFmpeg.txt"],
  [path.join(stage, "node_modules", "ffmpeg-static", "ffmpeg.exe.README"), "FFmpeg-source.txt"],
]) if (existsSync(source[0])) await copy(source[0], path.join(notices, source[1]));
await fs.writeFile(path.join(notices, "Model-and-dependency-notice.txt"), [
  "Loud offline-installer dependency notice",
  "",
  "Beat This code and published model weights are MIT licensed:",
  "https://github.com/CPJKU/beat_this",
  "",
  "Demucs code is MIT licensed, but its maintainer states that pretrained model weights are not",
  "covered by the MIT licence and are supplied only for scientific purposes:",
  "https://github.com/facebookresearch/demucs/issues/327",
  "",
  "For that reason Loud does not redistribute 955717e8-8726e21a.th. The installer downloads",
  "the exact official file from Meta and verifies SHA-256",
  `${spec.demucsCheckpoint.sha256}.`,
  "",
  "Python package licence and metadata files remain inside analysis/env/Lib/site-packages.",
  "DJ hardware drivers are not included and remain the responsibility of their manufacturers.",
  "",
].join("\n"));

const payloadFiles = [];
async function inventory(directory, prefix = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Payload contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) await inventory(full, relative);
    else {
      if (/(^|\/)(\.env[^/]*|elements-crate\.json|uploaded-tracks\.json|runtime\.json)$/i.test(relative)) throw new Error(`Private file in payload: ${relative}`);
      if (/\.(wav|mp3|flac|m4a|aac|ogg|jsonl|log)$/i.test(relative)) throw new Error(`Local media or log in payload: ${relative}`);
      if (entry.name === restrictedDemucsCheckpoint) throw new Error("Restricted Demucs checkpoint entered the payload.");
      payloadFiles.push({ file: relative, sha256: await digest(full) });
    }
  }
}
await inventory(payload);
await fs.writeFile(path.join(payload, "payload-manifest.json"), `${JSON.stringify({ schema: 1, files: payloadFiles }, null, 2)}\n`);

const compiler = path.join(downloads, "nsis", spec.nsis.directory, "Bin", "makensis.exe");
await run(compiler, [`/DPAYLOAD=${payload}`, `/DOUTPUT=${output}`, path.join(installerSource, "loud-offline.nsi")]);
const installer = path.join(output, "Loud-Offline-Setup-x64.exe");
console.log(`Installer: ${installer}`);
console.log(`SHA-256: ${await digest(installer)}`);

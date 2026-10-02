#!/usr/bin/env node
/**
 * Installs — or with --check only verifies — Crowd2's native analysis runtime
 * (lib/analysis-runtime.ts): ONE physical directory used by both local models,
 * Beat This and the HTDemucs drums separator.
 *
 *   <runtimes>\python\cpython-3.12.10-windows-x86_64-none\   uv-managed CPython
 *   <root>\env\                     venv; packages pinned in
 *                                   scripts/analysis-runtime-requirements.txt
 *                                   (+ scripts/analysis-runtime-overrides.txt)
 *   <root>\torch\hub\checkpoints\   955717e8-8726e21a.th (htdemucs) and
 *                                   beat_this-small0.ckpt — the workers' TORCH_HOME
 *   <root>\ffprobe\ffprobe.exe      from the SAME gyan.dev FFmpeg 6.1.1 build as
 *                                   node_modules/ffmpeg-static/ffmpeg.exe
 *   <root>\runtime.json             what was installed and verified
 *
 * <root> defaults to <app>\..\Codex\runtimes\crowd2-analysis (on this PC
 * D:\Crowd\Codex\runtimes\crowd2-analysis) and <runtimes> is its parent: plain
 * folders every process can see. Never put them under %LOCALAPPDATA% on a PC
 * where setup may run from a packaged app such as Codex — those writes are
 * MSIX-virtualised and invisible to a booth started normally.
 *
 *   node scripts/setup-analysis-runtime.mjs [--check] [--root DIR] [--python-dir DIR] [--uv UV]
 *
 * Checkpoints and ffprobe are reused from local copies whose SHA-256 matches
 * (a torch hub cache, the retired %LOCALAPPDATA% envs), otherwise downloaded
 * from their official URLs; every artefact is hash-checked either way. Then
 * the runtime is proven live: both models load from its own TORCH_HOME.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const PYTHON_VERSION = "3.12.10";
const CHECKPOINTS = [
  {
    model: "htdemucs (Demucs bag member 955717e8)",
    file: "955717e8-8726e21a.th",
    url: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
    sha256: "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4",
  },
  {
    model: "Beat This small0",
    file: "beat_this-small0.ckpt",
    url: "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt",
    sha256: "6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
  },
];
const FFMPEG_PACKAGE = {
  url: "https://github.com/GyanD/codexffmpeg/releases/download/6.1.1/ffmpeg-6.1.1-essentials_build.zip",
  sha256: "742e32fc9f92681f9f254b925e1b613fdd8074ba40749d4879aefdb009b94cc5",
  ffprobe: "ffmpeg-6.1.1-essentials_build/bin/ffprobe.exe",
  ffprobeSha256: "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4",
  ffmpeg: "ffmpeg-6.1.1-essentials_build/bin/ffmpeg.exe",
  ffmpegSha256: "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
};
const TORCH_INDEX = "https://download.pytorch.org/whl/cpu";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirementsFile = path.join(projectRoot, "scripts", "analysis-runtime-requirements.txt");
const overridesFile = path.join(projectRoot, "scripts", "analysis-runtime-overrides.txt");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const checkOnly = process.argv.includes("--check");
const root = path.resolve(option("--root") ?? path.join(projectRoot, "..", "Codex", "runtimes", "crowd2-analysis"));
const pythonDir = path.resolve(option("--python-dir") ?? path.join(root, "..", "python"));
const uv = option("--uv") ?? "uv";
const baseInterpreter = path.join(pythonDir, `cpython-${PYTHON_VERSION}-windows-x86_64-none`, "python.exe");
const python = path.join(root, "env", "Scripts", "python.exe");
const sitePackages = path.join(root, "env", "Lib", "site-packages");
const torchHome = path.join(root, "torch");
const checkpointDir = path.join(torchHome, "hub", "checkpoints");
const ffprobe = path.join(root, "ffprobe", "ffprobe.exe");
const appFfmpeg = path.join(projectRoot, "node_modules", "ffmpeg-static", "ffmpeg.exe");
const manifestFile = path.join(root, "runtime.json");

const problems = [];
const log = (message) => console.log(`[analysis-runtime] ${message}`);

function run(command, args, { capture = false, env, cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", env: env ?? process.env, windowsHide: true });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}${capture ? `: ${(result.stderr || result.stdout).trim().slice(-800)}` : ""}`);
  return result.stdout ?? "";
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

async function matches(file, expected) {
  return existsSync(file) && await sha256(file) === expected;
}

async function download(url, target) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`download failed ${response.status}: ${url}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      log(`Download interrupted; retrying (${attempt}/3).`);
    }
  }
}

/** Publish a verified file atomically: copy to .partial, hash, rename. */
async function installVerified(source, target, expected, what) {
  mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  copyFileSync(source, partial);
  const actual = await sha256(partial);
  if (actual !== expected) {
    rmSync(partial, { force: true });
    throw new Error(`${what} hash mismatch: ${actual} (expected ${expected})`);
  }
  renameSync(partial, target);
  log(`${what} installed and verified (${expected.slice(0, 12)}…)`);
}

function pins(file) {
  const found = new Map();
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(?:@\s*|==)(\S+)$/);
    if (!match) throw new Error(`unpinned requirement in ${path.basename(file)}: ${line}`);
    found.set(match[1].toLowerCase().replace(/_/g, "-"), match[2]);
  }
  return found;
}

function installedPackages() {
  const installed = new Map();
  for (const line of run(uv, ["pip", "freeze", "--python", python], { capture: true }).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(?:@\s*|==)(\S+)$/);
    if (match) installed.set(match[1].toLowerCase().replace(/_/g, "-"), match[2]);
  }
  return installed;
}

function ensureEnvironment() {
  if (!checkOnly) {
    run(uv, ["python", "install", PYTHON_VERSION, "--install-dir", pythonDir, "--no-bin"]);
    if (!existsSync(python)) run(uv, ["venv", "--python", baseInterpreter, path.join(root, "env")]);
    run(uv, ["pip", "install", "--python", python, "--index-url", TORCH_INDEX, "--extra-index-url", "https://pypi.org/simple",
      "--index-strategy", "unsafe-best-match", "--link-mode", "copy", "--compile-bytecode",
      "-r", "scripts/analysis-runtime-requirements.txt", "--override", "scripts/analysis-runtime-overrides.txt"], { cwd: projectRoot });
    // uv skips --compile-bytecode when nothing changed; compile explicitly so
    // the first worker start after any install does not pay for it (~6 s).
    run(python, ["-m", "compileall", "-q", "-j", "0", sitePackages], { capture: true });
    log("packages installed and bytecode compiled");
  }
  if (!existsSync(python)) { problems.push(`missing interpreter ${python}`); return {}; }
  const home = readFileSync(path.join(root, "env", "pyvenv.cfg"), "utf8").match(/^home\s*=\s*(.+)$/m)?.[1]?.trim();
  // uv can record its minor-version directory alias in pyvenv.cfg.
  if (!home || !existsSync(home) || realpathSync(home).toLowerCase() !== realpathSync(path.dirname(baseInterpreter)).toLowerCase()) {
    problems.push(`venv base interpreter is ${home}, expected ${path.dirname(baseInterpreter)}`);
  }
  const expected = pins(requirementsFile);
  const installed = installedPackages();
  for (const [name, version] of expected) {
    if (installed.get(name) !== version) problems.push(`${name}: installed ${installed.get(name) ?? "nothing"}, pinned ${version}`);
  }
  for (const [name, version] of installed) if (!expected.has(name)) problems.push(`unexpected package ${name}==${version}`);
  return Object.fromEntries([...installed].sort(([a], [b]) => a.localeCompare(b)));
}

async function ensureCheckpoints() {
  const hubCaches = [
    process.env.TORCH_HOME && path.join(process.env.TORCH_HOME, "hub", "checkpoints"),
    path.join(os.homedir(), ".cache", "torch", "hub", "checkpoints"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Crowd2", "separator-env", "torch", "hub", "checkpoints"),
  ].filter(Boolean);
  for (const checkpoint of CHECKPOINTS) {
    const target = path.join(checkpointDir, checkpoint.file);
    if (await matches(target, checkpoint.sha256)) { log(`${checkpoint.model} checkpoint verified`); continue; }
    if (checkOnly) { problems.push(`${checkpoint.model} checkpoint missing or altered: ${target}`); continue; }
    let reused = false;
    for (const cache of hubCaches) {
      const candidate = path.join(cache, checkpoint.file);
      if (path.resolve(candidate) !== path.resolve(target) && await matches(candidate, checkpoint.sha256)) {
        await installVerified(candidate, target, checkpoint.sha256, `${checkpoint.model} checkpoint (reused from ${cache})`);
        reused = true;
        break;
      }
    }
    if (reused) continue;
    const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-runtime-setup-"));
    try {
      const downloaded = path.join(scratch, checkpoint.file);
      log(`downloading ${checkpoint.url}`);
      await download(checkpoint.url, downloaded);
      await installVerified(downloaded, target, checkpoint.sha256, `${checkpoint.model} checkpoint`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

async function ensureFfprobe() {
  if (!existsSync(appFfmpeg)) { problems.push(`the app's FFmpeg is missing: ${appFfmpeg} (run pnpm install)`); return; }
  if (await sha256(appFfmpeg) !== FFMPEG_PACKAGE.ffmpegSha256) {
    problems.push("node_modules/ffmpeg-static/ffmpeg.exe is not the gyan.dev 6.1.1 build this ffprobe pairs with; update FFMPEG_PACKAGE together with ffmpeg-static");
    return;
  }
  if (await matches(ffprobe, FFMPEG_PACKAGE.ffprobeSha256)) { log("ffprobe 6.1.1 verified"); return; }
  if (checkOnly) { problems.push(`ffprobe missing or altered: ${ffprobe}`); return; }
  const retired = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Crowd2", "separator-env", "ffprobe", "ffprobe.exe");
  if (retired && await matches(retired, FFMPEG_PACKAGE.ffprobeSha256)) {
    await installVerified(retired, ffprobe, FFMPEG_PACKAGE.ffprobeSha256, "ffprobe 6.1.1 (reused)");
    return;
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "crowd2-runtime-setup-"));
  try {
    const archive = path.join(scratch, "ffmpeg-6.1.1-essentials_build.zip");
    log(`downloading ${FFMPEG_PACKAGE.url}`);
    await download(FFMPEG_PACKAGE.url, archive);
    if (await sha256(archive) !== FFMPEG_PACKAGE.sha256) throw new Error("FFmpeg 6.1.1 package hash mismatch");
    // Windows' bundled bsdtar reads zip archives.
    run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", scratch, FFMPEG_PACKAGE.ffmpeg, FFMPEG_PACKAGE.ffprobe]);
    if (await sha256(path.join(scratch, FFMPEG_PACKAGE.ffmpeg)) !== FFMPEG_PACKAGE.ffmpegSha256) throw new Error("package ffmpeg.exe is not the app's build");
    await installVerified(path.join(scratch, FFMPEG_PACKAGE.ffprobe), ffprobe, FFMPEG_PACKAGE.ffprobeSha256, "ffprobe 6.1.1");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Both models load from the runtime's own TORCH_HOME, with the decoders the workers get. */
function proveRuntime() {
  if (!existsSync(python) || problems.length) return null;
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const env = { ...process.env, TORCH_HOME: torchHome, PYTHONUTF8: "1", [pathKey]: [path.dirname(appFfmpeg), path.dirname(ffprobe), process.env[pathKey]].join(path.delimiter) };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  const probe = [
    "import json, shutil, sys, time",
    "t = time.perf_counter()",
    "import torch, torchaudio, numpy, soundfile, demucs, beat_this",
    "from demucs.pretrained import get_model",
    "from beat_this.inference import File2Beats",
    "sys.path.insert(0, sys.argv[1])",
    "from drums_separation import uses_sox_writer",
    "demucs_model = get_model('htdemucs')",
    "File2Beats(checkpoint_path='small0', device='cpu', float16=False, dbn=False)",
    "print(json.dumps({'python': sys.version.split()[0], 'executable': sys.executable, 'torch': torch.__version__, 'torchaudio': torchaudio.__version__,",
    "  'numpy': numpy.__version__, 'soundfile': soundfile.__version__, 'demucs': demucs.__version__, 'cpu': torch.backends.cpu.get_cpu_capability(),",
    "  'demucsSamplerate': demucs_model.samplerate, 'demucsSources': list(demucs_model.sources), 'writer': 'sox_io' if uses_sox_writer() else 'sox-exact-pcm16',",
    "  'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe'), 'hub': torch.hub.get_dir(), 'startSeconds': round(time.perf_counter() - t, 2)}))",
  ].join("\n");
  const report = JSON.parse(run(python, ["-c", probe, path.join(projectRoot, "scripts")], { capture: true, env }).trim().split(/\r?\n/).at(-1));
  const same = (a, b) => path.resolve(a ?? "").toLowerCase() === path.resolve(b).toLowerCase();
  if (!same(report.ffmpeg, appFfmpeg)) problems.push(`ffmpeg resolved to ${report.ffmpeg}, not the app's build`);
  if (!same(report.ffprobe, ffprobe)) problems.push(`ffprobe resolved to ${report.ffprobe}`);
  if (!same(report.hub, path.join(torchHome, "hub"))) problems.push(`torch hub resolved to ${report.hub}`);
  if (report.demucsSamplerate !== 44100) problems.push(`unexpected model sample rate ${report.demucsSamplerate}`);
  return report;
}

try {
  if (process.platform !== "win32") throw new Error("this installer prepares the native Windows runtime; run it on Windows");
  log(`${checkOnly ? "checking" : "preparing"} ${root} (Python from ${pythonDir})`);
  const packages = ensureEnvironment();
  await ensureCheckpoints();
  await ensureFfprobe();
  const report = proveRuntime();
  if (report) log(`runtime ${JSON.stringify(report)}`);
  if (problems.length) {
    for (const problem of problems) console.error(`[analysis-runtime] PROBLEM: ${problem}`);
    process.exitCode = 1;
  } else {
    if (!checkOnly) {
      writeFileSync(manifestFile, `${JSON.stringify({
        schema: 1,
        verifiedAt: new Date().toISOString(),
        root,
        python: { venv: python, base: baseInterpreter, version: PYTHON_VERSION },
        packages,
        checkpoints: CHECKPOINTS.map(({ model, file, sha256: hash }) => ({ model, file: path.join(checkpointDir, file), sha256: hash })),
        ffprobe: { file: ffprobe, sha256: FFMPEG_PACKAGE.ffprobeSha256 },
        ffmpeg: { file: appFfmpeg, sha256: FFMPEG_PACKAGE.ffmpegSha256 },
        probe: report,
      }, null, 2)}\n`);
      log(`manifest written: ${manifestFile}`);
    }
    log(`ready. Set CROWD_ANALYSIS_RUNTIME=${root} in .env.local (Demucs and Beat This both use it).`);
  }
} catch (error) {
  console.error(`[analysis-runtime] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

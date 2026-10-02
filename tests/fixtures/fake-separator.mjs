// A stand-in for the separator processes, launched by tests in place of the
// separator's python (or wsl.exe). It speaks the real protocols:
//   worker: PROGRESS startup lines, INFO, READY, then per job line the
//           PROGRESS decode/block/write events + DONE with a result file
//   cold:   <script> <audio> <out> <result> [demix] -> the same PROGRESS
//           events on stdout, result file, exit code
//   probe:  wsl.exe ... echo ok -> "ok"
// FAKE_WORKER = ok | dies | nostart, FAKE_COLD = ok | fails and
// FAKE_PROBE = ok | dead select behaviour. FAKE_BLOCKS sets the block count,
// FAKE_STEP_MS paces every event (so a test can watch a job mid-flight),
// FAKE_LEGACY=1 prints only the pre-26-Sep numeric "PROGRESS 0.500" line.
// The "stem" is simply a copy of the input audio.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const fromWsl = (file) => (/^\/mnt\/[a-z]\//.test(file) ? `${file[5].toUpperCase()}:\\${file.slice(7).replace(/\//g, "\\")}` : file);
const native = (file) => fromWsl(file);
const blocks = Math.max(1, Number(process.env.FAKE_BLOCKS) || 3);
const stepMs = Math.max(0, Number(process.env.FAKE_STEP_MS) || 0);
const legacy = process.env.FAKE_LEGACY === "1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (event) => process.stdout.write(`PROGRESS ${JSON.stringify(event)}\n`);

/** The per-job events drums_separation.py emits, blocks counted on "end" only. */
async function reportJob() {
  if (legacy) { process.stdout.write("PROGRESS 0.500\n"); return; }
  progress({ event: "decode", state: "start" });
  await sleep(stepMs);
  progress({ event: "decode", state: "end", audioSeconds: 0.05 });
  for (let block = 1; block <= blocks; block += 1) {
    const range = [Number(((block - 1) * 7.8 * 0.75).toFixed(3)), Number(((block - 1) * 7.8 * 0.75 + 7.8).toFixed(3))];
    progress({ event: "block", state: "start", block, passBlocks: blocks, done: block - 1, doneInPass: block - 1, pass: 1, passes: 1, range });
    await sleep(stepMs);
    progress({ event: "block", state: "end", block, passBlocks: blocks, done: block, doneInPass: block, pass: 1, passes: 1, range });
  }
  progress({ event: "write", state: "start" });
  await sleep(stepMs);
  progress({ event: "write", state: "end" });
}

if (args.includes("echo")) {
  if (process.env.FAKE_PROBE === "dead") {
    process.stderr.write("Wsl/Service/E_UNEXPECTED\n");
    process.exit(1);
  }
  process.stdout.write("ok\n");
  process.exit(0);
}
if (args.includes("--shutdown")) process.exit(0);

const scriptIndex = args.findIndex((arg) => /drums-stem(-worker)?\.py$/.test(arg));
const script = args[scriptIndex] ?? "";
const operands = args.slice(scriptIndex + 1).map(native);

function writeResult(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload));
}

if (script.endsWith("drums-stem-worker.py")) {
  const mode = process.env.FAKE_WORKER ?? "ok";
  if (!legacy) progress({ event: "startup", step: "import" });
  if (mode === "nostart") {
    process.stderr.write("ModuleNotFoundError: No module named 'demucs'\n");
    process.exit(1);
  }
  await sleep(stepMs);
  if (!legacy) progress({ event: "startup", step: "model" });
  await sleep(stepMs);
  process.stdout.write(`INFO ${JSON.stringify({ fake: true, torchHome: process.env.TORCH_HOME ?? null, utf8: process.env.PYTHONUTF8 ?? null })}\n`);
  process.stdout.write("READY\n");
  const lines = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      const job = JSON.parse(line);
      if (mode === "dies") process.exit(3);
      await reportJob();
      copyFileSync(native(job.audio), native(job.out));
      writeResult(native(job.result), { ok: true, threads: job.threads, seconds: 0.1, separationSeconds: 0.2, decodeSeconds: 0.01, modelSeconds: 0.15, writeSeconds: 0.01, writer: "fake", mode: "four-stem-warm", jobPaths: [job.audio, job.out, job.result] });
      process.stdout.write("DONE\n");
    });
  });
  lines.on("close", () => { void chain.then(() => process.exit(0)); });
} else if (script.endsWith("drums-stem.py")) {
  const [audio, out, result] = operands;
  if ((process.env.FAKE_COLD ?? "ok") === "fails") {
    if (!legacy) progress({ event: "startup", step: "import" });
    writeResult(result, { ok: false, error: "fake cold failure" });
    process.exit(1);
  }
  if (!legacy) { progress({ event: "startup", step: "import" }); progress({ event: "startup", step: "model" }); }
  await reportJob();
  copyFileSync(audio, out);
  writeResult(result, { ok: true, threads: Number(process.env.CROWD_DEMUCS_THREADS) || null, seconds: 0.1, separationSeconds: 0.3, writer: "fake", mode: "drums-cold" });
  process.exit(0);
} else {
  process.stderr.write(`fake separator: unexpected arguments ${JSON.stringify(args)}\n`);
  process.exit(2);
}

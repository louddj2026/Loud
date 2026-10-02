import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackAnalysisUrl } from "../lib/analysis-delivery.ts";
import { kickStemPath } from "../lib/kick-hits-store.ts";
import { analyzeBeatGrid } from "../lib/beat-grid.ts";
import { clearGridRejection, readTeachingMoments, rememberCompactDjRecord } from "../lib/dj-library.ts";
import { assessGridQuality, assessGridRetentionQuality } from "../lib/grid-quality.ts";
import { getMusicLibrary, publicTrack, resolveMusicPath, trackAudioUrl } from "../lib/music-library.ts";
import { reapplyStoredTeaching } from "../lib/teaching.ts";
import { extractTemplate, matchTemplate, rephaseBeats, GRID_OVERRIDE_STAMP_RADIUS_SECONDS } from "../lib/grid-override.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analysisDirectory = path.join(root, "public", "analysis");
const localFfmpeg = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffmpegPath = process.env.FFMPEG_BIN || (existsSync(localFfmpeg) ? localFfmpeg : "");
const completeLibrary = (await getMusicLibrary()).tracks;
const requestedIds = new Set(process.argv.slice(2));
const library = requestedIds.size ? completeLibrary.filter((track) => requestedIds.has(track.id)) : completeLibrary;
const sampleRate = 4000;
// The mapping route asks for one machine-readable line per real step
// (lib/load-progress.ts parseAnalyserLine) so the deck can show where the
// grid analysis is; the command-line output is unchanged without it.
const reportProgress = process.env.CROWD_ANALYSIS_PROGRESS === "1";
const progress = (event) => { if (reportProgress) process.stdout.write(`\nCROWD_PROGRESS ${JSON.stringify(event)}\n`); };

async function decodeMono(file, rate = sampleRate) {
  if (!ffmpegPath) throw new Error("The local FFmpeg audio decoder was not passed to the waveform worker.");
  // A long FFmpeg stdout pipe can occasionally stop draining on Windows even
  // though the source audio is healthy. Decode to the local SSD instead: it is
  // faster, bounded, and avoids holding a growing chain of pipe chunks.
  const decodeDirectory = await mkdtemp(path.join(tmpdir(), "crowd2-decode-"));
  const outputFile = path.join(decodeDirectory, "mono.f32le");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, [
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-threads", "1",
        "-i", file,
        "-vn",
        "-ac", "1",
        "-ar", String(rate),
        "-f", "f32le",
        "-y", outputFile,
      ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      const errors = [];
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error("FFmpeg did not finish its local waveform decode within 60 seconds."));
      }, 60_000);
      child.stderr.on("data", (chunk) => errors.push(chunk));
      child.on("error", finish);
      child.on("close", (code) => finish(code === 0
        ? null
        : new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited ${code}`)));
    });
    const bytes = await readFile(outputFile);
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  } finally {
    await rm(decodeDirectory, { recursive: true, force: true });
  }
}

async function decodeMonoAt(file, rate) {
  try { return await decodeMono(file, rate); } catch { return null; }
}

await mkdir(analysisDirectory, { recursive: true });
const existingIndex = await readFile(path.join(analysisDirectory, "index.json"), "utf8").then(JSON.parse).catch(() => []);
const index = requestedIds.size ? existingIndex.filter((item) => !requestedIds.has(item.id)) : [];
for (const [position, track] of library.entries()) {
  process.stdout.write(`[${position + 1}/${library.length}] ${track.name}: decoding... `);
  // Raw path is correct here: ffmpeg strips LAME encoder padding when it
  // decodes, so this timeline already equals the playback sidecar's —
  // measured 16 Aug 2026, raw-vs-sidecar cross-correlation lag exactly 0 ms.
  // (The Demucs call sites DO need seekAccuratePath: their reader keeps the
  // padding, which is the real 25 ms split. Don't confuse the two.)
  // 25 Aug 2026, DJ: every tune's evidence comes from the drums stem — the
  // full mix's rolling bass captured the phase fit (one bass-step early on
  // Bella Donna). The mapping job guarantees the stem exists before running
  // this script. A missing stem must never silently switch grid evidence to bass.
  const stemFile = kickStemPath(track.id);
  const mixFile = await resolveMusicPath(track);
  if (!stemFile || !existsSync(stemFile)) throw new Error(`No drums stem for ${track.id}; separate drums before mapping this tune.`);
  const sourceFile = stemFile;
  progress({ stage: "decode" });
  const samples = await decodeMono(sourceFile);
  const modelPayload = await readFile(path.join(analysisDirectory, `beat-this-${track.id}.json`), "utf8").then(JSON.parse).catch(() => null);
  const modelTrack = modelPayload?.tracks?.[0];
  progress({ stage: "fit", mode: modelTrack ? "model-guided" : "signal-only" });
  process.stdout.write(modelTrack ? "mapping model-guided grid... " : "mapping signal-only grid... ");
  const automaticAnalysis = analyzeBeatGrid(samples, sampleRate, { modelBeats: modelTrack?.beats, modelDownbeats: modelTrack?.downbeats });
  // Re-analysis must never destroy user teaching. The stored analysis file is
  // the authoritative record of taught windows and preferred cues, and the
  // teaching-moment memory is the fallback when no stored file survives.
  const storedAnalysis = await readFile(path.join(analysisDirectory, `${track.id}.json`), "utf8").then(JSON.parse).catch(() => null);
  const restoration = reapplyStoredTeaching(automaticAnalysis, storedAnalysis, await readTeachingMoments(track.id, 64));
  const analysis = restoration.analysis;
  if (restoration.restoredWindows.length || restoration.restoredCues) {
    progress({ stage: "teaching", windows: restoration.restoredWindows.length, cues: restoration.restoredCues });
    process.stdout.write(`restored ${restoration.restoredWindows.length} taught window${restoration.restoredWindows.length === 1 ? "" : "s"} and ${restoration.restoredCues} preferred cue${restoration.restoredCues === 1 ? "" : "s"}... `);
  }
  for (const failure of restoration.failures) {
    process.stdout.write(`taught window kept as evidence without a grid lock (${failure})... `);
  }
  // DJ, 30 Aug 2026 ("if the tune has no confidence, apply the logic used
  // to fix Artificial Intelligence"): when the verifier confesses it could
  // not check a single block, the fitted phase is a guess - measured tonight
  // sitting mid-way between kick families on AI. So a confessed tune gets
  // the same treatment DJ's press applies: anchor on a strong isolated
  // kick FOOT from the stem, re-phase the lattice rigidly onto it, then
  // fingerprint that kick and re-stamp the tune from its matches. A
  // SELF-CHECK measures grid-vs-feet in four windows afterwards and REVERTS
  // whenever the anchor did not clearly help - the auto pass can relocate a
  // grid, never degrade one. DJ's own GRID OVERRIDE press always outranks
  // this: it runs later and overwrites.
  if (analysis.verification?.status === "insufficient-evidence" && analysis.beats?.length > 64) {
    try {
      const SR = sampleRate;
      const subFeet = (from, to) => {
        const a1 = Math.exp(-2 * Math.PI * 90 / SR);
        let y1 = 0, y2 = 0;
        const i0 = Math.max(0, Math.floor(from * SR)), i1 = Math.min(samples.length, Math.ceil(to * SR));
        const per = Math.max(1, Math.round(SR / 1000));
        const env = [];
        for (let i = i0; i < i1; i += 1) {
          y1 += (1 - a1) * (samples[i] - y1); y2 += (1 - a1) * (y1 - y2);
          if ((i - i0) % per === 0) env.push(y2 * y2);
        }
        for (let i = 0; i < env.length; i += 1) env[i] = Math.sqrt(env[i]);
        let pk = 0; for (const v of env) pk = Math.max(pk, v);
        const feet = []; let last = -1e9;
        for (let f = 130; f < env.length - 30; f += 1) {
          if (env[f] >= 0.3 * pk && env[f] > env[f - 1]) {
            let peak = f; while (peak + 1 < env.length && env[peak + 1] >= env[peak]) peak += 1;
            if (peak - last < 250) { f = peak; continue; }
            let foot = peak; while (foot > 0 && env[foot] > 0.15 * env[peak]) foot -= 1;
            feet.push(from + foot / 1000); last = peak; f = peak;
          }
        }
        return feet;
      };
      const median = (arr) => { const v = arr.slice().sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
      const windowMedians = (beats) => [0.2, 0.4, 0.6, 0.8].map((frac) => {
        const t0 = frac * analysis.duration - 7, feet = subFeet(t0, t0 + 14);
        const offs = beats.filter((b) => b.time >= t0 + 1 && b.time <= t0 + 13).map((b) => {
          if (!feet.length) return null;
          const nearest = feet.reduce((best, k) => Math.abs(k - b.time) < Math.abs(best - b.time) ? k : best, feet[0]);
          return Math.abs(nearest - b.time) < 0.3 ? (b.time - nearest) * 1000 : null;
        }).filter((v) => v !== null);
        return offs.length >= 10 ? median(offs) : null;
      });
      const before = windowMedians(analysis.beats);
      // Anchor: the strongest isolated foot in the densest stretch (mid-tune bias).
      const mid = analysis.duration * 0.45;
      const anchorFeet = subFeet(mid, mid + 20);
      const anchor = anchorFeet.find((t, i) => i > 0 && i < anchorFeet.length - 1
        && (t - anchorFeet[i - 1]) > 0.32 && (anchorFeet[i + 1] - t) > 0.32) ?? anchorFeet[1];
      if (anchor) {
        const savedTimes = analysis.beats.map((b) => b.time);
        const { shiftSeconds } = rephaseBeats(analysis.beats, anchor);
        for (const b of analysis.beats) if (typeof b.nominalTime === "number") b.nominalTime += shiftSeconds;
        const after = windowMedians(analysis.beats);
        // Acceptance: judged only on the windows the tune can actually
        // yield (desert-heavy tunes may offer just two), and the shift must
        // clearly reduce the total distance to the feet - not merely pass a
        // threshold. Predator taught this: 2 valid windows, -17/-14 -> +2/+5,
        // rejected by a naive >=3-window demand.
        const valid = (arr) => arr.filter((m) => m !== null);
        const sumAbs = (arr) => valid(arr).reduce((t, m) => t + Math.abs(m), 0);
        const improved = valid(after).length >= Math.min(2, valid(before).length || 2)
          && valid(after).length >= valid(before).length
          && (valid(before).length === 0 || sumAbs(after) + 6 < sumAbs(before));
        if (improved) {
          const mixSamples8k = sourceFile === mixFile ? null : await decodeMonoAt(mixFile, 8000);
          if (mixSamples8k) {
            const template = extractTemplate(mixSamples8k, 8000, anchor);
            const matches = matchTemplate(mixSamples8k, 8000, template);
            let stamped = 0;
            for (const b of analysis.beats) {
              const near = matches.filter((m) => Math.abs(m.time - b.time) <= GRID_OVERRIDE_STAMP_RADIUS_SECONDS)
                .sort((l, r) => r.score - l.score)[0];
              if (near) {
                stamped += 1;
                b.attackTime = near.time; b.residualMs = (near.time - b.time) * 1000;
                b.strength = near.score; b.confidence = Math.max(0.3, Math.min(1, near.score));
                b.kickStatus = Math.abs(b.residualMs) <= 22 ? "aligned" : b.residualMs > 0 ? "early" : "late";
              }
            }
            analysis.gridAutoOverride = { anchor: +anchor.toFixed(3), shiftMs: +(shiftSeconds * 1000).toFixed(1), before, after, matches: matches.length, stamped };
            process.stdout.write(`auto grid-anchor: shifted ${(shiftSeconds * 1000).toFixed(1)} ms onto a kick foot (feet medians ${before.map(v=>v===null?"–":Math.round(v)).join("/")} -> ${after.map(v=>v===null?"–":Math.round(v)).join("/")}), ${stamped} beats re-stamped... `);
          }
        } else {
          for (let i = 0; i < analysis.beats.length; i += 1) {
            const delta = savedTimes[i] - analysis.beats[i].time;
            analysis.beats[i].time = savedTimes[i];
            if (typeof analysis.beats[i].nominalTime === "number") analysis.beats[i].nominalTime += delta;
          }
          analysis.gridAutoOverride = { rejected: true, anchor: +anchor.toFixed(3), before, after };
          process.stdout.write("auto grid-anchor tried and REVERTED (feet check did not improve)... ");
        }
      }
    } catch (autoError) {
      process.stdout.write(`auto grid-anchor skipped (${autoError instanceof Error ? autoError.message : "error"})... `);
    }
  }
  const gridQuality = assessGridQuality(analysis);
  const retentionQuality = assessGridRetentionQuality(analysis);
  // DJ, 30 Aug 2026 ("we put it after we load everything else... for
  // completeness"): the LAST step paints a display-only wave from the FULL
  // MIX. Every calculation upstream keeps eating the stem — these two
  // fields exist purely so the booth can DRAW the whole tune, and they sit
  // on the stem's clock for free (the 16 Aug one-clock re-cut). A missing
  // mix or a decode failure just leaves them out; the stem picture remains.
  if (sourceFile !== mixFile) {
    try {
      progress({ stage: "display" });
      process.stdout.write("painting full-mix display wave... ");
      const mixSamples = await decodeMono(mixFile);
      const hopSamples = Math.max(1, Math.round(analysis.hopSeconds * sampleRate));
      const alpha = Math.exp(-2 * Math.PI * 150 / sampleRate);
      let lowState = 0;
      const detailed = new Array(Math.ceil(mixSamples.length / hopSamples)).fill(0);
      for (let i = 0; i < mixSamples.length; i += 1) {
        lowState += (1 - alpha) * (mixSamples[i] - lowState);
        const magnitude = Math.abs(lowState);
        const frame = (i / hopSamples) | 0;
        if (magnitude > detailed[frame]) detailed[frame] = magnitude;
      }
      const sortedFrames = [...detailed].sort((a, b) => a - b);
      const scale = sortedFrames[Math.floor(sortedFrames.length * .98)] || 1;
      analysis.displayLowWaveformDetailed = detailed.map((v) => Math.round(Math.min(1, v / scale) * 1000) / 1000);
      const overviewLength = Math.max(2, analysis.lowWaveform?.length ?? 900);
      const perOverview = detailed.length / overviewLength;
      analysis.displayLowWaveform = Array.from({ length: overviewLength }, (_, i) => {
        let peak = 0;
        const from = Math.floor(i * perOverview), to = Math.min(detailed.length, Math.ceil((i + 1) * perOverview));
        for (let f = from; f < to; f += 1) if (analysis.displayLowWaveformDetailed[f] > peak) peak = analysis.displayLowWaveformDetailed[f];
        return peak;
      });
    } catch (displayError) {
      process.stdout.write(`display wave skipped (${displayError instanceof Error ? displayError.message : "error"})... `);
    }
  }
  const safeTrack = publicTrack({ ...track, duration: analysis.duration });
  const result = { track: safeTrack, ...analysis, gridQuality, retentionQuality, generatedAt: new Date().toISOString() };
  progress({ stage: "save" });
  await writeFile(path.join(analysisDirectory, `${track.id}.json`), JSON.stringify(result));
  const fileStat = await stat(sourceFile).catch(() => null);
  await rememberCompactDjRecord(track, result, fileStat ? { size: fileStat.size, modifiedMs: Math.round(fileStat.mtimeMs) } : null);
  await clearGridRejection(track.id);
  progress({ stage: "saved" });
  const summary = {
    ...safeTrack,
    duration: analysis.duration,
    bpm: analysis.selected.bpm,
    confidence: analysis.selected.probability,
    medianResidualMs: analysis.selected.medianResidualMs,
    mode: analysis.mode,
    verificationStatus: analysis.verification.status,
    verifiedBeatCoverage: analysis.verification.verifiedBeatCoverage,
    reviewBlocks: analysis.verification.reviewBlocks,
    noEvidenceBlocks: analysis.verification.noEvidenceBlocks,
    gridQuality,
    retentionQuality,
    analysis: trackAnalysisUrl(track.id),
    audio: trackAudioUrl(track),
  };
  index.push(summary);
  process.stdout.write(`${summary.bpm.toFixed(3)} BPM, ${summary.medianResidualMs.toFixed(1)} ms median residual, ${summary.verificationStatus}${summary.reviewBlocks ? ` (${summary.reviewBlocks} review)` : ""}; compact DJ memory saved${retentionQuality.accepted ? "" : " (grid warning kept as advisory)"}\n`);
}
index.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(path.join(analysisDirectory, "index.json"), JSON.stringify(index, null, 2));
console.log(`Finished ${library.length}/${library.length}.`);

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * One clock: whatever file the booth serves IS the time base, and everything
 * that measures audio must read that same timeline.
 *
 * Learned 16 Aug 2026, the hard way. LAME MP3s carry 1105 samples (25.057 ms)
 * of encoder padding. ffmpeg strips it when writing the `.seekable.wav`
 * sidecar the booth plays; Demucs kept it when stems were separated from raw
 * MP3s. Result: 18 stems — and every kick map derived from them — sat 25 ms
 * late in booth terms, every referee pass was blind to it (map and stem
 * shared the wrong clock, so it cancelled), and certified cues landed past
 * the slap they were certified onto. measure-stem-clock.mjs found it;
 * apply-stem-clock.mjs moved the data back; THIS module exists so no new
 * analysis can reintroduce it.
 *
 * Analysis code must resolve audio through seekAccuratePath, never hand
 * resolveMusicPath's result straight to a decoder or to Demucs.
 */

const ffmpegExecutable = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

/** Sidecar conversions in flight, so concurrent requests share one ffmpeg. */
const sharedJobs = globalThis as typeof globalThis & { __loudSidecarJobs?: Map<string, Promise<string | null>> };
const sidecarJobs = sharedJobs.__loudSidecarJobs ??= new Map<string, Promise<string | null>>();

/**
 * Compressed uploads seek by GUESSWORK: on a VBR MP3 the browser estimates a
 * byte offset, plays audio from up to half a second away, and then REPORTS the
 * requested time — measured on this booth's own uploads at −496 ms to +81 ms
 * within a single track. Every cue audition, click-to-play and mix entry
 * inherits that lie invisibly. WAV seeks are arithmetic on sample frames, so
 * the first request for a compressed upload transcodes a sidecar once and
 * every later seek is exact.
 */
export async function seekAccuratePath(file: string) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".wav" || extension === ".aiff" || extension === ".aif") return file;
  // Only local uploads get sidecars; the Elements crate is mostly WAV already
  // and lives on a drive this server should not write to.
  if (!/[\\/](uploads)[\\/]/.test(file)) return file;
  const sidecar = `${file.slice(0, -extension.length)}.seekable.wav`;
  const existing = await stat(sidecar).catch(() => null);
  if (existing?.isFile() && existing.size > 44) return sidecar;
  let job = sidecarJobs.get(sidecar);
  if (!job) {
    job = (async () => {
      // Route bundles and separate processes can decode the same upload at once.
      // Never let their encoders write to the same temporary file.
      const partial = `${sidecar}.${randomUUID()}.partial`;
      const converted = await new Promise<boolean>((resolve) => {
        // The partial suffix hides the extension, so the muxer must be named
        // explicitly — without -f wav, ffmpeg refuses the output file.
        const child = spawn(ffmpegExecutable, [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", file,
          "-map", "0:a:0",
          "-c:a", "pcm_s16le",
          "-f", "wav",
          partial,
        ], { windowsHide: true });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
      });
      if (!converted) {
        await unlink(partial).catch(() => undefined);
        return null;
      }
      try {
        for (let attempt = 0; ; attempt += 1) {
          const ready = await stat(sidecar).catch(() => null);
          if (ready?.isFile() && ready.size > 44) return sidecar;
          try { await rename(partial, sidecar); return sidecar; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 4 || !["EBUSY", "EPERM", "EACCES", "EEXIST"].includes(code ?? "")) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
      } finally {
        await unlink(partial).catch(() => undefined);
      }
    })();
    sidecarJobs.set(sidecar, job);
    // Handle both outcomes without creating an unhandled rejected finally promise.
    void job.then(() => sidecarJobs.delete(sidecar), () => sidecarJobs.delete(sidecar));
  }
  return await job ?? file;
}

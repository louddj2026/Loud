export const LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

type UploadableTrackFile = Blob & {
  name: string;
  type: string;
  size: number;
};

type LocalTrackUploadOptions = {
  fetcher?: typeof fetch;
  sleeper?: (milliseconds: number) => Promise<void>;
  onRetry?: (nextAttempt: number, totalAttempts: number, delayMs: number, error: unknown) => void;
};

/**
 * A selected File remains readable in the page while Crowd's local server is
 * briefly restarting. Retry network failures so that transient maintenance
 * cannot strand an otherwise playable tune as a browser-only deck.
 */
export async function uploadLocalTrackFile(file: UploadableTrackFile, options: LocalTrackUploadOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const totalAttempts = LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await fetcher("/api/upload-track", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Crowd-Filename": encodeURIComponent(file.name),
          "X-Crowd-Size": String(file.size),
        },
        body: file,
      });
    } catch (error) {
      const delayMs = LOCAL_TRACK_UPLOAD_RETRY_DELAYS_MS[attempt - 1];
      if (delayMs === undefined) throw error;
      options.onRetry?.(attempt + 1, totalAttempts, delayMs, error);
      await sleeper(delayMs);
    }
  }
  throw new Error("The selected file could not be sent to Crowd.");
}

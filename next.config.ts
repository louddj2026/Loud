import type { NextConfig } from "next";
import path from "node:path";

// A self-contained source checkout; no parent workspace or machine-specific IPs.
const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd()),
  outputFileTracingIncludes: {
    "/api/audio/[id]": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/audio-duration": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/crate-scan": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/map": ["./node_modules/ffmpeg-static/ffmpeg*", "./scripts/drums-stem-worker.py", "./scripts/drums-stem.py", "./scripts/drums_separation.py"],
    "/api/drum-analysis": ["./node_modules/ffmpeg-static/ffmpeg*", "./scripts/drums-stem-worker.py", "./scripts/drums-stem.py", "./scripts/drums_separation.py"],
  },
  turbopack: { root: path.resolve(process.cwd()) },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return ["/dj", "/crowd"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        { key: "Pragma", value: "no-cache" },
        { key: "Expires", value: "0" },
      ],
    }));
  },
};
export default config;

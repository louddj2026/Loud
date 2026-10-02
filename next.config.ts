import type { NextConfig } from "next";
import path from "node:path";

// A self-contained source checkout; no parent workspace or machine-specific IPs.
const config: NextConfig = {
  reactStrictMode: true,
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

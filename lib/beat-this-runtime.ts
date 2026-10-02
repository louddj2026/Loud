import path from "node:path";

export type BeatThisLocalInstall = {
  python: string | null;
  packages: string | null;
};

/**
 * Resolve the machine-local Beat This installation independently of launcher
 * environment variables. The production launcher still supplies the explicit
 * overrides, but a directly restarted standalone server can recover the same
 * durable installation instead of reporting that PyTorch is missing.
 */
export function localBeatThisInstall(localAppData = process.env.LOCALAPPDATA): BeatThisLocalInstall {
  if (!localAppData) return { python: null, packages: null };
  const environment = path.join(localAppData, "Crowd2", "analysis-env");
  return {
    python: path.join(environment, "Scripts", "python.exe"),
    packages: path.join(environment, "Lib", "site-packages"),
  };
}

import { spawn } from "node:child_process";

export function probeAudioDuration(executable: string, file: string) {
  return new Promise<number | null>((resolve) => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(executable, ["-hide_banner", "-i", file], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      finish(null);
      return;
    }
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { output = (output + chunk).slice(-12000); });
    child.on("error", () => finish(null));
    child.on("close", () => {
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      finish(match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null);
    });
  });
}

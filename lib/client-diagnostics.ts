import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

const MAX_CLIENT_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;
let diagnosticWriteQueue: Promise<void> = Promise.resolve();

export function clientDiagnosticLogPath() {
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Crowd2", "logs")
    : path.join(process.env.CROWD_DATA_ROOT ?? process.cwd(), "logs");
  return path.join(root, "crowd2-client.log");
}

async function rotateClientDiagnosticLog(file: string) {
  const info = await stat(file).catch(() => null);
  if (!info || info.size < MAX_CLIENT_DIAGNOSTIC_BYTES) return;
  const previous = `${file}.previous`;
  await unlink(previous).catch(() => undefined);
  await rename(file, previous).catch(() => undefined);
}

async function appendClientDiagnosticNow(record: Record<string, unknown>) {
  const file = clientDiagnosticLogPath();
  await mkdir(path.dirname(file), { recursive: true });
  await rotateClientDiagnosticLog(file);
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function appendClientDiagnostic(record: Record<string, unknown>) {
  // Browser events can arrive together (for example media-error plus a rejected
  // play promise). Serialise rotation and append so concurrent requests cannot
  // rename the live file out from underneath one another.
  diagnosticWriteQueue = diagnosticWriteQueue
    .catch(() => undefined)
    .then(() => appendClientDiagnosticNow(record));
  return diagnosticWriteQueue;
}

function cleanExceptionLine(line: string) {
  const match = line.match(/^(?:[\w.]+\.)?((?:[A-Za-z_][\w]*(?:Error|Exception)|Error|Exception))(?:\s+\[[^\]]+\])?:\s*(.+)$/);
  return match?.[2]?.trim() || line.trim();
}

export function friendlyMappingError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const gridRejection = raw.match(/Error:\s*(Grid rejected instead of saved:[^\r\n]+)/i)?.[1];
  if (gridRejection) return gridRejection;

  // Python writes the useful exception at the bottom of a traceback. Showing
  // its first line only produced the meaningless "most recent call last" UI.
  const pythonException = [...lines].reverse().find((line) =>
    /^(?:[\w.]+\.)?[A-Za-z_][\w]*(?:Error|Exception):\s*\S/.test(line),
  );
  if (pythonException) return cleanExceptionLine(pythonException);

  const nodeException = lines.find((line) =>
    /^(?:[\w.]+\.)?(?:[A-Za-z_][\w]*(?:Error|Exception)|Error|Exception)(?:\s+\[[^\]]+\])?:\s*\S/.test(line),
  );
  if (nodeException) return cleanExceptionLine(nodeException);

  const explicitError = lines.find((line) => /^Error:\s+/.test(line));
  if (explicitError) return explicitError.replace(/^Error:\s+/, "");

  return [...lines].reverse().find((line) =>
    line !== "Traceback (most recent call last):"
      && !/^Node\.js v\d/i.test(line)
      && !line.startsWith("File ")
      && !line.startsWith("file:")
      && !line.startsWith("at "),
  ) ?? "Mapping failed";
}

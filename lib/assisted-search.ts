export const ASSISTED_DECISION_LOG_LIMIT = 20;

export function assistedSelectionPool<T extends { id: string }>(tracks: readonly T[], usedIds: ReadonlySet<string>) {
  return tracks.filter((track) => !usedIds.has(track.id));
}

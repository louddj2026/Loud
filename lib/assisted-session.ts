export const ASSISTED_SESSION_STORAGE_KEY = "crowd2-assisted-session-v1";

export type AssistedSessionSnapshot = {
  version: 1;
  source: "random" | "loaded";
  order: number;
  deck: "A" | "B" | "C";
  trackId: string;
  mixInRequired: boolean;
  mixInSet: boolean;
  mixOutSet: boolean;
  introPrepSkipped: boolean;
  selection: {
    selectedBpm: number;
    previousTrackId: string | null;
    previousTrackName: string | null;
    previousBpm: number | null;
  };
  launchedOrder: number;
  wasPlaying: boolean;
  savedAt: string;
};

type SnapshotInput = Omit<AssistedSessionSnapshot, "version" | "savedAt">;

export function createAssistedSessionSnapshot(input: SnapshotInput, savedAt = new Date().toISOString()): AssistedSessionSnapshot {
  return { version: 1, ...input, savedAt };
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function nullableFiniteNumber(value: unknown) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

export function parseAssistedSessionSnapshot(value: string | null): AssistedSessionSnapshot | null {
  if (!value) return null;
  try {
    const snapshot = JSON.parse(value) as Partial<AssistedSessionSnapshot>;
    if (snapshot.version !== 1) return null;
    if (snapshot.source !== undefined && snapshot.source !== "random" && snapshot.source !== "loaded") return null;
    if (!Number.isInteger(snapshot.order) || Number(snapshot.order) < 0) return null;
    if (snapshot.deck !== "A" && snapshot.deck !== "B" && snapshot.deck !== "C") return null;
    if (typeof snapshot.trackId !== "string" || !snapshot.trackId) return null;
    if (typeof snapshot.mixInRequired !== "boolean"
      || typeof snapshot.mixInSet !== "boolean"
      || typeof snapshot.mixOutSet !== "boolean"
      || typeof snapshot.introPrepSkipped !== "boolean"
      || typeof snapshot.wasPlaying !== "boolean") return null;
    if (!snapshot.selection
      || typeof snapshot.selection.selectedBpm !== "number"
      || !Number.isFinite(snapshot.selection.selectedBpm)
      || !nullableString(snapshot.selection.previousTrackId)
      || !nullableString(snapshot.selection.previousTrackName)
      || !nullableFiniteNumber(snapshot.selection.previousBpm)) return null;
    if (!Number.isInteger(snapshot.launchedOrder) || Number(snapshot.launchedOrder) < -1) return null;
    if (typeof snapshot.savedAt !== "string" || !snapshot.savedAt) return null;
    return { ...snapshot, source: snapshot.source ?? "random" } as AssistedSessionSnapshot;
  } catch {
    return null;
  }
}

export function assistedSessionReady(snapshot: AssistedSessionSnapshot) {
  // Tune 1 needs its outgoing Mix Out. Every later tune is ready for the
  // current transition when its incoming Mix In is set; its own Mix Out is
  // preparation for the following transition.
  return snapshot.order === 0 ? snapshot.mixOutSet : snapshot.mixInSet;
}

// The whole-crate scan walks the album/name-sorted Elements listing by
// position. That position is only meaningful against the exact listing it was
// saved from: re-running scripts/index-elements-crate.mjs re-derives and
// re-sorts the listing, so any insertion, removal, or rename shifts every
// later position and a stale cursor would silently skip tunes. These helpers
// tie the persisted cursor to the crate's generatedAt stamp and remember
// per-tune outcomes by id so a restarted walk stays cheap.

export type CrateScanResumePosition = {
  cursor: number;
  checked: number;
  mapped: number;
  rejected: number;
  skippedShort: number;
  skippedKnown: number;
  compacted: number;
  rejectedIds: string[];
  skippedShortIds: string[];
  crateGeneratedAt: string | null;
};

export function reconcileCrateScanCursor<State extends CrateScanResumePosition>(state: State, crateGeneratedAt: string): State {
  if (state.crateGeneratedAt !== crateGeneratedAt) {
    state.cursor = 0;
    state.checked = 0;
    state.mapped = 0;
    state.rejected = 0;
    state.skippedShort = 0;
    state.skippedKnown = 0;
    state.compacted = 0;
    state.crateGeneratedAt = crateGeneratedAt;
  }
  return state;
}

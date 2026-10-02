import type { TeachableAnalysis } from "./teaching.ts";

/** Saving or undoing mix placements must never replace the analyser's output.
 * Keep this boundary even if a teaching helper later gains grid-editing behaviour.
 * Explicit analysis/grid edits belong to their own actions.
 */
export function withPlacementMetadata<T extends TeachableAnalysis>(
  current: T,
  placement: Pick<TeachableAnalysis, "teaching">,
): T {
  return { ...current, teaching: placement.teaching };
}

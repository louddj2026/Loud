import type { KickPhaseStatus } from "./kick-phase-monitor.ts";

/**
 * Kick phase as a colour, for the Preview Mix playheads.
 *
 * The kick-phase monitor already measures whether the incoming tune's kicks sit
 * early, late or together with the outgoing one. Showing that on the playheads
 * turns it into something readable at a glance while a mix auditions.
 *
 * This is diagnosis only. It reports what the two tunes are doing; it must
 * never feed back into tempo — the confirmed windows are the tempo authority
 * and a phase reading is not permitted to bend them.
 */

export type KickPhaseColour = {
  colour: string;
  /** Short word for the readout beside the wave. */
  label: string;
  /** True while there is not yet enough evidence to claim anything. */
  provisional: boolean;
};

export const KICK_PHASE_ALIGNED = "#4cf2b4";
export const KICK_PHASE_EARLY = "#55a7ff";
export const KICK_PHASE_LATE = "#ff5a67";
export const KICK_PHASE_UNKNOWN = "#8fa3ad";
/** Hue aliases for the per-head scheme: blue = the slow head, red = the fast one. */
export const KICK_PHASE_SLOW_BLUE = KICK_PHASE_EARLY;
export const KICK_PHASE_FAST_RED = KICK_PHASE_LATE;

/**
 * Per-playhead colours (DJ, 30 Aug 2026): "the moving playhead should be
 * green when tunes in time; if tunes not in time, the slow playhead should
 * be blue, the fast playhead should be red."
 *
 * The monitor speaks in the incoming tune's terms — incoming-early means
 * the incoming kicks land AHEAD of the outgoing's, so the incoming is the
 * fast head and the outgoing is, relatively, the slow one. Locked paints
 * both heads green; a directionless reading (drifting, unstable, still
 * measuring) stays neutral rather than implying a direction the
 * measurement cannot support; anything else makes no claim (white head).
 */
export function kickPhaseColoursForRoles(status: KickPhaseStatus | null | undefined): { outgoing: string | null; incoming: string | null } {
  switch (status) {
    case "aligned":
      return { outgoing: KICK_PHASE_ALIGNED, incoming: KICK_PHASE_ALIGNED };
    case "incoming-early":
      return { outgoing: KICK_PHASE_SLOW_BLUE, incoming: KICK_PHASE_FAST_RED };
    case "incoming-late":
      return { outgoing: KICK_PHASE_FAST_RED, incoming: KICK_PHASE_SLOW_BLUE };
    case "drifting":
    case "unstable":
    case "measuring":
      return { outgoing: KICK_PHASE_UNKNOWN, incoming: KICK_PHASE_UNKNOWN };
    default:
      return { outgoing: null, incoming: null };
  }
}

export function kickPhaseColour(status: KickPhaseStatus | null | undefined): KickPhaseColour {
  switch (status) {
    case "aligned":
      return { colour: KICK_PHASE_ALIGNED, label: "LOCKED", provisional: false };
    case "incoming-early":
      return { colour: KICK_PHASE_EARLY, label: "IN EARLY", provisional: false };
    case "incoming-late":
      return { colour: KICK_PHASE_LATE, label: "IN LATE", provisional: false };
    // Drifting and unstable are real readings, but neither says "early" or
    // "late" on its own, so they keep the neutral colour rather than implying
    // a direction the measurement cannot support.
    case "drifting":
      return { colour: KICK_PHASE_UNKNOWN, label: "DRIFTING", provisional: false };
    case "unstable":
      return { colour: KICK_PHASE_UNKNOWN, label: "UNSTABLE", provisional: true };
    case "measuring":
      return { colour: KICK_PHASE_UNKNOWN, label: "MEASURING", provisional: true };
    default:
      return { colour: KICK_PHASE_UNKNOWN, label: "", provisional: true };
  }
}

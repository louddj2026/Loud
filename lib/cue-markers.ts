import type { DemoCuePoint } from "./demo-set.ts";
import type { AnalysisTeaching } from "./teaching.ts";

type CueMarkerAnalysis = {
  duration: number;
  teaching?: AnalysisTeaching;
};

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * Return only the two user-facing arrangement markers.
 *
 * Only manual intro/outro markers are rendered. Predicted cue evidence remains
 * available to the planning and teaching logic, but is deliberately hidden
 * from the booth waveforms.
 */
export function buildIntroOutroCues(
  analysis: CueMarkerAnalysis,
  _plannedTrack?: unknown,
): DemoCuePoint[] {
  const cues: DemoCuePoint[] = [];
  const teaching = analysis.teaching;
  const currentEntry = teaching?.preferredEntryCue;

  if (currentEntry) {
    cues.push({
      id: "entry-drop",
      time: clamp(currentEntry.time, 0, analysis.duration),
      label: "YOUR INTRO",
      description: "Your replacement intro cue for this tune.",
      colour: "#ff4f98",
    });
  }

  const currentExit = teaching?.preferredCue;

  if (currentExit) {
    cues.push({
      id: "exit-handoff",
      time: clamp(currentExit.time, 0, analysis.duration),
      label: "YOUR OUTRO",
      description: "Your replacement outro cue for this tune.",
      colour: "#ff6a4a",
    });
  }

  return cues.sort((left, right) => left.time - right.time);
}

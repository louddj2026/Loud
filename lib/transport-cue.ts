type Beat = { time: number };
/** Align a retrigger near its saved cue to the other playing deck's beat phase.
 * Only the seek position changes; playback rate and the saved cue stay literal.
 */
export function cueRetriggerTime(cue: number, beats: readonly Beat[] | undefined, reference: { beats: readonly Beat[] | undefined; time: number } | null): number {
  if (!reference || !beats || beats.length < 2 || !reference.beats || reference.beats.length < 2) return cue;
  const ref = reference.beats;
  const index = ref.findIndex((beat, i) => i < ref.length - 1 && beat.time <= reference.time && reference.time < ref[i + 1].time);
  if (index < 0) return cue;
  const fraction = (reference.time - ref[index].time) / (ref[index + 1].time - ref[index].time);
  let nearest = cue;
  let distance = Infinity;
  for (let i = 0; i < beats.length - 1; i++) {
    const span = beats[i + 1].time - beats[i].time;
    if (!(span > 0)) continue;
    const candidate = beats[i].time + fraction * span;
    const delta = Math.abs(candidate - cue);
    // Never jump far away when the cue is outside the available grid.
    if (delta <= span && delta < distance) { nearest = candidate; distance = delta; }
  }
  return nearest;
}

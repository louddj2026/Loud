/**
 * Grid override — the ear anchors, the machine matches. DJ, 29 Aug 2026.
 *
 * Born at the end of the Predator night, which proved (by measurement, five
 * instruments deep) that no automatic landmark survives contact with this
 * library: the ear is the only authority on where a kick IS. So the flow
 * inverts: in the preview, DJ disarms snap, parks the playhead on a kick by
 * ear, and confirms. The whole grid re-phases rigidly so a beat sits exactly
 * there — the fitted tempo curve is preserved, nothing else about the lattice
 * changes — and the sound at his anchor becomes the tune's kick fingerprint:
 * a multi-band transient-attack template, matched across the full mix to
 * re-stamp attackTime/kickStatus with events that genuinely sound like HIS
 * kick. Runs only on an explicit press; never on analysis.
 */

export type KickTemplate = {
  sampleRate: number;
  frameSeconds: number;
  /** z-normalised per band: [sub, mid, high][frames] */
  bands: number[][];
};

export type TemplateMatch = { time: number; score: number };

export type GridOverrideResult = {
  shiftMs: number;
  anchorBeatIndex: number;
  matches: TemplateMatch[];
  stamped: number;
};

const FRAME_SECONDS = 0.005;
const TEMPLATE_BEFORE_SECONDS = 0.03;
const TEMPLATE_AFTER_SECONDS = 0.11;
const MIN_MATCH_SPACING_SECONDS = 0.24;
export const GRID_OVERRIDE_MATCH_FLOOR = 0.62;
export const GRID_OVERRIDE_STAMP_RADIUS_SECONDS = 0.07;

function onePole(cutoffHz: number, sampleRate: number) {
  const a = Math.exp(-2 * Math.PI * cutoffHz / sampleRate);
  let y = 0;
  return (x: number) => { y += (1 - a) * (x - y); return y; };
}

/** Three-band 5 ms energy envelopes: sub (kick body), mid (punch), high (click). */
export function bandEnvelopes(samples: Float32Array, sampleRate: number) {
  const frame = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const frames = Math.floor(samples.length / frame);
  const sub = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  const lowLp = onePole(140, sampleRate);
  const midLp = onePole(2200, sampleRate);
  const midHp = onePole(220, sampleRate);
  const highHp = onePole(2600, sampleRate);
  for (let f = 0; f < frames; f += 1) {
    let es = 0, em = 0, eh = 0;
    for (let i = f * frame; i < (f + 1) * frame; i += 1) {
      const x = samples[i];
      const lo = lowLp(x);
      const midFull = midLp(x);
      const m = midFull - midHp(midFull);
      const h = x - highHp(x);
      es += lo * lo; em += m * m; eh += h * h;
    }
    sub[f] = Math.sqrt(es / frame);
    mid[f] = Math.sqrt(em / frame);
    high[f] = Math.sqrt(eh / frame);
  }
  return { sub, mid, high, frameSeconds: FRAME_SECONDS };
}

function zNormalise(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  return values.map((v) => (v - mean) / sd);
}

export function extractTemplate(samples: Float32Array, sampleRate: number, anchorSeconds: number): KickTemplate {
  const env = bandEnvelopes(samples, sampleRate);
  const centre = Math.round(anchorSeconds / env.frameSeconds);
  const from = Math.max(0, centre - Math.round(TEMPLATE_BEFORE_SECONDS / env.frameSeconds));
  const to = Math.min(env.sub.length, centre + Math.round(TEMPLATE_AFTER_SECONDS / env.frameSeconds));
  const slice = (band: Float32Array) => zNormalise(Array.from(band.subarray(from, to)));
  return { sampleRate, frameSeconds: env.frameSeconds, bands: [slice(env.sub), slice(env.mid), slice(env.high)] };
}

/**
 * Slide the template across the tune; return similarity peaks. Correlation is
 * averaged across the three bands so a match must share the anchor's SHAPE in
 * body, punch and click together — a bass swell with no click cannot score.
 */
export function matchTemplate(samples: Float32Array, sampleRate: number, template: KickTemplate): TemplateMatch[] {
  const env = bandEnvelopes(samples, sampleRate);
  const bands = [env.sub, env.mid, env.high];
  const width = template.bands[0].length;
  if (!width || env.sub.length <= width) return [];
  const scores = new Float32Array(env.sub.length - width);
  for (let start = 0; start < scores.length; start += 1) {
    let total = 0;
    for (let b = 0; b < 3; b += 1) {
      const t = template.bands[b];
      const band = bands[b];
      let mean = 0;
      for (let i = 0; i < width; i += 1) mean += band[start + i];
      mean /= width;
      let sd = 0;
      for (let i = 0; i < width; i += 1) sd += (band[start + i] - mean) ** 2;
      sd = Math.sqrt(sd / width) || 1;
      let dot = 0;
      for (let i = 0; i < width; i += 1) dot += t[i] * ((band[start + i] - mean) / sd);
      total += dot / width;
    }
    scores[start] = total / 3;
  }
  const minGap = Math.round(MIN_MATCH_SPACING_SECONDS / template.frameSeconds);
  const matches: TemplateMatch[] = [];
  for (let i = 1; i < scores.length - 1; i += 1) {
    if (scores[i] < GRID_OVERRIDE_MATCH_FLOOR) continue;
    if (scores[i] < scores[i - 1] || scores[i] < scores[i + 1]) continue;
    const last = matches[matches.length - 1];
    const time = (i + Math.round(TEMPLATE_BEFORE_SECONDS / template.frameSeconds)) * template.frameSeconds;
    if (last && time - last.time < MIN_MATCH_SPACING_SECONDS) {
      if (scores[i] > last.score) { last.time = time; last.score = scores[i]; }
      continue;
    }
    matches.push({ time, score: scores[i] });
  }
  return matches;
}

/**
 * Rigid re-phase: shift every beat so the nearest beat lands exactly on the
 * anchor. The fitted tempo curve (and any drift shape it carries) survives —
 * only the phase moves, which is precisely what the ear corrected.
 */
export function rephaseBeats<T extends { time: number }>(beats: T[], anchorSeconds: number) {
  if (!beats.length) return { shiftSeconds: 0, anchorBeatIndex: -1 };
  let anchorBeatIndex = 0;
  for (let i = 1; i < beats.length; i += 1) {
    if (Math.abs(beats[i].time - anchorSeconds) < Math.abs(beats[anchorBeatIndex].time - anchorSeconds)) anchorBeatIndex = i;
  }
  const shiftSeconds = anchorSeconds - beats[anchorBeatIndex].time;
  for (const beat of beats) beat.time += shiftSeconds;
  return { shiftSeconds, anchorBeatIndex };
}

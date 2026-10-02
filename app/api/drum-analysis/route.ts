import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "../../../lib/data-root.ts";
import { rememberCompactDjRecord } from "../../../lib/dj-library.ts";
import { getMusicTrack } from "../../../lib/music-library.ts";
import { enqueueKickAnalysis, kickAnalysisStatus, kickBoothIsIdle, reportKickBoothIdle } from "../../../lib/kick-analysis.ts";
import { kickGridFor } from "../../../lib/kick-grid-store.ts";
import { kickGridApplyDecision } from "../../../lib/kick-grid-apply.ts";
import { buildKickMap } from "../../../lib/kick-map.ts";
import { kickHitsFor } from "../../../lib/kick-hits-store.ts";
import { storedGridJudged } from "../../../lib/grid-verdict-store.ts";
import { proposeLabelCues } from "../../../lib/label-cue.ts";
import { sectionSpansForTrack } from "../../../lib/section-label-store.ts";
import { cueTeachingComparison, type TeachableAnalysis } from "../../../lib/teaching.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");
const undoDirectory = path.join(durableDataRoot, "teaching-undo");

/**
 * Analysis writes are serialised against the teaching route's own.
 *
 * The key is shared with `app/api/dj-library/teaching/route.ts` on purpose: both
 * read a track's analysis, transform it and write it back, so two of them
 * interleaving would lose whichever finished first. One tail, both routes.
 */
type MutationGlobals = typeof globalThis & { __crowd2TeachingMutationTail?: Promise<void> };
const mutationGlobals = globalThis as MutationGlobals;

function serialiseAnalysisMutation<T>(work: () => Promise<T>) {
  const previous = mutationGlobals.__crowd2TeachingMutationTail ?? Promise.resolve();
  const execution = previous.catch(() => undefined).then(work);
  mutationGlobals.__crowd2TeachingMutationTail = execution.then(() => undefined, () => undefined);
  return execution;
}

/**
 * Drum-derived grid and cue proposal for one track.
 *
 * Everything here is a proposal. The app's rule is that measurement never moves a
 * placed grid or cue without an explicit press, so nothing is applied — the booth
 * shows what was found and adopting it is a deliberate action.
 */
function proposalFor(trackId: string, durationSeconds: number) {
  const grid = kickGridFor(trackId);
  const hits = kickHitsFor(trackId);
  if (!grid) return { ready: false as const };
  const spans = sectionSpansForTrack(trackId);
  /**
   * Every uploaded track carries `duration: 0` in the library index, so the
   * caller's number is usually missing — and a cue proposer given no duration
   * returns nothing, which reads as "no cue found" rather than "never asked".
   *
   * The labels are computed over the whole file, so their last boundary is the
   * length All-In-One measured. It is exact enough to place a cue against, and a
   * deck that knows better sends its own.
   */
  const duration = durationSeconds > 0 ? durationSeconds : spans.at(-1)?.end ?? 0;
  // Both roles, because DJ's rule names both and they anchor on opposite ends of
  // the chorus list: mix IN on an early chorus, mix OUT on a late one, correct
  // 13/13 each way on his marked windows.
  // The detected kicks travel with it: the grid beat says which bar, the kick under
  // it says exactly where, and DJ's rule is that no cue sits partway through one.
  const kicks: readonly number[] = hits?.times ?? [];
  const cue = spans.length ? {
    mixIn: proposeLabelCues(spans, grid.beats, duration, "mix-in", kicks),
    mixOut: proposeLabelCues(spans, grid.beats, duration, "mix-out", kicks),
  } : null;
  return {
    ready: true as const,
    grid: {
      bpm: grid.bpm,
      firstBeatMs: grid.firstBeatMs,
      beatCount: grid.beatCount,
      // Fit quality travels with it: a grid explaining 67% of the kicks is not the
      // same claim as one explaining 96%, and the booth should say which.
      explains: grid.explains,
      covered: grid.covered,
      medianErrorMs: grid.medianErrorMs,
      kicksDetected: hits?.times.length ?? null,
      computedAt: grid.computedAt,
    },
    cue,
    sections: spans.length,
    /**
     * The kick map itself: where the drums actually hit, not where a grid says
     * they should.
     *
     * Sent as whole milliseconds — a thousandth of a second is far finer than
     * anything a hand can place or an eye can see at any zoom, and it keeps a
     * 1,200-kick tune to a few KB. The booth draws these beside the grid rather
     * than instead of it: the grid is the metronome, this is the record.
     */
    kicks: kicks.map((time) => Math.round(time * 1000)),
    /**
     * How hard each of those hit, 0..1000, matching the times.
     *
     * Nothing is filtered out of the map — a stutter or a fill is a real drum hit
     * and deleting it would make the record lie about what was played. But a
     * detection at strength 2 is silence being called a kick, and on one tune the
     * bottom tenth of the distribution sat exactly there. So confidence travels
     * with the map and the wave draws it: strong solid, weak faint, nothing
     * hidden, and no threshold picked by hand deciding what you get to see.
     */
    kickStrengths: hits?.strengths ?? [],
  };
}

function manualGridPlaced(analysis: TeachableAnalysis) {
  const teaching = analysis.teaching;
  // DJ's own windows are always protected. A `cycle` declaration with no
  // intro/outro window is the app's own apply — machine-placed, so the machine
  // may refresh it with a better fit. Without this carve-out the first grid a
  // tune ever gets would freeze there, bugs included.
  if (teaching?.manualIntroCycle || teaching?.manualOutroCycle) return true;
  if (teaching?.manualCycle && teaching.manualCycle.purpose !== "cycle") return true;
  if (teaching?.manualCycle?.purpose === "cycle") return false;
  return analysis.beats.some((beat) => (beat as { manualGridAuthoritative?: boolean }).manualGridAuthoritative);
}

function storedBpm(analysis: TeachableAnalysis) {
  return analysis.selected?.bpm ?? analysis.tempoSections[0]?.bpm ?? null;
}

/**
 * Put the best guess on the tune: the beat at a chorus start, and the one at a
 * chorus end.
 *
 * Written to `preferredCue`/`preferredEntryCue` because that is the only place a
 * cue survives a deck load — `predictedCue` is stripped and recomputed from the
 * learned profile every time a tune is loaded, so anything written there would
 * vanish before it was seen. Stamped `source: "label-cue"` so it can never be
 * mistaken for, or mined as, a cue DJ placed himself.
 *
 * A cue already on the tune is never touched, stamped or not. This places what is
 * missing; it does not have opinions about what is there.
 */
function placeLabelCues(analysis: TeachableAnalysis, trackId: string, duration: number) {
  const grid = kickGridFor(trackId);
  const spans = sectionSpansForTrack(trackId);
  if (!grid || !spans.length) return { analysis, placed: [] as string[] };
  const kicks = kickHitsFor(trackId)?.times ?? [];
  const teaching = analysis.teaching ?? {};
  const placed: string[] = [];
  let next = analysis;
  // The entry's simple-with-bassline veto listens to the analysis's own band
  // envelopes: bass straight from the bassline band, busy as everything the
  // low band does not explain — the part that would fight the outgoing tune.
  const bands = analysis as { waveform?: number[]; lowWaveform?: number[]; bassLowWaveformDetailed?: number[] };
  const activity = bands.bassLowWaveformDetailed?.length && bands.waveform?.length && bands.lowWaveform?.length
    ? {
      bass: bands.bassLowWaveformDetailed,
      busy: bands.waveform.map((value, index) => Math.max(0, value - (bands.lowWaveform![index] ?? 0))),
    }
    : null;
  for (const [role, field] of [["mix-in", "preferredEntryCue"], ["mix-out", "preferredCue"]] as const) {
    if (teaching[field]) continue;
    const proposal = proposeLabelCues(spans, grid.beats, duration, role, kicks, activity);
    // The label's own boundary, which is the best guess: the right chorus every
    // time, the right phrase inside it four times in thirteen.
    const best = proposal?.candidates.find((candidate) => candidate.phraseOffset === 0) ?? proposal?.candidates[0];
    if (!best) continue;
    const cue = { ...cueTeachingComparison(next, best.time, best.time), source: "label-cue" as const };
    next = { ...next, teaching: { ...next.teaching, [field]: cue } } as TeachableAnalysis;
    placed.push(`${role} ${best.time.toFixed(2)}s${best.onKick ? "" : " (no kick there)"}`);
  }
  return { analysis: next, placed };
}

export type KickGridApplyOutcome = {
  applied: boolean;
  because: string;
  /** What was placed, said plainly, so a cue never appears without explanation. */
  cuesPlaced?: string[];
  analysis?: TeachableAnalysis;
  /** Reverts through the teaching route's existing DELETE, which reads this file. */
  undoToken?: string;
  bpm?: number;
  /**
   * True when the refusal was about this moment rather than this track.
   *
   * A deck being live is a state that ends; an ear verdict is not. Without the
   * distinction the booth would remember "held" for a tune loaded during a mix and
   * never look again once the room went quiet.
   */
  retry?: boolean;
};

/**
 * Put the kick map on a tune that has nothing to protect.
 *
 * This used to declare a uniform grid through `applyManualCycleGrid` — one tempo,
 * every beat an approximation, including the beats sitting on real drums. DJ's
 * spec replaced it, 13 Aug: the tune's beats ARE the kick map. Every beat with a
 * kick is that kick's detected time verbatim; only kickless space is interpolated,
 * and from the kicks either side rather than from the skeleton.
 *
 * The purpose stays `cycle`, so every reader of manual windows still sees no mix
 * window and no run-up, and a machine map stays refreshable by a better one while
 * DJ's own windows stay untouchable.
 *
 * No teaching moment is recorded. The learning corpus is evidence about what DJ
 * does, and a map Crowd built for itself is not that; filing it there would make
 * the profile agree with the app's own measurements, which is the circularity that
 * killed the pre-cue bass dip.
 */
async function applyKickGrid(trackId: string): Promise<KickGridApplyOutcome> {
  const grid = kickGridFor(trackId);
  if (!grid) return { applied: false, because: "there is no fitted grid for that track yet", retry: true };
  // Same protection the separation gets, for a different reason: this one moves
  // every beat in the tune, and doing that under a live deck is unforgivable.
  if (!kickBoothIsIdle()) return { applied: false, because: "held while a deck is playing", retry: true };
  const track = await getMusicTrack(trackId).catch(() => null);
  if (!track) return { applied: false, because: "that track is not in the music library" };

  const file = path.join(analysisDirectory, `${trackId}.json`);
  let analysis: TeachableAnalysis;
  try {
    analysis = JSON.parse(await readFile(file, "utf8")) as TeachableAnalysis;
  } catch {
    return { applied: false, because: "that track has no mapped analysis to put a grid in" };
  }
  if (!analysis.beats?.length) return { applied: false, because: "that track has no mapped grid to follow" };

  const decision = kickGridApplyDecision(grid, {
    judged: storedGridJudged(trackId),
    manualGrid: manualGridPlaced(analysis),
    duration: analysis.duration,
  });
  // A held grid still gets its cues: the labels name the chorus and the tune's
  // own grid is what a cue on it should land on. Refusing both because one is
  // refused would leave a judged tune with no entry and no exit for no reason.
  if (!decision.apply) return applyCuesOnly(trackId, analysis, file, track, decision.because);

  /**
   * The kick map becomes the tune's beats, one for one.
   *
   * DJ's spec: every kick verbatim, approximations only where there are no
   * kicks, and those derived from the kicks either side. So this does NOT
   * declare a uniform grid over the tune — it writes the map itself. The beat
   * you see and cue on IS the detected kick, to the millisecond, and only the
   * gaps carry interpolated times. The skeleton tempo goes to `selected` for
   * the BPM readout and beatmatching; it places nothing.
   */
  const kickTimes = kickHitsFor(trackId)?.times ?? [];
  const map = buildKickMap(kickTimes, analysis.duration);
  if (!map) return applyCuesOnly(trackId, analysis, file, track, "no kick map could be built from those kicks");

  // Bar phase is inherited from the old grid: the kicks say where beats are,
  // nothing about which is beat 1, and rotating every bar would move the phrasing.
  const oldDownbeats = analysis.beats.filter((beat) => beat.isDownbeat).map((beat) => beat.time);
  const anchorPoint = map.points.findIndex((point) => point.exact);
  const anchorTime = map.points[Math.max(0, anchorPoint)].time;
  const nearestOldDownbeat = oldDownbeats.length
    ? oldDownbeats.reduce((best, time) => Math.abs(time - anchorTime) < Math.abs(best - anchorTime) ? time : best)
    : anchorTime;
  const downbeatIndex = map.points.reduce(
    (best, point, index) => Math.abs(point.time - nearestOldDownbeat) < Math.abs(map.points[best].time - nearestOldDownbeat) ? index : best,
    0,
  );
  const previous = analysis;
  const period = 60 / map.bpm;
  const mapped = {
    ...analysis,
    beats: map.points.map((point, index) => {
      const relative = index - downbeatIndex;
      const inBar = ((relative % 4) + 4) % 4;
      return {
        beat: index,
        time: Math.round(point.time * 1000) / 1000,
        nominalTime: Math.round(point.time * 1000) / 1000,
        // Exact points are drums, certain; fills are held time, and say so.
        confidence: point.exact ? 1 : .7,
        isDownbeat: inBar === 0,
        beatInBar: inBar + 1,
        isPhraseStart: ((relative % 16) + 16) % 16 === 0,
        phraseConfidence: point.exact ? 1 : .7,
        manualGridAuthoritative: true,
      };
    }),
    tempoSections: [{ start: 0, end: analysis.duration, bpm: map.bpm, confidence: 1 }],
    ...(analysis.selected ? {
      selected: {
        ...analysis.selected,
        bpm: map.bpm,
        period,
        phase: ((anchorTime % period) + period) % period,
        probability: 1,
        metricalRelation: "primary",
      },
    } : {}),
    teaching: {
      ...analysis.teaching,
      // Machine-owned marker: purpose "cycle" is what lets a later, better map
      // refresh this one, and what keeps DJ's own windows untouchable.
      manualCycle: {
        start: map.points[0].time,
        end: map.points[map.points.length - 1].time,
        beats: map.points.length - 1,
        bpm: map.bpm,
        crowdBpm: storedBpm(analysis) ?? map.bpm,
        crowdNearestStart: map.points[0].time,
        crowdNearestEnd: map.points[map.points.length - 1].time,
        startVsGridMs: 0,
        endVsGridMs: 0,
        tempoAuthority: "decisive" as const,
        purpose: "cycle" as const,
        selectedAt: new Date().toISOString(),
      },
    },
  } as TeachableAnalysis;
  const result = { analysis: mapped };
  const undoToken = randomUUID();
  // Written before the analysis, and in the teaching route's own shape and place,
  // so a crash between the two leaves a way back rather than a rewritten grid with
  // no record of what it replaced.
  await mkdir(undoDirectory, { recursive: true });
  await writeFile(path.join(undoDirectory, `${trackId}.json`), JSON.stringify({
    token: undoToken,
    trackId,
    analysis: previous,
    momentIds: [],
    createdAt: new Date().toISOString(),
  }));
  // Cues after the grid, never before: they are snapped to the beats, and the
  // beats are about to move.
  const cued = placeLabelCues(result.analysis, trackId, result.analysis.duration);
  await writeFile(file, JSON.stringify(cued.analysis));
  await rememberCompactDjRecord(track, cued.analysis as Parameters<typeof rememberCompactDjRecord>[1]);
  return {
    applied: true,
    because: `kick map applied — ${map.exactCount} beats are the kicks themselves, ${map.filledCount} filled from the kicks around them · ${map.bpm.toFixed(2)} BPM skeleton`,
    cuesPlaced: cued.placed,
    analysis: cued.analysis,
    undoToken,
    bpm: map.bpm,
  };
}

/**
 * The grid stays where it is, but the cues still go on.
 *
 * Nothing is written unless a cue was actually placed, so a held tune with cues
 * already on it is not rewritten on every deck load.
 */
async function applyCuesOnly(
  trackId: string,
  analysis: TeachableAnalysis,
  file: string,
  track: Awaited<ReturnType<typeof getMusicTrack>>,
  because: string,
): Promise<KickGridApplyOutcome> {
  const cued = placeLabelCues(analysis, trackId, analysis.duration);
  if (!cued.placed.length) {
    // No labels yet means the chorus is not known yet, not that there is none —
    // so this is worth asking again once the labelling pass has run.
    const retry = !sectionSpansForTrack(trackId).length;
    return { applied: false, because, retry };
  }
  const undoToken = randomUUID();
  await mkdir(undoDirectory, { recursive: true });
  await writeFile(path.join(undoDirectory, `${trackId}.json`), JSON.stringify({
    token: undoToken, trackId, analysis, momentIds: [], createdAt: new Date().toISOString(),
  }));
  await writeFile(file, JSON.stringify(cued.analysis));
  if (track) await rememberCompactDjRecord(track, cued.analysis as Parameters<typeof rememberCompactDjRecord>[1]);
  return { applied: false, because, cuesPlaced: cued.placed, analysis: cued.analysis, undoToken };
}

export async function GET(request: Request) {
  const trackId = new URL(request.url).searchParams.get("trackId") ?? "";
  if (!/^[a-z0-9_-]+$/i.test(trackId)) {
    return Response.json({ error: "That is not a usable track id" }, { status: 400 });
  }
  const track = await getMusicTrack(trackId).catch(() => null);
  const duration = track && "duration" in track && typeof track.duration === "number" ? track.duration : 0;
  return Response.json({
    trackId,
    ...proposalFor(trackId, duration),
    status: kickAnalysisStatus(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

/**
 * Ask for a track to be analysed, and carry whether the booth is quiet.
 *
 * Separation is ~30-40 s of GPU. The client is the only thing that knows whether a
 * deck is rolling, and that report expires, so a job cannot start on a stale claim
 * that nothing is playing.
 */
export async function POST(request: Request) {
  let body: { trackId?: unknown; boothIdle?: unknown; durationSeconds?: unknown; apply?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "That request was not JSON" }, { status: 400 });
  }
  if (typeof body.boothIdle === "boolean") reportKickBoothIdle(body.boothIdle);

  let queued = false;
  let trackId = "";
  if (body.trackId !== undefined) {
    if (typeof body.trackId !== "string" || !/^[a-z0-9_-]+$/i.test(body.trackId)) {
      return Response.json({ error: "That is not a usable track id" }, { status: 400 });
    }
    trackId = body.trackId;
    // Asking to apply is not asking to analyse: a track whose grid is held should
    // not be queued for a separation it has already had.
    if (body.apply !== true) queued = enqueueKickAnalysis(trackId);
  }

  const apply = body.apply === true && trackId
    ? await serialiseAnalysisMutation(() => applyKickGrid(trackId)).catch((error: unknown) => ({
      applied: false,
      because: error instanceof Error ? error.message : "that grid could not be applied",
    } satisfies KickGridApplyOutcome))
    : null;

  const duration = typeof body.durationSeconds === "number" ? body.durationSeconds : 0;
  return Response.json({
    queued,
    trackId,
    ...(trackId ? proposalFor(trackId, duration) : {}),
    ...(apply ? { apply } : {}),
    status: kickAnalysisStatus(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

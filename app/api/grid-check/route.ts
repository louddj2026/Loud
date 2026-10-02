import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "../../../lib/data-root";
import { getMusicTrack } from "../../../lib/music-library";
import { readTrackIntelligenceIndex } from "../../../lib/dj-library";
import { parseGridCheckRecord, type GridCheckItem, type GridCheckRecord } from "../../../lib/grid-check";
import { stemGridFor } from "../../../lib/stem-grid-store";
import { kickHitsFor, kickStemExists } from "../../../lib/kick-hits-store";
import { kickGridFor } from "../../../lib/kick-grid-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verdictFile = path.join(durableDataRoot, "grid-check.json");
/**
 * Stem-grid verdicts live apart from stored-grid verdicts.
 *
 * The 27 verdicts already collected are the most trustworthy measurement in the
 * project, and they are about the library's own grids. A verdict on a
 * percussion-fitted grid answers a different question, so writing it to the same
 * key would quietly destroy ground truth.
 */
const stemVerdictFile = path.join(durableDataRoot, "stem-grid-check.json");
/**
 * And detected kicks get their own again.
 *
 * "Do these ticks sit on the kicks" is not the same question as "is this fitted
 * grid clean", which is not the same as "is the library's grid clean". Three
 * questions, three files. Sharing one would silently mark a track as judged for a
 * question it was never asked.
 */
const kickVerdictFile = path.join(durableDataRoot, "kick-check.json");
/** And a grid fitted to those kicks is a fourth question again. */
const kickGridVerdictFile = path.join(durableDataRoot, "kick-grid-check.json");
const analysisDirectory = path.join(process.cwd(), "public", "analysis");
/**
 * The cap used to be 24 — enough to answer one question without turning it into
 * an evening. The question was whether `auditOffsetMs` meant anything, and it has
 * been answered: it flagged 24 tracks as badly anchored and the DJ heard 22 of
 * them as clean, because it finds the bassline rather than the kick.
 *
 * The list now serves a different job. Every verdict is ground truth for grid
 * work, so the queue should be as long as the DJ is willing to sit through rather
 * than capped at one experiment's worth.
 */
const MAX_ITEMS = 240;

async function readVerdicts(file = verdictFile): Promise<Record<string, GridCheckRecord>> {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verdicts: Record<string, GridCheckRecord> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const record = parseGridCheckRecord(value);
      if (record) verdicts[id] = record;
    }
    return verdicts;
  } catch {
    return {};
  }
}

async function readAnalysis(id: string, names: readonly string[]) {
  const bare = id.replace(/^upload-/, "");
  for (const candidate of [`${id}.json`, `${bare}.json`]) {
    if (!names.includes(candidate)) continue;
    const raw = await readFile(path.join(analysisDirectory, candidate), "utf8").catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return (parsed.analysis ?? parsed) as { beats?: Array<{ time: number; auditOffsetMs?: number | null }>; duration?: number };
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET() {
  try {
    const [summaries, storedVerdicts, stemVerdicts, kickVerdicts, kickGridVerdicts, analysisNames] = await Promise.all([
      readTrackIntelligenceIndex(),
      readVerdicts(),
      readVerdicts(stemVerdictFile),
      readVerdicts(kickVerdictFile),
      readVerdicts(kickGridVerdictFile),
      // Read the directory once. It held 876 files against 111 tracks, so doing
      // it per track was 111 scans of the same listing.
      readdir(analysisDirectory).catch(() => [] as string[]),
    ]);
    const items: GridCheckItem[] = [];
    for (const summary of summaries) {
      const analysis = await readAnalysis(summary.id, analysisNames);
      const beats = analysis?.beats;
      if (!beats?.length || beats.length < 200) continue;
      // Playing a track requires the audio to still exist; the library index
      // outlives uploads, exactly as the teaching table does.
      if (!await getMusicTrack(summary.id).catch(() => null)) continue;
      const offsets = beats
        .map((beat) => beat.auditOffsetMs)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .sort((left, right) => left - right);
      // A missing `auditOffsetMs` used to exclude a track outright. It should
      // not: the field is a disproven metric, and a grid still wants an ear on
      // it whether or not that metric had an opinion.
      //
      // Detected kicks win, then a percussion-fitted grid, then the tune's own.
      // Nothing is blended: the ticks are one source alone or the verdict is
      // about nothing in particular.
      // Both halves have to exist. Hits without a stem cannot be auditioned — the
      // ticker plays the stem — and an early run left exactly that behind.
      const hasStem = kickStemExists(summary.id);
      const kicks = hasStem ? kickHitsFor(summary.id) : null;
      // A grid fitted to those kicks takes precedence — it is the open question —
      // but the kicks travel with it so the two can be compared on one audition.
      const kickGrid = kicks ? kickGridFor(summary.id) : null;
      const stem = kicks ? null : stemGridFor(summary.id);
      const source = kickGrid ? "kickgrid" : kicks ? "kicks" : stem ? "stem" : "stored";
      items.push({
        trackId: summary.id,
        name: summary.name,
        bpm: summary.bpm ?? 0,
        duration: analysis?.duration ?? 0,
        suspectedOffsetMs: offsets.length ? Math.abs(offsets[offsets.length >> 1]) : 0,
        beats: kickGrid ? kickGrid.beats : kicks ? kicks.times : stem ? stem.beats : beats.map((beat) => beat.time),
        source,
        ...(kickGrid
          ? { gridBpm: kickGrid.bpm, kickBeats: kicks!.times, explains: kickGrid.explains }
          : kicks?.impliedTempo ? { gridBpm: kicks.impliedTempo }
            : stem ? { gridBpm: stem.packed.bpmX100 / 100 } : {}),
      });
    }
    // A verdict only counts against the grid it was given for, so an item is
    // "heard" when its own source has been judged.
    const verdictsFor = (source: GridCheckItem["source"]) =>
      source === "kickgrid" ? kickGridVerdicts
        : source === "kicks" ? kickVerdicts
          : source === "stem" ? stemVerdicts : storedVerdicts;
    const heard = (item: GridCheckItem) => verdictsFor(item.source)[item.trackId];
    // When detected kicks exist, offer ONLY those. Mixing them with grid-derived
    // ticks would make the pass ambiguous: the DJ would have to remember which
    // kind each track was before trusting his own verdict, and the whole question
    // right now is whether the detector finds kicks.
    // Stem-backed items only, when any exist: those are the tracks under
    // examination, and mixing grid-derived ticks from other tunes in would make a
    // verdict ambiguous about what was judged.
    const detected = items.filter((item) => item.source === "kicks" || item.source === "kickgrid");
    const pool = detected.length ? detected : items;
    pool.sort((left, right) => {
      const bySource = (right.source === "stem" ? 1 : 0) - (left.source === "stem" ? 1 : 0);
      if (bySource) return bySource;
      const byHeard = (heard(left) ? 1 : 0) - (heard(right) ? 1 : 0);
      return byHeard || left.name.localeCompare(right.name);
    });
    const offered = pool.slice(0, MAX_ITEMS);
    // The client keys verdicts by track id, so it is sent the set matching what
    // it is being asked to judge.
    const verdicts: Record<string, GridCheckRecord> = {};
    for (const item of offered) {
      const record = heard(item);
      if (record) verdicts[item.trackId] = record;
    }
    return Response.json({
      items: offered,
      verdicts,
      total: pool.length,
      unheard: offered.filter((item) => !heard(item)).length,
      stemGrids: items.filter((item) => item.source === "stem").length,
      detectedKicks: detected.length,
      // Say when the list has been narrowed, so a short queue is not read as
      // tracks having gone missing.
      restrictedTo: detected.length ? "kicks" : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not build the grid check list" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Expected JSON" }, { status: 400 }); }
  const source = (body ?? {}) as Record<string, unknown>;
  const trackId = typeof source.trackId === "string" ? source.trackId : "";
  if (!trackId) return Response.json({ error: "A trackId is required" }, { status: 400 });
  const record = parseGridCheckRecord({ verdict: source.verdict, decidedAt: new Date().toISOString() });
  if (!record) return Response.json({ error: "verdict must be clean, flam or unsure" }, { status: 400 });
  // Which grid was judged decides which file it lands in. Defaulting to the
  // stored file would let a stem verdict overwrite ear-verified ground truth.
  const judged = source.source === "kickgrid" ? "kickgrid"
    : source.source === "kicks" ? "kicks"
      : source.source === "stem" ? "stem" : "stored";
  const file = judged === "kickgrid" ? kickGridVerdictFile
    : judged === "kicks" ? kickVerdictFile
      : judged === "stem" ? stemVerdictFile : verdictFile;
  try {
    const verdicts = await readVerdicts(file);
    verdicts[trackId] = record;
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(verdicts, null, 2)}\n`, "utf8");
    await rename(temporary, file);
    return Response.json({ ok: true, trackId, verdict: record.verdict, source: judged });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the verdict" }, { status: 500 });
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { durableDataRoot } from "../../../../lib/data-root";
import { assertTransitionTeachingPair, commitTeachingBatch, forgetTeachingMoments, readTeachingMoments, readTeachingProfile, readTeachingProfileExcluding, rememberCompactDjRecord, rememberTeachingMoment } from "../../../../lib/dj-library";
import { getMusicTrack, type MusicTrack } from "../../../../lib/music-library";
import { durableWriteFile, recoverPendingTeachingBatch, syncDirectoryBestEffort, teachingBatchPath } from "../../../../lib/teaching-batch-recovery";
import { applyManualCycleGrid, cueFeatureVector, cueTeachingComparison, withoutStoredCuePlacements, type CueTeachingMoment, type CycleTeachingMoment, type TeachableAnalysis, type TeachingMoment } from "../../../../lib/teaching";

import { withPlacementMetadata } from "../../../../lib/mix-placement-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisDirectory = path.join(process.cwd(), "public", "analysis");
const undoDirectory = path.join(durableDataRoot, "teaching-undo");

type TeachingEditBody = {
  id?: string;
  kind?: "cue" | "loop-grid";
  time?: number;
  crowdSuggestedTime?: number;
  start?: number;
  end?: number;
  beats?: number;
  crowdBpm?: number;
  role?: "mix-in" | "mix-out";
  cueEdge?: "start" | "end";
  exitSide?: "before" | "after";
  purpose?: "cycle" | "intro-loop" | "outro-transition";
  replacePlacements?: boolean;
};

type TeachingPostBody = TeachingEditBody & {
  action?: "transition-pair";
  entries?: TeachingEditBody[];
};

type TeachingUndoRecord = {
  token: string;
  trackId: string;
  /** Legacy records stored the whole multi-megabyte analysis. New records keep
   * only the placement field Apply can change; the current grid is preserved. */
  analysis?: TeachableAnalysis;
  teaching?: TeachableAnalysis["teaching"] | null;
  momentIds: number[];
  createdAt: string;
};

type TeachingBatchManifest = {
  batchId: string;
  createdAt: string;
  entries: Array<{ id: string; undoToken: string; teaching: TeachableAnalysis["teaching"] | null }>;
};

type PreparedTeachingEdit = {
  id: string;
  track: MusicTrack;
  file: string;
  analysis: TeachableAnalysis;
  corrected: TeachableAnalysis;
  moments: TeachingMoment[];
  undoToken: string;
};

type TeachingMutationGlobals = typeof globalThis & { __crowd2TeachingMutationTail?: Promise<void> };
const teachingMutationGlobals = globalThis as TeachingMutationGlobals;

function safeId(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe teaching track ID");
  return id;
}

async function loadAnalysis(id: string) {
  const file = path.join(analysisDirectory, `${safeId(id)}.json`);
  const analysis = JSON.parse(await readFile(file, "utf8")) as TeachableAnalysis;
  return { file, analysis };
}

function undoFile(id: string) {
  return path.join(undoDirectory, `${safeId(id)}.json`);
}

function currentBpm(analysis: TeachableAnalysis, time: number) {
  return analysis.tempoSections.find((section) => time >= section.start && time < section.end)?.bpm
    ?? analysis.selected?.bpm
    ?? analysis.tempoSections[0]?.bpm
    ?? 0;
}

class TeachingRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function serializeTeachingMutation<T>(work: () => Promise<T>) {
  const previous = teachingMutationGlobals.__crowd2TeachingMutationTail ?? Promise.resolve();
  const execution = previous.catch(() => undefined).then(work);
  teachingMutationGlobals.__crowd2TeachingMutationTail = execution.then(() => undefined, () => undefined);
  return execution;
}

async function prepareTeachingEdit(body: TeachingEditBody, selectedAt = new Date().toISOString()): Promise<PreparedTeachingEdit> {
  if (!body.id || !body.kind) throw new TeachingRequestError("A track and teaching type are required");
  const id = safeId(body.id);
  const track = await getMusicTrack(id);
  if (!track) throw new TeachingRequestError("That track is not in the music library", 404);
  const { file, analysis } = await loadAnalysis(id);
  const workingAnalysis = body.replacePlacements ? withoutStoredCuePlacements(analysis) : analysis;
  let corrected: TeachableAnalysis;
  let moments: TeachingMoment[];
  if (body.kind === "cue") {
    if (!Number.isFinite(body.time) || !Number.isFinite(body.crowdSuggestedTime)) throw new TeachingRequestError("Choose a cue point before saving it");
    const preferredCue = cueTeachingComparison(workingAnalysis, body.time!, body.crowdSuggestedTime!, selectedAt);
    const crowdFeatures = cueFeatureVector(workingAnalysis, preferredCue.crowdSuggestedTime);
    const gridFeatures = cueFeatureVector(workingAnalysis, preferredCue.nearestCrowdBeatTime);
    const userFeatures = cueFeatureVector(workingAnalysis, preferredCue.time, { includeCycleRepeats: body.role === "mix-in" });
    const moment = {
      kind: "cue",
      role: body.role ?? "mix-out",
      trackId: id,
      ...preferredCue,
      userFeatures,
      crowdFeatures,
      gridFeatures,
    } satisfies CueTeachingMoment;
    corrected = body.role === "mix-in"
      ? { ...workingAnalysis, teaching: { ...workingAnalysis.teaching, preferredEntryCue: preferredCue } }
      : { ...workingAnalysis, teaching: { ...workingAnalysis.teaching, preferredCue } };
    moments = [moment];
  } else {
    if (!Number.isFinite(body.start) || !Number.isFinite(body.end) || !Number.isInteger(body.beats)) throw new TeachingRequestError("Set the loop start, end and whole beat count before saving it");
    const crowdBpm = Number.isFinite(body.crowdBpm) ? body.crowdBpm! : currentBpm(workingAnalysis, body.start!);
    const result = applyManualCycleGrid(workingAnalysis, body.start!, body.end!, body.beats!, crowdBpm, selectedAt, body.cueEdge, body.exitSide, body.purpose);
    corrected = result.analysis;
    moments = [{ kind: "loop-grid", trackId: id, ...result.teaching } satisfies CycleTeachingMoment];
    if (body.purpose === "intro-loop" || body.purpose === "outro-transition") {
      const role = body.purpose === "intro-loop" ? "mix-in" : "mix-out";
      const crowdSuggestedTime = Number.isFinite(body.crowdSuggestedTime) ? body.crowdSuggestedTime! : body.end!;
      const preferredCue = cueTeachingComparison(workingAnalysis, body.end!, crowdSuggestedTime, selectedAt);
      corrected = body.purpose === "intro-loop"
        ? { ...corrected, teaching: { ...corrected.teaching, preferredEntryCue: preferredCue } }
        : { ...corrected, teaching: { ...corrected.teaching, preferredCue } };
      moments.push({
        kind: "cue",
        role,
        trackId: id,
          ...preferredCue,
        userFeatures: cueFeatureVector(workingAnalysis, preferredCue.time),
        crowdFeatures: cueFeatureVector(workingAnalysis, preferredCue.crowdSuggestedTime),
        gridFeatures: cueFeatureVector(workingAnalysis, preferredCue.nearestCrowdBeatTime),
      } satisfies CueTeachingMoment);
    }
  }
  // Mix points describe a transition; they do not declare beat 1 or rewrite analysis.
  corrected = withPlacementMetadata(analysis, corrected);
  return { id, track, file, analysis, corrected, moments, undoToken: randomUUID() };
}

function validateTransitionPairEntries(entries: TeachingEditBody[] | undefined): [TeachingEditBody, TeachingEditBody] {
  try { assertTransitionTeachingPair(entries); }
  catch (error) { throw new TeachingRequestError(error instanceof Error ? error.message : "The transition pair is invalid"); }
  const [outgoing, incoming] = entries!;
  return [{ ...outgoing, kind: "loop-grid" }, { ...incoming, kind: "loop-grid" }];
}

async function stageTeachingBatch(batchId: string, edits: readonly PreparedTeachingEdit[], createdAt: string) {
  const directory = teachingBatchPath(batchId);
  await mkdir(directory, { recursive: true });
  const manifest: TeachingBatchManifest = {
    batchId,
    createdAt,
    entries: edits.map((edit) => ({ id: edit.id, undoToken: edit.undoToken, teaching: edit.analysis.teaching ?? null })),
  };
  try {
    for (const edit of edits) {
      await durableWriteFile(path.join(directory, `corrected-${edit.id}.json`), JSON.stringify(edit.corrected));
    }
    await durableWriteFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await syncDirectoryBestEffort(directory);
    await syncDirectoryBestEffort(path.dirname(directory));
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return directory;
}

async function saveTransitionPair(entries: TeachingEditBody[]) {
  const validated = validateTransitionPairEntries(entries);
  const createdAt = new Date().toISOString();
  const edits = await Promise.all(validated.map((entry) => prepareTeachingEdit(entry, createdAt)));
  const batchId = randomUUID();
  const directory = await stageTeachingBatch(batchId, edits, createdAt);
  let committed = false;
  try {
    const stored = await commitTeachingBatch(batchId, edits.map((edit) => ({
      track: edit.track,
      analysis: edit.corrected as Parameters<typeof rememberCompactDjRecord>[1],
      moments: edit.moments,
    })));
    committed = true;
    await recoverPendingTeachingBatch();
    const profile = await readTeachingProfile();
    return Response.json({
      results: edits.map((edit) => {
        const moments = stored.storedByTrack[edit.id] ?? [];
        return { id: edit.id, analysis: edit.corrected, teaching: edit.corrected.teaching, moment: moments.at(-1), moments, undoToken: edit.undoToken };
      }),
      profile,
    });
  } catch (error) {
    if (!committed) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function GET(request: Request) {
  return serializeTeachingMutation(async () => {
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id");
    const exclude = searchParams.get("exclude");
    try {
      await recoverPendingTeachingBatch();
      if (exclude) return Response.json({ profile: await readTeachingProfileExcluding(safeId(exclude)) });
      if (!id) return Response.json({ error: "A track is required" }, { status: 400 });
      const { analysis } = await loadAnalysis(id);
      const [moments, profile] = await Promise.all([readTeachingMoments(id, 64), readTeachingProfile()]);
      return Response.json({ teaching: analysis.teaching ?? {}, moments, profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : exclude ? "Prediction memory could not be read" : "Teaching memory could not be read";
      return Response.json({ error: message }, { status: exclude ? 400 : 503 });
    }
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as TeachingPostBody;
  return serializeTeachingMutation(async () => {
    try {
      await recoverPendingTeachingBatch();
      if (body.action === "transition-pair") return await saveTransitionPair(body.entries ?? []);
      const prepared = await prepareTeachingEdit(body);
      const undoRecord: TeachingUndoRecord = { token: prepared.undoToken, trackId: prepared.id, teaching: prepared.analysis.teaching ?? null, momentIds: [], createdAt: new Date().toISOString() };
      await mkdir(undoDirectory, { recursive: true });
      await writeFile(undoFile(prepared.id), JSON.stringify(undoRecord));
      await writeFile(prepared.file, JSON.stringify(prepared.corrected));
      await rememberCompactDjRecord(prepared.track, prepared.corrected as Parameters<typeof rememberCompactDjRecord>[1]);
      const stored = await Promise.all(prepared.moments.map((moment) => rememberTeachingMoment(moment)));
      await writeFile(undoFile(prepared.id), JSON.stringify({ ...undoRecord, momentIds: stored.map((moment) => moment.momentId) }));
      const profile = await readTeachingProfile();
      return Response.json({ analysis: prepared.corrected, teaching: prepared.corrected.teaching, moment: stored.at(-1), moments: stored, profile, undoToken: prepared.undoToken });
    } catch (error) {
      const status = error instanceof TeachingRequestError ? error.status : body.action === "transition-pair" ? 503 : 400;
      return Response.json({ error: error instanceof Error ? error.message : "Crowd could not save that teaching moment" }, { status });
    }
  });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({})) as { id?: string; undoToken?: string; resetPlacements?: boolean };
  if (!body.id || (!body.undoToken && !body.resetPlacements)) {
    return Response.json({ error: "A track and either an undo token or cue reset are required" }, { status: 400 });
  }
  return serializeTeachingMutation(async () => {
    try {
      await recoverPendingTeachingBatch();
      const id = safeId(body.id!);
      const track = await getMusicTrack(id);
      if (!track) return Response.json({ error: "That track is not in the music library" }, { status: 404 });
      if (body.resetPlacements) {
        const { file, analysis } = await loadAnalysis(id);
        const reset = withoutStoredCuePlacements(analysis);
        await writeFile(file, JSON.stringify(reset));
        await rememberCompactDjRecord(track, reset as Parameters<typeof rememberCompactDjRecord>[1]);
        await rm(undoFile(id), { force: true });
        const profile = await readTeachingProfile();
        return Response.json({ analysis: reset, teaching: reset.teaching, profile, reset: true });
      }
      const file = undoFile(id);
      const record = JSON.parse(await readFile(file, "utf8")) as TeachingUndoRecord;
      if (record.trackId !== id || record.token !== body.undoToken) {
        return Response.json({ error: "That cue is no longer the latest saved edit" }, { status: 409 });
      }
      const { file: analysisFile, analysis: currentAnalysis } = await loadAnalysis(id);
      const restored = withPlacementMetadata(currentAnalysis, {
        teaching: record.analysis?.teaching ?? record.teaching ?? undefined,
      });
      await writeFile(analysisFile, JSON.stringify(restored));
      await rememberCompactDjRecord(track, restored as Parameters<typeof rememberCompactDjRecord>[1]);
      await forgetTeachingMoments(id, record.momentIds);
      await rm(file, { force: true });
      const profile = await readTeachingProfile();
      return Response.json({ analysis: restored, teaching: restored.teaching, profile });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Crowd could not undo that cue" }, { status: 400 });
    }
  });
}

/**
 * Loading progress: ONE structured contract from the separator process to
 * the deck, shared by every way a tune reaches a deck (picker, autoselect,
 * restore on open, assisted autoload, remap, upload).
 *
 * DJ, 26 Sep 2026: "it needs a progress indicator that fills up as it loads,
 * I cant tell if its frozen" — "it has to show the real steps of progress -
 * not fake" — "that demucs step is too much of a black box". The rules here:
 *
 *  - Every state change is a REAL event: a stage or step starting or
 *    finishing, a Demucs block's "end" callback, a worker's startup line.
 *    Nothing moves because time passed. There is no estimate anywhere.
 *  - The only filling bar is a measured one: Demucs blocks whose "end"
 *    callback fired, over the block count read from the loop that runs them.
 *    A block that has merely STARTED is shown as "running", never counted.
 *  - Progress only moves forward within one attempt. A restart (warm worker
 *    failed, cold separator takes over) is a new, labelled attempt that
 *    starts its own count; a new mapping job is a new jobId.
 *  - Nothing claims complete before the pipeline says complete; an error
 *    keeps the stage, step and count it stopped at.
 *
 * Pure: every function takes `now`, so the reducers are testable without
 * a server, a worker or a browser.
 */

export type ProgressState = "pending" | "active" | "done" | "skipped" | "failed";

/**
 * Demucs block accounting. htdemucs is a bag of 1 model, shifts=1, split
 * into overlapping blocks (overlap .25); every model x shift pass runs its
 * own block loop, whose length depends on that pass's random shift, so a
 * pass's count is only ever read from the running loop.
 */
export type BlockMeasure = {
  unit: "blocks";
  /** Blocks whose "end" callback fired, all passes together. */
  done: number;
  /** Blocks finished in the pass that is running. */
  doneInPass: number;
  /** The running pass's block count, read from Demucs' own loop; null when not known exactly. */
  passBlocks: number | null;
  /** 1-based block index that has started and not finished yet; null between blocks. */
  current: number | null;
  /** 1-based pass (model x shift) and pass count. */
  pass: number;
  passes: number;
  /** Source span, in seconds of the decoded audio, of the running (else last finished) block — only when read exactly. */
  range: [number, number] | null;
};

export type LoadStep = {
  id: string;
  label: string;
  state: ProgressState;
  startedAt: number | null;
  endedAt: number | null;
  detail: string | null;
  measure: BlockMeasure | null;
};

export type LoadStageId = "queue" | "stem" | "beats" | "grid" | "save";

export type LoadStage = {
  id: LoadStageId;
  label: string;
  state: ProgressState;
  startedAt: number | null;
  endedAt: number | null;
  /** Last real event inside this stage. */
  updatedAt: number | null;
  detail: string | null;
  /** Completed from a stored result (e.g. the drum stem was already on disk). */
  cached: boolean;
  /** 1 for the first try; a restart inside the stage (cold separator after a warm failure) increments it. */
  attempt: number;
  restartedBecause: string | null;
  /** Decoded audio length, seconds, when the stage decoded the whole tune. */
  audioSeconds: number | null;
  steps: LoadStep[];
};

export type LoadProgress = {
  /** Unique per mapping attempt: a retry or a new request is a new job id. */
  jobId: string;
  trackId: string;
  trackName: string;
  /** Per-track attempt number on this server. */
  attempt: number;
  state: "running" | "complete" | "error";
  startedAt: number;
  /** Last real event anywhere in the job. */
  updatedAt: number;
  endedAt: number | null;
  error: string | null;
  stages: LoadStage[];
};

export type QueuedAhead = { trackId: string; trackName: string; summary: string };

/** What the server sends: the job plus its own clock, so ages survive clock skew. */
export type LoadProgressSnapshot = LoadProgress & {
  serverNow: number;
  /** Jobs ahead of this one in the one-at-a-time analysis lane, first = the one running. */
  queueAhead?: QueuedAhead[];
};

const STAGE_CATALOG: Record<LoadStageId, { label: string; steps: Array<[string, string]> }> = {
  queue: { label: "Analysis lane", steps: [] },
  stem: {
    label: "Drum stem · Demucs",
    // Real order: the worker must be up (startup) before a job can queue
    // behind another tune on it (wait); each is skipped when not needed.
    steps: [
      ["input", "Audio input"],
      ["startup", "Load model"],
      ["wait", "Wait for separator"],
      ["decode", "Decode audio"],
      ["blocks", "Separate blocks"],
      ["write", "Write stem"],
      ["publish", "Publish stem"],
    ],
  },
  beats: { label: "Beat detection", steps: [["model", "Load beat model"], ["scan", "Scan beats"]] },
  grid: { label: "Grid analysis", steps: [["start", "Start analyser"], ["decode", "Decode stem"], ["fit", "Fit grid"], ["display", "Display wave"]] },
  save: { label: "Save analysis", steps: [["write", "Write analysis"], ["verify", "Verify record"]] },
};

export const LOAD_STAGE_ORDER: LoadStageId[] = ["queue", "stem", "beats", "grid", "save"];
const FINAL: ProgressState[] = ["done", "skipped", "failed"];
const isFinal = (state: ProgressState) => FINAL.includes(state);

export function createStage(id: LoadStageId): LoadStage {
  const catalog = STAGE_CATALOG[id];
  return {
    id,
    label: catalog.label,
    state: "pending",
    startedAt: null,
    endedAt: null,
    updatedAt: null,
    detail: null,
    cached: false,
    attempt: 1,
    restartedBecause: null,
    audioSeconds: null,
    steps: catalog.steps.map(([stepId, label]) => ({ id: stepId, label, state: "pending", startedAt: null, endedAt: null, detail: null, measure: null })),
  };
}

export function createLoadProgress(input: { trackId: string; trackName: string; attempt: number; now: number }): LoadProgress {
  const progress: LoadProgress = {
    jobId: `${input.trackId}#${input.attempt}@${input.now}`,
    trackId: input.trackId,
    trackName: input.trackName,
    attempt: input.attempt,
    state: "running",
    startedAt: input.now,
    updatedAt: input.now,
    endedAt: null,
    error: null,
    stages: LOAD_STAGE_ORDER.map(createStage),
  };
  // The job exists, so it is in the lane: that is the first real state.
  beginStage(progress, "queue", input.now, "Waiting for the one-at-a-time analysis lane");
  return progress;
}

export function stageOf(progress: LoadProgress, id: LoadStageId) {
  return progress.stages.find((stage) => stage.id === id)!;
}

function touchStage(stage: LoadStage, now: number) {
  stage.updatedAt = Math.max(stage.updatedAt ?? now, now);
}

function activateStage(stage: LoadStage, now: number) {
  if (stage.state !== "pending") return;
  stage.state = "active";
  stage.startedAt = now;
  touchStage(stage, now);
}

// ---------------------------------------------------------------- steps

/**
 * A step begins: every earlier step in the stage is settled first — one that
 * was running has finished (the code moved on after it), one that never ran
 * was skipped. A step that already finished is never reopened.
 */
export function beginStep(stage: LoadStage, stepId: string, now: number, detail?: string | null) {
  if (isFinal(stage.state)) return false;
  const index = stage.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return false;
  const step = stage.steps[index];
  if (isFinal(step.state)) return false;
  // A later step already running means this event is stale.
  if (stage.steps.slice(index + 1).some((later) => later.state !== "pending")) return false;
  activateStage(stage, now);
  for (const earlier of stage.steps.slice(0, index)) settleStep(earlier, now);
  if (step.state === "pending") {
    step.state = "active";
    step.startedAt = now;
  }
  if (detail !== undefined) step.detail = detail;
  stage.detail = step.detail;
  touchStage(stage, now);
  return true;
}

function settleStep(step: LoadStep, now: number) {
  if (step.state === "active") { step.state = "done"; step.endedAt = now; }
  else if (step.state === "pending") { step.state = "skipped"; step.endedAt = now; }
}

export function updateStep(stage: LoadStage, stepId: string, now: number, patch: { detail?: string | null; measure?: BlockMeasure | null }) {
  const step = stage.steps.find((item) => item.id === stepId);
  if (!step || step.state !== "active" || isFinal(stage.state)) return false;
  if (patch.detail !== undefined) { step.detail = patch.detail; stage.detail = patch.detail; }
  if (patch.measure !== undefined && patch.measure !== null) step.measure = mergeBlockMeasure(step.measure, patch.measure);
  touchStage(stage, now);
  return true;
}

export function finishStep(stage: LoadStage, stepId: string, now: number, detail?: string | null) {
  const step = stage.steps.find((item) => item.id === stepId);
  if (!step || isFinal(step.state) || isFinal(stage.state)) return false;
  if (step.state === "pending" && !beginStep(stage, stepId, now)) return false;
  step.state = "done";
  step.endedAt = now;
  if (detail !== undefined) { step.detail = detail; stage.detail = detail; }
  touchStage(stage, now);
  return true;
}

/**
 * A separator that succeeded without reporting some sub-steps (a worker
 * process older than this protocol, or a lost line): those steps did run —
 * the stem exists — so they are done and say they were not reported. They
 * are never shown as skipped, and never given a count.
 */
export function settleUnreportedSteps(stage: LoadStage, stepIds: string[], now: number) {
  for (const id of stepIds) {
    if (stage.steps.find((step) => step.id === id)?.state === "pending") finishStep(stage, id, now, "Finished · not reported by this separator process");
  }
}

/** A step the code path did not need (model already resident, nobody ahead). Only a step that never ran. */
export function skipStep(stage: LoadStage, stepId: string, now: number, detail: string) {
  const step = stage.steps.find((item) => item.id === stepId);
  if (!step || step.state !== "pending" || isFinal(stage.state)) return false;
  activateStage(stage, now);
  step.state = "skipped";
  step.endedAt = now;
  step.detail = detail;
  touchStage(stage, now);
  return true;
}

/**
 * Monotonic block count: a finished block never un-finishes, a pass never
 * goes back, and an exact block count, once read, is never replaced by an
 * unknown one. A new pass starts its own in-pass count.
 */
export function mergeBlockMeasure(previous: BlockMeasure | null, next: BlockMeasure): BlockMeasure {
  if (!previous) return { ...next };
  if (next.pass < previous.pass) return previous;
  if (next.pass > previous.pass) return { ...next, done: Math.max(previous.done, next.done) };
  return {
    unit: "blocks",
    done: Math.max(previous.done, next.done),
    doneInPass: Math.max(previous.doneInPass, next.doneInPass),
    passBlocks: next.passBlocks ?? previous.passBlocks,
    current: next.current,
    pass: next.pass,
    passes: Math.max(previous.passes, next.passes),
    range: next.range ?? previous.range,
  };
}

// --------------------------------------------------------------- stages

/** The pipeline moved on to `id`: earlier stages that ran are done, ones that never ran were skipped. */
export function beginStage(progress: LoadProgress, id: LoadStageId, now: number, detail?: string | null) {
  if (progress.state !== "running") return false;
  const index = progress.stages.findIndex((stage) => stage.id === id);
  const stage = progress.stages[index];
  if (!stage || isFinal(stage.state)) return false;
  if (progress.stages.slice(index + 1).some((later) => later.state !== "pending")) return false;
  for (const earlier of progress.stages.slice(0, index)) settleStage(earlier, now);
  activateStage(stage, now);
  if (detail !== undefined) stage.detail = detail;
  touchStage(stage, now);
  progress.updatedAt = Math.max(progress.updatedAt, now);
  return true;
}

function settleStage(stage: LoadStage, now: number) {
  if (stage.state === "active") completeStage(stage, now);
  else if (stage.state === "pending") {
    stage.state = "skipped";
    stage.endedAt = now;
    for (const step of stage.steps) if (step.state === "pending") { step.state = "skipped"; step.endedAt = now; }
  }
}

/** A stage finished: its running step is done, steps it never needed were skipped. */
export function completeStage(stage: LoadStage, now: number, detail?: string | null) {
  if (isFinal(stage.state)) return false;
  activateStage(stage, now);
  for (const step of stage.steps) settleStep(step, now);
  stage.state = "done";
  stage.endedAt = now;
  if (detail !== undefined) stage.detail = detail;
  touchStage(stage, now);
  return true;
}

/** A stage satisfied by a stored result: nothing in it ran. */
export function skipStage(stage: LoadStage, now: number, detail: string, cached = false) {
  if (isFinal(stage.state)) return false;
  stage.state = "skipped";
  stage.cached = cached;
  stage.startedAt ??= now;
  stage.endedAt = now;
  stage.detail = detail;
  for (const step of stage.steps) if (!isFinal(step.state)) { step.state = "skipped"; step.endedAt = now; }
  touchStage(stage, now);
  return true;
}

/** The stage stopped: the step that was running carries the failure (a step that never started is left pending). */
export function failStage(stage: LoadStage, now: number, error: string) {
  if (isFinal(stage.state)) return false;
  const step = stage.steps.find((item) => item.state === "active");
  if (step) { step.state = "failed"; step.endedAt = now; step.detail = error; }
  stage.state = "failed";
  stage.startedAt ??= now;
  stage.endedAt = now;
  stage.detail = error;
  touchStage(stage, now);
  return true;
}

/**
 * The stage starts over inside the same job — the warm separator failed and
 * a one-shot separator runs the whole tune again. Said as a new attempt with
 * its reason; the steps before `fromStep` (e.g. the audio input) stay done.
 */
export function restartStage(stage: LoadStage, now: number, reason: string, fromStep: string) {
  if (isFinal(stage.state)) return false;
  const index = stage.steps.findIndex((step) => step.id === fromStep);
  if (index < 0) return false;
  stage.attempt += 1;
  stage.restartedBecause = reason;
  for (const step of stage.steps.slice(index)) {
    step.state = "pending"; step.startedAt = null; step.endedAt = null; step.detail = null; step.measure = null;
  }
  stage.detail = `Attempt ${stage.attempt}: restarting after ${reason}`;
  touchStage(stage, now);
  return true;
}

export function completeLoadProgress(progress: LoadProgress, now: number) {
  if (progress.state !== "running") return false;
  for (const stage of progress.stages) settleStage(stage, now);
  progress.state = "complete";
  progress.endedAt = now;
  progress.updatedAt = Math.max(progress.updatedAt, now);
  return true;
}

/**
 * The job stopped. The stage that was running is marked failed (one that
 * already failed — an adopted stem stage — stays as it is); stages that
 * never started stay pending. Nothing is completed on the way out.
 */
export function failLoadProgress(progress: LoadProgress, now: number, error: string) {
  if (progress.state !== "running") return false;
  const stage = progress.stages.find((item) => item.state === "active");
  if (stage) failStage(stage, now, error);
  progress.state = "error";
  progress.error = error;
  progress.endedAt = now;
  progress.updatedAt = Math.max(progress.updatedAt, now);
  return true;
}

/** Recompute the job's last-event time after a linked stage (the shared stem stage) moved. */
export function noteStageEvent(progress: LoadProgress, stage: LoadStage) {
  if (stage.updatedAt !== null) progress.updatedAt = Math.max(progress.updatedAt, stage.updatedAt);
}

export function cloneStage(stage: LoadStage): LoadStage {
  return JSON.parse(JSON.stringify(stage)) as LoadStage;
}

/**
 * The job's own stage list with the live drum-stem stage linked in while the
 * job waits on it, and the queue stage naming the tunes ahead in the lane.
 * Never mutates the job.
 */
export function composeSnapshot(progress: LoadProgress, options: { serverNow: number; linkedStem?: LoadStage | null; queueAhead?: QueuedAhead[] }): LoadProgressSnapshot {
  const stages = progress.stages.map((stage) => {
    if (stage.id === "stem" && options.linkedStem) return cloneStage(options.linkedStem);
    if (stage.id === "queue" && stage.state === "active") return { ...stage, steps: [], detail: queueDetail(options.queueAhead) };
    return cloneStage(stage);
  });
  // The last REAL event anywhere in the job, the linked stem stage included.
  const updatedAt = stages.reduce((latest, stage) => Math.max(latest, stage.updatedAt ?? latest), progress.updatedAt);
  return { ...progress, stages, updatedAt, serverNow: options.serverNow, queueAhead: options.queueAhead?.length ? options.queueAhead : undefined };
}

// ---------------------------------------------------- analyser protocol

/**
 * scripts/analyse-library.mjs, run by the mapping route with
 * CROWD_ANALYSIS_PROGRESS=1, prints one line per real step:
 *   CROWD_PROGRESS {"stage":"decode"}                       decoding the stem
 *   CROWD_PROGRESS {"stage":"fit","mode":"model-guided"}    fitting the grid
 *   CROWD_PROGRESS {"stage":"teaching","windows":2,"cues":1} taught data re-applied
 *   CROWD_PROGRESS {"stage":"display"}                      full-mix display wave
 *   CROWD_PROGRESS {"stage":"save"} / {"stage":"saved"}     analysis + DJ record
 */
export type AnalyserEvent =
  | { stage: "decode" }
  | { stage: "fit"; mode: "model-guided" | "signal-only" }
  | { stage: "teaching"; windows: number; cues: number }
  | { stage: "display" }
  | { stage: "save" }
  | { stage: "saved" };

export const ANALYSER_PROGRESS_PREFIX = "CROWD_PROGRESS ";

export function parseAnalyserLine(line: string): AnalyserEvent | null {
  const index = line.indexOf(ANALYSER_PROGRESS_PREFIX);
  if (index < 0) return null;
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line.slice(index + ANALYSER_PROGRESS_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch { return null; }
  switch (payload.stage) {
    case "decode": case "display": case "save": case "saved": return { stage: payload.stage };
    case "fit": return payload.mode === "model-guided" || payload.mode === "signal-only" ? { stage: "fit", mode: payload.mode } : null;
    case "teaching": {
      const windows = countInteger(payload.windows);
      const cues = countInteger(payload.cues);
      return windows === null || cues === null ? null : { stage: "teaching", windows, cues };
    }
    default: return null;
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function applyAnalyserEvent(progress: LoadProgress, event: AnalyserEvent, now: number) {
  const grid = stageOf(progress, "grid");
  const save = stageOf(progress, "save");
  let changed: boolean;
  switch (event.stage) {
    case "decode": changed = beginStep(grid, "decode", now, "Decoding the drum stem into timing evidence"); break;
    case "fit": changed = beginStep(grid, "fit", now, event.mode === "model-guided" ? "Fitting tempo and phase to the model's beats" : "No model beats · fitting tempo and phase from the stem alone"); break;
    case "teaching": changed = updateStep(grid, "fit", now, { detail: `Grid fitted · re-applied ${plural(event.windows, "taught window")} and ${plural(event.cues, "preferred cue")}` }); break;
    case "display": changed = beginStep(grid, "display", now, "Painting the full-mix display waveform"); break;
    case "save":
      changed = beginStage(progress, "save", now) && beginStep(save, "write", now, "Writing the analysis and compact DJ record");
      break;
    case "saved": changed = finishStep(save, "write", now, "Analysis and DJ record written"); break;
  }
  if (changed) progress.updatedAt = Math.max(progress.updatedAt, now);
  return changed;
}

// ------------------------------------------------- separator protocol

/**
 * The separator's stdout protocol (scripts/drums_separation.py emits it for
 * the resident worker and the one-shot script alike):
 *   PROGRESS {"event":"startup","step":"import"|"model"}
 *   PROGRESS {"event":"decode","state":"start"}
 *   PROGRESS {"event":"decode","state":"end","audioSeconds":512.45}
 *   PROGRESS {"event":"block","state":"start"|"end","block":38,"passBlocks":62,"done":37,
 *             "doneInPass":37,"pass":1,"passes":1,"range":[277.2,285.0]}
 *   PROGRESS {"event":"write","state":"start"|"end"}
 * The pre-26-Sep numeric form ("PROGRESS 0.500") counted STARTED blocks and
 * is deliberately ignored.
 */
export type SeparatorEvent =
  | { event: "startup"; step: "import" | "model" }
  | { event: "decode"; state: "start" }
  | { event: "decode"; state: "end"; audioSeconds: number | null }
  | { event: "block"; state: "start" | "end"; block: number; passBlocks: number | null; done: number; doneInPass: number; pass: number; passes: number; range: [number, number] | null }
  | { event: "write"; state: "start" | "end" };

const finiteNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positiveInteger = (value: unknown) => {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 1 ? number : null;
};
const countInteger = (value: unknown) => {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
};

export function parseSeparatorLine(line: string): SeparatorEvent | null {
  if (!line.startsWith("PROGRESS ")) return null;
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line.slice(9)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch { return null; }
  if (payload.event === "startup" && (payload.step === "import" || payload.step === "model")) return { event: "startup", step: payload.step };
  if (payload.event === "decode" && payload.state === "start") return { event: "decode", state: "start" };
  if (payload.event === "decode" && payload.state === "end") {
    const seconds = finiteNumber(payload.audioSeconds);
    return { event: "decode", state: "end", audioSeconds: seconds !== null && seconds > 0 ? seconds : null };
  }
  if (payload.event === "write" && (payload.state === "start" || payload.state === "end")) return { event: "write", state: payload.state };
  if (payload.event === "block" && (payload.state === "start" || payload.state === "end")) {
    const block = positiveInteger(payload.block);
    const pass = positiveInteger(payload.pass);
    const passes = positiveInteger(payload.passes);
    const done = countInteger(payload.done);
    const doneInPass = countInteger(payload.doneInPass);
    const passBlocks = payload.passBlocks === null ? null : positiveInteger(payload.passBlocks);
    if (block === null || pass === null || passes === null || done === null || doneInPass === null) return null;
    if (pass > passes || (passBlocks !== null && (block > passBlocks || doneInPass > passBlocks))) return null;
    const rawRange = Array.isArray(payload.range) ? payload.range : null;
    const start = rawRange ? finiteNumber(rawRange[0]) : null;
    const end = rawRange ? finiteNumber(rawRange[1]) : null;
    const range: [number, number] | null = start !== null && end !== null && start >= 0 && end > start ? [start, end] : null;
    return { event: "block", state: payload.state, block, passBlocks, done, doneInPass, pass, passes, range };
  }
  return null;
}

export type SeparatorStartupStep = "spawn" | "import" | "model";

/** What a separator process is doing while it starts, in the words the deck shows. */
export function separatorStartupDetail(step: SeparatorStartupStep) {
  if (step === "spawn") return "Starting the separator process (Python)";
  if (step === "import") return "Separator process running · importing PyTorch and Demucs";
  return "PyTorch loaded · loading the HTDemucs checkpoint";
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** One separator event applied to the stem stage. Returns false when it changed nothing (stale or out of order). */
export function applySeparatorEvent(stage: LoadStage, event: SeparatorEvent, now: number) {
  switch (event.event) {
    case "startup":
      if (stage.steps.find((step) => step.id === "startup")?.state === "active") {
        return updateStep(stage, "startup", now, { detail: separatorStartupDetail(event.step) });
      }
      return false;
    case "decode":
      if (event.state === "start") return beginStep(stage, "decode", now, "Decoding the audio for Demucs");
      if (event.audioSeconds !== null) stage.audioSeconds = event.audioSeconds;
      return finishStep(stage, "decode", now, event.audioSeconds !== null ? `Decoded ${formatClock(event.audioSeconds)} of audio` : "Audio decoded");
    case "block": {
      const blocks = stage.steps.find((step) => step.id === "blocks");
      if (!blocks) return false;
      if (blocks.state === "pending" && !beginStep(stage, "blocks", now)) return false;
      const measure: BlockMeasure = {
        unit: "blocks",
        done: event.done,
        doneInPass: event.doneInPass,
        passBlocks: event.passBlocks,
        current: event.state === "start" ? event.block : null,
        pass: event.pass,
        passes: event.passes,
        range: event.range,
      };
      return updateStep(stage, "blocks", now, { measure, detail: blockDetail(mergeBlockMeasure(blocks.measure, measure), stage.audioSeconds) });
    }
    case "write":
      if (event.state === "start") return beginStep(stage, "write", now, "Writing the drum stem WAV");
      return finishStep(stage, "write", now, "Drum stem WAV written");
  }
}

export function blockDetail(measure: BlockMeasure, audioSeconds: number | null) {
  const total = measure.passBlocks;
  const passLabel = measure.passes > 1 ? `pass ${measure.pass} of ${measure.passes} · ` : "";
  const finished = total === null ? `${measure.doneInPass} blocks finished` : `${measure.doneInPass} of ${total} blocks finished`;
  const running = measure.current === null ? "" : ` · running block ${measure.current}${total === null ? "" : ` of ${total}`}`;
  const range = measure.range ? ` (${formatClock(measure.range[0])}–${formatClock(measure.range[1])}${audioSeconds ? ` of ${formatClock(audioSeconds)}` : ""})` : "";
  return `${passLabel}${finished}${running}${range}`;
}

/**
 * Measured fraction of a block step, ONLY from finished blocks over an exact
 * count. Passes are the same audio, so finished passes count whole; null
 * when the running pass's block count is not known exactly.
 */
export function blockFraction(measure: BlockMeasure | null) {
  if (!measure || !measure.passBlocks) return null;
  const fraction = ((measure.pass - 1) + Math.min(measure.doneInPass, measure.passBlocks) / measure.passBlocks) / Math.max(1, measure.passes);
  return Math.max(0, Math.min(1, fraction));
}

// ------------------------------------------------------------- viewing

export type LoadProgressView = {
  jobId: string;
  attempt: number;
  state: LoadProgress["state"];
  stagesDone: number;
  stagesTotal: number;
  stage: LoadStage | null;
  step: LoadStep | null;
  /** Measured fraction of the running step, or null (no fraction exists for it). */
  fraction: number | null;
  totalElapsedMs: number;
  stageElapsedMs: number | null;
  stepElapsedMs: number | null;
  lastEventAgeMs: number;
  summary: string;
};

/**
 * The browser's reading of a server snapshot. Ages are counted on the
 * server's clock at `serverNow`, plus the client's own time since the answer
 * arrived — a live clock, labelled as elapsed, never as progress.
 */
export function viewLoadProgress(snapshot: LoadProgressSnapshot, clientNow: number, receivedAt: number): LoadProgressView {
  const offset = Math.max(0, clientNow - receivedAt);
  const age = (at: number | null) => (at === null ? null : Math.max(0, snapshot.serverNow - at) + offset);
  const stage = snapshot.stages.find((item) => item.state === "active" || item.state === "failed") ?? null;
  const step = stage?.steps.find((item) => item.state === "active" || item.state === "failed") ?? null;
  const stagesDone = snapshot.stages.filter((item) => item.state === "done" || item.state === "skipped").length;
  const fraction = step?.id === "blocks" && step.state === "active" ? blockFraction(step.measure) : null;
  const endedAt = snapshot.endedAt;
  return {
    jobId: snapshot.jobId,
    attempt: snapshot.attempt,
    state: snapshot.state,
    stagesDone,
    stagesTotal: snapshot.stages.length,
    stage,
    step,
    fraction,
    totalElapsedMs: endedAt !== null ? Math.max(0, endedAt - snapshot.startedAt) : age(snapshot.startedAt) ?? 0,
    stageElapsedMs: stage && stage.state === "active" ? age(stage.startedAt) : null,
    stepElapsedMs: step && step.state === "active" ? age(step.startedAt) : null,
    lastEventAgeMs: age(snapshot.updatedAt) ?? 0,
    summary: summariseLoadProgress(snapshot),
  };
}

/** The queue stage's own words: who is ahead, by name, and where that tune really is. */
export function queueDetail(ahead: QueuedAhead[] | undefined) {
  if (!ahead?.length) return "Waiting for the one-at-a-time analysis lane";
  const [running, ...waiting] = ahead;
  const more = waiting.length ? ` · then ${waiting.map((item) => item.trackName).join(", ")}` : "";
  return `Behind ${running.trackName} (${running.summary})${more}`;
}

/** One line, for status text that is not the deck panel (live mode, assisted status, crate scan). */
export function summariseLoadProgress(snapshot: LoadProgress & { queueAhead?: QueuedAhead[] }) {
  const stagesDone = snapshot.stages.filter((item) => item.state === "done" || item.state === "skipped").length;
  const count = `${stagesDone}/${snapshot.stages.length} stages done`;
  if (snapshot.state === "complete") return `Analysis complete · ${count}`;
  const stage = snapshot.stages.find((item) => item.state === "active" || item.state === "failed");
  if (!stage) return `Analysis starting · ${count}`;
  const step = stage.steps.find((item) => item.state === "active" || item.state === "failed");
  const where = stage.id === "queue"
    ? `Queued · ${queueDetail(snapshot.queueAhead)}`
    : `${stage.label}${step ? ` › ${step.label}` : ""}${step?.measure ? ` · ${blockDetail(step.measure, stage.audioSeconds)}` : step?.detail ? ` · ${step.detail}` : stage.detail ? ` · ${stage.detail}` : ""}`;
  if (snapshot.state === "error") return `Analysis stopped at ${where} · ${snapshot.error ?? "error"}`;
  return `${where} · ${count}`;
}

/** Short status of a job, for naming it from another tune's queue line. */
export function shortJobStatus(snapshot: LoadProgress) {
  const stage = snapshot.stages.find((item) => item.state === "active");
  if (!stage) return snapshot.state === "complete" ? "finishing" : "starting";
  const step = stage.steps.find((item) => item.state === "active");
  const blocks = step?.id === "blocks" && step.measure?.passBlocks ? ` ${step.measure.doneInPass}/${step.measure.passBlocks}` : "";
  return `${stage.label}${step ? ` › ${step.label}${blocks}` : ""}`;
}

/** Legacy coarse stage, kept for the lab page and crate scan, derived from the real one. */
export function legacyStage(progress: LoadProgress): "queued" | "model" | "decode" | "grid" | "complete" | "error" {
  if (progress.state === "complete") return "complete";
  if (progress.state === "error") return "error";
  const stage = progress.stages.find((item) => item.state === "active");
  if (!stage || stage.id === "queue") return "queued";
  if (stage.id === "stem" || stage.id === "beats") return "model";
  const step = stage.steps.find((item) => item.state === "active");
  return stage.id === "grid" && (step?.id === "start" || step?.id === "decode") ? "decode" : "grid";
}

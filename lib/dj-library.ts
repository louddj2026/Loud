import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import type { BeatGridAnalysis } from "./beat-grid.ts";
import { adoptLegacyDurableFile, durableDataRoot } from "./data-root.ts";
import { planDemoSet, type DemoAnalysis } from "./demo-set.ts";
import type { MusicTrack } from "./music-library.ts";
import { teachingProfile, type TeachingMoment, type TeachingProfile } from "./teaching.ts";

export type CompactMixMemory = {
  keepCount: number;
  passCount: number;
  goodMixCount: number;
  greatMixCount: number;
  timingCorrections: number[];
  notes: string[];
  decisions: Array<{
    decision: "keep" | "pass" | "good" | "great";
    score: number | null;
    bassSimilarity: number | null;
    tempoShiftPercent: number | null;
    reason: string | null;
    updatedAt: string;
  }>;
};

export type CompactDjRecord = {
  schema: "crowd2-dj-library-1" | "crowd2-dj-library-2";
  featureVersion?: 2;
  id: string;
  name: string;
  album: string;
  artist: string;
  source: MusicTrack["source"];
  file: string;
  fileSignature: { size: number; modifiedMs: number } | null;
  mappedAt: string;
  analysisVersion: string;
  durationMs: number;
  bpmX100: number;
  tempoSections: Array<[startMs: number, endMs: number, bpmX100: number, confidencePermille: number]>;
  beatGrid: {
    firstBeatMs: number;
    deltaMs: number[];
    downbeats: number[];
    phraseStarts: Array<[beatIndex: number, confidencePermille: number]>;
  };
  verification: {
    status: BeatGridAnalysis["verification"]["status"];
    verifiedCoveragePermille: number;
    reviewBlocks: number;
    noEvidenceBlocks: number;
    exceptions: Array<{
      startMs: number;
      endMs: number;
      status: "review" | "no-evidence";
      reason: string;
      medianResidualMs: number | null;
      driftMs: number | null;
    }>;
  };
  cues: {
    entryRunwayMs: number;
    entryDropMs: number;
    exitRunwayMs: number;
    exitHandoffMs: number;
    mixOutMs: number;
  } | null;
  bassFingerprints: {
    entry: number[];
    exit: number[];
    phrases: Array<[beatIndex: number, values: number[]]>;
  };
  beatFeatures?: {
    beats: number;
    encoding: "uint8-base64";
    lowBody: string;
    lowAttack: string;
    upperAttack: string;
  };
  waveformPreview: { bins: number; encoding: "uint8-base64"; values: string };
  mixMemory: CompactMixMemory;
};

export type CompactDjSummary = Pick<CompactDjRecord,
  "id" | "name" | "album" | "artist" | "source" | "mappedAt" | "analysisVersion" | "durationMs" | "bpmX100" | "cues"
> & {
  featureVersion: number;
  verification: Pick<CompactDjRecord["verification"], "status" | "verifiedCoveragePermille" | "reviewBlocks" | "noEvidenceBlocks">;
  bassFingerprints: Pick<CompactDjRecord["bassFingerprints"], "entry" | "exit">;
  record: string;
};

export type TrackIntelligenceSummary = {
  id: string;
  name: string;
  album: string;
  artist: string;
  source: MusicTrack["source"];
  durationMs: number;
  bpm: number | null;
  bpmConfidence: number | null;
  bpmSource: "quick-scan" | "full-map" | null;
  bpmScannedAt: string | null;
  fullScannedAt: string | null;
  selectedCount: number;
  playedCount: number;
  rejectedCount: number;
  incompatibleCount: number;
  lastSelectedAt: string | null;
  lastPlayedAt: string | null;
  lastRejectedAt: string | null;
};

export type TrackIntelligenceRecord = TrackIntelligenceSummary & {
  bassLinePattern: unknown;
  kickDrumInfo: unknown;
  gridInfo: unknown;
  cueInfo: unknown;
  waveformInfo: unknown;
  extra: unknown;
};

export type TrackIntelligenceStats = {
  totalRecords: number;
  bpmKnown: number;
  fullScanned: number;
  selections: number;
  plays: number;
  incompatiblePairs: number;
};

export function incompatibilityPairKey(leftId: string, rightId: string) {
  if (leftId === rightId) throw new Error("A tune cannot be incompatible with itself");
  return [safeTrackId(leftId), safeTrackId(rightId)].sort() as [string, string];
}

export function compactIntelligenceDetails(record: CompactDjRecord) {
  return {
    bassLinePattern: record.bassFingerprints,
    kickDrumInfo: {
      beatFeatures: record.beatFeatures ?? null,
      downbeats: record.beatGrid.downbeats,
      phraseStarts: record.beatGrid.phraseStarts,
    },
    gridInfo: {
      tempoSections: record.tempoSections,
      beatGrid: record.beatGrid,
      verification: record.verification,
    },
    cueInfo: record.cues,
    waveformInfo: record.waveformPreview,
    extra: {
      schema: record.schema,
      featureVersion: record.featureVersion ?? 1,
      analysisVersion: record.analysisVersion,
      fileSignature: record.fileSignature,
      mappedAt: record.mappedAt,
    },
  };
}

type DetailedAnalysis = BeatGridAnalysis & {
  track: { id: string; name: string };
  generatedAt?: string;
};

const libraryRoot = path.join(durableDataRoot, "dj-library");
const databaseFile = path.join(libraryRoot, "crowd-library.sqlite");
const legacyLibraryRoot = path.join(process.cwd(), "data", "dj-library");
const legacyDatabaseFile = path.join(legacyLibraryRoot, "crowd-library.sqlite");
const legacyRecordsRoot = path.join(legacyLibraryRoot, "tracks");
const legacyIndexFile = path.join(legacyLibraryRoot, "index.json");
const legacyRejectionFile = path.join(legacyLibraryRoot, "grid-rejections.json");
const legacyScanStateFile = path.join(legacyLibraryRoot, "crate-scan.json");
const databaseGlobal = globalThis as typeof globalThis & { __crowd2DjLibraryDatabase?: DatabaseSync };
const emptyMemory = (): CompactMixMemory => ({ keepCount: 0, passCount: 0, goodMixCount: 0, greatMixCount: 0, timingCorrections: [], notes: [], decisions: [] });
const normaliseMemory = (memory?: Partial<CompactMixMemory> | null): CompactMixMemory => ({
  keepCount: memory?.keepCount ?? 0,
  passCount: memory?.passCount ?? 0,
  goodMixCount: memory?.goodMixCount ?? 0,
  greatMixCount: memory?.greatMixCount ?? 0,
  timingCorrections: memory?.timingCorrections ?? [],
  notes: memory?.notes ?? [],
  decisions: memory?.decisions ?? [],
});
const round = (value: number, places = 0) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function parseFile<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; }
  catch { return fallback; }
}

function rowText(row: unknown, key: string) {
  const value = (row as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : null;
}

function rowBytes(row: unknown, key: string) {
  const value = (row as Record<string, unknown> | undefined)?.[key];
  return value instanceof Uint8Array ? Buffer.from(value) : null;
}

function rowNumber(row: unknown, key: string) {
  const value = (row as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : null;
}

function parseRowJson(row: unknown, key: string) {
  const value = rowText(row, key);
  if (value === null) return null;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function safeTrackId(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe library-intelligence track ID");
  return id;
}

function ensureIntelligenceSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS track_intelligence (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      album TEXT NOT NULL,
      artist TEXT NOT NULL,
      source TEXT NOT NULL,
      file TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      bpm_x100 INTEGER,
      bpm_confidence_permille INTEGER,
      bpm_source TEXT,
      bpm_scanned_at TEXT,
      full_scanned_at TEXT,
      bass_pattern_json TEXT,
      kick_info_json TEXT,
      grid_info_json TEXT,
      cue_info_json TEXT,
      waveform_info_json TEXT,
      extra_json TEXT,
      selected_count INTEGER NOT NULL DEFAULT 0,
      played_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      incompatible_count INTEGER NOT NULL DEFAULT 0,
      last_selected_at TEXT,
      last_played_at TEXT,
      last_rejected_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS intelligence_bpm ON track_intelligence(bpm_x100);
    CREATE INDEX IF NOT EXISTS intelligence_updated ON track_intelligence(updated_at DESC);
    CREATE TABLE IF NOT EXISTS track_incompatibilities (
      pair_a TEXT NOT NULL,
      pair_b TEXT NOT NULL,
      current_track_id TEXT NOT NULL,
      rejected_track_id TEXT NOT NULL,
      current_bpm_x100 INTEGER,
      rejected_bpm_x100 INTEGER,
      reason TEXT NOT NULL,
      rejected_at TEXT NOT NULL,
      context_json TEXT,
      PRIMARY KEY(pair_a, pair_b)
    );
    CREATE INDEX IF NOT EXISTS incompatibility_current ON track_incompatibilities(current_track_id, rejected_at DESC);
    CREATE INDEX IF NOT EXISTS incompatibility_rejected ON track_incompatibilities(rejected_track_id, rejected_at DESC);
    CREATE TABLE IF NOT EXISTS track_usage_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      related_track_id TEXT,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS usage_track_time ON track_usage_events(track_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS usage_type_time ON track_usage_events(event_type, created_at DESC);
  `);
}

function upsertIntelligenceIdentity(database: DatabaseSync, track: Pick<MusicTrack, "id" | "name" | "album" | "source" | "file" | "duration">) {
  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO track_intelligence (
      id, name, album, artist, source, file, duration_ms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, album=excluded.album, artist=excluded.artist,
      source=excluded.source, file=excluded.file,
      duration_ms=CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE track_intelligence.duration_ms END,
      updated_at=excluded.updated_at
  `).run(
    safeTrackId(track.id), track.name, track.album, artistFromAlbum(track.album),
    track.source, track.file, Math.max(0, Math.round((track.duration || 0) * 1000)), updatedAt,
  );
}

function storeFullIntelligence(database: DatabaseSync, record: CompactDjRecord) {
  const details = compactIntelligenceDetails(record);
  const confidence = record.tempoSections.reduce((best, section) => Math.max(best, section[3] ?? 0), 0);
  database.prepare(`
    INSERT INTO track_intelligence (
      id, name, album, artist, source, file, duration_ms,
      bpm_x100, bpm_confidence_permille, bpm_source, bpm_scanned_at, full_scanned_at,
      bass_pattern_json, kick_info_json, grid_info_json, cue_info_json, waveform_info_json, extra_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'full-map', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, album=excluded.album, artist=excluded.artist,
      source=excluded.source, file=excluded.file, duration_ms=excluded.duration_ms,
      bpm_x100=excluded.bpm_x100, bpm_confidence_permille=excluded.bpm_confidence_permille,
      bpm_source='full-map',
      bpm_scanned_at=COALESCE(track_intelligence.bpm_scanned_at, excluded.bpm_scanned_at),
      full_scanned_at=excluded.full_scanned_at,
      bass_pattern_json=excluded.bass_pattern_json,
      kick_info_json=excluded.kick_info_json,
      grid_info_json=excluded.grid_info_json,
      cue_info_json=excluded.cue_info_json,
      waveform_info_json=excluded.waveform_info_json,
      extra_json=excluded.extra_json,
      updated_at=excluded.updated_at
  `).run(
    record.id, record.name, record.album, record.artist, record.source, record.file, record.durationMs,
    record.bpmX100, confidence, record.mappedAt, record.mappedAt,
    JSON.stringify(details.bassLinePattern), JSON.stringify(details.kickDrumInfo),
    JSON.stringify(details.gridInfo), JSON.stringify(details.cueInfo),
    JSON.stringify(details.waveformInfo), JSON.stringify(details.extra), new Date().toISOString(),
  );
}

function backfillFullIntelligence(database: DatabaseSync) {
  const rows = database.prepare(`
    SELECT record_gzip FROM tracks
    WHERE id NOT IN (
      SELECT id FROM track_intelligence WHERE full_scanned_at IS NOT NULL
    )
  `).all();
  for (const row of rows) {
    const record = recordFromRow(row);
    if (record) storeFullIntelligence(database, record);
  }
}

function recordFromRow(row: unknown) {
  const compressed = rowBytes(row, "record_gzip");
  if (!compressed) return null;
  try { return JSON.parse(gunzipSync(compressed).toString("utf8")) as CompactDjRecord; }
  catch { return null; }
}

function storeRecord(database: DatabaseSync, record: CompactDjRecord) {
  const compactSummary = summary(record);
  database.prepare(`
    INSERT INTO tracks (
      id, name, album, artist, source, mapped_at, analysis_version,
      duration_ms, bpm_x100, summary_json, record_gzip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, album=excluded.album, artist=excluded.artist,
      source=excluded.source, mapped_at=excluded.mapped_at,
      analysis_version=excluded.analysis_version, duration_ms=excluded.duration_ms,
      bpm_x100=excluded.bpm_x100, summary_json=excluded.summary_json,
      record_gzip=excluded.record_gzip
  `).run(
    record.id, record.name, record.album, record.artist, record.source,
    record.mappedAt, record.analysisVersion, record.durationMs, record.bpmX100,
    JSON.stringify(compactSummary), gzipSync(Buffer.from(JSON.stringify(record)), { level: 9 }),
  );
  storeFullIntelligence(database, record);
}

function migrateLegacyFiles(database: DatabaseSync) {
  const alreadyMigrated = database.prepare("SELECT value_json FROM meta WHERE key = 'legacy-migrated'").get();
  if (alreadyMigrated) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    const legacyIndex = parseFile<CompactDjSummary[]>(legacyIndexFile, []);
    for (const item of legacyIndex) {
      const record = parseFile<CompactDjRecord | null>(path.join(legacyLibraryRoot, item.record), null);
      if (record) storeRecord(database, record);
    }
    for (const rejection of parseFile<GridRejection[]>(legacyRejectionFile, [])) {
      database.prepare(`
        INSERT INTO rejections (id, rejected_at, record_json) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET rejected_at=excluded.rejected_at, record_json=excluded.record_json
      `).run(rejection.id, rejection.rejectedAt, JSON.stringify(rejection));
    }
    if (existsSync(legacyScanStateFile)) {
      const state = parseFile<unknown>(legacyScanStateFile, null);
      if (state !== null) database.prepare("INSERT OR REPLACE INTO meta (key, value_json) VALUES ('crate-scan', ?)").run(JSON.stringify(state));
    }
    database.prepare("INSERT INTO meta (key, value_json) VALUES ('legacy-migrated', 'true')").run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  rmSync(legacyRecordsRoot, { recursive: true, force: true });
  rmSync(legacyIndexFile, { force: true });
  rmSync(legacyRejectionFile, { force: true });
  rmSync(legacyScanStateFile, { force: true });
}

function adoptLegacyDatabaseFile() {
  // A pre-CROWD_DATA_ROOT build kept the DJ memory beside the working
  // directory. Copy it, and its write-ahead log, into the configured durable
  // root once before first open so the booth never boots with empty memory.
  if (!adoptLegacyDurableFile(databaseFile, [legacyDatabaseFile])) return;
  adoptLegacyDurableFile(`${databaseFile}-wal`, [`${legacyDatabaseFile}-wal`]);
}

function djDatabase() {
  if (databaseGlobal.__crowd2DjLibraryDatabase) {
    return databaseGlobal.__crowd2DjLibraryDatabase;
  }
  mkdirSync(libraryRoot, { recursive: true });
  adoptLegacyDatabaseFile();
  const database = new DatabaseSync(databaseFile);
  database.exec(`
    PRAGMA busy_timeout=15000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=MEMORY;
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      album TEXT NOT NULL,
      artist TEXT NOT NULL,
      source TEXT NOT NULL,
      mapped_at TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      bpm_x100 INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      record_gzip BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tracks_name ON tracks(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS rejections (
      id TEXT PRIMARY KEY,
      rejected_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rejections_time ON rejections(rejected_at DESC);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teaching_moments (
      moment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS teaching_track_time ON teaching_moments(track_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS teaching_kind_time ON teaching_moments(kind, created_at DESC);
  `);
  ensureIntelligenceSchema(database);
  migrateLegacyFiles(database);
  backfillFullIntelligence(database);
  databaseGlobal.__crowd2DjLibraryDatabase = database;
  return database;
}

function artistFromAlbum(album: string) {
  return album.split(/\s+-\s+/)[0]?.trim() || "Unknown artist";
}

function average(values: number[], start: number, end: number) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(values.length, Math.ceil(end));
  if (to <= from) return 0;
  let total = 0;
  for (let index = from; index < to; index += 1) total += values[index];
  return total / (to - from);
}

function beatEnergies(analysis: DetailedAnalysis) {
  const source = analysis.lowWaveformDetailed;
  const hop = Math.max(.001, analysis.hopSeconds);
  return analysis.beats.slice(0, -1).map((beat, index) => average(source, beat.time / hop, analysis.beats[index + 1].time / hop));
}

function quantize(values: number[]) {
  if (!values.length) return [];
  const sorted = [...values].sort((left, right) => left - right);
  const ceiling = Math.max(.000001, sorted[Math.floor((sorted.length - 1) * .95)] ?? sorted.at(-1) ?? 1);
  return values.map((value) => Math.max(0, Math.min(255, Math.round(value / ceiling * 255))));
}

function fingerprint(energies: number[], startBeat: number, count = 32) {
  const values = Array.from({ length: count }, (_, offset) => energies[Math.min(energies.length - 1, Math.max(0, startBeat + offset))] ?? 0);
  return quantize(values);
}

function nearestBeatIndex(analysis: DetailedAnalysis, time: number) {
  return analysis.beats.reduce((best, beat, index) => Math.abs(beat.time - time) < Math.abs(analysis.beats[best].time - time) ? index : best, 0);
}

function cueMemory(analysis: DetailedAnalysis) {
  try {
    const input = { id: analysis.track.id, name: analysis.track.name, analysis: analysis as DemoAnalysis };
    const plan = planDemoSet([input, input]);
    const outgoing = plan.tracks[0];
    const incoming = plan.tracks[1];
    return {
      entryRunwayMs: Math.round(incoming.entryRunway * 1000),
      entryDropMs: Math.round(incoming.entryDrop * 1000),
      exitRunwayMs: Math.round(outgoing.exitRunway * 1000),
      exitHandoffMs: Math.round(outgoing.exitHandoff * 1000),
      mixOutMs: Math.round(outgoing.mixOut * 1000),
    };
  } catch {
    return null;
  }
}

function waveformPreview(analysis: DetailedAnalysis, bins = 512) {
  const source = analysis.kickWaveformDetailed?.length ? analysis.kickWaveformDetailed : analysis.lowWaveformDetailed;
  const binned = Array.from({ length: bins }, (_, index) => average(source, index / bins * source.length, (index + 1) / bins * source.length));
  const bytes = Uint8Array.from(quantize(binned));
  return { bins, encoding: "uint8-base64" as const, values: Buffer.from(bytes).toString("base64") };
}

function beatFeatureSeries(analysis: DetailedAnalysis, source: number[]) {
  const hop = Math.max(.001, analysis.hopSeconds);
  const values = analysis.beats.slice(0, -1).map((beat, index) => average(source, beat.time / hop, analysis.beats[index + 1].time / hop));
  return Buffer.from(Uint8Array.from(quantize(values))).toString("base64");
}

export function buildCompactDjRecord(
  track: MusicTrack,
  analysis: DetailedAnalysis,
  fileSignature: CompactDjRecord["fileSignature"] = null,
  previousMemory?: CompactMixMemory,
): CompactDjRecord {
  const energies = beatEnergies(analysis);
  const cues = cueMemory(analysis);
  const entryBeat = cues ? nearestBeatIndex(analysis, cues.entryDropMs / 1000) : 0;
  const exitBeat = cues ? Math.max(0, nearestBeatIndex(analysis, cues.exitHandoffMs / 1000) - 32) : Math.max(0, energies.length - 32);
  const timesMs = analysis.beats.map((beat) => Math.round(beat.time * 1000));
  const phraseStarts = analysis.beats
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => beat.isPhraseStart)
    .map(({ beat, index }) => [index, Math.round(beat.phraseConfidence * 1000)] as [number, number]);
  return {
    schema: "crowd2-dj-library-2",
    featureVersion: 2,
    id: track.id,
    name: track.name,
    album: track.album,
    artist: artistFromAlbum(track.album),
    source: track.source,
    file: track.file,
    fileSignature,
    mappedAt: analysis.generatedAt ?? new Date().toISOString(),
    analysisVersion: analysis.version,
    durationMs: Math.round(analysis.duration * 1000),
    bpmX100: Math.round(analysis.selected.bpm * 100),
    tempoSections: analysis.tempoSections.map((section) => [
      Math.round(section.start * 1000),
      Math.round(section.end * 1000),
      Math.round(section.bpm * 100),
      Math.round(section.confidence * 1000),
    ]),
    beatGrid: {
      firstBeatMs: timesMs[0] ?? 0,
      deltaMs: timesMs.slice(1).map((time, index) => time - timesMs[index]),
      downbeats: analysis.beats.map((beat, index) => beat.isDownbeat ? index : -1).filter((index) => index >= 0),
      phraseStarts,
    },
    verification: {
      status: analysis.verification.status,
      verifiedCoveragePermille: Math.round(analysis.verification.verifiedBeatCoverage * 1000),
      reviewBlocks: analysis.verification.reviewBlocks,
      noEvidenceBlocks: analysis.verification.noEvidenceBlocks,
      exceptions: analysis.verification.blocks
        .filter((block): block is typeof block & { status: "review" | "no-evidence" } => block.status !== "verified")
        .map((block) => ({
          startMs: Math.round(block.start * 1000),
          endMs: Math.round(block.end * 1000),
          status: block.status,
          reason: block.failureReason,
          medianResidualMs: block.medianResidualMs === null ? null : round(block.medianResidualMs, 1),
          driftMs: block.driftMs === null ? null : round(block.driftMs, 1),
        })),
    },
    cues,
    bassFingerprints: {
      entry: fingerprint(energies, entryBeat),
      exit: fingerprint(energies, exitBeat),
      phrases: phraseStarts.slice(0, 64).map(([beatIndex]) => [beatIndex, fingerprint(energies, beatIndex, 16)]),
    },
    beatFeatures: {
      beats: Math.max(0, analysis.beats.length - 1),
      encoding: "uint8-base64",
      lowBody: beatFeatureSeries(analysis, analysis.lowWaveformDetailed),
      lowAttack: beatFeatureSeries(analysis, analysis.lowAttackWaveformDetailed),
      upperAttack: beatFeatureSeries(analysis, analysis.upperAttackWaveformDetailed),
    },
    waveformPreview: waveformPreview(analysis),
    mixMemory: normaliseMemory(previousMemory),
  };
}

function summary(record: CompactDjRecord): CompactDjSummary {
  return {
    id: record.id,
    name: record.name,
    album: record.album,
    artist: record.artist,
    source: record.source,
    mappedAt: record.mappedAt,
    analysisVersion: record.analysisVersion,
    featureVersion: record.featureVersion ?? 1,
    durationMs: record.durationMs,
    bpmX100: record.bpmX100,
    verification: {
      status: record.verification.status,
      verifiedCoveragePermille: record.verification.verifiedCoveragePermille,
      reviewBlocks: record.verification.reviewBlocks,
      noEvidenceBlocks: record.verification.noEvidenceBlocks,
    },
    cues: record.cues,
    bassFingerprints: { entry: record.bassFingerprints.entry, exit: record.bassFingerprints.exit },
    record: `tracks/${record.id}.json`,
  };
}

export async function rememberCompactDjRecord(track: MusicTrack, analysis: DetailedAnalysis, fileSignature: CompactDjRecord["fileSignature"] = null) {
  const database = djDatabase();
  const previous = recordFromRow(database.prepare("SELECT record_gzip FROM tracks WHERE id = ?").get(track.id));
  const record = buildCompactDjRecord(track, analysis, fileSignature ?? previous?.fileSignature ?? null, previous?.mixMemory);
  storeRecord(database, record);
  return record;
}

export async function readCompactDjIndex() {
  return djDatabase().prepare("SELECT summary_json FROM tracks ORDER BY id").all()
    .map((row) => rowText(row, "summary_json"))
    .filter((value): value is string => Boolean(value))
    .map((value) => JSON.parse(value) as CompactDjSummary);
}

export async function hasCompactDjRecord(id: string) {
  return Boolean(djDatabase().prepare("SELECT 1 AS found FROM tracks WHERE id = ?").get(id));
}

export async function forgetCompactDjRecord(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe DJ-library track ID");
  djDatabase().prepare("DELETE FROM tracks WHERE id = ?").run(id);
}

function intelligenceSummaryFromRow(row: unknown): TrackIntelligenceSummary | null {
  const id = rowText(row, "id");
  const name = rowText(row, "name");
  const album = rowText(row, "album");
  const artist = rowText(row, "artist");
  const source = rowText(row, "source");
  if (!id || !name || !album || !artist || (source !== "built-in" && source !== "elements" && source !== "uploaded")) return null;
  const bpmX100 = rowNumber(row, "bpm_x100");
  const confidence = rowNumber(row, "bpm_confidence_permille");
  const bpmSource = rowText(row, "bpm_source");
  return {
    id,
    name,
    album,
    artist,
    source,
    durationMs: rowNumber(row, "duration_ms") ?? 0,
    bpm: bpmX100 === null ? null : bpmX100 / 100,
    bpmConfidence: confidence === null ? null : confidence / 1000,
    bpmSource: bpmSource === "quick-scan" || bpmSource === "full-map" ? bpmSource : null,
    bpmScannedAt: rowText(row, "bpm_scanned_at"),
    fullScannedAt: rowText(row, "full_scanned_at"),
    selectedCount: rowNumber(row, "selected_count") ?? 0,
    playedCount: rowNumber(row, "played_count") ?? 0,
    rejectedCount: rowNumber(row, "rejected_count") ?? 0,
    incompatibleCount: rowNumber(row, "incompatible_count") ?? 0,
    lastSelectedAt: rowText(row, "last_selected_at"),
    lastPlayedAt: rowText(row, "last_played_at"),
    lastRejectedAt: rowText(row, "last_rejected_at"),
  };
}

function intelligenceFromRow(row: unknown): TrackIntelligenceRecord | null {
  const summary = intelligenceSummaryFromRow(row);
  if (!summary) return null;
  return {
    ...summary,
    bassLinePattern: parseRowJson(row, "bass_pattern_json"),
    kickDrumInfo: parseRowJson(row, "kick_info_json"),
    gridInfo: parseRowJson(row, "grid_info_json"),
    cueInfo: parseRowJson(row, "cue_info_json"),
    waveformInfo: parseRowJson(row, "waveform_info_json"),
    extra: parseRowJson(row, "extra_json"),
  };
}

const intelligenceColumns = `
  id, name, album, artist, source, duration_ms,
  bpm_x100, bpm_confidence_permille, bpm_source, bpm_scanned_at, full_scanned_at,
  bass_pattern_json, kick_info_json, grid_info_json, cue_info_json, waveform_info_json, extra_json,
  selected_count, played_count, rejected_count, incompatible_count,
  last_selected_at, last_played_at, last_rejected_at
`;

const intelligenceSummaryColumns = `
  id, name, album, artist, source, duration_ms,
  bpm_x100, bpm_confidence_permille, bpm_source, bpm_scanned_at, full_scanned_at,
  selected_count, played_count, rejected_count, incompatible_count,
  last_selected_at, last_played_at, last_rejected_at
`;

export async function readTrackIntelligenceSummary(id: string) {
  const row = djDatabase().prepare(`SELECT ${intelligenceSummaryColumns} FROM track_intelligence WHERE id = ?`).get(safeTrackId(id));
  return intelligenceSummaryFromRow(row);
}

export async function readTrackIntelligence(id: string) {
  const row = djDatabase().prepare(`SELECT ${intelligenceColumns} FROM track_intelligence WHERE id = ?`).get(safeTrackId(id));
  return intelligenceFromRow(row);
}

export async function readTrackIntelligenceIndex(): Promise<TrackIntelligenceSummary[]> {
  return djDatabase().prepare(`SELECT ${intelligenceSummaryColumns} FROM track_intelligence ORDER BY updated_at DESC`).all()
    .flatMap((row) => {
      const summary = intelligenceSummaryFromRow(row);
      return summary ? [summary] : [];
    });
}

export async function rememberQuickBpmIntelligence(
  track: MusicTrack,
  bpm: number,
  confidence: number,
  extra: unknown = null,
) {
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw new Error("Quick BPM scan returned an invalid tempo");
  const database = djDatabase();
  upsertIntelligenceIdentity(database, track);
  const scannedAt = new Date().toISOString();
  database.prepare(`
    UPDATE track_intelligence SET
      bpm_x100=?, bpm_confidence_permille=?, bpm_source=CASE WHEN full_scanned_at IS NULL THEN 'quick-scan' ELSE bpm_source END,
      bpm_scanned_at=?, extra_json=CASE WHEN full_scanned_at IS NULL THEN ? ELSE extra_json END,
      updated_at=?
    WHERE id=?
  `).run(
    Math.round(bpm * 100), Math.round(Math.max(0, Math.min(1, confidence)) * 1000),
    scannedAt, JSON.stringify(extra), scannedAt, track.id,
  );
  return readTrackIntelligence(track.id);
}

export async function rememberTrackUsage(
  track: MusicTrack,
  eventType: "selected" | "played",
  relatedTrackId?: string | null,
  context: unknown = null,
) {
  const database = djDatabase();
  upsertIntelligenceIdentity(database, track);
  const createdAt = new Date().toISOString();
  const column = eventType === "selected" ? "selected_count" : "played_count";
  const timestamp = eventType === "selected" ? "last_selected_at" : "last_played_at";
  database.prepare(`UPDATE track_intelligence SET ${column}=${column}+1, ${timestamp}=?, updated_at=? WHERE id=?`)
    .run(createdAt, createdAt, track.id);
  database.prepare(`
    INSERT INTO track_usage_events (track_id, related_track_id, event_type, created_at, context_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(track.id, relatedTrackId ? safeTrackId(relatedTrackId) : null, eventType, createdAt, JSON.stringify(context));
  database.exec("DELETE FROM track_usage_events WHERE event_id NOT IN (SELECT event_id FROM track_usage_events ORDER BY event_id DESC LIMIT 16384)");
  return readTrackIntelligence(track.id);
}

export async function rememberTrackIncompatibility(
  currentTrack: MusicTrack,
  rejectedTrack: MusicTrack,
  currentBpm: number | null,
  rejectedBpm: number | null,
  reason = "Marked incompatible by the user",
  context: unknown = null,
) {
  if (currentTrack.id === rejectedTrack.id) throw new Error("A tune cannot be incompatible with itself");
  const database = djDatabase();
  upsertIntelligenceIdentity(database, currentTrack);
  upsertIntelligenceIdentity(database, rejectedTrack);
  const [pairA, pairB] = incompatibilityPairKey(currentTrack.id, rejectedTrack.id);
  const existed = Boolean(database.prepare("SELECT 1 AS found FROM track_incompatibilities WHERE pair_a=? AND pair_b=?").get(pairA, pairB));
  const rejectedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO track_incompatibilities (
      pair_a, pair_b, current_track_id, rejected_track_id,
      current_bpm_x100, rejected_bpm_x100, reason, rejected_at, context_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pair_a, pair_b) DO UPDATE SET
      current_track_id=excluded.current_track_id,
      rejected_track_id=excluded.rejected_track_id,
      current_bpm_x100=excluded.current_bpm_x100,
      rejected_bpm_x100=excluded.rejected_bpm_x100,
      reason=excluded.reason,
      rejected_at=excluded.rejected_at,
      context_json=excluded.context_json
  `).run(
    pairA, pairB, currentTrack.id, rejectedTrack.id,
    Number.isFinite(currentBpm) ? Math.round(currentBpm! * 100) : null,
    Number.isFinite(rejectedBpm) ? Math.round(rejectedBpm! * 100) : null,
    reason, rejectedAt, JSON.stringify(context),
  );
  if (!existed) {
    database.prepare("UPDATE track_intelligence SET incompatible_count=incompatible_count+1, updated_at=? WHERE id IN (?, ?)")
      .run(rejectedAt, currentTrack.id, rejectedTrack.id);
  }
  database.prepare(`
    UPDATE track_intelligence SET
      rejected_count=rejected_count+1, last_rejected_at=?, updated_at=?
    WHERE id=?
  `).run(rejectedAt, rejectedAt, rejectedTrack.id);
  database.prepare(`
    INSERT INTO track_usage_events (track_id, related_track_id, event_type, created_at, context_json)
    VALUES (?, ?, 'incompatible', ?, ?)
  `).run(rejectedTrack.id, currentTrack.id, rejectedAt, JSON.stringify({ reason, ...((context && typeof context === "object") ? context : {}) }));
  return { currentTrackId: currentTrack.id, rejectedTrackId: rejectedTrack.id, rejectedAt, reason, alreadyKnown: existed };
}

export async function readIncompatibleTrackIds(trackId: string) {
  const safeId = safeTrackId(trackId);
  return djDatabase().prepare(`
    SELECT pair_a, pair_b FROM track_incompatibilities
    WHERE pair_a=? OR pair_b=?
  `).all(safeId, safeId).flatMap((row) => {
    const pairA = rowText(row, "pair_a");
    const pairB = rowText(row, "pair_b");
    if (!pairA || !pairB) return [];
    return [pairA === safeId ? pairB : pairA];
  });
}

export async function readTrackIntelligenceStats(): Promise<TrackIntelligenceStats> {
  const database = djDatabase();
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS total_records,
      SUM(CASE WHEN bpm_x100 IS NOT NULL THEN 1 ELSE 0 END) AS bpm_known,
      SUM(CASE WHEN full_scanned_at IS NOT NULL THEN 1 ELSE 0 END) AS full_scanned,
      SUM(selected_count) AS selections,
      SUM(played_count) AS plays
    FROM track_intelligence
  `).get();
  const pairs = database.prepare("SELECT COUNT(*) AS pairs FROM track_incompatibilities").get();
  return {
    totalRecords: rowNumber(totals, "total_records") ?? 0,
    bpmKnown: rowNumber(totals, "bpm_known") ?? 0,
    fullScanned: rowNumber(totals, "full_scanned") ?? 0,
    selections: rowNumber(totals, "selections") ?? 0,
    plays: rowNumber(totals, "plays") ?? 0,
    incompatiblePairs: rowNumber(pairs, "pairs") ?? 0,
  };
}

export type GridRejection = {
  id: string;
  name: string;
  album: string;
  analysisVersion: string;
  rejectedAt: string;
  reasons: string[];
  verifiedBeatCoverage: number;
  reviewRatio: number;
  verifiedBlocks: number;
};

export async function readGridRejections() {
  return djDatabase().prepare("SELECT record_json FROM rejections ORDER BY rejected_at DESC LIMIT 4096").all()
    .map((row) => rowText(row, "record_json"))
    .filter((value): value is string => Boolean(value))
    .map((value) => JSON.parse(value) as GridRejection);
}

export async function rememberGridRejection(track: MusicTrack, rejection: Omit<GridRejection, "id" | "name" | "album" | "rejectedAt">) {
  const record: GridRejection = { id: track.id, name: track.name, album: track.album, rejectedAt: new Date().toISOString(), ...rejection };
  const database = djDatabase();
  database.prepare(`
    INSERT INTO rejections (id, rejected_at, record_json) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET rejected_at=excluded.rejected_at, record_json=excluded.record_json
  `).run(record.id, record.rejectedAt, JSON.stringify(record));
  database.exec("DELETE FROM rejections WHERE id NOT IN (SELECT id FROM rejections ORDER BY rejected_at DESC LIMIT 4096)");
  return record;
}

export async function clearGridRejection(id: string) {
  djDatabase().prepare("DELETE FROM rejections WHERE id = ?").run(id);
}

export type CompactMixDecision = {
  decision: "keep" | "pass" | "good" | "great";
  score?: number;
  bassSimilarity?: number;
  tempoShiftPercent?: number;
  timingCorrection?: number;
  note?: string;
  reason?: string;
};

export async function rememberCompactDecision(id: string, event: CompactMixDecision) {
  const database = djDatabase();
  const record = recordFromRow(database.prepare("SELECT record_gzip FROM tracks WHERE id = ?").get(id));
  if (!record) return false;
  const memory = normaliseMemory(record.mixMemory);
  if (event.decision === "keep") memory.keepCount += 1;
  if (event.decision === "pass") memory.passCount += 1;
  if (event.decision === "good") memory.goodMixCount += 1;
  if (event.decision === "great") memory.greatMixCount += 1;
  if (Number.isFinite(event.timingCorrection)) memory.timingCorrections = [...memory.timingCorrections, event.timingCorrection!].slice(-64);
  if (event.note?.trim()) memory.notes = [...memory.notes, event.note.trim()].slice(-32);
  const decision = {
    decision: event.decision,
    score: Number.isFinite(event.score) ? round(event.score!, 4) : null,
    bassSimilarity: Number.isFinite(event.bassSimilarity) ? round(event.bassSimilarity!, 4) : null,
    tempoShiftPercent: Number.isFinite(event.tempoShiftPercent) ? round(event.tempoShiftPercent!, 3) : null,
    reason: event.reason?.trim() || null,
    updatedAt: new Date().toISOString(),
  };
  memory.decisions = [decision, ...memory.decisions].slice(0, 64);
  storeRecord(database, { ...record, mixMemory: memory });
  return true;
}

export async function readDjLibraryMeta<T>(key: string, fallback: T): Promise<T> {
  const value = rowText(djDatabase().prepare("SELECT value_json FROM meta WHERE key = ?").get(key), "value_json");
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

export async function writeDjLibraryMeta(key: string, value: unknown) {
  djDatabase().prepare(`
    INSERT INTO meta (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
  `).run(key, JSON.stringify(value));
}

export type StoredTeachingMoment = TeachingMoment & {
  momentId: number;
  createdAt: string;
};

export type PendingTeachingBatch = {
  batchId: string;
  momentIdsByTrack: Record<string, number[]>;
};

export type TeachingBatchItem = {
  track: MusicTrack;
  analysis: DetailedAnalysis;
  moments: TeachingMoment[];
};

export type TransitionTeachingPairEntry = {
  id?: string;
  kind?: "cue" | "loop-grid";
  purpose?: "cycle" | "intro-loop" | "outro-transition";
  beats?: number;
};

export function assertTransitionTeachingPair(entries: readonly TransitionTeachingPairEntry[] | undefined) {
  if (!Array.isArray(entries) || entries.length !== 2) throw new Error("A transition pair needs exactly one outgoing and one incoming window");
  const [outgoing, incoming] = entries;
  if (!outgoing.id || !incoming.id || outgoing.id === incoming.id) throw new Error("A transition pair needs two different tracks");
  if (outgoing.kind && outgoing.kind !== "loop-grid" || incoming.kind && incoming.kind !== "loop-grid") throw new Error("Transition-pair entries must be loop grids");
  if (outgoing.purpose !== "outro-transition" || incoming.purpose !== "intro-loop") throw new Error("Transition-pair entries must be outgoing then incoming");
  if (!Number.isInteger(outgoing.beats) || !Number.isInteger(incoming.beats) || outgoing.beats! <= 0 || outgoing.beats !== incoming.beats) {
    throw new Error("Both transition windows need the same whole beat count");
  }
}

const PENDING_TEACHING_BATCH_META_KEY = "pending-teaching-batch";

function storeTeachingMoment(database: DatabaseSync, moment: TeachingMoment): StoredTeachingMoment {
  if (!/^[a-z0-9_-]+$/i.test(moment.trackId)) throw new Error("Unsafe teaching track ID");
  const createdAt = moment.selectedAt || new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO teaching_moments (track_id, kind, created_at, event_json)
    VALUES (?, ?, ?, ?)
  `).run(moment.trackId, moment.kind, createdAt, JSON.stringify(moment));
  return { ...moment, momentId: Number(result.lastInsertRowid), createdAt };
}

/**
 * Commit every SQLite-side effect for a multi-track teaching edit together.
 * The pending marker is written in the same transaction, allowing the route
 * to finish (or recover) the corresponding staged analysis-file promotion.
 */
export async function commitTeachingBatch(batchId: string, items: readonly TeachingBatchItem[]) {
  if (!/^[a-z0-9-]+$/i.test(batchId)) throw new Error("Unsafe teaching batch ID");
  if (items.length < 2) throw new Error("A teaching batch needs at least two tracks");
  const database = djDatabase();
  const storedByTrack: Record<string, StoredTeachingMoment[]> = {};
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      if (!/^[a-z0-9_-]+$/i.test(item.track.id)) throw new Error("Unsafe teaching track ID");
      const previous = recordFromRow(database.prepare("SELECT record_gzip FROM tracks WHERE id = ?").get(item.track.id));
      const record = buildCompactDjRecord(item.track, item.analysis, previous?.fileSignature ?? null, previous?.mixMemory);
      storeRecord(database, record);
      storedByTrack[item.track.id] = item.moments.map((moment) => storeTeachingMoment(database, moment));
    }
    database.exec("DELETE FROM teaching_moments WHERE moment_id NOT IN (SELECT moment_id FROM teaching_moments ORDER BY moment_id DESC LIMIT 4096)");
    const marker: PendingTeachingBatch = {
      batchId,
      momentIdsByTrack: Object.fromEntries(Object.entries(storedByTrack).map(([trackId, moments]) => [trackId, moments.map((moment) => moment.momentId)])),
    };
    database.prepare("INSERT INTO meta (key, value_json) VALUES (?, ?)")
      .run(PENDING_TEACHING_BATCH_META_KEY, JSON.stringify(marker));
    database.exec("COMMIT");
    return { marker, storedByTrack };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function readPendingTeachingBatch(): Promise<PendingTeachingBatch | null> {
  return readDjLibraryMeta<PendingTeachingBatch | null>(PENDING_TEACHING_BATCH_META_KEY, null);
}

export async function clearPendingTeachingBatch(batchId: string) {
  const pending = await readPendingTeachingBatch();
  if (!pending) return true;
  if (pending.batchId !== batchId) return false;
  const deleted = djDatabase().prepare("DELETE FROM meta WHERE key = ? AND value_json = ?")
    .run(PENDING_TEACHING_BATCH_META_KEY, JSON.stringify(pending));
  return Number(deleted.changes) === 1;
}

export async function rememberTeachingMoment(moment: TeachingMoment): Promise<StoredTeachingMoment> {
  const stored = storeTeachingMoment(djDatabase(), moment);
  djDatabase().exec("DELETE FROM teaching_moments WHERE moment_id NOT IN (SELECT moment_id FROM teaching_moments ORDER BY moment_id DESC LIMIT 4096)");
  return stored;
}

export async function readTeachingMoments(trackId?: string, limit = 256): Promise<StoredTeachingMoment[]> {
  if (trackId && !/^[a-z0-9_-]+$/i.test(trackId)) throw new Error("Unsafe teaching track ID");
  const safeLimit = Math.max(1, Math.min(4096, Math.trunc(limit)));
  const rows = trackId
    ? djDatabase().prepare("SELECT moment_id, created_at, event_json FROM teaching_moments WHERE track_id = ? ORDER BY moment_id DESC LIMIT ?").all(trackId, safeLimit)
    : djDatabase().prepare("SELECT moment_id, created_at, event_json FROM teaching_moments ORDER BY moment_id DESC LIMIT ?").all(safeLimit);
  return rows.flatMap((row) => {
    const event = rowText(row, "event_json");
    const momentId = rowNumber(row, "moment_id");
    const createdAt = rowText(row, "created_at");
    if (!event || momentId === null || !createdAt) return [];
    try { return [{ ...(JSON.parse(event) as TeachingMoment), momentId, createdAt }]; }
    catch { return []; }
  });
}

export async function forgetTeachingMoments(trackId: string, momentIds: readonly number[]) {
  if (!/^[a-z0-9_-]+$/i.test(trackId)) throw new Error("Unsafe teaching track ID");
  const ids = [...new Set(momentIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return 0;
  const statement = djDatabase().prepare("DELETE FROM teaching_moments WHERE moment_id = ? AND track_id = ?");
  let removed = 0;
  for (const momentId of ids) removed += Number(statement.run(momentId, trackId).changes);
  return removed;
}

export async function readTeachingProfile(): Promise<TeachingProfile> {
  return teachingProfile(await readTeachingMoments(undefined, 4096));
}

export async function readTeachingProfileExcluding(trackId: string): Promise<TeachingProfile> {
  if (!/^[a-z0-9_-]+$/i.test(trackId)) throw new Error("Unsafe teaching track ID");
  const moments = await readTeachingMoments(undefined, 4096);
  return teachingProfile(moments.filter((moment) => moment.trackId !== trackId));
}

/**
 * Every cue the DJ has taught, newest first, de-duplicated.
 *
 * The same cue is re-logged each time a track is re-taught, so the raw table
 * carries repeats; only distinct (track, role, time) triples are cues. Joined
 * to the intelligence row for the tempo and duration a listening pass needs to
 * build its audition window.
 */
export async function readTaughtCues() {
  const database = djDatabase();
  const rows = database.prepare(`
    SELECT m.track_id AS trackId, m.created_at AS createdAt, m.event_json AS eventJson,
           i.name AS name, i.bpm_x100 AS bpmX100, i.duration_ms AS durationMs
      FROM teaching_moments m
      LEFT JOIN track_intelligence i ON i.id = m.track_id
     WHERE m.kind = 'cue'
     ORDER BY m.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const cues: Array<{ id: string; trackId: string; name: string; role: string; time: number; bpm: number; duration: number; taughtAt: string }> = [];
  for (const row of rows) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(String(row.eventJson)) as Record<string, unknown>; } catch { continue; }
    const time = Number(event.time);
    const role = typeof event.role === "string" ? event.role : "cue";
    const trackId = String(row.trackId);
    if (!Number.isFinite(time)) continue;
    const id = `${trackId}::${role}::${time.toFixed(3)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cues.push({
      id,
      trackId,
      name: typeof row.name === "string" && row.name ? row.name : trackId,
      role,
      time,
      bpm: Number(row.bpmX100) > 0 ? Number(row.bpmX100) / 100 : 0,
      duration: Number(row.durationMs) > 0 ? Number(row.durationMs) / 1000 : 0,
      taughtAt: typeof event.selectedAt === "string" ? event.selectedAt : String(row.createdAt ?? ""),
    });
  }
  // Oldest first: reviewing in the order they were taught keeps a night's work
  // together, which makes it much easier to remember what a cue was for.
  return cues.sort((left, right) => left.taughtAt.localeCompare(right.taughtAt));
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTrackAnalysis } from "../lib/analysis-delivery";
import { learnedCueCandidates, withoutStoredCuePlacements, type AnalysisTeaching, type TeachableAnalysis, type TeachingProfile } from "../lib/teaching";

type MappingJob = { id: string; state: "running" | "complete" | "error"; stage: "queued" | "model" | "decode" | "grid" | "complete" | "error"; detail: string; startedAt: number; stageStartedAt: number; completedAt?: number; error?: string };
type TrackSummary = { id: string; name: string; file: string; mapped: boolean; analysis: string; audio: string; verificationStatus?: "verified" | "review" | "insufficient-evidence"; job: MappingJob | null };
type Hypothesis = { bpm: number; probability: number; score: number; coverage: number; matchedOnsetRatio: number; medianResidualMs: number; p90ResidualMs: number; lowPulseCoverage: number; barAccentContrast: number; metricalRelation: string };
type Beat = { beat: number; time: number; nominalTime: number; attackTime: number | null; residualMs: number | null; strength: number; confidence: number; isDownbeat: boolean; beatInBar: number; isPhraseStart?: boolean; phraseIndex?: number | null; phraseConfidence?: number; kickStatus?: "aligned" | "early" | "late" | "inferred" | "ambiguous"; auditOffsetMs?: number | null; auditStrength?: number };
type Phrase = { index: number; start: number; end: number; startBeat: number; endBeat: number; bars: number; bpm: number; confidence: number; anchorOffsetMs: number | null; reason: "structural-change" | "periodic-continuity" | "track-start" };
type VerificationBlock = { start: number; end: number; status: "verified" | "review" | "no-evidence"; evidenceCoverage: number; medianResidualMs: number | null; p90ResidualMs: number | null; driftMs: number | null; dominantOffsetMs?: number | null; phaseDominance?: number | null; slippedBeats?: number; ambiguousBeats?: number; failureReason?: "aligned" | "phase-offset" | "tempo-drift" | "ambiguous-kick-family" | "no-kick-evidence"; bpm: number };
type Verification = { status: "verified" | "review" | "insufficient-evidence"; verifiedBeatCoverage: number; verifiedBlocks: number; reviewBlocks: number; noEvidenceBlocks: number; blocks: VerificationBlock[] };
type Analysis = { track: { id: string; name: string; file: string }; duration: number; hopSeconds: number; mode: string; evidenceMode: string; tempoSections: Array<{ start: number; end: number; bpm: number; confidence: number }>; selected: Hypothesis; hypotheses: Hypothesis[]; beats: Beat[]; phrases?: Phrase[]; waveform: number[]; lowWaveform: number[]; lowWaveformDetailed: number[]; bassLowWaveformDetailed?: number[]; bassHighWaveformDetailed?: number[]; lowAttackWaveformDetailed?: number[]; upperAttackWaveformDetailed?: number[]; crashWaveformDetailed?: number[]; kickWaveformDetailed?: number[]; uncertainty: Array<{ start: number; end: number; reason: string }>; verification?: Verification; teaching?: AnalysisTeaching };

const EMPTY_TEACHING_PROFILE: TeachingProfile = { totalMoments: 0, cueMoments: 0, mixInCueMoments: 0, mixOutCueMoments: 0, gridCorrectionMoments: 0, cycleMoments: 0, inferredCycleMoments: 0, learnedCueOffsetMs: 0, learnedGridOffsetMs: 0, learnedBpmRatio: 1, commonCycleBeats: null, cycleRepeatPattern: [], kickCyclePattern: null, cuePattern: null, crowdCuePattern: null, entryCuePattern: null, crowdEntryCuePattern: null, correctedGridPattern: null, missedGridPattern: null, theories: [] };

const WIDTH = 1200;
const OVERVIEW_HEIGHT = 132;
const DETAIL_HEIGHT = 310;
const TEMPO_COLOURS = ["#4cf2b4", "#55a7ff", "#ab7dff", "#ff9f43", "#ff4f98", "#d9ff54"];

function tempoColour(analysis: Analysis, sectionIndex: number) {
  const bpm = analysis.tempoSections[sectionIndex]?.bpm ?? analysis.selected.bpm;
  const distinct = [...new Set(analysis.tempoSections.map((section) => section.bpm.toFixed(2)))];
  return TEMPO_COLOURS[Math.max(0, distinct.indexOf(bpm.toFixed(2))) % TEMPO_COLOURS.length];
}

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
}

function areaPath(values: number[], height: number) {
  if (!values.length) return "";
  const middle = height / 2;
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * WIDTH},${middle - value * middle * 0.88}`);
  const reverse = values.map((value, index) => `${(values.length - 1 - index) / Math.max(1, values.length - 1) * WIDTH},${middle + values[values.length - 1 - index] * middle * 0.88}`);
  return `M${points.join(" L")} L${reverse.join(" L")} Z`;
}

function DetailGrid({ analysis, currentTime, windowSeconds, crowdCue, chosenCue, pickingCue, onPick }: { analysis: Analysis; currentTime: number; windowSeconds: number; crowdCue: number | null; chosenCue: number | null; pickingCue: boolean; onPick: (time: number) => void }) {
  const start = Math.max(0, Math.min(analysis.duration - windowSeconds, currentTime - windowSeconds / 2));
  const end = Math.min(analysis.duration, start + windowSeconds);
  const x = (time: number) => (time - start) / Math.max(0.001, end - start) * WIDTH;
  const from = Math.max(0, Math.floor(start / analysis.hopSeconds));
  const detailedWaveform = analysis.kickWaveformDetailed ?? analysis.lowWaveformDetailed;
  const to = Math.min(detailedWaveform.length, Math.ceil(end / analysis.hopSeconds));
  const stride = Math.max(1, Math.ceil((to - from) / 2400));
  const values: Array<{ time: number; value: number }> = [];
  for (let index = from; index < to; index += stride) values.push({ time: index * analysis.hopSeconds, value: detailedWaveform[index] });
  const middle = DETAIL_HEIGHT / 2;
  const upper = values.map(({ time, value }) => `${x(time)},${middle - value * middle * 0.82}`);
  const lower = [...values].reverse().map(({ time, value }) => `${x(time)},${middle + value * middle * 0.82}`);
  const path = upper.length ? `M${upper.join(" L")} L${lower.join(" L")} Z` : "";
  const visibleBeats = analysis.beats.filter((beat) => beat.time >= start - 0.1 && beat.time <= end + 0.1);
  const visibleTempoSections = analysis.tempoSections.map((section, index) => ({ section, index })).filter(({ section }) => section.end >= start && section.start <= end);
  return (
    <svg className={`detail-wave ${pickingCue ? "teaching-pick-active" : ""}`} viewBox={`0 0 ${WIDTH} ${DETAIL_HEIGHT}`} preserveAspectRatio="none" aria-label="Detailed low-end waveform and beat grid" onClick={(event) => { if (!pickingCue) return; const rect = event.currentTarget.getBoundingClientRect(); onPick(start + (event.clientX - rect.left) / rect.width * (end - start)); }}>
      <defs>{visibleTempoSections.map(({ section, index }) => <clipPath id={`detail-tempo-${analysis.track.id}-${index}`} key={`clip-${index}`}><rect x={x(Math.max(start, section.start))} y="0" width={Math.max(1, x(Math.min(end, section.end)) - x(Math.max(start, section.start)))} height={DETAIL_HEIGHT} /></clipPath>)}</defs>
      <rect width={WIDTH} height={DETAIL_HEIGHT} fill="#080b0a" />
      {analysis.uncertainty.filter((region) => region.end >= start && region.start <= end).map((region, index) => (
        <rect key={index} x={x(Math.max(start, region.start))} width={Math.max(1, x(Math.min(end, region.end)) - x(Math.max(start, region.start)))} height={DETAIL_HEIGHT} fill="#875b2b" opacity="0.18" />
      ))}
      {analysis.verification?.blocks.filter((block) => block.end >= start && block.start <= end && block.status !== "verified").map((block, index) => (
        <rect key={`verification-${index}`} x={x(Math.max(start, block.start))} width={Math.max(1, x(Math.min(end, block.end)) - x(Math.max(start, block.start)))} height={DETAIL_HEIGHT} fill={block.status === "review" ? "#ff5a67" : "#89948f"} opacity={block.status === "review" ? "0.18" : "0.09"} />
      ))}
      {visibleTempoSections.map(({ index }) => <path key={`tempo-wave-${index}`} d={path} fill={tempoColour(analysis, index)} opacity="0.58" clipPath={`url(#detail-tempo-${analysis.track.id}-${index})`} />)}
      <line x1="0" y1={middle} x2={WIDTH} y2={middle} stroke="#29483d" strokeWidth="1" />
      {visibleBeats.map((beat) => {
        const colour = beat.isPhraseStart ? "#ff4f98"
          : beat.kickStatus === "early" ? "#ff5a67"
          : beat.kickStatus === "late" ? "#55a7ff"
            : beat.kickStatus === "ambiguous" ? "#ffc857"
              : beat.kickStatus === "inferred" || beat.confidence < 0.3 ? "#7d7568"
                : beat.isDownbeat ? "#d9ff54" : "#4cf2b4";
        return <g key={beat.beat}>
          <line x1={x(beat.time)} y1="0" x2={x(beat.time)} y2={DETAIL_HEIGHT} stroke={colour} strokeWidth={beat.isPhraseStart ? 5 : beat.isDownbeat ? 3 : 1.2} opacity={beat.isDownbeat ? 0.95 : 0.72} />
          {beat.attackTime !== null && <>
            <line x1={x(beat.time)} y1="22" x2={x(beat.attackTime)} y2="22" stroke="#ffc857" strokeWidth="3" />
            <circle cx={x(beat.attackTime)} cy="22" r="4" fill="#ffc857" />
          </>}
          {beat.isPhraseStart ? <text x={x(beat.time) + 6} y="48" fill="#ff4f98" fontSize="18">P{(beat.phraseIndex ?? 0) + 1}</text> : beat.isDownbeat && <text x={x(beat.time) + 5} y="48" fill="#d9ff54" fontSize="18">{Math.floor(beat.beat / 4) + 1}</text>}
        </g>;
      })}
      {crowdCue !== null && crowdCue >= start && crowdCue <= end && <g className="crowd-suggested-cue"><line x1={x(crowdCue)} x2={x(crowdCue)} y1="0" y2={DETAIL_HEIGHT} stroke="#55a7ff" strokeWidth="4" strokeDasharray="9 7" /><text x={Math.min(WIDTH - 170, x(crowdCue) + 7)} y="24" fill="#55a7ff" fontSize="15">CROWD SUGGESTS</text></g>}
      {chosenCue !== null && chosenCue >= start && chosenCue <= end && <g className="user-taught-cue"><line x1={x(chosenCue)} x2={x(chosenCue)} y1="0" y2={DETAIL_HEIGHT} stroke="#ff4f98" strokeWidth="6" /><circle cx={x(chosenCue)} cy="34" r="11" fill="#ff4f98" /><text x={Math.min(WIDTH - 130, x(chosenCue) + 8)} y="54" fill="#ff4f98" fontSize="17">YOUR CUE</text></g>}
      <line x1={x(currentTime)} y1="0" x2={x(currentTime)} y2={DETAIL_HEIGHT} stroke="#ffffff" strokeWidth="3" />
      <text x="14" y={DETAIL_HEIGHT - 14} fill="#a9b5af" fontSize="17">MAGENTA = PHRASE START · GREEN = ALIGNED · RED/BLUE = EARLY/LATE · WAVE COLOUR = BPM SECTION</text>
    </svg>
  );
}

export default function BeatGridLab() {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedId, setSelectedId] = useState("01");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [windowSeconds, setWindowSeconds] = useState(16);
  const [job, setJob] = useState<MappingJob | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(true);
  const [teachingProfile, setTeachingProfile] = useState<TeachingProfile>(EMPTY_TEACHING_PROFILE);
  const [chosenCue, setChosenCue] = useState<number | null>(null);
  const [pickingCue, setPickingCue] = useState(false);
  const [teachingStatus, setTeachingStatus] = useState("Choose Crowd's suggestion or place your own exact cue on either waveform.");
  const audioRef = useRef<HTMLAudioElement>(null);
  const taughtCurrentLoad = useRef(false);

  const loadTeaching = async (id: string) => {
    const response = await fetch(`/api/dj-library/teaching?exclude=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { profile?: TeachingProfile };
    if (payload.profile) setTeachingProfile(payload.profile);
  };

  useEffect(() => { fetch("/api/map", { cache: "no-store" }).then((response) => response.json()).then((payload) => setTracks(payload.tracks)); }, []);
  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setCurrentTime(0);
    setPlaying(false);
    setLoadingTrack(true);
    setChosenCue(null);
    setPickingCue(false);
    taughtCurrentLoad.current = false;
    setTeachingStatus("Choose Crowd's suggestion or place your own exact cue on either waveform.");
    void (async () => {
      try {
        const state = await fetch(`/api/map?id=${selectedId}`, { cache: "no-store" }).then((response) => response.json()) as TrackSummary;
        if (cancelled) return;
        setTracks((current) => current.map((item) => item.id === state.id ? state : item));
        setJob(state.job);
        if (state.mapped) {
          const mappedAnalysis = await fetchTrackAnalysis<Analysis>(state.analysis);
          if (!cancelled) {
            setAnalysis(withoutStoredCuePlacements(mappedAnalysis));
            setChosenCue(null);
            void loadTeaching(state.id);
          }
        }
      } finally {
        if (!cancelled) setLoadingTrack(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);
  useEffect(() => {
    if (job?.state !== "running") return;
    const timer = window.setInterval(async () => {
      setElapsedSeconds(Math.floor((Date.now() - job.startedAt) / 1000));
      const state = await fetch(`/api/map?id=${selectedId}`, { cache: "no-store" }).then((response) => response.json()) as TrackSummary;
      setJob(state.job);
      setTracks((current) => current.map((item) => item.id === state.id ? state : item));
      if (state.mapped && state.job?.state === "complete") {
        const mappedAnalysis = await fetchTrackAnalysis<Analysis>(state.analysis);
        setAnalysis(withoutStoredCuePlacements(mappedAnalysis));
        setChosenCue(null);
        taughtCurrentLoad.current = false;
        void loadTeaching(state.id);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job?.state, job?.startedAt, selectedId]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    if (playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const track = tracks.find((item) => item.id === selectedId);
  const tempoSections = analysis?.tempoSections ?? (analysis ? [{ start: 0, end: analysis.duration, bpm: analysis.selected.bpm, confidence: analysis.selected.probability }] : []);
  const currentTempoSection = tempoSections.find((section) => currentTime >= section.start && currentTime < section.end) ?? tempoSections[0];
  const currentVerificationBlock = analysis?.verification?.blocks.find((block) => currentTime >= block.start && currentTime <= block.end);
  const overviewPath = useMemo(() => areaPath(analysis?.lowWaveform ?? [], OVERVIEW_HEIGHT), [analysis]);
  const crowdCueSuggestion = useMemo(() => {
    if (!analysis) return null;
    const crowdAnalysis = withoutStoredCuePlacements(analysis) as TeachableAnalysis;
    const learned = learnedCueCandidates(crowdAnalysis, teachingProfile, "mix-out", 1)[0];
    if (!learned) return null;
    return {
      rawTime: learned.time,
      time: learned.time,
      patternFit: learned.score,
      learned: true,
    };
  }, [analysis, teachingProfile]);
  const seek = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!analysis || !audioRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = (event.clientX - rect.left) / rect.width * analysis.duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
    if (pickingCue) {
      setChosenCue(time);
      setPickingCue(false);
      setTeachingStatus(`Your exact cue is ${timeLabel(time)}. It has not been snapped to a beat.`);
    }
  };
  const pickExactCue = (time: number) => {
    if (!analysis) return;
    const exact = Math.max(0, Math.min(analysis.duration, time));
    if (audioRef.current) audioRef.current.currentTime = exact;
    setCurrentTime(exact);
    setChosenCue(exact);
    setPickingCue(false);
    setTeachingStatus(`Your exact cue is ${timeLabel(exact)}. It has not been snapped to a beat.`);
  };
  const saveTaughtCue = async () => {
    if (!analysis || chosenCue === null || !crowdCueSuggestion) return;
    setTeachingStatus("Saving your cue and comparing its musical pattern with Crowd's choice...");
    const response = await fetch("/api/dj-library/teaching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: analysis.track.id, kind: "cue", role: "mix-out", time: chosenCue, crowdSuggestedTime: crowdCueSuggestion.time, replacePlacements: !taughtCurrentLoad.current }),
    });
    const payload = await response.json() as { analysis?: Analysis; profile?: TeachingProfile; moment?: { cueVsCrowdMs: number; cueVsGridMs: number }; error?: string };
    if (!response.ok || !payload.analysis) {
      setTeachingStatus(payload.error ?? "Crowd could not save that cue.");
      return;
    }
    setAnalysis(payload.analysis);
    taughtCurrentLoad.current = true;
    void loadTeaching(analysis.track.id);
    const comparison = payload.moment;
    setTeachingStatus(comparison
      ? `Learned. Your cue was ${(comparison.cueVsCrowdMs / 1000).toFixed(3)}s from Crowd's suggestion and ${(comparison.cueVsGridMs / 1000).toFixed(3)}s from its nearest beat line.`
      : "Your cue was saved as the preferred cue for this track.");
  };
  const toggle = async () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) await audioRef.current.play(); else audioRef.current.pause();
  };
  const startMapping = async (force = false) => {
    setAnalysis(null);
    setElapsedSeconds(0);
    const response = await fetch("/api/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, force }) });
    const nextJob = await response.json();
    setJob(nextJob);
  };
  const stageOrder = ["model", "decode", "grid", "complete"] as const;
  const activeStageIndex = job ? stageOrder.indexOf(job.stage as typeof stageOrder[number]) : -1;

  return <main>
    <header>
      <div className="brand-mark">C2</div>
      <div><p className="eyebrow">CROWD2 / REBUILD FROM ZERO</p><h1>Beat Grid Lab</h1></div>
      <nav className="app-nav"><Link href="/dj">OPEN DJ BOOTH</Link><div className="status"><span /> HUMAN TEACHING ACTIVE</div></nav>
    </header>

    <section className="mission">
      <div><p className="eyebrow">MAP · CHECK · TEACH</p><h2>Build the grid, then show Crowd where the musical cycle really turns.</h2></div>
      <p>Crowd maps the full tune first. You can then accept or override its cue, including an exact point between beats, and teach a measured loop cycle from the booth.</p>
    </section>

    <section className="control-bar">
      <label>TRACK<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{tracks.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name} · {item.job?.state === "running" ? "MAPPING" : item.verificationStatus === "review" ? "REVIEW" : item.verificationStatus === "verified" ? "VERIFIED" : item.mapped ? "LEGACY GRID" : "UNMAPPED"}</option>)}</select></label>
      <button className="play" onClick={toggle} disabled={!analysis}>{playing ? "PAUSE" : "PLAY TRACK"}</button>
      <div className="clock"><span>{timeLabel(currentTime)}</span><small>/ {timeLabel(analysis?.duration ?? 0)}</small></div>
      <label>DETAIL WINDOW<select value={windowSeconds} onChange={(event) => setWindowSeconds(Number(event.target.value))}><option value={8}>8 seconds</option><option value={16}>16 seconds</option><option value={32}>32 seconds</option><option value={64}>64 seconds</option></select></label>
    </section>

    {track && <audio ref={audioRef} src={track.audio} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onSeeked={() => setCurrentTime(audioRef.current?.currentTime ?? 0)} />}

    {!analysis ? <section className="mapping-panel">
      <div className="mapping-copy">
        <p className="eyebrow">{loadingTrack ? "CHECKING TRACK STATUS" : job?.state === "running" ? "MAPPING LOCALLY" : job?.state === "error" ? "MAPPING STOPPED" : "UNMAPPED TRACK"}</p>
        <h3>{track?.name ?? "Choose a track"}</h3>
        <p>{loadingTrack ? "Checking whether this tune already has a saved grid..." : job?.state === "running" ? job.detail : job?.state === "error" ? job.error : "No saved beat grid exists for this tune. Start the full-track mapping process when you are ready."}</p>
        {/* Elapsed only: the "about M:SS left" guess from track length is gone (26 Sep 2026); the line above is the job's real stage. */}
        {job?.state === "running" && <div className="time-estimate"><b>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</b><span>elapsed</span></div>}
        {!loadingTrack && job?.state !== "running" && <button className="map-button" onClick={() => startMapping(Boolean(track?.mapped))}>{job?.state === "error" ? "TRY AGAIN" : "MAP THIS TRACK"}</button>}
      </div>
      <ol className="progress-steps">
        {[
          ["model", "Musical beat + downbeat model", "Reads the complete tune and proposes musical pulse positions"],
          ["decode", "Frequency-band decoding", "Separates low, mid and high-frequency timing evidence"],
          ["grid", "Grid fit + phrase anchoring", "Fits tempo and phase, detects structural phrase starts, then locks trusted phrase anchors to kicks"],
          ["complete", "Verify + colour map", "Audits every grid beat and colours the waveform by sustained BPM section"],
        ].map(([stage, label, description], index) => {
          const complete = activeStageIndex > index || job?.stage === "complete";
          const active = job?.stage === stage;
          return <li key={stage} className={complete ? "complete" : active ? "active" : "pending"}><span>{complete ? "✓" : index + 1}</span><div><b>{label}</b><p>{description}</p></div></li>;
        })}
      </ol>
    </section> : <>
      <section className="panel overview-panel">
        <div className="panel-heading"><div><p className="eyebrow">FULL TRACK / CLICK TO SEEK</p><h3>{analysis.track.name}</h3></div><div className="mapped-actions"><button className="remap-button" onClick={() => startMapping(true)}>RE-MAP</button><div className="readout"><strong>{(currentTempoSection?.bpm ?? analysis.selected.bpm).toFixed(3)}</strong><span>BPM AT PLAYHEAD</span></div></div></div>
        <svg className={`overview-wave ${pickingCue ? "teaching-pick-active" : ""}`} viewBox={`0 0 ${WIDTH} ${OVERVIEW_HEIGHT}`} preserveAspectRatio="none" onClick={seek}>
          <defs>{analysis.tempoSections.map((section, index) => <clipPath id={`overview-tempo-${analysis.track.id}-${index}`} key={`overview-clip-${index}`}><rect x={section.start / analysis.duration * WIDTH} y="0" width={Math.max(1, (section.end - section.start) / analysis.duration * WIDTH)} height={OVERVIEW_HEIGHT} /></clipPath>)}</defs>
          <rect width={WIDTH} height={OVERVIEW_HEIGHT} fill="#080b0a" />
          {analysis.uncertainty.map((region, index) => <rect key={index} x={region.start / analysis.duration * WIDTH} width={(region.end - region.start) / analysis.duration * WIDTH} height={OVERVIEW_HEIGHT} fill="#a46b2e" opacity="0.22" />)}
          {analysis.verification?.blocks.filter((block) => block.status === "review").map((block, index) => <rect key={`review-${index}`} x={block.start / analysis.duration * WIDTH} width={(block.end - block.start) / analysis.duration * WIDTH} height={OVERVIEW_HEIGHT} fill="#ff5a67" opacity="0.28" />)}
          {analysis.tempoSections.map((section, index) => <path key={`overview-tempo-wave-${index}`} d={overviewPath} fill={tempoColour(analysis, index)} opacity="0.64" clipPath={`url(#overview-tempo-${analysis.track.id}-${index})`} />)}
          {analysis.beats.filter((beat) => beat.isDownbeat).map((beat) => <g key={beat.beat}><line x1={beat.time / analysis.duration * WIDTH} x2={beat.time / analysis.duration * WIDTH} y1="0" y2={OVERVIEW_HEIGHT} stroke={beat.isPhraseStart ? "#ff4f98" : "#c9f14a"} strokeWidth={beat.isPhraseStart ? 3 : 1} opacity={beat.isPhraseStart ? .9 : .18} />{beat.isPhraseStart && <text x={beat.time / analysis.duration * WIDTH + 4} y="17" fill="#ff4f98" fontSize="12">P{(beat.phraseIndex ?? 0) + 1}</text>}</g>)}
          {crowdCueSuggestion && <g className="crowd-suggested-cue"><line x1={crowdCueSuggestion.time / analysis.duration * WIDTH} x2={crowdCueSuggestion.time / analysis.duration * WIDTH} y1="0" y2={OVERVIEW_HEIGHT} stroke="#55a7ff" strokeWidth="4" strokeDasharray="9 7" /><text x={Math.min(WIDTH - 150, crowdCueSuggestion.time / analysis.duration * WIDTH + 6)} y="36" fill="#55a7ff" fontSize="13">CROWD</text></g>}
          {chosenCue !== null && <g className="user-taught-cue"><line x1={chosenCue / analysis.duration * WIDTH} x2={chosenCue / analysis.duration * WIDTH} y1="0" y2={OVERVIEW_HEIGHT} stroke="#ff4f98" strokeWidth="6" /><circle cx={chosenCue / analysis.duration * WIDTH} cy="58" r="9" fill="#ff4f98" /><text x={Math.min(WIDTH - 130, chosenCue / analysis.duration * WIDTH + 7)} y="80" fill="#ff4f98" fontSize="14">YOUR CUE</text></g>}
          <line x1={currentTime / analysis.duration * WIDTH} x2={currentTime / analysis.duration * WIDTH} y1="0" y2={OVERVIEW_HEIGHT} stroke="#fff" strokeWidth="3" />
        </svg>
      </section>

      <section className="cue-teaching-panel" aria-label="Teach Crowd a preferred cue point">
        <div className="cue-teaching-copy"><p className="eyebrow">STEP 5 · TEACH CROWD</p><h3>Select one good cue point</h3><p>Crowd suggests a phrase/cycle position from its grid, frequency changes and learned examples. Use it, or override it by clicking anywhere on either waveform. Your point is exact and may sit between beat lines.</p></div>
        <div className="cue-teaching-readouts">
          <span><small>CROWD SUGGESTS</small><b>{crowdCueSuggestion ? timeLabel(crowdCueSuggestion.time) : "NO SAFE CUE"}</b><em>{crowdCueSuggestion?.learned ? `${Math.round(crowdCueSuggestion.patternFit * 100)}% learned-pattern fit` : "machine phrase/grid choice"}</em></span>
          <span className="your-cue"><small>YOUR CUE</small><b>{chosenCue === null ? "NOT SET" : timeLabel(chosenCue)}</b><em>{chosenCue === null || !analysis.beats.length ? "choose or override" : `${Math.round((chosenCue - analysis.beats.reduce((best, beat) => Math.abs(beat.time - chosenCue) < Math.abs(best.time - chosenCue) ? beat : best, analysis.beats[0]).time) * 1000)} ms from nearest grid beat`}</em></span>
        </div>
        <div className="cue-teaching-actions">
          <button disabled={!crowdCueSuggestion} onClick={() => { if (!crowdCueSuggestion) return; pickExactCue(crowdCueSuggestion.time); setTeachingStatus("Crowd's suggestion is selected. Save it, or override it on a waveform."); }}>USE CROWD SUGGESTION</button>
          <button className={pickingCue ? "active" : ""} onClick={() => { setPickingCue((value) => !value); setTeachingStatus(pickingCue ? "Cue picking cancelled." : "Click the exact point on either full or detailed waveform. Crowd will not snap it to a beat."); }}>{pickingCue ? "CANCEL PICKING" : "PICK ON WAVEFORM"}</button>
          <button className="save-teaching" disabled={chosenCue === null || !crowdCueSuggestion} onClick={() => void saveTaughtCue()}>SAVE & LEARN</button>
        </div>
        <p className="cue-teaching-status" role="status">{teachingStatus}</p>
        <div className="learning-summary"><b>{teachingProfile.totalMoments} TEACHING MOMENT{teachingProfile.totalMoments === 1 ? "" : "S"}</b><span>{teachingProfile.cueMoments} cue examples · {teachingProfile.cycleMoments} grid/BPM cycles</span><span>{teachingProfile.cuePattern ? `comparing your cycle/phrase position, off-grid phase, ${teachingProfile.cuePattern.lowPattern.length}-beat bass/kick shape and crash/upper-frequency activity against Crowd's choices` : "pattern learning begins with your first saved cue"}</span></div>
      </section>

      {analysis.verification && <section className={`verification-panel ${analysis.verification.status}`}>
        <div className="verification-copy"><p className="eyebrow">FULL-TRACK KICK VERIFICATION</p><h3>{analysis.verification.status === "verified" ? "Grid verified" : analysis.verification.status === "review" ? "Review required before trusting every section" : "Not enough kick evidence to certify"}</h3><p>{analysis.verification.reviewBlocks ? `${analysis.verification.reviewBlocks} red section${analysis.verification.reviewBlocks === 1 ? "" : "s"} failed the strict timing check. Click one to inspect it.` : "Every section containing reliable kick evidence passed."} Grey sections contain no trustworthy kick evidence, so the established timing trajectory is carried through without re-phasing.</p></div>
        <div className="verification-summary"><b>{(analysis.verification.verifiedBeatCoverage * 100).toFixed(1)}%</b><span>of usable kick evidence verified</span><small>{analysis.verification.verifiedBlocks} verified / {analysis.verification.reviewBlocks} review / {analysis.verification.noEvidenceBlocks} continuity-only</small></div>
        <div className="verification-strip" aria-label="Grid verification across the track">{analysis.verification.blocks.map((block, index) => <button key={`${block.start}-${index}`} className={block.status} title={`${timeLabel(block.start)}–${timeLabel(block.end)}: ${block.status}`} style={{ width: `${(block.end - block.start) / analysis.duration * 100}%` }} onClick={() => { const time = (block.start + block.end) / 2; if (audioRef.current) audioRef.current.currentTime = time; setCurrentTime(time); }}><span>{block.status === "verified" ? "V" : block.status === "review" ? "!" : "–"}</span></button>)}</div>
      </section>}

      <section className="tempo-map" aria-label="Tempo sections">
        <div><p className="eyebrow">TEMPO MAP</p><h3>{tempoSections.length === 1 ? "One sustained tempo section" : `${tempoSections.length} sustained tempo sections`}</h3></div>
        <div className="tempo-strip">{tempoSections.map((section, index) => <button key={`${section.start}-${index}`} style={{ width: `${(section.end - section.start) / analysis.duration * 100}%`, borderTop: `3px solid ${tempoColour(analysis, index)}` }} className={currentTime >= section.start && currentTime < section.end ? "current" : ""} onClick={() => { if (audioRef.current) audioRef.current.currentTime = section.start; setCurrentTime(section.start); }}><b>{section.bpm.toFixed(3)}</b><span>{timeLabel(section.start)}–{timeLabel(section.end)}</span></button>)}</div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">KICK INSPECTION</p><h3>{windowSeconds}-second combined kick-evidence window</h3></div><div className="metric-row"><span><b>{analysis.selected.coverage * 100 | 0}%</b> grid coverage</span><span><b>{analysis.selected.medianResidualMs.toFixed(1)} ms</b> {analysis.evidenceMode === "beat-model-plus-multiband" ? "model-grid residual" : "median attack residual"}</span><span><b>{analysis.phrases?.length ?? "LEGACY"}</b> phrase-start anchors</span><span><b>{currentVerificationBlock?.status?.toUpperCase() ?? "LEGACY"}</b> dominant-kick phase audit{currentVerificationBlock?.dominantOffsetMs !== undefined && currentVerificationBlock.dominantOffsetMs !== null ? ` · ${currentVerificationBlock.dominantOffsetMs > 0 ? "+" : ""}${currentVerificationBlock.dominantOffsetMs.toFixed(1)} ms` : ""}</span><span><b>{analysis.evidenceMode === "beat-model-plus-multiband" ? "MODEL + KICK" : "SIGNAL ONLY"}</b> evidence hierarchy</span><span><b>{analysis.mode}</b> grid model</span></div></div>
        <DetailGrid analysis={analysis} currentTime={currentTime} windowSeconds={windowSeconds} crowdCue={crowdCueSuggestion?.time ?? null} chosenCue={chosenCue} pickingCue={pickingCue} onPick={pickExactCue} />
      </section>

      <section className="panel hypotheses">
        <div className="panel-heading"><div><p className="eyebrow">METER IS A HYPOTHESIS</p><h3>Competing tempo grids retained</h3></div><p>The first row is selected. Close alternatives stay visible instead of being discarded.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Choice</th><th>BPM</th><th>Probability</th><th>Grid coverage</th><th>Low-pulse coverage</th><th>Median residual</th><th>90% residual</th><th>Relation</th></tr></thead><tbody>{analysis.hypotheses.map((hypothesis, index) => <tr key={`${hypothesis.bpm}-${index}`} className={index === 0 ? "selected" : ""}><td>{index === 0 ? "PRIMARY" : String(index + 1).padStart(2, "0")}</td><td>{hypothesis.bpm.toFixed(3)}</td><td>{(hypothesis.probability * 100).toFixed(1)}%</td><td>{(hypothesis.coverage * 100).toFixed(1)}%</td><td>{(hypothesis.lowPulseCoverage * 100).toFixed(1)}%</td><td>{hypothesis.medianResidualMs.toFixed(1)} ms</td><td>{hypothesis.p90ResidualMs.toFixed(1)} ms</td><td>{hypothesis.metricalRelation}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </main>;
}

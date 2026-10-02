import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assistedAutomationAtBeat, assistedCuePrerollStart, normaliseAssistedOverlapAutomation } from "../lib/assisted-playback.ts";
import { TRANSITION_PREVIEW_LEAD_BEATS, TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS, selectTransitionPreviewPair, transitionPreviewBeat, transitionPreviewCanCommit, transitionPreviewCrowdAuditionVolume, transitionPreviewLiveArmDecision, transitionPreviewMarkTime, transitionPreviewTempoRate, transitionPreviewWindowReady } from "../lib/transition-preview.ts";
import { focusWaveBufferedRange, focusWaveChunkPlan, focusWaveShouldRebase } from "../lib/waveform-gesture.ts";

const boothSource = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
const diagnosticsRouteSource = await readFile(new URL("../app/api/client-diagnostics/route.ts", import.meta.url), "utf8");
const diagnosticsClientSource = await readFile(new URL("../lib/client-diagnostics-client.ts", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const cueMarkerSource = await readFile(new URL("../lib/cue-markers.ts", import.meta.url), "utf8");
const previewSource = await readFile(new URL("../lib/transition-preview.ts", import.meta.url), "utf8");

test("Preview Mix has exactly eight mapped beats of runway before automation", () => {
  const beats = Array.from({ length: 65 }, (_, time) => ({ time }));
  assert.equal(TRANSITION_PREVIEW_LEAD_BEATS, 8);
  assert.equal(assistedCuePrerollStart({ beats }, 40, 60, TRANSITION_PREVIEW_LEAD_BEATS), 32);
});

test("Preview Apply arms a future live pair when no runtime exists", () => {
  assert.deepEqual(transitionPreviewLiveArmDecision({
    runtimeState: "none",
    decksMatch: true,
    outgoingPlaying: true,
    incomingReady: true,
    incomingStopped: true,
    runtimeHealthy: true,
    outgoingTime: 228.26,
    silentPrerollAt: 342.7,
    otherRunnerActive: false,
  }), { action: "arm", reason: "ready" });
});

test("Preview Apply never claims an unsafe live arm", () => {
  const ready = {
    runtimeState: "none",
    decksMatch: true,
    outgoingPlaying: true,
    incomingReady: true,
    incomingStopped: true,
    runtimeHealthy: true,
    outgoingTime: 228.26,
    silentPrerollAt: 342.7,
    otherRunnerActive: false,
  };
  assert.equal(TRANSITION_PREVIEW_LIVE_ARM_GUARD_SECONDS, .25);
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, outgoingTime: 342.5 }), { action: "blocked", reason: "silent-preroll-passed" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, outgoingTime: 342.7 }), { action: "blocked", reason: "silent-preroll-passed" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, outgoingPlaying: false }), { action: "save-only", reason: "outgoing-not-playing" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, decksMatch: false }), { action: "save-only", reason: "decks-changed" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, runtimeState: "other" }), { action: "blocked", reason: "different-runtime" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, runtimeState: "matching-primary", runtimeHealthy: false }), { action: "blocked", reason: "runtime-busy" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, incomingReady: false }), { action: "blocked", reason: "incoming-unavailable" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, incomingStopped: false }), { action: "blocked", reason: "incoming-not-stopped" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, otherRunnerActive: true }), { action: "blocked", reason: "different-runner" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, runtimeState: "matching-primary", otherRunnerActive: true }), { action: "blocked", reason: "different-runner" });
  assert.deepEqual(transitionPreviewLiveArmDecision({ ...ready, runtimeState: "matching-started" }), { action: "blocked", reason: "live-transition-started" });
});

test("Preview Apply creates the assisted watcher without moving live audio", () => {
  const saveSource = boothSource.match(/const saveTransitionPreview = async \(\) => \{[\s\S]*?(?=  const loadedThreeTuneSequenceReady)/)?.[0] ?? "";
  assert.match(saveSource, /action: "transition-pair"/);
  assert.match(saveSource, /entries: \[/);
  assert.doesNotMatch(saveSource, /Promise\.all\(\[\s*saveWindow/);
  assert.match(saveSource, /transitionPreviewLiveArmDecision\(/);
  assert.match(saveSource, /mediaReadyForTrack\(outgoingAudioAfterSave, outgoingStateAfterSave\.track\)/);
  assert.match(saveSource, /const incomingReady = mediaReadyForTrack\(incomingAudioAfterSave, incomingStateAfterSave\.track\)/);
  assert.match(saveSource, /const runnerChangedDuringSave/);
  assert.match(saveSource, /assistedPlaying\.current = true/);
  assert.match(saveSource, /assistedToken\.current \+= 1/);
  assert.match(saveSource, /demoRuntime\.current = \{[\s\S]*?stage: "primary"[\s\S]*?busy: false/);
  assert.match(saveSource, /demoTimer\.current = setInterval\(demoTick, 80\)/);
  assert.match(saveSource, /armedLiveTransition/);
  assert.match(saveSource, /SAVED TO LIVE TRACKS · LIVE TRANSITION ARMED/);
  assert.doesNotMatch(saveSource, /outgoingAudioAfterSave\.currentTime\s*=/);
  assert.doesNotMatch(saveSource, /outgoingAudioAfterSave\.pause\(\)/);
  assert.doesNotMatch(saveSource, /loadDemoDeck\(/);
  assert.match(saveSource, /decksMatch && liveArmDecision\.action === "save-only"/);
  assert.match(saveSource, /runtimeAfterSave && demoRuntime\.current === runtimeAfterSave[\s\S]*?demoTimer\.current = null;\s*demoRuntime\.current = null;/);
});

test("Preview opens its monitor and returns to the booth after a safe Apply", () => {
  const openSource = boothSource.match(/const openTransitionPreview = \(\) => \{[\s\S]*?(?=  const closeTransitionPreview)/)?.[0] ?? "";
  const saveSource = boothSource.match(/const saveTransitionPreview = async \(\) => \{[\s\S]*?(?=  const loadedThreeTuneSequenceReady)/)?.[0] ?? "";
  assert.match(openSource, /setPreviewMonitorRouting\(true\)/);
  assert.doesNotMatch(openSource, /setPreviewMonitorRouting\(false\)/);
  assert.match(saveSource, /const returnToBoothAfterApply = liveArmDecision\.action !== "blocked"/);
  assert.match(saveSource, /if \(returnToBoothAfterApply\) closeTransitionPreview\(\)/);
});

test("the incoming channel is muted before its silent preroll player starts", () => {
  const runwaySource = boothSource.match(/const beginDemoRunway = async \(runtime: DemoRuntime\) => \{[\s\S]*?(?=  const performDemoSkip)/)?.[0] ?? "";
  const muteAt = runwaySource.indexOf("incomingGraph.channel.gain.setValueAtTime(0");
  const playAt = runwaySource.indexOf("await incomingAudio.play()");
  assert.ok(muteAt >= 0 && playAt > muteAt);
});

test("a failed incoming preroll disarms its watcher while leaving the outgoing deck alone", () => {
  const runwaySource = boothSource.match(/const beginDemoRunway = async \(runtime: DemoRuntime\) => \{[\s\S]*?(?=  const performDemoSkip)/)?.[0] ?? "";
  const failureSource = runwaySource.match(/catch \(error\) \{[\s\S]*?(?=    \} finally)/)?.[0] ?? "";
  assert.match(failureSource, /failedIncomingAudio\?\.pause\(\)/);
  assert.match(failureSource, /const incomingDeckStillExpected/);
  assert.doesNotMatch(failureSource, /incomingAudioForFailure \?\? activeAudio/);
  assert.match(failureSource, /failedGraph\.channel\.gain\.setValueAtTime\(0/);
  assert.match(failureSource, /reportCrowdLiveEvent\("transition\.preroll-failed"/);
  assert.match(failureSource, /demoTimer\.current = null;\s*demoRuntime\.current = null;/);
  assert.match(failureSource, /OUTGOING CONTINUES/);
  assert.doesNotMatch(failureSource, /outgoingAudio\.pause/);
  assert.match(runwaySource, /await ensureGraph\(incoming\.deck\);\s*if \(token !== demoToken\.current \|\| demoRuntime\.current !== runtime\) return;/);
  assert.match(runwaySource, /await incomingAudio\.play\(\);\s*if \(token !== demoToken\.current[\s\S]*?incomingAudio\.pause\(\);\s*return;/);
  assert.match(runwaySource, /finally \{\s*runtime\.busy = false;/);
});

test("booth waveforms omit temporary helper labels but keep their controls", () => {
  assert.doesNotMatch(cueMarkerSource, /PREDICTED INTRO|PREDICTED OUTRO|learned-entry|learned-exit/);
  assert.doesNotMatch(globalCssSource, /CLICK OVERALL WAVE TO SEEK/);
  assert.doesNotMatch(boothSource, /<text[^>]*>DECK \{id\}<\/text>/);
  assert.doesNotMatch(boothSource, /<div className="wave-inline-track">\s*<span>DECK \{id\}<\/span>/);
  assert.match(boothSource, /className="inline-overview-seek" role="button"/);
  assert.match(boothSource, /overall waveform\. Click a point to seek there/);
  assert.match(globalCssSource, /\.inline-overview-seek\{[\s\S]*?z-index:1;[\s\S]*?inset:0;[\s\S]*?pointer-events:auto;/);
  assert.match(globalCssSource, /\.wave-inline-track,\.wave-inline-sync,\.wave-inline-eq\{[\s\S]*?z-index:2;[\s\S]*?pointer-events:none;/);
  assert.match(globalCssSource, /\.wave-inline-deck-shelf :is\(button,input\)\{pointer-events:auto\}/);
  assert.doesNotMatch(globalCssSource, /\.inline-overview-seek\{[^}]*height:16px/);
  assert.match(cueMarkerSource, /label: "YOUR INTRO"/);
  assert.match(cueMarkerSource, /label: "YOUR OUTRO"/);
  assert.match(globalCssSource, /\.wave-inline-cue-actions \.loop-toggle\.active\{[^}]*background:rgba\(171,125,255,\.82\);color:#10091d/);
});

test("Preview uses the selected coordinates and existing grid without projecting another WAV timeline", () => {
  const playMixSource = boothSource.match(/const playTransitionPreviewMix = async \(\) => \{[\s\S]*?(?=  const readDeckMeter)/)?.[0] ?? "";
  assert.match(playMixSource, /const outgoingStart = preview\.outgoingWindow\.start!/);
  assert.match(playMixSource, /const incomingStart = preview\.incomingWindow\.start!/);
  assert.match(playMixSource, /const outgoingBpm = resolvedBpmAt\(preview\.outgoingAnalysis, outgoingStart\)/);
  assert.match(playMixSource, /const runwayStart = Math\.max\(0, outgoingStart - TRANSITION_PREVIEW_LEAD_BEATS \* outgoingBeatSeconds\);/);
  assert.doesNotMatch(playMixSource, /projectTransitionPreviewAppliedAnalysis|projectedPlan|tempoValidation/);
  assert.match(playMixSource, /timeline: "selected-window-span-lock"/);
  assert.match(boothSource, /continuation: "incoming-full-wave-preview-monitor"/);
});

test("live decks keep the analysis grid; only a declared Preview window overrides it", () => {
  assert.doesNotMatch(boothSource, /transitionPreviewDisplayBeats|displayBeats=/);
  // Without a declared window the analyser grid is still what a deck shows.
  assert.match(boothSource, /: analysis\.beats\.filter\(\(beat\) => beat\.time >= renderStart/);
  assert.match(boothSource, /const visibleGridBeats = analysis\.beats\.map/);
});

test("Preview follows the playing deck into the next loaded rotation instead of reopening history", () => {
  const selected = selectTransitionPreviewPair({
    playingDeck: "B",
    idlePair: "A-B-idle",
    runtimeOutgoingDeck: null,
    runtimePair: null,
    playingNextPair: "B-C-live",
  });
  assert.equal(selected, "B-C-live");

  assert.equal(selectTransitionPreviewPair({
    playingDeck: "B",
    idlePair: "A-B-idle",
    runtimeOutgoingDeck: "A",
    runtimePair: "A-B-stale-runtime",
    playingNextPair: "B-C-live",
  }), "B-C-live");

  assert.equal(selectTransitionPreviewPair({
    playingDeck: "B",
    idlePair: "A-B-idle",
    runtimeOutgoingDeck: null,
    runtimePair: null,
    playingNextPair: null,
  }), null, "a live deck with no ready successor must not reopen its previous mix");

  assert.equal(selectTransitionPreviewPair({
    playingDeck: null,
    idlePair: "A-B-idle",
    runtimeOutgoingDeck: "B",
    runtimePair: "B-C-runtime",
    playingNextPair: "B-C-live",
  }), "A-B-idle");
});

test("a safety-muted live deck cannot mute the private crowd audition", () => {
  assert.equal(transitionPreviewCrowdAuditionVolume(0, true), .85);
  assert.equal(transitionPreviewCrowdAuditionVolume(.62, true), .62);
  assert.equal(transitionPreviewCrowdAuditionVolume(0, false), .85);
  assert.equal(transitionPreviewCrowdAuditionVolume(Number.NaN, true), .85);
});

test("Preview Mix cancels stale zero-gain ramps before starting both private players", () => {
  const mixStart = boothSource.indexOf("const playTransitionPreviewMix = async () =>");
  const playStart = boothSource.indexOf("await outgoingAudio.play()", mixStart);
  const startupSource = boothSource.slice(mixStart, playStart);
  assert.ok(mixStart >= 0 && playStart > mixStart);
  assert.match(startupSource, /setTransitionPreviewEq\("outgoing", \{[\s\S]*?output: overlapVolume/);
  assert.match(startupSource, /setTransitionPreviewEq\("incoming", \{[\s\S]*?output: 0/);
  assert.doesNotMatch(startupSource, /outgoingGraph\.output\.gain\.value\s*=/);
  assert.doesNotMatch(startupSource, /incomingGraph\.output\.gain\.value\s*=/);
});

test("preview transports can read the same source at independent positions", () => {
  const livePosition = 200;
  const previewPosition = 340;
  assert.notEqual(livePosition, previewPosition);
  assert.equal(transitionPreviewBeat(previewPosition, { start: 300, end: 364 }, 64), 40);
});

test("private preview players stay mounted while the studio changes views", () => {
  const studioStart = boothSource.indexOf('className="transition-preview-studio"');
  const outgoingPlayer = boothSource.indexOf("ref={transitionPreviewOutgoingAudio}", studioStart);
  const incomingPlayer = boothSource.indexOf("ref={transitionPreviewIncomingAudio}", studioStart);
  const conditionalView = boothSource.indexOf('{transitionPreview.selectionRole === "outgoing"', studioStart);
  assert.ok(studioStart >= 0);
  assert.ok(outgoingPlayer > studioStart && outgoingPlayer < conditionalView);
  assert.ok(incomingPlayer > studioStart && incomingPlayer < conditionalView);

  const cardStart = boothSource.indexOf("const transitionPreviewCard =");
  const panelStart = boothSource.indexOf("const transitionPreviewWindowPanel =", cardStart);
  assert.equal(boothSource.slice(cardStart, panelStart).includes("<audio"), false);
});

test("preview playback clocks do not rerender the whole booth on every media tick", () => {
  const studioStart = boothSource.indexOf('className="transition-preview-studio"');
  const conditionalView = boothSource.indexOf('{transitionPreview.selectionRole === "outgoing"', studioStart);
  assert.equal(boothSource.slice(studioStart, conditionalView).includes("onTimeUpdate"), false);

  const timerStart = boothSource.indexOf("transitionPreviewTimer.current = setInterval");
  const timerEnd = boothSource.indexOf("}, 50);", timerStart);
  assert.ok(timerStart >= 0 && timerEnd > timerStart);
  assert.equal(boothSource.slice(timerStart, timerEnd).includes("setTransitionPreview("), false);
});

test("an active Preview Mix follows a newly selected bass cue without restarting", () => {
  const timerStart = boothSource.indexOf("transitionPreviewTimer.current = setInterval");
  const timerEnd = boothSource.indexOf("}, 50);", timerStart);
  const timerSource = boothSource.slice(timerStart, timerEnd);
  assert.match(timerSource, /const livePreview = transitionPreviewCurrent\.current/);
  assert.match(timerSource, /livePreview\.outgoingTrack\.id !== preview\.outgoingTrack\.id/);
  assert.match(timerSource, /livePreview\.incomingTrack\.id !== preview\.incomingTrack\.id/);
  assert.match(timerSource, /transitionPreviewBeat\([^;]+livePreview\.beats\)/);
  assert.match(timerSource, /assistedAutomationAtBeat\(livePreview\.automation, beat\)/);
  assert.match(timerSource, /assistedAutomationAtBeat\(livePreview\.automation, livePreview\.automation\.windowBeats\)/);
  assert.match(timerSource, /reportCrowdLiveEvent\("preview\.automation\.changed"/);
  assert.doesNotMatch(timerSource, /assistedAutomationAtBeat\(preview\.automation/);

  const activePreview = {
    automation: normaliseAssistedOverlapAutomation({
      windowBeats: 128,
      bassSwapBeat: 32,
      points: [
        { beat: 0, incomingPercent: 76, outgoingPercent: 100 },
        { beat: 32, incomingPercent: 88, outgoingPercent: 82.5 },
        { beat: 128, incomingPercent: 100, outgoingPercent: 65 },
      ],
    }),
  };
  const currentFrame = () => assistedAutomationAtBeat(activePreview.automation, transitionPreviewBeat(40, { start: 0, end: 128 }, 128));
  assert.equal(currentFrame().bassSwapped, true, "the originally selected beat 32 has already swapped at beat 40");
  activePreview.automation = normaliseAssistedOverlapAutomation({ ...activePreview.automation, bassSwapBeat: 64 });
  assert.equal(currentFrame().bassSwapped, false, "the running mix immediately follows the newly selected beat 64");
});

test("an unloaded private player cannot pin the preview time readout to zero", () => {
  const readoutSource = boothSource.match(/function TransitionPreviewTimeReadout[\s\S]*?(?=\nfunction remainingLabel)/)?.[0] ?? "";
  assert.match(readoutSource, /const hasPrivateSource = Boolean\(media\?\.currentSrc \|\| media\?\.getAttribute\("src"\)\)/);
  assert.match(readoutSource, /const current = active && hasPrivateSource \? media\?\.currentTime : undefined/);
  assert.match(readoutSource, /: fallback/);
});

test("focus and whole-track waves remain visible without detailed waveform or tempo sections", () => {
  assert.match(boothSource, /analysis\.kickWaveformDetailed\?\.length/);
  assert.match(boothSource, /: analysis\.lowWaveform;/);
  assert.match(boothSource, /className="overview-wave-base"/);
  assert.match(boothSource, /WHOLE TRACK WAVEFORM/);
});

test("moving focus wave buffers stable source-aligned chunks and rebases before its strip can run dry", () => {
  assert.deepEqual(focusWaveBufferedRange(40, 16), {
    viewStart: 32,
    viewEnd: 48,
    renderStart: 16,
    renderEnd: 64,
  });
  assert.equal(focusWaveShouldRebase(40, 43.99, 16), false);
  assert.equal(focusWaveShouldRebase(40, 44, 16), true);
  const firstPlan = focusWaveChunkPlan({ renderStart: 16, renderEnd: 64, windowSeconds: 16, hopSeconds: .01, sampleLength: 20_000, sampleLimit: 720 });
  const rebasedPlan = focusWaveChunkPlan({ renderStart: 20, renderEnd: 68, windowSeconds: 16, hopSeconds: .01, sampleLength: 20_000, sampleLimit: 720 });
  assert.equal(firstPlan.sampleStride, 7);
  const persistentChunk = firstPlan.chunks.find((chunk) => rebasedPlan.chunks.some((candidate) => candidate.index === chunk.index));
  assert.ok(persistentChunk);
  assert.deepEqual(rebasedPlan.chunks.find((chunk) => chunk.index === persistentChunk.index), persistentChunk);
  assert.match(boothSource, /waveformChunkCache\.current\.get\(chunk\.index\)/);
  assert.match(boothSource, /waveformChunks\.map\(\(chunk\) => <path/);
  assert.match(boothSource, /setRenderAnchorTime\(trackTime\)/);
});

test("the focus wave keeps ONE time base: paint, rebase, playhead and gestures all read the media clock", () => {
  const movingWaveSource = boothSource.match(/function MovingWave\(\{[\s\S]*?(?=\nfunction )/)?.[0] ?? "";
  assert.ok(movingWaveSource, "MovingWave source should be readable");
  // A second clock here makes the audio drift against the drawn wave. The old
  // playing-vs-paused ternary WAS that second clock: pausing re-pinned the
  // whole moving layer to the booth's 66 ms state clock, 0-83 ms behind the
  // media element, by a different amount every time.
  assert.doesNotMatch(movingWaveSource, /visualLatencySeconds/);
  assert.doesNotMatch(movingWaveSource, /deck\.playing && audio && !audio\.paused \? audio\.currentTime : deck\.currentTime/);
  assert.match(movingWaveSource, /const resolvedTrackTime = mediaClockTime \?\? deck\.currentTime;/);
  assert.match(movingWaveSource, /const playheadTime = resolvedTrackTime;/);
  assert.match(movingWaveSource, /applyVisualTransform\(scrubPaintTime\.current \?\? \(audio && !audio\.paused \? audio\.currentTime : visualTrackTime\)\);/);
  assert.match(movingWaveSource, /applyVisualTransform\(trackTime\);/);
  // The gesture anchor reads at event time, not render time.
  assert.match(movingWaveSource, /const anchoredTime = resolvedTrackTimeRef\.current;/);
  // Drag painting is immediate and the normal playback RAF must not overwrite
  // that transform while the media element is paused for scrubbing.
  assert.match(movingWaveSource, /applyVisualTransform\(time\);/);
  assert.match(movingWaveSource, /!audio\.paused && scrubPaintTime\.current === null/);
  assert.match(movingWaveSource, /const visualTrackTime = scrubPaintTime\.current \?\? resolvedTrackTime;/);
  assert.match(movingWaveSource, /publishScrubState\(time, commitAudio\);/);
  // Preview elements carry no src until their private player loads; without
  // this guard both preview waves would pin at t=0 and swallow every seek.
  assert.match(movingWaveSource, /audio\.currentSrc \|\| audio\.getAttribute\("src"\)/);
  assert.match(boothSource, /mediaTime: audio\?\.currentTime,/);
});

test("the moving wave draws audio on the same continuum as its grid, not a coarse lattice", () => {
  // areaPath rounds x; MovingWave builds chunk paths in SECONDS and scales them
  // at paint time, so one-decimal rounding there quantised every peak onto a
  // 100 ms grid while beats and cues stayed exact.
  assert.match(boothSource, /function areaPath\(values: number\[\], width: number, height: number, xDecimals = 1\)/);
  assert.match(boothSource, /\$\{x\.toFixed\(xDecimals\)\},\$\{y\.toFixed\(1\)\}/);
  assert.match(boothSource, /path: areaPath\(values, Math\.max\(0, chunk\.endTime - chunk\.startTime\), height, 6\)/);
  // Peak per column, so a kick cannot be skipped by decimation.
  assert.match(boothSource, /peak = Math\.max\(peak, Math\.abs\(Number\(detailedWaveform\[scan\]\) \|\| 0\)\);/);
  assert.doesNotMatch(boothSource, /values\.push\(detailedWaveform\[sampleIndex\] \?\? 0\);/);
});

test("preview exposes explicit mix-in and mix-out boundary controls", () => {
  for (const label of ["START MIX OUT", "FINISH MIX OUT", "START MIX IN", "FINISH MIX IN"]) {
    assert.ok(boothSource.includes(`"${label}"`), `${label} control is missing`);
  }
  // 29 Aug 2026: the classes carry the anchored state, so they are template
  // literals rather than plain strings.
  assert.ok(boothSource.includes("className={`transition-preview-set-start "));
  assert.ok(boothSource.includes("className={`transition-preview-set-finish "));
});

test("Preview captures a moving mark from the last painted playhead rather than pointer-up time", () => {
  const history = [];
  const pointerDownTime = transitionPreviewMarkTime({
    playing: true,
    displayedTime: 10,
    mediaTime: 10.004,
    stateTime: 8,
    duration: 100,
  });
  const mediaTimeAtPointerUp = 10.160;
  history.push({ edge: "start", time: pointerDownTime });
  assert.equal(pointerDownTime, 10);
  assert.ok(Math.abs(mediaTimeAtPointerUp - pointerDownTime - .160) < 1e-9);
  assert.deepEqual(history, [{ edge: "start", time: 10 }], "one physical press creates one cue-history entry");

  assert.equal(transitionPreviewMarkTime({
    playing: false,
    displayedTime: 9.98,
    mediaTime: 10.160,
    stateTime: 10,
    duration: 100,
  }), 10, "a paused white line remains exactly state-clocked");
});

test("Preview START and FINISH mark once on pointer-down and once on keyboard key-down", () => {
  for (const className of ["transition-preview-set-start", "transition-preview-set-finish"]) {
    const buttonLine = boothSource.split(/\r?\n/).find((line) => line.includes("className={`" + className + " ")) ?? "";
    assert.match(buttonLine, /onPointerDown=\{\(event\) => markTransitionPreviewWindowFromPointer\(event, role, "(?:start|end)"\)\}/);
    assert.match(buttonLine, /onKeyDown=\{\(event\) => markTransitionPreviewWindowFromKeyboard\(event, role, "(?:start|end)"\)\}/);
    assert.doesNotMatch(buttonLine, /onClick=/, `${className} must not mark again at pointer release`);
    assert.equal((buttonLine.match(/markTransitionPreviewWindowFromPointer/g) ?? []).length, 1);
    assert.equal((buttonLine.match(/markTransitionPreviewWindowFromKeyboard/g) ?? []).length, 1);
  }
  const pointerHandler = boothSource.match(/const markTransitionPreviewWindowFromPointer[\s\S]*?(?=  const markTransitionPreviewWindowFromKeyboard)/)?.[0] ?? "";
  const keyboardHandler = boothSource.match(/const markTransitionPreviewWindowFromKeyboard[\s\S]*?(?=  const editTransitionPreviewWindow)/)?.[0] ?? "";
  assert.match(pointerHandler, /!event\.isPrimary \|\| event\.button !== 0/);
  assert.match(pointerHandler, /captureTransitionPreviewMarkTime\(role\)/);
  assert.match(keyboardHandler, /event\.repeat/);
  assert.match(keyboardHandler, /event\.key !== " " && event\.key !== "Enter"/);
  assert.equal((keyboardHandler.match(/markTransitionPreviewWindow\(/g) ?? []).length, 1, "one keyboard activation creates one mark");
  assert.match(boothSource, /visualTimeRef=\{visualTimeRef\}/);
  assert.match(boothSource, /if \(visualTimeRef\) visualTimeRef\.current = trackTime/);
});

test("each preview focus waveform has an independent magenta zoom pair", () => {
  assert.match(boothSource, /className="transition-preview-focus-zoom wave-focus-window-zoom"/);
  assert.match(boothSource, /preview moving waveform zoom out/);
  assert.match(boothSource, /preview moving waveform zoom in/);
  assert.match(boothSource, /\[role\]: Math\.min\(64, current\[role\] \* 2\)/);
  assert.match(boothSource, /\[role\]: Math\.max\(2, current\[role\] \/ 2\)/);
});

test("preview whole-track waveform seeks before loading and follows private playback", () => {
  assert.match(boothSource, /CLICK ANYWHERE TO SEEK · WHITE LINE FOLLOWS PRIVATE PLAYBACK/);
  assert.match(boothSource, /scope={`preview-\${role}`} audioRef={audioRef}/);
  assert.match(boothSource, /className={audioRef \? "overview-focus-line preview-overview-playhead"/);
  assert.match(boothSource, /if \(audio && \(audio\.currentSrc \|\| audio\.getAttribute\("src"\)\)\) audio\.currentTime = bounded/);
  assert.match(boothSource, /setTransitionPreview\(\(current\) => current \? { \.\.\.current, \[role === "outgoing" \? "outgoingTime" : "incomingTime"\]: bounded }/);
});

test("both cropped Preview mix windows have media-clocked playhead lines", () => {
  assert.match(boothSource, /function RunupGridMapper\([^)]*audioRef/);
  assert.match(boothSource, /audioRef && <OverviewPlayhead audioRef=\{audioRef\} time=\{playheadTime\} start=\{start\} end=\{end\}/);
  assert.match(boothSource, /audioRef=\{audioRef\}\s+playheadTime=\{playheadTime\}/);
});

test("confirmed Preview windows hide the superseded analyser grid", () => {
  assert.match(boothSource, /showReferenceGrid && visibleBeats\.map/);
  const panelStart = boothSource.indexOf("const transitionPreviewWindowPanel =");
  const panelEnd = boothSource.indexOf("return <HotkeyContext.Provider", panelStart);
  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.match(boothSource.slice(panelStart, panelEnd), /showReferenceGrid=\{false\}/);
});

test("Preview removes explanatory strips and enlarges its primary automation controls", () => {
  assert.doesNotMatch(boothSource, /SAME FILES · SEPARATE PLAYHEADS/);
  assert.doesNotMatch(boothSource, /EXACT OVERLAP WINDOWS/);
  assert.match(globalCssSource, /\.transition-preview-xyz \.assisted-automation-heading b\{font-size:18px\}/);
  assert.match(globalCssSource, /\.transition-preview-xyz \.assisted-automation-row input\{padding:10px;font-size:16px\}/);
  assert.match(globalCssSource, /\.transition-preview-beats button\{min-width:78px;min-height:44px/);
});

test("booth loop, zoom, and fine-tempo controls invert their colours when selected or pressed", () => {
  assert.match(globalCssSource, /\.wave-inline-cue-actions \.loop-toggle\.active\{[^}]*background:rgba\(171,125,255,\.82\);color:#10091d/);
  assert.match(globalCssSource, /\.wave-inline-cue-actions \.loop-size-button\.active\{[^}]*background:#ff4f98;color:#260617/);
  assert.match(globalCssSource, /:is\(\.loop-scale-half,\.loop-scale-double\):active:not\(:disabled\)\{[^}]*background:#ab7dff;color:#12091f/);
  assert.match(globalCssSource, /:is\(\.loop-move-back,\.loop-move-forward\):active:not\(:disabled\)\{[^}]*background:#8fc5ff;color:#06121c/);
  assert.match(globalCssSource, /\.wave-focus-window-zoom \.wave-zoom-icon:active:not\(:disabled\)\{[^}]*background:#ff4f98;color:#260617/);
  assert.match(globalCssSource, /:is\(\.wave-tempo-overview-zoom \.wave-zoom-icon,\.wave-tempo-step\):active:not\(:disabled\)\{[^}]*background:var\(--booth-signal\);color:#06100c/);
});

test("client diagnostics are capped, same-origin writes with no network-readable log", () => {
  assert.match(diagnosticsRouteSource, /MAX_DIAGNOSTIC_REQUEST_BYTES/);
  assert.match(diagnosticsRouteSource, /fetchSite !== "same-origin"/);
  assert.match(diagnosticsRouteSource, /new URL\(origin\)\.host !== requestUrl\.host/);
  assert.match(diagnosticsRouteSource, /export async function POST/);
  assert.doesNotMatch(diagnosticsRouteSource, /export async function GET/);
  assert.match(diagnosticsRouteSource, /\.\.\.\(body as Record<string, unknown>\), receivedAt:/);
  assert.match(diagnosticsClientSource, /schemaVersion: 1/);
  assert.match(diagnosticsClientSource, /sessionId: currentDiagnosticSessionId\(\)/);
  assert.match(diagnosticsClientSource, /sequence: \+\+diagnosticSequence/);
  assert.match(boothSource, /reportCrowdLiveEvent\("state\.snapshot"/);
  assert.match(boothSource, /\}, 60_000\);/);
  for (const event of ["preview.mix.started", "preview.mix.opened", "preview.mix.bass-swap-started", "preview.mix.bass-swap-completed", "preview.mix.outgoing-cut", "transition.preroll-started", "transition.mix-opened", "transition.handoff", "transition.completed"]) {
    assert.ok(boothSource.includes(`reportCrowdLiveEvent("${event}"`), `${event} is not logged`);
  }
});

test("preview aligns equal-beat windows without changing the live transport", () => {
  const outgoing = { start: 100, end: 132 };
  const incoming = { start: 40, end: 72.5 };
  const rate = transitionPreviewTempoRate(outgoing, incoming);
  assert.equal(rate, 32.5 / 32);
  assert.equal(incoming.start + (outgoing.end - outgoing.start) * rate, incoming.end);
  assert.equal(transitionPreviewBeat(116, outgoing, 64), 32);
});

test("confirmed Preview grids stay aligned at Z when analysed BPMs disagree with their spans", () => {
  const outgoing = { start: 338.2750649919433, end: 363.99181898388656 };
  const incoming = { start: 79.47087724303833, end: 105.98254029988533 };
  const gridRate = transitionPreviewTempoRate(outgoing, incoming);
  for (let beat = 0; beat <= 64; beat += 1) {
    const outgoingTime = outgoing.start + (outgoing.end - outgoing.start) * beat / 64;
    const incomingTime = incoming.start + (outgoingTime - outgoing.start) * gridRate;
    const incomingGridTime = incoming.start + (incoming.end - incoming.start) * beat / 64;
    assert.ok(Math.abs(incomingTime - incomingGridTime) < 1e-9, `beat ${beat} must align`);
  }

  const analysedBpmRate = 148.998 / 145;
  const analysedBpmEnd = incoming.start + (outgoing.end - outgoing.start) * analysedBpmRate;
  assert.ok(incoming.end - analysedBpmEnd > .08, "the prior BPM ratio drifted the confirmed grids by over 80 ms");
});

test("changing Preview overlap beats re-places the free end and never the anchor", () => {
  // DJ, 29 Aug 2026: the DJ marks ONE edge; the beat count places the other.
  // Clicking lengths re-derives the free end from the anchored edge, which is
  // exactly why this handler MUST rebuild the windows - and must feed the
  // derivation the anchor's own time, so the marked edge cannot move.
  const beatHandler = boothSource.match(/const setTransitionPreviewOverlapBeats = \(beats: AssistedOverlapBeats\) => \{[\s\S]*?(?=  const updateTransitionPreviewAutomation)/)?.[0] ?? "";
  assert.match(beatHandler, /const anchorTime = anchor === "start" \? window\.start : window\.end;/);
  assert.match(beatHandler, /deriveTransitionPreviewWindowFor\(current, role, anchor, anchorTime, beats\)/);
  assert.match(beatHandler, /if \(!derived\.ok\) return \{ window/);
  assert.match(boothSource, /const incomingRate = transitionPreviewTempoRate\(preview\.outgoingWindow, preview\.incomingWindow\)/);
  assert.doesNotMatch(boothSource, /const incomingRate = bpmMatchedTempoRate\(outgoingBpm, incomingBpm\)/);
  assert.match(boothSource, /onClick=\{\(\) => setTransitionPreviewOverlapBeats\(beats\)\}/);
});

test("Preview display and live automation share the confirmed-window tempo authority", () => {
  assert.match(boothSource, /const tempoRate = !outgoing[\s\S]*?\? transitionPreviewTempoRate\(transitionPreview\.outgoingWindow, transitionPreview\.incomingWindow\)/);
  const cueLockedUses = boothSource.match(/const baseRate = cueLockedTempoRate\(/g) ?? [];
  assert.equal(cueLockedUses.length, 2, "launch and runway correction must use the same exact cue spans");
  assert.doesNotMatch(boothSource, /bpmMatchedTempoRate/);
});

test("Preview Mix uses the 7 August hard cue alignment and gentle preroll nudge", () => {
  const playMixSource = boothSource.match(/const playTransitionPreviewMix = async \(\) => \{[\s\S]*?(?=  const readDeckMeter)/)?.[0] ?? "";
  const mixOpenSource = playMixSource.match(/if \(!mixOpened && current\.currentTime >= outgoingStart - \.005\) \{[\s\S]*?(?=      if \(mixOpened && !outgoingCut\))/)?.[0] ?? "";
  const audibleOpenAt = mixOpenSource.indexOf('setTransitionPreviewOutput("incoming", overlapVolume)');
  assert.ok(audibleOpenAt >= 0, "the private gain should open after the cue is hard-aligned");
  assert.equal(mixOpenSource.slice(0, audibleOpenAt).includes("next.currentTime = targetTime"), true);
  assert.match(playMixSource, /next\.playbackRate = assistedSilentGridNudgeRate\(safeIncomingRate, phaseError\)/);
  assert.match(playMixSource, /reportCrowdLiveEvent\("preview\.mix\.final-preroll-lock"/);
  assert.match(playMixSource, /Math\.abs\(phaseError\) > \.004/);
  assert.doesNotMatch(playMixSource, /silentLockRate|silentSeekSettled/);
  assert.match(playMixSource, /phaseErrorMs:/);
});

test("Preview Mix button states the beat count that will actually run", () => {
  assert.match(boothSource, /`PREVIEW \$\{transitionPreview\.beats\}-BEAT MIX`/);
  assert.match(boothSource, /`PAUSE \$\{transitionPreview\.beats\}-BEAT PREVIEW MIX`/);
});

test("Preview uses source BPMs for preroll but confirmed grid spans for its one tempo ratio", () => {
  const playMixSource = boothSource.match(/const playTransitionPreviewMix = async \(\) => \{[\s\S]*?(?=  const readDeckMeter)/)?.[0] ?? "";
  assert.match(playMixSource, /const outgoingBpm = resolvedBpmAt\(preview\.outgoingAnalysis, outgoingStart\)/);
  assert.match(playMixSource, /const incomingBpm = resolvedBpmAt\(preview\.incomingAnalysis, incomingStart\)/);
  assert.match(playMixSource, /outgoingAudio\.playbackRate = 1/);
  assert.match(playMixSource, /const incomingRate = transitionPreviewTempoRate\(preview\.outgoingWindow, preview\.incomingWindow\)/);
  assert.doesNotMatch(playMixSource, /const incomingRate = bpmMatchedTempoRate\(outgoingBpm, incomingBpm\)/);
  assert.doesNotMatch(playMixSource, /projectedOutgoing|tempoValidation|outgoingRate/);
});

test("preview only commits two complete windows and a whole beat count", () => {
  assert.equal(transitionPreviewWindowReady({ start: 20, end: 30 }), true);
  assert.equal(transitionPreviewCanCommit({ start: 20, end: 30 }, { start: 4, end: 14 }, 64), true);
  assert.equal(transitionPreviewCanCommit({ start: null, end: 30 }, { start: 4, end: 14 }, 64), false);
  assert.equal(transitionPreviewCanCommit({ start: 20, end: 30 }, { start: 4, end: 14 }, 64.5), false);
});

test("a confirmed window is the grid authority: no snap-to-old-grid, no disagreement warning", () => {
  // The user's marks re-teach tempo. Judging them against the analyser's grid
  // inverts that authority, so none of it may come back.
  assert.doesNotMatch(boothSource, /SNAP FINISH/);
  assert.doesNotMatch(boothSource, /DISAGREES WITH ITS GRID/);
  assert.doesNotMatch(boothSource, /THIS MIX WILL RUN OUT OF TIME/);
  assert.doesNotMatch(boothSource, /SNAP FINISH OR RESELECT/);
  // Marking an anchor states what the derived window declares instead
  // (29 Aug 2026: one edge + the beat count places the other).
  assert.ok(boothSource.includes("{windowBpm.toFixed(3)} BPM"));
});

test("Preview counts its run-up in the user's window beats, not the analysed grid", () => {
  const playMixSource = boothSource.match(/const playTransitionPreviewMix = async \(\) => \{[\s\S]*?(?=  const readDeckMeter)/)?.[0] ?? "";
  assert.match(playMixSource, /const outgoingBeatSeconds = \(outgoingEnd - outgoingStart\) \/ Math\.max\(1, preview\.beats\);/);
  assert.match(playMixSource, /const incomingBeatSeconds = \(incomingEnd - incomingStart\) \/ Math\.max\(1, preview\.beats\);/);
  assert.match(playMixSource, /const runwayStart = Math\.max\(0, outgoingStart - TRANSITION_PREVIEW_LEAD_BEATS \* outgoingBeatSeconds\);/);
  assert.match(playMixSource, /const incomingPrerollStart = Math\.max\(0, incomingStart - TRANSITION_PREVIEW_SILENT_PREROLL_BEATS \* incomingBeatSeconds\);/);
  // The analyser's BPM stays available as reference evidence only.
  assert.doesNotMatch(playMixSource, /assistedCuePrerollStart\(preview\./);
});

test("the pinned comparison waveform auditions from the point you click", () => {
  const mapper = boothSource.match(/function RunupGridMapper\(\{[\s\S]*?(?=\nexport default function |\nfunction )/)?.[0] ?? "";
  assert.ok(mapper, "RunupGridMapper source should be readable");
  // Tap, not click: a drag-to-scroll or a pinch must never fire an audition.
  assert.match(mapper, /Math\.abs\(event\.clientX - tap\.x\) > 4 \|\| Math\.abs\(event\.clientY - tap\.y\) > 4/);
  assert.match(mapper, /tap\.moved = true;/);
  assert.match(mapper, /if \(tap && tap\.pointerId === event\.pointerId && !tap\.moved && onAudition\)/);
  // The pixel resolves through the same start/span the wave and grid use.
  assert.match(mapper, /onAudition\(start \+ fraction \* span\);/);
  assert.match(mapper, /CLICK TO PLAY FROM THERE/);
  // The pointer handlers are touch/pen only (they bail on "mouse"), so a mouse
  // click needs its own path or the waveform is dead to a mouse entirely.
  assert.match(mapper, /const timelineClick = \(event: React\.MouseEvent<HTMLDivElement>\) => \{/);
  assert.match(mapper, /onClick=\{timelineClick\}/);
  assert.match(mapper, /if \(event\.pointerType === "mouse"\) return;/);
  // Bass-cue buttons live inside the same container and stay buttons.
  assert.match(mapper, /\?\.closest\("button"\)\) return;/);
  assert.match(mapper, /if \(event\.clientY < bounds\.top \|\| event\.clientY > bounds\.bottom\) return;/);
  // A second click jumps to the new point instead of pausing.
  assert.match(boothSource, /if \(preview\.audition === role && !restart\)/);
  assert.match(boothSource, /playTransitionPreviewTrack\(role, time, true\)/);
});

test("a confirmed window IS the grid: Preview derives every beat from the DJ's span and count", async () => {
  const { transitionPreviewGridBeats } = await import("../lib/transition-preview.ts");
  // 96 beats across 40.020 s is the DJ's statement of tempo. Nothing measures,
  // nothing snaps, nothing consults the analyser.
  const grid = transitionPreviewGridBeats({ start: 371.281, end: 411.301, beats: 96, from: 371.281, to: 411.301 });
  assert.equal(grid.length, 97);
  assert.ok(Math.abs(grid[0].time - 371.281) < 1e-9);
  assert.ok(Math.abs(grid[96].time - 411.301) < 1e-9);
  const beatSeconds = (411.301 - 371.281) / 96;
  for (const entry of grid) {
    assert.ok(Math.abs(entry.time - (371.281 + entry.beat * beatSeconds)) < 1e-9);
  }
  // The window start is beat zero and a downbeat; bars count both ways from it.
  assert.equal(grid[0].isDownbeat, true);
  assert.equal(grid[4].isDownbeat, true);
  assert.equal(grid[1].isDownbeat, false);
  // The run-up before the window sits on the same ruler.
  const withRunUp = transitionPreviewGridBeats({ start: 100, end: 140, beats: 96, from: 96, to: 104 });
  assert.ok(withRunUp.some((entry) => entry.beat < 0));
  assert.ok(withRunUp.every((entry) => entry.time >= 0));
  // Degenerate input draws nothing rather than guessing.
  assert.deepEqual(transitionPreviewGridBeats({ start: 10, end: 10, beats: 96, from: 0, to: 20 }), []);
  assert.deepEqual(transitionPreviewGridBeats({ start: 10, end: 50, beats: 0, from: 0, to: 20 }), []);
});

test("Preview never reaches for the analyser's grid or an audio measurement", () => {
  // The DJ's rule: BPM is beats over span, and every calculation follows from
  // that. Measurement moved placed cues and reported tempos it could not see.
  assert.doesNotMatch(boothSource, /tightenTransitionPreviewWindow/);
  assert.doesNotMatch(boothSource, /TIGHTEN FROM AUDIO/);
  assert.doesNotMatch(boothSource, /window-tempo/);
  // The preview waveform draws the declared grid.
  assert.match(boothSource, /const visibleBeats = declaredGrid\s*\?\s*transitionPreviewGridBeats\(\{ \.\.\.declaredGrid, from: renderStart, to: renderEnd \}\)/);
  assert.match(boothSource, /declaredGrid=\{window\.start !== null && window\.end !== null \? \{ start: window\.start, end: window\.end, beats: transitionPreview\.beats \} : undefined\}/);
  // A declared grid is authoritative, so analyser kick-audit dots stand down.
  assert.match(boothSource, /const authoritativeManualGrid = declaredGrid !== undefined \|\| authoritativeManualTempoBpm/);
});

test("unapplied Preview cues survive a refresh or a rebuild", async () => {
  const { parsePreviewDraft, previewDraftHasMarks, previewDraftKey } = await import("../lib/preview-draft.ts");
  // Placing four points by ear is the expensive part; losing them to a deploy
  // was costing a full re-cue every time.
  const draft = parsePreviewDraft({
    outgoingTrackId: "a", incomingTrackId: "b",
    outgoingWindow: { start: 313.263, end: 351.97 },
    incomingWindow: { start: 58.345, end: 97.536 },
    beats: 96, bassSwapBeat: 48,
  });
  assert.ok(draft);
  assert.equal(draft.beats, 96);
  assert.equal(draft.bassSwapBeat, 48);
  assert.equal(previewDraftKey("a", "b"), "a::b");
  // The same tunes the other way round is a different mix.
  assert.notEqual(previewDraftKey("a", "b"), previewDraftKey("b", "a"));
  // A half-finished window is still worth keeping — losing a placed START is the loss.
  const halfway = parsePreviewDraft({ outgoingTrackId: "a", incomingTrackId: "b", outgoingWindow: { start: 10, end: null }, incomingWindow: { start: null, end: null }, beats: 64 });
  assert.ok(halfway);
  assert.equal(previewDraftHasMarks(halfway), true);
  // Nothing marked must never overwrite a stored draft.
  const empty = parsePreviewDraft({ outgoingTrackId: "a", incomingTrackId: "b", outgoingWindow: { start: null, end: null }, incomingWindow: { start: null, end: null }, beats: 64 });
  assert.equal(previewDraftHasMarks(empty), false);
  // Garbage is dropped rather than half-applied.
  assert.equal(parsePreviewDraft(null), null);
  assert.equal(parsePreviewDraft({ outgoingTrackId: "a", incomingTrackId: "b", outgoingWindow: {}, incomingWindow: {}, beats: 0 }), null);
  // A backwards window keeps its start and discards the impossible end.
  const backwards = parsePreviewDraft({ outgoingTrackId: "a", incomingTrackId: "b", outgoingWindow: { start: 90, end: 40 }, incomingWindow: { start: 1, end: 2 }, beats: 64 });
  assert.equal(backwards.outgoingWindow.end, null);
  assert.equal(backwards.outgoingWindow.start, 90);
  // Applied teaching still wins: a draft only fills an uncommitted pair.
  assert.match(boothSource, /if \(!transitionPreviewWindowReady\(outgoingWindow\) \|\| !transitionPreviewWindowReady\(incomingWindow\)\)/);
  assert.match(boothSource, /Your unapplied cues were restored/);
});

test("an unmarked edge is never stored as a mark at zero seconds", async () => {
  const { parsePreviewDraft } = await import("../lib/preview-draft.ts");
  // Number(null) is 0: converting before checking turns "nothing placed yet"
  // into "cued to the very start of the track".
  const draft = parsePreviewDraft({
    outgoingTrackId: "a", incomingTrackId: "b",
    outgoingWindow: { start: null, end: null },
    incomingWindow: { start: null, end: undefined },
    beats: 64,
  });
  assert.ok(draft);
  assert.equal(draft.outgoingWindow.start, null);
  assert.equal(draft.outgoingWindow.end, null);
  assert.equal(draft.incomingWindow.start, null);
  assert.equal(draft.incomingWindow.end, null);
  assert.equal(draft.bassSwapBeat, undefined);
  // A real zero is still a legitimate mark.
  const atZero = parsePreviewDraft({ outgoingTrackId: "a", incomingTrackId: "b", outgoingWindow: { start: 0, end: 12 }, incomingWindow: { start: null, end: null }, beats: 64 });
  assert.equal(atZero.outgoingWindow.start, 0);
});

test("a recycled deck comes back audible: loading a track clears the mixed-out EQ cut", () => {
  // finishDemoBlend cuts the outgoing deck to -60/-60/-60 so it vanishes
  // cleanly. Decks are recycled every rotation (A -> B -> C -> A), so without
  // this reset a fresh tune inherits the cut and plays to nobody: transport
  // running, volume up, silence in the booth AND to the crowd.
  const loadSource = boothSource.match(/const loadTrack = async \([\s\S]*?(?=\n  const rememberLoadedTrack|\n  const openLocalFile)/)?.[0] ?? boothSource;
  assert.match(loadSource, /changeDeck\(id, \{ track, analysis: immediateAnalysis,[^}]*volume: SAFE_LOADED_DECK_VOLUME, low: 0, mid: 0, high: 0 \}\)/);
  // The cut itself must stay: it is correct at the end of a transition.
  assert.match(boothSource, /changeDeck\(outgoing\.deck, \{ playing: false, volume: 0, low: -60, mid: -60, high: -60, loopActive: false \}\)/);
});

test("a finished rotation's runtime cannot block the next hand-driven Apply", () => {
  const saveSource = boothSource.match(/const saveTransitionPreview = async \(\) => \{[\s\S]*?(?=  const loadedThreeTuneSequenceReady)/)?.[0] ?? "";
  // An assisted rotation deliberately keeps its runtime for the next hop. When
  // the DJ drives by hand it goes stale the moment its outgoing tune stops
  // being the one playing, and every later Apply reported "another transition
  // is already armed" until the page was reloaded.
  assert.match(saveSource, /if \(staleRuntime && !staleRuntime\.busy && staleRuntime\.stage === "primary"\) \{/);
  assert.match(saveSource, /demoRuntime\.current = null;/);
  assert.match(saveSource, /reportCrowdLiveEvent\("transition\.stale-runtime-released"/);
  // Whether its outgoing tune is still the one playing was once part of this
  // test. It is not a test of audibility — an armed runtime has not touched
  // the output either way — and requiring it meant the DJ's own Apply could
  // not replace a watcher armed on the tune they were already playing.
  assert.doesNotMatch(saveSource, /staleOutgoingLive/);
  // A runtime that has begun its swap keeps its protection, in the decision.
  assert.match(previewSource, /if \(input\.runtimeState === "matching-started"\) return \{ action: "blocked", reason: "live-transition-started" \};/);
});

test("the live handoff raises the incoming tune at its Mix In cue", () => {
  // A loaded deck sits at the zero safety fader by design. The handoff has to
  // supply the level: inheriting the outgoing fader meant a deck at or near
  // zero handed the incoming tune silence, and the mix ran with nothing
  // audible in the booth or to the crowd.
  assert.match(boothSource, /runtime\.overlapVolume = liveHandoffVolume\(decksCurrent\.current\[outgoing\.deck\]\.volume\)/);
  assert.match(boothSource, /const overlapVolume = runtime\.overlapVolume \?\? liveHandoffVolume\(decksCurrent\.current\[outgoing\.deck\]\.volume\)/);
  // It is ramped onto the channel at the cue, and written to deck state when
  // the overlap opens.
  assert.match(boothSource, /scheduleAudioParamRamp\(incomingGraph\.channel\.gain, cueVolume, audioContext\.currentTime, audioContext\.currentTime \+ secondsToCue\)/);
  assert.match(boothSource, /volume: fixedGain\?\.volume \?\? overlapVolume,/);
  // And the deck still loads silent, so nothing arrives before it is meant to.
  assert.match(boothSource, /volume: SAFE_LOADED_DECK_VOLUME, low: 0, mid: 0, high: 0/);
});

test("Apply never mistakes its own cleanup for a competing runner", () => {
  // saveTransitionPreview snapshots the runner tokens on entry, then compares
  // them later to spot a runner that appeared while the async save was in
  // flight. Retiring the stale runtime bumps one of those tokens itself, so
  // an un-rebased bump made Apply block on a foreign runner that did not
  // exist — trading "another transition is already armed" for "another live
  // or demo runner is active" and leaving no way to arm but a page reload.
  const save = boothSource.match(/const saveTransitionPreview = async \(\)[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(save, "saveTransitionPreview source should be readable");
  const capture = save.indexOf("const runnerTokensAtStart = {");
  const raceCheck = save.indexOf("const runnerChangedDuringSave =");
  assert.ok(capture >= 0 && raceCheck > capture, "token capture should precede the race check");
  // Every token bump between the snapshot and the check must re-baseline, or
  // the guard fires on this save's own work.
  const between = save.slice(capture, raceCheck);
  for (const [, runner] of between.matchAll(/(demo|live|assisted)Token\.current \+= 1;/g)) {
    const bump = between.indexOf(`${runner}Token.current += 1;`);
    const after = between.slice(bump, bump + 700);
    assert.match(
      after,
      new RegExp(`runnerTokensAtStart\.${runner} = ${runner}Token\.current;`),
      `${runner} token is bumped before the race check without re-baselining`,
    );
  }
  // And the guard still catches a genuine outside change.
  assert.match(save, /const runnerChangedDuringSave = demoToken\.current !== runnerTokensAtStart\.demo/);
  // A real block names what is holding it, rather than "another runner".
  assert.match(boothSource, /case "different-runner": return conflictingRunnerDetail \?\? "another live or demo runner is active";/);
  assert.match(boothSource, /const conflictingRunnerDetail = runnerChangedDuringSave \?/);
});

test("Apply outranks anything that is not already making a sound", () => {
  const save = boothSource.match(/const saveTransitionPreview = async \(\)[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(save, "saveTransitionPreview source should be readable");
  // An armed runtime has not touched the output. Whether its outgoing tune is
  // the one currently playing says nothing about audibility, and requiring it
  // to be idle meant a hand-driven Apply could never replace an armed watcher.
  assert.match(save, /if \(staleRuntime && !staleRuntime\.busy && staleRuntime\.stage === "primary"\) \{/);
  assert.doesNotMatch(save, /staleOutgoingLive/);
  // The auto-DJ set merely being switched on, and the runner hunting for a
  // track or waiting on a deck, are silent states. Blocking on them meant no
  // Apply could land during a live set at all.
  const blocker = save.match(/const conflictingRunnerActive = [\s\S]*?;\n/)?.[0] ?? "";
  assert.ok(blocker, "the runner conflict test should be readable");
  assert.doesNotMatch(blocker, /liveRunning\.current/);
  assert.doesNotMatch(blocker, /finding|waiting-deck/);
  // What still refuses: a swap already underway, a demo playing another pair,
  // and a runner that genuinely started while the save was in flight.
  assert.match(blocker, /assistedOverlapUnderway/);
  // 26 Aug 2026: runner FLAGS with no runtime behind them are a ghost (a
  // completed transition or a restored session leaves them set) and blocked
  // Apply while the booth sat silent — a refusing runner must hold an actual
  // demoRuntime. A demo genuinely playing another pair always has one.
  assert.match(blocker, /demoModeCurrent\.current === "running" && demoRuntime\.current !== null && !runtimeMatchesPreview/);
  assert.match(blocker, /runnerChangedDuringSave/);
  // And the started-swap guards in the decision itself are untouched.
  assert.match(previewSource, /if \(input\.runtimeState === "matching-started"\) return \{ action: "blocked", reason: "live-transition-started" \};/);
});

test("a launch that never reached its runtime cannot strand every deck", () => {
  const guard = boothSource.match(/const deckRecycleBlockReason = \(id: DeckId\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(guard, "deck recycle guard should be readable");
  // The launch path sets assistedPlaying while clearing the runtime, so
  // "playing with no runtime" is a state the booth creates itself. Treating it
  // as an armed sequence blocked Load on every deck with nothing still running
  // that could ever release them, and openLocalFile returns silently — so the
  // button simply did nothing.
  assert.match(guard, /const runtime = demoRuntime\.current;\n(?:\s*\/\/[^\n]*\n)*\s*if \(!runtime\) return null;/);
  assert.doesNotMatch(guard, /if \(!runtime\) return `Deck \$\{id\} is still armed/);
  // The transport check still stands: a deck making sound is never replaced.
  assert.match(guard, /if \(decksCurrent\.current\[id\]\.playing \|\| activeAudio\(id\) && !activeAudio\(id\)!\.paused\) \{/);
  // And a real plan still protects its own decks.
  assert.match(guard, /const remainsArmed = runtime\.prepared\.plan\.tracks/);
  assert.match(guard, /if \(!remainsArmed\) return null;/);
  // The state really is constructed by the launch path — if that ever changes,
  // this test should be revisited rather than silently kept.
  assert.match(boothSource, /demoRuntime\.current = null;\n    assistedPlaying\.current = true;/);
});

// ---------------------------------------------------------------------------
// Beat-anchored windows (DJ, 29 Aug 2026): one marked edge + a beat count
// places the other edge, walked on the tune's own grid.
const { deriveTransitionPreviewWindow } = await import("../lib/transition-preview.ts");

const steadyGrid = (count, spacing = .5, origin = 10) =>
  Array.from({ length: count }, (_, index) => ({ time: origin + index * spacing }));

test("anchor at start: the finish lands exactly windowBeats grid steps later", () => {
  const beats = steadyGrid(200);
  const derived = deriveTransitionPreviewWindow({ beats, anchorEdge: "start", anchorTime: 20, windowBeats: 32 });
  assert.equal(derived.ok, true);
  assert.equal(derived.window.start, 20);
  assert.equal(derived.window.end, 36); // 32 beats at .5s
  assert.equal(derived.anchorTime, 20);
  assert.equal(derived.derivedTime, 36);
});

test("anchor at finish: the start is walked backwards on the grid", () => {
  const beats = steadyGrid(200);
  const derived = deriveTransitionPreviewWindow({ beats, anchorEdge: "end", anchorTime: 60, windowBeats: 64 });
  assert.equal(derived.ok, true);
  assert.equal(derived.window.end, 60);
  assert.equal(derived.window.start, 28);
});

test("a sagging grid keeps its true beat count rather than a nominal BPM", () => {
  // 64 tight beats then 64 stretched ones: seconds differ, beats do not.
  const beats = [];
  let time = 0;
  for (let index = 0; index < 64; index += 1) { beats.push({ time }); time += .4; }
  for (let index = 0; index < 64; index += 1) { beats.push({ time }); time += .6; }
  const derived = deriveTransitionPreviewWindow({ beats, anchorEdge: "start", anchorTime: 0, windowBeats: 96 });
  assert.equal(derived.ok, true);
  // 64 beats at .4 + 32 at .6 — walked, not multiplied.
  assert.ok(Math.abs(derived.window.end - (64 * .4 + 32 * .6)) < 1e-9);
});

test("the incoming start prefers the beat's measured attack — the kick", () => {
  const beats = steadyGrid(200).map((beat, index) => index === 20 ? { ...beat, attackTime: beat.time + .04 } : beat);
  const derived = deriveTransitionPreviewWindow({ beats, anchorEdge: "end", anchorTime: beats[52].time, windowBeats: 32, startPrefersAttack: true });
  assert.equal(derived.ok, true);
  assert.equal(derived.landedOnAttack, true);
  assert.equal(derived.window.start, beats[20].time + .04);
});

test("an attack stamp far from its line is measuring something else and is refused", () => {
  const beats = steadyGrid(200).map((beat, index) => index === 20 ? { ...beat, attackTime: beat.time + .4 } : beat);
  const derived = deriveTransitionPreviewWindow({ beats, anchorEdge: "end", anchorTime: beats[52].time, windowBeats: 32, startPrefersAttack: true });
  assert.equal(derived.ok, true);
  assert.equal(derived.landedOnAttack, false);
  assert.equal(derived.window.start, beats[20].time);
});

test("a window that runs off either end of the tune is refused, not clamped", () => {
  const beats = steadyGrid(100);
  const offFront = deriveTransitionPreviewWindow({ beats, anchorEdge: "end", anchorTime: beats[10].time, windowBeats: 32 });
  assert.equal(offFront.ok, false);
  const offBack = deriveTransitionPreviewWindow({ beats, anchorEdge: "start", anchorTime: beats[90].time, windowBeats: 32 });
  assert.equal(offBack.ok, false);
});

test("the booth marks one edge and derives the other — no manual second edge", () => {
  assert.ok(boothSource.includes("deriveTransitionPreviewWindowFor"), "booth uses the derivation");
  assert.ok(!boothSource.includes('disabled={window.start === null} onPointerDown={(event) => markTransitionPreviewWindowFromPointer(event, role, "end")}'), "the finish button no longer waits for a start");
  assert.ok(boothSource.includes("advanceTransitionPreviewSelection"), "advancing is explicit, not automatic on mark");
});

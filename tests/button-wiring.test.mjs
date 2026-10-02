import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const djSource = await readFile(new URL("../app/dj/dj-booth.tsx", import.meta.url), "utf8");
const iconSource = await readFile(new URL("../app/dj/transport-icons.tsx", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const crowdSource = await readFile(new URL("../app/crowd/crowd-room.tsx", import.meta.url), "utf8");

test("every visible DJ Load action opens the native file picker", () => {
  assert.match(djSource, /const openLocalFile = \(id: DeckId\) => \{[\s\S]*?fileInput\.current\?\.click\(\);/);
  assert.match(djSource, /onClick=\{\(\) => openLocalFile\(workflowDeck\)\}/);
  assert.doesNotMatch(djSource, /<button onClick=\{onLoad\}>LOAD<\/button>/);
  assert.doesNotMatch(djSource, /className="inline-unload"/);
  assert.match(djSource, /<input ref=\{fileInput\} type="file" hidden accept=/);
  assert.doesNotMatch(djSource, /onClick=\{\(\) => openTrackPicker\(workflowDeck\)\}/);
  assert.doesNotMatch(djSource, /onLoad=\{\(\) => openTrackPicker\(id\)\}/);
});

test("the library picker prevents duplicate loads and reports its busy state", () => {
  assert.match(djSource, /if \(pickerLoadingTrackId\) return;/);
  assert.match(djSource, /disabled=\{Boolean\(pickerLoadingTrackId\)\}/);
  assert.match(djSource, /pickerLoadingTrackId === track\.id \? "LOADING…"/);
});

test("focused controls retain native activation while configured bass keys remain available", () => {
  assert.ok(djSource.includes('if (typing) return;'));
  assert.ok(djSource.includes('if (!action.startsWith("bass:") && target?.closest'));
  assert.ok(djSource.includes('Object.entries(hotkeysCurrent.current)'));
  assert.ok(djSource.includes('if (event.repeat) return;'));
});
test("manual window endpoints are readouts, not fake buttons", () => {
  assert.match(djSource, /className="manual-loop-marker active">RUN-UP · START/);
  assert.match(djSource, /className="manual-loop-marker active">SHARED · END/);
  assert.doesNotMatch(djSource, /<button className="active">RUN-UP · START/);
});

test("transition preview uses private players and its independent preview-monitor bus", () => {
  const openPreviewSource = djSource.match(/const openTransitionPreview = \(\) => \{[\s\S]*?(?=  const closeTransitionPreview)/)?.[0] ?? "";
  const closePreviewSource = djSource.match(/const closeTransitionPreview = \(\) => \{[\s\S]*?(?=  const seekTransitionPreview)/)?.[0] ?? "";
  const playMixSource = djSource.match(/const playTransitionPreviewMix = async \([^\n]*\) => \{[\s\S]*?(?=  const readDeckMeter)/)?.[0] ?? "";
  assert.match(djSource, />PREVIEW<small>/);
  assert.match(djSource, /previewMonitorMaster\.current = audioContext\.createGain\(\)/);
  assert.match(djSource, /output\.connect\(previewMonitorOutput\)/);
  assert.doesNotMatch(djSource, /output\.connect\((?:cueMonitorOutput|localMaster|remoteMaster|crowdMaster)/);
  assert.doesNotMatch(djSource, /Preview has its own local monitor bus; no preview node is connected to booth master or crowd master/);
  assert.match(djSource, /previewMonitor \? "PREVIEW MONITOR ON" : "PREVIEW MONITOR OFF"/);
  assert.match(djSource, /previewMonitor \? "PREVIEW AUDIO ONLY" : "BOOTH MONITOR MIX"/);
  assert.match(djSource, /boothRoutingLevels\(decksCurrent\.current, DECK_IDS, headphoneMonitorCurrent\.current, previewMonitorCurrent\.current\)/);
  assert.match(djSource, /const toggleTransitionPreviewMonitor = \(\) =>/);
  assert.ok(playMixSource.indexOf("setPreviewMonitorRouting(true)") < playMixSource.indexOf("prepareTransitionPreviewAudio"), "Preview Mix should open its private monitor before decoder startup");
  assert.match(djSource, /AUTO-OPENS PREVIEW MONITOR/);
  assert.match(closePreviewSource, /setPreviewMonitorRouting\(false\)/);
  assert.match(djSource, /loopGate\.connect\(remoteMaster\)/);
  assert.doesNotMatch(djSource, /SAME FILES · SEPARATE PLAYHEADS/);
  assert.match(djSource, /preload="none"/);
  assert.doesNotMatch(djSource, /ref=\{audioRef\}[\s\S]{0,100}src=\{track\.audio\}/);
  assert.match(djSource, /audio\.src = track\.audio/);
  assert.match(djSource, /audio\.removeAttribute\("src"\)/);
  assert.match(djSource, /same flow as the second Mix In point/i);
  // 29 Aug 2026: marking a window no longer auto-opens the mix editor - the
  // DJ tries overlap lengths first and advances explicitly (USE THIS MIX IN).
  assert.match(djSource, /const advanceTransitionPreviewSelection = \(role: TransitionPreviewRole\) =>/);
  assert.match(djSource, /advanceTransitionPreviewSelection\(role\)/);
  assert.match(djSource, /const configurationOpen = transitionPreviewCanCommit\(outgoingWindow, incomingWindow, beats\)/);
  assert.match(djSource, /Saved mix windows loaded into the private sandbox/);
  assert.match(djSource, /selectionRole:\s*TransitionPreviewRole \| null/);
  assert.match(djSource, /PINNED MIX OUT WINDOW/);
  assert.match(djSource, /PINNED MIX IN WINDOW/);
  assert.doesNotMatch(djSource, /EXACT OVERLAP WINDOWS/);
  assert.match(djSource, /transitionPreviewWindowPanel\("outgoing"\)/);
  assert.match(djSource, /transitionPreviewWindowPanel\("incoming", true\)/);
  assert.match(djSource, /scope=\{`preview-\$\{role\}`\}/);
  assert.match(djSource, /TRANSITION_PREVIEW_LEAD_BEATS/);
  assert.match(djSource, /cueHistory: \[\.\.\.current\.cueHistory/);
  assert.doesNotMatch(djSource, /isolatedDecks/);
  assert.doesNotMatch(djSource, /transitionPreviewCueSnapshot/);
  assert.doesNotMatch(openPreviewSource, /setHeadphoneMonitor|applyRouting|cue:\s*false/);
  assert.doesNotMatch(closePreviewSource, /setHeadphoneMonitor|applyRouting|cue:/);
});

test("an idle booth always configures Deck A to Deck B first", () => {
  const pairSource = djSource.match(/const transitionPreviewPair = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/)?.[0] ?? "";
  assert.match(pairSource, /const playingDeck = DECK_IDS\.find\(\(id\) => decks\[id\]\.playing\)/);
  assert.match(pairSource, /selectTransitionPreviewPair\(\{/);
  assert.match(pairSource, /idlePair: pair\("A", "B"\)/);
  assert.match(pairSource, /playingNextPair: previewPlayingDeck \? pair\(previewPlayingDeck, nextAssistedDeck\(previewPlayingDeck\)\) : null/);
});

test("moving wave focus has a separate magenta zoom pair", () => {
  assert.match(djSource, /className="wave-focus-window-zoom"/);
  assert.match(djSource, /moving waveform zoom out/);
  assert.match(djSource, /moving waveform zoom in/);
  assert.match(djSource, /onFocusWindowChange\(Math\.min\(64, focusWindowSeconds \* 2\)\)/);
  assert.match(djSource, /onFocusWindowChange\(Math\.max\(2, focusWindowSeconds \/ 2\)\)/);
});

test("moving wave reports current BPM and its signed tempo adjustment", () => {
  assert.match(djSource, /const playheadTime = resolvedTrackTime;/);
  assert.match(djSource, /const effectiveTempoRate = deck\.playing && audio && !audio\.paused \? audio\.playbackRate : deck\.tempoRate/);
  assert.match(djSource, /resolvedBpmAt\(analysis, playheadTime\) \* effectiveTempoRate/);
  assert.match(djSource, /const tempoAdjustmentPercent = \(effectiveTempoRate - 1\) \* 100/);
  assert.match(djSource, /focus-wave-tempo-adjustment/);
  assert.equal((djSource.match(/className="focus-wave-tempo-adjustment" x="90"/g) ?? []).length, 4);
  assert.doesNotMatch(djSource, /className="focus-wave-tempo-adjustment" x="64"/);
});

test("play and play-cue controls use their shared transport icons", () => {
  assert.match(iconSource, /export function PlayTransportIcon\(\)/);
  assert.match(iconSource, /export function PauseTransportIcon\(\)/);
  assert.match(iconSource, /export function PlayCueTransportIcon\(\)/);
  assert.match(djSource, /aria-label=\{deck\.playing \? `Pause Deck \$\{id\}` : `Play Deck \$\{id\}`\}/);
  assert.match(djSource, /deck\.playing \? <PauseTransportIcon \/> : <PlayTransportIcon \/>/);
  assert.match(djSource, /Hold to play the \$\{role === "outgoing" \? "Mix Out" : "Mix In"\} preview cue/);
  assert.doesNotMatch(djSource, />PLAY CUE<small>/);
});

test("loop toggles use the framed two-arrow loop icon", () => {
  assert.match(iconSource, /export function LoopTransportIcon\(\)/);
  assert.match(djSource, /aria-label=\{`Toggle Deck \$\{id\} loop`\}/);
  assert.match(djSource, /aria-pressed=\{deck\.loopActive\}/);
  assert.doesNotMatch(djSource, /<b>LOOP<\/b>/);
});

test("focused deck labels replace the tiny duplicate metadata", () => {
  assert.match(djSource, /focusWaveTrackLabel\(deck\.track\)/);
  assert.match(djSource, /className="focus-wave-artist"/);
  assert.match(djSource, /className="focus-wave-title"/);
  assert.doesNotMatch(djSource, /className="wave-track-name"/);
  assert.doesNotMatch(djSource, /\{deck\.loopActive && <small>\{deck\.loopSize\} BEATS/);
  assert.match(globalCssSource, /\.focus-wave-watermark-svg \.focus-wave-artist\{font-size:38px/);
});

test("compact controls use solid glyphs inside CDJ bezels", () => {
  for (const icon of ["ZoomOutIcon", "ZoomInIcon", "HeadphoneIcon", "PitchDownIcon", "PitchUpIcon"]) {
    assert.match(iconSource, new RegExp(`export function ${icon}\\(\\)`));
  }
  assert.match(djSource, /className="cdj-icon-bezel"/);
  assert.doesNotMatch(djSource, /🎧/);
  assert.match(globalCssSource, /\.cdj-icon-bezel\{[^}]*border-radius:50%/);
});

test("pitch holds use pointer capture, an eight-beat curve, and paused scrub", () => {
  assert.match(djSource, /pitchHoldDurationMs\(sourceBpm, baseRate\)/);
  assert.match(djSource, /pitchHoldPlaybackRate\(direction, session\.latestUnderlyingRate/);
  assert.match(djSource, /pitchScrubTarget\(session\.startTime, direction/);
  assert.match(djSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(djSource, /onLostPointerCapture=\{\(\) => onBend\(0\)\}/);
  assert.doesNotMatch(djSource, /bendTimers/);
});

test("pitch bends and sync controls sit above overall-wave zoom with magenta and jade groups", () => {
  const transportSource = djSource.match(/function FocusWaveTransport[\s\S]*?(?=\nfunction EqDial)/)?.[0] ?? "";
  assert.ok(transportSource.indexOf('className="wave-relocated-sync"') < transportSource.indexOf('className="wave-tempo-overview-zoom"'));
  assert.match(transportSource, /className="wave-pitch-hold wave-pitch-down"/);
  assert.match(transportSource, /className="wave-sync-action wave-sync-tempo"/);
  assert.match(globalCssSource, /wave-relocated-sync \.wave-pitch-hold\{[^}]*#ff4f98/);
  assert.match(globalCssSource, /wave-relocated-sync \.wave-sync-action\{[^}]*#4cf2b4/);
});

test("manual EQ claims bands without stopping transition timing", () => {
  const manualSource = djSource.match(/const changeDeckFromBooth = \(id: DeckId, patch: Partial<DeckState>\) => \{[\s\S]*?(?=  const cueUndoSnapshot)/)?.[0] ?? "";
  assert.match(manualSource, /claimTransitionManualEq/);
  assert.doesNotMatch(manualSource, /clearInterval|\.pause\(|assistedPlaying\.current = false|runtime\.stage/);
  assert.match(djSource, /changeDeckWithAutomatedEq\(runtime, outgoing\.deck/);
  assert.match(djSource, /changeDeckWithAutomatedEq\(runtime, incoming\.deck/);
  assert.match(djSource, /onChange=\{\(patch\) => changeDeckFromBooth\(id, patch\)\}/);
});

test("audience reactions support keyboard click activation and connection controls are guarded", () => {
  assert.match(crowdSource, /onClick=\{\(\) => void react\(emoji\)\}/);
  assert.doesNotMatch(crowdSource, /onPointerUp=\{\(\) => void react\(emoji\)\}/);
  assert.match(crowdSource, /disabled=\{!clientId\}/);
  assert.match(crowdSource, /disabled=\{!clientId \|\| listening === "connecting"\}/);
  assert.match(crowdSource, /Ⅱ PAUSE MASTER OUT/);
  assert.match(crowdSource, /audio\?\.srcObject && peerRef\.current\?\.connectionState === "connected"/);
  assert.match(crowdSource, /audio\.srcObject = null/);
});

test("iPhone crowd audio is unlocked by the listen tap and has a Web Audio fallback", () => {
  assert.match(crowdSource, /const audioUnlock = primeCrowdPlayback\(\)\.catch\(\(\) => null\)/);
  assert.match(crowdSource, /context\.createMediaStreamSource\(stream\)/);
  assert.match(crowdSource, /source\.connect\(context\.destination\)/);
  assert.match(crowdSource, /audio\.defaultMuted = false/);
  assert.match(crowdSource, /audio\.muted = false/);
  assert.match(crowdSource, /void playReceivedAudio\(stream\)/);
  assert.doesNotMatch(crowdSource, /Samsung Chrome needs one more tap/);
});

test("audience copy uses a current-page fallback and confirms the result", () => {
  assert.match(crowdSource, /const target = shareUrl \|\| window\.location\.href;/);
  assert.match(crowdSource, /copyState === "copied" \? "COPIED ✓"/);
});

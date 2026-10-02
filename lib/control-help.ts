export const CONTROL_HELP_STORAGE_KEY = "loud-control-help-v1";
export const CONTROL_HELP_DELAY_MS = 1350;
export type HelpPreferences = { enabled: boolean; dismissed: string[] };
export function parseHelpPreferences(raw: string | null): HelpPreferences {
  try { const value = JSON.parse(raw ?? "null"); return { enabled: value?.enabled !== false, dismissed: Array.isArray(value?.dismissed) ? [...new Set<string>(value.dismissed.filter((id: unknown): id is string => typeof id === "string"))] : [] }; }
  catch { return { enabled: true, dismissed: [] }; }
}
export function dismissControlHelp(prefs: HelpPreferences, id: string): HelpPreferences { return { ...prefs, dismissed: [...new Set([...prefs.dismissed, id])] }; }
export type ControlHelp = { id: string; heading: string; body: string };
export function describeControl(input: { label: string; title: string; classes: string; context: string; preview: boolean }): ControlHelp {
  const { label, title, classes, context, preview } = input;
  const text = label + " " + title;
  const tip = (id: string, heading: string, body: string): ControlHelp => ({ id: (preview ? "preview:" : "booth:") + id, heading, body });
  if (classes.includes("wave-return-cue")) return tip("return-cue", "Return to cue", "Immediately return to the exact position where you last pressed regular Play, and pause. Your tempo and EQ settings stay unchanged.");
  if (classes.includes("wave-play-cue")) return tip("play-cue", "Playcue", "While playing, jump back to your last regular Play start and keep playing. With Snap to Grid on and another deck playing, align the jump to its beat phase. While paused, hold to audition and release to return. Tempo stays unchanged.");
  if (classes.includes("transition-preview-play-cue")) return tip("play-cue", "Private Playcue", "Hold to audition this private cue. Release to pause and return to the cue. This player is separate from the live deck.");
  if (classes.includes("wave-play-toggle")) return tip("play", "Play / pause", "Start or pause this deck. Starting from a paused position saves that exact position for Return to Cue and Playcue. " + title);
  if (/Low EQ/i.test(label)) return tip("low", "Bass / low EQ", "Turn down or boost the low frequencies. Fully down kills the bass. Right-click resets to 0 dB. " + title);
  if (/(Mid|High) EQ/i.test(label)) return tip(label.startsWith("Mid") ? "mid" : "high", label.startsWith("Mid") ? "Mid EQ" : "High EQ", "Adjust this frequency band from cut to boost. 0 dB is neutral; right-click resets it. The live spectrum reflects your EQ changes.");
  if (/Channel volume/i.test(label)) return tip("volume", "Deck volume", "Set this deck's output level. Right-click restores the usual 85% level.");
  if (/Master output/i.test(label) || classes.includes("booth-master-volume")) return tip("master", "Master volume", "Adjust the overall booth output level, including the crowd stream.");
  if (/decrease BPM|increase BPM/i.test(label)) return tip("fine-tempo", "Fine tempo adjustment", "Each new press adjusts tempo by 0.001 BPM. Hold to increase the adjustment gradually; releasing resets the next press to 0.001 BPM.");
  if (/Hold to slow|Hold to speed/i.test(label)) return tip("pitch", "Temporary pitch bend", preview ? "Hold to slow or speed up this private player for alignment. Release to restore its underlying tempo; live decks stay unchanged." : "While playing, hold to slow or speed up the deck temporarily; release restores its underlying tempo. While paused, hold to scrub backward or forward with increasing speed.");
  if (/SYNC TEMPO/.test(label)) return tip("sync-tempo", "Sync tempo", "Match this deck's effective BPM to the reference deck. This changes playback speed; use Sync Beat to adjust beat alignment.");
  if (/SYNC BEAT/.test(label)) return tip("sync-beat", "Sync beat", "Move the playhead toward the reference deck's beat alignment using the available grids. This does not set the playback speed.");
  if (/headphone cue/i.test(label)) return tip("headphone", "Deck headphone cue", "Toggle this deck in the local headphone cue mix. The audience's master feed is separate. " + title);
  if (/PREVIEW MONITOR/.test(label) && classes.includes("preview-monitor-toggle")) return tip("monitor", "Private preview monitor", "Listen to the private players locally. With separate DJ outputs, Preview replaces only the headphones; house master and recording continue. With a shared output, it replaces local listening. Returning to the booth restores deck cues.");
  if (/CUE MONITOR/.test(label)) return tip("cue-monitor", "Cue monitor", "With separate DJ outputs this switch is disabled: deck cue buttons feed headphones directly and master stays on its assigned outputs. With a shared output, switch local listening between master and cue.");
  if (/zoom (out|in)/i.test(text)) return tip(/out/i.test(label) ? "zoom-out" : "zoom-in", /out/i.test(label) ? "Zoom out" : "Zoom in", (/out/i.test(label) ? "Show a longer stretch" : "Inspect a shorter stretch") + " of the waveform. Zoom changes the view, not playback or cue positions.");
  if (/Toggle Deck . loop/.test(label)) return tip("loop", "Loop on / off", "Repeat the selected beat-length section. Toggle again to continue beyond the loop.");
  if (/Set Deck . loop to/.test(label)) return tip("loop-size", "Loop length", "Choose the number of beats in the loop. If a loop is active, its boundaries update to the selected length.");
  if (/Halve|Double/.test(label)) return tip("loop-resize", "Resize loop", "Halve or double the current loop's beat count.");
  if (/Move Deck . loop/.test(label)) return tip("loop-move", "Move loop", "Shift the loop backward or forward on the beat grid while retaining its selected length. " + title);
  if (/overall waveform|overview waveform/i.test(label)) return tip("overview", "Track overview", "Click to seek within the whole track. Right-drag pans a zoomed overview. Snap to Grid controls beat snapping.");
  if (/Autoselect/.test(label)) return tip("autoselect", "Autoselect â€” coming soon", "Automatic track selection is not available yet. Use Load to choose a tune.");
  if (/Load/.test(label)) return tip("load", "Load a tune", "Choose an audio file for the selected deck. Select A, B or C in Track Flow first to choose the destination.");
  if (classes.includes("workflow-deck")) return tip("deck-select", "Select deck", "Choose the deck used by the Load and track-flow controls. Selecting a deck does not start or stop it.");
  if (/LOUDLINK/.test(label)) return tip("loudlink", "Loudlink", "Open the audience page so listeners can connect to the set. The QR button provides the phone link.");
  if (/QR/.test(text)) return tip("qr", "Audience QR code", "Enlarge the QR code so listeners can scan it and open Loudlink on their phones.");
  if (/RECORD INPUTS|STOP/.test(label) && context.includes("workflow-booth-tools")) return tip("record", "Record inputs", "Record audio and booth actions as a set. Press again to stop and save the recording.");
  if (/REPLAY INPUTS/.test(label)) return tip("replay", "Replay inputs", "Browse saved sets and replay their recorded deck actions.");
  if (/SNAP TO GRID/.test(label)) return tip("snap", "Snap to Grid", "Make waveform seeks and drags land on beats. During playback, Playcue also aligns its cue jump to another playing deck's beat phase.");
  if (/PRIVATE PREVIEW/.test(label)) return tip("private-preview", "Private Preview", "Prepare and audition the next transition using independent players, then apply its confirmed windows and automation to the live tracks.");
  if (/Open Loud settings/.test(label)) return tip("settings", "LOUD menu", "Open the booth settings, visual themes, master level and explanation-bubble preferences.");
  if (classes.includes("transition-preview-set-start")) return tip("start", "Mark window start", "Anchor this window's start at the private playhead. The selected beat count places the other end. This does not seek the live deck.");
  if (classes.includes("transition-preview-set-finish")) return tip("finish", "Mark window finish", "Anchor this window's finish at the private playhead. The selected beat count places the start. Confirm the exact boundaries by ear.");
  if (context.includes("transition-preview-beats")) return tip("overlap-length", "Overlap beat count", "Set the number of beats in the transition window. Your anchored edge stays fixed; the free edge is placed using this count. Confirmed windows teach the local tempo.");
  if (classes.includes("transition-preview-grid-override")) return tip("grid-override", "Grid override", "Turn snapping off to place the private playhead on a kick by ear. Press the confirmation again to realign the grid to that position.");
  if (classes.includes("transition-preview-selection-next")) return tip("use-window", "Use this window", "Accept the marked window and move to the next setup step. Complete Mix Out and Mix In to open the automation editor.");
  if (/Point [XYZ] (incoming|outgoing) percent/.test(label)) return tip("automation-level", "Overlap EQ level", "Set the incoming or outgoing mid/high EQ level at this X, Y or Z point. The transition interpolates between these values.");
  if (classes.includes("transition-preview-play-mix")) return tip("play-mix", "Audition the transition", "Play the prepared overlap on the private monitor, including its tempo alignment and bass/EQ automation. Press again to pause the audition.");
  if (classes.includes("transition-preview-save")) return tip("apply", "Apply to live tracks", "Save the exact confirmed windows and automation to the live tracks. Applying does not seek or pause the live players.");
  if (/REPLICATE|CLEAR Ã—/.test(label)) return tip("replicate", "Replicate selection", "Right-select a beat block in a window, then repeat it to match extra beats in the other tune. Clear removes the edit. Replicated audio can currently be auditioned in Preview only; applying it to live decks is not yet supported.");
  if (/EDIT MIX/.test(label)) return tip("edit-window", "Edit window", "Return to this private window's start and finish selection.");
  if (/UNDO CUE/.test(label)) return tip("undo", "Undo cue", "Restore the previous private cue selection.");
  if (/RESET CUES/.test(label)) return tip("reset", "Reset private cues", "Clear the private window selections so you can choose them again.");
  if (/RETURN TO BOOTH/.test(label)) return tip("return", "Return to booth", "Close Private Preview and stop its private players. The live decks retain their transport and cue states.");
  if (preview && /Play|Pause/.test(label)) return tip("play", "Private play / pause", "Start or pause this independent preview player through the local preview monitor. The live deck playhead stays unchanged.");
  const clean = label.replace(/\s+/g," ").trim() || title || "Control";
  return tip(clean.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,100), clean, title || "Use this control to " + clean.toLowerCase() + ".");
}

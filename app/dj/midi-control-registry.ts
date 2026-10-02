import type { MidiTargetDefinition } from "../../lib/midi-mapping";
import type { DeckId } from "./dj-types";

const decks: readonly DeckId[] = ["A", "B", "C"];

const target = (
  id: string,
  label: string,
  kind: MidiTargetDefinition["kind"],
  preferredMode: MidiTargetDefinition["preferredMode"],
  range: Pick<MidiTargetDefinition, "minimum" | "maximum"> = {},
): MidiTargetDefinition => ({ id, label, kind, preferredMode, ...range });

export const MIDI_PROFILE_STORAGE_KEY = "crowd2-midi-profiles-v1";

export const MIDI_TARGET_DEFINITIONS: readonly MidiTargetDefinition[] = [
  target("master-volume", "Master volume", "continuous", "absolute"),
  target("headphone-monitor", "Headphone monitor mode", "toggle", "toggle"),
  ...decks.flatMap((deck) => [
    target(`deck-${deck}-play`, `Deck ${deck} play / pause`, "toggle", "toggle"),
    target(`deck-${deck}-play-cue`, `Deck ${deck} play cue`, "button", "momentary"),
    target(`deck-${deck}-loop-toggle`, `Deck ${deck} loop`, "toggle", "toggle"),
    target(`deck-${deck}-loop-size-down`, `Deck ${deck} smaller loop`, "button", "momentary"),
    target(`deck-${deck}-loop-size-up`, `Deck ${deck} larger loop`, "button", "momentary"),
    target(`deck-${deck}-mark-run-up`, `Deck ${deck} mark run-up point`, "button", "momentary"),
    target(`deck-${deck}-undo-last-cue`, `Deck ${deck} undo last cue`, "button", "momentary"),
    target(`deck-${deck}-loop-back`, `Deck ${deck} move loop back`, "button", "momentary"),
    target(`deck-${deck}-loop-forward`, `Deck ${deck} move loop forward`, "button", "momentary"),
    target(`deck-${deck}-bass-kill`, `Deck ${deck} bass kill`, "toggle", "toggle"),
    target(`deck-${deck}-headphone-cue`, `Deck ${deck} headphone cue`, "toggle", "toggle"),
    target(`deck-${deck}-low`, `Deck ${deck} low EQ`, "continuous", "absolute", { minimum: -60, maximum: 12 }),
    target(`deck-${deck}-mid`, `Deck ${deck} mid EQ`, "continuous", "absolute", { minimum: -60, maximum: 12 }),
    target(`deck-${deck}-high`, `Deck ${deck} high EQ`, "continuous", "absolute", { minimum: -60, maximum: 12 }),
    target(`deck-${deck}-volume`, `Deck ${deck} channel volume`, "continuous", "absolute"),
    target(`deck-${deck}-fx-wet`, `Deck ${deck} FX wet`, "continuous", "absolute"),
    target(`deck-${deck}-pitch-down`, `Deck ${deck} pitch bend down`, "button", "momentary"),
    target(`deck-${deck}-pitch-up`, `Deck ${deck} pitch bend up`, "button", "momentary"),
    target(`deck-${deck}-sync-tempo`, `Deck ${deck} sync tempo`, "button", "momentary"),
    target(`deck-${deck}-sync-beat`, `Deck ${deck} sync beat`, "button", "momentary"),
  ]),
];

import type { DeckId, PhaseStatus } from "./dj-types";

export const DECK_IDS: readonly DeckId[] = ["A", "B", "C"];
export const AUTOMATION_DECK_IDS = ["A", "B"] as const;
export const LOOP_SIZES: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];
export const BOOTH_VISUAL_FRAME_MS = 66;
export const BOOTH_WAVEFORM_SAMPLE_LIMIT = 720;
export const BOOTH_METER_FFT_SIZE = 512;

export const PHASE_COLOURS: Record<PhaseStatus, string> = {
  ahead: "#ff5a67",
  behind: "#55a7ff",
  synced: "#4cf2b4",
  uncompared: "#6d7873",
};

export const FOCUS_WAVE_COLOURS: Record<DeckId, { wave: string; label: string; overlap: string }> = {
  A: { wave: "#55a7ff", label: "#d9ff54", overlap: "#4cf2b4" },
  B: { wave: "#d9ff54", label: "#ff5a67", overlap: "#ff9f43" },
  C: { wave: "#ff5a67", label: "#55a7ff", overlap: "#ab7dff" },
};

// Keep waveform colours here so visual tuning never requires touching audio logic.
export const TEMPO_COLOURS = [
  "#4cf2b4",
  "#55a7ff",
  "#ab7dff",
  "#ff9f43",
  "#74d6c0",
  "#d9ff54",
] as const;

export const DECK_RESET_REVISION = "2026-07-23-stopped-server-recovery";

export const BOOTH_VISUAL_DIRECTIONS = [
  {
    id: "specialist",
    shortLabel: "DAW",
    label: "Specialist DAW",
    description: "Graphite instrument surfaces, blue signal light and amber actions.",
  },
  {
    id: "warehouse",
    shortLabel: "RAW",
    label: "Raw warehouse",
    description: "Hard contrast, reduced glow and red performance markings.",
  },
  {
    id: "neon",
    shortLabel: "NEON",
    label: "Crowd neon",
    description: "Personal club colour, deeper violet surfaces and brighter feedback.",
  },
  {
    id: "steel",
    shortLabel: "MACH",
    label: "Machined interface",
    description: "A digitally drawn gunmetal interface with cool instrument light and raised hardware edges.",
  },
  {
    id: "walnut",
    shortLabel: "WARM",
    label: "Warm studio interface",
    description: "A digitally drawn warm studio palette with dark faceplates, cream legends and amber lamps.",
  },
  {
    id: "roadcase",
    shortLabel: "TOUR",
    label: "Touring interface",
    description: "A digitally drawn touring palette with black panels and high-visibility yellow controls.",
  },
  {
    id: "material-steel",
    shortLabel: "STEEL",
    label: "Real brushed steel",
    description: "A literal brushed-steel material map across the solid booth chassis.",
  },
  {
    id: "material-wood",
    shortLabel: "WOOD",
    label: "Real dark walnut",
    description: "Literal dark walnut across the solid chassis, trim and wooden rotary caps.",
  },
  {
    id: "material-iron",
    shortLabel: "IRON",
    label: "Real aged iron",
    description: "A literal corroded iron material map across the solid booth chassis.",
  },
  {
    id: "material-goth",
    shortLabel: "GOTH",
    label: "Goth leather",
    description: "Embossed black leather, oxblood undertones and aged gunmetal hardware.",
  },
  {
    id: "material-industrial",
    shortLabel: "IND",
    label: "Industrial plate",
    description: "Scratched diamond-plate steel with worn safety-yellow hardware.",
  },
  {
    id: "material-synthwave",
    shortLabel: "SYNTH",
    label: "Synthwave laminate",
    description: "Physical midnight lacquer with magenta and cyan foil in the clear coat.",
  },
  {
    id: "material-rave",
    shortLabel: "RAVE",
    label: "Rave resin",
    description: "Tough black molded resin packed with tiny UV-reactive colour chips.",
  },
  {
    id: "material-sunshine",
    shortLabel: "SUN",
    label: "Sunshine enamel",
    description: "Warm golden hammered enamel with engraved rays and pearlescent glints.",
  },
  {
    id: "material-meadow",
    shortLabel: "BEES",
    label: "Grass, flowers & bees",
    description: "Real short grass, tiny wildflowers and honeybees across the solid chassis.",
  },
] as const;

export type BoothVisualDirection = typeof BOOTH_VISUAL_DIRECTIONS[number]["id"];

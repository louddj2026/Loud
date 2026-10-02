import type {
  BoothControlDefinition,
  BoothControlKind,
  BoothModuleDefinition,
  BoothModulePlacement,
} from "../../lib/booth-layout";
import type { DeckId } from "./dj-types";

const decks: readonly DeckId[] = ["A", "B", "C"];

const control = (
  id: string,
  label: string,
  kind: BoothControlKind,
  moduleId: string,
  options: Pick<BoothControlDefinition, "defaultVisible" | "required"> = {},
): BoothControlDefinition => ({ id, label, kind, moduleId, ...options });

const placement = (
  moduleId: string,
  zone: string,
  column: number,
  row: number,
  span: number,
  rowSpan = 1,
): BoothModulePlacement => ({ moduleId, zone, column, row, span, rowSpan });

const moduleDefinition = (
  id: string,
  label: string,
  controlIds: readonly string[],
  defaultPlacement: BoothModulePlacement,
  allowedZones: readonly string[],
  options: Pick<BoothModuleDefinition, "minSpan" | "maxSpan" | "linked"> = {},
): BoothModuleDefinition => ({
  id,
  label,
  controlIds,
  defaultPlacement,
  allowedZones,
  linked: true,
  ...options,
});

export const BOOTH_LAYOUT_STORAGE_KEY = "crowd2-booth-layout-v1";

const deckControls = decks.flatMap((deck) => [
  control(`deck-${deck}-fine-tempo`, `Deck ${deck} fine tempo`, "button", `deck-${deck}-transport`),
  control(`deck-${deck}-play`, `Deck ${deck} play / pause`, "button", `deck-${deck}-transport`),
  control(`deck-${deck}-play-cue`, `Deck ${deck} play cue`, "button", `deck-${deck}-transport`),
  control(`deck-${deck}-loop-toggle`, `Deck ${deck} loop`, "button", `deck-${deck}-loop`),
  control(`deck-${deck}-mark-run-up`, `Deck ${deck} mark run-up`, "button", `deck-${deck}-loop`),
  control(`deck-${deck}-undo-last-cue`, `Deck ${deck} undo last cue`, "button", `deck-${deck}-loop`),
  control(`deck-${deck}-loop-nudge`, `Deck ${deck} move loop`, "button", `deck-${deck}-loop`),
  control(`deck-${deck}-bass-kill`, `Deck ${deck} bass kill`, "button", `deck-${deck}-mixer`),
  control(`deck-${deck}-headphone-cue`, `Deck ${deck} headphone cue`, "button", `deck-${deck}-transport`),
  control(`deck-${deck}-eq`, `Deck ${deck} EQ`, "slider", `deck-${deck}-mixer`),
  control(`deck-${deck}-volume`, `Deck ${deck} channel volume`, "slider", `deck-${deck}-mixer`),
  control(`deck-${deck}-fx`, `Deck ${deck} FX`, "option", `deck-${deck}-mixer`),
  control(`deck-${deck}-overview-zoom`, `Deck ${deck} overall waveform zoom`, "button", `deck-${deck}-overview`),
  control(`deck-${deck}-load`, `Deck ${deck} load / unload`, "button", `deck-${deck}-library`),
  control(`deck-${deck}-pitch-bend`, `Deck ${deck} pitch bend`, "button", `deck-${deck}-library`),
  control(`deck-${deck}-sync`, `Deck ${deck} tempo and beat sync`, "button", `deck-${deck}-library`),
  control(`deck-${deck}-cue-teaching`, `Deck ${deck} cue teaching`, "button", `deck-${deck}-library`),
  control(`deck-${deck}-cue-list`, `Deck ${deck} cue list`, "button", `deck-${deck}-library`),
]);

export const BOOTH_CONTROL_DEFINITIONS: readonly BoothControlDefinition[] = [
  control("layout-mode", "Customise booth", "button", "layout-tools", { required: true }),
  control("midi-setup", "MIDI setup", "button", "layout-tools", { required: true }),
  control("crowd-master-link", "Loudlink", "link", "header-navigation"),
  control("grid-mapper-link", "Grid + mix mapper", "button", "header-navigation"),
  control("moving-wave-zoom", "Moving waveform zoom", "button", "waveform-tools"),
  control("headphone-monitor", "Headphone monitor mode", "button", "headphone-monitor"),
  control("master-volume", "Master volume", "slider", "master"),
  control("assisted-crate", "Assisted crate set", "button", "assisted-workflow"),
  control("automatic-crate", "Automatic crate set", "button", "automatic-workflow"),
  control("library-maintenance", "Library maintenance", "button", "library-workflow"),
  ...deckControls,
];

export const BOOTH_MODULE_DEFINITIONS: readonly BoothModuleDefinition[] = [
  moduleDefinition("layout-tools", "Layout and MIDI", ["layout-mode", "midi-setup"], placement("layout-tools", "header", 8, 0, 2), ["header"], { minSpan: 2 }),
  moduleDefinition("header-navigation", "Navigation", ["crowd-master-link", "grid-mapper-link"], placement("header-navigation", "header", 10, 0, 2), ["header", "workflow"], { minSpan: 2 }),
  moduleDefinition("waveform-tools", "Moving waveform tools", ["moving-wave-zoom"], placement("waveform-tools", "focus-controls", 0, 0, 12), ["focus-controls"], { minSpan: 4 }),
  ...decks.flatMap((deck, index) => [
    moduleDefinition(
      `deck-${deck}-transport`,
      `Deck ${deck} transport`,
      [`deck-${deck}-fine-tempo`, `deck-${deck}-headphone-cue`, `deck-${deck}-play-cue`, `deck-${deck}-play`],
      placement(`deck-${deck}-transport`, "focus-controls", 0, index + 1, 3),
      ["focus-controls", "deck-controls"],
      { minSpan: 2, maxSpan: 6 },
    ),
    moduleDefinition(
      `deck-${deck}-loop`,
      `Deck ${deck} loop and run-up`,
      [`deck-${deck}-loop-toggle`, `deck-${deck}-mark-run-up`, `deck-${deck}-undo-last-cue`, `deck-${deck}-loop-nudge`],
      placement(`deck-${deck}-loop`, "focus-controls", 3, index + 1, 9),
      ["focus-controls", "deck-controls"],
      { minSpan: 5 },
    ),
    moduleDefinition(
      `deck-${deck}-mixer`,
      `Deck ${deck} mixer`,
      [`deck-${deck}-bass-kill`, `deck-${deck}-eq`, `deck-${deck}-volume`, `deck-${deck}-fx`],
      placement(`deck-${deck}-mixer`, "mixer", index * 4, 1, 4, 2),
      ["mixer", "deck-controls"],
      { minSpan: 3, maxSpan: 6 },
    ),
    moduleDefinition(
      `deck-${deck}-overview`,
      `Deck ${deck} overview tools`,
      [`deck-${deck}-overview-zoom`],
      placement(`deck-${deck}-overview`, "overview-controls", index * 4, 0, 4),
      ["overview-controls", "focus-controls"],
      { minSpan: 3, maxSpan: 6 },
    ),
    moduleDefinition(
      `deck-${deck}-library`,
      `Deck ${deck} library and teaching`,
      [`deck-${deck}-load`, `deck-${deck}-pitch-bend`, `deck-${deck}-sync`, `deck-${deck}-cue-teaching`, `deck-${deck}-cue-list`],
      placement(`deck-${deck}-library`, "deck-controls", 0, index, 12),
      ["deck-controls", "focus-controls"],
      { minSpan: 6 },
    ),
  ]),
  moduleDefinition("headphone-monitor", "Headphone monitor", ["headphone-monitor"], placement("headphone-monitor", "mixer", 0, 0, 8), ["mixer", "header"], { minSpan: 3 }),
  moduleDefinition("master", "Master output", ["master-volume"], placement("master", "mixer", 8, 0, 4), ["mixer", "header"], { minSpan: 2, maxSpan: 6 }),
  moduleDefinition("assisted-workflow", "Assisted crate set", ["assisted-crate"], placement("assisted-workflow", "workflow", 0, 0, 12, 2), ["workflow"], { minSpan: 6 }),
  moduleDefinition("automatic-workflow", "Automatic crate set", ["automatic-crate"], placement("automatic-workflow", "workflow", 0, 2, 6), ["workflow"], { minSpan: 4 }),
  moduleDefinition("library-workflow", "Library maintenance", ["library-maintenance"], placement("library-workflow", "workflow", 6, 2, 6), ["workflow"], { minSpan: 4 }),
];

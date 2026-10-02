/** Setup references, not a sales ranking or a hardware certification list. */
export type AudioHardwareProfile = {
  id: string; name: string; category: "soundcard" | "controller-mixer";
  masterPair: number; cuePair: number; documentedPairs: boolean;
  monitoring: "phones" | "mixer"; guidance: string; source: string;
};
const niSource = "https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output";
const ni = (id: string, name: string, category: AudioHardwareProfile["category"], masterPair = 0, cuePair = 2, guidance = "Connect speakers to the main output and headphones to PHONES. Install the manufacturer driver where required."): AudioHardwareProfile => ({ id, name, category, masterPair, cuePair, documentedPairs: true, monitoring: "phones", guidance, source: niSource });
const guide = (id: string, name: string, category: AudioHardwareProfile["category"], monitoring: AudioHardwareProfile["monitoring"], source: string, guidance: string): AudioHardwareProfile => ({ id, name, category, masterPair: 0, cuePair: 2, documentedPairs: false, monitoring, source, guidance });
const mixerGuide = "Select USB as the mixer input. Route Loud master to one mixer channel and cue to a different, headphone-only channel. Keep the cue channel fader DOWN, select its PFL/CUE, and remove master from the headphone blend for Private Preview. Verify the USB pair assignments in the mixer utility. This is Loud internal mixing, not separate deck outputs or DVS.";
const controllerGuide = "Select the named MASTER and PHONES outputs if the driver exposes them separately. Otherwise identify their channel pairs in the manufacturer's audio settings. The pair numbers below are candidates, not a verified USB map. Controller knobs/buttons require a separate MIDI mapping; proprietary HID-only controls are not supported by Web MIDI.";
const legacyGuide = "Legacy interface: first check the manufacturer's operating-system/driver support. An ASIO-only endpoint cannot be selected by the browser. Use two available output pairs with a mixer or headphone amplifier; this profile does not add DVS support.";
const pioneerMixer = (model: string) => guide(model.toLowerCase(), `Pioneer DJ ${model}`, "controller-mixer", "mixer", `https://www.pioneerdj.com/en/product/dj-mixers/${model.toLowerCase()}/`, mixerGuide);
const pioneerController = (model: string) => guide(model.toLowerCase(), `Pioneer DJ ${model}`, "controller-mixer", "phones", `https://www.pioneerdj.com/en/product/dj-controllers/${model.toLowerCase()}/`, controllerGuide);

export const AUDIO_HARDWARE_PROFILES: readonly AudioHardwareProfile[] = [
  ni("ni-audio-6", "Native Instruments Traktor Audio 6", "soundcard", 2, 0, "PHONES shares MAIN 1/2. Reserve 1/2 for headphones and connect the house feed to a different pair, for example 3/4. Do not connect house speakers to MAIN 1/2 in this setup."),
  ni("ni-audio-10", "Native Instruments Traktor Audio 10", "soundcard", 2, 0, "PHONES shares MAIN 1/2. Use 1/2 for cue and a separate pair such as 3/4 for the house feed."),
  ni("ni-audio-2-mk2", "Native Instruments Traktor Audio 2 MK2", "soundcard"),
  ni("ni-audio-8", "Native Instruments Audio 8 DJ", "soundcard", 0, 6, "Headphones use 7/8; house feed can use 1/2. Check legacy driver support for your OS."),
  ni("ni-audio-4", "Native Instruments Audio 4 DJ", "soundcard", 0, 2, "Headphones use 3/4; house feed uses 1/2. Check legacy driver support for your OS."),
  ni("ni-audio-2-dj", "Native Instruments Audio 2 DJ", "soundcard"),
  ni("ni-audio-kontrol-1", "Native Instruments Audio Kontrol 1", "soundcard", 0, 2, "Set the hardware headphone selector to 3/4 and use 1/2 for the house feed. Check legacy driver support."),
  ...["SL2", "SL3", "SL4"].map(model => guide(`rane-${model.toLowerCase()}`, `Rane ${model}`, "soundcard", "mixer", "https://support.rane.com/en/support/solutions/articles/69000829417-rane-dj-hardware-won-t-connect-to-serato-", legacyGuide)),
  guide("denon-ds1", "Denon DJ DS1", "soundcard", "mixer", "https://cdn.inmusicbrands.com/denondj/DS1/DS1-User-Guide-v1.0.pdf", legacyGuide),
  guide("reloop-flux", "Reloop Flux", "soundcard", "mixer", "https://www.reloop.com/reloop-flux", "Use different line-output pairs for house and cue. Cue requires a mixer PFL channel or headphone amplifier; do not plug headphones into a line-output RCA socket. Select computer playback rather than THRU."),
  guide("reloop-flux-go", "Reloop Flux Go", "soundcard", "mixer", "https://www.reloop.com/products/audio-interfaces", "Use distinct USB playback pairs and a mixer PFL channel or headphone amplifier for cue. Confirm the operating mode and output numbering in the manufacturer manual."),
  guide("reloop-play", "Reloop Play", "soundcard", "phones", "https://www.reloop.com/reloop-play", "Select its master-plus-headphone operating mode. Identify the headphone and main pair with the output tests; do not assume the browser's numbering matches the socket labels."),
  { ...guide("esi-maya44-usb-plus", "ESI MAYA44 USB+", "soundcard", "phones", "https://kb.esi-audio.com/?goto=KB00197EN", "The USB+ headphone socket mirrors 1/2. Use 1/2 for cue and 3/4 for house. The older non-plus MAYA44 USB sums outputs into headphones and is not this profile."), masterPair: 2, cuePair: 0, documentedPairs: true },
  ni("ni-s2-mk3", "Native Instruments Traktor Kontrol S2 MK3", "controller-mixer"),
  ni("ni-s3", "Native Instruments Traktor Kontrol S3", "controller-mixer"),
  ni("ni-s4-mk3", "Native Instruments Traktor Kontrol S4 MK3", "controller-mixer"),
  ni("ni-z1", "Native Instruments Traktor Kontrol Z1", "controller-mixer"),
  ni("ni-z2", "Native Instruments Traktor Kontrol Z2", "controller-mixer"),
  ...["DDJ-FLX4", "DDJ-FLX6", "DDJ-FLX10", "DDJ-400", "DDJ-800", "DDJ-1000", "DDJ-REV1", "DDJ-REV7"].map(pioneerController),
  ...["DJM-250MK2", "DJM-450", "DJM-750MK2", "DJM-900NXS2", "DJM-A9", "DJM-V10", "DJM-S7", "DJM-S11"].map(pioneerMixer),
  guide("xone-96", "Allen & Heath Xone:96", "controller-mixer", "mixer", "https://www.allen-heath.com/content/uploads/2023/06/AP11645_2_XONE_96_USER_GUIDE.pdf", mixerGuide),
  guide("xone-px5", "Allen & Heath Xone:PX5", "controller-mixer", "mixer", "https://support.allen-heath.com/hc/en-gb/articles/43208403578641-Xone-PX5-User-Guide", mixerGuide),
  guide("rane-seventy", "Rane Seventy", "controller-mixer", "mixer", "https://www.rane.com/downloads/", mixerGuide),
  guide("rane-seventy-two-mkii", "Rane Seventy-Two MKII", "controller-mixer", "mixer", "https://www.rane.com/downloads/?product=Seventy-Two+MKII", mixerGuide),
];

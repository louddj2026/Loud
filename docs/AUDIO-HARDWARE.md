# DJ interfaces and MIDI controllers

Open **LOUD → AUDIO OUTPUTS** to configure audio. Open **LOUD → MIDI CONTROLLER WIZARD** to load or learn controls. Audio routing and MIDI mapping are independent: a controller may provide one, both, or proprietary controls that Web MIDI cannot read.

Loud includes **15 standalone DJ interface guides**, **25 controller/mixer audio guides**, and **10 MIDI-only presets**. These cover widely used current and legacy product families. They are not a verified sales ranking or a list of 40 hardware-tested devices. Manufacturer sources are linked below and inside the wizard; the installed driver, operating system and browser determine available outputs. Legacy products may lack a supported driver for a current OS.

## Master and headphones

With independent outputs configured:

- The master mix continuously feeds the assigned house output. Deck headphone buttons select the prefader cue mix, independently of deck volume.
- The top-row Cue Monitor switch is disabled: there is no need to switch the house feed into headphone mode.
- Private Preview temporarily replaces deck cue in the headphones. It does not change the live transports, cue selections, house feed, LoudLink feed or master recording. Closing Preview restores the selected deck cues.
- Headphone volume is separate from master volume. The output tests do not enter the recording.

The default hardware guide is **Traktor Audio 6**. Its PHONES output shares channels **1/2**, so Loud assigns **cue 1/2 and master 3/4**. Connect the house feed to 3/4, not MAIN 1/2. [Native Instruments output assignments](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output).

An interface needs two independent stereo paths (four output channels) for this arrangement. A mixer described as “two-channel” can still provide four or more USB audio channels. The number of physical mixer strips does not tell Loud which USB outputs exist.

## Choose an output method

1. Install the manufacturer's driver and connect the hardware. Stop playback before changing routing; cues and track positions are preserved.
2. Select the model's guide in Audio Outputs. Read its physical-routing instructions.
3. Choose **separate channel pairs** if the browser exposes the interface's multichannel output, or **separate devices** if the driver exposes named MASTER and PHONES endpoints. Unlock/refresh devices and check available channels.
4. Select non-overlapping master and cue pairs, apply, then run the two quiet output tests with hardware levels lowered. Master must sound only on the house feed; headphones must sound only in the headphones.
5. If the browser exposes only two channels while the DJ interface has more, use the optional native bridge below. A profile alone cannot expose driver channels to a browser.

The browser's channel count is checked before routing is applied. Missing or failed outputs are muted instead of redirecting private audio to the system speaker. Saved independent routes require explicit reconnection after a page reload. Do not change the OS default output while performing; select a named interface where possible. Separate-device routing can introduce different delays on the two endpoints.

For DJ mixers, this release uses **Loud's internal mix**: one USB stereo pair carries master into a mixer channel, and another carries cue into a spare channel with its fader down and PFL selected. Remove master from the headphone blend when checking Private Preview. Follow the mixer utility's USB mapping. This does not implement external per-deck mixing, DVS/timecode control, HID jog wheels or manufacturer-specific effects. [Traktor's description of internal and external mixing](https://docs.native-instruments.com/ni-tech-manuals/traktor-pro-manual/en/common-traktor-setups).

## Optional native audio bridge

This local helper sends one four-channel stream (master L/R, cue L/R) to a native PortAudio device. It can expose **ASIO** on Windows where the manufacturer's installed ASIO driver supports it, and operating-system APIs such as WASAPI or Core Audio. Browser audio-device selection alone is not ASIO. The Windows release installer includes the bridge and its packages; use **Start DJ audio bridge** in the Loud Start-menu folder. The manufacturer's hardware driver remains a separate installation.

For a source checkout, set up the bridge from the project folder with [uv](https://docs.astral.sh/uv/getting-started/installation/):

```powershell
uv venv --python 3.12 .audio-bridge
uv pip install --python .audio-bridge/Scripts/python.exe -r scripts/audio-bridge-requirements.txt
.audio-bridge\Scripts\python.exe scripts/start-audio-bridge.py
```

The launcher starts `pythonw.exe` with console creation disabled and redirects output to logs. It does not install a scheduled task or start at login. Import `%LOCALAPPDATA%\Loud\audio-bridge\connection.json` in **Native DJ driver** mode, connect, then select the exact driver/device and both pairs. The pairing file and token are private machine settings; do not commit or share them.

To stop the helper:

```powershell
.audio-bridge\Scripts\python.exe scripts/loud_audio_bridge.py --stop
```

On macOS/Linux, the equivalent venv Python is `.audio-bridge/bin/python`; install packages using that path. Linux also needs its distribution's PortAudio library. Those platforms and physical DJ hardware have not been tested for this release. [sounddevice installation and ASIO selection](https://python-sounddevice.readthedocs.io/en/0.5.3/installation.html).

The bridge binds only to `127.0.0.1:17840`, requires a random pairing token and a local-page origin, and accepts one audio owner at a time. Use the local Loud page. It receives output PCM only and never captures microphone input. Logs and connection details live outside the source folder. Dependencies are pinned in `scripts/audio-bridge-requirements.txt`: sounddevice/PortAudio, NumPy and websockets.

This path is **experimental until tested on the intended DJ hardware**. It buffers about 2,048 frames plus browser/driver latency (about 43 ms at 48 kHz before those additional delays). A bounded common resampler compensates for small browser/DAC clock differences without separating the four channels. It is not a replacement for an entire native low-latency DJ engine. A reported dropout mutes local routing and requires reapplying it; check USB stability, CPU load and driver buffers. Changing output routing never edits loop lengths, BPMs, grids or cue positions.

## MIDI-only presets

Connect the MIDI device, select its input port, select a preset and choose **LOAD PRESET INTO DRAFT**. Loading does not overwrite saved mappings until **SAVE SETUP**. **TEST MAPPED INPUTS** shows received messages and their assigned actions without moving live decks. Use Learn to customise assignments.

Five presets use documented fixed-message modes; five require the explicit template described in the wizard. They are pre-stored Loud action maps, not manufacturer-native template files. Loud does not silently reprogram hardware, send SysEx, provide LED feedback or accept relative encoders. Configure knobs as absolute 0–127 CC and buttons as momentary controls. Channel numbers in the review table are human-readable 1–16.

The complete guide list and MIDI assignments follow. Model-specific output pairs marked “verify” are starting candidates, not certified channel maps.


## Hardware guides

| Model | Category | Master / cue pairs | Source |
| --- | --- | --- | --- |
| Native Instruments Traktor Audio 6 | DJ interface | 3/4 / 1/2 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Audio 10 | DJ interface | 3/4 / 1/2 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Audio 2 MK2 | DJ interface | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Audio 8 DJ | DJ interface | 1/2 / 7/8 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Audio 4 DJ | DJ interface | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Audio 2 DJ | DJ interface | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Audio Kontrol 1 | DJ interface | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Rane SL2 | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://support.rane.com/en/support/solutions/articles/69000829417-rane-dj-hardware-won-t-connect-to-serato-) |
| Rane SL3 | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://support.rane.com/en/support/solutions/articles/69000829417-rane-dj-hardware-won-t-connect-to-serato-) |
| Rane SL4 | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://support.rane.com/en/support/solutions/articles/69000829417-rane-dj-hardware-won-t-connect-to-serato-) |
| Denon DJ DS1 | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://cdn.inmusicbrands.com/denondj/DS1/DS1-User-Guide-v1.0.pdf) |
| Reloop Flux | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://www.reloop.com/reloop-flux) |
| Reloop Flux Go | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://www.reloop.com/products/audio-interfaces) |
| Reloop Play | DJ interface | 1/2 / 3/4 (verify) | [Manufacturer](https://www.reloop.com/reloop-play) |
| ESI MAYA44 USB+ | DJ interface | 3/4 / 1/2 | [Manufacturer](https://kb.esi-audio.com/?goto=KB00197EN) |
| Native Instruments Traktor Kontrol S2 MK3 | Controller / mixer | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Kontrol S3 | Controller / mixer | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Kontrol S4 MK3 | Controller / mixer | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Kontrol Z1 | Controller / mixer | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Native Instruments Traktor Kontrol Z2 | Controller / mixer | 1/2 / 3/4 | [Manufacturer](https://support.native-instruments.com/support/solutions/articles/69000879976-using-a-native-instruments-audio-interface-as-system-audio-output) |
| Pioneer DJ DDJ-FLX4 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-flx4/) |
| Pioneer DJ DDJ-FLX6 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-flx6/) |
| Pioneer DJ DDJ-FLX10 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-flx10/) |
| Pioneer DJ DDJ-400 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-400/) |
| Pioneer DJ DDJ-800 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-800/) |
| Pioneer DJ DDJ-1000 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-1000/) |
| Pioneer DJ DDJ-REV1 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-rev1/) |
| Pioneer DJ DDJ-REV7 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-controllers/ddj-rev7/) |
| Pioneer DJ DJM-250MK2 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-250mk2/) |
| Pioneer DJ DJM-450 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-450/) |
| Pioneer DJ DJM-750MK2 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-750mk2/) |
| Pioneer DJ DJM-900NXS2 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-900nxs2/) |
| Pioneer DJ DJM-A9 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-a9/) |
| Pioneer DJ DJM-V10 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-v10/) |
| Pioneer DJ DJM-S7 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-s7/) |
| Pioneer DJ DJM-S11 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.pioneerdj.com/en/product/dj-mixers/djm-s11/) |
| Allen & Heath Xone:96 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.allen-heath.com/content/uploads/2023/06/AP11645_2_XONE_96_USER_GUIDE.pdf) |
| Allen & Heath Xone:PX5 | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://support.allen-heath.com/hc/en-gb/articles/43208403578641-Xone-PX5-User-Guide) |
| Rane Seventy | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.rane.com/downloads/) |
| Rane Seventy-Two MKII | Controller / mixer | 1/2 / 3/4 (verify) | [Manufacturer](https://www.rane.com/downloads/?product=Seventy-Two+MKII) |

## Stored MIDI assignments

### Native Instruments Traktor Kontrol X1 MK2

Switch from NHL to MIDI mode and configure a Loud template in NI Controller Editor. Create a Loud template in the manufacturer's editor: MIDI channel 1, momentary note buttons 36–47 (rows Play A/B/C, Cue A/B/C, Bass A/B/C, Loop A/B/C). Use absolute CC knobs/faders, not relative encoders. The review table gives every assignment. This is a Loud custom template, not a claim about the factory map. Assign three absolute knobs CC 0/1/2 to volumes; CC 16/17/18 to Low EQ.

[Manufacturer reference](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/traktor_kontrol_x1_mk2_manual_english.pdf)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 36 | 1 | play:A |
| NOTE 37 | 1 | play:B |
| NOTE 38 | 1 | play:C |
| NOTE 39 | 1 | cue:A |
| NOTE 40 | 1 | cue:B |
| NOTE 41 | 1 | cue:C |
| NOTE 42 | 1 | bass:A |
| NOTE 43 | 1 | bass:B |
| NOTE 44 | 1 | bass:C |
| NOTE 45 | 1 | loop:A |
| NOTE 46 | 1 | loop:B |
| NOTE 47 | 1 | loop:C |
| CC 0 | 1 | volume:A |
| CC 1 | 1 | volume:B |
| CC 2 | 1 | volume:C |
| CC 16 | 1 | low:A |
| CC 17 | 1 | low:B |
| CC 18 | 1 | low:C |

### Native Instruments Traktor Kontrol F1

Use MIDI mode (SHIFT + BROWSE), not Remix Deck/NHL mode. Create a Loud template in the manufacturer's editor: MIDI channel 1, momentary note buttons 36–47 (rows Play A/B/C, Cue A/B/C, Bass A/B/C, Loop A/B/C). Use absolute CC knobs/faders, not relative encoders. The review table gives every assignment. This is a Loud custom template, not a claim about the factory map. Assign the first three faders CC 0/1/2 and first three knobs CC 16/17/18 in NI Controller Editor.

[Manufacturer reference](https://www.native-instruments.com/fileadmin/ni_media/downloads/manuals/traktor/traktor_kontrol_f1_manual_english.pdf)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 36 | 1 | play:A |
| NOTE 37 | 1 | play:B |
| NOTE 38 | 1 | play:C |
| NOTE 39 | 1 | cue:A |
| NOTE 40 | 1 | cue:B |
| NOTE 41 | 1 | cue:C |
| NOTE 42 | 1 | bass:A |
| NOTE 43 | 1 | bass:B |
| NOTE 44 | 1 | bass:C |
| NOTE 45 | 1 | loop:A |
| NOTE 46 | 1 | loop:B |
| NOTE 47 | 1 | loop:C |
| CC 0 | 1 | volume:A |
| CC 1 | 1 | volume:B |
| CC 2 | 1 | volume:C |
| CC 16 | 1 | low:A |
| CC 17 | 1 | low:B |
| CC 18 | 1 | low:C |

### Novation Launchpad Mini MK3

Choose Programmer mode manually, MIDI channel 1, and the MIDI input port (not the DAW port). Bottom four rows, left three columns: Play, Cue, Bass kill, Loop for A/B/C. Pad messages are decimal notes 11–13, 21–23, 31–33, 41–43. Loud does not send SysEx or change the controller's mode for you.

[Manufacturer reference](https://downloads.novationmusic.com/novation/launchpad-mk3/launchpad-mini-mk3-0)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 11 | 1 | play:A |
| NOTE 12 | 1 | play:B |
| NOTE 13 | 1 | play:C |
| NOTE 21 | 1 | cue:A |
| NOTE 22 | 1 | cue:B |
| NOTE 23 | 1 | cue:C |
| NOTE 31 | 1 | bass:A |
| NOTE 32 | 1 | bass:B |
| NOTE 33 | 1 | bass:C |
| NOTE 41 | 1 | loop:A |
| NOTE 42 | 1 | loop:B |
| NOTE 43 | 1 | loop:C |

### Novation Launchpad X

Choose Programmer mode manually, MIDI channel 1, and the MIDI input port (not the DAW port). Bottom four rows, left three columns: Play, Cue, Bass kill, Loop for A/B/C. Pad messages are decimal notes 11–13, 21–23, 31–33, 41–43. Loud does not send SysEx or change the controller's mode for you.

[Manufacturer reference](https://downloads.novationmusic.com/novation/launchpad-mk3/launchpad-x)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 11 | 1 | play:A |
| NOTE 12 | 1 | play:B |
| NOTE 13 | 1 | play:C |
| NOTE 21 | 1 | cue:A |
| NOTE 22 | 1 | cue:B |
| NOTE 23 | 1 | cue:C |
| NOTE 31 | 1 | bass:A |
| NOTE 32 | 1 | bass:B |
| NOTE 33 | 1 | bass:C |
| NOTE 41 | 1 | loop:A |
| NOTE 42 | 1 | loop:B |
| NOTE 43 | 1 | loop:C |

### Novation Launchpad Pro MK3

Choose Programmer mode manually, MIDI channel 1, and the MIDI input port (not the DAW port). Bottom four rows, left three columns: Play, Cue, Bass kill, Loop for A/B/C. Pad messages are decimal notes 11–13, 21–23, 31–33, 41–43. Loud does not send SysEx or change the controller's mode for you.

[Manufacturer reference](https://downloads.novationmusic.com/novation/launchpad-mk3/launchpad-pro-mk3)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 11 | 1 | play:A |
| NOTE 12 | 1 | play:B |
| NOTE 13 | 1 | play:C |
| NOTE 21 | 1 | cue:A |
| NOTE 22 | 1 | cue:B |
| NOTE 23 | 1 | cue:C |
| NOTE 31 | 1 | bass:A |
| NOTE 32 | 1 | bass:B |
| NOTE 33 | 1 | bass:C |
| NOTE 41 | 1 | loop:A |
| NOTE 42 | 1 | loop:B |
| NOTE 43 | 1 | loop:C |

### Novation Launch Control XL MK2

Create a Loud template in the manufacturer's editor: MIDI channel 1, momentary note buttons 36–47 (rows Play A/B/C, Cue A/B/C, Bass A/B/C, Loop A/B/C). Use absolute CC knobs/faders, not relative encoders. The review table gives every assignment. This is a Loud custom template, not a claim about the factory map. In Novation Components set faders 1–3 to CC 0–2, knob rows 1/2/3 to CC 16–18 / 32–34 / 48–50 for Low/Mid/High. Save to a User template and select it on the hardware.

[Manufacturer reference](https://components.novationmusic.com/launch-control-xl-mk2/templates/new)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 36 | 1 | play:A |
| NOTE 37 | 1 | play:B |
| NOTE 38 | 1 | play:C |
| NOTE 39 | 1 | cue:A |
| NOTE 40 | 1 | cue:B |
| NOTE 41 | 1 | cue:C |
| NOTE 42 | 1 | bass:A |
| NOTE 43 | 1 | bass:B |
| NOTE 44 | 1 | bass:C |
| NOTE 45 | 1 | loop:A |
| NOTE 46 | 1 | loop:B |
| NOTE 47 | 1 | loop:C |
| CC 0 | 1 | volume:A |
| CC 1 | 1 | volume:B |
| CC 2 | 1 | volume:C |
| CC 16 | 1 | low:A |
| CC 17 | 1 | low:B |
| CC 18 | 1 | low:C |
| CC 32 | 1 | mid:A |
| CC 33 | 1 | mid:B |
| CC 34 | 1 | mid:C |
| CC 48 | 1 | high:A |
| CC 49 | 1 | high:B |
| CC 50 | 1 | high:C |

### Akai APC mini MK2

Use Session mode, MIDI channel 1, USB port 0. Bottom four pad rows, first three columns: Play, Cue, Bass, Loop A/B/C. Faders 1–3 set deck volumes. Drum/Note modes use different messages and are not this preset.

[Manufacturer reference](https://cdn.inmusicbrands.com/akai/attachments/APC%20mini%20mk2%20-%20Communication%20Protocol%20-%20v1.0.pdf)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 0 | 1 | play:A |
| NOTE 1 | 1 | play:B |
| NOTE 2 | 1 | play:C |
| NOTE 8 | 1 | cue:A |
| NOTE 9 | 1 | cue:B |
| NOTE 10 | 1 | cue:C |
| NOTE 16 | 1 | bass:A |
| NOTE 17 | 1 | bass:B |
| NOTE 18 | 1 | bass:C |
| NOTE 24 | 1 | loop:A |
| NOTE 25 | 1 | loop:B |
| NOTE 26 | 1 | loop:C |
| CC 48 | 1 | volume:A |
| CC 49 | 1 | volume:B |
| CC 50 | 1 | volume:C |

### Akai APC Key 25 MK2

Use the clip-launch input, MIDI channel 1. Bottom four pad rows, first three columns: Play, Cue, Bass, Loop A/B/C. This preset intentionally leaves piano keys and mode-dependent knobs unmapped.

[Manufacturer reference](https://cdn.inmusicbrands.com/akai/attachments/APC%20Key%2025%20mk2%20-%20Communication%20Protocol%20-%20v1.0.pdf)

| Input | Channel | Loud action |
| --- | --- | --- |
| NOTE 0 | 1 | play:A |
| NOTE 1 | 1 | play:B |
| NOTE 2 | 1 | play:C |
| NOTE 8 | 1 | cue:A |
| NOTE 9 | 1 | cue:B |
| NOTE 10 | 1 | cue:C |
| NOTE 16 | 1 | bass:A |
| NOTE 17 | 1 | bass:B |
| NOTE 18 | 1 | bass:C |
| NOTE 24 | 1 | loop:A |
| NOTE 25 | 1 | loop:B |
| NOTE 26 | 1 | loop:C |

### Korg nanoKONTROL2

Use CC mode, MIDI channel 1. In Korg Kontrol Editor set sliders 1–3 to CC 0–2; knobs 1–3 to CC 16–18; top/middle/bottom buttons 1–3 to momentary CC 32–34 / 48–50 / 64–66 for Cue / Bass / Play. Set the Play transport button to momentary CC 41. This explicit template avoids DAW-mode differences.

[Manufacturer reference](https://www.korg.com/tmp/support/download/index.php/product/0/159/?country=us&page=product&prodid=159&prodtype=0)

| Input | Channel | Loud action |
| --- | --- | --- |
| CC 0 | 1 | volume:A |
| CC 1 | 1 | volume:B |
| CC 2 | 1 | volume:C |
| CC 16 | 1 | low:A |
| CC 17 | 1 | low:B |
| CC 18 | 1 | low:C |
| CC 32 | 1 | cue:A |
| CC 48 | 1 | bass:A |
| CC 64 | 1 | play:A |
| CC 33 | 1 | cue:B |
| CC 49 | 1 | bass:B |
| CC 65 | 1 | play:B |
| CC 34 | 1 | cue:C |
| CC 50 | 1 | bass:C |
| CC 66 | 1 | play:C |
| CC 41 | 1 | play-all |

### DJ TechTools Midi Fighter Twister

In Midi Fighter Utility create a Loud bank: absolute encoder CC 0–11 on MIDI channel 1, grouped four per deck as Volume/Low/Mid/High. Set encoder switches 1–3 / 5–7 / 9–11 to momentary CC 0–2 / 4–6 / 8–10 on channel 2 for Play / Cue / Bass. Disable relative and toggle modes for these controls.

[Manufacturer reference](https://djtechtools.com/midi-fighter-setup/)

| Input | Channel | Loud action |
| --- | --- | --- |
| CC 0 | 1 | volume:A |
| CC 1 | 1 | low:A |
| CC 2 | 1 | mid:A |
| CC 3 | 1 | high:A |
| CC 4 | 1 | volume:B |
| CC 5 | 1 | low:B |
| CC 6 | 1 | mid:B |
| CC 7 | 1 | high:B |
| CC 8 | 1 | volume:C |
| CC 9 | 1 | low:C |
| CC 10 | 1 | mid:C |
| CC 11 | 1 | high:C |
| CC 0 | 2 | play:A |
| CC 4 | 2 | cue:A |
| CC 8 | 2 | bass:A |
| CC 1 | 2 | play:B |
| CC 5 | 2 | cue:B |
| CC 9 | 2 | bass:B |
| CC 2 | 2 | play:C |
| CC 6 | 2 | cue:C |
| CC 10 | 2 | bass:C |

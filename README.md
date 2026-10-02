# Loud

Loud is a three-deck DJ program for people who want to mix without needing a traditional DJ soundcard, controller or mixer. It runs locally in your browser and can use your computer's normal audio output.

It is intended for anyone from someone just getting into DJing to an experienced DJ who wants to mix a few tunes while away from their usual setup. You can use it with a mouse and keyboard, add a MIDI controller, or connect a DJ interface or mixer with separate master and headphone outputs for a traditional setup.

The booth includes beat grids, loops, EQ, cue controls, configurable keyboard/MIDI controls, Private Preview, and the LoudLink listener surface.

This is a source-code snapshot of the current working application. It opens with an empty library: bring your own music. The repository contains no installed dependencies, music, model weights, saved sets, local settings, or generated analysis. Those stay on each user's computer.

## Start on Windows

The complete analysis setup currently targets **Windows x64**. Use a current Edge or Chrome browser. Other platforms have not been validated for the complete analysis pipeline.

1. Install [Node.js 24 LTS](https://nodejs.org/en/download), [Git](https://git-scm.com/downloads/), and [uv](https://docs.astral.sh/uv/getting-started/installation/). All three are required for the complete setup.
2. Download/extract this source, or clone the repository, then open a terminal in the folder containing `package.json`.
3. Install the pinned package manager and dependencies:

   ```powershell
   npm install --global pnpm@11.19.0
   pnpm install --frozen-lockfile
   Copy-Item .env.example .env.local
   pnpm setup:analysis
   pnpm check:analysis
   pnpm dev
   ```

4. Open **http://localhost:3201/dj**. Use the booth's track upload/library controls to add music. LoudLink is at **http://localhost:3201/crowd**.

**Beat/drum analysis is a required part of Loud.** Complete both analysis setup commands above before using the program. The small source download does not contain the required packages or model weights; the setup downloads them from upstream.

## Required beat and drum analysis

The main installation above includes these required commands. If you need to repair or verify the analysis installation, run them again from the source folder:

```powershell
pnpm setup:analysis
pnpm check:analysis
```

The setup script downloads Python 3.12.10, the pinned CPU analysis packages, HTDemucs and Beat This checkpoints, and the matching FFprobe binary from upstream. It verifies model/binary hashes and loads both models to check the installation. If the booth was already running, restart it after setup.

By default it installs into `../Codex/runtimes/crowd2-analysis`, beside the checkout; the managed Python interpreter is in the adjacent `python` folder. This historical folder name does not require the Codex app. A custom location is supported with `node scripts/setup-analysis-runtime.mjs --root C:/LoudRuntime/analysis`; put the same absolute path in `CROWD_ANALYSIS_RUNTIME` in `.env.local`, and pass `--root` again when checking it.

Allow several GB for the installed packages, models and caches, plus room for your music and derived WAV/stem files. The small source download is **not** the installed disk footprint. Native beat/drum analysis uses CPU and does not require WSL. Optional song-section labelling has a separate WSL setup; see [dependencies and download sources](docs/DEPENDENCIES.md).

## What Private Preview does

Private Preview gives you a separate place to try a transition between two tracks before applying it to the live decks. It uses its own playheads, so seeking, replaying and auditioning in Preview does not move the live decks or stop their playback.

Choose your mix-out and mix-in windows, listen to the overlap, and work on the timing and EQ/bass handover. Start, Middle and Finish buttons can place each window: Middle puts half the selected beat count on either side of the playhead and keeps that mark anchored when changing the length. You can go back and try it again without repeatedly resetting the live decks. Applying the mix placements saves your choices without seeking the live players or rewriting the analysed beat/bar grid. With no bass switch marker selected, the outgoing track keeps its bass for the entire overlap; the bass kills swap at the end of the last beat. Selected bass markers keep their existing handover timing, and manual bass overrides remain available.

What you hear depends on your audio setup:

- **Computer audio / one shared output:** Preview temporarily replaces the local feed you hear. You can practise and prepare mixes without a DJ soundcard, but one output cannot carry an independent house mix and a separate private headphone mix at the same time.
- **Separate master and headphone outputs:** The audience keeps hearing the live master. Your headphones switch to Private Preview, then return to the selected deck cues when you close it. Preview stays out of the master recording and LoudLink feed.

Private Preview is for rehearsing the transition yourself; it does not require a second copy of your music files.

## LoudLink and privacy

The QR code is generated locally from the current user's computer and network. No developer address is built into it, and the QR image is never sent to an external QR service. A local QR contains that computer's private LAN address and port so another device on the same network can connect; anyone who sees or scans the QR can read that address. Avoid including a live connection QR in public screenshots.

Address discovery selects private IPv4 interfaces only. Public or edge deployments do not enumerate private interfaces. An explicitly configured `CROWD_PUBLIC_URL` must be an HTTPS hostname URL without embedded credentials, query parameters or fragments; an invalid value disables the link instead of falling back to a private address. On computers with several adapters or VPNs, check that the chosen address belongs to the network the listener is using.

LoudLink uses local WebRTC connections with no external STUN server by default. Connected devices still learn the network information needed to communicate. A hostname or QR code does not make a direct peer connection anonymous. Internet sharing that hides the DJ's address requires a separately configured media relay; a hosted service is not supplied with this release. Keep the existing localhost binding unless deliberately configuring trusted LAN access; a QR alone does not configure the firewall, HTTPS or server binding.

Master audio can go to the listening device while headphones on the DJ computer carry local cue/Private Preview audio. The listener needs network access to the Loud server, and network playback adds latency.

## DJ hardware and MIDI presets

**LOUD â†’ AUDIO OUTPUT SETUP** contains 15 DJ interface guides and 25 controller/mixer audio guides. It supports separate master/headphone pairs or named driver endpoints, plus an optional local native bridge for ASIO and other native APIs. Traktor Audio 6 is the default guide. Private Preview replaces headphones while the house mix continues.

The MIDI wizard includes 10 stored MIDI-only controller maps. Five use documented hardware modes; five require the specified custom template in the manufacturer editor. Learn and input testing remain available.

See [hardware setup, all 40 guides and all 10 maps](docs/AUDIO-HARDWARE.md). These are setup profiles, not hardware certification or a verified popularity ranking. Physical DJ hardware has not been tested here; the optional native bridge is experimental and adds buffering. Drivers and bridge dependencies are downloaded separately. Pairing tokens and user settings are excluded from this source snapshot.

## Production and development

For a local production build, stop this checkout's development server first:

```powershell
pnpm build
pnpm start
```

Open **http://localhost:3200/dj**. Do not build while `pnpm dev` is using the same `.next` directory. This source version uses ordinary `next start`; the legacy `scripts/run-crowd2-production.ps1` is retained for an existing regression test and is not the launcher for this distribution.

Both supplied launch commands bind to localhost. Publishing the source on GitHub does not host the running booth. LoudLink over a network needs an explicitly configured server/relay, appropriate HTTPS/WebRTC connectivity, and production DJ authentication (`CROWD_DJ_TOKEN`). Other local booth/file APIs are not a hardened public service; do not expose the whole booth to the internet as-is. Development permits anonymous DJ signalling and is for local development.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local development booth, port 3201 |
| `pnpm build` / `pnpm start` | Build / run locally on port 3200 |
| `pnpm typecheck` | TypeScript checks; run after a build on a fresh checkout |
| `pnpm test` | Full existing regression suite; known failures are documented below |
| `pnpm check:fast` | Existing short regression suite |
| `pnpm setup:analysis` / `pnpm check:analysis` | Download / verify native analysis dependencies |
| `pnpm analyse` | Analyse the indexed library |
| `pnpm library:compact` | Refresh compact library records |

To index an existing music folder without copying it, set `$env:CROWD_ELEMENTS_ROOT='C:/Music'` in PowerShell and run `node scripts/index-elements-crate.mjs`. Alternatively, use the booth's library controls. The indexer requires an explicit folder.

## Repository contents

- `app/`, `lib/`, `public/scrub-worklet.js`, `public/audio-bridge-worklet.js`: application source.
- `scripts/`: runtime setup and analysis workers; no downloaded runtimes.
- `tests/`: regression tests, including anonymised numeric cue fixtures. Some historical tests depend on a private analysis catalogue that is intentionally omitted.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`: JavaScript dependencies, exact resolved versions, and permitted install scripts.
- `scripts/analysis-runtime-requirements.txt` and `analysis-runtime-overrides.txt`: pinned Python environment.

Generated `data/`, `public/analysis/`, music, `.env.local`, `node_modules/`, `.next/`, model weights and local caches are ignored by Git. Keep these out of commits even after using the app. Never use `git add -f` to include them.

## Validation and status

See [validation results](docs/VALIDATION.md) for checks performed on this source snapshot. This is a development snapshot with known test failures, not a claim that every regression currently passes. Current loop playback uses decoded audio on a shared audio clock; decoding long tracks also consumes memory.

Older internal names such as `Crowd2` and `CROWD_*` remain in filenames/settings for compatibility. The product is Loud.

## Licence

Loud's original code and documentation are available under the [Loud Noncommercial License 1.0](LICENSE). Anyone may use, copy, modify and share Loud free of charge **for noncommercial purposes only**, subject to the licence terms.

Commercial use is not permitted, including paid DJ performances, commercial venue entertainment, monetized streams, selling access, or use in a business. Commercial use requires a separate written licence from the relevant copyright holder. Modified copies must retain the licence and its noncommercial restriction.

This is source-available software with a noncommercial restriction. Third-party dependencies, models and drivers retain their own licences; Loud's licence does not override them or grant rights to music. See [upstream projects](docs/DEPENDENCIES.md). Their binaries and models are downloaded from their publishers, not rehosted here.

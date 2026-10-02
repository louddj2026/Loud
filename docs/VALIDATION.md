# Source snapshot validation

Validated on Windows x64 with Node 24.20.0 and pnpm 11.19.0, in a separate checkout with no original music library, private environment file, installed dependencies or pre-existing build copied into it.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; resolved all 47 packages, using the local pnpm download cache |
| `pnpm build` | Passed |
| `pnpm typecheck` | Passed after build |
| Production `/dj` | HTTP 200 |
| Production `/crowd` | HTTP 200 |
| Production `/api/crate` | HTTP 200; zero tracks and no remembered library |
| `/scrub-worklet.js` | HTTP 200 |
| Native analysis setup `--check` against existing runtime | Passed; model checkpoints and FFprobe hashes verified, models loaded |
| `pnpm test` | 536 tests: 499 passed, 36 failed, 1 skipped |
| `pnpm check:fast` | 111 tests: 105 passed, 6 failed |

The 36 full-suite failures include all 20 failures already recorded in the working source, plus 16 tests that require the deliberately omitted private catalogue/analysis/section-label fixtures. The tests were retained, not rewritten to hide those failures. The source is a development snapshot, not an all-green release.

Fresh downloading/reinstallation of the large Python runtime and optional WSL section environment was not repeated. The native setup script was verified using the existing prepared runtime; this does not prove every upstream service will remain available. End-to-end listening and browser interactions were not repeated for this packaging task. HTTP checks confirm the clean application starts, not every audio scenario.

## Packaging-only changes

- Product package name is `loud`; Node 24 and pnpm 11.19.0 are declared.
- Added a standard local production start command and analysis setup/check shortcuts.
- Launch commands bind to localhost. The standalone/parent-workspace configuration and machine-specific development IPs are removed from this copy.
- The optional command-line music indexer now requires an explicit music folder.
- Numeric cue-test fixtures are retained with generic names and fixed example dates; the date ordering used by their assertions is preserved.
- Added README, dependency/download instructions, example environment settings, publishing guidance, and expanded ignore rules.
- Application code under `app/` and `lib/`, and the audio worklet, match the captured working source byte for byte. Live playback and the original project were not modified by this preparation.

Only source and text configuration/documentation are packaged. No original filesystem timestamps, alternate data streams, personal screenshots, private settings, installed dependencies, downloaded model/binary files, source-control history or build output are included in the archive. ZIP entries use a fixed neutral timestamp and empty extra/comment fields.

## DJ hardware update

- Eight new Node tests pass: profile counts, MIDI persistence/control uniqueness, prefader cue, preview/master isolation, route validation, channel wiring, failure muting and four-channel worklet PCM.
- Six Python bridge tests pass: packet validation, channel mapping, origin/token rejection and clean shutdown, silent dropout handling, and two clock-drift simulations at Â±500 ppm (20,000 output blocks each, about 107 seconds at 48 kHz).
- A Chromium OfflineAudioContext render check confirms actual master/cue channel separation and that switching to Private Preview changes only headphone samples; the recording remains master-only.
- TypeScript passes. Production webpack build passes. The default Turbopack build in the isolated check folder could not follow its external node_modules junction; webpack validation uses the same source without that staging limitation.
- Full clean-source Node suite: 544 tests, 507 pass, 36 existing failures, 1 skipped. The failing test-name set is unchanged from the pre-hardware clean-source baseline above.
- Browser checks confirm the 15/25 grouped audio guide list and 10 MIDI preset choices; unavailable output pairs disable Apply. No live deck was used for output test tones.

No physical DJ interface/controller was available for end-to-end validation. Profiles are manufacturer-referenced setup guides, not compatibility certificates or a sales ranking. Native hardware/ASIO latency, hot-unplug behaviour at the physical outputs and controller-specific messages still require testing on each intended device. Five MIDI presets require the explicitly described manufacturer-editor template.

## Privacy and display maintenance (2 October 2026)

- Removed personal-name references and replaced a legacy LAN-address fixture with synthetic test data. No music, personal settings, pairing credentials or installed dependencies are included.
- QR generation still discovers the current installation's own private IPv4 address. It rejects non-private addresses and blocks private-interface discovery for public/edge requests. Public URL configuration rejects embedded credentials and query/fragment values.
- Local WebRTC no longer contacts a default external STUN service. Internet relay hosting remains separate work.
- EQ readouts use one decimal place and stable-width layout while audio automation retains full precision. An isolated browser comparison measured about 4 px of horizontal movement before the fix and 0 px after it across eight representative values.
- Concurrent WAV decoding now uses separate temporary files, shares in-process jobs and tolerates publication races. A four-process decoding regression plus separate route-module imports passed.
- Build and TypeScript checks passed in an isolated checkout. The full existing suite ran 548 tests: 511 passed, 36 known failures and one skip. Failure names match the previous distribution baseline exactly. The additional concurrent decoding test passed separately. The short suite retained the same six existing failures.
- Validation used isolated local servers; the user's playing booth was not restarted or refreshed. These source changes take effect in that booth only after a later update.

## Default bass handover at the overlap exit (2 October 2026)

- An unmarked bass lane keeps outgoing bass open and incoming bass killed until Z, then swaps them. It no longer falls back to an old midpoint cue or starts the handover before the selected window ends.
- Explicit bass cues retain their existing sweep. Empty and multiple-marker selections survive draft save/restore; new automations start with no selected marker.
- Three new behavioural tests cover the exit boundary across eight overlap lengths, clearing/saving/restoring/resizing, and preservation of selected/legacy cues. All 14 bass-focused tests pass.
- Full suite: 552 tests, 515 passed, 36 pre-existing failures, one skipped. Failure names are unchanged. Production webpack build and TypeScript checks pass in the isolated checkout.
- The live local booth is deliberately not updated while the DJ is mixing.

## Middle mix-window anchors (2 October 2026)

- Added Middle Mix Out / Middle Mix In between the respective Start and Finish buttons. Half the selected beat count is placed on each side using the track's beat grid, including tempo changes. The middle mark remains anchored when resizing, and private cue undo retains it.
- Out-of-range windows are refused without changing the existing marks. Pointer-down and keyboard activation use the same captured playhead path as Start/Finish.
- Four new behavioural tests pass; the full suite reports 556 tests, 519 passed, 36 unchanged known failures and one skip. Build and TypeScript passed. Isolated production pages returned HTTP 200.
- Isolated rendering confirmed button order, equal widths and unclipped text. The playing local booth remains unchanged pending the DJ's later rollout request.

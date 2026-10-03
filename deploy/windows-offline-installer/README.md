# Loud Windows installer

Run `pnpm build:offline-installer` from a Windows x64 source checkout. The build uses a verified native analysis environment supplied through `LOUD_ANALYSIS_SOURCE` and its matching CPython folder supplied through `LOUD_PYTHON_SOURCE`. Defaults match the development workstation; release builders should set both variables explicitly.

The output is `Loud-Offline-Setup-x64.exe` under the external work directory (`LOUD_OFFLINE_WORK`, defaulting beside the publication workspace). It contains the production server, Node, Python, pinned analysis/audio packages, FFmpeg/FFprobe, Beat This's MIT-licensed checkpoint and the native DJ audio bridge.

The builder refuses to include the Demucs checkpoint `955717e8-8726e21a.th`. During installation the wizard downloads that exact file from Meta's official host, checks its byte length and SHA-256, then loads both models to verify the runtime. This limitation follows the model maintainer's statement that pretrained weights are outside Demucs' MIT code licence and provided only for scientific purposes.

Before publishing:

1. Build from a clean commit.
2. Install silently into a disposable directory and run `verify.ps1`.
3. Launch on a disposable port and confirm `/dj` responds.
4. Check that the installer contains no music, user data, environment files, pairing tokens, logs, local runtime manifest or restricted checkpoint.
5. Put the `.exe` on a GitHub Release. Do not force-add it to Git.

The installer is unsigned until a code-signing certificate is configured. DJ hardware drivers remain separate because they are device-specific manufacturer software.

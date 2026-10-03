# Dependencies and download sources

Source-install commands download dependencies directly. The GitHub release also provides a single Windows installer containing every dependency that Loud may lawfully redistribute. No paid cloud AI API or Codex installation is needed.

## Booth

| Dependency | Version used by this snapshot | Upstream / installation |
| --- | --- | --- |
| Node.js | 24.x (validation used 24.20.0) | [Node.js downloads](https://nodejs.org/en/download) |
| pnpm | 11.19.0 | [pnpm installation](https://pnpm.io/installation); `npm install --global pnpm@11.19.0` |
| Next.js | 16.2.6 | [Next.js](https://nextjs.org/), fetched by pnpm |
| React / React DOM | 19.2.6 | [React](https://react.dev/), fetched by pnpm |
| ffmpeg-static | 5.3.0; FFmpeg 6.1.1 build | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), fetched by its install script |
| TypeScript | 5.9.3 | [TypeScript](https://www.typescriptlang.org/), fetched by pnpm |

The lockfile includes transitive JavaScript packages and integrity hashes. `pnpm-workspace.yaml` permits the FFmpeg and Sharp install scripts; FFmpeg must not be skipped if you want audio decoding/analysis to work. No separate manual FFmpeg install is needed for the normal Windows setup.

## Required beat/drum analysis (Windows x64)

Beat/drum analysis is required for Loud. Run `pnpm setup:analysis` and `pnpm check:analysis` after installing [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Git](https://git-scm.com/downloads/). The installer uses:

- Python 3.12.10, downloaded by uv from its managed Python distributions. [uv Python documentation](https://docs.astral.sh/uv/guides/install-python/).
- PyTorch and torchaudio 2.5.1 CPU packages from the [PyTorch wheel index](https://download.pytorch.org/whl/cpu).
- [Beat This](https://github.com/CPJKU/beat_this) 1.1.0 and other pinned packages from [PyPI](https://pypi.org/).
- [Demucs](https://github.com/facebookresearch/demucs), Git commit `e976d93ecc3865e5757426930257e200846a520a`.
- HTDemucs checkpoint `955717e8-8726e21a.th` from [Meta's model download](https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th).
- Beat This `small0.ckpt` from [JKU's model download](https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt).
- Matching FFprobe from the [Gyan FFmpeg 6.1.1 release](https://github.com/GyanD/codexffmpeg/releases/tag/6.1.1).

Exact Python package versions are in `scripts/analysis-runtime-requirements.txt`; the torchaudio constraint override is in `scripts/analysis-runtime-overrides.txt`. Hashes for model and decoder downloads are in `scripts/setup-analysis-runtime.mjs`. Do not independently upgrade the decoder, torch or model versions without retesting their timing agreement.

The Windows release installer bundles Python, all pinned Python packages, FFmpeg/FFprobe and the MIT-licensed Beat This model. It deliberately excludes the Demucs checkpoint: the Demucs maintainer states that pretrained weights are not covered by the code's MIT licence and are supplied only for scientific purposes. The wizard therefore retrieves that one file from Meta's official host and verifies SHA-256 `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`. This is the only dependency download performed by the release installer.

## Optional song-section labels

Section labels use [All-In-One](https://github.com/mir-aidj/all-in-one) in a separate **WSL2 Ubuntu 24.04** environment. This is optional and disabled in `.env.example`. The existing section installer downloads its own Python 3.10.21, CPU PyTorch, All-In-One, Demucs, madmom, NATTEN and model files. See `scripts/setup-sections.sh` for its complete pinned top-level requirements and download sources. Some transitive section dependencies remain resolver-selected.

Install WSL and Ubuntu using [Microsoft's WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/install). With Ubuntu-24.04 available, run this from the checkout in PowerShell:

```powershell
$sectionScript = (Resolve-Path scripts/setup-sections.sh).Path
$linuxScript = (wsl.exe -d Ubuntu-24.04 -- wslpath -u "$sectionScript").Trim()
wsl.exe -d Ubuntu-24.04 -u root -- bash "$linuxScript" --install
```

This explicitly installs Linux packages and a dedicated environment under `/opt/crowd2-sections`. It can take significant time and disk space. After it succeeds, set these values in `.env.local` and restart Loud:

```dotenv
CROWD_SECTION_ANALYSIS=enabled
CROWD_SECTION_DISTRIBUTION=Ubuntu-24.04
CROWD_SECTION_PYTHON=/opt/crowd2-sections/run-python
```

The wrapper keeps model caches in that environment. Run the same command with `--check` to verify it. Fresh installation of this optional WSL environment was not repeated for this source packaging task.

## Licensing

Consult each linked upstream project and the licence files installed with its packages/models. They are separate works with separate terms; linking or downloading them does not select a licence for Loud. This source bundle does not include their executable binaries, installed packages, or model checkpoints.

## Optional native DJ audio output

The native output bridge uses Python 3.12, [sounddevice/PortAudio](https://python-sounddevice.readthedocs.io/en/0.5.3/installation.html), [NumPy](https://numpy.org/) and [websockets](https://websockets.readthedocs.io/). Exact package versions are in `scripts/audio-bridge-requirements.txt`. `uv pip install` downloads them from PyPI. Windows sounddevice wheels include PortAudio; Loud enables its ASIO build with `SD_ENABLE_ASIO=1`. Install the DJ device manufacturer's own driver separately. Linux may need a system PortAudio package.

No driver or pairing token is distributed. The Windows release installer includes the bridge's Python packages and a Start-menu launcher; source checkouts can still use a local `.audio-bridge/` environment. See [installation and routing](AUDIO-HARDWARE.md).

"""
A drums-only stem, for working out a beat grid.

Run as:  <separator python> drums-stem.py <audio> <out.wav> <result.json> [demix_cache_root]
  native Windows (default): %LOCALAPPDATA%\Crowd2\separator-env\Scripts\python.exe
  WSL reference (CROWD_DEMUCS_BACKEND=wsl): /opt/allin1/bin/python

Why this exists: every grid failure in this project has one root cause — on this
material the bassline occupies the same 45-180 Hz band as the kick, so no filter
or per-onset feature can tell them apart. Measured over 9,505 onsets, every range
overlapped. A drums stem does not sharpen that discrimination, it deletes the
thing being confused with: with no bass in the file, the low-frequency content IS
the kick.

The cold, one-shot twin of drums-stem-worker.py: the same separation code
(drums_separation.py), loaded for one tune and then gone. DJ, 26 Sep 2026: it
used to launch a SECOND interpreter (`python -m demucs`) that imported torch
and loaded the model again after this one had already imported torch for its
device line; running Demucs' own API in-process is the same computation
(the CLI is Separator + separate_audio_file + save_audio with these very
defaults) without that duplicate start-up, and it writes through the same
exact WAV writer as the resident worker. HTDemucs always computes all four
sources; only the drums file is kept unless a demix cache root is given.
CROWD_DEMUCS_THREADS, when set, is the torch thread budget the booth chose.

WAV, always. Anything lossy would reintroduce the estimated-seek bug that
`.seekable.wav` sidecars exist to fix.

The caller must pass audio on the BOOTH'S timeline — the sidecar for a
compressed upload, via lib/playback-clock.ts seekAccuratePath — never the raw
MP3. LAME encoder padding put 18 stems 25 ms off the booth's clock once
(16 Aug 2026), and the referee could not see it.

Never normalised: a kick brought up to full scale would move every threshold
downstream of it.

These files are temporary by design. The caller deletes them once a grid has been
settled; nothing here writes into the library.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: drums-stem.py <audio> <out.wav> <result.json> [demix_cache_root]", file=sys.stderr)
        return 2
    audio = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    result_file = Path(sys.argv[3])
    # DJ, 27 Aug 2026 (shared demix): with a cache root given, all four
    # sources are also parked exactly where All-In-One's demix stage looks
    # (<root>/htdemucs/<audio stem>/), so its own internal Demucs is skipped.
    # The section stage deletes the entry after use; nothing accumulates.
    demix_cache = Path(sys.argv[4]) if len(sys.argv) > 4 else None

    payload = {"ok": False, "error": None, "mode": "four-stem-cold" if demix_cache is not None else "drums-cold"}
    # DJ, 27 Aug 2026: slow separations could not explain themselves (289 s
    # with nothing recorded). Every run now names its device and its cost.
    started = time.monotonic()
    try:
        # The same stdout PROGRESS protocol as the resident worker, so a cold
        # fallback shows its real start-up, decode, blocks and write too.
        from drums_separation import emit_progress

        emit_progress({"event": "startup", "step": "import"})
        import torch
        from drums_separation import describe_output, load_separator, separate_file, write_demix, write_stem_reported

        budget = os.environ.get("CROWD_DEMUCS_THREADS", "").strip()
        if budget:
            torch.set_num_threads(max(1, min(12, int(budget))))
        emit_progress({"event": "startup", "step": "model"})
        separator, payload["device"], blocks = load_separator(report_blocks=True)
        payload["threads"] = torch.get_num_threads()
        payload["loadSeconds"] = round(time.monotonic() - started, 3)
        separated, payload["decodeSeconds"], payload["modelSeconds"] = separate_file(separator, str(audio), blocks)
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_started = time.monotonic()
        payload["writer"] = write_stem_reported(separated["drums"], destination, separator.samplerate, blocks)
        payload["writeSeconds"] = round(time.monotonic() - write_started, 3)
        payload.update({"ok": True, **describe_output(destination)})
        if demix_cache is not None:
            payload["demixCached"] = str(write_demix(separated, demix_cache, audio, separator.samplerate))
    except Exception as error:  # noqa: BLE001 - the caller only needs the message
        payload["error"] = f"{type(error).__name__}: {error}"
        payload["trace"] = traceback.format_exc()[-1500:]

    payload["separationSeconds"] = round(time.monotonic() - started, 1)
    result_file.parent.mkdir(parents=True, exist_ok=True)
    with open(result_file, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

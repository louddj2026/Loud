"""
Resident drums-separation worker: the HTDemucs model loads ONCE, then jobs
stream in over stdin as JSON lines and each answers with a DONE line.

Run as:  <separator python> drums-stem-worker.py
  native Windows (default): %LOCALAPPDATA%\Crowd2\separator-env\Scripts\python.exe
  WSL reference (CROWD_DEMUCS_BACKEND=wsl): /opt/allin1/bin/python

Why this exists (DJ, 27 Aug 2026): every cold `python -m demucs` spawn pays
WSL start + interpreter + model load before any music work — 20-60 s of pure
overhead per tune, more after the WSL VM idled out. The model resident, a job
costs only the separation itself.

Protocol:
  stdin:  {"audio": "...", "out": "...", "result": "...", "demixRoot": "..."|null}\n
  stdout: PROGRESS {"event":"startup",...} while the process imports PyTorch
          and loads the checkpoint, INFO {runtime} then READY once the model is
          loaded; per job PROGRESS {"event":"decode"|"block"|"write",...}
          events (drums_separation.py documents them) and DONE.
  The result JSON carries the same fields as drums-stem.py (ok, file, frames,
  sampleRate, seconds, bytes, device, separationSeconds, mode, writer, and the
  decodeSeconds/modelSeconds/writeSeconds split), so the caller reads one
  contract for warm and cold runs alike. The separation itself lives in
  drums_separation.py, shared with the cold script.

Same rules as drums-stem.py: booth-timeline audio in, WAV out, never
normalised. With demixRoot given, all four sources are parked under
<demixRoot>/htdemucs/<audio stem>/ for All-In-One to reuse (shared demix).
The node side treats ANY protocol failure as a signal to fall back to the
cold drums-stem.py spawn on the SAME runtime, so this worker can never strand
a load.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path


def main() -> int:
    # DJ, 26 Sep 2026 ("that demucs step is too much of a black box"): the
    # booth shows each real sub-step. Start-up is two of them - importing
    # PyTorch/Demucs, then loading the checkpoint - reported as they begin.
    from drums_separation import emit_progress

    emit_progress({"event": "startup", "step": "import"})
    import torch
    from drums_separation import describe_output, load_separator, runtime_info, separate_file, write_demix, write_stem_reported

    emit_progress({"event": "startup", "step": "model"})
    # Demucs' own per-block callback, counted on "end" only (BlockProgress).
    separator, device_label, blocks = load_separator(report_blocks=True)
    print("INFO " + json.dumps(runtime_info(torch, device_label, separator)), flush=True)
    print("READY", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = {}
        payload = {"ok": False, "error": None, "device": device_label, "mode": "four-stem-warm"}
        started = time.monotonic()
        try:
            job = json.loads(line)
            torch.set_num_threads(max(1, min(12, int(job.get("threads") or torch.get_num_threads()))))
            payload["threads"] = torch.get_num_threads()
            audio = Path(job["audio"])
            destination = Path(job["out"])
            separated, payload["decodeSeconds"], payload["modelSeconds"] = separate_file(separator, str(audio), blocks)
            destination.parent.mkdir(parents=True, exist_ok=True)
            write_started = time.monotonic()
            payload["writer"] = write_stem_reported(separated["drums"], destination, separator.samplerate, blocks)
            payload["writeSeconds"] = round(time.monotonic() - write_started, 3)
            payload.update({"ok": True, **describe_output(destination)})
            # DJ, 30 Aug 2026 ("plumbing"): the 4-stem demix cache used to be
            # written HERE - ~340 MB through the WSL->Windows bridge - before
            # the caller heard DONE, so every deck load waited on disk work it
            # never needed. The drums stem is what the booth wants; the cache
            # (All-In-One's reuse) is written after DONE instead.
            payload["demixCache"] = "deferred" if job.get("demixRoot") else None
        except Exception as error:  # noqa: BLE001 - per-job errors go to the result file
            payload["error"] = f"{type(error).__name__}: {error}"
            payload["trace"] = traceback.format_exc()[-1500:]
            separated = None
        payload["separationSeconds"] = round(time.monotonic() - started, 1)
        try:
            result = Path(job.get("result", ""))
            result.parent.mkdir(parents=True, exist_ok=True)
            with open(result, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
        except Exception:  # noqa: BLE001 - the DONE line still lets the caller read a missing result as failure
            pass
        print("DONE", flush=True)
        demix_root = job.get("demixRoot")
        if demix_root and payload.get("ok") and separated is not None:
            try:
                write_demix(separated, demix_root, job["audio"], separator.samplerate)
            except Exception:  # noqa: BLE001 - a failed cache write must never take the worker down
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

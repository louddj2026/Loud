"""Full-track musical beat/downbeat proposals for the Crowd2 grid engine.

The model establishes musical continuity. Crowd2 subsequently fits a coherent
grid and refines it against low-frequency attacks; these proposals are never
used as mixer, cue or sync instructions.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from time import perf_counter

_ANALYSIS_THREADS = max(1, min(4, int(os.environ.get("CROWD_ANALYSIS_THREADS", "3"))))
os.environ.setdefault("OMP_NUM_THREADS", str(_ANALYSIS_THREADS))
os.environ.setdefault("MKL_NUM_THREADS", str(_ANALYSIS_THREADS))
os.environ.setdefault("OPENBLAS_NUM_THREADS", str(_ANALYSIS_THREADS))
os.environ.setdefault("NUMEXPR_NUM_THREADS", str(_ANALYSIS_THREADS))
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
os.environ.setdefault("KMP_BLOCKTIME", "0")

import torch
from beat_this.inference import File2Beats

torch.set_num_threads(_ANALYSIS_THREADS)
torch.set_num_interop_threads(1)


def to_seconds(values: object) -> list[float]:
    """Normalise Beat This outputs across tensor- and NumPy-based releases."""
    if hasattr(values, "detach"):
        values = values.detach()
    if hasattr(values, "cpu"):
        values = values.cpu()
    if hasattr(values, "numpy"):
        values = values.numpy()
    return [round(float(value), 9) for value in values]


def analyse_audio(tracker: File2Beats, path: Path, ffmpeg: str | None):
    """Use ffmpeg as a compatibility decoder when Beat This cannot read a file."""
    try:
        return tracker(str(path)), "native"
    except RuntimeError as error:
        if "Could not load audio" not in str(error) or not ffmpeg:
            raise
        with tempfile.TemporaryDirectory(prefix="crowd2-beat-this-") as temporary:
            decoded = Path(temporary) / "decoded.wav"
            process = subprocess.run([
                ffmpeg,
                "-hide_banner",
                "-loglevel", "error",
                "-i", str(path),
                "-vn",
                "-ac", "1",
                "-ar", "22050",
                "-c:a", "pcm_s16le",
                "-y",
                str(decoded),
            ], capture_output=True, text=True, check=False)
            if process.returncode != 0 or not decoded.exists():
                detail = process.stderr.strip() or f"ffmpeg exited {process.returncode}"
                raise RuntimeError(f"Compatibility audio decode failed: {detail}") from error
            return tracker(str(decoded)), "ffmpeg-wav-fallback"


def analyse_track(
    tracker: File2Beats,
    source: str,
    model: str,
    ffmpeg: str | None,
) -> dict[str, object]:
    path = Path(source).resolve()
    track_started = perf_counter()
    (beats, downbeats), decoder = analyse_audio(tracker, path, ffmpeg)
    return {
        "path": str(path),
        "model": model,
        "decoder": decoder,
        "frameRate": 50,
        "beats": to_seconds(beats),
        "downbeats": to_seconds(downbeats),
        "elapsedSeconds": round(perf_counter() - track_started, 3),
    }


def write_result(output: str, model: str, tracks: list[dict[str, object]], elapsed: float) -> None:
    destination = Path(output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({
        "analysisVersion": "crowd2-beat-model-1",
        "model": model,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "elapsedSeconds": round(elapsed, 3),
        "tracks": tracks,
    }, indent=2) + "\n", encoding="utf-8")


def serve_worker(tracker: File2Beats, model: str, default_ffmpeg: str | None) -> None:
    print(json.dumps({
        "type": "ready",
        "model": model,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }), flush=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request["requestId"])
            output = str(request["output"])
            audio = str(request["audio"])
            ffmpeg = str(request.get("ffmpeg") or default_ffmpeg or "") or None
            started = perf_counter()
            track = analyse_track(tracker, audio, model, ffmpeg)
            write_result(output, model, [track], perf_counter() - started)
            print(json.dumps({
                "type": "complete",
                "requestId": request_id,
                "beats": len(track["beats"]),
                "downbeats": len(track["downbeats"]),
                "decoder": track["decoder"],
                "elapsedSeconds": track["elapsedSeconds"],
            }), flush=True)
        except Exception as error:
            print(json.dumps({
                "type": "error",
                "requestId": request_id,
                "error": str(error),
                "traceback": traceback.format_exc(),
            }), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="*")
    parser.add_argument("--output")
    parser.add_argument("--model", default="small0")
    parser.add_argument("--ffmpeg")
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    tracker = File2Beats(
        checkpoint_path=args.model,
        device="cuda" if torch.cuda.is_available() else "cpu",
        float16=torch.cuda.is_available(),
        dbn=False,
    )
    if args.worker:
        serve_worker(tracker, args.model, args.ffmpeg)
        return
    if not args.output:
        parser.error("--output is required unless --worker is used")
    if not args.audio:
        parser.error("at least one audio file is required unless --worker is used")
    started = perf_counter()
    tracks = []
    for source in args.audio:
        track = analyse_track(tracker, source, args.model, args.ffmpeg)
        tracks.append(track)
        print(f"Beat model: {Path(source).name} -> {len(track['beats'])} beats, {len(track['downbeats'])} downbeats ({track['decoder']})", flush=True)
    write_result(args.output, args.model, tracks, perf_counter() - started)


if __name__ == "__main__":
    main()

"""
Section labels and, optionally, stems for one track — from a single GPU pass.

Run as:  /opt/allin1/bin/python section-analyse.py <audio> <output.json> [stems_dir]

All-In-One's first stage IS HTDemucs: it separates every track into drums, bass,
vocals and other before it looks at structure, and then deletes the result. So
passing a stems directory costs no extra GPU time — it only keeps what was
already computed and thrown away.

Writes JSON to the output file, never to stdout. All-In-One prints progress bars
and model chatter on both streams, so parsing stdout would be a guessing game.

LABELS ONLY from the structure side. All-In-One's tempo and phase outputs are
discarded here rather than in the caller, so no future edit can wire them into the
booth by accident: its tempo is integer-only (up to 0.65% out, half a phrase
across a mix window) and its bar positions sit a median of 29 ms off a grid that
passed a listening test. See docs/allin1-setup.md.

Stems are written as WAV. Anything lossy would reintroduce the estimated-seeking
bug that `.seekable.wav` sidecars exist to fix: the browser plays audio up to
±500 ms from the requested position and then reports the requested position,
which is invisible to every piece of telemetry in the app.

Stems are NEVER normalised individually. Their relative levels are the whole
point — a "bass" that has been brought up to full scale cannot be crossfaded
against the rest of the mix.
"""
import json
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

# The four HTDemucs sources, and the performance pair the booth actually plays.
SOURCES = ("bass", "drums", "vocals", "other")
REST_OF_MIX = ("drums", "vocals", "other")


def build_stems(demix_root: Path, destination: Path) -> dict:
    """Copy the separated sources out, and sum a 'rest' companion for the bass."""
    import numpy
    import soundfile

    candidates = sorted(demix_root.rglob("bass.wav"))
    if not candidates:
        return {"ok": False, "error": "no separated sources were produced"}
    track_dir = candidates[0].parent

    missing = [name for name in SOURCES if not (track_dir / f"{name}.wav").exists()]
    if missing:
        return {"ok": False, "error": f"separation is missing {', '.join(missing)}"}

    destination.mkdir(parents=True, exist_ok=True)
    written = {}
    frames = None
    rate = None
    rest_sum = None

    for name in SOURCES:
        data, source_rate = soundfile.read(str(track_dir / f"{name}.wav"), always_2d=True)
        if frames is None:
            frames, rate = data.shape[0], source_rate
        elif data.shape[0] != frames or source_rate != rate:
            # A stem of a different length would drift against the others the
            # moment it was played, so refuse the whole set rather than ship it.
            return {"ok": False, "error": f"{name} does not match the other stems in length or rate"}
        target = destination / f"{name}.wav"
        shutil.copyfile(track_dir / f"{name}.wav", target)
        written[name] = target.name
        if name in REST_OF_MIX:
            rest_sum = data.copy() if rest_sum is None else rest_sum + data

    # Performance mode: bass against everything else. Two streams instead of four,
    # and no level correction, so bass + rest reconstructs the mix.
    if rest_sum is not None:
        soundfile.write(str(destination / "rest.wav"), rest_sum, rate)
        written["rest"] = "rest.wav"

    # Per-stem peaks are how the "never normalise" rule is checked rather than
    # merely stated: separated sources have wildly different levels, so a set that
    # all peak near 1.0 has been level-corrected and is useless for crossfading.
    peaks = {}
    summed = None
    for name in SOURCES:
        data, _ = soundfile.read(str(track_dir / f"{name}.wav"), always_2d=True)
        peaks[name] = round(float(numpy.max(numpy.abs(data))), 4)
        summed = data.copy() if summed is None else summed + data

    return {
        "ok": True,
        "stems": written,
        "frames": int(frames or 0),
        "sampleRate": int(rate or 0),
        "seconds": round((frames or 0) / (rate or 1), 3),
        "peaks": peaks,
        "peakOfSum": round(float(numpy.max(numpy.abs(summed))), 4) if summed is not None else None,
        "bytes": sum((destination / file).stat().st_size for file in written.values()),
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: section-analyse.py <audio> <output.json> [stems_dir|-] [shared_demix_root]", file=sys.stderr)
        return 2
    audio, destination = sys.argv[1], sys.argv[2]
    stems_dir = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "-" else None
    # DJ, 27 Aug 2026 (shared demix): the drums-stem pass already separated
    # this tune and parked all four sources under
    # <shared_root>/htdemucs/<audio stem>/. Pointing All-In-One's demix_dir at
    # that root makes its own separation a no-op ("Found 1 tracks already
    # demixed"). The entry is deleted after use — the cache is a hand-off
    # between the two stages of one load, not a store.
    shared_root = Path(sys.argv[4]) if len(sys.argv) > 4 else None
    shared_entry = shared_root / "htdemucs" / Path(audio).stem if shared_root else None
    use_shared = bool(shared_entry and all((shared_entry / f"{name}.wav").exists() for name in SOURCES))

    payload = {"ok": False, "segments": [], "error": None, "stems": None, "sharedDemix": use_shared}
    scratch = Path(tempfile.mkdtemp(prefix="crowd2-demix-"))
    try:
        import allin1

        demix_dir = shared_root if use_shared else scratch / "demix"
        result = allin1.analyze(
            audio,
            demix_dir=str(demix_dir),
            spec_dir=str(scratch / "spec"),
            # Keep what the first stage produced only when stems were asked for.
            # A shared entry is kept too: build_stems may still read it below,
            # and the cleanup at the end removes it either way.
            keep_byproducts=stems_dir is not None or use_shared,
        )
        if isinstance(result, list):
            result = result[0]

        segments = []
        for segment in getattr(result, "segments", []) or []:
            start = float(getattr(segment, "start", 0.0))
            end = float(getattr(segment, "end", 0.0))
            label = str(getattr(segment, "label", "") or "").strip().lower()
            if end > start and label:
                segments.append({"start": round(start, 2), "end": round(end, 2), "label": label})
        payload["segments"] = segments
        payload["ok"] = bool(segments)
        if not segments:
            payload["error"] = "All-In-One returned no segments"

        if stems_dir is not None:
            payload["stems"] = build_stems(demix_dir, stems_dir)
    except Exception as error:  # noqa: BLE001 - the caller only needs the message
        payload["error"] = f"{type(error).__name__}: {error}"
        payload["trace"] = traceback.format_exc()[-2000:]
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
        if shared_entry is not None:
            shutil.rmtree(shared_entry, ignore_errors=True)

    try:
        with open(destination, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    except OSError as error:
        print(f"could not write {destination}: {error}", file=sys.stderr)
        return 1
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

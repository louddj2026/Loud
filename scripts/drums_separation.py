"""
The drums separation itself, shared by the resident worker
(drums-stem-worker.py) and the cold one-shot fallback (drums-stem.py), so the
booth has exactly one implementation on every runtime - native Windows by
default, the WSL reference only on request.

Same rules as ever: booth-timeline audio in, 16-bit WAV out, never
normalised. HTDemucs through demucs.api with its defaults (the htdemucs bag,
shifts=1, overlap=0.25, split=True, jobs=0, the model's sample rate), decoded
by Demucs' own loader: ffprobe + ffmpeg, torchaudio only if those fail.
Nothing here seeds a random generator; the shift offset stays random.

DJ, 26 Sep 2026 (native Windows separator): the one platform difference that
reached the output file was the WAV writer. demucs.api.save_audio hands the
float stem to torchaudio.save. On Linux that is sox, which converts
float -> int32 by truncating x * 2^31, then int32 -> int16 as (s + 2^15) >> 16.
Windows torchaudio has no sox and falls back to libsndfile, which wrote half
of all samples one LSB lower. write_stem keeps save_audio wherever the sox
writer exists (the WSL reference path is untouched) and elsewhere applies the
SAME prevent_clip and the SAME sox conversion before writing 16-bit PCM:
byte-identical to the Linux file for identical input, measured.
"""
import json
import math
import os
import platform
import shutil
import sys
import time
from pathlib import Path

SOURCES = ("bass", "drums", "other", "vocals")


def emit_progress(event):
    """One `PROGRESS {json}` line on stdout: the booth reads these live
    (lib/load-progress.ts parseSeparatorLine). Progress must never break a
    separation, and a vanished parent must not leave Demucs grinding."""
    try:
        print("PROGRESS " + json.dumps(event, separators=(",", ":")), flush=True)
    except BrokenPipeError:
        os._exit(0)
    except Exception:  # noqa: BLE001 - reporting is best-effort, separating is not
        pass


def _running_block_loop():
    """Demucs' own split loop that is calling back right now - READ, not
    recomputed, so the counts are the loop's own.

    Returns (offsets, length, segment_length, shift_offset, max_shift):
    `offsets` is the loop's range of block starts (its len is this pass's
    exact block count), `length` the length of the signal the loop splits,
    and shift_offset/max_shift the pass's random time shift (None for an
    unshifted pass). None when no such loop is on the stack (a different
    Demucs structure): the caller then reports no total rather than a guess.
    """
    frame = sys._getframe(2)
    split = None
    try:
        while frame is not None:
            if frame.f_code.co_name == "apply_model":
                local = frame.f_locals
                if split is None:
                    offsets = local.get("offsets")
                    if isinstance(offsets, range):
                        split = (offsets, local.get("length"), local.get("segment_length"))
                elif "max_shift" in local and "shifted" in local:
                    return split + (local.get("offset"), local.get("max_shift"))
            frame = frame.f_back
        return None if split is None else split + (None, None)
    finally:
        del frame


class BlockProgress:
    """Demucs' per-block callback, counted without inference.

    demucs.apply.apply_model calls back with state "start" and then "end"
    around every block it runs (jobs=0 runs them in order, one at a time).
    A block is COMPLETED only on its "end"; "start" names the block now
    running. Every model x shift pass runs its own block loop whose length
    depends on that pass's random shift, so a pass's count is read from the
    loop itself when the pass begins. Nothing here changes what Demucs
    computes: it only reads the callback payload and the running loop.
    """

    def __init__(self, samplerate, shifts):
        self.samplerate = samplerate
        # shifts=0 runs each model once; shifts=N runs N shifted passes per model.
        self.shifts = max(1, int(shifts or 0))
        self.start_job()

    def start_job(self):
        self.done = 0
        self.pass_index = None
        self.done_in_pass = 0
        self.pass_blocks = None

    def __call__(self, data):
        try:
            self._observe(data)
        except Exception:  # noqa: BLE001 - progress must never break separation
            pass

    def _observe(self, data):
        state = data.get("state")
        if state not in ("start", "end"):
            return
        models = max(1, int(data.get("models") or 1))
        passes = models * self.shifts
        pass_index = int(data.get("model_idx_in_bag") or 0) * self.shifts + int(data.get("shift_idx") or 0)
        loop = _running_block_loop()
        if pass_index != self.pass_index:
            self.pass_index = pass_index
            self.done_in_pass = 0
            self.pass_blocks = len(loop[0]) if loop else None
        segment_offset = int(data.get("segment_offset") or 0)
        block = None
        span = None
        if loop:
            offsets, length, segment_length, shift_offset, max_shift = loop
            if segment_offset in offsets:
                block = offsets.index(segment_offset) + 1
            span = self._source_span(segment_offset, length, segment_length, shift_offset, max_shift, data.get("audio_length"))
        if block is None:
            # Blocks run strictly in order (jobs=0), so the running block is the next one.
            block = self.done_in_pass + 1 if state == "start" else max(1, self.done_in_pass)
        if state == "end":
            self.done += 1
            self.done_in_pass += 1
        emit_progress({
            "event": "block",
            "state": state,
            "block": block,
            "passBlocks": self.pass_blocks,
            "done": self.done,
            "doneInPass": self.done_in_pass,
            "pass": pass_index + 1,
            "passes": passes,
            "range": span,
        })

    def _source_span(self, segment_offset, length, segment_length, shift_offset, max_shift, audio_length):
        """The block's span in seconds of the decoded audio, from the loop's own numbers.

        A shifted pass splits a copy padded by max_shift each side and entered
        at the random shift_offset, so block position p is audio frame
        p + shift_offset - max_shift. Returns None unless every number is known.
        """
        if not isinstance(length, int) or not isinstance(segment_length, int) or not isinstance(audio_length, int):
            return None
        if (shift_offset is None) != (max_shift is None):
            return None
        block_frames = min(length - segment_offset, segment_length)
        start = segment_offset + ((shift_offset - max_shift) if shift_offset is not None else 0)
        first = max(0, start)
        last = min(audio_length, start + block_frames)
        if last <= first or not self.samplerate:
            return None
        # Millisecond resolution, rounded outwards: a final block can hold only
        # a few frames of audio and must not collapse to a zero-length span.
        audio_end = audio_length / self.samplerate
        return [math.floor(first / self.samplerate * 1000) / 1000, min(audio_end, math.ceil(last / self.samplerate * 1000) / 1000)]


_INT32_MIN = -(2 ** 31)
_INT32_MAX = 2 ** 31 - 1
# Written in slices so a seven-minute stem never needs a float64 copy of
# itself in memory; the conversion is per sample, so slicing changes nothing.
_WRITE_FRAMES = 1 << 18


def device_label(torch):
    return f"cuda:{torch.cuda.get_device_name(0)}" if torch.cuda.is_available() else "CPU ONLY"


def load_separator(report_blocks=False):
    """The model, loaded once per process.

    Returns (separator, device label, BlockProgress or None). The separator
    keeps every Demucs default (htdemucs bag, shifts=1, overlap=0.25,
    split=True, jobs=0); reporting only installs Demucs' own callback, through
    its public update_parameter, with the model's real sample rate and shift
    count."""
    import torch
    from demucs.api import Separator

    device = "cuda" if torch.cuda.is_available() else "cpu"
    separator = Separator(model="htdemucs", device=device)
    progress = None
    if report_blocks:
        progress = BlockProgress(separator.samplerate, getattr(separator, "_shifts", 1))
        separator.update_parameter(callback=progress)
    return separator, device_label(torch), progress


def uses_sox_writer():
    """True only where demucs.api.save_audio already writes through sox: the
    torchaudio 2.0 reference on Linux. torchaudio 2.1+ picks a writer per call
    (and deprecates the global backend), so there the exact conversion below
    is always applied instead."""
    try:
        import torchaudio

        major, minor = (int(part) for part in torchaudio.__version__.split(".")[:2])
        if (major, minor) >= (2, 1):
            return False
        return torchaudio.get_audio_backend() == "sox_io"
    except Exception:  # noqa: BLE001 - no global backend means no sox writer
        return False


def sox_pcm16(samples):
    """Float samples -> int16 exactly as torchaudio's sox_io save and libsox do it."""
    import numpy as np

    wide = np.trunc(samples.astype(np.float64) * 2147483648.0)
    np.clip(wide, _INT32_MIN, _INT32_MAX, out=wide)
    s32 = wide.astype(np.int64)
    s16 = np.where(s32 > _INT32_MAX - (1 << 15), 32767, (s32 + (1 << 15)) >> 16)
    return np.ascontiguousarray(s16.astype(np.int16))


def write_stem(wav, path, samplerate):
    """demucs.api.save_audio(wav, path, samplerate=...), identical bytes on every OS.

    Returns the writer used, for the result payload."""
    if uses_sox_writer():
        from demucs.api import save_audio

        save_audio(wav, str(path), samplerate=samplerate)
        return "sox_io"
    import soundfile
    from demucs.audio import prevent_clip

    clipped = prevent_clip(wav, mode="rescale").detach().cpu().numpy()
    channels, frames = clipped.shape
    with soundfile.SoundFile(str(path), "w", samplerate=samplerate, channels=channels,
                             subtype="PCM_16", format="WAV") as handle:
        for start in range(0, frames, _WRITE_FRAMES):
            handle.write(sox_pcm16(clipped[:, start:start + _WRITE_FRAMES].T))
    return "sox-exact-pcm16"


def separate_file(separator, audio, progress=None):
    """Separator.separate_audio_file, split only so decode and model time are
    reported apart - it IS _load_audio followed by separate_tensor.
    Returns (sources, decode seconds, model seconds).

    With `progress` (the BlockProgress load_separator installed), the decode
    is reported as it starts and ends, with the decoded length."""
    started = time.monotonic()
    if progress is not None:
        progress.start_job()
        emit_progress({"event": "decode", "state": "start"})
    wav = separator._load_audio(audio)
    decoded = time.monotonic()
    if progress is not None:
        emit_progress({"event": "decode", "state": "end", "audioSeconds": round(wav.shape[-1] / separator.samplerate, 3)})
    _origin, separated = separator.separate_tensor(wav, separator.samplerate)
    return separated, round(decoded - started, 3), round(time.monotonic() - decoded, 3)


def write_stem_reported(wav, path, samplerate, progress):
    """write_stem with its start and end reported when the job reports progress."""
    if progress is not None:
        emit_progress({"event": "write", "state": "start"})
    writer = write_stem(wav, path, samplerate)
    if progress is not None:
        emit_progress({"event": "write", "state": "end"})
    return writer


def describe_output(destination):
    import soundfile

    destination = Path(destination)
    info = soundfile.info(str(destination))
    return {
        "file": destination.name,
        "frames": int(info.frames),
        "sampleRate": int(info.samplerate),
        "channels": int(info.channels),
        "seconds": round(info.frames / max(1, info.samplerate), 3),
        "bytes": destination.stat().st_size,
    }


def write_demix(separated, demix_root, audio, samplerate):
    """All four sources where All-In-One's demix stage looks for them."""
    entry = Path(demix_root) / "htdemucs" / Path(audio).stem
    shutil.rmtree(entry, ignore_errors=True)
    entry.mkdir(parents=True, exist_ok=True)
    for name in SOURCES:
        write_stem(separated[name], entry / f"{name}.wav", samplerate)
    return entry


def runtime_info(torch, device, separator=None):
    """What this process actually runs on - printed on INFO for the booth's log."""
    import torchaudio

    return {
        "threads": torch.get_num_threads(),
        "device": device,
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "python": platform.python_version(),
        "platform": sys.platform,
        "writer": "sox_io" if uses_sox_writer() else "sox-exact-pcm16",
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "hub": torch.hub.get_dir(),
        "samplerate": getattr(separator, "samplerate", None),
    }

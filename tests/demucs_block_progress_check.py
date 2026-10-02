"""
Drives the REAL demucs.apply.apply_model with small stand-in models (no
checkpoint, CPU, seconds) and checks scripts/drums_separation.BlockProgress
against ground truth across bags, shifts, overlaps and lengths:

  - a block counts as done only on its "end" callback, one at a time;
  - each pass's block total equals the model forward calls that pass made;
  - "start" names block doneInPass+1 and never counts;
  - every reported source span lies inside the decoded audio;
  - installing the callback leaves the separated output bit-identical.

Then it checks that load_separator(report_blocks=True) keeps every Demucs
default of the real htdemucs separator (model bag, shifts, overlap, split,
segment, jobs, device, sample rate) - it loads the real checkpoint, so it
needs TORCH_HOME pointing at the runtime's verified model home.

Prints one JSON line: {"ok": true, "cases": [...], "htdemucs": {...}}.
Run by tests/demucs-block-progress.test.mjs with the analysis runtime python.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import torch  # noqa: E402
from demucs.apply import BagOfModels, apply_model  # noqa: E402

import drums_separation  # noqa: E402


class StandIn(torch.nn.Module):
    """Deterministic, cheap, position-dependent: every output sample depends on its input."""

    def __init__(self, samplerate, segment, scale):
        super().__init__()
        self.samplerate = samplerate
        self.segment = segment
        self.sources = ["drums", "bass"]
        self.audio_channels = 2
        self.scale = scale
        self.calls = []
        self.anchor = torch.nn.Parameter(torch.zeros(1), requires_grad=False)

    def forward(self, mix):
        self.calls.append(mix.shape[-1])
        stacked = torch.stack([mix * self.scale, mix * -self.scale], dim=1)
        return stacked


def run_case(models, shifts, overlap, seconds, samplerate=1000, segment=2.0):
    frames = int(seconds * samplerate)
    generator = torch.Generator().manual_seed(7)
    wav = torch.rand(1, 2, frames, generator=generator) - 0.5
    members = [StandIn(samplerate, segment, 1.0 + index) for index in range(models)]
    # htdemucs itself is a bag (of one), so every case goes through the bag branch.
    model = BagOfModels(members)

    events = []
    original_emit = drums_separation.emit_progress
    drums_separation.emit_progress = events.append
    try:
        progress = drums_separation.BlockProgress(samplerate, shifts)
        random.seed(1234)
        with_callback = apply_model(model, wav, shifts=shifts, split=True, overlap=overlap, callback=progress,
                                    callback_arg={"audio_length": frames})
    finally:
        drums_separation.emit_progress = original_emit
    calls_with = [list(member.calls) for member in members]
    for member in members:
        member.calls.clear()
    random.seed(1234)
    without_callback = apply_model(model, wav, shifts=shifts, split=True, overlap=overlap)

    problems = []
    if not torch.equal(with_callback, without_callback):
        problems.append("output changed when the progress callback was installed")

    expected_passes = models * max(1, shifts)
    # Ground truth: every block is exactly one model forward call.
    total_calls = sum(len(calls) for calls in calls_with)

    ends = [event for event in events if event["state"] == "end"]
    starts = [event for event in events if event["state"] == "start"]
    if len(ends) != total_calls:
        problems.append(f"{len(ends)} end events for {total_calls} model calls")
    if len(starts) != total_calls:
        problems.append(f"{len(starts)} start events for {total_calls} model calls")
    done = 0
    pass_seen = {}
    running = None
    for event in events:
        if event["passes"] != expected_passes:
            problems.append(f"passes {event['passes']} != {expected_passes}")
            break
        if event["state"] == "start":
            if running is not None:
                problems.append("a block started before the previous one ended")
            if event["done"] != done:
                problems.append("a start event changed the done count")
            if event["block"] != event["doneInPass"] + 1:
                problems.append(f"start names block {event['block']} with {event['doneInPass']} done in pass")
            running = (event["pass"], event["block"])
        else:
            if running != (event["pass"], event["block"]):
                problems.append(f"end for {event['pass']}/{event['block']} while {running} was running")
            done += 1
            running = None
            if event["done"] != done:
                problems.append(f"done {event['done']} != {done}")
            if event["doneInPass"] != event["block"]:
                problems.append("doneInPass does not match the finished block")
            pass_seen[event["pass"]] = (event["doneInPass"], event["passBlocks"])
        span = event["range"]
        if span is None:
            problems.append("no source span reported")
        elif not (0 <= span[0] < span[1] <= frames / samplerate + 1e-9):
            problems.append(f"span {span} outside the audio")
    if sorted(pass_seen) != list(range(1, expected_passes + 1)):
        problems.append(f"passes seen {sorted(pass_seen)}")
    for pass_number, (finished, total) in pass_seen.items():
        if total is None or finished != total:
            problems.append(f"pass {pass_number}: finished {finished} of reported {total}")
    reported_total = sum(total for _finished, total in pass_seen.values() if total)
    if reported_total != total_calls:
        problems.append(f"reported block totals {reported_total} != model calls {total_calls}")
    first_start = next((event for event in events if event["state"] == "start"), None)
    if shifts == 0 and first_start and first_start["range"] and first_start["range"][0] != 0:
        problems.append("an unshifted first block does not start at 0")
    return {
        "models": models, "shifts": shifts, "overlap": overlap, "seconds": seconds,
        "blocks": total_calls, "passTotals": {str(key): value[1] for key, value in sorted(pass_seen.items())},
        "problems": problems,
    }


def htdemucs_settings():
    plain = __import__("demucs.api", fromlist=["Separator"]).Separator(model="htdemucs", device="cpu")
    reported, _device, progress = drums_separation.load_separator(report_blocks=True)
    keys = ["_shifts", "_overlap", "_split", "_segment", "_jobs", "_device", "_progress", "_callback_arg"]
    differences = [key for key in keys if getattr(plain, key) != getattr(reported, key)]
    model = reported._model
    bag = isinstance(model, BagOfModels)
    member = model.models[0] if bag else model
    return {
        "differencesFromPlainSeparator": differences,
        "callbackInstalled": reported._callback is progress and progress is not None,
        "bag": bag,
        "models": len(model.models) if bag else 1,
        "shifts": reported._shifts,
        "overlap": reported._overlap,
        "split": reported._split,
        "jobs": reported._jobs,
        "segmentOverride": reported._segment,
        "modelSegmentSeconds": float(member.segment),
        "samplerate": reported.samplerate,
        "blockFrames": int(reported.samplerate * member.segment),
        "strideFrames": int((1 - reported._overlap) * int(reported.samplerate * member.segment)),
        "maxShiftFrames": int(0.5 * reported.samplerate),
    }


def main():
    cases = []
    for models, shifts, overlap, seconds in [
        (1, 1, 0.25, 19.3),   # the htdemucs shape: bag of one, one shift
        (1, 1, 0.25, 6.0),    # a length on a stride boundary
        (1, 1, 0.25, 1.1),    # shorter than one block
        (2, 1, 0.25, 11.7),   # a bag of two
        (1, 2, 0.25, 13.4),   # two shifts: two passes whose block counts may differ
        (2, 2, 0.5, 9.9),     # bag x shifts, 50% overlap
        (1, 0, 0.25, 12.2),   # no shift: blocks start at 0
    ]:
        cases.append(run_case(models, shifts, overlap, seconds))
    settings = htdemucs_settings() if "--no-htdemucs" not in sys.argv else None
    ok = all(not case["problems"] for case in cases) and (settings is None or not settings["differencesFromPlainSeparator"] and settings["callbackInstalled"])
    print(json.dumps({"ok": ok, "cases": cases, "htdemucs": settings}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

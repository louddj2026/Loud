import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ASSISTED_OVERLAP_AUTOMATION, normaliseAssistedOverlapAutomation, resizeAssistedOverlapAutomation, assistedAutomationAtBeat } from '../lib/assisted-playback.ts';
import { toggleBassSwapBeat } from '../lib/bass-ownership.ts';
import { parsePreviewDraft } from '../lib/preview-draft.ts';
import { transitionPreviewBeat } from '../lib/transition-preview.ts';

test('unmarked bass stays outgoing through the final beat, then swaps exactly at the overlap exit', () => {
  for (const beats of [8, 32, 64, 96, 128, 136, 256, 512]) {
    for (const automation of [normaliseAssistedOverlapAutomation({ windowBeats: beats }), resizeAssistedOverlapAutomation(DEFAULT_ASSISTED_OVERLAP_AUTOMATION, beats)]) {
      assert.deepEqual(automation.bassSwapBeats, []);
      // Real source-time mapping, including the final beat and either side of Z.
      const window = { start: 37.25, end: 37.25 + beats * 60 / 146 };
      for (const time of [window.start, window.end - 60 / 146, window.end - .000001]) {
        const mix = assistedAutomationAtBeat(automation, transitionPreviewBeat(time, window, beats));
        assert.equal(mix.outgoingLow, 0);
        assert.equal(mix.incomingLow, -60);
        assert.equal(mix.bassOwner, 'outgoing');
        assert.equal(mix.bassSwapProgress, 0);
      }
      for (const time of [window.end, window.end + .05]) {
        const mix = assistedAutomationAtBeat(automation, transitionPreviewBeat(time, window, beats));
        assert.equal(mix.outgoingLow, -60);
        assert.equal(mix.incomingLow, 0);
        assert.equal(mix.bassOwner, 'incoming');
        assert.equal(mix.bassSwapProgress, 1);
      }
    }
  }
});

test('removing the last selected cut survives a saved draft and resizing without resurrecting the old cue', () => {
  const selected = normaliseAssistedOverlapAutomation({ windowBeats: 64, bassSwapBeat: 16 });
  const cleared = normaliseAssistedOverlapAutomation({ ...selected, bassSwapBeats: toggleBassSwapBeat(selected.bassSwapBeats, 64, 16) });
  const draft = parsePreviewDraft(JSON.parse(JSON.stringify({
    outgoingTrackId: 'out', incomingTrackId: 'in', outgoingWindow: { start: 10, end: 42 }, incomingWindow: { start: 20, end: 52 },
    beats: 64, bassSwapBeat: cleared.bassSwapBeat, bassSwapBeats: cleared.bassSwapBeats,
  })));
  assert.deepEqual(draft.bassSwapBeats, []);
  const restored = normaliseAssistedOverlapAutomation({ windowBeats: draft.beats, bassSwapBeat: draft.bassSwapBeat, bassSwapBeats: draft.bassSwapBeats });
  for (const automation of [restored, resizeAssistedOverlapAutomation(restored, 128)]) {
    const before = assistedAutomationAtBeat(automation, automation.windowBeats - .001);
    assert.equal(before.outgoingLow, 0);
    assert.equal(before.incomingLow, -60);
    assert.deepEqual(automation.bassSwapBeats, []);
  }
});

test('explicit cues and legacy single-cue drafts retain their selected pre-cue sweep', () => {
  for (const cues of [[16], [16, 32, 48]]) {
    const draft = parsePreviewDraft({ outgoingTrackId: 'out', incomingTrackId: 'in', outgoingWindow: { start: 10, end: 42 }, incomingWindow: { start: 20, end: 52 }, beats: 64, bassSwapBeat: cues[0], bassSwapBeats: cues });
    assert.deepEqual(draft.bassSwapBeats, cues);
    const automation = normaliseAssistedOverlapAutomation({ windowBeats: 64, bassSwapBeat: draft.bassSwapBeat, bassSwapBeats: draft.bassSwapBeats });
    assert.equal(assistedAutomationAtBeat(automation, 15).incomingLow, -60);
    assert.ok(Math.abs(assistedAutomationAtBeat(automation, 15.5).incomingLow + 3.01029995664) < 1e-8);
    assert.equal(assistedAutomationAtBeat(automation, 16).incomingLow, 0);
  }
  const legacy = normaliseAssistedOverlapAutomation({ windowBeats: 64, bassSwapBeat: 16 });
  assert.deepEqual(legacy.bassSwapBeats, [16]);
  assert.equal(assistedAutomationAtBeat(legacy, 16).incomingLow, 0);
});

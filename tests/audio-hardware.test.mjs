import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { HardwareAudioOutputs, DEFAULT_OUTPUT_CONFIG as defaults, outputConfigError, parseOutputConfig } from '../lib/audio-output.ts';
import { boothRoutingLevels } from '../lib/booth-audio.ts';
import { AUDIO_HARDWARE_PROFILES } from '../lib/audio-hardware-profiles.ts';
import { MIDI_PRESETS, copyMidiPreset } from '../lib/midi-presets.ts';
import { parseMidiProfile, midiControl, midiButtonPressed } from '../lib/control-bindings.ts';

function context(max = 8) {
  const nodes = [];
  const node = kind => {
    const n = { kind, links: [], gain: { value: 1, setTargetAtTime(v) { this.value = v; } },
      connect(target, output = 0, input = 0) { this.links.push({ target, output, input }); return target; },
      disconnect(target) { this.links = target ? this.links.filter(l => l.target !== target) : []; },
    }; nodes.push(n); return n;
  };
  const c = { nodes, destination: { ...node('destination'), maxChannelCount: max }, currentTime: 0,
    createGain: () => node('gain'), createChannelSplitter: () => node('splitter'), createChannelMerger: () => node('merger'),
    async setSinkId(id) { if (id === 'missing') throw Error('Missing device'); }, async resume() {},
    createMediaStreamDestination() { return { ...node('stream'), stream: { getTracks: () => [] } }; }
  }; return c;
}
function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from) || from.gain?.value === 0) return false;
  seen.add(from); return from.links.some(l => reaches(l.target, target, seen));
}
test('40 unique hardware guides divide into 15 interfaces and 25 audio controllers/mixers', () => {
  assert.equal(AUDIO_HARDWARE_PROFILES.length, 40);
  assert.equal(new Set(AUDIO_HARDWARE_PROFILES.map(p => p.id)).size, 40);
  assert.equal(AUDIO_HARDWARE_PROFILES.filter(p => p.category === 'soundcard').length, 15);
  assert.equal(AUDIO_HARDWARE_PROFILES.filter(p => p.category === 'controller-mixer').length, 25);
  const audio6 = AUDIO_HARDWARE_PROFILES.find(p => p.id === 'ni-audio-6');
  assert.equal(audio6.cuePair, 0); assert.equal(audio6.masterPair, 2);
  for (const p of AUDIO_HARDWARE_PROFILES) { assert.match(p.source, /^https:\/\//); assert.notEqual(p.masterPair, p.cuePair); }
});
test('10 stored MIDI maps survive persistence without invalid or duplicate controls', () => {
  assert.equal(MIDI_PRESETS.length, 10); assert.equal(new Set(MIDI_PRESETS.map(p => p.id)).size, 10);
  for (const preset of MIDI_PRESETS) {
    const bindings = copyMidiPreset(preset.id);
    const parsed = parseMidiProfile(JSON.stringify({ inputId: 'test', bindings }));
    assert.equal(parsed.bindings.length, bindings.length, preset.id);
    assert.equal(new Set(bindings.map(b => `${b.type}:${b.channel}:${b.number}`)).size, bindings.length, preset.id);
    bindings[0].number = 127; assert.notEqual(preset.bindings[0].number, 127);
  }
  assert.equal(midiButtonPressed(midiControl([0x90,11,127])), true);
  assert.equal(midiButtonPressed(midiControl([0x80,11,127])), false);
  assert.equal(midiButtonPressed(midiControl([0x90,11,0])), false);
});
test('independent cue is prefader and preview never closes master or changes cue selection', () => {
  const decks = { A: { track: {}, volume: 0, cue: true }, B: { track: {}, volume: .8, cue: false } };
  for (const legacyMonitor of [false, true]) {
    const normal = boothRoutingLevels(decks, ['A','B'], legacyMonitor, false, true);
    const preview = boothRoutingLevels(decks, ['A','B'], legacyMonitor, true, true);
    assert.equal(normal.A.mainGate, 1); assert.equal(preview.B.mainGate, 1);
    assert.equal(normal.A.channelGain, 0); assert.ok(normal.A.cueGain > 0); assert.equal(normal.B.cueGain, 0);
    assert.equal(preview.A.cueGain, 0); assert.equal(preview.B.cueGain, 0);
    assert.deepEqual(boothRoutingLevels(decks, ['A','B'], legacyMonitor, false, true), normal);
    assert.equal(decks.A.cue, true);
  }
});
test('invalid or overlapping hardware routes are rejected', () => {
  assert.match(outputConfigError({ ...defaults, mode: 'pairs' }, 2), /channels/);
  assert.match(outputConfigError({ ...defaults, mode: 'pairs', masterPair: 0 }, 8), /different/);
  for (const n of [-2, 1, 7, NaN]) assert.ok(outputConfigError({ ...defaults, mode: 'pairs', masterPair: n }, 8));
  for (const id of ['', 'default', 'communications', 'same']) assert.ok(outputConfigError({ ...defaults, mode:'devices', deviceId:id, cueDeviceId:id }, 8));
  assert.equal(parseOutputConfig('{oops'), null);
  assert.deepEqual(parseOutputConfig(JSON.stringify(defaults)), defaults);
});
test('pair graph isolates private buses from recording and assigns the requested physical channels', async () => {
  const c = context(); const router = new HardwareAudioOutputs(c);
  await router.configure({ ...defaults, mode:'pairs' });
  assert.equal(c.destination.channelCount, 8);
  assert.ok(reaches(router.master, router.recording));
  for (const bus of [router.cue, router.preview, router.audition]) assert.equal(reaches(bus, router.recording), false);
  const splits = c.nodes.filter(n => n.kind === 'splitter');
  assert.deepEqual(splits[0].links.map(l => l.input), [2,3]);
  assert.deepEqual(splits[1].links.map(l => l.input), [0,1]);
  await router.configure({ ...defaults, mode:'shared' });
  assert.ok(reaches(router.cue, router.recording));
  assert.ok(reaches(router.preview, router.recording));
  router.dispose(); assert.equal(reaches(router.master, c.destination), false);
});
test('missing output and failed headphone playback mute routes without fallback', async () => {
  const c = context(); const router = new HardwareAudioOutputs(c, () => ({ async setSinkId() {}, async play() { throw Error('No headphones'); }, pause() {} }));
  await assert.rejects(router.configure({ ...defaults, mode:'devices', deviceId:'master', cueDeviceId:'phones' }));
  assert.equal(reaches(router.master, c.destination), false); assert.equal(reaches(router.preview, c.destination), false);
  await assert.rejects(router.configure({ ...defaults, deviceId:'missing' }));
  assert.equal(reaches(router.cue, c.destination), false);
});
test('unplug and interruption while applying cannot unmute a failed route', async () => {
  const c = context(); const router = new HardwareAudioOutputs(c);
  await router.configure({ ...defaults, mode:'pairs', deviceId:'dj' });
  await assert.rejects(router.checkDevices([])); assert.equal(reaches(router.master, c.destination), false);
  c.resume = async () => { router.failClosed(); };
  await assert.rejects(router.configure(defaults), /disconnected during setup/);
  assert.equal(reaches(router.cue, c.destination), false);
});
test('native worklet interleaves all four buses, emits silence to browser and stops cleanly', () => {
  let Processor; const packets = [];
  vm.runInNewContext(fs.readFileSync(new URL('../public/audio-bridge-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage(packet) { packets.push(new Float32Array(packet)); } }; },
    registerProcessor(name, cls) { Processor = cls; }, Float32Array,
  });
  const processor = new Processor(); const out = [[new Float32Array(128).fill(9)]];
  const input = [[1,2,3,4].map(v => new Float32Array(128).fill(v))];
  processor.process(input,out); assert.equal(packets.length,0);
  processor.port.onmessage({data:'start'});
  for (let i=0;i<4;i++) processor.process(input,out);
  assert.equal(packets.length,1); assert.deepEqual([...packets[0].slice(0,8)],[1,2,3,4,1,2,3,4]);
  assert.ok(out[0][0].every(v => v===0));
  processor.port.onmessage({data:'stop'});
  for (let i=0;i<4;i++) processor.process(input,out); assert.equal(packets.length,1);
});

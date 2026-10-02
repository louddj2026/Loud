import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { cueRetriggerTime } from '../lib/transport-cue.ts';
const source = await readFile(new URL('../app/dj/dj-booth.tsx', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('  const playbackCueFor ='), source.indexOf('  function endPitchHold('));
const compiled = ts.transpileModule(handlers + '\nglobalThis.actions = { toggle, returnToCue, startPlayCue, endPlayCue };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ snap = false, referencePlaying = false, analysis = true } = {}) {
  const beats = Array.from({length: 500}, (_, i) => ({ time: i * .5 }));
  const decks = Object.fromEntries(['A', 'B', 'C'].map(id => [id, { track: { id }, analysis: analysis ? { beats, duration: 250 } : null, currentTime: 108.549, cuePoint: 7.1, playing: false, tempoRate: 1.037, loopActive: false, loopStart: 120, loopEnd: 128, volume: .85, low: -6, mid: 2, high: -3 }]));
  const makeAudio = () => ({ currentTime: 108.549, playbackRate: 1.037, paused: true, pause() { this.paused = true; }, async play() { this.paused = false; } });
  const audio = Object.fromEntries(['A','B','C'].map(id => [id, makeAudio()]));
  const shadows = Object.fromEntries(['A','B','C'].map(id => [id, makeAudio()]));
  audio.B.paused = !referencePlaying; if (referencePlaying) audio.B.currentTime = 20.125;
  const context = { bufferedDecks: {current:{}}, ensureBufferedLoop: async()=>{}, cueRetriggerTime, DECK_IDS: ['A','B','C'], decksCurrent: { current: decks }, playbackCues: { current: {} }, playCueTokens: { current: { A: 0, B: 0, C: 0 } }, playCuePreviews: { current: {} }, lastPlaying: { current: [] }, activeAudio: id => audio[id], standbyAudio: id => shadows[id], mediaRefs: Object.fromEntries(['A','B','C'].map(id => [id, [{current:audio[id]}, {current:shadows[id]}]])), endPitchHold() {}, cancelLoopTransition(id) { shadows[id].pause(); }, loopCycleArmed: { current: {} }, changeDeck: (id, patch) => Object.assign(decks[id], patch), prepareLoopStandby() {}, ensureGraph: async () => {}, isRecording: () => false, reportCrowdLiveEvent() {}, gridSnapCurrent: { current: snap } };
  vm.runInNewContext(compiled, context);
  return { ...context.actions, audio, shadows, decks, context };
}
test('each deck remembers exact regular-play start and orange cue pauses both media at that start', async () => {
  for (const id of ['A','B','C']) {
    const h = setup(); await h.toggle(id); h.audio[id].currentTime = 114.8; h.shadows[id].paused = false;
    h.returnToCue(id);
    assert.equal(h.audio[id].currentTime, 108.549); assert.equal(h.audio[id].paused, true); assert.equal(h.shadows[id].paused, true);
    assert.equal(h.decks[id].playing, false); assert.equal(h.audio[id].playbackRate, 1.037);
  }
});
test('playing Playcue retriggers saved start and release keeps playing with tempo and EQ unchanged', async () => {
  const h = setup(); await h.toggle('A'); h.audio.A.currentTime = 114.8;
  await h.startPlayCue('A'); h.endPlayCue('A');
  assert.equal(h.audio.A.currentTime, 108.549); assert.equal(h.audio.A.paused, false);
  assert.equal(h.audio.A.playbackRate, 1.037); assert.equal(h.decks.A.tempoRate, 1.037);
  assert.deepEqual([h.decks.A.low,h.decks.A.mid,h.decks.A.high,h.decks.A.volume],[-6,2,-3,.85]);
});
test('snap matches the other playing deck phase without moving the saved cue or changing rate', async () => {
  const h = setup({snap:true, referencePlaying:true}); await h.toggle('A'); h.audio.A.currentTime = 114;
  await h.startPlayCue('A'); assert.equal(h.audio.A.currentTime,108.625); assert.equal(h.audio.A.playbackRate,1.037);
  h.returnToCue('A'); assert.equal(h.audio.A.currentTime,108.549); assert.equal(h.audio.A.paused,true);
});
test('snap off or no other playing deck preserves the exact cue', async () => {
  for (const options of [{snap:false,referencePlaying:true},{snap:true,referencePlaying:false}]) {
    const h=setup(options); await h.toggle('A'); h.audio.A.currentTime=114; await h.startPlayCue('A');
    assert.equal(h.audio.A.currentTime,108.549);
  }
});
test('paused Playcue remains a momentary audition, even without analysis', async () => {
  const h=setup({analysis:false}); await h.startPlayCue('A'); assert.equal(h.audio.A.paused,false);
  h.audio.A.currentTime=112; h.endPlayCue('A'); assert.equal(h.audio.A.currentTime,108.549); assert.equal(h.audio.A.paused,true);
});
test('a new regular play from a new paused position establishes a new return position', async () => {
  const h=setup(); await h.toggle('A'); await h.toggle('A'); h.audio.A.currentTime=140.123;
  await h.toggle('A'); h.audio.A.currentTime=149; h.returnToCue('A'); assert.equal(h.audio.A.currentTime,140.123);
});
test('return cancels an outstanding Play start before it can resume the deck', async () => {
  const h=setup(); let resolve; h.context.ensureGraph=()=>new Promise(r=>{resolve=r;});
  const pending=h.toggle('A'); h.returnToCue('A'); resolve(); await pending;
  assert.equal(h.audio.A.paused,true); assert.equal(h.audio.A.currentTime,108.549);
});
test('cue outside an armed loop releases it, while a containing loop is retained', async () => {
  const h=setup(); await h.toggle('A'); h.decks.A.loopActive=true; h.returnToCue('A'); assert.equal(h.decks.A.loopActive,false);
  h.decks.A.loopStart=108; h.decks.A.loopEnd=116; h.decks.A.loopActive=true; h.returnToCue('A'); assert.equal(h.decks.A.loopActive,true);
});
test('missing or out-of-range grids cannot cause a remote cue jump', () => {
  assert.equal(cueRetriggerTime(108.549,undefined,{beats:[{time:0},{time:.5}],time:.1}),108.549);
  assert.equal(cueRetriggerTime(108.549,[{time:0},{time:.5}],{beats:[{time:0},{time:.5}],time:.1}),108.549);
});

test('return cancels a buffered decode before regular Play can start it', async()=>{const h=setup();let resolve;h.context.ensureBufferedLoop=()=>new Promise(r=>{resolve=r;});const pending=h.toggle('A');h.returnToCue('A');resolve();await pending;assert.equal(h.audio.A.paused,true);});
test('releasing Playcue during buffered decode prevents a late audition', async()=>{const h=setup();let resolve;h.context.ensureBufferedLoop=()=>new Promise(r=>{resolve=r;});const pending=h.startPlayCue('A');h.endPlayCue('A');resolve();await pending;assert.equal(h.audio.A.paused,true);});

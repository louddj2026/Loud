import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/dj/dj-booth.tsx', import.meta.url), 'utf8');
function functions(names, context) {
  const parts = names.map(name => {
    const from = source.indexOf(`  const ${name} =`);
    assert.ok(from >= 0, name);
    const to = source.indexOf('\n  const ', from + 1);
    return source.slice(from, to);
  }).join('\n');
  const js = ts.transpileModule(parts, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${js}; return {${names.join(',')}}`)(...Object.values(context));
}
function fixture() {
  const calls = [];
  const ref = current => ({ current });
  const media = { currentSrc: '/track', paused: true, ended: false };
  const context = {
    mediaRefs: { A: [ref(media)] }, decksCurrent: ref({ A: { playing: false } }),
    changeDeck: (id, patch) => Object.assign(context.decksCurrent.current[id], patch),
    demoRuntime: ref({ transitionIndex: 0, prepared: { plan: { tracks: [{deck: 'A'}, {deck: 'B'}] } } }),
    demoToken: ref(3), assistedToken: ref(4), liveToken: ref(5),
    demoTimer: ref(null), emergencyTimer: ref(null), assistedPlaying: ref(true),
    assistedRunning: ref(true), liveRunning: ref(false), assistedReplaySnapshot: ref({}),
    publishPreparedDemo: value => calls.push(['prepared', value]),
    fileLoadDeck: ref('B'), fileInput: ref({ click: () => calls.push(['picker']) }),
    reportCrowdLiveEvent: (...args) => calls.push(args),
  };
  for (const name of ['setAssistedPending','setAssistedCueState','setAssistedMode','setLiveMode','setDemoMode','setAssistedStatus','setWorkflowDeck','setLoopTeachingStatus']) context[name] = (...args) => calls.push([name,...args]);
  return { context, calls, media, ...functions(['manualDeckLoadBlockReason','prepareManualDeckLoad','openLocalFile'], context) };
}
test('Load opens on a paused armed deck without disarming on picker open/cancel', () => {
  const f=fixture(); f.openLocalFile('A');
  assert.ok(f.calls.some(c => c[0] === 'picker'));
  assert.equal(f.context.demoToken.current, 3);
  assert.ok(f.context.demoRuntime.current);
});
test('Load blocks actual playing media, even when the rendered playing flag is stale', () => {
  const f=fixture(); f.media.paused=false; f.openLocalFile('A');
  assert.ok(!f.calls.some(c => c[0] === 'picker'));
  assert.throws(() => f.prepareManualDeckLoad('A'), /is playing/);
  assert.equal(f.context.demoToken.current, 3);
});
test('replacement selection clears the armed transition without touching other audio', () => {
  const f=fixture(); f.context.decksCurrent.current.A.playing=true;
  f.prepareManualDeckLoad('A');
  assert.equal(f.context.demoRuntime.current, null);
  assert.equal(f.context.demoToken.current, 4);
  assert.equal(f.context.assistedPlaying.current, false);
  assert.equal(f.context.decksCurrent.current.A.playing, false);
  assert.equal(f.media.paused, true);
});
test('a new playback start while the picker is open blocks replacement', () => {
  const f=fixture(); f.openLocalFile('A'); f.media.paused=false;
  assert.throws(() => f.prepareManualDeckLoad('A'), /is playing/);
  assert.ok(f.context.demoRuntime.current);
});
test('closing Preview clears both override roles and invalidates pending override callbacks', () => {
  const ref=current=>({current}); let armed={outgoing:'old-track',incoming:'other-track'};
  const context={ gridOverrideSession:ref(5), setGridOverrideArmed:v=>{armed=v;},
    transitionPreviewCurrent:ref(null), transitionPreviewOutgoingVisualTime:ref(4), transitionPreviewIncomingVisualTime:ref(6),
    stopTransitionPreviewPlayback:()=>{}, transitionPreviewGraphs:ref({}), releaseTransitionPreviewAudio:()=>{},
    transitionPreviewBassKill:ref({}), setPreviewMonitorRouting:()=>{}, setTransitionPreview:()=>{}, reportCrowdLiveEvent:()=>{} };
  functions(['closeTransitionPreview'],context).closeTransitionPreview();
  assert.deepEqual(armed,{outgoing:null,incoming:null});
  assert.equal(context.gridOverrideSession.current,6);
});

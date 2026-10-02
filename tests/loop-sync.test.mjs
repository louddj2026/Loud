import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { loopTempoBpm, loopStandbyPosition } from '../lib/loop-grid.ts';
const source = await readFile(new URL('../app/dj/dj-booth.tsx', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('  const syncBeat ='), source.indexOf('  const stepTempo ='));
const compiled = ts.transpileModule(handlers + '\nglobalThis.actions={syncBeat,syncTempo};', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup() {
  const deck = (start,end,bpm) => ({currentTime:0,tempoRate:1,loopActive:true,loopStart:start,loopEnd:end,loopSize:64,analysis:{beats:Array.from({length:400},(_,i)=>({time:i*.5})),bpm}});
  const decks={A:deck(10,36.295621,146),B:deck(36.21027472019723,62.516617899028404,145.763),C:deck(26.361432484795568,52.657053751679214,146)};
  const audios=Object.fromEntries(Object.entries(decks).map(([id,d])=>[id,{currentTime:d.loopStart+2.15,playbackRate:1}]));
  const calls=[];
  const h={decksCurrent:{current:decks},loopTempoBpm,endPitchHold(){},syncReferenceFor:id=>id==='B'?'C':'B',activeAudio:id=>audios[id],standbyAudio:()=>null,bpmAt:d=>d.analysis.bpm,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),tempoRateForTargetBpm:(source,target)=>target/source,effectiveDeckBpm:(bpm,rate)=>bpm*rate,changeDeck:(id,p)=>Object.assign(decks[id],p),beatPhase:d=>({fraction:(d.currentTime%.5)/.5}),seek:(...args)=>calls.push(args)};
  vm.runInNewContext(compiled,h); return {...h.actions,decks,audios,calls};
}
test('B/C measured loop spans play equal cycles despite stale analysed BPM',()=>{
 const h=setup(); h.syncTempo('B');
 const b=h.decks.B,c=h.decks.C;
 assert.ok(Math.abs((b.loopEnd-b.loopStart)/b.tempoRate-(c.loopEnd-c.loopStart)/c.tempoRate)<1e-10);
 assert.ok(Math.abs(b.tempoRate-1.000407744)<1e-7);
});
test('A/B and B/C use the same loop-tempo rule, including unequal loop beat counts',()=>{
 for (const id of ['A','B']) {const h=setup(); const ref=id==='A'?'B':'C'; h.decks[id].loopSize=32; h.decks[id].loopEnd=h.decks[id].loopStart+(h.decks[id].loopEnd-h.decks[id].loopStart)/2; h.syncTempo(id); assert.ok(Math.abs(loopTempoBpm(h.decks[id])*h.decks[id].tempoRate-loopTempoBpm(h.decks[ref]))<1e-10);}
});
test('beat sync reads media time and preserves the reference fractional beat with grid snap enabled',()=>{
 const h=setup(); h.audios.B.currentTime=40.1; h.audios.C.currentTime=30.375; h.syncBeat('B');
 assert.equal(h.calls[0][2],false); assert.equal(h.calls[0][1],39.875);
});
test('handoff retains overshoot instead of repeating the start late',()=>{
 assert.equal(loopStandbyPosition(10,18,18.06,0),10.059999999999999);
});
test('repeated seam delays are compensated rather than accumulating over 100 cycles',()=>{
 let debt=0; for(let cycle=0;cycle<100;cycle++) {const requested=loopStandbyPosition(10,18,18.062,debt);const actual=requested-.012;debt+=actual-(10+.062);assert.ok(Math.abs(debt+.012)<1e-10);}
});
test('missing or inactive loops do not invent a loop BPM',()=>{
 assert.equal(loopTempoBpm({loopActive:false,loopStart:10,loopEnd:18,loopSize:16}),null);
 assert.equal(loopTempoBpm({loopActive:true,loopStart:null,loopEnd:18,loopSize:16}),null);
});

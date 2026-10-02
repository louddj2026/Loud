import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHelpPreferences, dismissControlHelp, describeControl } from '../lib/control-help.ts';
const describe = (label, classes='', preview=false, context='', title='') => describeControl({label,classes,preview,context,title});
test('saved global off and individual dismissals survive a preferences round trip', () => {
 const p=dismissControlHelp({enabled:false,dismissed:[]},'booth:play');
 assert.deepEqual(parseHelpPreferences(JSON.stringify(p)),{enabled:false,dismissed:['booth:play']});
 assert.deepEqual(dismissControlHelp(p,'booth:play'),p);
});
test('corrupt saved preferences recover to enabled help without throwing', () => {
 assert.deepEqual(parseHelpPreferences('{broken'),{enabled:true,dismissed:[]});
 assert.deepEqual(parseHelpPreferences('{"dismissed":[1,"a","a"]}'),{enabled:true,dismissed:['a']});
});
test('a dismissed control keeps its identity across deck and playing-state changes', () => {
 assert.equal(describe('Play Deck A','wave-play-toggle').id,describe('Pause Deck C','wave-play-toggle active').id);
 assert.notEqual(describe('Play Deck A','wave-play-toggle').id,describe('Play Mix Out preview','',true).id);
});
test('transport help distinguishes exact paused return from playing beat-aligned retrigger', () => {
 assert.match(describe('Return Deck A to its cue','wave-return-cue').body,/exact.*pause/);
 const body=describe('Play Deck A from cue','wave-play-cue').body;
 assert.match(body,/keep playing/); assert.match(body,/Snap to Grid/); assert.match(body,/Tempo stays unchanged/);
});
test('private edit explanations describe the actual scope and replication limitation', () => {
 assert.match(describe('REPLICATE','transition-preview-replicate',true).body,/Preview only/);
 assert.match(describe('APPLY','transition-preview-save',true).body,/does not seek or pause/);
 assert.equal(describe('128','active',true,'transition-preview-beats').id,'preview:overlap-length');
});

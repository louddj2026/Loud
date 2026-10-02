import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_HOTKEYS,parseHotkeys,keyChord,bindHotkey,midiControl,midiButtonPressed,midiEqDb,sameMidiControl,parseMidiProfile} from '../lib/control-bindings.ts';
test('saved remaps and explicit unassignments persist while bass defaults are 5/6/7',()=>{
 assert.deepEqual(['A','B','C'].map(d=>DEFAULT_HOTKEYS[`bass:${d}`]),['Digit5','Digit6','Digit7']);
 const p=parseHotkeys(JSON.stringify({'play:A':'KeyR','loop:A':''})); assert.equal(p['play:A'],'KeyR');assert.equal(p['loop:A'],'');assert.equal(p['bass:C'],'Digit7');
 assert.deepEqual(parseHotkeys('{'),DEFAULT_HOTKEYS);
});
test('duplicate key mappings are refused and numpad keys resolve consistently',()=>{
 assert.ok(bindHotkey(DEFAULT_HOTKEYS,'play:A','Digit6').conflict);
 assert.equal(bindHotkey(DEFAULT_HOTKEYS,'play:A','KeyR').bindings['play:A'],'KeyR');
 assert.equal(keyChord({code:'Numpad5'}),'Digit5');assert.equal(keyChord({code:'Digit3',shiftKey:true}),'Shift+Digit3');
});
test('MIDI note releases and CC releases never count as button presses',()=>{
 assert.equal(midiButtonPressed(midiControl([0x90,40,127])),true);
 assert.equal(midiButtonPressed(midiControl([0x80,40,127])),false);
 assert.equal(midiButtonPressed(midiControl([0x90,40,0])),false);
 assert.equal(midiButtonPressed(midiControl([0xb0,40,0])),false);
 assert.equal(midiButtonPressed(midiControl([0xb0,40,127])),true);
 assert.equal(midiControl([0xf8]),null);
 assert.equal(sameMidiControl(midiControl([0xb0,1,64]),midiControl([0xb1,1,64])),false);
});
test('MIDI EQ has exact kill, neutral and full gain points',()=>{
 assert.equal(midiEqDb(0),-60);assert.equal(midiEqDb(64),0);assert.equal(midiEqDb(127),12);
});
test('MIDI persistence validates channel, controller, action and continuous-input type',()=>{
 const good={type:'cc',channel:0,number:8,action:'volume:B',continuous:true};
 const p=parseMidiProfile(JSON.stringify({inputId:'device',bindings:[good,{...good,type:'note'},{...good,channel:16},{...good,number:128},{...good,action:'bogus'}]}));
 assert.deepEqual(p.bindings,[good]);assert.equal(parseMidiProfile('{'),null);
});

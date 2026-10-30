import test from 'node:test';
import assert from 'node:assert/strict';
import {validAudioMapping} from './playerAudio.mjs';
const mapping=()=>({schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qaa'},{slot:1,language:'en',providerCode:'qab'}]});
test('recording channel inventory preserves unique slots, languages and provider codes',()=>{
  assert(validAudioMapping(mapping()));
  for(const change of [m=>m.schemaVersion=2,m=>m.channels=[],m=>m.channels[1].slot=0,m=>m.channels[1].language='or',m=>m.channels[1].providerCode='qaa',m=>m.channels[1].slot=32,m=>m.channels[1].language='English',m=>m.channels[1].providerCode='unknown']){
    const m=mapping();change(m);assert.equal(validAudioMapping(m),false);
  }
});

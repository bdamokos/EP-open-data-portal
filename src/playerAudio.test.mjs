import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPlayerAudio, requestPlayerPlayback, playerAudioTarget, matchesAudioRepresentation, validAudioMapping, PLAYER_ORIGIN } from './playerAudio.mjs';
const mapping={schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qbf'},{slot:1,language:'en',providerCode:'qbd'},{slot:16,language:'hu',providerCode:'qaw'}]};
function harness() {
  const calls=[]; let handler;
  const target={postMessage:(data,origin)=>calls.push({data,origin})};
  const eventTarget={addEventListener:(_,fn)=>handler=fn,removeEventListener:()=>handler=null};
  return {target,eventTarget,calls,receive:(data,patch={})=>handler?.({origin:PLAYER_ORIGIN,source:target,data,...patch})};
}
const getter=(name,result)=>({key:`get:${name}`,isError:false,result});
const adaptation=id=>({key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:id}});
const quality=(id,other=id)=>({key:'event:audiodownloadqualitychanged',isError:false,result:{type:'audiodownloadqualitychanged',targetQualityId:id,targetQuality:{id:other,label:other}}});
const wait=()=>new Promise(r=>setTimeout(r,8));
function start(h,language,onRequested,onError) {return requestPlayerAudio(h.target,language,{mapping,eventTarget:h.eventTarget,onRequested,onError,delayMs:1,intervalMs:100,timeoutMs:2000});}
function inventory(h,tracks=['qbf','qbd','qaw'],labels=[['qbf','audio01'],['qbd','audio02'],['qaw','audio17']]) {h.receive(getter('availableAudio',tracks));h.receive(getter('availableLang',labels));}
test('original slots preserve gaps; private HU uses slot16/qaw/audio17, never display order',async()=>{
  const h=harness();let requested=0;const stop=start(h,'hu',()=>requested++);
  inventory(h);h.receive(adaptation('audio01 AUDIO'));await wait();assert.equal(requested,0);
  assert.deepEqual(h.calls.find(c=>c.data.type==='set'),{data:{type:'set',name:'audio',value:'hu'},origin:PLAYER_ORIGIN});
  h.receive(adaptation('audio15 AUDIO'));assert.equal(requested,0);
  h.receive(adaptation('audio17 AUDIO'));h.receive(adaptation('audio17 AUDIO'));assert.equal(requested,1);
  assert.equal(h.calls.filter(c=>c.data.type==='set').length,1);stop();assert(h.calls.filter(c=>c.data.type==='off').length>=4);
});
test('strict frame/origin and post-selection events; original cannot release EN',async()=>{
  const h=harness();let requested=0;const stop=start(h,'en',()=>requested++);
  h.receive(getter('availableAudio',['qbd']),{origin:'https://evil.test'});h.receive(getter('availableLang',[['qbd','audio02']]),{source:{}});
  h.receive(adaptation('audio02 AUDIO'));inventory(h);h.receive(adaptation('audio01 AUDIO'));await wait();assert.equal(requested,0);
  h.receive(adaptation('audio01 AUDIO'));h.receive(adaptation('audio02 AUDIO'),{source:{}});assert.equal(requested,0);
  h.receive(adaptation('audio02 AUDIO'));assert.equal(requested,1);stop();
});
test('ISO runtime code preferred over private map; quality checks ID consistency',async()=>{
  const h=harness();let requested=0;const stop=start(h,'en',()=>requested++);
  inventory(h,['or','en','qbd'],[['or','Original'],['en','English'],['qbd','audio02']]);h.receive(adaptation('Original audio0'));await wait();
  h.receive(quality('English audio0','Magyar audio0'));h.receive(adaptation('audio02 AUDIO'));assert.equal(requested,0);
  h.receive(quality('English audio0'));assert.equal(requested,1);stop();
});
test('initial original representation retained before inventory and requires no setter',()=>{
  const h=harness();let requested=0;const stop=start(h,'or',()=>requested++);
  h.receive(adaptation('audio01 AUDIO'));inventory(h);assert.equal(requested,1);assert.equal(h.calls.filter(c=>c.data.type==='set').length,0);stop();
});
test('missing/ambiguous inventory fails closed',()=>{
  for(const [tracks,labels] of [[['en'],[['en','English'],['en','English']]], [['en','qbd'],[['en','English'],['qbd','English']]], [['qbf'],[['qbf','Original']]]]) {
    const h=harness();let error;start(h,'en',()=>assert.fail(),e=>error=e);inventory(h,tracks,labels);assert.match(error,/could not be loaded/);assert.equal(h.calls.filter(c=>c.data.type==='set').length,0);
  }
});
test('no event proof or empty readiness times out; closing cancels pending setter',async()=>{
  const h=harness();let error;requestPlayerAudio(h.target,'en',{mapping,eventTarget:h.eventTarget,onError:e=>error=e,timeoutMs:10,intervalMs:2});h.receive(getter('availableAudio',[]));await new Promise(r=>setTimeout(r,20));assert.match(error,/could not be loaded/);
  const closed=harness();const stop=start(closed,'hu',()=>assert.fail());inventory(closed);stop();await wait();assert.equal(closed.calls.filter(c=>c.data.type==='set').length,0);
});
test('mapping duplicates/shifted slots and malformed labels rejected; representation is anchored/escaped',()=>{
  assert(validAudioMapping(mapping));assert(!validAudioMapping({schemaVersion:1,channels:[mapping.channels[0],mapping.channels[0]]}));
  assert.equal(playerAudioTarget('hu',mapping,['qad'],[['qad','audio15']]),null);
  assert(matchesAudioRepresentation('English','English audio0'));assert(matchesAudioRepresentation('a.+','a.+ AUDIO'));
  for(const id of ['prefix English audio0','English audio0 trailing','English AUDIO2','English audio']) assert(!matchesAudioRepresentation('English',id));
});
test('play acknowledges only the exact official frame and method reply',()=>{
  const h=harness();let requested=0;
  const stop=requestPlayerPlayback(h.target,{eventTarget:h.eventTarget,onRequested:()=>requested++,timeoutMs:2000});
  assert.deepEqual(h.calls[0],{data:{type:'method',name:'play'},origin:PLAYER_ORIGIN});
  const success={key:'method:play',isError:false};
  h.receive(success,{origin:'https://example.org'});h.receive(success,{source:{}});h.receive({key:'set:audio',isError:false});
  assert.equal(requested,0);
  h.receive(success);h.receive(success);assert.equal(requested,1);stop();
});
test('play refusal and a missing reply leave a manual-play fallback',async()=>{
  const h=harness();let message;
  requestPlayerPlayback(h.target,{eventTarget:h.eventTarget,onError:value=>message=value,timeoutMs:2000});
  h.receive({key:'method:play',isError:true});assert.match(message,/Press Play/);
  const timed=harness();let expired=false;
  requestPlayerPlayback(timed.target,{eventTarget:timed.eventTarget,onError:()=>expired=true,timeoutMs:5});
  await new Promise(r=>setTimeout(r,15));assert.equal(expired,true);
});
test('closing a player cancels its pending play acknowledgement',()=>{
  const h=harness();let requested=false;
  const stop=requestPlayerPlayback(h.target,{eventTarget:h.eventTarget,onRequested:()=>requested=true,timeoutMs:2000});stop();
  h.receive({key:'method:play',isError:false});assert.equal(requested,false);
});
test('cancelled former-frame messages cannot select or start its replacement',async()=>{
  const listeners=new Set();const calls=[];
  const eventTarget={addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  const frame=name=>({postMessage:(data,origin)=>calls.push({name,data,origin})});
  const old=frame('old'),next=frame('next');let selected=0;
  const receive=(source,data)=>[...listeners].forEach(fn=>fn({origin:PLAYER_ORIGIN,source,data}));
  const open=target=>requestPlayerAudio(target,'hu',{mapping,eventTarget,delayMs:1,timeoutMs:2000,onRequested:()=>{selected++;requestPlayerPlayback(target,{eventTarget,timeoutMs:2000,onRequested:()=>{},onError:()=>{}});}});
  const stop=open(old);stop();const stopNext=open(next);
  for(const target of [old,next]){receive(target,getter('availableAudio',['qbf','qaw']));receive(target,getter('availableLang',[['qbf','audio01'],['qaw','audio17']]));receive(target,adaptation('audio01 AUDIO'));}
  await wait();receive(old,adaptation('audio17 AUDIO'));receive(old,{key:'method:play',isError:false});
  assert.equal(selected,0);assert.equal(calls.filter(x=>x.data.name==='play').length,0);
  receive(next,adaptation('audio17 AUDIO'));assert.equal(selected,1);assert.deepEqual(calls.filter(x=>x.data.name==='play').map(x=>x.name),['next']);
  receive(next,{key:'method:play',isError:false});stopNext();
});

test('a later wrong adaptation pauses and fails without a second selection callback',async()=>{
  const h=harness();let requested=0,error;const stop=start(h,'hu',()=>requested++,e=>error=e);inventory(h);h.receive(adaptation('audio01 AUDIO'));await wait();h.receive(adaptation('audio17 AUDIO'));assert.equal(requested,1);h.receive(adaptation('audio15 AUDIO'));assert.match(error,/could not be loaded/);assert.equal(requested,1);assert.equal(h.calls.filter(c=>c.data.name==='pause').length,1);stop();
});
test('ready getters and initial English do not bypass delayed wrapper Original initialization',async()=>{
  const h=harness();let requested=0;const stop=start(h,'en',()=>requested++);h.receive(adaptation('English audio0'));inventory(h,['or','en'],[['or','ଓଡ଼ିଆ'],['en','English']]);await wait();assert.equal(h.calls.filter(c=>c.data.type==='set').length,0);h.receive(adaptation('ଓଡ଼ିଆ audio0'));await wait();assert.equal(h.calls.filter(c=>c.data.type==='set').length,1);assert.equal(requested,0);h.receive(adaptation('English audio0'));assert.equal(requested,1);stop();
});

test('inventory readiness re-registers early cached subscriptions and keeps repair polling until proof',async()=>{
  const h=harness();let requested=0;const stop=requestPlayerAudio(h.target,'or',{mapping,eventTarget:h.eventTarget,onRequested:()=>requested++,delayMs:1,intervalMs:2,timeoutMs:2000});inventory(h);const earlyOffs=h.calls.filter(c=>c.data.type==='off').length;await wait();assert(h.calls.filter(c=>c.data.type==='off').length>earlyOffs);assert.equal(requested,0);assert.equal(h.calls.filter(c=>c.data.type==='set'&&c.data.value==='or').length,1);h.receive(adaptation('audio01 AUDIO'));assert.equal(requested,1);const calls=h.calls.length;await wait();assert.equal(h.calls.length,calls);stop();
});

test('missed initial OR requires alternate AND return-OR events; late OR cannot bypass pending probe',async()=>{
  const h=harness();let requested=0;
  const stop=requestPlayerAudio(h.target,'or',{mapping,eventTarget:h.eventTarget,onRequested:()=>requested++,delayMs:1,repairDelayMs:4,intervalMs:100,timeoutMs:2000});inventory(h);await wait();
  assert.deepEqual(h.calls.filter(c=>c.data.type==='set').map(c=>c.data.value),['or','en']);
  h.receive(adaptation('audio01 AUDIO'));assert.equal(requested,0);
  h.receive(adaptation('audio02 AUDIO'));assert.equal(requested,0);
  assert.deepEqual(h.calls.filter(c=>c.data.type==='set').map(c=>c.data.value),['or','en','or']);
  h.receive(adaptation('audio01 AUDIO'));assert.equal(requested,1);stop();
});
test('repairing missed initial OR still gates HU on a later requested representation',async()=>{
  const h=harness();let requested=0;
  const stop=requestPlayerAudio(h.target,'hu',{mapping,eventTarget:h.eventTarget,onRequested:()=>requested++,delayMs:1,repairDelayMs:4,intervalMs:100,timeoutMs:2000});inventory(h);await wait();
  h.receive(adaptation('audio02 AUDIO'));h.receive(adaptation('audio01 AUDIO'));await wait();assert.equal(requested,0);
  assert.deepEqual(h.calls.filter(c=>c.data.type==='set').map(c=>c.data.value),['en','or','hu']);
  h.receive(adaptation('audio17 AUDIO'));assert.equal(requested,1);stop();
});
test('paused round trip cancels on close, rejects stale frame events and fails without alternate inventory',async()=>{
  const h=harness();let requested=0;
  const stop=requestPlayerAudio(h.target,'or',{mapping,eventTarget:h.eventTarget,onRequested:()=>requested++,delayMs:1,repairDelayMs:4,timeoutMs:2000});inventory(h);await wait();
  h.receive(adaptation('audio02 AUDIO'),{source:{}});assert.equal(h.calls.filter(c=>c.data.type==='set').length,2);stop();h.receive(adaptation('audio02 AUDIO'));assert.equal(requested,0);
  const only=harness();let error;requestPlayerAudio(only.target,'or',{mapping,eventTarget:only.eventTarget,onError:e=>error=e,delayMs:1,repairDelayMs:4,timeoutMs:2000});inventory(only,['qbf'],[['qbf','audio01']]);await wait();assert.match(error,/could not be loaded/);assert.equal(only.calls.filter(c=>c.data.type==='set').length,1);
});

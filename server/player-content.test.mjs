import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchPlayerContent, validatePlayerContent, playerContent, playerAudioMapping, CONTENT_SOCKET_URL } from './player-content.mjs';

const id='20260521-0900-PLENARY';
const map=Array.from({length:32},()=>null);map[0]={lang:'OR',sort:1};map[1]={lang:'EN',sort:9};map[16]={lang:'HU',sort:15};
const content={commonId:id,visibility:'PUBLISHED',startDate:'2026-05-21T07:02:38Z',endDate:'2026-05-21T13:49:30Z',languageMapping:map};
const record={url:CONTENT_SOCKET_URL,namespace:'/content',event:'join:event',fetchedAt:'2026-10-14T06:56:32.181Z',payload:content};

test('published record mapping preserves physical slots and never mistakes display sort for the channel',()=>{
  const result=playerAudioMapping(record);
  assert.deepEqual(result.channels,[{slot:0,language:'or',providerCode:'qbf'},{slot:1,language:'en',providerCode:'qbd'},{slot:16,language:'hu',providerCode:'qaw'}]);
  assert.equal(result.source.recordingId,id);assert.match(result.source.payloadSha256,/^[0-9a-f]{64}$/);
  assert.throws(()=>validatePlayerContent({...content,visibility:'PRIVATE'},id));
  assert.throws(()=>validatePlayerContent({...content,commonId:'20260522-0900-PLENARY'},id));
  assert.throws(()=>validatePlayerContent({...content,languageMapping:[map[0],map[0]]},id));
});

test('anonymous Socket.IO read uses the published namespace and exact record, closes its own connection and rejects denied or oversized answers',async()=>{
  let instance;let mode='success';
  class Socket extends EventTarget {
    constructor(...args){super();assert.deepEqual(args,[CONTENT_SOCKET_URL]);instance=this;this.sent=[];queueMicrotask(()=>this.emit('0'+JSON.stringify({sid:'test-only',pingInterval:25000,pingTimeout:20000})));}
    emit(data){this.dispatchEvent(new MessageEvent('message',{data}));}
    send(packet){this.sent.push(packet);if(packet==='40/content,')queueMicrotask(()=>this.emit('40/content,{"sid":"test-only"}'));else if(packet.startsWith('42/content,0'))queueMicrotask(()=>this.emit(mode==='oversize'?'x'.repeat(2*1024*1024+1):'43/content,0'+JSON.stringify([{contentEvent:mode==='denied'?null:content}])));}
    close(){this.closed=true;this.dispatchEvent(new Event('close'));}
  }
  assert.deepEqual(await fetchPlayerContent(id,{WebSocketImpl:Socket}),content);
  assert.deepEqual(instance.sent,['40/content,','42/content,0["join:event",{"commonId":"20260521-0900-PLENARY"}]']);assert.equal(instance.closed,true);
  mode='denied';await assert.rejects(fetchPlayerContent(id,{WebSocketImpl:Socket}),/unpublished/);assert.equal(instance.closed,true);
  mode='oversize';await assert.rejects(fetchPlayerContent(id,{WebSocketImpl:Socket}),/oversized/);assert.equal(instance.closed,true);
  class Silent extends EventTarget {close(){this.closed=true;}}
  await assert.rejects(fetchPlayerContent(id,{WebSocketImpl:Silent,timeoutMs:10}),/timed out/);
});

test('concurrent cold content reads coalesce and persist a complete reproducible API record',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'player-content-cold-'));let calls=0;
  const fetchContent=async()=>{calls++;return content;};
  try {
    const [a,b]=await Promise.all([playerContent(id,directory,{fetchContent}),playerContent(id,directory,{fetchContent})]);
    assert.equal(calls,1);assert.equal(a.fetchedAt,b.fetchedAt);
    const saved=JSON.parse(await readFile(path.join(directory,'content',id+'.json'),'utf8'));
    assert.deepEqual(saved.payload,content);assert.equal(saved.url,CONTENT_SOCKET_URL);assert.equal(saved.event,'join:event');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('expired content mapping remains last good with truthful source date when one background refresh fails',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'player-content-stale-'));let calls=0;
  const saved={...record,fetchedAt:'2026-01-01T00:00:00Z'};
  await mkdir(path.join(directory,'content'));await writeFile(path.join(directory,'content',id+'.json'),JSON.stringify(saved));
  try {
    const fetchContent=async()=>{calls++;throw new Error('upstream failed');};
    const a=await playerContent(id,directory,{fetchContent});assert.equal(a.stale,true);assert.equal(a.fetchedAt,saved.fetchedAt);
    for(let i=0;i<50&&!calls;i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(calls,1);await new Promise(resolve=>setTimeout(resolve,10));
    const b=await playerContent(id,directory,{fetchContent});assert.match(b.refreshError,/upstream failed/);assert.equal(calls,1);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'content',id+'.json'),'utf8')),saved);
  } finally {await rm(directory,{recursive:true,force:true});}
});

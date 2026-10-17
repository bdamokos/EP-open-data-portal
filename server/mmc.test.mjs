import test from 'node:test';
import assert from 'node:assert/strict';
import { clipUrl, matchRecording, officialEmbed, recordingDetail, speechMedia, validateCatalogue } from './mmc.mjs';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONTENT_SOCKET_URL } from './player-content.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const id='20261007-0900-PLENARY';
const official='https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event='+id+'&language=en&autoplay=false&logo=logo';
const detail={ url:'https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/media/'+id, fetchedAt:'2026-10-13T19:00:00Z', payload:{resultJSON:{content:{mediaBusinessId:id,meetingStartDate:'2026-10-07T09:00:20.000+0200',meetingEndDate:'2026-10-07T20:13:47.000+0200',mediaAssets:[{url:official}]}}} };
const speech={id:'MTG-PL-2026-10-07-OTH-2017097993206',date:'2026-10-07',kind:'PLENARY_DEBATE_SPEECH',start:'2026-10-07T11:19:15.281+02:00',end:'2026-10-07T11:20:54.590+02:00'};
const catalogue={schemaVersion:1,term:10,dateFrom:'2024-07-01',dateTo:'2026-10-13',fetchedAt:'2026-10-13T19:14:09Z',total:1,sourcePages:[{url:'https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0/search?type=105&subtype=2',status:200}],records:[{id,start:'2026-10-07 07:00',end:'2026-10-07 18:13',status:'RECORDED'}]};
const mapping=Array.from({length:32},()=>null);mapping[0]={lang:'OR',sort:1};mapping[1]={lang:'EN',sort:9};mapping[16]={lang:'HU',sort:15};
const content={url:CONTENT_SOCKET_URL,fetchedAt:'2026-10-14T06:57:44.857Z',payload:{commonId:id,visibility:'PUBLISHED',startDate:'2026-10-07T07:00:20Z',endDate:'2026-10-07T18:13:47Z',languageMapping:mapping}};
const deps={directory:'/nonexistent-mmc-test',speech:async()=>speech,catalogue,detail:async()=>detail,content:async()=>content};

test('actual Oct7 timestamps produce outward UTC bounds and keep the published embed event',async()=>{
  const result=await speechMedia(speech.id,'hu','hu',deps);
  assert.equal(result.available,true);assert.equal(result.status,'matched');
  assert.equal(result.clip.startUtc,'2026-10-07T09:19:15Z');assert.equal(result.clip.endUtc,'2026-10-07T09:20:55Z');
  assert.match(result.embedUrl,/audio=or/);assert.equal(result.initialAudio,'or');assert.equal(result.requestedAudio,'hu');assert.equal(result.requiresAudioCheck,true);
  assert.deepEqual(result.audioMapping.channels.find(c=>c.language==='hu'),{slot:16,language:'hu',providerCode:'qaw'});
  assert.match(result.embedUrl,/autoplay=false/);assert.match(result.embedUrl,/analytics=false/);
  assert.match(result.embedUrl,/start=2026-10-07T09:19:15Z&end=2026-10-07T09:20:55Z$/);assert.ok(!result.embedUrl.includes('%3A'));
});
test('missing Irish interpretation never claims success or silently falls back',async()=>{
  const result=await speechMedia(speech.id,'ga','ga',deps);
  assert.equal(result.available,false);assert.equal(result.embedUrl,null);assert.equal(result.status,'audio-unavailable');assert.match(result.originalEmbedUrl,/audio=or/);
});
test('Irish supplied by a record-specific public content map is not blocked by the old manual proof list',async()=>{
  const languageMapping=structuredClone(mapping);languageMapping[24]={lang:'GA',sort:25};
  const result=await speechMedia(speech.id,'ga','ga',{...deps,content:async()=>({...content,payload:{...content.payload,languageMapping}})});
  assert.equal(result.status,'matched');assert.equal(result.requestedAudio,'ga');assert.equal(result.requiresAudioCheck,true);
  assert.deepEqual(result.audioMapping.channels.find(c=>c.language==='ga'),{slot:24,language:'ga',providerCode:'qag'});
});
test('public content mapping replaces static per-record proof and still requires actual player evidence',async()=>{
  const result=await speechMedia(speech.id,'hu','hu',deps);
  assert.equal(result.available,true);assert.equal(result.audioVerification,'official-content-map-runtime-check-required');
  assert.equal(result.selectionMethod,'iframe-inventory-and-adaptation');assert.deepEqual(result.selectionVerifiedLanguages,[]);
  const original=await speechMedia(speech.id,'hu','or',deps);assert.equal(original.available,true);assert.equal(original.requestedAudio,'or');assert.match(original.embedUrl,/audio=or/);
});
test('missing content metadata and cross-source identity or coverage mismatch never enable a player',async()=>{
  const unavailable=await speechMedia(speech.id,'hu','hu',{...deps,content:async()=>{throw new Error('unavailable');}});
  assert.equal(unavailable.available,false);assert.equal(unavailable.embedUrl,null);assert.equal(unavailable.status,'audio-metadata-unavailable');
  for(const patch of [{commonId:'20261008-0900-PLENARY'},{endDate:'2026-10-07T18:20:00Z'}]){
    const result=await speechMedia(speech.id,'hu','hu',{...deps,content:async()=>({...content,payload:{...content.payload,...patch}})});
    assert.equal(result.available,false);assert.equal(result.embedUrl,null);assert.equal(result.status,'audio-metadata-mismatch');
  }
});
test('a speech before recording coverage is not clamped to recording start',()=>{
  const early={...speech,start:'2026-10-07T09:00:15+02:00',end:'2026-10-07T09:00:30+02:00'};
  assert.equal(matchRecording(early,[detail]).status,'outside-recording');
});
test('overlapping recordings remain ambiguous and a failed candidate is not ignored',async()=>{
  assert.equal(matchRecording(speech,[detail,detail]).status,'ambiguous');
  const result=await speechMedia(speech.id,'hu','hu',{...deps,detail:async()=>{throw new Error('upstream403');}});
  assert.equal(result.status,'metadata-unavailable');assert.equal(result.available,false);
});
test('a stale nonmatching recording prevents caching a clip whose uniqueness depends on it',async()=>{
  const secondId='20261007-1800-PLENARY';
  const expanded={...catalogue,total:2,records:[...catalogue.records,{id:secondId,start:'2026-10-07 17:00',end:'2026-10-07 19:00',status:'RECORDED'}]};
  for(const stale of [true,false]) {
    const evening={url:detail.url.replace(id,secondId),fetchedAt:detail.fetchedAt,stale,refreshError:stale?'Synthetic retained recording failure':null,payload:{resultJSON:{content:{mediaBusinessId:secondId,meetingStartDate:'2026-10-07T17:00:00Z',meetingEndDate:'2026-10-07T19:00:00Z'}}}};
    const result=await speechMedia(speech.id,'hu','hu',{...deps,catalogue:expanded,detail:async key=>key===id?detail:evening});
    assert.equal(result.available,true);
    assert.equal(result.recording.id,id);
    assert.equal(result.provenance.recordingSources.length,2);
    const source=result.provenance.recordingSources.find(source=>source.url===evening.url);
    assert.equal(source.stale,stale);
    assert.equal(source.fetchedAt,evening.fetchedAt);
    const policy=apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/speech-media/'+speech.id),result);
    if(stale)assert.equal(policy.cdnCacheControl,'no-store');
    else assert.match(policy.cdnCacheControl,/max-age=21600/);
  }
});
test('written statements, invalid timestamps and excessive durations cannot acquire a clip',async()=>{
  for(const [patch,status] of [[{kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'},'not-recorded-speech'],[{end:null},'missing-times'],[{end:'2026-10-07T13:30:00+02:00'},'invalid-duration']])
    assert.equal((await speechMedia(speech.id,'hu','hu',{...deps,speech:async()=>({...speech,...patch})})).status,status);
});
test('unknown dates remain catalogue gaps and never manufacture a recording ID',async()=>{
  const result=await speechMedia(speech.id,'hu','hu',{...deps,speech:async()=>({...speech,date:'2026-10-09'})});assert.equal(result.status,'catalogue-missing');assert.equal(result.recording,null);
});
test('metadata cannot introduce arbitrary embed destinations or the wrong event',()=>{
  assert.equal(officialEmbed({...detail.payload.resultJSON.content,mediaAssets:[{url:'https://evil.example/ep/embed/embed.html?event='+id}]},id),null);
  assert.equal(officialEmbed(detail.payload.resultJSON.content,'20261008-0900-PLENARY'),null);
  assert.equal(new URL(clipUrl(official,'en','or','2026-10-07T09:19:15Z','2026-10-07T09:20:55Z')).searchParams.get('event'),id);
});
test('catalogue snapshots reject changed source origins, duplicate IDs and incomplete counts',()=>{
  assert.equal(validateCatalogue(catalogue),catalogue);
  assert.throws(()=>validateCatalogue({...catalogue,total:2}));
  assert.throws(()=>validateCatalogue({...catalogue,records:[catalogue.records[0],catalogue.records[0]],total:2}));
  assert.throws(()=>validateCatalogue({...catalogue,sourcePages:[{url:'https://evil.example/search',status:200}]}));
});
test('HTTP media endpoint rejects methods, origins, duplicate/unknown queries and invalid language before upstream work',async()=>{
  const {server}=await import('./index.mjs');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/speech-media/'+speech.id;
  try {
    for(const suffix of ['?url=https://evil.example','?lang=hu&lang=en','?audio=hu','?lang=xx'])assert.equal((await fetch(base+suffix)).status,400);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
    assert.equal((await fetch(base,{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(base+'?audio=hu',{method:'HEAD'})).status,400);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('expired recording metadata returns last good data when refresh is denied',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'mmc-stale-'));
  await mkdir(path.join(directory,'recordings'));
  const saved={...detail,fetchedAt:'2026-01-01T00:00:00Z'};
  await writeFile(path.join(directory,'recordings',id+'.json'),JSON.stringify(saved));
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('denied',{status:403});};
  try {
    const result=await recordingDetail(id,directory);assert.equal(result.stale,true);assert.equal(result.fetchedAt,saved.fetchedAt);
    for(let i=0;i<50&&!calls;i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(calls,1);await new Promise(r=>setTimeout(r,10));
    assert.equal(JSON.parse(await readFile(path.join(directory,'recordings',id+'.json'),'utf8')).fetchedAt,saved.fetchedAt);
  } finally {globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});}
});
test('concurrent cold recording lookups share one upstream request and publish a complete atomic cache record',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'mmc-cold-')),secondId='20261008-0900-PLENARY';
  const payload=structuredClone(detail.payload);payload.resultJSON.content.mediaBusinessId=secondId;payload.resultJSON.content.mediaAssets[0].url=official.replace(id,secondId);
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json(payload);};
  try {
    const [a,b]=await Promise.all([recordingDetail(secondId,directory),recordingDetail(secondId,directory)]);
    assert.equal(calls,1);assert.equal(a.url,b.url);
    const saved=JSON.parse(await readFile(path.join(directory,'recordings',secondId+'.json'),'utf8'));
    assert.equal(saved.payload.resultJSON.content.mediaBusinessId,secondId);assert.ok(Date.parse(saved.fetchedAt));
  } finally {globalThis.fetch=originalFetch;await rm(directory,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpstreamQueue} from './upstream-queue.mjs';
import {recordingDetail} from './mmc.mjs';
import {playerContent} from './player-content.mjs';
import {documentText} from './document-text.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {PortraitCache} from './portrait-cache.mjs';
import {boundedUpstream} from './odp.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const kind of ['recording','player','document','legislation','portrait'])for(const mode of ['admission','cooldown'])test(`${kind} recovers after local ${mode} and still bounds genuine source failures`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  const queue=new UpstreamQueue({interval:0,maximum:1}),acquire=queue.acquire.bind(queue);
  t.mock.method(UpstreamQueue.prototype,'acquire',acquire);
  let held;if(mode==='admission')held=await acquire();else queue.backoff(30);
  const calls={local:0,source:0},base='20261009-'+kind.toUpperCase()+'-'+mode.toUpperCase();
  const legislation=new LegislationInsights(null,{request:async endpoint=>boundedUpstream(async()=>{const bad=endpoint.endsWith('-SOURCE');calls[bad?'source':'local']++;if(bad)throw new Error('genuine source failed');return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:[]}};})});
  const portraits=new PortraitCache({directory:null,fetchImpl:async url=>{const bad=url.endsWith('/1234.jpg');calls[bad?'source':'local']++;return bad?new Response(null,{status:500}):new Response(Buffer.from([255,216,255,217]),{headers:{'content-type':'image/jpeg'}});}});
  t.mock.method(globalThis,'fetch',async url=>{
    const id=new URL(url).pathname.split('/').at(-1),bad=id.endsWith('-SOURCE');calls[bad?'source':'local']++;
    if(bad)return new Response(null,{status:500});
    return Response.json({resultJSON:{content:{mediaBusinessId:id,meetingStartDate:'2026-10-09T07:00:00Z',meetingEndDate:'2026-10-09T08:00:00Z',mediaAssets:[{url:'https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event='+id}]}}});
  });
  const read=async(bad=false)=>{
    const id=base+(bad?'-SOURCE':'-LOCAL');
    if(kind==='legislation')return legislation.record('/'+id);
    if(kind==='portrait')return portraits.get(bad?1234:1233,member=>boundedUpstream(async()=>'https://www.europarl.europa.eu/mepphoto/'+member+'.jpg'));
    if(kind==='recording')return recordingDetail(id,null);
    if(kind==='player')return playerContent(id,null,{fetchContent:async()=>{calls[bad?'source':'local']++;if(bad)throw new Error('genuine source failed');return {commonId:id,visibility:'PUBLISHED',startDate:'2026-10-09T07:00:00Z',endDate:'2026-10-09T08:00:00Z',languageMapping:[{lang:'EN',sort:1}]};}});
    const work={identifier:'B-10-2026-9999',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/'+id+'.docx'}]}]};
    return documentText(work,'en',{directory:null,download:async()=>{calls[bad?'source':'local']++;if(bad)throw new Error('genuine source failed');return {paragraphs:['Recovered text']};}});
  };
  const result=promise=>promise.then(value=>({value}),error=>({error}));
  const first=result(read());await turn();
  if(mode==='admission'){assert.equal(queue.waiters.length,1);t.mock.timers.tick(10_000);}
  const local=await first;assert.equal(calls.local,0);
  assert.equal(local.error.code,'upstream_busy');
  if(held)held();else t.mock.timers.tick(30_000);
  const recovered=await read();assert(kind==='document'?recovered.status==='available':Boolean(recovered.payload||recovered.body));assert.equal(calls.local,1);
  const failed=await result(read(true));assert(kind==='document'?failed.value.status==='error':Boolean(failed.error));
  await result(read(true));assert.equal(calls.source,1,'genuine source failures retain their bounded retry cache');
  t.mock.timers.tick(kind==='document'?30_001:kind==='legislation'?60_001:kind==='portrait'?300_001:3_600_001);
  await result(read(true));assert.equal(calls.source,2,'a genuine source failure cache must expire');
});

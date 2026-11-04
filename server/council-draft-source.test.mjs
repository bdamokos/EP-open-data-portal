import test from 'node:test';import assert from 'node:assert/strict';import {createCouncilPositionBaseline} from './council-position-baseline.mjs';
const reportId='A-10-2026-0123',record={id:'eli/dl/doc/'+reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2023-0123'],is_realized_by:[{title_alternative:{en:'(01234/2026 – C10-0012/2026 – 2023/0123(CNS))'}}]};
for(const [status,type] of [[302,'application/pdf'],[404,'application/pdf'],[200,'text/html']])test(`draft acquisition rejects HTTP ${status} / ${type} without following redirects`,async()=>{
 const calls=[];const documents={clock:Date.now,directory:null,sources:{schedule:fn=>fn()},fetchSource:async(url,options)=>{calls.push({url,options});return new Response('not PDF',{status,headers:{'content-type':type,location:'https://example.invalid/other.pdf'}});}};
 const read=createCouncilPositionBaseline({documents,request:async()=>({payload:{data:[record]},url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+reportId,fetchedAt:Date.now()})});const value=await read({reportId,language:'en'});assert.equal(value.status,'unavailable');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://data.consilium.europa.eu/doc/document/ST-1234-2026-INIT/en/pdf');assert.equal(calls[0].options.redirect,'manual');
});

for(const retryAfter of ['60',new Date(Date.now()+120000).toUTCString()])test(`Council Retry-After ${retryAfter} pauses the queue admitting the next language`,async()=>{
 const {OfficialContextSources}=await import('./official-context.mjs');const {councilDraftSource}=await import('./council-draft-source.mjs');
 let fetches=0;const sources=new OfficialContextSources({directory:null,fetchSource:async()=>{fetches++;return new Response('limited',{status:429,headers:{'Retry-After':retryAfter}});}}),documents={sources,fetchSource:sources.fetchSource,clock:Date.now};
 const source=language=>({number:1234,year:2026,procedure:'2023/0123(CNS)',language,url:`https://data.consilium.europa.eu/doc/document/ST-1234-2026-INIT/${language}/pdf`});
 await assert.rejects(councilDraftSource(documents,source('en')),e=>e.code==='upstream_busy');
 const pause=sources.queues.get('https://data.consilium.europa.eu').snapshot();assert(pause.cooldownMs>50000);
 await assert.rejects(councilDraftSource(documents,source('cs')),e=>e.code==='upstream_busy');assert.equal(fetches,1,'paused admission must not fetch again');
});

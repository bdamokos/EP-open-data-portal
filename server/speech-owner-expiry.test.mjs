import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const directory=mkdtempSync(path.join(os.tmpdir(),'speech-owner-expiry-'));
process.env.ODP_CACHE_DIR=directory;
after(()=>rmSync(directory,{recursive:true,force:true}));
const {odp}=await import('./odp.mjs');
const {sharedRequest}=await import('./request-budget.mjs');
const {SpeechInterventions}=await import('./speech-intervention-service.mjs');
const {SpeechCloudInsights,speechCloudQuery}=await import('./speech-cloud.mjs');
const {ActivityStore}=await import('./activity-index-store.mjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const interventionFixture=JSON.parse(readFileSync(new URL('./fixtures/speech-interventions-live-20261015.json',import.meta.url)));
const cloudFixture=JSON.parse(readFileSync(new URL('./fixtures/plenary-context-live-20261015.json',import.meta.url)));

test('expired ODP disk readers cannot replace a successful newer source',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+180_000});
  const endpoint='/expired-disk-reader',url='https://data.europarl.europa.eu/api/v2'+endpoint+'?format=application%2Fld%2Bjson';
  const file=path.join(directory,createHash('sha256').update(url).digest('hex')+'.json'),realRead=fs.createReadStream;
  const started=Promise.withResolvers();
  let finish,reads=0,calls=0;
  const mock=t.mock.method(fs,'createReadStream',(filename,...args)=>String(filename)===file&&reads++===0?(async function*(){yield Buffer.from(await new Promise(resolve=>{finish=resolve;started.resolve();}));})():realRead(filename,...args));
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[{id:'replacement'}]});});
  const first=assert.rejects(sharedRequest(()=>odp(endpoint)),e=>e.code==='request_timeout');
  await started.promise;t.mock.timers.tick(50_000);await first;
  const replacement=await odp(endpoint,{}, {force:true});assert.equal(replacement.payload.data[0].id,'replacement');
  finish(JSON.stringify({url,fetchedAt:Date.now(),payload:{data:[{id:'expired'}]}}));await turn();
  assert.equal(await odp(endpoint),replacement);assert.equal(calls,1);
});

test('expired member statistics cannot mutate replacement rows, sources or coverage',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+360_000});
  const activity=interventionFixture.activities.find(a=>a.recorded_in_a_realization_of?.[0]?.numbering===173);
  const record=title=>({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:Date.now(),payload:{data:[{...activity,activity_label:{en:title}}],meta:{total:1},searchResults:{hits:[{id:activity.id}]}}});
  const started=Promise.withResolvers();
  let finish,calls=0;
  const service=new SpeechInterventions({request:()=>++calls===1?new Promise(resolve=>{finish=resolve;started.resolve();}):Promise.resolve(record('replacement'))});
  const first=assert.rejects(service.member('256971'),e=>e.code==='request_timeout');
  await started.promise;t.mock.timers.tick(50_000);await first;
  const replacement=structuredClone(await service.member('256971'));assert.equal(replacement.items[0].titles.en,'replacement');
  finish(record('expired'));await turn();
  assert.deepEqual(await service.member('256971'),replacement);assert.equal(calls,2);
});

test('expired speech-cloud loads cannot add duplicate sources or corrupt replacement coverage',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+540_000});
  const store=new ActivityStore(path.join(directory,'cloud-store'));t.after(()=>store.close());
  store.acquire();store.beginCycle();store.setMembers([{id:'125065',name:'Saved speaker'}]);
  const started=Promise.withResolvers();
  let finish,calls=0;
  const service=new SpeechCloudInsights(store,{request:()=>++calls===1?new Promise(resolve=>{finish=resolve;started.resolve();}):Promise.resolve(cloudFixture.speeches)});
  const query=speechCloudQuery(new URLSearchParams('member=125065&days=term'));
  const first=assert.rejects(service.query(query),e=>e.code==='request_timeout');
  await started.promise;t.mock.timers.tick(50_000);await first;
  const replacement=structuredClone(await service.query(query));assert(replacement.coverage.transcripts>0);
  finish(cloudFixture.speeches);await turn();
  assert.deepEqual(await service.query(query),replacement);assert.equal(calls,2);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AMENDMENT_LINKS_VERSION,projectDocument} from './activity-index-model.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENT_DISTRIBUTION_PROOF_VERSION} from './amendments.mjs';
import {saveAmendmentRows} from './amendments-store.mjs';

test('motion context HTTP reads are index-only, scoped and bounded',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'motion-amendments-http-'));
  process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
  const {activityIndex}=await import('./activity-index-worker.mjs');
  const {server}=await import('./index.mjs');
  const {store,worker}=activityIndex();
  assert(store.acquire());const {generation}=store.beginCycle();
  const id='B-10-2026-0424',date='2026-10-02',at='2026-10-17T18:40:00Z';
  const source={url:'https://data.europarl.europa.eu/distribution/example/amendments_en.docx',fetchedAt:at,language:'en'};
  store.putSource(generation,'/plenary-documents/'+id,'document',projectDocument({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/RESOLUTION_MOTION',parliamentary_term:'org/ep-10',document_date:'2026-09-29',creator:['person/256918','org/PPE'],title_dcterms:{en:'HTTP motion contract'},inverse_foresees_change_of:[]}),at);
  const row=(number,member)=>({id:id+'-AM-'+number,targetDocumentId:id,number,listId:id+'-AM-013-031',documentDate:date,proposerDate:date,proposerDateBasis:'individual-amendment-document',date,language:'en',textParserVersion:AMENDMENT_EXTRACTION_VERSION,textIntegrity:'complete',originalText:'Original wording',proposedText:'Proposed wording',sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'fresh'},authors:[{name:'An explicitly resolved proposer',personId:member,status:'resolved',method:'exact_full_name_active_mandate'}],sources:[source],decisions:[],gaps:[]});
  saveAmendmentRows(store,generation,{id,listProjectionVersion:AMENDMENT_LINKS_VERSION},[row(13,'256918'),row(31,'197494')],{complete:false,gaps:['Outcome evidence is incomplete.'],lastUpdated:at});
  store.enqueue(generation,'unrelated-document','document',{endpoint:'/plenary-documents/B-10-2026-9999'});
  store.release();store.db.exec('PRAGMA query_only=ON');
  let upstreamCalls=0;
  t.mock.method(globalThis,'fetch',async()=>{upstreamCalls++;throw new Error('No upstream request is permitted.');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.exec('PRAGMA query_only=OFF');store.close();await rm(directory,{recursive:true,force:true});delete process.env.ACTIVITY_INDEX_ENABLED;delete process.env.ACTIVITY_INDEX_DIR;});
  const read=(route,options={})=>new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,...options},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,headers:response.headers,text,body:text?JSON.parse(text):null});});
    });request.on('error',reject);request.end();
  });
  const endpoint='/api/motion-amendments/'+id;
  const all=await read(endpoint+'?member=256918&scope=all');
  assert.equal(all.status,200);assert.equal(all.body.total,2);assert.equal(all.body.text.status,'indexed');
  assert.equal(all.body.text.memberAuthorship.status,'recorded');
  assert.deepEqual(all.body.items.map(item=>[item.number,item.memberMatch.matched]),[[13,true],[31,false]]);
  assert.deepEqual(all.body.totals,{allIndexed:2,memberMatched:1});
  assert.equal(all.body.coverage.backgroundPending,true);assert.equal(all.body.coverage.backgroundPendingScope,'index');assert.equal(all.body.coverage.targetProcessing,'unknown');
  const selected=await read(endpoint+'?member=256918&scope=member');
  assert.equal(selected.status,200);assert.equal(selected.body.total,1);assert.equal(selected.body.items[0].number,13);
  assert.deepEqual(selected.body.items[0].memberMatch,all.body.items[0].memberMatch);
  const page=await read(endpoint+'?scope=all&limit=1&offset=1');
  assert.equal(page.body.items.length,1);assert.equal(page.body.items[0].number,31);assert.equal(page.body.total,2);
  for(const query of ['scope=member','scope=other','scope=','member=','member=0','member=0256918','member=9007199254740992','member=256918&member=197494','limit=0','limit=51','offset=-1','offset=1000001','procedure=2026-2868','lang=invalid']) {
    assert.equal((await read(endpoint+'?'+query)).status,400,query);
  }
  for(const invalid of ['A-10-2026-0424','B-9-2026-0424','B-10-2026-0424-AM-13','B-10-2026-0424%2Fextra'])assert.equal((await read('/api/motion-amendments/'+invalid)).status,400,invalid);
  assert.equal((await read(endpoint,{method:'POST'})).status,405);
  assert.equal((await read(endpoint,{headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await read(endpoint,{method:'HEAD'})).text,'');
  assert.equal((await read(endpoint+'?member=256918&scope=all',{headers:{'If-None-Match':all.headers.etag}})).status,304);
  const absent=await read('/api/motion-amendments/RC-10-2026-0441');
  assert.equal(absent.status,200);assert.equal(absent.body.coverage.resultState,'not-indexed');assert.equal(absent.body.coverage.observationComplete,false);assert.equal(absent.body.text.status,'unavailable');
  assert.equal((await read('/api/healthz')).status,200);
  assert.equal(upstreamCalls,0);assert.equal(worker.running,false);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);
});

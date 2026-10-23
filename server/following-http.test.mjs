import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {API_VERSION} from './api-version.mjs';

// The ephemeral HTTP listener is an offline route test; no source workers start.
test('following and saved POST transports validate, version, cache and revalidate retained snapshots',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'following-http-'));
  for(const [key,value] of Object.entries({ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_DIR:directory,ODP_CACHE_DIR:'',CORPUS_DIR:'',CORPUS_ENABLED:'false',EXPLORER_DIST_DIR:directory})) {
    const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
  const {activityIndex}=await import('./activity-index-worker.mjs'),{server}=await import('./index.mjs');
  const {store,worker,press}=activityIndex();assert(store.acquire());
  t.after(async()=>{worker.stop();store.close();press?.close();await rm(directory,{recursive:true,force:true});});
  const fetchOriginal=globalThis.fetch;t.mock.method(globalThis,'fetch',()=>assert.fail('routes must never fetch upstream'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const read=async(route,options={})=>{const r=await fetchOriginal(base+'/api/insights/'+route,options);const text=await r.text();return {status:r.status,headers:r.headers,body:text?JSON.parse(text):null,text};};
  const noStore=r=>{assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('cdn-cache-control'),'no-store');};
  const initial=await read('following-status?v='+API_VERSION);assert.equal(initial.status,200);assert.equal(initial.body.marksReady,false);assert.equal(initial.headers.get('cache-control'),'public, max-age=60');assert.equal(initial.headers.get('cdn-cache-control'),'public, max-age=60');
  const epoch=initial.body.epoch,g1=store.beginCycle().generation;
  const params=(generation=g1,extra={})=>new URLSearchParams({epoch,generation,v:API_VERSION,...extra});
  const unready=await read('following-manifest?'+params());assert.equal(unready.status,503);assert.equal(unready.body.error.code,'marks_unavailable');noStore(unready);
  store.setMembers([{id:'42'},{id:'43'}]);
  const id='E-10-2026-000001',work={identifier:id,parliamentary_term:['org/ep-10'],work_type:'QUESTION_WRITTEN',document_date:'2026-10-01',title_dcterms:{en:'English',fr:'Français'},creator:['person/42'],inverse_answers_to:[{identifier:id+'-ASW',document_date:'2026-10-02'}]};
  const {documentRows}=await import('./activity-index-model.mjs');
  store.putSource(g1,'/parliamentary-questions/'+id,'document',work,'2026-10-23T10:00:00Z',documentRows(work,'/parliamentary-questions/'+id,'2026-10-23T10:00:00Z').rows);store.publish(g1);
  const manifest=await read('following-manifest?'+params());assert.equal(manifest.status,200);assert.equal(manifest.body.epoch,epoch);assert.equal(manifest.body.generation,g1);assert.equal(manifest.body.rosterBasis,'publication');assert.deepEqual(manifest.body.members['42'],[g1,g1,1,1]);assert.deepEqual(manifest.body.members['43'],[null,null,0,0]);
  for(const route of ['following-membership?'+params(),'following-manifest?'+params(),'following-member?'+params(g1,{member:'42',lang:'fr'})]) {
    const first=await read(route);assert.equal(first.headers.get('cache-control'),'public, max-age=3600');assert.equal(first.headers.get('cdn-cache-control'),'public, max-age=3600');assert(first.headers.get('etag'));
    const cached=await read(route,{headers:{'If-None-Match':first.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(cached.text,'');
    const head=await read(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.text,'');assert.equal(head.headers.get('etag'),first.headers.get('etag'));
    const unversioned=await read(route.replace('&v='+API_VERSION,''));assert.equal(unversioned.headers.get('cdn-cache-control'),'no-store');
    const authorized=await read(route,{headers:{Authorization:'test'}});noStore(authorized);
  }
  const detail=await read('following-member?'+params(g1,{member:'42',lang:'fr'}));assert.equal(detail.body.rosterBasis,'publication');assert.equal(detail.body.entries[0].title,'Français');assert.equal(detail.body.entries[0].titleLanguage,'fr');
  assert.deepEqual(detail.body.entries.map(entry=>[entry.kind,entry.category]),[['answer','written-questions'],['activity','written-questions']]);
  const g2=store.beginCycle().generation;store.publish(g2);
  assert.equal((await read('following-manifest?'+params(g1))).status,200);
  assert.equal((await read('following-member?'+params(g1,{member:'42'}))).status,200);
  for(const extra of [{epoch:'00000000-0000-0000-0000-000000000000'},{generation:g2+10}]) {
    const r=await read('following-manifest?'+params(g2,extra));assert.equal(r.status,409);assert.equal(r.body.error.code,'generation_changed');assert.equal(r.body.error.epoch,epoch);assert.equal(r.body.error.generation,g2);noStore(r);
  }
  store.beginCycle();const pruned=await read('following-manifest?'+params(g1));assert.equal(pruned.status,409);noStore(pruned);
  for(const route of ['following-status?lang=en','following-status?x=1','following-manifest','following-manifest?'+params(g2)+'&generation=1','following-manifest?'+params(g2,{epoch:'bad'}),'following-manifest?'+params(g2,{generation:'01'}),'following-manifest?'+params(g2,{generation:'9007199254740992'}),'following-member?'+params(g2),'following-member?'+params(g2,{member:'0'}),'following-member?'+params(g2,{member:'42',since:'1'}),'following-member?'+params(g2,{member:'42'})+'&member=42']) {
    const r=await read(route);assert.equal(r.status,400,route);noStore(r);
  }
  const post=(body,route='saved?lang=fr&v='+API_VERSION,headers={})=>read(route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  const posted=await post({questions:[id]});assert.equal(posted.status,200);noStore(posted);assert.equal(posted.body.questions[0].title,'Français');assert.equal(posted.body.members,undefined);
  const legacy=await read('saved?questions='+id+'&lang=fr&v='+API_VERSION);assert.equal(legacy.status,200);assert.deepEqual(posted.body.questions,legacy.body.questions);assert.equal((await read('saved?members=42&v='+API_VERSION)).status,400);
  assert.equal((await post({questions:[]})).status,200);
  assert.equal((await post({questions:Array.from({length:100},(_,i)=>'E-10-2026-'+String(i).padStart(6,'0'))})).status,200);
  for(const body of [null,[],{}, {questions:null},{questions:[id,id]},{questions:['../../x']},{questions:[1]},{questions:[id],members:['42']},{questions:Array.from({length:101},(_,i)=>'E-10-2026-'+String(i).padStart(6,'0'))}]) {
    const r=await post(body);assert.equal(r.status,400,JSON.stringify(body));noStore(r);
  }
  for(const route of ['saved?members=42','saved?questions='+id,'saved?lang=fr&lang=en'])assert.equal((await post({questions:[]},route)).status,400);
  assert.equal((await post('{')).body.error.code,'invalid_json');
  assert.equal((await post({questions:[]},undefined,{'Content-Type':'text/plain'})).status,415);
  const huge=await post(' '.repeat(8193));assert.equal(huge.status,413);noStore(huge);
  for(const [route,options] of [['following-status?v=1',{}],['following-member?'+params(g2,{member:'42',v:1}),{}],['saved?v=1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}]]) {
    const r=await read(route,options);assert.equal(r.status,409);assert.equal(r.body.error.code,'api_version_mismatch');noStore(r);
  }
  for(const v of ['0','bad',API_VERSION+'&v='+API_VERSION])assert.equal((await read('following-status?v='+v)).status,400);
  assert.equal((await read('following-status',{method:'POST'})).status,405);
  assert.equal((await read('following-member?'+params(g2,{member:'42'}),{method:'POST'})).status,405);
  assert.equal((await read('saved',{method:'OPTIONS'})).headers.get('allow'),'GET, HEAD, POST, OPTIONS');
  assert.equal((await post({questions:[]},undefined,{Origin:'https://foreign.example'})).status,403);
  // Oversized chunked uploads are bounded even without Content-Length.
  const chunked=await new Promise((resolve,reject)=>{
    const request=http.request(base+'/api/insights/saved',{method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});request.on('error',reject);request.end(' '.repeat(8193));
  });assert.equal(chunked,413);
});

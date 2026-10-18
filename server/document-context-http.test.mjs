import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('document context HTTP contract is bounded, query-separated and never starts a writer',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'document-context-http-'));
  process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
  const {server}=await import('./index.mjs');const {activityIndex}=await import('./activity-index-worker.mjs');
  const {store,worker}=activityIndex();store.db.exec('PRAGMA query_only=ON');
  const calls=[];
  t.mock.method(globalThis,'fetch',async value=>{
    const url=new URL(value);calls.push(url.href);const id=url.pathname.split('/').at(-1);
    return new Response(JSON.stringify({data:[{id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-10-08',work_type:'def/ep-document-types/'+(id.startsWith('TA-')?'TEXT_ADOPTED':'RESOLUTION_MOTION'),title_dcterms:{en:'Published document'},is_realized_by:[],inverse_foresees_change_of:[]}]}),{status:200,headers:{'content-type':'application/ld+json'}});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.exec('PRAGMA query_only=OFF');store.close();await rm(directory,{recursive:true,force:true});delete process.env.ACTIVITY_INDEX_ENABLED;delete process.env.ACTIVITY_INDEX_DIR;});
  const read=(route,options={})=>new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,...options},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,headers:response.headers,text,body:text?JSON.parse(text):null});});});request.on('error',reject);request.end();});
  const endpoint='/api/document-context/B-10-2026-0424';
  const first=await read(endpoint+'?lang=en');assert.equal(first.status,200);assert.equal(first.body.documentId,'B-10-2026-0424');assert.equal(first.body.document.selectedText.status,'unavailable');assert.equal(first.body.amendment,null);assert.equal(first.headers['cache-control'],'no-store');assert.equal(first.headers['cdn-cache-control'],'no-store');
  assert.equal((await read(endpoint+'?lang=en',{headers:{'If-None-Match':first.headers.etag}})).status,304);
  const french=await read(endpoint+'?lang=fr',{headers:{'If-None-Match':first.headers.etag}});assert.equal(french.status,200);assert.equal(french.body.requestedLanguage,'fr');assert.notEqual(french.headers.etag,first.headers.etag);
  const amendment=await read(endpoint+'?amendment=B-10-2026-0424-AM-13');assert.equal(amendment.body.amendment.status,'unavailable');assert.equal(amendment.body.target.reason,'amendment-wording-unavailable');assert.notEqual(amendment.headers.etag,first.headers.etag);
  const adopted=await read('/api/document-context/TA-10-2026-0342');assert.equal(adopted.status,200);assert.equal(adopted.body.document.selectedDocumentId,'TA-10-2026-0342');
  for(const suffix of ['?lang=en&lang=fr','?member=256918','?adopted=0','?amendment=RC-10-2026-0441-AM-1','?list=B-10-2026-0424-AM-001-020'])assert.equal((await read(endpoint+suffix)).status,400,suffix);
  assert.equal((await read(endpoint,{method:'POST'})).status,405);assert.equal((await read(endpoint,{headers:{Origin:'https://unrelated.example'}})).status,403);assert.equal((await read(endpoint,{method:'HEAD'})).text,'');
  assert.equal((await read('/api/document-context/A-9-2026-0237')).status,400);assert.equal((await read('/api/poc/document-context/B-10-2026-0424')).status,404);
  assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);assert.equal(calls.length,2);
  assert(calls.every(url=>url.startsWith('https://data.europarl.europa.eu/api/v2/')));
  process.env.ACTIVITY_INDEX_ENABLED='false';assert.equal((await read(endpoint)).status,200);
});

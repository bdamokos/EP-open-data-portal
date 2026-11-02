import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {BaseSourceStore} from './base-source-store.mjs';
import {backfillJobs,BaseSourceBackfill} from './base-source-backfill.mjs';
import {runBaseBackfill} from './base-source-backfill-context.mjs';
import {CellarDocuments} from './cellar-documents.mjs';
const target='A-10-2026-0001';
const list={targetDocumentId:target,extraction:{language:'fr',amendments:[{originalText:'before',proposedText:'after'}]}};
test('exact term-10 identifiers only; English plus actual wording languages',()=>{
 assert.deepEqual([...new Set(backfillJobs(list).map(j=>j.language))],['en','fr']);
 for(const id of ['A-9-2026-0001','title '+target,'TA-10-2026-0001',target+'-AM-1'])assert.deepEqual(backfillJobs({...list,targetDocumentId:id}),[]);
 assert.equal(backfillJobs({...list,targetDocumentId:'RC-10-2026-0001'}).length,2);
 assert.deepEqual([...new Set(backfillJobs({...list,extraction:{language:'hu',amendments:[{number:1}]}}).map(j=>j.language))],['en']);
});
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'base-backfill-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new ActivityStore(path.join(dir,'index'));store.acquire();t.after(()=>store.close());store.set('active',1);
 store.db.prepare('INSERT INTO sources(generation,key,kind,body) VALUES (1,?,?,?)').run('amendment:list:one','amendment-list',JSON.stringify(list));
 const retention=new BaseSourceStore(path.join(dir,'base-sources-v1'));
 return {dir,store,retention};
}
test('durable cursor, permanent unresolved reason and transient retries do not block other jobs',async t=>{
 const {dir,store,retention}=await fixture(t);let calls=0;
 const options={directory:dir,retention,log:()=>{},proposal:async()=>({status:'unresolved',gaps:['ambiguous-work']}),read:async()=>{calls++;throw Object.assign(new Error('timeout'),{code:'timeout'});}};
 const worker=new BaseSourceBackfill(store,options);while(await worker.step()){}
 assert.equal(store.get('baseBackfillSeeded'),true);
 assert.equal(calls,2);
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM base_backfill_jobs WHERE state='unresolved' AND reason LIKE '%ambiguous-work%'").get().n,2);
 const restarted=new BaseSourceBackfill(store,options);assert.equal(restarted.due(),false);assert.equal(restarted.status().targets.total,1);
});
test('manifest verifies bytes and descriptor without fetching; binding limit preserves current bytes',async t=>{
 const {dir,store}=await fixture(t),retention=new BaseSourceStore(path.join(dir,'base-sources-v1'),{maxBindings:1});
 const descriptor={url:'https://example.test/file.docx',language:'en',byteSize:4};
 await retention.save({url:descriptor.url,status:200,fetchedAt:new Date().toISOString(),descriptor,request:{accept:'*/*',language:'en'}},Buffer.from('held'));
 const worker=new BaseSourceBackfill(store,{directory:dir,retention,log:()=>{}});worker.hits=0;
 assert.equal((await worker.held({url:descriptor.url,descriptor})).buffer.toString(),'held');
 assert.equal(await worker.held({url:descriptor.url,descriptor:{...descriptor,byteSize:5}}),null);
 assert.equal(await retention.save({url:'other',fetchedAt:new Date().toISOString()},Buffer.from('more')),false);assert.equal(retention.records.size,1);
});
test('storage refusal stops cleanly with resumable pending job',async t=>{
 const {dir,store,retention}=await fixture(t);
 const {backfillContext}=await import('./base-source-backfill-context.mjs');
 const worker=new BaseSourceBackfill(store,{directory:dir,retention,log:()=>{},proposal:async()=>{backfillContext().full=true;return {status:'available'};},read:async()=>{backfillContext().full=true;return {payload:{data:[]}};}});
 assert.equal(await worker.step(),false);assert.equal(worker.due(),false);assert.equal(store.get('baseBackfillStop'),'storage-full');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM base_backfill_jobs WHERE state='pending'").get().n,4);
});
test('Cellar hops use shared background admission; held metadata makes no request',async()=>{
 const seen=[],url='https://publications.europa.eu/resource/celex/52026PC0001';
 const documents=new CellarDocuments({directory:null,sources:{schedule:(fn,settings)=>{seen.push(settings.priority);return fn();}},fetchSource:async()=>new Response('<rdf/>',{headers:{'content-type':'application/rdf+xml'}})});
 await runBaseBackfill({},()=>documents.request(url,{accept:'application/rdf+xml'}));assert.deepEqual(seen,['background']);
 await runBaseBackfill({held:async()=>({record:{url},buffer:Buffer.from('cached')})},async()=>assert.equal((await documents.request(url,{accept:'application/rdf+xml'})).buffer.toString(),'cached'));
 assert.equal(seen.length,1);
});
test('union of wording languages across lists; no undeclared language download and held own DOCX skip',async t=>{
 const {dir,store,retention}=await fixture(t);
 const other={...list,extraction:{language:'hu',amendments:[{originalText:'szöveg'}]}};
 store.db.prepare('INSERT INTO sources(generation,key,kind,body) VALUES (1,?,?,?)').run('amendment:list:two','amendment-list',JSON.stringify(other));
 let downloads=0;
 const descriptor={url:'https://data.europarl.europa.eu/distribution/test/report_en.docx',language:'en',byteSize:4};
 await retention.save({url:descriptor.url,status:200,fetchedAt:new Date().toISOString(),descriptor,request:{accept:'*/*',language:'en'}},Buffer.from('held'));
 const worker=new BaseSourceBackfill(store,{directory:dir,retention,log:()=>{},read:async(_endpoint,_params,options)=>{
  assert.equal(options.priority,'background');return {payload:{data:[{id:'eli/dl/doc/'+target,is_realized_by:[{language:'en',is_embodied_by:[{format:'DOCX',is_exemplified_by:descriptor.url,byteSize:4}]}]}]}};
 },download:async()=>{downloads++;}});
 assert.deepEqual([...new Set(worker.jobsForList(1,list).map(j=>j.language))],['en','fr','hu']);
 worker.hits=0;assert.equal((await worker.collect({kind:'document',target,language:'en'})).status,'available');
 assert.deepEqual((await worker.collect({kind:'document',target,language:'fr'})).gaps,['language-unavailable']);assert.equal(downloads,0);
});
test('indexed wording variants contribute languages only for exact target list IDs',async t=>{
 const {dir,store,retention}=await fixture(t);
 store.db.prepare('INSERT INTO amendments(generation,id,target,body) VALUES (1,?,?,?)').run(target+'-AM-1',target,JSON.stringify({listId:'one',language:'de',proposedText:'Text',variants:[{listId:'one',language:'hu',originalText:'Szöveg'},{listId:'unrelated',language:'it',originalText:'Testo'}]}));
 const worker=new BaseSourceBackfill(store,{directory:dir,retention,log:()=>{}});
 assert.deepEqual([...new Set(worker.jobsForList(1,list).map(j=>j.language))],['de','en','fr','hu']);
});

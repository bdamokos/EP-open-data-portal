import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {apiFetch} from './activity-index-worker.mjs';
import {downloadDocxBuffer} from './document-text.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import https from 'node:https';
import {EventEmitter} from 'node:events';

for(const Store of [ActivityStore,CorpusStore])test(Store.name+' defers missing sources until due and keeps recovery possible',t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'source-retry-'));let now=Date.parse('2026-10-22T10:00:00Z');
  const store=new Store(directory,{clock:()=>now});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const activity=Store===ActivityStore,generation=activity?store.beginCycle().generation:null;
  if(activity)store.enqueue(generation,'missing','document',{endpoint:'/missing'},90);
  else store.enqueue('missing','speech',{id:'missing'},90);
  const next=()=>activity?store.nextTask(generation):store.nextTask();
  for(let i=0;i<12;i++) {
    const task=next();assert.equal(task.attempts,i);
    store.failTask(task,Object.assign(new Error('Missing source'),{status:i%2?410:404}));
    const saved=store.db.prepare('SELECT * FROM tasks WHERE key=?').get('missing');
    const delay=Math.min(7*86400000,3600000*2**i);
    assert.equal(saved.retry_at,now+delay);
    assert.equal(next(),undefined);store.release();now+=delay-1;assert(store.acquire());
    assert.equal(next(),undefined);now++;
  }
  const task=next();store.finishTask(task);assert.equal(next(),undefined);
  if(activity)store.enqueue(generation,'transient','document',{},90);else store.enqueue('transient','speech',{},90);
  store.failTask(next(),Object.assign(new Error('Busy'),{status:503,retryAfter:7200}));
  assert.equal(store.db.prepare('SELECT retry_at FROM tasks WHERE key=?').get('transient').retry_at,now+7200000);
});

test('API and DOCX response errors retain missing status and long numeric/date retry hints',async t=>{
  const now=Date.parse('2026-10-22T10:00:00Z'),day=86400000;
  t.mock.timers.enable({apis:['Date'],now});
  // Exercise the real response boundaries with stub transports and no queue waits.
  t.mock.method(UpstreamQueue.prototype,'run',async operation=>operation());
  let status=404,hint;
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status,headers:hint?{'retry-after':hint}:{}}));
  let drained=0;
  t.mock.method(https,'get',(_url,_options,callback)=>{
    queueMicrotask(()=>callback({statusCode:status,headers:hint?{'retry-after':hint}:{},resume(){drained++;}}));
    return new EventEmitter();
  });
  const directory=mkdtempSync(path.join(os.tmpdir(),'source-response-retry-'));
  const index=new ActivityStore(path.join(directory,'index'),{clock:()=>now});
  const corpus=new CorpusStore(path.join(directory,'corpus'),{clock:()=>now});
  t.after(()=>{index.close();corpus.close();rmSync(directory,{recursive:true,force:true});});
  assert(index.acquire());assert(corpus.acquire());const {generation}=index.beginCycle();
  let attempts=0;
  for(status of [404,410])for(hint of [undefined,String(8*day/1000),new Date(now+8*day).toUTCString()]) {
    const key='missing-'+attempts++;
    index.enqueue(generation,key,'document',{},90);corpus.enqueue(key,'question',{},90);
    const delay=hint?8*day:3600000;
    for(const [download,store,task] of [
      [()=>apiFetch('/parliamentary-questions/E-10-2026-004060'),index,index.nextTask(generation)],
      [()=>downloadDocxBuffer('https://data.europarl.europa.eu/distribution/test/missing.docx'),corpus,corpus.nextTask()],
    ]) {
      await assert.rejects(download(),error=>{
        assert.equal(error.status,status);assert.equal(error.retryAfter,hint?8*day/1000:0);
        store.failTask(task,error);
        assert.equal(store.db.prepare('SELECT retry_at FROM tasks WHERE key=?').get(key).retry_at,now+delay);
        return true;
      });
    }
  }
  assert.equal(drained,6,'every failed HTTPS response is drained without reading a document');
});

for(const [name,type,bytes,code] of [
 ['HTTP 200 maintenance HTML','text/html',Buffer.from('<html>Maintenance</html>'),'unexpected_document_format'],
 ['clean early archive end without declared size','application/octet-stream',Buffer.from('PK\x03\x04incomplete'),'invalid_docx'],
])test(name+' needs three identical rejections spanning a day',async t=>{
 const {Readable}=await import('node:stream'),{downloadDocx}=await import('./document-text.mjs'),{createHash}=await import('node:crypto');
 let now=Date.now();const directory=mkdtempSync(path.join(os.tmpdir(),'rejected-source-'));const store=new CorpusStore(directory,{clock:()=>now});
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();store.enqueue('bad','docx',{url:'https://data.europarl.europa.eu/distribution/test/a.docx'},10);
 t.mock.method(https,'get',(_url,_options,callback)=>{queueMicrotask(()=>callback(Object.assign(Readable.from([bytes]),{statusCode:200,headers:{'content-type':type}})));return new EventEmitter();});
 for(let i=0;i<3;i++) {
   store.acquire();await assert.rejects(downloadDocx(store.task('bad').body.url),error=>{assert.equal(error.code,code);assert.equal(error.sourceHash,createHash('sha256').update(bytes).digest('hex'));store.failTask(store.task('bad'),error);return true;});
   assert.equal(store.task('bad').done,i===2?1:0);if(i<2){assert(store.task('bad').retry_at>now);now+=12*3600000;}
 }
 assert.equal(store.status().sourceIssues.count,1);
});

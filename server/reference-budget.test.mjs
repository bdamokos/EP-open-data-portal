import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegalReferences} from './legal-references.mjs';
import {runWithRequestSignal} from './request-budget.mjs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';

test('one reference budget stops later source batches and retains last-good metadata',async()=>{
  let calls=0,questions=0;
  const service=new LegalReferences({get:async()=>{calls++;return new Promise(()=>{});}},{directory:null,requestBudgetMs:25,request:async()=>{questions++;return new Promise(()=>{});}});
  const key='celex:32021R2116',saved={key,kind:'act',status:'found',celex:'32021R2116',title:'Saved official title',source:{fetchedAt:'2026-10-15T00:00:00Z'}};
  service.cache.cache.set(service.cacheKey(key,'en'),{at:0,value:saved});
  const keepAlive=setTimeout(()=>{},1000);
  try {
    const result=await service.query({keys:[key,'cellar:2bf140bf-a3f8-4ab2-b506-fd71826e6da6','question:E-2024-001234'],language:'en'});
    assert.equal(calls,1);assert.equal(questions,0);
    assert.deepEqual(result.references[0],{...saved,stale:true});
    assert(result.references.slice(1).every(reference=>reference.status==='unavailable'));
    assert.equal(service.cache.cache.get(service.cacheKey(key,'en')).at,0,'deadline cannot renew saved freshness');
  }finally{clearTimeout(keepAlive);}
});

test('reference question fan-out stops on reader abort with at most two term candidates active',async()=>{
  let questions=0;const reader=new AbortController();
  const service=new LegalReferences({get:async()=>{throw new Error('unexpected catalogue call');}},{directory:null,request:async()=>{
    questions++;if(questions===2)queueMicrotask(()=>reader.abort(new Error('reader left')));return new Promise(()=>{});
  }});
  const result=await runWithRequestSignal(reader.signal,()=>service.query({keys:['question:E-2024-001234','question:E-2025-001235','question:E-2025-001236'],language:'en'}));
  assert.equal(questions,2);assert(result.references.every(reference=>reference.status==='unavailable'));
});

test('a timed-out disk lookup cannot hide a later fresh memory reference in either key order',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'reference-cache-order-'));
  let sourceCalls=0;
  const service=new LegalReferences({get:async()=>{sourceCalls++;throw new Error('no source work after the budget');}},{directory,requestBudgetMs:25});
  const slow='celex:32016R0679',cached='celex:32021R2116',fetchedAt='2026-10-15T00:00:00Z';
  const good={key:cached,kind:'act',status:'found',celex:'32021R2116',title:'Saved official title',source:{fetchedAt}};
  await service.cache.save(service.cacheKey(cached,'en'),good);
  const savedAt=service.cache.cache.get(service.cacheKey(cached,'en')).at;
  const slowKey=service.cacheKey(slow,'en'),file=path.join(directory,slowKey+'.json');
  await fs.writeFile(file,JSON.stringify({key:slowKey,at:savedAt,value:{...good,key:slow,celex:'32016R0679'}}));
  const realRead=fs.readFile,releases=[];let reachedRead;
  const mock=t.mock.method(fs,'readFile',async(name,...args)=>{
    const data=await realRead(name,...args);
    if(String(name)===file)await new Promise(resolve=>{releases.push(resolve);reachedRead();});
    return data;
  });syncBuiltinESMExports();
  t.after(async()=>{for(const release of releases)release();await new Promise(resolve=>setImmediate(resolve));mock.mock.restore();syncBuiltinESMExports();await fs.rm(directory,{recursive:true,force:true});});
  for(const keys of [[slow,cached],[cached,slow]]){
    const started=new Promise(resolve=>reachedRead=resolve),pending=service.query({keys,language:'en'});
    await started;t.mock.timers.tick(25);const result=await pending;
    assert.deepEqual(result.references.find(reference=>reference.key===cached),good,'available memory remains found with original provenance');
    assert.equal(result.references.find(reference=>reference.key===slow).status,'unavailable');
    for(const release of releases.splice(0))release();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(service.cache.cache.get(service.cacheKey(cached,'en')).at,savedAt,'a deadline does not renew freshness');
  }
  assert.equal(sourceCalls,0);
});

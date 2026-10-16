import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegalReferences} from './legal-references.mjs';
import {runWithRequestSignal} from './request-budget.mjs';

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

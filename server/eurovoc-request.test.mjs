import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EurovocCatalog} from './eurovoc.mjs';
import {sharedRequest,waitForRequest,requestSignal} from './request-budget.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const source={url:'https://publications.europa.eu/webapi/rdf/sparql',fetchedAt:'2026-10-16T12:00:00Z',data:{results:{bindings:[]}}};

test('a foreground EuroVoc reader reaches source admission instead of joining a queued warm-up',async()=>{
  let finish;
  const priorities=[],catalog=new EurovocCatalog({get:(_url,{priority})=>{
    priorities.push(priority);
    return priority==='background'?new Promise(resolve=>finish=()=>resolve(source)):Promise.resolve(source);
  }},{directory:null});
  const warming=catalog.load(['2024-0001'],'en',{priority:'background'});
  try {
    await turn();assert(finish);
    const result=await catalog.load(['2024-0001'],'en');
    assert.equal(result.get('2024-0001').state,'unmapped');
    assert.deepEqual(priorities,['background','interactive']);
  }finally{finish?.();await warming;}
});

test('staggered EuroVoc readers keep a shared catalogue load after the first owner expires',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  let finish,sourceOwner,secondOwner,calls=0;
  const catalog=new EurovocCatalog({get:()=>{
    calls++;sourceOwner=requestSignal();
    return waitForRequest(new Promise(resolve=>finish=()=>resolve(source)));
  }},{directory:null});
  const first=assert.rejects(sharedRequest(()=>catalog.load(['2024-0001'],'en'),1000),e=>e.code==='request_timeout');
  await turn();t.mock.timers.tick(500);
  const second=sharedRequest(()=>{secondOwner=requestSignal();return catalog.load(['2024-0001'],'en');},10_000);
  await turn();t.mock.timers.tick(500);await first;
  assert.equal(sourceOwner.aborted,false);assert.equal(secondOwner.aborted,false);
  finish();const result=await second;
  assert.equal(result.get('2024-0001').state,'unmapped');assert.equal(calls,1);
  assert.equal((await catalog.known(['2024-0001'],'en')).get('2024-0001').state,'unmapped');
  assert.equal(catalog.pending.size,0);
});

test('an expired EuroVoc load cannot save late source data over its replacement',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  let finish,calls=0;
  const catalog=new EurovocCatalog({get:()=>++calls===1?new Promise(resolve=>finish=resolve):Promise.resolve(source)},{directory:null});
  const expired=assert.rejects(catalog.load(['2024-0001'],'en'),e=>e.code==='request_timeout');
  await turn();t.mock.timers.tick(50_000);await expired;assert.equal(catalog.pending.size,0);
  await catalog.load(['2024-0001'],'en');
  finish({...source,fetchedAt:'2024-01-01T00:00:00Z'});await turn();
  assert.equal((await catalog.known(['2024-0001'],'en')).get('2024-0001').source.fetchedAt,source.fetchedAt);
  assert.equal(calls,2);
});

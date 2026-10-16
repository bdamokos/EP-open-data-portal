import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OfficialContextSources} from './official-context.mjs';
import {backoffUpstream} from './odp.mjs';
import {runWithRequestSignal} from './request-budget.mjs';

const po='https://publications.europa.eu/webapi/rdf/sparql';
const oeil='https://oeil.europarl.europa.eu/oeil/en/procedure-file';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const until=async condition=>{for(let i=0;i<100&&!condition();i++)await flush();assert(condition(),'the expected asynchronous phase started');};
const json=()=>Response.json({results:{bindings:[]}});

test('cold official sources use independent origins during a Parliament cooldown',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  backoffUpstream(60);
  const calls=[],reader=new OfficialContextSources({directory:null,fetchSource:async url=>{
    calls.push(url);return url.startsWith(po)?json():new Response('<main>Summary</main>',{headers:{'content-type':'text/html'}});
  }});
  const first=reader.get(po+'?query=cold'),second=reader.get(oeil+'?reference=2025/0407(COD)');
  await flush();await flush();await flush();
  try{assert.equal(calls.length,2,'neither public origin waits for Parliament');}
  finally{t.mock.timers.tick(60_000);await Promise.all([first,second]);}
  assert.equal(reader.queues.size,2);
  for(const queue of reader.queues.values()){assert.equal(queue.interval,2100);assert.equal(queue.maximum,2);assert.equal(queue.active,0);}
});

test('an aborted reader detaches from a shared cold source without cancelling its survivor or cache write',async()=>{
  let finish,calls=0,sourceSignal;
  const reader=new OfficialContextSources({directory:null,fetchSource:async(_url,{signal})=>{
    calls++;sourceSignal=signal;return new Promise(resolve=>finish=()=>resolve(json()));
  }}),a=new AbortController(),b=new AbortController();
  const first=runWithRequestSignal(a.signal,()=>reader.get(po+'?query=shared'));
  const rejected=assert.rejects(first,/reader left/);
  const second=runWithRequestSignal(b.signal,()=>reader.get(po+'?query=shared'));
  await until(()=>sourceSignal);a.abort(new Error('reader left'));await rejected;
  assert.equal(sourceSignal.aborted,false);assert.equal(calls,1);
  finish();const result=await second;
  assert.equal(result.url,po+'?query=shared');assert.equal(result.viewCache.stale,false);
  const cached=await reader.get(po+'?query=shared');assert.equal(cached.fetchedAt,result.fetchedAt);assert.equal(calls,1);
});

test('the source budget removes queued work and never starts its fetch',async t=>{
  const budgets=[];
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,20_000);const c=new AbortController();budgets.push(c);return c.signal;});
  const started=[],reader=new OfficialContextSources({directory:null,fetchSource:async(url,{signal})=>{
    signal.throwIfAborted();started.push(url);
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const one=reader.get(po+'?query=one'),settledOne=one.catch(()=>{});await until(()=>started.length===1);
  const queue=reader.queues.get(new URL(po).origin);queue.interval=0;queue.nextStart=0;
  const two=reader.get(po+'?query=two'),settledTwo=two.catch(()=>{});await until(()=>started.length===2);
  const three=reader.get(po+'?query=three'),rejected=assert.rejects(three,/source budget ended/);await until(()=>queue.waiters.length===1);
  try {
    assert.equal(started.length,2);assert.equal(queue.active,2);assert.equal(queue.waiters.length,1);
    budgets[2].abort(new Error('source budget ended'));await rejected;
    assert.equal(queue.waiters.length,0);assert.equal(started.length,2);
  }finally{for(const c of budgets)c.abort(new Error('cleanup'));await Promise.all([settledOne,settledTwo]);}
  assert.equal(queue.active,0);
});

test('one source budget spans redirects and a stalled body, then releases admission',async t=>{
  const budget=new AbortController(),signals=[];let timeoutCalls=0,body;
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,20_000);timeoutCalls++;return budget.signal;});
  const reader=new OfficialContextSources({directory:null,fetchSource:async(_url,{signal})=>{
    signals.push(signal);
    if(signals.length===1)return new Response(null,{status:302,headers:{location:po+'?query=redirected'}});
    return new Response(new ReadableStream({start(controller){body=controller;signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),{headers:{'content-type':'application/json'}});
  }});
  const pending=reader.get(po+'?query=initial'),rejected=assert.rejects(pending,/whole source budget ended/);
  await until(()=>body);assert.equal(signals.length,2);assert.equal(timeoutCalls,1);assert(signals.every(signal=>signal===budget.signal));
  budget.abort(new Error('whole source budget ended'));await rejected;
  assert.equal(reader.queues.get(new URL(po).origin).active,0);
});

test('official redirects cannot borrow another origin admission pool',async()=>{
  let calls=0;const reader=new OfficialContextSources({directory:null,run:load=>load(),fetchSource:async()=>{
    calls++;return new Response(null,{status:302,headers:{location:oeil+'?reference=2025/0407(COD)'}});
  }});
  await assert.rejects(reader.get(po+'?query=cross-origin'),/different origin/);assert.equal(calls,1);
});

test('an official source cooldown stays with its own origin and prevents premature retries',async()=>{
  let poCalls=0,oeilCalls=0;
  const reader=new OfficialContextSources({directory:null,fetchSource:async url=>{
    if(url.startsWith(po)){poCalls++;return new Response(null,{status:429,headers:{'retry-after':'45'}});}
    oeilCalls++;return new Response('<main>Summary</main>',{headers:{'content-type':'text/html'}});
  }});
  await assert.rejects(reader.get(po+'?query=limited'),error=>error.code==='official_source_limited'&&error.retryAfter===45);
  await assert.rejects(reader.get(po+'?query=next'),error=>error.code==='official_source_busy'&&error.retryAfter>0);
  assert.equal(poCalls,1);await reader.get(oeil+'?reference=2025/0407(COD)');assert.equal(oeilCalls,1);
});

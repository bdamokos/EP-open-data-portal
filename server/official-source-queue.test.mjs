import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {OfficialContextSources} from './official-context.mjs';
import {backoffUpstream,upstreamPortServices} from './odp.mjs';
import {runWithRequestSignal} from './request-budget.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';

const po='https://publications.europa.eu/webapi/rdf/sparql';
const oeil='https://oeil.europarl.europa.eu/oeil/en/procedure-file';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
// Shared origin state is process-wide; each mock-clock fixture starts idle.
beforeEach(()=>{for(const source of [po,oeil]){const q=upstreamPortServices().queueFor(new URL(source).origin);assert.equal(q.active,0);assert.equal(q.waiters.length,0);q.nextStart=0;q.cooldownUntil=0;}});
const until=async condition=>{for(let i=0;i<100&&!condition();i++)await flush();assert(condition(),'the expected asynchronous phase started');};
const json=()=>Response.json({results:{bindings:[]}});

test('cold visitors use foreground admission while an official-source warm-up waits for background capacity',async()=>{
  let calls=0;
  const queue=new UpstreamQueue(),release=await queue.acquire('background');
  const reader=new OfficialContextSources({directory:null,fetchSource:async()=>{calls++;return json();}});
  reader.queues.set(new URL(po).origin,queue);
  const url=po+'?query=warm-contention',warming=reader.get(url,{priority:'background'});
  try {
    await until(()=>queue.waiters.length===1);
    const [one,two]=await Promise.all([reader.get(url),reader.get(url)]);
    assert.equal(one.url,url);assert.deepEqual(two,one);
    assert.equal(calls,1,'cold foreground visitors share one admitted fetch');
    assert.equal(queue.waiters.length,1,'the background warm-up retains its own queued budget');
  }finally{release();await warming;}
  assert.equal(reader.cache.foregroundPending.size,0);assert.equal(reader.cache.pending.size,0);
  assert.equal((await reader.get(url)).url,url);assert.equal(calls,2,'the completed background observation is retained');
});

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
  for(const queue of reader.queues.values()){assert.equal(queue.interval,0);assert.equal(queue.maximum,queue===reader.queues.get(new URL(oeil).origin)?1:2);assert.equal(queue.active,0);}
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
  await assert.rejects(reader.get(po+'?query=next'),error=>error.code==='upstream_busy'&&error.retryAfter>0&&/official source/.test(error.message));
  assert.equal(poCalls,1);await reader.get(oeil+'?reference=2025/0407(COD)');assert.equal(oeilCalls,1);
});

test('local official admission failure leaves a stale source immediately retryable when capacity returns',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  let calls=0;
  const url=po+'?query=retry-after-local-admission',reader=new OfficialContextSources({directory:null,fetchSource:async()=>{calls++;return Response.json({label:'fresh'});}});
  const key=reader.cache.key(['official-context-v1',url]);
  await reader.cache.save(key,{url,fetchedAt:new Date().toISOString(),data:{label:'saved'}});
  t.mock.timers.tick(reader.cache.freshMs+1);
  const queue=new UpstreamQueue({interval:0,maximum:1}),release=await queue.acquire();
  reader.queues.set(new URL(po).origin,queue);
  try {
    assert.equal((await reader.get(url)).data.label,'saved');
    await until(()=>queue.waiters.length===1);t.mock.timers.tick(queue.interactiveWaitMs);
    await until(()=>reader.cache.pending.size===0);
    assert.equal(reader.cache.failures.has(key),false,'local queue pressure must not become a retained source failure');
    release();
    assert.equal((await reader.get(url)).data.label,'saved');
    await until(()=>calls===1);await until(()=>reader.cache.pending.size===0);
    assert.equal((await reader.get(url)).data.label,'fresh');assert.equal(calls,1);
  }finally{release();}
});

test('leased topic collection awaits a stale page refresh at background priority',async()=>{
 let now=100000,calls=0,finish;
 const reader=new OfficialContextSources({directory:null,clock:()=>now,fetchSource:async()=>{calls++;if(calls===2)await new Promise(resolve=>finish=resolve);return new Response('<main>'+calls+'</main>',{headers:{'content-type':'text/html'}});}});
 const url=oeil+'?reference=2026/2790(RSP)';await reader.get(url);now+=1000;reader.queues.get(new URL(oeil).origin).nextStart=0;upstreamPortServices().queueFor(new URL(oeil).origin).nextStart=0;
 let settled=false;const pending=reader.get(url,{freshMs:1,priority:'background',waitForFresh:true}).then(value=>{settled=true;return value;});
 await until(()=>finish);assert.equal(settled,false);finish();const result=await pending;assert.equal(result.viewCache.stale,false);assert(result.html.includes('2'));assert.equal(reader.cache.pending.size,0);
});

test('OEIL starts are serial and paced, with origin-wide 5xx Retry-After backoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:50000});
 const starts=[],reader=new OfficialContextSources({directory:null,fetchSource:async()=>{starts.push(Date.now());return starts.length===1?new Response(null,{status:500,headers:{'retry-after':'3'}}):new Response('<main>Read</main>',{headers:{'content-type':'text/html'}});}});
 await assert.rejects(reader.get(oeil+'?reference=2025/0001(COD)'),e=>e.retryAfter===3);
 const next=reader.get(oeil+'?reference=2025/0002(COD)',{priority:'background'});await flush();t.mock.timers.tick(2999);await flush();assert.equal(starts.length,1);t.mock.timers.tick(1);await next;
 const third=reader.get(oeil+'?reference=2025/0003(COD)',{priority:'background'});await flush();t.mock.timers.tick(999);await flush();assert.equal(starts.length,2);t.mock.timers.tick(1);await third;
 assert.deepEqual(starts,[50000,53000,54000]);assert.equal(reader.queues.get(new URL(oeil).origin).maximum,1);
});

test('OEIL redirects spend paced starts before the next page can begin',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const starts=[];
 const reader=new OfficialContextSources({directory:null,fetchSource:async()=>{starts.push(Date.now());return starts.length===1?new Response(null,{status:302,headers:{location:oeil+'?reference=2025/0001(COD)&redirected=1'}}):new Response('<main>Read</main>',{headers:{'content-type':'text/html'}});}});
 const first=reader.get(oeil+'?reference=2025/0001(COD)');await until(()=>starts.length===1);await flush();t.mock.timers.tick(999);await flush();assert.equal(starts.length,1);t.mock.timers.tick(1);await first;
 const second=reader.get(oeil+'?reference=2025/0002(COD)',{priority:'background'});await flush();t.mock.timers.tick(999);await flush();assert.equal(starts.length,2);t.mock.timers.tick(1);await second;assert.deepEqual(starts,[1000,2000,3000]);
});

 test('distinct official readers share serial OEIL starts and a redirect spends another shared grant',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const starts=[];let finish;
 const one=new OfficialContextSources({directory:null,fetchSource:async()=>{starts.push(Date.now());await new Promise(r=>finish=r);return new Response(null,{status:302,headers:{location:oeil+'?reference=redirected'}});}});
 const two=new OfficialContextSources({directory:null,fetchSource:async()=>{starts.push(Date.now());return new Response('<main>Read</main>',{headers:{'content-type':'text/html'}});}});
 const first=one.get(oeil+'?reference=one');await until(()=>finish);
 const second=two.get(oeil+'?reference=two',{priority:'background'});await flush();t.mock.timers.tick(1000);await flush();assert.deepEqual(starts,[1000]);
 one.fetchSource=two.fetchSource;finish();await flush();await flush();
 // Interactive redirected hops lead background pages, but cannot skip pacing.
 await until(()=>starts.length===2);t.mock.timers.tick(1000);await Promise.all([first,second]);assert.deepEqual(starts,[1000,2000,3000]);
 const q=upstreamPortServices().queueFor(new URL(oeil).origin);assert.equal(q.interval,1000);assert.equal(q.maximum,1);assert.equal(q.active,0);
 });

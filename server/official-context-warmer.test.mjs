import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {OfficialContextWarmer,contextReferences,CONTEXT_LANGUAGES} from './official-context-warmer.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {hintOfficialContext,drainOfficialHints,acceptOfficialHints} from './official-context-hints.mjs';

test('discovery uses exact references across nested records without matching titles',()=>{
  assert.deepEqual(contextReferences({links:['eli/dl/proc/2024-0001',{id:'https://data.europarl.europa.eu/eli/dl/proc/2024-0002'}],label:'2024/0001(COD)',title:'Housing reform'}),{ids:['2024-0001','2024-0002'],keys:['procedure:2024/0001(COD)']});
});

test('durable recent-first discovery schedules every language and resumes after restart',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-warmer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const now=Date.parse('2026-11-01T12:00Z'),store=new ActivityStore(dir,{clock:()=>now});t.after(()=>store.close());store.acquire();store.set('active',1);
  for(let n=1;n<=55;n++)store.putSource(1,'/questions/'+n,'document',{document_date:n<=5?'2024-09-01':'2026-10-01',label:'2024/'+String(n).padStart(4,'0')+'(COD)'},new Date(now).toISOString());
  const warmer=new OfficialContextWarmer(store,{clock:()=>now});warmer.initialize();warmer.discover();
  assert.equal(store.db.prepare('SELECT count(*) n FROM official_context_jobs').get().n,50*24*3);
  assert.equal(store.db.prepare("SELECT count(*) n FROM official_context_jobs WHERE date='2024-09-01'").get().n,0);
  const plan=store.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM official_context_jobs INDEXED BY official_context_dispatch WHERE next_check<=? ORDER BY (next_check=0) DESC,date DESC,next_check,kind,value,language LIMIT 1').all(now);
  assert(!plan.some(row=>/TEMP B-TREE/.test(row.detail)));
  const restarted=new OfficialContextWarmer(store,{clock:()=>now});restarted.initialize();restarted.discover();
  assert.equal(store.db.prepare('SELECT count(*) n FROM official_context_jobs').get().n,55*24*3);
  assert.equal(CONTEXT_LANGUAGES.length,24);
});

test('warmer retries failed jobs and expands an exact mapping to every language',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-warmer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let now=1000000;const store=new ActivityStore(dir,{clock:()=>now});t.after(()=>store.close());store.acquire();
  let fail=true;
  const warmer=new OfficialContextWarmer(store,{clock:()=>now,catalog:{known:async()=>new Map(),load:async()=>{if(fail)throw new Error('temporary');return new Map([['2024-0001',{reference:'2024/0001(COD)'}]]);}}});
  warmer.initialize();warmer.enqueue('mapping','2024-0001','en');
  const worker={controller:new AbortController()};await warmer.step(worker);
  assert.equal(store.db.prepare('SELECT attempts FROM official_context_jobs').get().attempts,1);
  fail=false;now+=60001;store.acquire();await warmer.step(worker);
  assert.equal(store.db.prepare("SELECT count(*) n FROM official_context_jobs WHERE kind!='mapping'").get().n,72);
});

test('official source cache survives a new client and background reads reuse existing keys',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-cache-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let fetched=0;const options={writable:true,directory:dir,clock:()=>1000,run:operation=>operation(),fetchSource:async()=>{fetched++;return new Response('<main>retained</main>',{headers:{'content-type':'text/html'}});}};
  const url='https://oeil.europarl.europa.eu/oeil/fr/procedure-file?reference=2024%2F0001%28COD%29';
  await new OfficialContextSources(options).get(url);
  assert.equal((await new OfficialContextSources(options).get(url,{priority:'background'})).html,'<main>retained</main>');assert.equal(fetched,1);
});

test('request hints coalesce and remain bounded',()=>{
  drainOfficialHints();for(let n=0;n<200;n++)hintOfficialContext('https://example.test/'+n);
  assert.equal(drainOfficialHints().length,64);
  assert.equal(acceptOfficialHints({type:'official-context-hints',urls:Array(65).fill('x')}),false);
});

 test('interactive official context and derived caches never publish or prune disk',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-reader-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sources=new OfficialContextSources({directory:dir,run:operation=>operation(),fetchSource:async()=>new Response('<main>live</main>',{headers:{'content-type':'text/html'}})});
  await sources.get('https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2024%2F0001%28COD%29');
  const {EurovocCatalog}=await import('./eurovoc.mjs'),{LegalReferences}=await import('./legal-references.mjs');
  for(const client of [new EurovocCatalog(sources,{directory:dir}),new LegalReferences(sources,{directory:dir})]) {
    await client.cache.save(client.cache.key(['test']),{value:'fallback'});
    await client.cache.pruneBatch();assert.equal(client.cache.cache.size,1);
  }
  assert.deepEqual(readdirSync(dir),[]);assert.equal(sources.cache.cache.size,1);
});

test('origin cap counts attempts durably, isolates origins, and resets next Brussels day',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-cap-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let now=Date.parse('2026-11-01T12:00Z');const store=new ActivityStore(dir,{clock:()=>now});t.after(()=>store.close());store.acquire();
  const create=()=>new OfficialContextWarmer(store,{clock:()=>now,dailyOriginLimit:2});
  create().admitOrigin('https://publications.europa.eu');create().admitOrigin('https://publications.europa.eu');
  assert.throws(()=>create().admitOrigin('https://publications.europa.eu'),/daily origin budget/);
  create().admitOrigin('https://oeil.europarl.europa.eu');now+=86400_000;store.acquire();create().admitOrigin('https://publications.europa.eu');
});

test('official source disk limit is configurable and rejects invalid overrides',t=>{
  const old=process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB;
  t.after(()=>{if(old===undefined)delete process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB;else process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB=old;});
  delete process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB;
  assert.equal(new OfficialContextSources().cache.maxDiskBytes,32768*1024*1024);
  process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB='64';
  assert.equal(new OfficialContextSources().cache.maxDiskBytes,64*1024*1024);
  process.env.OFFICIAL_CONTEXT_MAX_DISK_MIB='0';
  assert.throws(()=>new OfficialContextSources(),/OFFICIAL_CONTEXT_MAX_DISK_MIB/);
});

test('capacity pauses jobs and per-request admission, retains pages across restart and resumes with more space',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-water-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const now=1000000,store=new ActivityStore(path.join(dir,'store'),{clock:()=>now});t.after(()=>store.close());store.acquire();
  let fetched=0;
  const settings={writable:true,directory:path.join(dir,'pages'),clock:()=>now,run:operation=>operation(),fetchSource:async()=>{fetched++;return new Response('<main>'+ 'x'.repeat(1000)+'</main>',{headers:{'content-type':'text/html'}});}};
  const sources=new OfficialContextSources(settings),warmer=new OfficialContextWarmer(store,{clock:()=>now,sources});
  sources.cache.maxEntries=1;
  const url=n=>'https://oeil.europarl.europa.eu/oeil/en/document-summary?id='+n;
  await sources.get(url(1),{priority:'background'});
  const first=await sources.cache.capacity();
  sources.cache.maxDiskBytes=first.bytes/0.9;
  warmer.initialize();warmer.enqueue('url',url(2),'');
  assert.equal(await warmer.step({controller:new AbortController()}),false);
  assert.equal(fetched,1);
  const visitor=new OfficialContextSources({...settings,writable:false,maxDiskBytes:1,fetchSource:async()=>new Response('<main>visitor</main>',{headers:{'content-type':'text/html'}})});
  assert.match((await visitor.get(url(99))).html,/<main>/);
  assert.equal(readdirSync(settings.directory).length,1,'visitor miss remains memory-only at capacity');
  assert.equal(store.status().officialContext.state,'capacity');
  assert.equal(store.db.prepare('SELECT attempts,next_check FROM official_context_jobs').get().attempts,0);
  await assert.rejects(sources.beforeFetch('https://oeil.europarl.europa.eu'),/capacity reached/);
  await sources.cache.prune();
  assert.equal(readdirSync(settings.directory).length,1);
  const restarted=new OfficialContextSources({...settings,maxDiskBytes:first.bytes*10});
  const resumed=new OfficialContextWarmer(store,{clock:()=>now,sources:restarted});
  assert.equal((await restarted.cache.capacity()).bytes,first.bytes);
  assert.equal(await resumed.step({controller:new AbortController()}),true);
  assert.equal(fetched,2);
  await restarted.get(url(1),{priority:'background'});
  assert.equal(fetched,2,'retained entry survives memory eviction and restart');
  const before=await restarted.cache.capacity();
  await restarted.cache.save(restarted.cache.key(['official-context-v1',url(1)]),{url:url(1),fetchedAt:new Date(now).toISOString(),html:'<main>updated</main>'});
  const after=await restarted.cache.capacity();
  assert.equal(after.entries,2);assert(after.bytes<before.bytes,'replacement subtracts superseded bytes');
  restarted.cache.maxDiskEntries=2;
  assert.equal((await restarted.cache.capacity()).state,'capacity','entry limit also stops admission');
  await restarted.cache.prune();
  assert.equal(readdirSync(settings.directory).length,2,'capacity never evicts retained keys');
});

test('request admission stops within a multi-read job when a response crosses high water',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'official-inflight-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new ActivityStore(path.join(dir,'store'));t.after(()=>store.close());store.acquire();
  let fetched=0;
  const sources=new OfficialContextSources({writable:true,directory:path.join(dir,'pages'),maxDiskBytes:1000,run:operation=>operation(),fetchSource:async()=>{fetched++;return new Response('<main>'+ 'x'.repeat(1000)+'</main>',{headers:{'content-type':'text/html'}});}});
  const warmer=new OfficialContextWarmer(store,{sources,catalog:{known:async()=>new Map(),load:async()=>{
    for(const id of [1,2])await sources.get('https://oeil.europarl.europa.eu/oeil/en/document-summary?id='+id,{priority:'background'});
    return new Map();
  }}});
  warmer.initialize();warmer.enqueue('mapping','2024-0001','en');
  await warmer.step({controller:new AbortController()});
  assert.equal(fetched,1);assert.equal((await sources.cache.capacity()).state,'capacity');
  assert.equal(readdirSync(path.join(dir,'pages')).length,1,'crossing response remains retained');
});

test('retained pages are published and counted independently of a cancelled reader request',async t=>{
  const {InsightViewCache}=await import('./insights-view-cache.mjs');
  const {runWithRequestSignal}=await import('./request-budget.mjs');
  const directory=mkdtempSync(path.join(os.tmpdir(),'retained-accounting-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const cache=new InsightViewCache({directory,writable:true,retainDisk:true,maxDiskBytes:1000,maxDiskEntries:100});
  const controller=new AbortController(),key='a'.repeat(64);controller.abort(new Error('owner timed out'));
  // An ambient expired request signal must neither abort the worker-owned write
  // nor leave a renamed file outside the running totals.
  await runWithRequestSignal(controller.signal,()=>cache.saveRetained(key,{payload:'x'.repeat(1200)}));
  const files=readdirSync(directory).filter(name=>name.endsWith('.json'));
  assert.equal(files.length,1);
  const capacity=await cache.capacity();
  assert.equal(capacity.entries,1);assert(capacity.bytes>1000);assert.equal(capacity.state,'capacity');
});

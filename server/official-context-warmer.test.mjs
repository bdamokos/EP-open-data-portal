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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createCatalogueReader,fetchCatalogue,validateCatalogue} from './mmc-catalogue.mjs';
import {speechMedia} from './mmc.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {runWithRequestSignal,requestTimeout} from './request-budget.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/mmc-search-20261005-08.json',import.meta.url),'utf8'));
const date='2026-10-07',now=Date.parse('2026-10-25T12:00:00Z');
const sourceRow=fixture.payload.resultJSON.content.find(row=>row.EventDateStart.startsWith(date));
const row=(id=sourceRow.mediaBusinessID)=>({...sourceRow,mediaBusinessID:id});
const payload=(rows=[row()],patch={})=>({resultJSON:{response:{...fixture.payload.resultJSON.response,pageSize:100,totalElements:String(rows.length),...patch},content:rows}});
const snapshot=(rows=[row()])=>({schemaVersion:1,term:10,dateFrom:date,dateTo:date,fetchedAt:new Date(now).toISOString(),total:rows.length,sourcePages:[{url:fixture.sourceUrl,status:200}],records:rows.map(r=>({id:r.mediaBusinessID,start:r.EventDateStart,end:r.EventDateEnd,status:r.statusName}))});
async function temporary(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'mmc-catalogue-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;
}
const settle=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Condition did not settle');};

test('cold dates load automatically, share one search and survive a reader restart',async t=>{
  const directory=await temporary(t);let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;const query=new URL(url).searchParams;
    assert.equal(query.get('df'),date);assert.equal(query.get('dt'),date);assert.equal(query.get('page'),'1');assert.equal(query.get('pagesize'),'100');
    assert.equal(options.headers['User-Agent'],'Mozilla/5.0 (compatible; EP-OpenData-Explorer/0.1; recording catalogue)');
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Origin,undefined);
    return Response.json(payload());
  };
  const reader=createCatalogueReader({fetchImpl,clock:()=>now});
  const results=await Promise.all(Array.from({length:8},()=>reader(date,directory)));
  assert.equal(calls,1);assert(results.every(r=>r.records[0].id===sourceRow.mediaBusinessID&&!r.stale));
  const saved=JSON.parse(await readFile(path.join(directory,'catalogue-dates-v1',date+'.json'),'utf8'));
  assert.match(saved.sourcePages[0].normalizedJsonSha256,/^[a-f0-9]{64}$/);assert.equal(saved.sourcePages[0].fetchedAt,saved.fetchedAt);
  const restarted=createCatalogueReader({fetchImpl:()=>{throw Error('Unexpected source read');},clock:()=>now});
  assert.equal((await restarted(date,directory)).records[0].id,sourceRow.mediaBusinessID);
});

test('pagination must be complete, stable and free of duplicate IDs before publication',async()=>{
  const rows=Array.from({length:101},(_,i)=>row('20261007-'+i+'-PLENARY'));
  let calls=0;
  const result=await fetchCatalogue(date,{clock:()=>now,fetchImpl:async()=>{
    const page=++calls;return Response.json(payload(rows.slice((page-1)*100,page*100),{page,first:page===1,last:page===2,totalPages:2,totalElements:'101'}));
  }});
  assert.equal(calls,2);assert.equal(result.total,101);assert.equal(result.sourcePages.length,2);
  for(const patch of [{last:false},{totalPages:3},{totalElements:'102'},{code:'1'}])await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>Response.json(payload([row()],patch))}));
  for(const bad of [row('not-an-id'),{...row(),EventDateStart:'2026-10-08 07:00'},{...row(),categoryName:'COMMITTEE'},{...row(),EventDateEnd:'invalid'}])await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>Response.json(payload([bad]))}));
  await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>Response.json(payload([row(),row()]))}));
  let page=0;
  await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>{
    page++;return Response.json(payload(page===1?rows.slice(0,100):[rows[0]],{page,first:page===1,last:page===2,totalPages:2,totalElements:'101'}));
  }}));
});

test('verified empty results are cached briefly and automatically retried for later publication',async()=>{
  let time=now,calls=0;
  const reader=createCatalogueReader({clock:()=>time,fetchImpl:async()=>{calls++;return Response.json(payload(calls===1?[]:[row()]));}});
  assert.equal((await reader(date)).total,0);assert.equal((await reader(date)).total,0);assert.equal(calls,1);
  time+=3600001;
  assert.equal((await reader(date)).refreshInProgress,true);
  await settle(()=>calls===2);
  await settle(async()=>(await reader(date)).total===1);
  assert.equal((await reader(date)).total,1);
});

test('the live unpaginated empty envelope is valid only on a successful first page',async()=>{
  const empty=JSON.parse(await readFile(new URL('./fixtures/mmc-search-empty.json',import.meta.url),'utf8'));
  const snapshot=await fetchCatalogue('2026-10-25',{fetchImpl:async()=>Response.json(empty.payload)});
  assert.equal(snapshot.total,0);assert.deepEqual(snapshot.records,[]);assert.equal(snapshot.sourcePages.length,1);
  for(const patch of [{code:'1'},{totalElements:'0'},{page:1},{last:true}]) {
    const changed=structuredClone(empty.payload);Object.assign(changed.resultJSON.response,patch);
    await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>Response.json(changed)}));
  }
  let calls=0;
  await assert.rejects(fetchCatalogue(date,{fetchImpl:async()=>{
    if(++calls===2)return Response.json(empty.payload);
    return Response.json(payload(Array.from({length:100},(_,i)=>row('20261007-'+i+'-PLENARY')),{last:false,totalPages:2,totalElements:'101'}));
  }}));
  assert.equal(calls,2);
});

test('403 is an unavailable search, never an empty catalogue, and pauses other dates',async t=>{
  const directory=await temporary(t);let calls=0,time=now;
  const reader=createCatalogueReader({clock:()=>time,fetchImpl:async()=>{calls++;return new Response('blocked',{status:403});}});
  await assert.rejects(reader(date,directory),/403/);
  await assert.rejects(reader(date,directory),/403/);
  await assert.rejects(reader('2026-10-08',directory),/403/);assert.equal(calls,1);
  await assert.rejects(readFile(path.join(directory,'catalogue-dates-v1',date+'.json')),error=>error.code==='ENOENT');
  time+=3600001;await assert.rejects(reader(date,directory),/403/);assert.equal(calls,2);
});

test('source denial on another date never marks a fresh catalogue as failed or disables its CDN caching',async()=>{
  let calls=0,time=now;
  const reader=createCatalogueReader({clock:()=>time,fetchImpl:async url=>{
    calls++;
    return new URL(url).searchParams.get('df')===date?Response.json(payload()):new Response('blocked',{status:403});
  }});
  await reader(date);
  await assert.rejects(reader('2026-10-08'),/403/);
  for(const elapsed of [0,3600001]) {
    time=now+elapsed;
    const healthy=await reader(date);
    assert.equal(healthy.stale,false);assert.equal(healthy.refreshInProgress,false);assert.equal(healthy.refreshError,null);
    const policy=apiCachePolicy({method:'GET'},new URL('https://example.test/api/speech-media/test'),{available:true,provenance:{catalogue:healthy}});
    assert.match(policy.cdnCacheControl,/max-age=21600/);
  }
  assert.equal(calls,2);
});

test('local admission failures do not create a date or source-wide failure cooldown',async t=>{
  const queue=new UpstreamQueue({maximum:1,interactiveWaitMs:30});
  const release=await queue.acquire();
  t.mock.method(UpstreamQueue.prototype,'enqueue',queue.enqueue.bind(queue));
  let calls=0;
  const reader=createCatalogueReader({clock:()=>now,fetchImpl:async url=>{
    calls++;
    return Response.json(payload(new URL(url).searchParams.get('df')===date?[row()]:[]));
  }});
  await assert.rejects(reader(date),error=>error.code==='upstream_busy');
  assert.equal(calls,0);release();
  assert.equal((await reader(date)).total,1);assert.equal(calls,1);
  assert.equal((await reader('2026-10-08')).total,0);assert.equal(calls,2);
});

test('failed refresh preserves the legacy file and usable records with stale provenance',async t=>{
  const directory=await temporary(t),old={...snapshot(),dateFrom:'2024-07-01',fetchedAt:'2026-10-13T19:14:09Z'};
  const bytes=JSON.stringify(old);await writeFile(path.join(directory,'catalogue-v1.json'),bytes);let calls=0;
  const reader=createCatalogueReader({clock:()=>now,fetchImpl:async()=>{calls++;return new Response('blocked',{status:403});}});
  const first=await reader(date,directory);assert.equal(first.stale,true);assert.equal(first.fetchedAt,old.fetchedAt);
  await settle(()=>calls===1);await new Promise(resolve=>setImmediate(resolve));
  const retained=await reader(date,directory);assert.match(retained.refreshError,/403/);assert.equal(retained.records[0].id,sourceRow.mediaBusinessID);
  assert.equal(await readFile(path.join(directory,'catalogue-v1.json'),'utf8'),bytes);
  const policy=apiCachePolicy({method:'GET'},new URL('https://example.test/api/speech-media/test'),{available:true,provenance:{catalogue:retained}});
  assert.equal(policy.cdnCacheControl,'no-store');
});

test('legacy catalogues retain smaller-page provenance beyond the automatic search page limit',async t=>{
  const directory=await temporary(t),legacy=snapshot(Array.from({length:101},(_,i)=>row('20261007-'+i+'-PLENARY')));
  legacy.sourcePages=Array.from({length:11},(_,i)=>({url:fixture.sourceUrl+'&page='+(i+1),status:200}));
  const bytes=JSON.stringify(legacy);await writeFile(path.join(directory,'catalogue-v1.json'),bytes);
  const reader=createCatalogueReader({clock:()=>now,fetchImpl:async()=>new Response('blocked',{status:403})});
  const result=await reader(date,directory);
  assert.equal(result.total,101);assert.equal(result.sourcePages.length,11);assert.equal(result.stale,true);
  await settle(async()=>Boolean((await reader(date,directory)).refreshError));
  assert.equal(await readFile(path.join(directory,'catalogue-v1.json'),'utf8'),bytes);
});

test('oversized and malformed responses cannot replace a saved snapshot',async t=>{
  for(const body of ['x'.repeat(2*1024*1024+1),'not json',JSON.stringify({resultJSON:{content:[]}})]) {
    const directory=await temporary(t),file=path.join(directory,'catalogue-dates-v1',date+'.json');
    await mkdir(path.dirname(file),{recursive:true});const bytes=JSON.stringify({...snapshot(),fetchedAt:'2026-01-01T00:00:00Z'});await writeFile(file,bytes);
    let finished=false;
    const reader=createCatalogueReader({clock:()=>now,fetchImpl:async()=>{finished=true;return new Response(body);}});
    assert.equal((await reader(date,directory)).stale,true);await settle(()=>finished);await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(await readFile(file,'utf8'),bytes);
  }
});

test('cancelled first reader cannot cancel another reader or late shared publication',async t=>{
  const directory=await temporary(t);let resolve;
  const response=new Promise(r=>resolve=r),controller=new AbortController();let calls=0;
  const reader=createCatalogueReader({clock:()=>now,fetchImpl:()=>{calls++;return response;}});
  const first=runWithRequestSignal(controller.signal,()=>reader(date,directory));
  const rejection=assert.rejects(first,error=>error.code==='request_timeout');
  const second=reader(date,directory);await settle(()=>calls===1);controller.abort(requestTimeout());await rejection;
  resolve(Response.json(payload()));assert.equal((await second).total,1);
  assert.equal(JSON.parse(await readFile(path.join(directory,'catalogue-dates-v1',date+'.json'),'utf8')).total,1);
});

test('speech lookup invokes automatic discovery and separates blocked search from a verified gap',async()=>{
  const speech={id:'MTG-PL-2026-10-07-OTH-1',date,kind:'PLENARY_DEBATE_SPEECH',start:'2026-10-07T09:00:00Z',end:'2026-10-07T09:01:00Z'};
  const dependencies={directory:null,speech:async()=>speech,loadCatalogue:async d=>{assert.equal(d,date);return snapshot([]);},detail:()=>{throw Error('Must not invent a recording ID');}};
  assert.equal((await speechMedia(speech.id,'en','en',dependencies)).status,'catalogue-missing');
  assert.equal((await speechMedia(speech.id,'en','en',{...dependencies,loadCatalogue:async()=>{throw Error('403');}})).status,'catalogue-unavailable');
  assert.throws(()=>validateCatalogue({...snapshot(),records:[{...snapshot().records[0],end:'2026-10-07 06:00'}]}));
});

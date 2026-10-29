import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recentPlenaryWeeks,startPlenaryWarmup} from './plenary-warmup.mjs';
import {createInsights} from './insights.mjs';
import {MeetingsReader} from './meetings-reader.mjs';

const clock=()=>Date.parse('2026-10-29T12:00:00Z');
const sitting=date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'});

test('warm-up selects the latest four sitting weeks across recesses and year boundaries',()=>{
  const dates=['2026-01-15','2026-01-14','2025-12-18','2025-11-27','2025-11-13','2025-10-22','2026-02-11'];
  const catalogue={sittings:dates.map(sitting),complete:true};
  assert.deepEqual(recentPlenaryWeeks(catalogue,Date.parse('2026-01-16T12:00:00Z')),['2026-01-12','2025-12-15','2025-11-24','2025-11-10']);
  assert.deepEqual(recentPlenaryWeeks({...catalogue,complete:false}),[],'an unknown latest week must not be guessed');
});

test('warming prepares the real week view for a foreground read and a restart without enrichment',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'plenary-warm-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const fixture=JSON.parse(await readFile(new URL('./fixtures/insights-live-20261014.json',import.meta.url),'utf8'));
  const meeting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  const dates=['2026-10-07','2026-10-08','2026-09-17','2026-09-10','2026-07-09','2026-06-18','2026-11-11'],calls=[];
  let ready=false,generation=1,warming=true;
  const store={get:()=>null,status:()=>({currentMeps:ready?1:0,servingGeneration:generation,complete:false,rosterFetchedAt:'2026-10-29T10:00:00Z',lastSuccessfulRefresh:null}),db:{prepare:()=>({get:()=>undefined})}};
  const request=async(endpoint,params,settings)=>{
    calls.push({endpoint,params,settings});
    if(warming)assert.equal(settings.priority,'background');
    const date=endpoint.match(/MTG-PL-(\d{4}-\d{2}-\d{2})/)?.[1];
    const payload=endpoint==='/meetings'?{data:dates.filter(date=>date.startsWith(String(params.year))).map(date=>JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07',date)))}:JSON.parse(JSON.stringify(fixture.foreseen.payload).replaceAll('2026-10-07',date));
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:clock(),payload};
  };
  const options={clock,request,viewCache:{directory},loadMetadata:()=>assert.fail('week lists must not load people or documents')};
  const service=createInsights(store,options);
  await service.warmPlenary();assert.equal(calls.length,0,'wait for a serving roster');ready=true;
  await service.warmPlenary();
  assert.deepEqual(calls.filter(c=>c.endpoint!=='/meetings').map(c=>c.endpoint),dates.slice(0,5).map(date=>'/meetings/MTG-PL-'+date+'/foreseen-activities'));
  warming=false;
  const query=new URLSearchParams('week=latest&lang=en');
  const warmed=await service.query('legislation',query);assert.equal(warmed.week,'2026-10-05');assert(warmed.topics.length>0);
  assert.equal(warmed.agendaSittings.length,2);assert(warmed.topics.every(topic=>topic.id.startsWith(topic.sittingId)));
  const restarted=createInsights(store,{...options,request:(endpoint,...args)=>{assert.equal(endpoint,'/meetings','restart reuses the assembled week after checking calendar selection');return request(endpoint,...args);}});
  assert.deepEqual(await restarted.query('legislation',query),warmed);
  const count=calls.length;
  await service.warmPlenary();assert.equal(calls.length,count,'fresh views and source metadata are reused');
  generation=2;await service.warmPlenary();
  assert.equal((await service.query('legislation',query)).coverage.servingGeneration,2,'prewarm the new index generation');
});

test('warm-up retains missing agendas as explicit gaps',async()=>{
  const store={get:()=>null,status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined})}};
  const service=createInsights(store,{clock,viewCache:{directory:null},request:async(endpoint,{year}={})=>{
    if(endpoint!=='/meetings')throw Error('Temporarily unavailable');
    return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:clock(),payload:{data:year===2026?[sitting('2026-10-07')]:[]}};
  }});
  await service.warmPlenary();
  const result=await service.query('legislation',new URLSearchParams('week=latest'));
  assert.equal(result.coverage.agendaComplete,false);assert.match(result.coverage.agendaError,/Temporarily unavailable/);assert.deepEqual(result.topics,[]);
});

test('warm-up wakes only when data is due, never overlaps, and stops on shutdown',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:clock()});
  let finish,calls=0;
  const stop=startPlenaryWarmup(()=>{calls++;return new Promise(resolve=>finish=resolve);});
  assert.equal(calls,1);t.mock.timers.tick(1000);assert.equal(calls,1);
  finish(100);await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(100);assert.equal(calls,2);
  stop();finish(100);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);assert.equal(calls,2);
});

test('there are no periodic historical cache checks between plenary weeks',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:clock()});
  let calls=0;
  const stop=startPlenaryWarmup(async()=>{calls++;return 10*86400_000;});t.after(stop);
  await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(9*86400_000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  t.mock.timers.tick(86400_000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
});

test('a completed week view does not expire after five minutes or six hours',async t=>{
  let now=clock(),calls=0;
  const fixture=JSON.parse(await readFile(new URL('./fixtures/insights-live-20261014.json',import.meta.url),'utf8'));
  const store={get:()=>null,status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined})}};
  const service=createInsights(store,{clock:()=>now,viewCache:{directory:null},request:async(endpoint,{year}={})=>{
    calls++;
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now,payload:endpoint==='/meetings'?{data:year===2026?fixture.meetings.payload.data.filter(s=>s.activity_id==='MTG-PL-2026-10-07'):[]}:fixture.foreseen.payload};
  }});
  const params=new URLSearchParams('week=2026-10-05'),first=await service.query('legislation',params),count=calls;
  now+=7*60*60_000;
  const second=await service.query('legislation',params);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,count);assert.equal(second.viewCache.stale,false);assert.equal(second.viewCache.refreshInProgress,false);
  assert.equal(second.viewCache.computedAt,first.viewCache.computedAt);assert.deepEqual(second.topics,first.topics);
});

test('latest week follows changed calendar content while a fixed historical week stays cached',async()=>{
  let now=Date.parse('2026-10-20T12:00:00Z'),includeCurrent=false,agendas=0;
  const request=async(endpoint,{year}={})=>{
    if(endpoint!=='/meetings')agendas++;
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now,payload:{data:endpoint==='/meetings'&&year===2026?[sitting('2026-10-07'),...(includeCurrent?[sitting('2026-10-20')]:[])]:[]}};
  };
  const meetings=new MeetingsReader({request,clock:()=>now});
  const store={get:()=>null,status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined})}};
  const service=createInsights(store,{request,meetings,clock:()=>now,viewCache:{directory:null}});
  const latest=new URLSearchParams('week=latest'),fixed=new URLSearchParams('week=2026-10-05');
  assert.equal((await service.query('legislation',latest)).week,'2026-10-05');
  const historical=await service.query('legislation',fixed);
  includeCurrent=true;now+=60_001;await meetings.catalogue();
  assert.equal((await service.query('legislation',latest)).week,'2026-10-19');
  const count=agendas,retained=await service.query('legislation',fixed);
  assert.equal(retained.viewCache.computedAt,historical.viewCache.computedAt);assert.equal(agendas,count);
});

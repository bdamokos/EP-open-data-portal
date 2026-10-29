import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recentPlenaryWeeks,startPlenaryWarmup} from './plenary-warmup.mjs';
import {createInsights} from './insights.mjs';

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
  let ready=false,generation=1;
  const store={get:()=>null,status:()=>({currentMeps:ready?1:0,servingGeneration:generation,complete:false,rosterFetchedAt:'2026-10-29T10:00:00Z',lastSuccessfulRefresh:null}),db:{prepare:()=>({get:()=>undefined})}};
  const request=async(endpoint,params,settings)=>{
    calls.push({endpoint,params,settings});
    assert.equal(settings.priority,'background');
    const date=endpoint.match(/MTG-PL-(\d{4}-\d{2}-\d{2})/)?.[1];
    const payload=endpoint==='/meetings'?{data:dates.filter(date=>date.startsWith(String(params.year))).map(date=>JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07',date)))}:JSON.parse(JSON.stringify(fixture.foreseen.payload).replaceAll('2026-10-07',date));
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:clock(),payload};
  };
  const options={clock,request,viewCache:{directory},loadMetadata:()=>assert.fail('week lists must not load people or documents')};
  const service=createInsights(store,options);
  await service.warmPlenary();assert.equal(calls.length,0,'wait for a serving roster');ready=true;
  await service.warmPlenary();
  assert.deepEqual(calls.filter(c=>c.endpoint!=='/meetings').map(c=>c.endpoint),dates.slice(0,5).map(date=>'/meetings/MTG-PL-'+date+'/foreseen-activities'));
  const count=calls.length;
  const query=new URLSearchParams('week=latest&lang=en');
  const warmed=await service.query('legislation',query);assert.equal(warmed.week,'2026-10-05');assert(warmed.topics.length>0);
  assert.equal(warmed.agendaSittings.length,2);assert(warmed.topics.every(topic=>topic.id.startsWith(topic.sittingId)));
  const restarted=createInsights(store,{...options,request:()=>assert.fail('restart should reuse the assembled disk view')});
  assert.deepEqual(await restarted.query('legislation',query),warmed);
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

test('warm-up ticks do not overlap and shutdown stops future ticks',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  let finish,calls=0;
  const stop=startPlenaryWarmup(()=>{calls++;return new Promise(resolve=>finish=resolve);},{intervalMs:100});
  assert.equal(calls,1);t.mock.timers.tick(1000);assert.equal(calls,1);
  finish();await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(100);assert.equal(calls,2);
  stop();finish();await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);assert.equal(calls,2);
});

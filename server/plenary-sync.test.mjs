import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const block=(day,id,start,end)=>({activity_id:`MTG-PL-${day}-TF-${id}`,had_activity_type:'def/ep-activities/MEETING_PART',activity_start_date:start,activity_end_date:end});

test('a sitting window runs from its first agenda block to two hours after its last',async()=>{
  const {plenarySyncWindow}=await import('./odp.mjs?window');
  const day='2026-10-21';
  const rows=[block(day,'1200','2026-10-21T12:00:00+02:00','2026-10-21T13:00:00+02:00'),
    block(day,'0900','2026-10-21T09:00:00+02:00','2026-10-21T11:50:00+02:00'),
    block(day,'1300','2026-10-21T13:00:00+02:00',['2026-10-21T14:15:00+02:00','2026-10-21T20:00:00+02:00']),
    {activity_id:`MTG-PL-${day}-OJ-ITM-1`,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_start_date:'2026-10-21T23:00:00+02:00'},
    block('2026-10-20','0900','2026-10-20T09:00:00+02:00','2026-10-20T23:00:00+02:00')];
  assert.deepEqual(plenarySyncWindow(rows,day),{start:Date.parse('2026-10-21T07:00:00Z'),end:Date.parse('2026-10-21T20:00:00Z')});
  assert.equal(plenarySyncWindow([],day),null);
  assert.equal(plenarySyncWindow([block(day,'X','unknown',null)],day),null);
});

let lastModule;
async function syncAfter(t,{agenda,elapsedMs}) {
  const dir=await mkdtemp(path.join(tmpdir(),'plenary-sync-'));
  const previous=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=dir;
  t.after(async()=>{if(previous===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=previous;await rm(dir,{recursive:true,force:true});});
  await writeFile(path.join(dir,'sync-state.json'),JSON.stringify({lastSuccess:new Date(Date.now()-elapsedMs).toISOString(),lastAttempt:new Date(Date.now()-elapsedMs).toISOString()}));
  const requests=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);requests.push(url.pathname);
    const sitting=url.pathname.match(/^\/api\/v2\/meetings\/MTG-PL-(\d{4}-\d{2}-\d{2})\/foreseen-activities$/)?.[1];
    if(sitting)return agenda(sitting);
    if(url.pathname.endsWith('/meps/show-current')||url.pathname.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
    if(url.pathname.endsWith('/feed'))return new Response('<feed></feed>',{headers:{'content-type':'application/atom+xml'}});
    assert.fail('Unexpected upstream read '+url.pathname);
  });
  lastModule=Math.random();
  const {syncOdpFeeds}=await import('./odp.mjs?sync-'+lastModule);
  await syncOdpFeeds();
  return requests;
}

test('during a sitting window the feeds sync after an hour',async t=>{
  const iso=offset=>new Date(Date.now()+offset).toISOString();
  const requests=await syncAfter(t,{elapsedMs:90*60_000,agenda:day=>Response.json({data:[block(day,'0900',iso(-3*3600_000),iso(3600_000))]})});
  assert(requests.some(url=>url.endsWith('/meps/feed')),'the hourly sync ran');
});

test('outside a sitting window the feeds wait for the daily sync',async t=>{
  const requests=await syncAfter(t,{elapsedMs:90*60_000,agenda:()=>new Response(null,{status:204})});
  assert(requests.some(url=>url.includes('/foreseen-activities')),'the sitting agenda was consulted');
  assert(!requests.some(url=>url.endsWith('/feed')),'no feed sync before a day has passed');
});

test('the previous sitting day is a calendar day, also across daylight saving changes',async()=>{
  const {previousDay}=await import('./odp.mjs?previous');
  assert.equal(previousDay('2026-03-30'),'2026-03-29');
  assert.equal(previousDay('2026-10-26'),'2026-10-25');
  assert.equal(previousDay('2026-03-01'),'2026-02-28');
});

test('an agenda published later in the day still opens the hourly window',async t=>{
  const iso=offset=>new Date(Date.now()+offset).toISOString();
  let published=false;
  const requests=await syncAfter(t,{elapsedMs:90*60_000,agenda:day=>published?Response.json({data:[block(day,'0900',iso(-3*3600_000),iso(5*3600_000))]}):new Response(null,{status:204})});
  assert(!requests.some(url=>url.endsWith('/meps/feed')),'no sitting was published yet');
  published=true;requests.length=0;
  const {syncOdpFeeds}=await import('./odp.mjs?sync-'+lastModule);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+61*60_000});
  await syncOdpFeeds();
  assert(requests.some(url=>url.includes('/foreseen-activities')),'today\'s empty agenda is rechecked after an hour');
  assert(requests.some(url=>url.endsWith('/meps/feed')),'the published sitting starts the hourly sync');
});

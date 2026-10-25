import test from 'node:test';import assert from 'node:assert/strict';
import {VotePeriods} from './vote-periods.mjs';
import {runWithRequestSignal} from './request-budget.mjs';
const NOW=Date.parse('2026-10-19T12:00:00Z');
const meeting=(date,patch={})=>({id:'https://data.europarl.europa.eu/eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING',...patch});

test('upstream admission pressure serves a bounded last good calendar with stale partial evidence, then recovers',async()=>{
 let now=NOW,busy=false;
 const {service}=setup({rows:{2026:[meeting('2026-10-06')]}});
 service.clock=service.reader.clock=()=>now;
 const request=service.reader.request;
 service.reader.request=(...args)=>busy?Promise.reject(Object.assign(new Error('Rate limited'),{code:'upstream_busy',status:503})):request(...args);
 const good=await service.query();assert.equal(good.version,2);
 now+=60_001;busy=true;
 const saved=await service.query();assert.deepEqual(saved.weeks,good.weeks);assert.equal(saved.coverage.status,'partial');
 assert(saved.coverage.years.every(year=>year.state==='partial'&&year.error.code==='upstream_busy'&&year.sources.every(source=>source.stale&&source.refreshError==='Rate limited')));
 assert.equal(saved.coverage.years[2].sources[0].fetchedAt,good.coverage.years[2].sources[0].fetchedAt);
 assert.equal(saved.coverage.years[2].sources[0].contentHash,good.coverage.years[2].sources[0].contentHash);
 saved.weeks.length=0;
 assert.deepEqual((await service.query()).weeks,good.weeks,'callers cannot mutate the retained observation');
 now=NOW+24*60*60_000;await assert.rejects(service.query(),error=>error.code==='upstream_busy','fallback does not renew its own age');
 busy=false;assert.equal((await service.query()).coverage.status,'complete');
});

test('a calendar fallback cannot hide cold, partial, stale, timed-out or cancelled reads',async()=>{
 const busy=Object.assign(new Error('Busy'),{code:'upstream_busy'});
 const cold=new VotePeriods({meetings:{catalogue:async()=>{throw busy;}}});
 await assert.rejects(cold.query(),error=>error===busy);
 for(const stale of [false,true]){
   const {service}=setup({rows:{2026:[meeting('2026-10-06')]},...(stale?{extra:{stale:true}}:{fail:{2025:true}})});
   await service.query();service.reader.catalogue=async()=>{throw busy;};
   await assert.rejects(service.query(),error=>error===busy);
 }
 const {service}=setup({rows:{2026:[meeting('2026-10-06')]}});await service.query();
 for(const code of ['request_timeout','request_cancelled','odp_unavailable']){
   const error=Object.assign(new Error(code),{code});service.reader.catalogue=async()=>{throw error;};
   await assert.rejects(service.query(),value=>value===error);
 }
 const controller=new AbortController(),cancelled=Object.assign(new Error('Cancelled'),{code:'request_cancelled'});
 service.reader.catalogue=async()=>{controller.abort(cancelled);throw busy;};
 await assert.rejects(runWithRequestSignal(controller.signal,()=>service.query()),error=>error===cancelled);
});
function setup({rows={},fail={},extra={},limits={}}={}){const calls=[];const service=new VotePeriods({clock:()=>NOW,limits,request:async(endpoint,params)=>{assert.equal(endpoint,'/meetings');calls.push({...params});if(fail[params.year])throw new Error('Calendar source unavailable');return {url:'https://data.europarl.europa.eu/api/v2/meetings?'+new URLSearchParams(params),fetchedAt:NOW,payload:{data:(rows[params.year]||[]).slice(params.offset,params.offset+params.limit)},...extra};}});return {service,calls};}
test('calendar explicitly scans every current-term year and groups only exact held sitting identities',async()=>{
 const {service,calls}=setup({rows:{2024:[meeting('2024-07-15'),meeting('2024-07-16')],2025:[meeting('2025-12-18')],2026:[meeting('2026-10-06'),meeting('2026-10-08'),meeting('2026-10-20'),meeting('2026-10-09',{had_activity_type:'OTHER'})]}});
 const data=await service.query();assert.deepEqual(calls.map(c=>c.year),[2024,2025,2026]);assert.equal(data.coverage.status,'complete');
 assert.deepEqual(data.weeks.map(w=>w.week),['2026-10-05','2025-12-15','2024-07-15']);assert.deepEqual(data.weeks[0].sittings.map(s=>s.date),['2026-10-06','2026-10-08']);
 assert.deepEqual(data.weeks.at(-1).sittings.map(s=>s.date),['2024-07-16']);assert.equal(data.coverage.years.length,3);assert(data.coverage.years.every(y=>y.sources[0].contentHash&&y.sources[0].fetchedAt));
 await service.query();assert.equal(calls.length,3);assert.throws(()=>service.query(new URLSearchParams('week=latest')),e=>e.status===400);
});
test('an unavailable year does not stop later years or hide their known sittings',async()=>{
 const {service}=setup({rows:{2026:[meeting('2026-10-06')]},fail:{2025:true}});const data=await service.query();assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.years[1].state,'unavailable');assert(data.coverage.years[1].error);assert.equal(data.weeks[0].week,'2026-10-05');
});
test('page and byte budgets remain explicit per year, with all years represented',async()=>{
 for(const limits of [{pageSize:1,cataloguePages:1},{periodBytes:1},{pageSize:2,maxRows:1}]){const {service}=setup({limits,rows:{2024:[meeting('2024-07-16'),meeting('2024-07-17')],2026:[meeting('2026-10-06')]}});const data=await service.query();assert.equal(data.coverage.years.length,3);assert.notEqual(data.coverage.status,'complete');assert(data.coverage.years.some(y=>['page-budget','row-budget'].includes(y.stopReason)||y.error?.code==='vote_source_size'||y.error?.code==='vote_period_budget'));}
});
test('unavailable calendar stays unavailable, and stale or errored source metadata is retained',async()=>{
 const missing=await setup({fail:{2024:true,2025:true,2026:true}}).service.query();assert.equal(missing.coverage.status,'unavailable');assert.deepEqual(missing.weeks,[]);
 const {service,calls}=setup({rows:{2026:[meeting('2026-10-06')]},extra:{stale:true,refreshInProgress:true,refreshError:{message:'Refresh failed'}}});const data=await service.query();const source=data.coverage.years[2].sources[0];assert.equal(source.stale,true);assert.equal(source.refreshInProgress,true);assert.equal(source.refreshError.message,'Refresh failed');await service.query();assert.equal(calls.length,6,'transient source evidence is not pinned in an assembled cache');
});
test('invalid sitting identity is withheld with partial coverage',async()=>{
 const {service}=setup({rows:{2026:[meeting('2026-10-06',{activity_id:'MTG-PL-2026-10-07'}),meeting('2026-10-08')]}});const data=await service.query();assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.years[2].error.code,'vote_sitting_identity');assert.deepEqual(data.weeks[0].sittings.map(s=>s.date),['2026-10-08']);
});

test('a sitting returned under the wrong year is withheld and cannot establish complete coverage',async()=>{
 const {service}=setup({rows:{2024:[meeting('2026-10-06')]}});const data=await service.query();assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.years[0].stopReason,'identity');assert.deepEqual(data.weeks,[]);
});


test('earlier years cannot consume a later year’s byte budget',async()=>{
 const rows={2024:[meeting('2024-07-16')],2025:[meeting('2025-07-16')],2026:[meeting('2026-10-06')]};
 const perYearBytes=Math.max(...Object.values(rows).map(data=>Buffer.byteLength(JSON.stringify({data}))));
 const {service,calls}=setup({rows,limits:{periodBytes:perYearBytes}});
 const data=await service.query();
 assert.equal(data.coverage.status,'complete');assert(data.coverage.years.every(year=>year.state==='complete'));
 assert.deepEqual(data.weeks.map(week=>week.week),['2026-10-05','2025-07-14','2024-07-15']);
 assert.deepEqual(calls.map(call=>call.year),[2024,2025,2026]);
});

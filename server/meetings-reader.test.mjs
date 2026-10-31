import test from 'node:test';
import assert from 'node:assert/strict';
import {MeetingsReader} from './meetings-reader.mjs';
import {MemberVotes,memberVotesQuery} from './member-votes.mjs';
import {VotePeriods} from './vote-periods.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {cancelledRequest,requestSignal,runWithRequestSignal} from './request-budget.mjs';
const NOW=Date.parse('2026-10-19T12:00:00Z');
const meeting=(date,patch={})=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING',...patch});
function setup({rows=[meeting('2024-07-16'),meeting('2026-10-07'),meeting('2026-10-20')],limits={},extra={}}={}){
 let now=NOW;const calls=[];
 const request=async(endpoint,params)=>{calls.push([endpoint,params]);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:now,payload:{data:rows.filter(n=>Number(n.activity_date.slice(0,4))===params.year).slice(params.offset,params.offset+params.limit)},...extra};};
 const clock=()=>now,reader=new MeetingsReader({clock,request,limits});return {reader,request,clock,calls,advance:ms=>now+=ms};
}
test('votes, periods and insights share one year observation and identical paging evidence',async()=>{
 const {reader,request,clock,calls}=setup();
 const votes=new MemberVotes({readChairs:async()=>null,request,clock,meetings:reader}),periods=new VotePeriods({meetings:reader,clock}),insights=new LegislationInsights(null,{request,clock,meetings:reader});
 const budget={bytes:0};const [selected,dates,catalogue]=await Promise.all([votes.catalogue(memberVotesQuery(new URLSearchParams('week=2026-10-05'),{now:NOW}),budget),periods.query(),insights.catalogue()]);
 assert.equal(calls.length,3);assert.deepEqual(new Set(calls.map(([,p])=>p.year)),new Set([2024,2025,2026]));
 assert.equal(selected.nodes.length,1);assert.equal(dates.weeks[0].week,'2026-10-05');assert(catalogue.sittings.some(n=>n.activity_date==='2026-10-20'));
 assert.deepEqual(selected.coverage.sources,dates.coverage.years[2].sources);assert.deepEqual(catalogue.coverage,dates.coverage);
 const warm={bytes:0};await votes.catalogue(memberVotesQuery(new URLSearchParams('week=2026-10-05'),{now:NOW}),warm);assert.equal(warm.bytes,budget.bytes);assert.equal(calls.length,3);
});
test('independent years retain bounds, wrong-year identities and unavailable observations',async()=>{
 const {reader}=setup({limits:{pageSize:1,cataloguePages:1}});const {coverage}=await reader.catalogue();assert.equal(coverage.status,'partial');assert.equal(coverage.years.length,3);assert.equal(coverage.years[1].state,'complete');
 const wrong=new MeetingsReader({clock:()=>NOW,request:async()=>({url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:NOW,payload:{data:[meeting('2026-10-07')]}})});
 const result=await wrong.year(2024);assert.equal(result.coverage.stopReason,'identity');assert.deepEqual(result.nodes,[]);
});
test('cancelled waiters leave a bounded shared observation available to another reader',async()=>{
 let release,signal,calls=0;const barrier=new Promise(resolve=>release=resolve);
 const reader=new MeetingsReader({clock:()=>NOW,request:async()=>{calls++;signal=requestSignal();await barrier;return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:NOW,payload:{data:[meeting('2026-10-07')]}};}});
 const controller=new AbortController(),first=runWithRequestSignal(controller.signal,()=>reader.year(2026)),second=reader.year(2026);
 await new Promise(resolve=>setImmediate(resolve));controller.abort(cancelledRequest());await assert.rejects(first,e=>e.code==='request_cancelled');assert.equal(signal.aborted,false);release();assert.equal((await second).nodes.length,1);assert.equal(calls,1);
});
test('transient evidence and incomplete pages can recover without a pinned assembled observation',async()=>{
 for(const extra of [{stale:true},{refreshInProgress:true},{refreshError:{message:'retry'}}]){const {reader,calls}=setup({extra});await reader.year(2026);await reader.year(2026);assert.equal(calls.length,2);}
 const {reader,calls,advance}=setup();await reader.year(2026);await reader.year(2026);assert.equal(calls.length,1);advance(60_001);await reader.year(2026);assert.equal(calls.length,2);
});
test('conflicting repeated identities are withheld with partial source evidence',async()=>{
 let page=0;const original=meeting('2026-10-07');const reader=new MeetingsReader({clock:()=>NOW,limits:{pageSize:1},request:async()=>({url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:NOW,payload:{data:[page++?{...original,activity_label:{en:'Changed'}}:original]}})});
 const result=await reader.year(2026);assert.deepEqual(result.nodes,[]);assert.equal(result.coverage.state,'partial');assert.equal(result.coverage.error.code,'vote_source_changed');assert.equal(result.coverage.sources.length,2);
});
test('cached catalogue bytes cannot bypass a selected period budget',async()=>{
 const {reader,request,clock}=setup();
 const query=memberVotesQuery(new URLSearchParams('week=2026-10-05'),{now:NOW});
 for(let attempt=0;attempt<2;attempt++){
   const service=new MemberVotes({readChairs:async()=>null,request,clock,meetings:reader,limits:{periodBytes:1}});
   await assert.rejects(service.catalogue(query,{bytes:0}),e=>e.code==='vote_period_budget');
 }
});
test('catalogue owner expiry rejects late results and prevents cache publication',async()=>{
 let release,calls=0;const barrier=new Promise(resolve=>release=resolve);
 const reader=new MeetingsReader({clock:()=>NOW,limits:{timeoutMs:20},request:async()=>{calls++;await barrier;return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:NOW,payload:{data:[]}};}});
 const keepAlive=setTimeout(()=>{},1000);
 try{await assert.rejects(reader.year(2026),e=>e.code==='request_timeout');release();await new Promise(resolve=>setImmediate(resolve));assert.equal(reader.saved.size,0);await reader.year(2026);assert.equal(calls,2);}finally{clearTimeout(keepAlive);}
});

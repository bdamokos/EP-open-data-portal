import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.ODP_CACHE_DIR='';
const {MemberVotes,memberVotesQuery}=await import('./member-votes.mjs');
const {odp}=await import('./odp.mjs');
import {UpstreamQueue} from './upstream-queue.mjs';

const NOW=Date.parse('2026-10-20T12:00:00Z');
const meeting=date=>({id:'https://data.europarl.europa.eu/eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING',consists_of:[]});
function setup(t,{dates=['2026-01-27'],status=404,metadataStatus=200,counts={},declared=false,missingTail=false,limits={},agenda={}}={}){
 const calls=[],queue=new UpstreamQueue({interval:0,maximum:4});
 t.mock.method(UpstreamQueue.prototype,'runHeld',queue.runHeld.bind(queue));
 const meetings=dates.map(meeting);if(declared)meetings[0].consists_of=[meetings[0].id+'-VOT-ITM-1'];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(String(input));calls.push(url);
  assert.equal(url.origin,'https://data.europarl.europa.eu','only synthetic EP fixtures are allowed');
  const endpoint=url.pathname.replace('/api/v2',''),meta=endpoint==='/meetings'||/^\/meetings\/MTG-PL-\d{4}-\d{2}-\d{2}$/.test(endpoint);
  if(meta)return metadataStatus===200?Response.json({data:meetings.filter(row=>endpoint==='/meetings'||endpoint.endsWith(row.activity_id))}):new Response(null,{status:metadataStatus});
  if(endpoint.endsWith('/decisions')&&!url.searchParams.has('vote-method')){
   const date=endpoint.slice('/meetings/MTG-PL-'.length).split('/')[0],count=counts[date]||0;
   if(count){const rows=Array.from({length:count},(_,index)=>({id:`eli/dl/event/MTG-PL-${date}-DEC-${index+1}`,activity_id:`MTG-PL-${date}-DEC-${index+1}`,activity_date:date,type:'Vote',decision_method:'def/ep-decision-methods/VOTE_HAND',decision_outcome:'def/ep-statuses/ADOPTED'}));const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));if(missingTail&&offset>0)return new Response(null,{status:404});return Response.json({data:rows.slice(offset,offset+limit)});}
  }
  if(endpoint.endsWith('/foreseen-activities')){const date=endpoint.slice('/meetings/MTG-PL-'.length).split('/')[0];if(agenda[date])return Response.json({data:Number(url.searchParams.get('offset'))?[]:agenda[date]});}
  if(status==='network')throw new TypeError('Synthetic connection failure');
  return new Response(null,{status});
 });
 return {calls,service:new MemberVotes({readChairs:async()=>null,clock:()=>NOW,limits,request:(endpoint,params,options)=>odp(endpoint,params,{...options,force:true})})};
}
const query=value=>memberVotesQuery(new URLSearchParams(value),{now:NOW});

for(const date of ['2026-01-27','2025-01-29','2025-11-12'])test('verified debate-only sitting '+date+' retains complete zero-decision HTTP404 observations',async t=>{
 const {service,calls}=setup(t,{dates:[date]}),data=await service.query('42',query('sitting=MTG-PL-'+date));
 assert.equal(data.coverage.status,'complete');assert.equal(data.coverage.collectionComplete,true);assert.equal(data.pagination.observedTotal,0);assert.deepEqual(data.items,[]);
 const sitting=data.coverage.sittings[0];assert.equal(sitting.state,'complete');assert.equal(sitting.observedDecisionCount,0);
 for(const key of ['decisions','namedDecisions','results','agenda']){
  const source=sitting[key].sources[0];assert.equal(sitting[key].stopReason,'not-found');assert.equal(source.httpStatus,404);assert.equal(source.contentHash,createHash('sha256').update('').digest('hex'));assert(Number.isFinite(Date.parse(source.fetchedAt)));assert.equal(new URL(source.url).searchParams.get('offset'),'0');
 }
 assert.equal(calls.length,5,'exact meeting metadata is checked before all four child reads');
});

test('a Brussels week with one debate-only day stays complete, listed and explicitly empty',async t=>{
 const {service}=setup(t),data=await service.query('42',query('week=2026-01-26'));
 assert.equal(data.period.week,'2026-01-26');assert.equal(data.coverage.status,'complete');assert.equal(data.pagination.observedTotal,0);assert.deepEqual(data.coverage.expectedSittingIds,['MTG-PL-2026-01-27']);assert.equal(data.coverage.sittings[0].observedDecisionCount,0);
});

test('Strasbourg Monday procedural decisions are not mislabelled as an empty day',async t=>{
 const counts={'2026-10-05':1,'2026-10-06':70,'2026-10-08':260};const {service}=setup(t,{dates:Object.keys(counts),counts});
 const data=await service.query('42',query('week=2026-10-05'));
 assert.equal(data.coverage.status,'complete');assert.equal(data.pagination.observedTotal,331);assert.deepEqual(data.coverage.sittings.map(day=>day.observedDecisionCount),[1,70,260]);
});

for(const status of [500,'network'])test('real '+status+' child-source failures stay unavailable rather than no-votes',async t=>{
 const {service}=setup(t,{status}),data=await service.query('42',query('sitting=MTG-PL-2026-01-27'));
 assert.equal(data.coverage.status,'unavailable');assert.equal(data.coverage.collectionComplete,false);assert.equal(data.coverage.sittings[0].state,'unavailable');
});

test('missing meeting metadata cannot turn an unverified sitting into an empty one',async t=>{
 const {service,calls}=setup(t,{metadataStatus:404}),data=await service.query('42',query('sitting=MTG-PL-2026-01-27'));
 assert.equal(data.coverage.status,'unavailable');assert.deepEqual(data.coverage.sittings,[]);assert.equal(calls.length,1);
});

test('a missing declared result keeps an otherwise empty HTTP404 day partial',async t=>{
 const {service}=setup(t,{declared:true}),data=await service.query('42',query('sitting=MTG-PL-2026-01-27'));
 assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.sittings[0].state,'partial');assert.equal(data.coverage.collectionComplete,false);assert.equal(data.coverage.sittings[0].completeness.missingResultIds.length,1);
});


test('a later-page 404 cannot certify an already observed collection as complete',async t=>{
 const {service}=setup(t,{counts:{'2026-01-27':1},missingTail:true,limits:{decisionPageSize:1}});
 const data=await service.query('42',query('sitting=MTG-PL-2026-01-27'));
 assert.equal(data.coverage.status,'partial');assert.equal(data.pagination.observedTotal,1);assert.equal(data.coverage.sittings[0].decisions.stopReason,'error');
});


test('a 404 during today’s unfinished sitting remains partial without a no-votes claim',async t=>{
 const {service}=setup(t,{dates:['2026-10-20']}),data=await service.query('42',query('sitting=MTG-PL-2026-10-20'));
 assert.equal(data.coverage.status,'partial');assert.equal(data.coverage.collectionComplete,false);assert.equal(data.coverage.sittings[0].state,'partial');assert.equal(data.pagination.observedTotal,0);
 assert.equal(data.coverage.sittings[0].decisions.stopReason,'not-found');assert.equal(data.coverage.sittings[0].decisions.sources[0].httpStatus,404);
});

const agendaWithVotes=(date,votes=2)=>{
 const event=suffix=>'eli/dl/event/MTG-PL-'+date+suffix,items=Array.from({length:votes},(_,index)=>({id:event('-OJ-ITM-V-'+(index+1)),type:'ForeseenActivity',activity_id:'MTG-PL-'+date+'-OJ-ITM-V-'+(index+1),activity_date:date,had_activity_type:'def/ep-activities/PLENARY_VOTE'}));
 const slot=(time,ids)=>({id:event('-TF-'+time.replace(':','')),type:'ForeseenActivity',activity_id:'MTG-PL-'+date+'-TF-'+time.replace(':',''),activity_start_date:date+'T'+time+':00+02:00',had_activity_type:'def/ep-activities/MEETING_PART',consists_of:ids,inverse_was_scheduled_in:[event('')]});
 return [...items,slot('09:00',[]),slot('12:00',items.map(item=>item.id))];
};

test('scheduled votes without published decisions stay pending and open before the sitting settles',async t=>{
 const date='2026-10-19',{service}=setup(t,{dates:[date],agenda:{[date]:agendaWithVotes(date)}}),data=await service.query('42',query('sitting=MTG-PL-'+date));
 const day=data.coverage.sittings[0];
 assert.deepEqual(day.pendingVotes,{scheduledVoteCount:2,startsAt:date+'T12:00:00+02:00'});
 assert.equal(day.state,'partial');assert.equal(day.completeness.complete,false);assert.equal(data.coverage.status,'partial');assert.equal(data.pagination.observedTotal,0);
});

test('failed vote reads stay unavailable even when the agenda schedules votes',async t=>{
 const date='2026-10-19',{service}=setup(t,{dates:[date],status:500,agenda:{[date]:agendaWithVotes(date)}}),data=await service.query('42',query('sitting=MTG-PL-'+date));
 assert.equal(data.coverage.sittings[0].pendingVotes,null);assert.equal(data.coverage.sittings[0].state,'unavailable');assert.equal(data.coverage.status,'unavailable');
});

test('today’s verified 404 with scheduled votes is pending',async t=>{
 const date='2026-10-20',{service}=setup(t,{dates:[date],agenda:{[date]:agendaWithVotes(date)}}),data=await service.query('42',query('sitting=MTG-PL-'+date));
 assert.deepEqual(data.coverage.sittings[0].pendingVotes,{scheduledVoteCount:2,startsAt:date+'T12:00:00+02:00'});assert.equal(data.coverage.sittings[0].state,'partial');
});

test('agenda without votes, or a settled sitting, keeps the no-votes reading',async t=>{
 for(const [date,agenda] of [['2026-10-19',agendaWithVotes('2026-10-19',0)],['2026-01-27',agendaWithVotes('2026-01-27')]])await t.test(date,async t=>{
  const {service}=setup(t,{dates:[date],agenda:{[date]:agenda}}),data=await service.query('42',query('sitting=MTG-PL-'+date));
  assert.equal(data.coverage.sittings[0].pendingVotes,null);assert.equal(data.coverage.sittings[0].state,'complete');assert.equal(data.coverage.status,'complete');
 });
});

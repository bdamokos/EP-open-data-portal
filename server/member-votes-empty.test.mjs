import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.ODP_CACHE_DIR='';
const {MemberVotes,memberVotesQuery}=await import('./member-votes.mjs');
const {odp}=await import('./odp.mjs');
import {UpstreamQueue} from './upstream-queue.mjs';

const NOW=Date.parse('2026-10-20T12:00:00Z');
const meeting=date=>({id:'https://data.europarl.europa.eu/eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING',consists_of:[]});
function setup(t,{dates=['2026-01-27'],status=404,metadataStatus=200,counts={},declared=false,missingTail=false,limits={}}={}){
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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LegislationInsights,LEGISLATION_VIEW_VERSION} from './insights-legislation.mjs';
import {participation,participationQuery} from './insights-participation.mjs';
import {insightQuery} from './insights-store.mjs';
import {createInsights} from './insights.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const clock=()=>Date.parse('2026-10-15T12:00:00Z');
const sittingId='MTG-PL-2026-10-07',eventId=sittingId+'-PVCRE-ITM-1',debateId=sittingId+'-OJ-ITM-D-1',voteId=sittingId+'-OJ-ITM-V-1';
const uri=id=>'eli/dl/event/'+id;
const agendaEndpoint='/meetings/'+sittingId+'/foreseen-activities';
const resultsEndpoint='/meetings/'+sittingId+'/vote-results',decisionsEndpoint='/meetings/'+sittingId+'/decisions';
const procedureEndpoint='/procedures/2026-0001',documentEndpoint='/plenary-documents/A-10-2026-0001',eventEndpoint='/events/'+eventId;
const policy=(view,value)=>apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/poc/insights/'+view),value,{now:clock()});
const legislationQuery=topic=>insightQuery(new URLSearchParams({sitting:sittingId,...(topic?{topic}:{})}),{kind:'legislation',now:clock()});
const participantQuery=()=>participationQuery(new URLSearchParams({sitting:sittingId}));

function fixture({flags={},fail}={}) {
  const containerId=sittingId+'-OJ-PART-1';
  const sitting={id:uri(sittingId),activity_id:sittingId,activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_SITTING',was_scheduled_in:[uri(containerId)],consists_of:[uri(eventId)]};
  const topic=(id,kind)=>({id:uri(id),activity_id:id,activity_date:sitting.activity_date,activity_label:{en:id},had_activity_type:'def/ep-activities/'+kind,based_on_a_realization_of:['eli/dl/doc/A-10-2026-0001'],inverse_was_scheduled_in:['eli/dl/proc/2026-0001']});
  const event={id:uri(eventId),activity_id:eventId,activity_date:sitting.activity_date,had_activity_type:'def/ep-activities/PLENARY_DEBATE',executed:[uri(debateId)],consists_of:[uri('speech-1')]};
  const document={id:'eli/dl/doc/A-10-2026-0001',identifier:'A-10-2026-0001',inverse_based_on_a_realization_of:[event.id]};
  const payloads={
    '/meetings':[sitting],
    [agendaEndpoint]:[{id:uri(containerId),activity_id:containerId,had_activity_type:'def/ep-activities/MEETING_PART',consists_of:[uri(debateId),uri(voteId)]},topic(debateId,'PLENARY_DEBATE'),topic(voteId,'PLENARY_VOTE')],
    [procedureEndpoint]:[{id:'eli/dl/proc/2026-0001',process_type:'def/ep-procedure-types/COD',consists_of:[event]}],
    [documentEndpoint]:[document],
    [eventEndpoint]:[event],
    [resultsEndpoint]:[{id:uri('result-1'),activity_id:'result-1',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',executed:[uri(voteId)]}],
    [decisionsEndpoint]:[{id:uri('decision-1'),activity_id:'decision-1',activity_date:sitting.activity_date,inverse_consists_of:[uri('result-1')],had_voter_favor:['person/1'],had_voter_against:[],had_voter_abstention:[]}],
  };
  const makeRecord=endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:clock(),payload:{data:payloads[endpoint]},...flags[endpoint]});
  const calls=[];
  const request=async endpoint=>{
    calls.push(endpoint);
    if(endpoint===fail)throw new Error('Synthetic dependency unavailable');
    assert(Object.hasOwn(payloads,endpoint),'Unexpected source request: '+endpoint);
    return makeRecord(endpoint);
  };
  const store={status:()=>({currentMeps:1,servingGeneration:1,complete:false}),db:{prepare:sql=>({all:()=>sql.includes('FROM members')?[{id:'1',body:JSON.stringify({id:'1',name:'Synthetic member',countryCode:'IT'})}]:sql.includes('FROM sources')?[{key:documentEndpoint,body:JSON.stringify(document),fetched_at:new Date(clock()).toISOString()}]:[]})}};
  const options={clock,request,loadMetadata:async()=>new Map()};
  const legislation=new LegislationInsights(store,options);
  const readEvent=async id=>{assert.equal(id,eventId);return makeRecord(eventEndpoint);};
  return {legislation,store,options,readEvent,calls};
}

for(const [name,endpoint,flags,topic] of [
  ['catalogue','/meetings',{stale:true},debateId],
  ['agenda',agendaEndpoint,{refreshInProgress:true},debateId],
  ['procedure',procedureEndpoint,{refreshError:'Synthetic refresh failure'},debateId],
  ['document association',documentEndpoint,{stale:true},debateId],
  ['debate event',eventEndpoint,{stale:true},debateId],
  ['vote results',resultsEndpoint,{refreshInProgress:true},voteId],
  ['decisions',decisionsEndpoint,{refreshError:'Synthetic refresh failure'},voteId],
])test('legislation retains '+name+' freshness inside a fresh assembled view',async()=>{
  const {legislation}=fixture({flags:{[endpoint]:flags}});
  const value=await new InsightViewCache({directory:null,clock}).get(['synthetic',name],()=>legislation.query(legislationQuery(topic)));
  assert.equal(value.viewCache.stale,false);
  const source=value.coverage.sources.find(source=>source.apiUrl.endsWith(endpoint));
  assert(source,'Source identity is retained');
  assert.equal(source.fetchedAt,new Date(clock()).toISOString());
  for(const [key,state] of Object.entries(flags))assert.equal(source[key],state);
  assert.equal(policy('legislation',value).cdnCacheControl,'no-store');
});

for(const [name,endpoint,flags] of [
  ['catalogue','/meetings',{stale:true}],
  ['base agenda',agendaEndpoint,{refreshInProgress:true}],
  ['vote results',resultsEndpoint,{refreshError:'Synthetic refresh failure'}],
  ['decisions',decisionsEndpoint,{stale:true}],
  ['cached event',eventEndpoint,{refreshInProgress:true}],
])test('participation retains '+name+' freshness after projecting its dependencies',async()=>{
  const {legislation,store,readEvent}=fixture({flags:{[endpoint]:flags}});
  const value=await new InsightViewCache({directory:null,clock}).get(['synthetic',name],()=>participation(legislation,store,participantQuery(),{clock,readEvent}));
  assert.equal(value.viewCache.stale,false);
  const source=value.coverage.sources.find(source=>(source.apiUrl||source.url).endsWith(endpoint));
  assert(source,'Participating source identity is retained');
  for(const [key,state] of Object.entries(flags))assert.equal(source[key],state);
  assert.equal(policy('participation',value).cdnCacheControl,'no-store');
});

test('fresh legislation and participation snapshots remain cacheable with incomplete index coverage',async()=>{
  const {legislation,store,readEvent,calls}=fixture();
  const debate=await legislation.query(legislationQuery(debateId)),vote=await legislation.query(legislationQuery(voteId));
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent});
  for(const [view,response] of [['legislation',debate],['legislation',vote],['participation',value]]) {
    assert.equal(response.coverage.indexComplete,false);
    assert.match(policy(view,response).cdnCacheControl,/max-age=21600/);
  }
  assert.equal(calls.length,new Set(calls).size,'Projection does not add upstream requests');
});

for(const [name,fail,kind] of [['agenda',agendaEndpoint,'agenda-unavailable'],['votes',decisionsEndpoint,'votes-unavailable']])test('participation does not publicly cache a caught '+name+' dependency failure',async()=>{
  const {legislation,store,readEvent}=fixture({fail});
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent});
  assert(value.coverage.gaps.some(gap=>gap.kind===kind));
  assert.equal(policy('participation',value).cdnCacheControl,'no-store');
});

test('participation retains a thrown base-query failure as an uncached agenda gap',async()=>{
  const {legislation,store,readEvent}=fixture();
  legislation.query=async()=>{throw new Error('Synthetic base unavailable');};
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent});
  assert(value.coverage.gaps.some(gap=>gap.kind==='agenda-unavailable'));
  assert.equal(policy('participation',value).cdnCacheControl,'no-store');
});

test('pre-freshness legislation and participation views on disk are invalidated after restart',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'insights-source-freshness-'));
  try {
    const priorVersion='titles-phrases-facets-v6';
    for(const [view,query] of [['legislation',legislationQuery(null)],['participation',participantQuery()]]) {
      const version=view==='legislation'?priorVersion+':'+LEGISLATION_VIEW_VERSION:priorVersion;
      await new InsightViewCache({directory,clock}).get([version,view,1,'2026-10-15',query],async()=>({preFreshnessSchema:true}));
    }
    const {store,options,readEvent}=fixture({flags:{[agendaEndpoint]:{stale:true}}});
    const service=createInsights(store,{...options,readEvent,viewCache:{directory}});
    for(const view of ['legislation','participation']) {
      const value=await service.query(view,new URLSearchParams({sitting:sittingId}));
      assert.equal(value.preFreshnessSchema,undefined);
      assert.equal(value.viewCache.stale,false);
      assert(value.coverage.sources.some(source=>source.stale));
      assert.equal(policy(view,value).cdnCacheControl,'no-store');
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

for(const [name,endpoint,topic] of [
  ['procedure',procedureEndpoint,debateId],
  ['document association',documentEndpoint,debateId],
  ['debate event',eventEndpoint,debateId],
  ['vote results',resultsEndpoint,voteId],
  ['decisions',decisionsEndpoint,voteId],
])test('legislation retains a caught '+name+' failure as an uncached operational gap',async()=>{
  const {legislation}=fixture({fail:endpoint});
  const value=await legislation.query(legislationQuery(topic));
  assert(value.detail.coverage.gaps.some(gap=>gap.sourceError===true&&gap.message==='Synthetic dependency unavailable'));
  assert.equal(policy('legislation',value).cdnCacheControl,'no-store');
});

test('weekly legislation keeps the worst freshness for a shared source across days',async()=>{
  const {legislation}=fixture();
  const sittings=['2026-10-06','2026-10-07'].map(date=>({activity_id:'MTG-PL-'+date,activity_date:date}));
  legislation.catalogue=async()=>({sittings,sources:[]});
  const sharedUrl='https://data.europarl.europa.eu/api/v2/meetings';
  legislation.query=async query=>{
    if(query.week)return LegislationInsights.prototype.query.call(legislation,query);
    const first=query.sitting===sittings[0].activity_id;
    return {sitting:{id:query.sitting,date:first?sittings[0].activity_date:sittings[1].activity_date},topics:[],coverage:{agendaComplete:true,agendaError:null,sources:[{apiUrl:sharedUrl,fetchedAt:new Date(clock()).toISOString(),stale:first,refreshInProgress:first,refreshError:first?'Earlier source refresh failed':null}]}};
  };
  const value=await legislation.query({language:'en',week:'2026-10-05'});
  assert.equal(value.coverage.sources.length,1);
  assert.equal(value.coverage.sources[0].stale,true);
  assert.equal(value.coverage.sources[0].refreshInProgress,true);
  assert.equal(value.coverage.sources[0].refreshError,'Earlier source refresh failed');
  assert.equal(policy('legislation',value).cdnCacheControl,'no-store');
});

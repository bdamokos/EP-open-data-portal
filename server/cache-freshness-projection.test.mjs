import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {LegislationInsights,LEGISLATION_LIMITS,LEGISLATION_VIEW_VERSION} from './insights-legislation.mjs';
import {cachedEvent,participation,participationQuery} from './insights-participation.mjs';
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


for(const links of ['empty children','missing children','missing event node'])for(const stale of [true,false])test('participation retains '+(stale?'stale':'fresh')+' cached-event evidence with '+links,async()=>{
  const {legislation,store,readEvent,calls}=fixture();
  const record=await readEvent(eventId);
  if(links==='missing event node')record.payload.data=[];
  else if(links==='missing children')delete record.payload.data[0].consists_of;
  else record.payload.data[0].consists_of=[];
  Object.assign(record,{stale,refreshInProgress:stale});
  const value=await new InsightViewCache({directory:null,clock}).get(['empty-participation',links,stale],()=>participation(legislation,store,participantQuery(),{clock,readEvent:async()=>record}));
  const source=value.coverage.sources.find(source=>source.url===record.url);
  assert(source,'The exact event source remains visible for the unavailable speaker observation');
  assert.equal(source.stale,stale);
  assert.equal(source.refreshInProgress,stale);
  assert.equal(value.topics.find(topic=>topic.id===debateId).speakers,null);
  assert.equal(value.topics.find(topic=>topic.id===debateId).allSpeakers,null);
  assert.equal(value.series[0].speakers,null);
  assert.equal(value.viewCache.stale,false);
  if(stale)assert.equal(policy('participation',value).cdnCacheControl,'no-store');
  else assert.match(policy('participation',value).cdnCacheControl,/max-age=21600/);
  assert(!calls.some(endpoint=>endpoint.startsWith('/events/')),'Cache-only speech links do not introduce a network request');
});

test('participation retains stale empty-event evidence from the existing legislation memory cache',async()=>{
  const {legislation,store,readEvent}=fixture();
  const record=await readEvent(eventId);
  record.payload.data[0].consists_of=[];
  Object.assign(record,{stale:true,refreshInProgress:true});
  legislation.cache.set(JSON.stringify([eventEndpoint,{}]),{at:clock(),value:record});
  let reads=0;
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent:async()=>{reads++;return null;}});
  assert.equal(reads,1,'A transient memory record checks the existing exact disk key for recovery');
  assert.equal(value.topics.find(topic=>topic.id===debateId).speakers,null);
  assert(value.coverage.sources.some(source=>source.url===record.url&&source.stale&&source.refreshInProgress));
  assert.equal(policy('participation',value).cdnCacheControl,'no-store');
});


for(const transient of [{stale:true},{refreshInProgress:true},{refreshError:'Synthetic retry'}])test('legislation observes source recovery after '+Object.keys(transient)[0]+' without waiting six hours',async()=>{
  const flags={[agendaEndpoint]:transient}, {legislation,calls}=fixture({flags});
  const first=await legislation.query(legislationQuery(null));
  assert.equal(policy('legislation',first).cdnCacheControl,'no-store');
  const key=JSON.stringify([agendaEndpoint,{limit:50,offset:0}]);
  assert.equal(legislation.cache.has(key),false,'A transient ODP snapshot is not stored for the normal fresh lifetime');
  flags[agendaEndpoint]={};
  const recovered=await legislation.query(legislationQuery(null));
  assert.match(policy('legislation',recovered).cdnCacheControl,/max-age=21600/);
  assert.equal(calls.filter(endpoint=>endpoint===agendaEndpoint).length,2);
  await legislation.query(legislationQuery(null));
  assert.equal(calls.filter(endpoint=>endpoint===agendaEndpoint).length,2,'Recovered fresh records retain normal reuse');
});

test('fresh legislation sources retain the existing six-hour adapter lifetime',async()=>{
  let now=clock(),calls=0;
  const legislation=new LegislationInsights(null,{clock:()=>now,request:async()=>{calls++;return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:now,payload:{data:[]}};}});
  const first=await legislation.record('/meetings');
  now+=LEGISLATION_LIMITS.cacheMs-1;
  assert.equal(await legislation.record('/meetings'),first);
  assert.equal(calls,1);
  now++;
  assert.notEqual(await legislation.record('/meetings'),first);
  assert.equal(calls,2);
});

test('legislation does not reuse a transient entry retained by an earlier adapter',async()=>{
  const {legislation,calls,readEvent}=fixture();
  const record=await readEvent(eventId);
  legislation.cache.set(JSON.stringify([eventEndpoint,{}]),{at:clock(),value:{...record,stale:true,refreshInProgress:true}});
  const recovered=await legislation.record(eventEndpoint);
  assert.equal(recovered.stale,undefined);
  assert.deepEqual(calls,[eventEndpoint]);
});

test('participation keeps same-record transient evidence and sees a newer fresh raw disk publication',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'participation-event-recovery-'));
  try {
    const {legislation,store,readEvent,calls}=fixture();
    const source=await readEvent(eventId),url='https://data.europarl.europa.eu/api/v2/events/'+eventId+'?format=application%2Fld%2Bjson';
    source.url=url;source.fetchedAt=clock()-LEGISLATION_LIMITS.cacheMs-1;source.payload.data[0].consists_of=[];
    legislation.cache.set(JSON.stringify([eventEndpoint,{}]),{at:clock(),value:{...source,stale:true,refreshInProgress:true,refreshError:'Refresh pending'}});
    const file=path.join(directory,createHash('sha256').update(url).digest('hex')+'.json');
    await writeFile(file,JSON.stringify(source));
    const readSaved=id=>cachedEvent(id,directory);
    const first=await participation(legislation,store,participantQuery(),{clock,readEvent:readSaved});
    const firstSource=first.coverage.sources.find(source=>source.url===url);
    assert.equal(firstSource.stale,true);
    assert.equal(firstSource.refreshInProgress,true);
    assert.equal(firstSource.refreshError,'Refresh pending','Flagless serialization of the same old record does not erase observed refresh state');
    assert.equal(policy('participation',first).cdnCacheControl,'no-store');
    await writeFile(file,JSON.stringify({...source,fetchedAt:clock()}));
    const recovered=await participation(legislation,store,participantQuery(),{clock,readEvent:readSaved});
    const recoveredSource=recovered.coverage.sources.find(source=>source.url===url);
    assert.equal(recoveredSource.stale,false);
    assert.equal(recoveredSource.refreshInProgress,false);
    assert.equal(recoveredSource.refreshError,null);
    assert.equal(recovered.topics.find(topic=>topic.id===debateId).speakers,null,'A fresh partial snapshot still distinguishes unavailable speaker links from zero');
    assert.match(policy('participation',recovered).cdnCacheControl,/max-age=21600/);
    assert(!calls.some(endpoint=>endpoint.startsWith('/events/')),'Recovery only rereads the existing exact disk key');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('participation keeps an old raw disk event cacheable as a saved partial snapshot',async()=>{
  const {legislation,store,readEvent}=fixture();
  const record=await readEvent(eventId);record.fetchedAt=clock()-30*24*60*60_000;record.payload.data[0].consists_of=[];
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent:async()=>record});
  const source=value.coverage.sources.find(source=>source.url===record.url);
  assert.equal(source.stale,false,'Age alone does not make a saved historical observation transient');
  assert.equal(source.fetchedAt,record.fetchedAt);
  assert.equal(value.topics.find(topic=>topic.id===debateId).speakers,null);
  assert.match(policy('participation',value).cdnCacheControl,/max-age=21600/);
});

test('participation rereads an expired unflagged memory event and accepts a fresh cache-only replacement',async()=>{
  const {legislation,store,readEvent}=fixture();
  const record=await readEvent(eventId),old=clock()-LEGISLATION_LIMITS.cacheMs;
  legislation.cache.set(JSON.stringify([eventEndpoint,{}]),{at:old,value:{...record,fetchedAt:old}});
  let reads=0;
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent:async()=>{reads++;return record;}});
  assert.equal(reads,1);
  assert.match(policy('participation',value).cdnCacheControl,/max-age=21600/);
});


test('participation preserves transient memory evidence when its timestamp cannot establish a newer disk publication',async()=>{
  const {legislation,store,readEvent}=fixture();
  const record=await readEvent(eventId);
  legislation.cache.set(JSON.stringify([eventEndpoint,{}]),{at:clock(),value:{...record,fetchedAt:undefined,stale:true}});
  const value=await participation(legislation,store,participantQuery(),{clock,readEvent:async()=>record});
  assert(value.coverage.sources.some(source=>source.url===record.url&&source.stale));
  assert.equal(policy('participation',value).cdnCacheControl,'no-store');
});

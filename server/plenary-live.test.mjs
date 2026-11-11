import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlenaryLive,liveSourceAgent,EBS_PLUS_URL,liveDebateUrl,currentDebate,liveBroadcast,scheduledAgenda,brusselsTime,EBS_PLUS_CHANNEL,plenaryLiveCachePolicy,retainedSittingDates} from './plenary-live.mjs';

const day='2026-10-20',now=Date.parse(day+'T07:10:00Z'),sitting='MTG-PL-'+day;
const feed={currentDate:'20-10-2026',lastUpdate:'20-10-2026 - 09:10',type:'DEB',debateId:'D27530',currentTitle:'A published debate',plenaryMessages:null};
const programme={id:'6acf44004cda7d4921da4b32',channelId:EBS_PLUS_CHANNEL,status:'PUBLISHED',broadcastStatus:'LIVE',startDatetime:day+'T07:00:00Z',titles:[{language:'EN',content:'<p>EP Plenary Session </p><p>A published debate</p>'}],languages:['INT','EN','HU'],transmissions:[{status:'PUBLISHED',media:{status:'PUBLISHED',locked:false,institutions:[{id:'2618'}]}}]};
const item=n=>({id:'eli/dl/event/'+sitting+'-OJ-ITM-D-'+n,activity_id:sitting+'-OJ-ITM-D-'+n,activity_date:day,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_label:{en:'Debate '+n,hu:'Vita '+n}});
const block=(children=[1],start='09:00',end='10:30')=>({id:sitting+'-TF-0900',activity_id:sitting+'-TF-0900',activity_start_date:day+'T'+start+':00+02:00',activity_end_date:day+'T'+end+':00+02:00',had_activity_type:'def/ep-activities/MEETING_PART',consists_of:children.map(n=>'eli/dl/event/'+sitting+'-OJ-ITM-D-'+n)});

test('retained public JSON responses support automatic classification without a daily event ID',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/plenary-live-public.json',import.meta.url),'utf8'));
  const at=Date.parse('2026-10-20T07:54:00Z');
  assert.equal(currentDebate(fixture.feed,day,at).id,'D27530');
  assert.equal(liveBroadcast(fixture.programme,day,at).id,fixture.programme.id);
});

test('current debate uses fresh Brussels source updates and scheduled ends, not ODP identity',()=>{
  assert.equal(brusselsTime(day,'09:10'),now);
  assert.equal(brusselsTime('2026-12-01','09:10'),Date.parse('2026-12-01T08:10:00Z'));
  assert(Number.isNaN(brusselsTime(day,'28:00')));
  assert.equal(currentDebate({...feed,currentEndTime:'09:01:00'},day,now).id,'D27530');
  // The feed changes only with the speaker: a long slot keeps an old update time.
  assert.equal(currentDebate({...feed,lastUpdate:'20-10-2026 - 09:00',currentEndTime:'09:30:00'},day,now).id,'D27530');
  assert.equal(currentDebate({...feed,lastUpdate:'20-10-2026 - 09:00',currentNoMepSpeaker:{name:'CATCH THE EYE',start:'09:01:00',end:'09:08:00'}},day,now).id,'D27530','Three minutes past the speaker slot still holds');
  for(const change of [{currentEndTime:'09:06:59'},{currentEndTime:'11:01:00'},{currentEndTime:'9:30'},{currentMepSpeaker:{end:'09:06:00'}}])assert.equal(currentDebate({...feed,lastUpdate:'20-10-2026 - 09:00',...change},day,now),null,JSON.stringify(change));
  for(const change of [{lastUpdate:'20-10-2026 - 09:00'},{lastUpdate:'20-10-2026 - 09:20'},{currentDate:'19-10-2026'},{plenaryMessages:['Sitting suspended']},{debateId:'MTG-PL-'+day},{type:'unknown'},{currentTitle:''}])assert.equal(currentDebate({...feed,...change},day,now),null);
});

test('broadcast requires an exact channel and published EP plenary classification, not generic EP content',()=>{
  assert.equal(liveBroadcast(programme,day,now).channel,'EbS+');
  for(const change of [{channelId:'60771dc55de36aa6eb4759c6'},{status:'DRAFT'},{broadcastStatus:'RECORDED'},{startDatetime:day+'T09:00:00Z'},{languages:['INT']},{titles:[{language:'EN',content:'<p>EP Political Groups Press Briefings</p>'}]},{titles:{}},{transmissions:[{status:'PUBLISHED',media:{status:'PUBLISHED',locked:false,institutions:[{id:'2620'}]}}]}])assert.equal(liveBroadcast({...programme,...change},day,now),null);
});

test('a Brussels plenary programme lists no transmissions and still plays',()=>{
  // EbS+ on 11 Nov 2026, Brussels: LIVE, EP Plenary Session, transmissions empty.
  const brussels={...programme,transmissions:[],titles:[{language:'EN',content:'<p>EP Plenary Session </p><p> Cyber resilience protecting critical infrastructure and essential supply chains</p>'}]};
  assert.equal(liveBroadcast(brussels,day,now).title,'EP Plenary Session — Cyber resilience protecting critical infrastructure and essential supply chains');
  assert.equal(liveBroadcast({...brussels,transmissions:undefined},day,now).channel,'EbS+');
  assert.equal(liveBroadcast({...brussels,transmissions:[programme.transmissions[0],{status:'PUBLISHED',media:{status:'PUBLISHED',locked:true,institutions:[{id:'2618'}]}}]},day,now),null);
});

test('the Parliament website gets the agent form it accepts; EbS+ keeps the plain one',()=>{
  assert.match(liveSourceAgent(liveDebateUrl(day)),/^Mozilla\/5\.0 \(compatible; EP-OpenData-Explorer\//);
  assert.match(liveSourceAgent(EBS_PLUS_URL),/^EP-OpenData-Explorer\//);
});

test('scheduled markers require one timed container and one exact agenda child; ambiguity is preserved',()=>{
  assert.equal(scheduledAgenda([block(),item(1)],day,now).state,'presumed');
  assert.equal(scheduledAgenda([block(),item(1)],day,Date.parse(day+'T08:30:00Z')).state,'none');
  assert.equal(scheduledAgenda([block([1,2]),item(1),item(2)],day,now).state,'ambiguous');
  assert.equal(scheduledAgenda([block([1,2]),item(1)],day,now).state,'ambiguous','An unresolved declared child is not a unique item');
  assert.equal(scheduledAgenda([block(),item(1),item(1)],day,now).state,'ambiguous','Duplicate child records are not unique');
  for(const timing of [{activity_start_date:[day+'T09:00:00+02:00',day+'T09:20:00+02:00']},{activity_start_date:[]},{activity_end_date:[]},{activity_end_date:'invalid'}]){
    assert.equal(scheduledAgenda([block(),{...block([2]),activity_id:sitting+'-TF-0905',...timing},item(1),item(2)],day,now).state,'ambiguous','Uncertain competing block must remain visible');
  }
  assert.equal(scheduledAgenda([{...block(),activity_end_date:[day+'T10:30:00+02:00',day+'T11:50:00+02:00']},item(1)],day,now).state,'ambiguous');
  assert.equal(scheduledAgenda([block(),{...block([2]),activity_id:sitting+'-TF-0905'},item(1),item(2)],day,now).state,'ambiguous');
  assert.equal(scheduledAgenda(null,day,now).state,'unavailable');
  assert.equal(scheduledAgenda([block(),{...item(1),activity_date:'2026-10-19'}],day,now).state,'ambiguous');
});

test('snapshots share bounded work, keep independent source gaps and do not renew failed live observations',async()=>{
  let clock=now,reads=0,fail=false;
  const service=new PlenaryLive({clock:()=>clock,read:async url=>{reads++;if(fail)throw new Error('offline');return url.includes('getSpeaker')?feed:programme;},readAgenda:async()=>({payload:{data:[block(),item(1)]}})});
  const [a,b]=await Promise.all([service.snapshot(),service.snapshot()]);
  assert.equal(reads,2);assert.equal(a.status,'live');assert.deepEqual(a,b);assert.equal(a.agenda.items[0].id,item(1).activity_id);
  clock+=31_000;fail=true;
  const failed=await service.snapshot();assert.equal(failed.status,'unavailable');assert.equal(failed.broadcast,null);assert.equal(failed.current,null);assert(failed.sources.some(s=>!s.available));assert.equal(failed.agenda.state,'presumed');
  const partial=new PlenaryLive({clock:()=>now,read:async url=>{if(url.includes('getSpeaker'))throw new Error('missing debate feed');return programme;},readAgenda:async()=>{throw new Error('missing agenda');}});
  const p=await partial.snapshot();assert.equal(p.status,'live');assert.equal(p.current,null);assert.equal(p.agenda.state,'unavailable');
});

test('midnight cannot reuse the previous sitting or a stale live programme',async()=>{
  let clock=Date.parse('2026-10-20T21:59:50Z');
  const service=new PlenaryLive({clock:()=>clock,read:async()=>programme,readAgenda:async()=>({payload:{data:[]}})});
  await service.snapshot();clock+=20_000;const next=await service.snapshot();assert.equal(next.broadcast,null);assert.equal(next.current,null);assert.equal(next.agenda.sittingId,'MTG-PL-2026-10-21');
});

test('a day the complete calendar lists no sitting stays valid until just after the next Brussels midnight',async()=>{
  const saturday='2026-10-24',at=Date.parse(saturday+'T10:00:00Z'),offAir={...programme,broadcastStatus:'RECORDED'};
  const reader=dates=>({read:async url=>url.includes('getSpeaker')?{...feed,currentDate:'23-10-2026'}:offAir,readAgenda:async()=>{throw new Error('no agenda');},sittingDates:()=>dates});
  const quiet=await new PlenaryLive({clock:()=>at,...reader(new Set(['2026-10-19','2026-10-22']))}).snapshot();
  // 25 October is the CEST to CET change; its midnight is still 22:00 UTC.
  assert.equal(quiet.nextCheckAt,'2026-10-24T22:01:00.000Z');assert.equal(quiet.validUntil,quiet.nextCheckAt);assert.equal(quiet.status,'off-air');
  assert.deepEqual(plenaryLiveCachePolicy(quiet,at),{cacheControl:'public, max-age=0',cdnCacheControl:'public, max-age=43260, stale-if-error=0'});
  assert.deepEqual(plenaryLiveCachePolicy(quiet,Date.parse('2026-10-24T21:59:30Z')),{cacheControl:'no-store',cdnCacheControl:'no-store'},'Too close to the boundary to cache');
  for(const [dates,label] of [[new Set([saturday]),'sitting day'],[null,'no complete calendar'],[()=>{throw new Error('locked');},'unreadable calendar']]){
    const service=new PlenaryLive({clock:()=>at,...reader(dates)});
    if(typeof dates==='function')service.sittingDates=dates;
    const value=await service.snapshot();
    assert.equal(value.nextCheckAt,new Date(at+30_000).toISOString(),label);assert.equal(value.validUntil,new Date(at+75_000).toISOString(),label);
    assert.deepEqual(plenaryLiveCachePolicy(value,at),{cacheControl:'no-store',cdnCacheControl:'no-store'},label);
  }
  const noFeed=await new PlenaryLive({clock:()=>at,read:async url=>{if(url.includes('getSpeaker'))throw new Error('no feed without a sitting');return offAir;},readAgenda:async()=>{throw new Error('no agenda');},sittingDates:()=>new Set()}).snapshot();
  assert.equal(noFeed.nextCheckAt,quiet.nextCheckAt,'the debate feed has no answer on days without a sitting');
  const sittingWithoutFeed=await new PlenaryLive({clock:()=>now,read:async url=>{if(url.includes('getSpeaker'))throw new Error('feed down');return programme;},readAgenda:async()=>({payload:{data:[]}}),sittingDates:()=>new Set()}).snapshot();
  assert.equal(sittingWithoutFeed.status,'live');assert.deepEqual(plenaryLiveCachePolicy(sittingWithoutFeed,now).cdnCacheControl,'no-store','a broadcast sitting is never quiet, even without the feed');
  const outage=await new PlenaryLive({clock:()=>at,read:async()=>{throw new Error('timeout');},readAgenda:async()=>{throw new Error('no agenda');},sittingDates:()=>new Set()}).snapshot();
  assert.equal(outage.status,'unavailable');assert.equal(outage.nextCheckAt,new Date(at+30_000).toISOString(),'A failed source read is not kept until midnight');
  assert.deepEqual(plenaryLiveCachePolicy({...outage,nextCheckAt:quiet.nextCheckAt},at).cdnCacheControl,'no-store');
  const unexpected=await new PlenaryLive({clock:()=>now,read:async url=>url.includes('getSpeaker')?feed:programme,readAgenda:async()=>({payload:{data:[]}}),sittingDates:()=>new Set()}).snapshot();
  assert.equal(unexpected.status,'live');assert.equal(unexpected.nextCheckAt,new Date(now+30_000).toISOString(),'A live broadcast outweighs the calendar');
  assert.deepEqual(plenaryLiveCachePolicy(unexpected,now).cdnCacheControl,'no-store');
  assert.deepEqual(plenaryLiveCachePolicy({status:'unavailable'},now).cdnCacheControl,'no-store');
});

test('retained sitting dates need a complete calendar and exact sitting identities',()=>{
  const sittingNode=date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'});
  const reader=value=>({read:(kind,version,id,options)=>{assert.equal(kind,'calendar');assert.equal(id,'2026');assert.deepEqual(options,{retained:true});return value;}});
  assert.equal(retainedSittingDates(2026,reader(null)),null);
  assert.equal(retainedSittingDates(2026,reader({coverage:{state:'partial'},nodes:[sittingNode('2026-10-19')]})),null);
  assert.deepEqual([...retainedSittingDates(2026,reader({coverage:{state:'complete'},nodes:[sittingNode('2026-10-19'),{...sittingNode('2026-10-20'),activity_id:'MTG-PL-2026-10-21'}]}))],['2026-10-19']);
});

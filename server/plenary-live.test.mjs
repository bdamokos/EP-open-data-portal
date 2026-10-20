import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlenaryLive,currentDebate,liveBroadcast,scheduledAgenda,brusselsTime,EBS_PLUS_CHANNEL} from './plenary-live.mjs';

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

test('current debate uses fresh Brussels source updates, not projected end times or ODP identity',()=>{
  assert.equal(brusselsTime(day,'09:10'),now);
  assert.equal(brusselsTime('2026-12-01','09:10'),Date.parse('2026-12-01T08:10:00Z'));
  assert(Number.isNaN(brusselsTime(day,'28:00')));
  assert.equal(currentDebate({...feed,currentEndTime:'09:01:00'},day,now).id,'D27530');
  for(const change of [{lastUpdate:'20-10-2026 - 09:00'},{lastUpdate:'20-10-2026 - 09:20'},{currentDate:'19-10-2026'},{plenaryMessages:['Sitting suspended']},{debateId:'MTG-PL-'+day},{type:'unknown'},{currentTitle:''}])assert.equal(currentDebate({...feed,...change},day,now),null);
});

test('broadcast requires an exact channel and published EP plenary classification, not generic EP content',()=>{
  assert.equal(liveBroadcast(programme,day,now).channel,'EbS+');
  for(const change of [{channelId:'60771dc55de36aa6eb4759c6'},{status:'DRAFT'},{broadcastStatus:'RECORDED'},{startDatetime:day+'T09:00:00Z'},{languages:['INT']},{titles:[{language:'EN',content:'<p>EP Political Groups Press Briefings</p>'}]},{titles:{}},{transmissions:[{status:'PUBLISHED',media:{status:'PUBLISHED',locked:false,institutions:[{id:'2620'}]}}]}])assert.equal(liveBroadcast({...programme,...change},day,now),null);
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

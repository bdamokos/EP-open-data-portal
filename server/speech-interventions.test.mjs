import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interventionMetadata,buildInterventionSequence} from './speech-interventions.mjs';
import {SpeechInterventions} from './speech-intervention-service.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/speech-interventions-live-20261015.json',import.meta.url)));
const parentId=fixture.parent.activity_id;
const sequence=activities=>buildInterventionSequence(activities,{parentId,expectedIds:fixture.parent.consists_of});
const byNumber=n=>fixture.activities.find(a=>a.recorded_in_a_realization_of?.[0]?.numbering===n);
const clone=value=>structuredClone(value);
const response=data=>({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:Date.parse('2026-10-15T22:00:00Z'),payload:{data,meta:{total:data.length},searchResults:{hits:data.map(a=>({id:a.id}))}}});

test('live headers separate blue-card questions, answers and reactions, while group mandates use JSON IDs',()=>{
  assert.equal(interventionMetadata(byNumber(173)).type,'blue-card-question');
  assert.equal(interventionMetadata(byNumber(174)).type,'blue-card-answer');
  assert.equal(interventionMetadata(byNumber(175)).type,'blue-card-reaction');
  assert.equal(interventionMetadata(byNumber(176)).type,'blue-card-reaction');
  const group=interventionMetadata(byNumber(141)).onBehalfOf;
  assert.deepEqual(group.map(g=>[g.id,g.label,g.politicalGroup]),[['S_D','S&D',true]]);
  assert.deepEqual(interventionMetadata(byNumber(172)).onBehalfOf,[]);
  assert.equal(interventionMetadata(byNumber(179)).type,'speech','the question XML element alone does not mean a blue card');
  const intervention=clone(byNumber(173));intervention.recorded_in_a_realization_of[0]['api:xmlFragment'].en=intervention.recorded_in_a_realization_of[0]['api:xmlFragment'].en.replace('blue-card question','blue-card intervention');
  assert.equal(interventionMetadata(intervention).type,'blue-card-intervention');
  assert(sequence(fixture.activities.map(a=>a.activity_id===intervention.activity_id?intervention:a)).exchanges.some(e=>e.id===byNumber(172).activity_id));
});
test('live A/B/A chain links original, question, answer, reactions and another question by exact speaker IDs',()=>{
  const result=sequence(fixture.activities),original=byNumber(180).activity_id;
  const exchange=result.exchanges.find(e=>e.id===original);
  assert.deepEqual(exchange.ids,[180,181,182,183,184,185,186,187,188].map(n=>byNumber(n).activity_id));
  assert.equal(exchange.pairs.length,2);
  assert.equal(exchange.pairs[0].respondentId,'197580');assert.equal(exchange.pairs[1].questionerId,'256971');
  assert.equal(result.records.find(r=>r.id===byNumber(182).activity_id).replyTo,byNumber(181).activity_id);
  assert.equal(result.coverage.complete,false);assert.deepEqual(result.coverage.missingIds,['MTG-PL-2026-10-06-OTH-2017097917624']);
});
test('catch-the-eye uses paired published markers and cannot leak into subsequent speeches',()=>{
  const result=sequence(fixture.activities);
  assert.deepEqual(result.records.filter(r=>r.intervention.type==='catch-the-eye').map(r=>r.intervention.numbering),[231,232,233,234,235,236,237]);
  assert.notEqual(result.records.find(r=>r.intervention.numbering===239)?.intervention.type,'catch-the-eye');
  const missing=sequence(fixture.activities.filter(a=>a.activity_id!==byNumber(234).activity_id));
  assert.equal(missing.records.filter(r=>r.intervention.type==='catch-the-eye').length,0);
});
test('missing contributions, wrong respondents, foreign parents and unknown headers stop implicit links',()=>{
  for(const mutate of [
    rows=>rows.filter(a=>a.activity_id!==byNumber(173).activity_id),
    rows=>{const answer=rows.find(a=>a.activity_id===byNumber(174).activity_id);answer.had_participation.had_participant_person=['person/999999'];return rows;},
    rows=>{rows.find(a=>a.activity_id===byNumber(174).activity_id).inverse_consists_of=['eli/dl/event/MTG-PL-2026-10-06-PVCRE-ITM-12'];return rows;},
    rows=>{delete rows.find(a=>a.activity_id===byNumber(173).activity_id).recorded_in_a_realization_of[0]['api:xmlFragment'];return rows;}
  ])assert(!sequence(mutate(clone(fixture.activities))).exchanges.some(e=>e.id===byNumber(172).activity_id));
});
test('body mentions do not classify speeches; invalid XML and external entities produce no header observations',()=>{
  const activity=clone(byNumber(172));activity.recorded_in_a_realization_of[0]['api:xmlFragment'].en='<oralStatements><speech><from><person refersTo="epdata:person/257070">Member</person> (<organization>ESN</organization>).</from><p>blue card question, catch-the-eye, on behalf of the group</p></speech></oralStatements>';
  assert.equal(interventionMetadata(activity).type,'speech');assert.deepEqual(interventionMetadata(activity).onBehalfOf,[]);
  for(const xml of ['<speech>broken','<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><oralStatements>&x;</oralStatements>']) {
    activity.recorded_in_a_realization_of[0]['api:xmlFragment'].en=xml;
    assert.equal(interventionMetadata(activity).headerAvailable,false);assert.equal(interventionMetadata(activity).type,'unclassified');
  }
});
test('selected debate service uses bounded public sitting pages, shares in-flight requests and retains exact provenance',async()=>{
  const calls=[];const request=async(endpoint,params)=>{
    calls.push([endpoint,params]);
    if(endpoint==='/events/'+parentId)return response([fixture.parent]);
    if(endpoint.startsWith('/speeches/'))return response([fixture.activities.find(a=>a.activity_id===endpoint.split('/').at(-1))]);
    assert.equal(endpoint,'/speeches');assert.equal(params.language,'en');assert.equal(params['sitting-date'],'2026-10-06');assert.equal(params.limit,500);assert.equal(params['activity-type'],undefined);
    return response(fixture.activities);
  };
  const service=new SpeechInterventions({request});
  const [question,answer]=await Promise.all([service.context(byNumber(173).activity_id),service.context(byNumber(174).activity_id)]);
  assert.equal(calls.filter(([endpoint])=>endpoint==='/speeches').length,1);
  assert.equal(question.debates[0].exchanges.find(e=>e.ids.includes(question.speechId)).id,byNumber(172).activity_id);
  assert.equal(answer.debates[0].exchanges.find(e=>e.ids.includes(answer.speechId)).id,byNumber(172).activity_id);
  assert(question.debates[0].sources.every(s=>s.url.startsWith('https://data.europarl.europa.eu/')&&s.fetchedAt));
});
test('member statistics deduplicate exact records, count historical designations, and expose incomplete observations',async()=>{
  const member='257070',rows=fixture.activities.filter(a=>a.had_participation?.had_participant_person?.includes('person/'+member));
  const service=new SpeechInterventions({request:async(endpoint,params)=>{assert.equal(endpoint,'/speeches');assert.equal(params['person-id'],member);assert.equal(params['parliamentary-term'],10);return response(rows);}});
  const result=await service.member(member);assert.equal(result.coverage.complete,true);
  assert.equal(result.counts.blueAnswers,1);assert.equal(result.counts.blueReactions,1);assert.equal(result.counts.blueQuestions,0);assert.equal(result.counts.catchTheEye,null);
  const groupService=new SpeechInterventions({request:async()=>response([byNumber(141)])});assert.equal((await groupService.member('197591')).counts.groupOrations,1);
  const missingService=new SpeechInterventions({request:async()=>({...response(rows),payload:{...response(rows).payload,meta:{total:rows.length+1}}})});
  assert.equal((await missingService.member(member)).coverage.complete,false);
});
test('member statistics page boundaries, overlaps and total changes never report a complete count',async()=>{
  const rows=Array.from({length:51},(_,i)=>{const a=clone(byNumber(173));a.activity_id='MTG-PL-2026-10-06-OTH-'+(100000+i);a.id='eli/dl/event/'+a.activity_id;return a;});
  let requests=0;
  const service=new SpeechInterventions({request:async(endpoint,params)=>{requests++;const data=params.offset===0?rows.slice(0,50):[rows[49]];return {...response(data),payload:{...response(data).payload,meta:{total:51}}};}});
  const first=await service.member('256971');assert.equal(first.nextPage,1);assert.equal(first.counts.blueQuestions,50);assert.equal(first.coverage.complete,false);
  const last=await service.member('256971',1);assert.equal(last.coverage.available,50);assert.equal(last.counts.blueQuestions,50);assert.equal(last.coverage.complete,false);assert(last.coverage.issues.includes('overlapping-pages'));
  await service.member('256971',1);assert.equal(requests,2);
  const invalid=new SpeechInterventions({request:async()=>response(rows.slice(0,50))});await invalid.member('256971');
  await assert.rejects(invalid.member('256971',3),e=>e.status===400);
});

test('missing or mismatched headers keep unavailable statistics distinct from zero',async()=>{
  const row=clone(byNumber(172));delete row.recorded_in_a_realization_of[0]['api:xmlFragment'];
  const service=new SpeechInterventions({request:async()=>response([row])});
  const result=await service.member('257070');assert.equal(result.coverage.complete,false);assert.equal(result.counts.blueQuestions,null);assert.equal(result.counts.blueAnswers,null);assert.equal(result.counts.groupOrations,0);
  const bad=clone(byNumber(173));bad.had_participation.had_participant_person=['person/99999'];assert.equal(interventionMetadata(bad).type,'unclassified');
});
test('English API fragments with retained German blue-card headers are classified from the supplied process label',()=>{
  assert.equal(fixture.headerExamples.length,3);
  assert.deepEqual(fixture.headerExamples.map(e=>interventionMetadata(e.activity).type).sort(),['blue-card-question','blue-card-question','blue-card-reaction']);
  assert(fixture.headerExamples.every(e=>e.url.startsWith('https://data.europarl.europa.eu/api/v2/speeches?')&&e.fetchedAt));
});
test('saved counter-replies remain in the exchange and count as reactions rather than additional answers',async()=>{
  const result=sequence(fixture.activities),exchange=result.exchanges.find(e=>e.id===byNumber(209).activity_id);
  assert.deepEqual(exchange.ids,[209,210,211,212,213].map(n=>byNumber(n).activity_id));
  assert.equal(interventionMetadata(byNumber(212)).type,'blue-card-reaction');assert.equal(interventionMetadata(byNumber(213)).type,'blue-card-reaction');
  const rows=[209,211,213].map(byNumber),stats=await new SpeechInterventions({request:async()=>response(rows)}).member('213330');
  assert.equal(stats.counts.blueAnswers,1);assert.equal(stats.counts.blueReactions,1);
});
test('a speech in a numbered subitem opens its exact published parent',async()=>{
  const speech=fixture.headerExamples.find(e=>e.activity.activity_id==='MTG-PL-2026-07-08-OTH-2017087113147').activity;
  const parent=fixture.subitemParentExample.payload.data[0],calls=[];
  const service=new SpeechInterventions({request:async(endpoint)=>{calls.push(endpoint);if(endpoint.startsWith('/events/'))return response([parent]);return response([speech]);}});
  const context=await service.context(speech.activity_id);
  assert.equal(context.unavailable,false);assert.equal(context.debates[0].id,'MTG-PL-2026-07-08-PVCRE-ITM-21-2');
  assert(calls.includes('/events/MTG-PL-2026-07-08-PVCRE-ITM-21-2'));assert(context.debates[0].records.some(r=>r.id===speech.activity_id));
});
test('evicting an unfinished member selection restarts the browser page walk without losing the final count',async()=>{
  const rows=Array.from({length:51},(_,i)=>{const a=clone(byNumber(173));a.activity_id='MTG-PL-2026-10-06-OTH-'+(100000+i);a.id='eli/dl/event/'+a.activity_id;return a;});
  const offsets=[];
  const service=new SpeechInterventions({request:async(endpoint,params)=>{
    if(String(params['person-id'])==='256971') {offsets.push(params.offset);const data=rows.slice(params.offset,params.offset+50);return {...response(data),payload:{...response(data).payload,meta:{total:51}}};}
    return response([]);
  }});
  const first=await service.member('256971');assert.equal(first.nextPage,1);
  for(let id=1;id<=8;id++)await service.member(String(id));
  assert.equal(service.members.size,8);
  const restarted=await service.member('256971',first.nextPage);assert.equal(restarted.restarted,true);assert.equal(restarted.nextPage,1);
  const completed=await service.member('256971',restarted.nextPage);
  assert.equal(completed.coverage.complete,true);assert.equal(completed.coverage.available,51);assert.equal(completed.counts.blueQuestions,51);
  assert.deepEqual(offsets,[0,0,50]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outsideSpeech} from './outside-model.mjs';
import {interventionMetadata} from './speech-interventions.mjs';
import {SpeechInterventions} from './speech-intervention-service.mjs';
import {speechAgendaMembership,speechParentEvidence} from './speech-agenda.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/outside-agenda-conflict.json',import.meta.url),'utf8'));
const parents=['MTG-PL-2026-04-28-PVCRE-ITM-11','MTG-PL-2026-04-28-PVCRE-ITM-12'];
const row={date:'2026-04-28',term:10,parentIds:parents,parentDocumentIds:['CRE-10-2026-04-28-ITM-012'],parentDocumentsComplete:true,parentDocumentId:'CRE-10-2026-04-28-ITM-012'};

test('both Court of Auditors speeches resolve the published contradiction from their CRE chapter',()=>{
  for(const {activity,retrievedAt,sourceUrl} of fixture.contributions) {
    const before=structuredClone(activity),outside=outsideSpeech(activity,retrievedAt,sourceUrl),meta=interventionMetadata(activity);
    assert.deepEqual(outside.parentIds,[parents[1]]);
    assert.deepEqual(meta.parentIds,[parents[1]]);
    assert.deepEqual(outside.reportedParentIds,parents);
    assert.deepEqual(meta.reportedParentIds,parents);
    assert.deepEqual(activity,before,'public source data is retained');
  }
});

test('the speech reader opens one discharge sequence and never fetches the contradicted resumption',async()=>{
  const rows=fixture.contributions.map(row=>row.activity),calls=[];
  const service=new SpeechInterventions({request:async(endpoint)=>{
    calls.push(endpoint);
    const data=endpoint==='/speeches/'+rows[0].activity_id?[rows[0]]:endpoint==='/events/'+parents[1]?[{...fixture.agendas[1].activity,consists_of:rows.map(a=>a.id)}]:endpoint==='/speeches'?rows:null;
    assert(data,'Unexpected source request: '+endpoint);
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data,meta:{total:data.length}}};
  }});
  const context=await service.context(rows[0].activity_id);
  assert.equal(context.debates.length,1);assert.equal(context.debates[0].id,parents[1]);
  assert.deepEqual(context.debates[0].records.map(r=>r.id),rows.map(a=>a.activity_id));
  assert(!calls.includes('/events/'+parents[0]));
});

test('the same rule resolves other procedural headings, reversed parent order and numbered vote subitems',()=>{
  const controls=fixture.controls.slice(2);
  const expected=['MTG-PL-2026-04-28-PVCRE-ITM-10-7','MTG-PL-2026-04-28-PVCRE-ITM-22-1','MTG-PL-2026-04-28-PVCRE-ITM-14'];
  for(const [index,{activity,retrievedAt,sourceUrl}] of controls.entries()) {
    const projected=outsideSpeech(activity,retrievedAt,sourceUrl);
    assert.deepEqual(projected.parentIds,[expected[index]]);
    const reversed=structuredClone(activity);reversed.inverse_consists_of.reverse();
    assert.deepEqual(outsideSpeech(reversed,retrievedAt).parentIds,projected.parentIds);
  }
});

test('real speeches under resumption headings stay there; chapter continuity is never inferred',()=>{
  for(const {activity,retrievedAt,sourceUrl} of fixture.controls.slice(0,2)) {
    const projected=outsideSpeech(activity,retrievedAt,sourceUrl) || interventionMetadata(activity);
    assert.deepEqual(projected.parentIds,activity.inverse_consists_of.map(uri=>uri.split('/').at(-1)));
    assert.equal(projected.reportedParentIds,undefined);
  }
  // The published 8 June 2021 transcript puts the continued Own Resources
  // debate in chapter 6, following the separate resumption in chapter 5.
  const continued={date:'2021-06-08',term:9,parentIds:['MTG-PL-2021-06-08-PVCRE-ITM-4','MTG-PL-2021-06-08-PVCRE-ITM-6'],parentDocumentIds:['CRE-9-2021-06-08-ITM-006'],parentDocumentsComplete:true,parentDocumentId:'CRE-9-2021-06-08-ITM-006'};
  assert.deepEqual(speechAgendaMembership(continued).parentIds,[continued.parentIds[1]]);
  const reopening={...continued,parentDocumentId:'CRE-9-2021-06-08-ITM-005',parentIds:['MTG-PL-2021-06-08-PVCRE-ITM-5']};
  assert.deepEqual(speechAgendaMembership(reopening),reopening);
});

test('missing, foreign, cross-date, cross-term or conflicting documents never choose a parent',()=>{
  for(const change of [
    {parentDocumentIds:[]},{parentDocumentIds:['CRE-10-2026-04-28-ITM-013']},
    {parentDocumentIds:['CRE-9-2026-04-28-ITM-012']},
    {parentDocumentIds:['CRE-10-2026-04-29-ITM-012']},
    {parentDocumentIds:['https://elsewhere.example/CRE-10-2026-04-28-ITM-012']},
    {parentDocumentIds:['CRE-10-2026-04-28-ITM-011','CRE-10-2026-04-28-ITM-012']},
    {parentIds:[parents[0],'MTG-PL-2026-04-29-PVCRE-ITM-12']},
    {parentIds:[parents[0],'MTG-PL-2026-04-28']},
  ]) {
    const input={...row,...change};
    assert.deepEqual(speechAgendaMembership(input),input);
  }
  const activity=structuredClone(fixture.contributions[0].activity);
  activity.recorded_in_a_realization_of[0].is_part_of='https://elsewhere.example/eli/dl/doc/CRE-10-2026-04-28-ITM-012';
  assert.deepEqual(speechParentEvidence(activity),{parentDocumentIds:[],parentDocumentsComplete:false});
  assert.deepEqual(outsideSpeech(activity,'2026-10-17').parentIds,parents);
});

test('all explicit transcript documents participate in resolution; original parents survive repeated reads',()=>{
  const activity=structuredClone(fixture.contributions[0].activity);
  const duplicate=structuredClone(activity.recorded_in_a_realization_of[0]);
  duplicate.is_part_of={'id':'https://data.europarl.europa.eu/eli/dl/doc/CRE-10-2026-04-28-ITM-012'};
  activity.recorded_in_a_realization_of.push(duplicate);
  assert.equal(outsideSpeech(activity,'2026-10-17').parentIds.length,1);
  duplicate.is_part_of='eli/dl/doc/CRE-10-2026-04-28-ITM-011';
  assert.deepEqual(outsideSpeech(activity,'2026-10-17').parentIds,parents);
  // Legacy scalar evidence cannot show that the second document conflicted.
  const legacy={...row};delete legacy.parentDocumentIds;
  assert.deepEqual(speechAgendaMembership(legacy).parentIds,parents);
  duplicate.is_part_of='eli/dl/doc/CRE-10-2026-04-28-ITM-12';
  const equivalent=outsideSpeech(activity,'2026-10-17');
  assert.deepEqual(equivalent.parentIds,[parents[1]]);
  assert.equal(equivalent.parentDocumentId,'CRE-10-2026-04-28-ITM-012');
  assert.deepEqual(speechAgendaMembership(speechAgendaMembership(row)),speechAgendaMembership(row));
});

test('an unexpanded, missing or foreign secondary document leaves multi-parent evidence unresolved',()=>{
  for(const secondary of ['eli/dl/doc/CRE-10-2026-04-28-OTH-123',{},
    {is_part_of:'https://elsewhere.example/eli/dl/doc/CRE-10-2026-04-28-ITM-011'}]) {
    const activity=structuredClone(fixture.contributions[0].activity);
    activity.recorded_in_a_realization_of.push(secondary);
    const projected=outsideSpeech(activity,'2026-10-17');
    assert.equal(projected.parentDocumentsComplete,false);
    assert.deepEqual(projected.parentIds,parents);
    assert.deepEqual(interventionMetadata(activity).parentIds,parents);
  }
});

test('chair-change containment is preserved: its transcript placement can mark the next chapter boundary',()=>{
  const activity=structuredClone(fixture.contributions[0].activity);
  activity.had_activity_type='def/ep-activities/MEETING_NAME_CHAIR';
  assert.deepEqual(interventionMetadata(activity).parentIds,parents);
});

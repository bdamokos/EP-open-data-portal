import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildExamples,recordedPosition} from './model.mjs';
const record=(value,path='/procedures/2025-0001')=>({url:'https://data.europarl.europa.eu/api/v2'+path,fetchedAt:'2026-10-24T00:00:00Z',payload:{data:[value]}});
function observations(){
  const participation={id:'participation/role',had_participant_person:['person/42'],participation_role:'def/ep-roles/RAPPORTEUR',occured_at_stage:'phase/RDG1'};
  const p={id:'eli/dl/proc/2025-0001',label:'2025/0001(COD)',process_title:{en:'Title'},had_participation:[participation],consists_of:[{id:'eli/dl/event/result',had_activity_type:'activities/PLENARY_VOTE_RESULTS'}]};
  const report={id:'eli/dl/doc/A-10-2026-0001',inverse_created_a_realization_of:[p.id],document_date:'2026-01-01',inverse_foresees_change_of:[{id:'eli/dl/doc/A-10-2026-0001-AM-001-001',foresees_change_of:['eli/dl/doc/A-10-2026-0001']}]};
  const ballot={id:'eli/dl/event/decision',activity_date:'2026-02-01',decided_on_a_realization_of:['eli/dl/doc/A-10-2026-0001-AM-1'],decision_method:'method/VOTE_ELECTRONIC_ROLLCALL',decision_outcome:'status/ADOPTED',had_voter_favor:['person/42'],had_voter_against:[],had_voter_abstention:[]};
  const person={id:'person/42',identifier:'42',givenName:'Alex',familyName:'Member',hasMembership:[{role:'role/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16',endDate:'2029-07-15'}}]};
  const amendment={number:1,listId:'A-10-2026-0001-AM-001-001',date:'2026-01-02',authors:['Alex Member'],language:'en',originalText:null,proposedText:null};
  return {procedures:[record(p)],reports:[record(report)],results:[record({id:'eli/dl/event/result',consists_of:[ballot.id]})],decisions:[record(ballot)],catalogues:[],profiles:[record(person)],roster:{payload:{data:[person]}},extractions:[{meta:{url:'https://data.europarl.europa.eu/distribution/example.docx',fetchedAt:'2026-10-24T00:00:00Z',listId:amendment.listId,targetDocumentId:'A-10-2026-0001'},extraction:{amendments:[amendment],gaps:[]}}],examplePairs:[['2025-0001','42']]};
}
test('intentions, non-named ballots, missing lists and conflicting choices never become an actual abstention',()=>{
  const base={decision_method:'method/VOTE_ELECTRONIC_ROLLCALL',had_voter_favor:[],had_voter_against:[],had_voter_abstention:[],had_voter_intended_abstention:['person/42']};
  assert.deepEqual(recordedPosition(base,'42'),{position:null,status:'not-recorded'});
  assert.deepEqual(recordedPosition({...base,had_voter_favor:['person/42'],had_voter_against:['person/42']},'42'),{position:null,status:'conflicting'});
  assert.equal(recordedPosition({...base,had_voter_abstention:undefined},'42').status,'unavailable');
  assert.equal(recordedPosition({...base,decision_method:'method/SHOW_OF_HANDS'},'42').status,'not-named');
});
test('document date cannot supply a missing role date or appointment; press stays unavailable',()=>{
  const result=buildExamples(observations());
  assert.equal(result.examples[0].events.find(e=>e.kind==='role').date,null);
  assert.equal(result.examples[0].events.find(e=>e.kind==='role').title,'Rapporteur recorded');
  assert.equal(result.dossiers[0].coverage.press,null);
});
test('amendment credit requires a reciprocal exact target and active mandate, not a cover name',()=>{
  const input=observations();assert.equal(buildExamples(input).examples[0].events.filter(e=>e.kind==='amendment').length,1);
  input.profiles[0].payload.data[0].hasMembership[0].memberDuring.endDate='2025-01-01';
  assert.equal(buildExamples(input).examples[0].events.filter(e=>e.kind==='amendment').length,0);
  const other=observations();other.reports[0].payload.data[0].inverse_foresees_change_of[0].foresees_change_of=['eli/dl/doc/A-10-2026-9999'];
  assert.equal(buildExamples(other).examples[0].events.filter(e=>e.kind==='amendment').length,0);
});
test('an adopted exact amendment and its author’s recorded position remain separate observations',()=>{
  const input=observations();input.decisions[0].payload.data[0].had_voter_favor=[];input.decisions[0].payload.data[0].had_voter_against=['person/42'];
  const result=buildExamples(input),events=result.examples[0].events;
  assert.equal(events.find(e=>e.kind==='amendment').amendment.outcomes[0].outcome,'ADOPTED');
  assert.equal(events.find(e=>e.kind==='vote').position.position,'Against');
});
test('contradictory result parents withhold votes and amendment outcomes',()=>{
  const input=observations();input.results.push(record({id:'eli/dl/event/other-result',consists_of:['eli/dl/event/decision']}));
  const result=buildExamples(input);
  assert.equal(result.examples[0].events.filter(e=>e.kind==='vote').length,0);
  assert.deepEqual(result.examples[0].events.find(e=>e.kind==='amendment').amendment.outcomes,[]);
});
test('equal titles cannot attach a speech from another agenda',()=>{
  const input=observations();input.catalogues=[record({id:'eli/dl/event/speech',activity_label:{en:'Title'},had_participation:{had_participant_person:['person/42']},inverse_consists_of:['eli/dl/event/unrelated']})];
  const result=buildExamples(input);assert.equal(result.examples[0].events.filter(e=>e.kind==='speech').length,0);
});

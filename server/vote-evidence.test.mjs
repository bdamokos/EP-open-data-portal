import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveVoteEvidence,exactReference,preferred} from './vote-evidence.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/member-votes-evidence.json',import.meta.url),'utf8'));
const clone=structuredClone;
const event=id=>'eli/dl/event/'+id;
const snapshot=()=>clone({sittingId:'MTG-PL-2026-10-07',date:'2026-10-07',results:fixture.resultSources.flatMap(source=>source.payload.data).filter(node=>node.had_activity_type.endsWith('PLENARY_VOTE_RESULTS')),requests:fixture.resultSources.flatMap(source=>source.payload.data).filter(node=>!node.had_activity_type.endsWith('PLENARY_VOTE_RESULTS')),decisions:fixture.decisionSources.flatMap(source=>source.payload.data),agenda:[],sources:{results:fixture.resultSources.map(({source})=>({url:source.url,fetchedAt:source.retrievedAt,contentHash:source.rawSha256,stale:false,refreshInProgress:false,refreshError:null})),decisions:fixture.decisionSources.map(({source})=>({url:source.url,fetchedAt:source.retrievedAt,contentHash:source.rawSha256,stale:false,refreshInProgress:false,refreshError:null}))}});
const byEnd=(nodes,suffix)=>nodes.find(node=>(node.activity_id||node.id).endsWith(suffix));
const project=state=>projectMemberSitting(state,'197591');
const vote=(state,suffix)=>byEnd(project(state).items.map(item=>({...item,activity_id:item.id})),suffix);

test('saved public split literals and exact requester edge reproduce the source without narrative scope joins',()=>{
  const state=snapshot(),first=vote(state,'197847'),am40=vote(state,'197866'),bound=vote(state,'197814');
  assert.equal(first.parts.length,1);
  assert.equal(first.parts[0].contentByLanguage.en.text,'‘and completing the European defence union’');
  assert(first.parts[0].contentByLanguage.en.sourceLiteral.includes('<partValue>'));
  assert.equal(first.parts[0].contextComponents.length,3);
  assert.equal(am40.parts.length,1);
  assert.match(am40.parts[0].contentByLanguage.en.text,/comprehensive strategic partnership/);
  assert.match(am40.parts[0].contentByLanguage.en.text,/policy/);
  assert.deepEqual(first.rollCallRequesters,[]);
  assert.deepEqual(am40.rollCallRequesters,[]);
  assert(first.evidenceGaps.some(gap=>gap.code==='roll-call-requester-not-established'));
  assert.equal(bound.rollCallRequesters.length,1);
  assert.equal(bound.rollCallRequesters[0].id,'MTG-PL-2026-10-07-VOT-ITM-993167-RCV-2');
  assert.equal(bound.rollCallRequesters[0].organizationLabels.en,'S&D');
  assert.equal(bound.rollCallRequesters[0].binding,'exact-decision-was_motivated_by');
  assert(bound.rollCallRequesters[0].evidencePaths.every(path=>path.sourceUrl.startsWith('https://data.europarl.europa.eu/')));
  assert.equal(JSON.stringify(snapshot()),JSON.stringify(state),'projection cannot mutate source nodes');
});

test('exact subject identity retains source titles/documents and independent whole-text decisions',()=>{
  const state=snapshot(),{subjects,items}=project(state),split=byEnd(items.map(item=>({...item,activity_id:item.id})),'197847');
  const subject=subjects.find(subject=>subject.id===split.subjectId);
  assert.equal(subject.id,'MTG-PL-2026-10-07-VOT-ITM-993151');
  assert(subject.documentIds.includes('A-10-2026-0237'));
  assert.deepEqual(subject.titles,byEnd(state.results,'993151').activity_label);
  assert.equal(subject.wholeTextDecisions.length,1);
  assert.equal(subject.wholeTextDecisions[0].id,'MTG-PL-2026-10-07-DEC-197457');
  assert.equal(subject.wholeTextDecisions[0].outcome,'ADOPTED');
  assert.equal(split.outcome,byEnd(state.decisions,'197847').decision_outcome.split('/').at(-1));
  byEnd(state.decisions,'197847').decision_outcome='def/ep-statuses/REJECTED';
  assert.equal(vote(state,'197847').outcome,'REJECTED');
  assert.equal(project(state).subjects.find(group=>group.id===subject.id).wholeTextDecisions[0].outcome,'ADOPTED');
  assert(subject.gaps.some(gap=>gap.code==='missing-declared-decision'));
  const procedural=vote(state,'197673');
  assert.equal(procedural.subjectId,'MTG-PL-2026-10-05-VOT-ITM-000001');
  assert.deepEqual(procedural.context.agendaItemIds,[]);
  assert.deepEqual(procedural.context.procedureIds,[]);
  state.results=state.results.filter(node=>!node.activity_id.endsWith('000001'));
  delete byEnd(state.decisions,'197673').inverse_consists_of;
  const unlinked=vote(state,'197673');
  assert.equal(unlinked.subjectId,null);assert.equal(unlinked.resultRelationship.binding,'unlinked');
  assert(unlinked.evidenceGaps.some(gap=>gap.code==='unlinked-result'));
});

test('ambiguous forward/inverse result parents withhold all subject, wording, requester and parent context enrichment',()=>{
  for(const suffix of ['197847','197814']) {
    const state=snapshot(),raw=byEnd(state.decisions,suffix);
    state.results.push({id:event('MTG-PL-2026-10-07-VOT-ITM-999999'),activity_id:'MTG-PL-2026-10-07-VOT-ITM-999999',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',consists_of:[raw.id],activity_label:{en:'Similar title'},based_on_a_realization_of:['eli/dl/doc/WRONG']});
    const item=vote(state,suffix);
    assert.equal(item.subjectId,null);assert.equal(item.resultRelationship.binding,'ambiguous');
    assert.deepEqual(item.parts,[]);assert.deepEqual(item.rollCallRequesters,[]);
    assert(!item.context.documentIds.includes('WRONG'));
    assert.deepEqual(item.context.agendaItemIds,[]);
  }
});

test('malformed and missing component/request identities remain explicit gaps',()=>{
  const state=snapshot(),raw=byEnd(state.decisions,'197847');
  raw.decided_on_a_realization_of=[{id:raw.decided_on_a_realization_of[0],identifier:'contradictory'}];
  raw.was_motivated_by=['https://example.org/eli/dl/event/fake'];
  let item=vote(state,'197847');
  assert.deepEqual(item.parts,[]);assert.equal(item.scope.basis,'invalid-component-reference');
  assert.deepEqual(item.rollCallRequesters,[]);assert.equal(item.evidenceGaps.filter(gap=>gap.code==='invalid-reference').length,2);
  const missing=snapshot();
  missing.requests=missing.requests.filter(node=>!node.activity_id.endsWith('SPLIT-1'));
  byEnd(missing.results,'993151').was_motivated_by=[];
  item=vote(missing,'197847');
  assert.deepEqual(item.parts,[]);assert(item.evidenceGaps.some(gap=>gap.code==='missing-component'));
});

test('partial source copies can add fields but conflicting request and component copies never choose wording',()=>{
  const state=snapshot(),request=byEnd(state.requests,'993151-SPLIT-1');
  const partial={id:request.id,activity_id:request.activity_id};
  state.requests.push(partial);
  assert.equal(vote(state,'197847').parts.length,1);
  const conflicting=clone(request);
  conflicting.created_a_realization_of[1].expressionContent.en='<partValue>different</partValue>';
  state.requests.push(conflicting);
  const item=vote(state,'197847');
  assert.deepEqual(item.parts,[]);
  assert(item.evidenceGaps.some(gap=>gap.code==='ambiguous-component'));
});

test('conflicting result snapshots cannot supply a subject or whole-text outcome',()=>{
  const state=snapshot(),result=byEnd(state.results,'993151');
  state.conflictingResults=[{...clone(result),activity_label:{en:'Different subject'}}];
  const projected=project(state),item=vote(state,'197847'),subject=projected.subjects.find(subject=>subject.id===result.activity_id);
  assert.equal(item.subjectId,null);assert.deepEqual(item.parts,[]);
  assert.deepEqual(subject.titles,{});assert.deepEqual(subject.documentIds,[]);assert.deepEqual(subject.wholeTextDecisions,[]);
  assert(subject.gaps.some(gap=>gap.code==='conflicting-result-source'));
});

test('a method-tagged lapsed whole-text decision remains not-conducted and nullable',()=>{
  const state=snapshot(),raw=byEnd(state.decisions,'197457');
  raw.decision_outcome='def/ep-statuses/LAPSED';raw.had_voter_favor=[];raw.had_voter_against=[];raw.had_voter_abstention=[];
  delete raw.number_of_votes_favor;delete raw.number_of_votes_against;delete raw.number_of_votes_abstention;
  const item=vote(state,'197457'),subject=project(state).subjects.find(subject=>subject.id===item.subjectId);
  assert.equal(item.ballotStatus,'not-conducted');assert.equal(item.actualPosition.status,'not-conducted');
  assert.deepEqual(subject.wholeTextDecisions[0].totals,{for:null,against:null,abstaining:null});
  assert.equal(subject.wholeTextDecisions[0].ballotStatus,'not-conducted');
});

test('official identity validation rejects malformed authorities and conflicting redundant IDs',()=>{
  for(const id of ['https://data.europarl.europa.eu:443/eli/dl/event/abc','https://example.com/eli/dl/event/abc','eli/dl/event/abc?x=1','https://data.europarl.europa.eu/eli/dl/event/abc#x'])assert.equal(exactReference(id),null);
  assert.equal(exactReference({id:event('abc'),activity_id:'def'}),null);
  assert.equal(exactReference(event('abc')),'https://data.europarl.europa.eu/'+event('abc'));
  assert.deepEqual(deriveVoteEvidence({results:[],decisions:[]}).subjects,[]);
});

test('malformed XML and missing split wording remain gaps rather than invented readable text',()=>{
  for(const literal of ['<partValue>broken','<partValue>&unknown;</partValue>','<!DOCTYPE x><partValue>text</partValue>']) {
    const state=snapshot();
    for(const node of [...state.requests,...state.results.flatMap(node=>node.was_motivated_by||[])])if(node.activity_id?.endsWith('993151-SPLIT-1'))node.created_a_realization_of.find(component=>component.identifier.endsWith('-1-2')).expressionContent={en:literal};
    const item=vote(state,'197847');
    assert.deepEqual(item.parts,[]);
    assert(item.evidenceGaps.some(gap=>gap.code==='ambiguous-component'&&gap.details.some(detail=>detail.code==='unsupported-expression-content')));
  }
  const out=deriveVoteEvidence({results:[null,{},'invalid'],decisions:[null,{}]});
  assert(out.gaps.some(gap=>gap.code==='invalid-source-node'));
  assert(out.gaps.some(gap=>gap.code==='invalid-decision-identity'));
});

test('display titles prefer French to Bulgarian and preserve unknown-language text',()=>{
  const titles={bg:'Bulgarian title',fr:'French title'};
  assert.deepEqual(preferred(titles,'ga'),{title:'French title',titleLanguage:'fr'});
  assert.deepEqual(preferred(titles,'bg'),{title:'Bulgarian title',titleLanguage:'bg'});
  assert.deepEqual(preferred({'':'Unknown-language title'},'ga'),{title:'Unknown-language title',titleLanguage:null});
});

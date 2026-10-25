import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectMemberSitting} from '../server/member-votes-model.mjs';
import {knownVoteMethodLabel,voteMethodLabel} from './voteMethod.mjs';
import {MEMBER_VOTES_PAGE_SIZE,memberVotesRoute,validateMemberVotesResponse,groupMemberVotes,displayVoteTitle,memberVoteLabel,memberVotePosition,memberVoteOutcome,memberVoteTotals,votingRecordUrl,topLevelVoteDocuments,exactAmendmentTargets} from './memberVotesPresentation.mjs';

const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/member-votes.json',import.meta.url)));
const memberId=197591,snapshotId='a'.repeat(64),sittingId='MTG-PL-2026-10-07';
const projection=projectMemberSitting(fixture.snapshots[0],String(memberId),'en');
const clone=value=>structuredClone(value);
function response(overrides={}) {
  const items=projection.items.filter(item=>item.actualPosition.status==='recorded');
  return {version:6,member:{id:String(memberId)},period:{kind:'sitting',week:null,sittingId,from:'2026-10-07',to:'2026-10-07'},snapshotId,positions:'recorded',alignment:'all',alignmentCounts:projection.items.reduce((counts,item)=>{counts[item.alignment]++;return counts;},{with:0,against:0,abstained:0,unclassified:0}),items:clone(items),subjects:projection.subjects.map(subject=>({...clone(subject),counts:{observed:projection.items.filter(item=>item.subjectId===subject.id).length,filtered:items.filter(item=>item.subjectId===subject.id).length,page:items.filter(item=>item.subjectId===subject.id).length}})),pagination:{offset:0,limit:50,returned:items.length,observedTotal:projection.items.length,recordedTotal:items.length,filteredTotal:items.length,nextOffset:null},selected:{status:'not-requested',item:null},coverage:{status:'complete',termWide:false},...overrides};
}
const state={week:'latest',sittingId,positions:'recorded',offset:0,decisionId:null,snapshotId:null};
const accepts=(data,requestState=state)=>validateMemberVotesResponse(data,{memberId,state:requestState});

test('request route explicitly defaults to all decisions and retains exact page, selection and snapshot',()=>{
  assert.equal(MEMBER_VOTES_PAGE_SIZE,50);
  const basic=new URL(memberVotesRoute(memberId), 'https://example.invalid/');
  assert.equal(basic.pathname,'/member-votes/197591');assert.equal(basic.searchParams.get('positions'),'all');assert.equal(basic.searchParams.get('week'),'latest');
  const decisionId='MTG-PL-2026-10-07-DEC-197457';
  const route=new URL(memberVotesRoute(memberId,{...state,positions:'all',offset:50,decisionId,snapshotId},'hu'),'https://example.invalid/');
  assert.equal(route.searchParams.get('week'),null);assert.equal(route.searchParams.get('sitting'),sittingId);
  assert.equal(route.searchParams.get('positions'),'all');assert.equal(route.searchParams.get('offset'),'50');assert.equal(route.searchParams.get('limit'),'50');
  assert.equal(route.searchParams.get('decision'),decisionId);assert.equal(route.searchParams.get('snapshot'),snapshotId);assert.equal(route.searchParams.get('lang'),'hu');
  for(const next of [{positions:'attendance'},{offset:-1},{week:'2026-10-06'},{snapshotId:'expired'},{decisionId:'197457'},{sittingId:'MTG-PL-2026-02-30'}])assert.throws(()=>memberVotesRoute(memberId,next),RangeError);
});

test('response guard checks member, requested period, filter, pagination and snapshot',()=>{
  const data=response();assert.equal(accepts(data),true);
  for(const mutate of [
    value=>{value.version=1;},value=>{value.member.id='197481';},value=>{value.member.id=memberId;},
    value=>{value.period.sittingId='MTG-PL-2026-10-08';},value=>{value.period.to='2026-10-08';},
    value=>{value.positions='all';},value=>{value.pagination.offset=50;},value=>{value.pagination.limit=25;},
    value=>{value.pagination.returned++;},value=>{value.items[0].date='2026-10-08';},
    value=>{value.items[0].sittingId='MTG-PL-2026-10-08';},value=>{value.items[0].actualPosition.status='no-record';},
    value=>{value.items[0].parts=[{}];},value=>{value.items[0].context.documentIds=null;},
    value=>{value.items[0].rollCallRequesters=[null];},value=>{value.items[0].intention.positions=null;},
    value=>{value.subjects[0].titles=null;},value=>{value.subjects[0].wholeTextDecisions=[{}];},
  ]) {const malformed=clone(data);mutate(malformed);assert.equal(accepts(malformed),false);}
  assert.equal(accepts(data,{...state,snapshotId}),true);
  assert.equal(accepts(data,{...state,snapshotId:'b'.repeat(64)}),false);
  const week=response({period:{kind:'week',week:'2026-10-05',sittingId:null,from:'2026-10-05',to:'2026-10-11'}});
  assert.equal(accepts(week,{...state,sittingId:null}),true);assert.equal(accepts(week,{...state,sittingId:null,week:'2026-09-28'}),false);
  const unknown=response({period:{kind:'week',week:null,sittingId:null,from:null,to:null},items:[],subjects:[],pagination:{offset:0,limit:50,returned:0,observedTotal:0,recordedTotal:null,filteredTotal:0,nextOffset:null},coverage:{status:'unavailable',termWide:false},alignmentCounts:null});
  assert.equal(accepts(unknown,{...state,sittingId:null}),true);
  unknown.coverage.status='complete';assert.equal(accepts(unknown,{...state,sittingId:null}),false);
});

test('selection is an exact full projection independent of the recorded page and never falls back',()=>{
  const data=response(),selected=clone(projection.items.find(item=>item.actualPosition.status!=='recorded')||projection.items.at(-1));
  data.items=data.items.filter(item=>item.id!==selected.id);data.pagination.returned=data.items.length;data.pagination.filteredTotal=data.items.length;
  for(const subject of data.subjects)subject.counts.page=data.items.filter(item=>item.subjectId===subject.id).length;
  data.selected={status:'found',item:selected};
  assert.equal(accepts(data,{...state,decisionId:selected.id}),true);
  assert.equal(accepts(data,{...state,decisionId:'MTG-PL-2026-10-07-DEC-999999'}),false);
  assert.equal(accepts(data,state),false);
  data.selected={status:'not-found-in-scanned-data',item:null};
  assert.equal(accepts(data,{...state,decisionId:'MTG-PL-2026-10-07-DEC-999999'}),true);
  data.selected={status:'not-requested',item:null};assert.equal(accepts(data,{...state,decisionId:selected.id}),false);
  data.selected={status:'unavailable',item:projection.items[0]};assert.equal(accepts(data,{...state,decisionId:selected.id}),false);
});

test('grouping uses exact result identities and keeps whole-text outcomes within subjects on the current page',()=>{
  const first=clone(projection.items[0]),second=clone(projection.items[1]),third=clone(projection.items[2]);
  const subject={...clone(projection.subjects[0]),id:'subject-one',counts:{observed:3,filtered:2,page:2},wholeTextDecisions:[projection.items[0]]};
  first.subjectId=second.subjectId=subject.id;first.resultRelationship.binding=second.resultRelationship.binding='consistent';
  third.subjectId=subject.id;third.resultRelationship.binding='ambiguous';third.title=first.title;
  const wholeOnly={...clone(subject),id:'whole-only',counts:{observed:1,filtered:0,page:0},wholeTextDecisions:[projection.items[0]]};
  const empty={...clone(subject),id:'not-this-page',counts:{observed:2,filtered:2,page:0},wholeTextDecisions:[]};
  const groups=groupMemberVotes({items:[first,second,third],subjects:[subject,wholeOnly,empty]});
  assert.equal(groups.length,2);assert.deepEqual(groups[0].items.map(item=>item.id),[first.id,second.id]);
  assert.deepEqual(groups[0].subject.wholeTextDecisions,subject.wholeTextDecisions);
  assert.equal(groups[1].subject,null);assert.equal(groups[1].items[0].id,third.id);
  assert.deepEqual(groupMemberVotes({items:[],subjects:[subject,wholeOnly,empty]}),[]);
  third.resultRelationship.binding='unlinked';assert.equal(groupMemberVotes({items:[third],subjects:[subject]})[0].subject,null);
});

test('display removes only procedure markers and labels exact amendment and part identifiers',()=>{
  const raw='***I A title ***II with * emphasis ***III';
  assert.equal(displayVoteTitle(raw),'A title with * emphasis');assert.equal(raw,'***I A title ***II with * emphasis ***III');
  assert.equal(displayVoteTitle('***IV ***IIa ****I word***I'),'***IV ***IIa ****I word***I');
  for(const marker of ['*','***','**I','**II'])assert.equal(displayVoteTitle('Consular protection '+marker),'Consular protection');
  assert.equal(displayVoteTitle('* Consular protection'),'Consular protection');
  assert.equal(displayVoteTitle('A title with * emphasis'),'A title with * emphasis');
  const vote=clone(projection.items[0]);vote.scope.kind='whole-text';assert.equal(memberVoteLabel(vote),'Final vote');
  vote.scope.kind='amendment';vote.context.amendmentIds=['A-10-2026-0237-AM-12','A-10-2026-0237-AM-12'];vote.parts=[];
  assert.equal(memberVoteLabel(vote),'Amendment 12');
  vote.context.amendmentIds.push('A-10-2026-0237-AM-40');vote.parts=[{number:'2'}];assert.equal(memberVoteLabel(vote),'Amendments 12, 40 · Part 2');
  vote.context.amendmentIds=[];vote.parts=[];vote.referenceTexts={fr:'Texte de référence',en:'Source reference'};
  assert.equal(memberVoteLabel(vote,'fr'),'Texte de référence');assert.equal(memberVoteLabel(vote,'hu'),'Source reference');
});

test('actual positions, independent intentions, outcomes and supplied totals remain separate',()=>{
  const vote=clone(projection.items.find(item=>item.actualPosition.position==='for'));
  vote.method='VOTE_ELECTRONIC_ROLLCALL';vote.ballotStatus='conducted';vote.actualPosition={status:'recorded',position:'for'};vote.intention={status:'reported',positions:['abstaining']};vote.totals={for:454,against:86,abstaining:0};
  assert.equal(memberVotePosition(vote),'For');assert.deepEqual(memberVoteTotals(vote),{for:454,against:86,abstaining:0,total:540});
  assert.deepEqual(vote.intention.positions,['abstaining']);vote.outcome='REJECTED';assert.equal(memberVoteOutcome(vote),'Rejected');
  for(const method of ['VOTE_HAND','VOTE_SECRET','VOTE_SECRET_BALLOT'])assert.equal(memberVotePosition({...vote,method}),'For');
  assert.equal(memberVotePosition({...vote,actualPosition:{status:'no-record',position:null}}),'No recorded position');
  assert.equal(memberVoteTotals({...vote,totals:{for:0,against:0,abstaining:0}}).total,0);
  for(const value of [null,undefined,NaN,Infinity,-1,'0'])assert.equal(memberVoteTotals({...vote,totals:{for:0,against:value,abstaining:0}}),null);
  const lapsed={...vote,outcome:'LAPSED',ballotStatus:'not-conducted'};
  assert.equal(memberVotePosition(lapsed),'Not put to a vote');assert.equal(memberVoteTotals(lapsed),null);assert.equal(memberVoteOutcome(lapsed),'Lapsed');
  assert.equal(memberVoteOutcome({...vote,outcome:null}),'Outcome unavailable');
});

test('voting record and context links require exact validated identifiers',()=>{
  const vote=clone(projection.items[0]);assert.equal(votingRecordUrl(vote),'https://www.europarl.europa.eu/doceo/document/PV-10-2026-10-07-VOT_EN.html');
  for(const next of [{date:'2026-10-08'},{sittingId:'MTG-PL-2026-02-30',date:'2026-02-30'},{sittingId:'MTG-PL-2023-10-07',date:'2023-10-07'},{sittingId:'MTG-PL-2030-10-07',date:'2030-10-07'}])assert.equal(votingRecordUrl({...vote,...next}),null);
  vote.context.documentIds=['A-10-2026-0237','A-10-2026-0237','B-10-2026-0424','RC-10-2026-0424','A-10-2026-0237-AM-12','TA-10-2026-0254','A-9-2023-0001','https://example.invalid/A-10-2026-0237'];
  assert.deepEqual(topLevelVoteDocuments(vote),['A-10-2026-0237','B-10-2026-0424','RC-10-2026-0424']);
  vote.context.amendmentIds=['A-10-2026-0237-AM-12','A-10-2026-0237-AM-12','RC-10-2026-0424-AM-001-004','AM-12','B-11-2030-0001-AM-2'];
  assert.deepEqual(exactAmendmentTargets(vote),[{documentId:'A-10-2026-0237',amendmentId:'A-10-2026-0237-AM-12'},{documentId:'RC-10-2026-0424',amendmentId:'RC-10-2026-0424-AM-001-004'}]);
});

test('position labels distinguish unavailable, conflicting and absent records',()=>{
  for(const [status,label] of Object.entries({'no-record':'No recorded position',unavailable:'Position unavailable',conflicting:'Conflicting records','not-conducted':'Not put to a vote'}))assert.equal(memberVotePosition({ballotStatus:'conducted',actualPosition:{status,position:null}}),label);
  for(const [position,label] of Object.entries({for:'For',against:'Against',abstaining:'Abstained'}))assert.equal(memberVotePosition({ballotStatus:'conducted',method:'VOTE_ELECTRONIC_ROLLCALL',actualPosition:{status:'recorded',position}}),label);
});

test('alignment request omission is byte compatible and response validates counts, echo and item membership',()=>{
  assert.equal(memberVotesRoute(memberId,state),memberVotesRoute(memberId,{...state,alignment:'all'}));
  assert.equal(new URL(memberVotesRoute(memberId,state),'https://example.test').searchParams.has('alignment'),false);
  for(const alignment of ['with','against','abstained'])assert.equal(new URL(memberVotesRoute(memberId,{...state,alignment}),'https://example.test').searchParams.get('alignment'),alignment);
  assert.throws(()=>memberVotesRoute(memberId,{...state,alignment:'majority'}),RangeError);
  const data=response();
  for(const mutate of [value=>delete value.alignment,value=>{value.alignment='against';},value=>delete value.items[0].alignment,value=>{value.items[0].alignment='majority';},value=>{value.alignmentCounts=null;},value=>{value.alignmentCounts.with++;},value=>{value.alignmentCounts.against=-1;},value=>{value.alignmentCounts.extra=0;}]){
    const malformed=clone(data);mutate(malformed);assert.equal(accepts(malformed),false);
  }
  const unavailable=response({items:[],subjects:[],coverage:{status:'unavailable',termWide:false},alignmentCounts:null,pagination:{offset:0,limit:50,returned:0,observedTotal:0,recordedTotal:null,filteredTotal:0,nextOffset:null}});
  assert.equal(accepts(unavailable),true);
  unavailable.alignmentCounts={with:0,against:0,abstained:0,unclassified:0};assert.equal(accepts(unavailable),false);
  const filtered=response({alignment:'with'});filtered.items=filtered.items.filter(item=>item.alignment==='with');filtered.pagination.returned=filtered.pagination.filteredTotal=filtered.items.length;filtered.subjects=[];
  assert.equal(accepts(filtered,{...state,alignment:'with'}),true);
  filtered.items[0].alignment='against';assert.equal(accepts(filtered,{...state,alignment:'with'}),false);
});

test('response guards recorded totals and carries non-named status through selected and whole-text decisions',()=>{
  const data=response();
  for(const total of [null,-1,1.5,data.pagination.observedTotal+1]){const invalid=clone(data);invalid.pagination.recordedTotal=total;assert.equal(accepts(invalid),false);}
  const missing=clone(data);delete missing.pagination.recordedTotal;assert.equal(accepts(missing),false);
  for(const version of [3,4,5]){const previous=clone(data);previous.version=version;assert.equal(accepts(previous),false);}
  const selected={...clone(projection.items[0]),method:'VOTE_HAND',ballotStatus:'conducted',actualPosition:{status:'not-individually-recorded',position:null}};
  data.selected={status:'found',item:selected};
  const whole={...clone(selected),scope:{kind:'whole-text',basis:'english-reference-label'}};
  data.subjects[0].wholeTextDecisions=[whole];
  assert.equal(accepts(data,{...state,decisionId:selected.id}),true);
  assert.equal(memberVotePosition(selected),'Not individually recorded');
  for(const patch of [{actualPosition:{status:'not-individually-recorded',position:'for'}},{ballotStatus:'unknown'},{method:'VOTE_UNKNOWN'}]){const invalid=clone(data);invalid.selected.item={...invalid.selected.item,...patch};assert.equal(accepts(invalid,{...state,decisionId:selected.id}),false);}
});

test('electronic secret ballots validate across list, selected and whole-text decisions with source precedence',()=>{
  const raw={...fixture.snapshots[0].decisions[0],type:'Vote',decision_method:'def/ep-decision-methods/VOTE_ELECTRONIC_SECRET'};
  for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention'])delete raw[key];
  for(const patch of [{},{decision_outcome:'def/ep-statuses/LAPSED'},{had_voter_favor:['person/'+memberId]}]){
    const item=projectMemberSitting({...fixture.snapshots[0],decisions:[{...raw,...patch}]},String(memberId)).items[0];
    const expected=patch.decision_outcome?'Not put to a vote':patch.had_voter_favor?'Position unavailable':'Not individually recorded';
    const data=response({positions:'all',items:[item],subjects:[],pagination:{offset:0,limit:50,returned:1,observedTotal:1,recordedTotal:0,filteredTotal:1,nextOffset:null},selected:{status:'found',item},alignmentCounts:{with:0,against:0,abstained:0,unclassified:1}});
    const subject=clone(projection.subjects[0]);
    subject.wholeTextDecisions=[{...clone(item),scope:{kind:'whole-text',basis:'english-reference-label'}}];
    subject.counts={observed:1,filtered:1,page:1};item.subjectId=subject.id;
    data.subjects=[subject];
    assert.equal(accepts(data,{...state,positions:'all',decisionId:item.id}),true,expected);
    assert.equal(memberVotePosition(item),expected);
    assert.equal(memberVotePosition(subject.wholeTextDecisions[0]),expected);
  }
  assert.equal(voteMethodLabel('VOTE_ELECTRONIC_SECRET'),'Secret ballot (electronic)');
  assert.equal(knownVoteMethodLabel('VOTE_ELECTRONIC_SECRET'),'Secret ballot (electronic)');
  for(const method of ['VOTE_SECRET','VOTE_SECRET_BALLOT'])assert.equal(voteMethodLabel(method),'Secret ballot');
});

import {deriveVoteEvidence,eventUri} from './vote-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionVotes,decisionVotesQuery} from './decision-votes.mjs';
import {voteFixture,contradictoryVoteFixture,splitBindingFixture,decisionId,amendmentId} from './test-support/decision-votes.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const now={now:Date.parse('2026-10-24')};
test('decision query pins a held sitting and permits only language and snapshot',()=>{
 const query=decisionVotesQuery(decisionId,new URLSearchParams('lang=hu&snapshot='+'b'.repeat(64)),now);
 assert.equal(query.sitting,'MTG-PL-2026-10-07');assert.equal(query.decision,decisionId);assert.equal(query.language,'hu');assert.equal(query.snapshot,'b'.repeat(64));
 for(const id of ['MTG-PL-2026-02-30-DEC-1','MTG-PL-2027-01-01-DEC-1','https://other.test/'+decisionId])assert.throws(()=>decisionVotesQuery(id,new URLSearchParams(),now));
 for(const params of ['member=1','lang=en&lang=fr','snapshot=bad'])assert.throws(()=>decisionVotesQuery(decisionId,new URLSearchParams(params),now));
});
test('selected decision reuses the member snapshot and keeps actual positions separate from intentions',async()=>{
 const f=voteFixture(),before=structuredClone(f.day),data=await f.read();
 assert.equal(f.reads(),1);assert.equal(data.integrity,'complete');assert.equal(data.snapshotId,'a'.repeat(64));
 assert.deepEqual(data.decision.amendmentIds,[amendmentId]);assert.equal(data.voters.find(v=>v.personId==='197591').position,'for');
 assert.equal(data.groupHistory.generation,7);assert.equal(data.groupHistory.epoch,'fixture-epoch');assert.deepEqual(f.day,before);
 assert(data.decision.sources.decisions.every(s=>s.url&&s.fetchedAt&&s.contentHash));
 assert.equal(apiCachePolicy({method:'GET'},new URL('http://localhost/api/decision-votes/'+decisionId),data).cacheControl,'no-store');
});
test('malformed, conflicting and mismatched ballots retain observations but never a complete matrix',async()=>{
 for(const change of [f=>f.raw.had_voter_against.push('person/197591'),f=>f.raw.had_voter_favor.push('https://other.test/person/99'),f=>f.raw.number_of_votes_favor=99]) {
  const f=voteFixture();change(f);const data=await f.read();assert.equal(data.integrity,'partial');
  assert.equal(data.voters.filter(v=>v.personId==='197591').length,1);
 }
 const f=voteFixture();f.raw.had_voter_against.push('person/197591');const data=await f.read();
 assert.equal(data.voters.find(v=>v.personId==='197591').status,'conflicting');assert.equal(data.voters.find(v=>v.personId==='197591').position,null);
 f.raw._conflictingSourceObservations={fields:['decision_method']};assert.equal((await f.read()).integrity,'conflicting');assert.deepEqual((await f.read()).voters,[]);
});
test('non-conducted, non-named and omitted arrays never expose named positions',async()=>{
 for(const change of [f=>f.raw.decision_outcome='def/ep-statuses/LAPSED',f=>f.raw.decision_method='def/ep-decision-methods/VOTE_HAND',f=>delete f.raw.had_voter_favor]) {
  const f=voteFixture();change(f);const data=await f.read();assert.equal(data.integrity,'unavailable');assert.deepEqual(data.voters,[]);
 }
 const f=voteFixture();f.day.decisions=[];const data=await f.read();assert.equal(data.status,'unavailable');assert.equal(data.decision,null);
});
test('dated groups preserve switches, explicit NI, missing and ambiguous history',async()=>{
 const f=voteFixture();f.history.members['197591'].groups=[{code:'PPE',org:'org/7018',groupId:'org/PPE',start:'2024-07-16',end:'2026-10-07'},{code:'Renew',org:'org/7035',groupId:'org/RENEW',start:'2026-10-08',end:null}];
 f.history.members['124846'].ambiguous=[{start:'2026-10-07',end:'2026-10-07'}];delete f.history.members['197481'];
 const data=await f.read(),by=id=>data.voters.find(v=>v.personId===id);
 assert.equal(by('197591').group.code,'PPE');assert.equal(by('124846').group,null);assert.equal(by('124846').groupStatus,'ambiguous');assert.equal(by('197481').group,null);assert.equal(by('256852').group.code,'NI');
 const missing=await decisionVotes(f.query,{reader:f.reader});assert.equal(missing.groupHistory,null);assert(missing.voters.every(v=>v.group===null));assert.equal(missing.integrity,'complete');
});
test('invalid exact references remain explicit even when another reference is valid',async()=>{
 const f=voteFixture();f.raw.decided_on_a_realization_of.push('https://other.test/eli/dl/doc/'+amendmentId);
 assert.equal((await f.read()).decision.referencesValid,false);
});

test('a part-of reference cannot validate a whole-amendment named-vote binding',async()=>{
 for(const reference of ['eli/dl/doc/'+amendmentId,'https://other.test/eli/dl/doc/'+amendmentId]){
  const f=voteFixture();f.raw.decided_on_a_part_of_a_realization_of=reference;
  const data=await f.read();assert.equal(data.decision.referencesValid,false);
  assert.equal(data.decision.outcome,'ADOPTED');
 }
});

test('contradictory result and component ownership withhold every named join',async()=>{
 for(const scenario of ['ambiguous-result-binding','conflicting-result-source','component-outside-result']) {
  const f=contradictoryVoteFixture(scenario),data=await f.read();
  assert(data.decision.evidenceGaps.some(gap=>gap.code===scenario),scenario);assert.equal(data.integrity,'conflicting',scenario);assert.deepEqual(data.voters,[],scenario);
  assert(data.decision.resultRelationship);assert.equal(data.decision.outcome,'ADOPTED');
 }
});

test('component ownership and definitions remain independent of wording and parent availability',async()=>{
 for(const ownership of ['single','shared','outside','unknown'])for(const wording of ['valid','missing','unreadable'])for(const definitions of ['consistent','conflicting'])for(const context of ['present','missing']) {
  const scenario={ownership,wording,definitions,context},f=splitBindingFixture(scenario),data=await f.read(),blocked=ownership==='shared'||ownership==='outside'||definitions==='conflicting';
  assert.equal(data.integrity,blocked?'conflicting':'complete',JSON.stringify(scenario));assert.equal(data.voters.length,blocked?0:4,JSON.stringify(scenario));
  assert.equal(data.decision.bindingConflicts.length>0,blocked,JSON.stringify(scenario));
  // The optional graph observation must not change the member reader contract.
  const legacy=deriveVoteEvidence(f.day).decisions.get(eventUri(f.raw));assert.equal(Object.hasOwn(legacy,'bindingConflicts'),false);
 }
});
test('an omitted request type is unknown; a supplied different type contradicts a split binding',async()=>{
 for(const type of [undefined,'def/ep-activities/REQUEST_VOTE_SEPARATE']) {
  const f=splitBindingFixture({context:'missing',wording:'missing'});f.day.requests[0].had_activity_type=type;
  const data=await f.read();assert.equal(data.integrity,type?'conflicting':'complete');
 }
});

test('each supplied tally is checked even when another tally is missing',async()=>{
 const fields=['number_of_votes_favor','number_of_votes_against','number_of_votes_abstention'];
 for(const missing of fields){
  const matching=voteFixture();delete matching.raw[missing];assert.equal((await matching.read()).integrity,'complete');
  for(const mismatched of fields.filter(field=>field!==missing)){
   const f=voteFixture();delete f.raw[missing];f.raw[mismatched]=99;const data=await f.read();
   assert.equal(data.integrity,'partial');assert.equal(data.decision.namedVoters.totalsMatch,false);assert.equal(data.voters.length,4);
  }
 }
});
function subjectFixture() {
 const f=voteFixture(),parent=f.day.results.find(node=>node.id===f.raw.inverse_consists_of[0]);
 parent.inverse_consists_of=[...(parent.inverse_consists_of||[]),'eli/dl/proc/2025-0222'];
 const sibling=(id,fields)=>{const raw={...structuredClone(f.raw),id:'eli/dl/event/MTG-PL-2026-10-07-DEC-'+id,activity_id:'MTG-PL-2026-10-07-DEC-'+id,decided_on_a_realization_of:[],...fields};f.day.decisions.push(raw);return raw;};
 sibling(1,{referenceText:{en:'Commission proposal'},decision_method:'def/ep-entities/VOTE_ELECTRONIC_ROLLCALL'});
 sibling(2,{referenceText:{en:'Request for referral back to committee'}});
 parent.consists_of=[...(parent.consists_of||[]),'eli/dl/event/MTG-PL-2026-10-07-DEC-1','eli/dl/event/MTG-PL-2026-10-07-DEC-2'];
 const other={...structuredClone(parent),id:parent.id.replace(/\d+$/,'777777'),activity_id:parent.activity_id.replace(/\d+$/,'777777'),consists_of:['eli/dl/event/MTG-PL-2026-10-07-DEC-3']};f.day.results.push(other);
 sibling(3,{referenceText:{en:'Motion for a resolution'},inverse_consists_of:[other.id]});
 return f;
}
const referral=date=>({data:[{label:'2025/0222(COD)',consists_of:[{had_activity_type:'def/ep-activities/PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS',activity_date:date}]}]});
test('vote page context lists the same subject only, main vote first, and never reads upstream',async()=>{
 const f=subjectFixture(),data=await f.read(),ids=data.siblings.map(row=>row.id);
 assert.equal(data.mainVoteId,'MTG-PL-2026-10-07-DEC-1');assert.equal(ids[0],'MTG-PL-2026-10-07-DEC-1');
 assert.deepEqual(new Set(ids),new Set(['MTG-PL-2026-10-07-DEC-1','MTG-PL-2026-10-07-DEC-2',decisionId]));
 assert(!ids.includes('MTG-PL-2026-10-07-DEC-3'),'a decision of another subject is not a sibling');
 assert.equal(f.reads(),1);assert(data.subject.procedureIds.includes('2025-0222'));assert.deepEqual(data.subject.procedures,[],'an unheld procedure has no reference');
 assert(data.subject.agendaItemIds.every(id=>typeof id==='string'));
});
test('a referral label is never the main vote and a subject without a main vote has none',async()=>{
 const f=subjectFixture();f.raw.referenceText={en:'Request for a separate vote'};f.day.decisions=f.day.decisions.filter(raw=>raw.activity_id!=='MTG-PL-2026-10-07-DEC-1');
 assert.equal((await f.read()).mainVoteId,null);
});
test('a partial sitting establishes no main vote',async()=>{
 const f=subjectFixture();f.day.coverage={state:'partial'};const data=await f.read();
 assert.equal(data.mainVoteId,null);assert.equal(data.siblings.length,3);
});
test('procedure referral needs the exact event on the vote date',async()=>{
 const vote=f=>f.raw.activity_date;
 let f=subjectFixture();assert.equal((await f.read()).procedureReferral,false,'no held procedure');
 f=subjectFixture();f.sources['/procedures/2025-0222']=referral(vote(f));let data=await f.read();assert.equal(data.procedureReferral,true);assert.deepEqual(data.subject.procedures,[{id:'2025-0222',reference:'2025/0222(COD)'}]);
 f=subjectFixture();f.sources['/procedures/2025-0222']=referral('2001-01-01');assert.equal((await f.read()).procedureReferral,false,'another date');
 f=subjectFixture();f.sources['/procedures/2025-0222']={data:[{label:'2025/0222(COD)',consists_of:[{had_activity_type:'def/ep-activities/PLENARY_AMEND',activity_date:vote(f)}]}]};assert.equal((await f.read()).procedureReferral,false,'another event');
});
test('a procedure outside the index is read only from the retained source, and a miss stays unknown',async()=>{
 const f=subjectFixture(),asked=[];
 const read=id=>decisionVotes(f.query,{reader:f.reader,store:f.store,readProcedure:async wanted=>{asked.push(wanted);return wanted===id?{label:'2025/0222(COD)',...referral(f.raw.activity_date).data[0]}:null;}});
 const data=await read('2025-0222');
 assert.equal(data.procedureReferral,true);assert.deepEqual(data.subject.procedures,[{id:'2025-0222',reference:'2025/0222(COD)'}]);assert(asked.includes('2025-0222'));
 const miss=await read('none');assert.equal(miss.procedureReferral,false);assert.deepEqual(miss.subject.procedures,[]);
});
test('corrections and names outside the roster come from exact held records',async()=>{
 const f=voteFixture();f.sources['amendment:member:256852']={givenName:'Former',familyName:'Member'};f.sources['demographic:profile:256852']={label:'FORMER Member',fields:{'api:country-of-representation':['HU']}};
 const data=await f.read();
 assert.deepEqual(data.corrections.against,['197591']);assert.deepEqual(data.corrections.for,[]);
 assert.deepEqual(data.people,{'256852':{name:'Former Member',country:'HU'}});
 const missing=voteFixture();assert.deepEqual((await missing.read()).people,{'256852':{name:null,country:null}});
});
test('rows carry labels only: part wording stays with the requested vote',async()=>{
 const f=splitBindingFixture();const data=await f.read();
 if(data.siblings.length)for(const row of data.siblings)for(const part of row.parts)assert.equal(part.contentByLanguage,undefined);
 for(const part of data.decision.parts)assert(part.contentByLanguage&&Array.isArray(part.contextComponents));
});
test('an unknown decision answers with empty vote page context',async()=>{
 const f=voteFixture();f.day.decisions=[];const data=await f.read();
 assert.equal(data.status,'unavailable');assert.deepEqual(data.siblings,[]);assert.equal(data.subject,null);assert.equal(data.mainVoteId,null);assert.equal(data.procedureReferral,false);
});
test('no vote recorded comes from dated group history minus voters, and is absent without history',async()=>{
 const f=voteFixture();
 f.history.members['555']={...f.history.members['197481']};f.history.members['666']={...f.history.members['197481'],mandates:[{start:'2030-01-01',end:null}],groups:[]};f.sources['amendment:member:555']={givenName:'Absent',familyName:'Member'};
 const data=await f.read();
 assert.deepEqual(data.noRecord,{ids:['555'],groups:['PPE']});
 assert.equal(data.people['555'].name,'Absent Member');
 const without=voteFixture();without.store.db.prepare=()=>({get:()=>undefined,all:()=>[]});
 assert.equal((await without.read()).noRecord,null);
 const hands=voteFixture();for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention'])delete hands.raw[key];
 const short=voteFixture();short.history.members['555']={...short.history.members['197481']};short.raw.number_of_votes_favor=Number(short.raw.number_of_votes_favor)+1;
 const partial=await short.read();assert.equal(partial.integrity,'partial');assert.equal(partial.noRecord,null,'a list that disagrees with the totals cannot show absence');
 assert.equal((await hands.read()).noRecord,null,'no named list, nothing to subtract');
});
test('debates come from the held procedure, with time and agenda item from the held event, never upstream',async()=>{
 const f=subjectFixture(),procedure={id:'eli/dl/proc/2025-0222',label:'2025/0222(COD)',consists_of:[
  {activity_id:'MTG-PL-2026-10-06-PVCRE-ITM-3',activity_date:'2026-10-06',had_activity_type:'def/ep-activities/PLENARY_DEBATE'},
  {activity_id:'MTG-PL-2026-10-05-PVCRE-ITM-9',activity_date:'2026-10-05',had_activity_type:'def/ep-activities/PLENARY_DEBATE'},
  {activity_id:'MTG-PL-2026-10-30-PVCRE-ITM-1',activity_date:'2026-10-30',had_activity_type:'def/ep-activities/PLENARY_DEBATE'},
  {activity_id:'not-a-debate',activity_date:'2026-10-06',had_activity_type:'def/ep-activities/PLENARY_DEBATE'},
  {activity_id:'MTG-PL-2026-10-06-PVCRE-ITM-4',activity_date:'2026-10-06',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS'},
 ]},reads=[];
 const data=await decisionVotes(f.query,{reader:f.reader,store:f.store,readProcedure:async()=>procedure,readEvent:async id=>{reads.push(id);return id.endsWith('ITM-3')?{payload:{data:[{activity_id:id,activity_start_date:'2026-10-06T09:00:28+02:00',executed:['eli/dl/event/MTG-PL-2026-10-06-OJ-ITM-D-7']}]}}:null;}});
 assert.deepEqual(data.subject.debates,[
  {id:'MTG-PL-2026-10-05-PVCRE-ITM-9',date:'2026-10-05',start:null,agendaItemId:null},
  {id:'MTG-PL-2026-10-06-PVCRE-ITM-3',date:'2026-10-06',start:'2026-10-06T09:00:28+02:00',agendaItemId:'MTG-PL-2026-10-06-OJ-ITM-D-7'},
 ]);
 assert.equal(reads.length,2);
});
test('a conflicting decision on the item stays among the rows and never becomes the main vote',async()=>{
 const f=subjectFixture(),other=f.day.decisions.find(raw=>raw.activity_id==='MTG-PL-2026-10-07-DEC-2');
 other._conflictingSourceObservations={fields:['decision_method']};
 const data=await f.read(),row=data.siblings.find(sibling=>sibling.id==='MTG-PL-2026-10-07-DEC-2');
 assert.equal(row.ballotStatus,'unknown');assert.equal(row.outcome,null);
 assert.notEqual(data.mainVoteId,row.id);
});
test('a conflicting decision keeps the item around it on its own page, with no result of its own',async()=>{
 const f=subjectFixture();f.raw._conflictingSourceObservations={fields:['decision_method']};
 const data=await f.read();
 assert.equal(data.integrity,'conflicting');assert.deepEqual(data.voters,[]);
 assert.notEqual(data.subject,null);
 assert.deepEqual(new Set(data.siblings.map(row=>row.id)),new Set(['MTG-PL-2026-10-07-DEC-1','MTG-PL-2026-10-07-DEC-2',decisionId]));
 assert.equal(data.mainVoteId,'MTG-PL-2026-10-07-DEC-1');
 assert.equal(data.siblings.find(row=>row.id===decisionId).outcome,null);
 const other=subjectFixture();other.raw._conflictingSourceObservations={fields:['decision_method']};
 const main=await decisionVotes({...other.query,decision:'MTG-PL-2026-10-07-DEC-1'},{reader:other.reader,store:other.store});
 assert.equal(main.mainVoteId,'MTG-PL-2026-10-07-DEC-1');assert(main.siblings.some(row=>row.id===decisionId),'the row is on its neighbours too');
});

test('the vote page reply names an exact roll-call request, in the reader\'s language, and only that',async()=>{
  const f=voteFixture(),parent=f.day.results.find(node=>node.id===f.raw.inverse_consists_of[0]),request='eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-993151-RCV-9';
  assert.deepEqual((await f.read()).decision.rollCallRequesters,[]);
  parent.was_motivated_by=[...(parent.was_motivated_by||[]),{id:request,type:'Activity',activity_id:'MTG-PL-2026-10-07-VOT-ITM-993151-RCV-9',activity_label:{en:'Amendment 114'},had_activity_type:'def/ep-activities/REQUEST_VOTE_ROLLCALL',responsible_organization_label:{en:'S&D',fr:'S&D (fr)',hu:'S&D (hu)'}}];
  f.raw.was_motivated_by=[request];
  const data=await f.read();
  assert.deepEqual(data.decision.rollCallRequesters,[{id:'MTG-PL-2026-10-07-VOT-ITM-993151-RCV-9',binding:'exact-decision-was_motivated_by',organizationLabels:{en:'S&D'}}]);
  assert.equal(data.version,10);
});

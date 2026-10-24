import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {speechRows} from './activity-index-model.mjs';
import {DossierActivity,dossierActivityQuery,dossierReferencesQuery,DOSSIER_ACTIVITY_LIMITS} from './dossier-activity.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {createInsights} from './insights.mjs';

const PID='2025-0176',REF='2025/0176(COD)',DOC='A-10-2025-0273',MEMBER='257727',OTHER='124984';
const SITTING='MTG-PL-2026-09-16',RESULT=SITTING+'-VOT-ITM-993091',DEBATE='MTG-PL-2026-09-15-PVCRE-ITM-14',SPEECH='MTG-PL-2026-09-15-OTH-2017094978376';
const uri=id=>'eli/dl/event/'+id,now='2026-10-23T22:30:00Z';
const source={url:'https://data.europarl.europa.eu/api/v2/procedures/'+PID,fetchedAt:now,language:null};
const record=(endpoint,work)=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse(now),payload:{data:[work]}});
const role=(id,person=MEMBER)=>({id:'participation/'+id,had_participant_person:['person/'+person],participation_role:'def/ep-roles/RAPPORTEUR_CO',activity_date:'2026-02-11',participation_in_name_of:'org/ENVI',occured_at_stage:'def/ep-procedure-stages/RDG1'});
function procedure(){return {id:'eli/dl/proc/'+PID,label:REF,process_type:'def/ep-procedure-types/COD',process_title:{en:'Defence readiness'},had_participation:[role('one'),{...role('two',OTHER),activity_date:'2025-12-08',participation_role:'def/ep-roles/RAPPORTEUR_SHADOW'}],consists_of:[
  {id:uri(DEBATE),had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_date:'2026-09-15',occured_at_stage:'def/ep-procedure-stages/RDG1'},
  {id:uri(RESULT),had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-09-16'},
  {id:'eli/dl/event/report-tabling',had_activity_type:'def/ep-activities/TABLING_PLENARY',based_on_a_realization_of:['eli/dl/doc/'+DOC]},
  ...[2,3].map(number=>({id:'eli/dl/event/AM-'+number+'-DEPOT-2026-09-0'+(number===2?8:9),had_activity_type:'def/ep-activities/TABLING_PLENARY',activity_date:number===2?'2026-09-08':'2026-09-09',occured_at_stage:'def/ep-procedure-stages/RDG1',based_on_a_realization_of:['eli/dl/doc/'+DOC+'-AM-00'+number+'-00'+number]}))]};}
function amendment(number,person){const listId=DOC+'-AM-00'+number+'-00'+number;return {id:DOC+'-AM-'+number,number,listId,targetDocumentId:DOC,documentDate:'2026-09-09',proposerDate:'2026-09-09',proposerDateBasis:'individual-amendment-document',date:'2026-09-09',language:'en',authors:[{name:person===MEMBER?'Pierfrancesco Maran':'Lynn Boylan',personId:person,status:'resolved',evidence:[{mandates:[{start:'2024-07-16',end:null}]}]}],onBehalfOf:number===2?'The Left':['SEDE','ENVI','ITRE'],sources:[source],outcome:number===2?'REJECTED':'ADOPTED',decisions:[{id:SITTING+'-DEC-'+(number===2?'196519':'196161')}],originalText:null,proposedText:null};}
function voteDay(){
  const decisions=[[196161,3,'ADOPTED',MEMBER,OTHER],[196519,2,'REJECTED',OTHER,MEMBER]].map(([id,number,outcome,favor,against])=>({id:uri(SITTING+'-DEC-'+id),activity_id:SITTING+'-DEC-'+id,activity_date:'2026-09-16',type:'Vote',had_activity_type:'def/ep-activities/PLENARY_VOTE',decision_method:'def/ep-decision-methods/VOTE_ELECTRONIC_ROLLCALL',decision_outcome:'def/ep-decision-outcomes/'+outcome,referenceText:{en:number===3?'Provisional agreement':'Proposal for rejection'},inverse_consists_of:[uri(RESULT)],decided_on_a_realization_of:['eli/dl/doc/'+DOC+'-AM-'+number],had_voter_favor:['person/'+favor],had_voter_against:['person/'+against],had_voter_abstention:[],had_voter_intended_favor:[],number_of_votes_favor:1,number_of_votes_against:1,number_of_votes_abstention:0}));
  const evidence={...source,contentHash:'a'.repeat(64),stale:false,refreshInProgress:false,refreshError:null};
  return {sittingId:SITTING,date:'2026-09-16',decisions,results:[{id:uri(RESULT),activity_id:RESULT,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',consists_of:decisions.map(d=>d.id),inverse_consists_of:['eli/dl/proc/'+PID],based_on_a_realization_of:['eli/dl/doc/'+DOC]}],agenda:[],requests:[],sources:{decisions:[evidence],results:[evidence],agenda:[]},coverage:{state:'partial'}};
}
function setup(t,{work=procedure(),amendments=[amendment(2,OTHER),amendment(3,MEMBER)],day=voteDay()}={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'dossier-activity-')),store=new ActivityStore(dir);store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:MEMBER,firstName:'Pierfrancesco',lastName:'Maran'},{id:OTHER,firstName:'Lynn',lastName:'Boylan'}]);
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});});
  const speech={id:uri(SPEECH),activity_id:SPEECH,activity_date:'2026-09-15',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+MEMBER]}],inverse_consists_of:[uri(DEBATE)]};
  store.putSource(generation,'/speeches/'+SPEECH,'speech',speech,now,speechRows(speech,now));
  const report={id:'eli/dl/doc/'+DOC,identifier:DOC,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/'+PID],document_date:'2025-12-19',workHadParticipation:[]};
  const records=new Map([['/procedures/'+PID,record('/procedures/'+PID,work)],['/plenary-documents/'+DOC,record('/plenary-documents/'+DOC,report)],['/events/'+DEBATE,record('/events/'+DEBATE,{id:uri(DEBATE),activity_date:'2026-09-15',activity_label:{en:'Defence (joint debate)'},consists_of:[uri(SPEECH)]})]]),calls=[];
  const reader={record:async endpoint=>{calls.push(endpoint);if(!records.has(endpoint))throw Error('Not supplied');return records.get(endpoint);}};
  let current=amendments;
  const readAmendments=(s,q)=>{assert.equal(s,store);assert.equal(q.document,DOC);assert.equal(q.procedure,undefined,'coverage is queried for the exact reciprocal target');const items=current.filter(a=>amendmentMatches(a,q.member));return {items:items.slice(q.offset,q.offset+q.limit),total:items.length,coverage:{complete:false,gaps:['Wording coverage is incomplete.']}};};
  const votes={snapshot:async()=>({id:'snapshot-1',days:[day],coverage:{status:'partial'}})};
  const service=new DossierActivity(store,{reader,votes,readAmendments});
  const q=(section='roles',member=MEMBER,extra='')=>dossierActivityQuery(new URLSearchParams({reference:REF,section,...(member?{member}:{}),...Object.fromEntries(new URLSearchParams(extra))}));
  return {service,store,records,calls,q,work,generation,day,replaceAmendments:rows=>{current=rows;}};
}
const amendmentMatches=(a,member)=>a.authors?.some(author=>String(author.personId)===member)||a.variants?.some(v=>amendmentMatches(v,member));

test('strict query identity and resolver never infer procedure type',async t=>{
  const x=setup(t);
  for(const text of ['reference='+REF+'&member=0','reference='+REF+'&section=votes','reference='+REF+'&member=1&member=2','reference='+REF+'&offset=-1','reference='+REF+'&other=1'])assert.throws(()=>dossierActivityQuery(new URLSearchParams(text)),e=>e.status===400);
  for(const text of ['procedures=2025-0176,https://example.test','procedures=2025-0176,2025-0176','procedures='])assert.throws(()=>dossierReferencesQuery(new URLSearchParams(text)),e=>e.status===400);
  assert.equal((await x.service.references({ids:[PID],language:'en'})).items[0].reference,REF);
  await assert.rejects(x.service.query({...x.q(),reference:'2025/0176(NLE)'}),e=>e.code==='dossier_reference');
  x.records.get('/procedures/'+PID).payload.data[0].label=null;
  assert.equal((await x.service.references({ids:[PID],language:'en'})).items.length,0);
});
test('roles retain person identity, recorded dates and document-only observations without mutations',async t=>{
  const x=setup(t);x.work.had_participation.push({...role('shared'),had_participant_person:['person/'+MEMBER,'person/'+OTHER],activity_date:undefined});
  x.store.db.exec('PRAGMA query_only=ON');
  const r=await x.service.query(x.q('roles',null));
  assert.equal(r.participants.length,2);assert.equal(r.items.length,4);assert.equal(r.items.filter(a=>a.date===null).length,2);assert(r.items.every(a=>a.dateBasis==='recorded'));
  assert.equal(r.participants.find(p=>p.id===MEMBER).name,'Pierfrancesco Maran');
  x.work.had_participation=undefined;assert.equal((await x.service.query(x.q())).coverage.status,'unavailable');
});
test('document-only role evidence stays separate from a recorded role date',async t=>{
  const x=setup(t),report=x.records.get('/plenary-documents/'+DOC).payload.data[0];
  report.workHadParticipation=[{...role('document-only'),activity_date:undefined}];
  x.store.putSource(x.generation,'/plenary-documents/'+DOC,'document',report,now);
  const r=await x.service.query(x.q());
  const observation=r.items.find(item=>item.documentId===DOC);
  assert.equal(observation.dateBasis,'document');assert.equal(observation.date,'2025-12-19');assert.equal(observation.participationId,'participation/document-only');
});
test('saved speeches need exact debate children, preserve gaps and survive transcript absence',async t=>{
  const x=setup(t);const r=await x.service.query(x.q('speeches'));
  assert.equal(r.items[0].id,SPEECH);assert.equal(r.items[0].jointDebate,true);assert.equal(r.items[0].stage,'RDG1');assert.equal(r.coverage.status,'partial');assert(!('xml' in r.items[0]));
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of=[];
  assert.equal((await x.service.query(x.q('speeches'))).items.length,0);
  x.records.delete('/events/'+DEBATE);const failed=await x.service.query(x.q('speeches'));assert.equal(failed.coverage.status,'unavailable');
  assert.equal((await x.service.query(x.q('roles'))).items.length,1,'a speech failure cannot blank roles');
});
test('amendments retain list-specific dates and same-generation refreshes',async t=>{
  const x=setup(t),r=await x.service.query(x.q('amendments',OTHER));
  assert.equal(r.checkedTarget,DOC);assert.equal(r.items[0].date,'2026-09-08');assert.equal(r.items[0].amendment.documentDate,'2026-09-09');assert.equal(r.items[0].amendment.onBehalfOf,'The Left');
  const revision=r.snapshotId;x.replaceAmendments([{...amendment(2,OTHER),onBehalfOf:'Revised source'}]);
  assert.notEqual((await x.service.query(x.q('amendments',OTHER))).snapshotId,revision);
  x.replaceAmendments([{...amendment(2,OTHER),authors:[{...amendment(2,OTHER).authors[0],evidence:[{mandates:[{start:'2026-09-09',end:null}]}]}]}]);
  const withheld=await x.service.query(x.q('amendments',OTHER));assert.equal(withheld.items.length,0);assert.match(withheld.coverage.gaps.join(' '),/mandate/);
});
test('ambiguous aggregate keeps only a checked matching published variant',async t=>{
  const variant=amendment(3,MEMBER),aggregate={...variant,authors:[],listId:null,conflicted:true,variants:[variant,{...amendment(2,OTHER)}]};
  const x=setup(t,{amendments:[aggregate]});const r=await x.service.query(x.q('amendments'));
  assert.equal(r.items.length,1);assert.equal(r.items[0].amendment.listId,variant.listId);assert.equal(r.items[0].amendment.authors[0].personId,MEMBER);
});
test('joint-debate documents never introduce a different dossier amendment target',async t=>{
  const x=setup(t);x.work.consists_of[0].based_on_a_realization_of=['eli/dl/doc/A-10-2025-0001','eli/dl/doc/'+DOC];
  const r=await x.service.query(x.q('amendments'));
  assert.equal(r.checkedTarget,DOC);assert(!x.calls.includes('/plenary-documents/A-10-2025-0001'));
});
test('one unavailable amendment target retains the next target continuation',async t=>{
  const x=setup(t);x.work.consists_of.push({id:uri('other-tabling'),had_activity_type:'def/ep-activities/TABLING_PLENARY',based_on_a_realization_of:['eli/dl/doc/A-10-2025-0001']});
  const first=await x.service.query(x.q('amendments'));assert.equal(first.coverage.status,'unavailable');assert.deepEqual(first.pagination.next,{offset:0,targetOffset:1});
  const next=await x.service.query(x.q('amendments',MEMBER,'target-offset=1'));assert.equal(next.items[0].amendment.number,3);
});
test('target observations stay separate from broader amendment discovery failures',async t=>{
  const x=setup(t),discovery={pending:true,refreshGaps:true,capacityGaps:[]};
  const service=new DossierActivity(x.store,{reader:x.service.reader,readAmendments:()=>({items:[amendment(3,MEMBER)],total:1,coverage:{observationComplete:true,targetGaps:[],gaps:['Other targets failed.'],discovery}})});
  const r=await service.query(x.q('amendments'));
  assert.equal(r.checkedTarget,DOC);assert.equal(r.coverage.status,'complete');assert.deepEqual(r.coverage.gaps,[]);assert.deepEqual(r.coverage.discovery,discovery);
});
test('named votes preserve Maran and Boylan opposition and keep outcome separate',async t=>{
  const x=setup(t),maran=await x.service.query(x.q('votes')),boylan=await x.service.query(x.q('votes',OTHER));
  assert.equal(maran.items.length,2);
  const agreement=rows=>rows.find(r=>r.id.endsWith('196161')).vote,rejection=rows=>rows.find(r=>r.id.endsWith('196519')).vote;
  assert.equal(agreement(maran.items).actualPosition.position,'for');assert.equal(agreement(maran.items).outcome,'ADOPTED');assert.equal(rejection(maran.items).actualPosition.position,'against');
  assert.equal(rejection(boylan.items).actualPosition.position,'for');assert.equal(rejection(boylan.items).outcome,'REJECTED');assert.equal(agreement(boylan.items).actualPosition.position,'against');assert(maran.items.every(item=>item.stage===null));
  x.day.decisions[0].had_voter_against.push('person/'+MEMBER);
  const conflict=await x.service.query(x.q('votes'));assert.equal(agreement(conflict.items).actualPosition.status,'conflicting');
});
test('contradictory vote parents never enrich this dossier',async t=>{
  const x=setup(t);x.day.decisions[0].inverse_consists_of.push(uri(SITTING+'-VOT-ITM-999999'));
  const r=await x.service.query(x.q('votes'));assert(!r.items.some(item=>item.id.endsWith('196161')));
});
test('non-named ballots and intentions never become recorded member positions',async t=>{
  const x=setup(t),raw=x.day.decisions[0];raw.decision_method='def/ep-decision-methods/VOTE_HAND';
  delete raw.had_voter_favor;delete raw.had_voter_against;delete raw.had_voter_abstention;
  raw.had_voter_intended_favor=['person/'+MEMBER];
  const r=await x.service.query(x.q('votes')),vote=r.items.find(item=>item.id.endsWith('196161')).vote;
  assert.equal(vote.actualPosition.position,null);assert.equal(vote.actualPosition.status,'unavailable');assert.deepEqual(vote.intention.positions,['for']);assert.equal(vote.outcome,'ADOPTED');
});
test('a person without a recorded role is never replaced by a named participant',async t=>{
  const x=setup(t),r=await x.service.query(x.q('roles','99999'));
  assert.equal(r.memberId,'99999');assert.equal(r.items.length,0);assert(r.participants.every(person=>person.id!=='99999'));
});
test('caps keep unknown totals and expose a continuation rather than a complete history',async t=>{
  const x=setup(t);x.work.had_participation=Array.from({length:DOSSIER_ACTIVITY_LIMITS.roles+1},(_,i)=>role('r'+i));
  const r=await x.service.query(x.q('roles',MEMBER,'limit=1'));assert.equal(r.items.length,1);assert.deepEqual(r.pagination.next,{offset:1,targetOffset:0});assert.equal(r.coverage.status,'partial');assert(r.coverage.gaps.length);
  for(const section of ['dossier-activity','dossier-references'])assert.equal(apiCachePolicy({method:'GET'},new URL('https://example.test/api/insights/'+section),r).cacheControl,'no-store');
});
test('root insight routing uses the existing owned store and exact procedure client',async t=>{
  const x=setup(t),calls=[];
  const service=createInsights(x.store,{request:async endpoint=>{calls.push(endpoint);if(!x.records.has(endpoint))throw Error('Not supplied');return x.records.get(endpoint);}});
  const data=await service.query('dossier-activity',new URLSearchParams({reference:REF,member:MEMBER}));
  assert.equal(data.items[0].personId,MEMBER);
  assert.deepEqual(calls,['/procedures/'+PID]);
  assert.equal((await service.query('dossier-references',new URLSearchParams({procedures:PID}))).items[0].reference,REF);
});

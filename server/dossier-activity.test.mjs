import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
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
  assert.equal(r.items[0].id,SPEECH);assert.equal(r.items[0].jointDebate,true);assert.equal(r.items[0].stage,'RDG1');assert.equal(r.coverage.status,'complete');assert(!('xml' in r.items[0]));
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of=[];
  const empty=await x.service.query(x.q('speeches'));assert.equal(empty.items.length,0);assert.equal(empty.coverage.retryable,false);assert.equal(empty.coverage.status,'complete');
  x.records.delete('/events/'+DEBATE);const failed=await x.service.query(x.q('speeches'));assert.equal(failed.coverage.status,'unavailable');
  assert.equal((await x.service.query(x.q('roles'))).items.length,1,'a speech failure cannot blank roles');
});
test('exact non-speech event classification closes only its own declared-reference gap',async t=>{
  const x=setup(t),other='MTG-PL-2026-09-15-OTH-999999';
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of.push(uri(other));
  const unclassified=await x.service.query(x.q('speeches'));assert.deepEqual(unclassified.coverage.missingSpeechIds,[]);assert.deepEqual(unclassified.coverage.unresolvedChildIds,[other]);assert.equal(unclassified.coverage.status,'complete');
  const projection={id:other,kind:'PLENARY_PROCEEDING',date:null,classificationVersion:1,declaredBy:DEBATE,source:{url:'https://data.europarl.europa.eu/api/v2/events/'+other+'?format=application%2Fld%2Bjson',fetchedAt:now}};
  x.store.putSource(x.generation,'/events/'+other,'event',projection,now);
  const checked=await x.service.query(x.q('speeches'));
  assert.equal(checked.coverage.status,'complete');assert.deepEqual(checked.coverage.missingSpeechIds,[]);
  assert.equal(checked.items.length,1,'non-speech events never become member contributions');
  assert(checked.coverage.sources.some(source=>source.url===projection.source.url&&source.fetchedAt===now));
  for(const change of [{kind:null},{kind:'PLENARY_DEBATE_SPEECH'},{declaredBy:DEBATE+'0'},{source:{url:'https://example.invalid',fetchedAt:now}}]) {
    x.store.putSource(x.generation,'/events/'+other,'event',{...projection,...change},now);
    const unresolved=await x.service.query(x.q('speeches'));assert.equal(unresolved.coverage.status,'complete');assert.deepEqual(unresolved.coverage.unresolvedChildIds,[other]);
  }
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
  const x=setup(t),raw=x.day.decisions[0];
  delete raw.had_voter_favor;delete raw.had_voter_against;delete raw.had_voter_abstention;
  raw.had_voter_intended_favor=['person/'+MEMBER];
  for(const method of ['VOTE_HAND','VOTE_ELECTRONIC','VOTE_ELECTRONIC_SECRET','VOTE_SECRET','VOTE_SECRET_BALLOT']){
    raw.decision_method='def/ep-decision-methods/'+method;
    const r=await x.service.query(x.q('votes')),vote=r.items.find(item=>item.id.endsWith('196161')).vote;
    assert.equal(r.version,10);assert.equal(vote.actualPosition.position,null);assert.equal(vote.actualPosition.status,'not-individually-recorded');assert.deepEqual(vote.intention.positions,['for']);assert.equal(vote.outcome,'ADOPTED');
  }
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

const rsp=JSON.parse(readFileSync(new URL('./fixtures/dossier-no-role-rsp.json',import.meta.url),'utf8'));
test('no-role RSP discovers exact saved contributors independently of roles, summaries and scheduled agenda IDs',async t=>{
  const x=setup(t),work=rsp.procedure,speech=rsp.speech,debate=speech.debateId;
  x.records.set('/procedures/2026-2925',record('/procedures/2026-2925',work));
  x.records.set('/events/'+debate,record('/events/'+debate,{id:uri(debate),activity_date:speech.date,consists_of:[uri(speech.id)]}));
  const raw={id:uri(speech.id),activity_id:speech.id,activity_date:speech.date,activity_start_date:speech.start,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+rsp.personId]}],inverse_consists_of:[uri(debate)]};
  x.store.putSource(x.generation,'/speeches/'+speech.id,'speech',raw,speech.source.fetchedAt,speechRows(raw,speech.source.fetchedAt));
  x.store.setMembers([{id:rsp.personId,firstName:'Gabriele',lastName:'Bischoff'}]);
  const query=(section,member)=>dossierActivityQuery(new URLSearchParams({reference:work.label,section,...(member?{member}:{})}));
  x.store.db.exec('PRAGMA query_only=ON');
  const full=await x.service.query(query('roles'));
  assert.equal(full.coverage.status,'unavailable');assert.equal(full.coverage.observedCount,null);assert.equal(full.items.length,0);
  assert.equal(full.participantCoverage.status,'complete');assert.equal(full.participants.length,1);
  assert.equal(full.participants[0].id,rsp.personId);assert.equal(full.participants[0].name,'Gabriele Bischoff');assert.deepEqual(full.participants[0].roles,[]);
  assert.deepEqual(full.participants[0].speeches,[{id:speech.id,debateId:debate,date:speech.date,source:speech.source}]);
  assert(!x.calls.some(endpoint=>endpoint.includes('OJ-ITM')||endpoint.startsWith('/persons/')||endpoint.startsWith('/speeches/')));
  const person=await x.service.query(query('speeches',rsp.personId));assert.equal(person.items[0].id,speech.id);assert(!person.coverage.gaps.some(gap=>gap.includes('role')));
  for(const section of ['amendments','votes']){const result=await x.service.query(query(section,rsp.personId));assert.deepEqual(result.items,[]);assert.equal(result.coverage.observedCount,null);assert.equal(result.coverage.status,'unavailable');assert(!result.coverage.gaps.some(gap=>gap.includes('role')));}
  const hash=full.snapshotId;
  x.store.db.exec('PRAGMA query_only=OFF');x.store.db.prepare('DELETE FROM items WHERE source_id=?').run(speech.id);
  const empty=await x.service.query(query('roles'));assert.equal(empty.participants.length,0);assert.notEqual(empty.snapshotId,hash);
});

test('contributor discovery is bounded and retains separate pages, exact people and failed debate coverage',async t=>{
  const x=setup(t),otherDebate='MTG-PL-2026-09-16-PVCRE-ITM-15',third='MTG-PL-2026-09-17-PVCRE-ITM-16';
  x.work.had_participation=[];
  for(const [id,day] of [[otherDebate,'2026-09-16'],[third,'2026-09-17']])x.work.consists_of.push({id:uri(id),activity_date:day,had_activity_type:'def/ep-activities/PLENARY_DEBATE'});
  const raw={id:uri(SPEECH),activity_id:SPEECH,activity_date:'2026-09-15',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+MEMBER,'person/'+OTHER]}],inverse_consists_of:[uri(DEBATE)]};
  x.store.putSource(x.generation,'/speeches/'+SPEECH,'speech',raw,now,speechRows(raw,now));
  const first=await x.service.query(x.q('roles',null));
  assert.deepEqual(first.participants.map(p=>p.id).sort(),[OTHER,MEMBER].sort());assert(first.participants.every(p=>!p.roles.length&&p.speeches[0].id===SPEECH));
  assert.equal(first.coverage.status,'complete');assert.equal(first.participantCoverage.status,'partial');assert.equal(first.participantCoverage.retryable,true);assert.deepEqual(first.participantCoverage.failedDebates,[otherDebate]);assert.match(first.participantCoverage.gaps.join(' '),/debate is unavailable/);
  assert.deepEqual(first.pagination.next,{offset:0,targetOffset:2});assert(!x.calls.includes('/events/'+third));
  const next=await x.service.query(x.q('roles',null,'target-offset=2'));assert.equal(next.participantCoverage.status,'unavailable');assert.equal(next.participantCoverage.retryable,true);assert.deepEqual(next.participantCoverage.failedDebates,[third]);assert.equal(next.pagination.next,null);
  raw.inverse_consists_of=[uri(otherDebate)];x.store.putSource(x.generation,'/speeches/'+SPEECH,'speech',raw,now,speechRows(raw,now));
  const conflict=await x.service.query(x.q('roles',null));assert.deepEqual(conflict.participants,[]);assert.match(conflict.participantCoverage.gaps.join(' '),/conflicting debate links/);
});

test('speech coverage completes its declared linked scope without requiring hypothetical contributions',async t=>{
  const x=setup(t),response=await x.service.query(x.q('speeches'));
  assert.equal(response.coverage.status,'complete');assert.deepEqual(response.coverage.gaps,[]);
  assert.deepEqual(response.coverage.missingSpeechIds,[]);assert.equal(response.items.length,1);
  const other=await x.service.query(x.q('speeches',OTHER));
  assert.equal(other.coverage.status,'complete');assert.equal(other.coverage.observedCount,0);
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of=[];
  const empty=await x.service.query(x.q('speeches'));
  assert.equal(empty.coverage.status,'complete');assert.equal(empty.coverage.observedCount,0);assert.deepEqual(empty.coverage.gaps,[]);
  x.work.consists_of=[];
  const noDebates=await x.service.query(x.q('speeches'));
  assert.equal(noDebates.coverage.status,'complete');assert.equal(noDebates.coverage.observedCount,0);
});

test('a concrete declared speech absent from retained sources keeps coverage partial',async t=>{
  const x=setup(t),missing='MTG-PL-2026-09-15-OTH-9999999999999';
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of.push({id:uri(missing),had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+MEMBER]}]});
  const response=await x.service.query(x.q('speeches'));
  assert.equal(response.coverage.status,'partial');assert.deepEqual(response.coverage.missingSpeechIds,[missing]);
  assert.equal(response.items.length,1);assert.match(response.coverage.gaps.join(' '),/linked contribution.*not saved/i);
  assert(!response.coverage.gaps.some(gap=>gap.includes('Showing saved contributions')));
  x.store.putSource(x.generation,'/speeches/'+missing,'document',{id:uri(missing)},now);
  assert.deepEqual((await x.service.query(x.q('speeches'))).coverage.missingSpeechIds,[missing]);
  const raw={id:uri(missing),activity_id:missing,activity_date:'2026-09-15',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+MEMBER]}],inverse_consists_of:[uri(DEBATE)]};
  x.store.putSource(x.generation,'/speeches/'+missing,'speech',raw,now,speechRows(raw,now));
  const recovered=await x.service.query(x.q('speeches'));
  assert.equal(recovered.coverage.status,'complete');assert.deepEqual(recovered.coverage.missingSpeechIds,[]);assert.equal(recovered.items.length,2);
});
test('URI-only markers and another person’s typed missing speech do not make this member partial',async t=>{
  const x=setup(t),marker='MTG-PL-2026-09-15-OTH-991',other='MTG-PL-2026-09-15-OTH-992';
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of.push(uri(marker),{id:uri(other),had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+OTHER]}]});
  const selected=await x.service.query(x.q('speeches'));
  assert.equal(selected.coverage.status,'complete');assert.deepEqual(selected.coverage.missingSpeechIds,[]);assert.equal(selected.items.length,1);
  assert.deepEqual(new Set(selected.coverage.unresolvedChildIds),new Set([marker,other]));
  const affected=await x.service.query(x.q('speeches',OTHER));
  assert.equal(affected.coverage.status,'partial');assert.deepEqual(affected.coverage.missingSpeechIds,[other]);
});

test('split child declarations require consistent type, identity, date and parent before attributing missing speech',async t=>{
  const x=setup(t),missing='MTG-PL-2026-09-15-OTH-993',record=x.records.get('/events/'+DEBATE);
  record.payload.data[0].consists_of.push(uri(missing));
  const typed={id:uri(missing),had_activity_type:'def/ep-activities/PLENARY_DEBATE_WRITTEN_STATEMENT',had_participation:[{had_participant_person:['person/'+MEMBER]}]};
  record.payload.data.push(typed);
  assert.deepEqual((await x.service.query(x.q('speeches'))).coverage.missingSpeechIds,[missing]);
  for(const conflict of [
    {id:uri(missing),had_activity_type:'def/ep-activities/PLENARY_DEBATE_CATCH_THE_EYE'},
    {id:uri(missing),activity_id:missing+'0'},
    {id:uri(missing),activity_date:'2024-01-01'},
    {id:uri(missing),inverse_consists_of:[uri('MTG-PL-2026-09-15-PVCRE-ITM-999')]},
  ]) {
    record.payload.data.push(conflict);
    const value=await x.service.query(x.q('speeches'));
    assert.deepEqual(value.coverage.missingSpeechIds,[]);assert(value.coverage.unresolvedChildIds.includes(missing));
    record.payload.data.pop();
  }
});

test('a cached non-speech classification cannot erase an exact attributed speech declaration',async t=>{
  const x=setup(t),id='MTG-PL-2026-09-15-OTH-996';
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of.push({id:uri(id),had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+MEMBER]}]});
  x.store.putSource(x.generation,'/events/'+id,'event',{id,kind:'PLENARY_PROCEEDING',classificationVersion:1,declaredBy:DEBATE,source:{url:'https://data.europarl.europa.eu/api/v2/events/'+id+'?format=application%2Fld%2Bjson',fetchedAt:now}},now);
  const selected=await x.service.query(x.q('speeches'));
  assert.equal(selected.coverage.status,'partial');assert.deepEqual(selected.coverage.missingSpeechIds,[id]);
});

test('generic speech classification qualifies all-contributor discovery but not an unknown member attribution',async t=>{
  const x=setup(t),id='MTG-PL-2026-09-15-OTH-994';
  x.records.get('/events/'+DEBATE).payload.data[0].consists_of.push(uri(id));
  x.store.putSource(x.generation,'/events/'+id,'event',{id,kind:'PLENARY_DEBATE_SPEECH',classificationVersion:1,declaredBy:DEBATE,source:{url:'https://data.europarl.europa.eu/api/v2/events/'+id+'?format=application%2Fld%2Bjson',fetchedAt:now}},now);
  const selected=await x.service.query(x.q('speeches'));
  assert.equal(selected.coverage.status,'complete');assert.deepEqual(selected.coverage.missingSpeechIds,[]);
  const directory=await x.service.query(x.q('roles',null));
  assert.equal(directory.participantCoverage.status,'partial');assert.deepEqual(directory.participantCoverage.missingSpeechIds,[id]);
});

test('retained source freshness does not invent a coverage gap',async t=>{
  const x=setup(t);
  for(const endpoint of ['/procedures/'+PID,'/events/'+DEBATE])Object.assign(x.records.get(endpoint),{stale:true,refreshInProgress:true,refreshError:'Source refresh delayed'});
  const response=await x.service.query(x.q('speeches'));
  assert.equal(response.coverage.status,'complete');assert.deepEqual(response.coverage.gaps,[]);
  assert(response.coverage.sources.every(item=>item.stale&&item.refreshInProgress&&item.refreshError));
  assert.deepEqual(response.coverage.failedDebates,[]);assert.equal(response.coverage.retryable,false);
});

test('unknown relationship lists and absent targets are unavailable rather than phantom partial data',async t=>{
  const x=setup(t);delete x.work.consists_of;
  const unknown=await x.service.query(x.q('speeches'));
  assert.equal(unknown.coverage.status,'unavailable');assert.equal(unknown.coverage.observedCount,null);
  x.work.consists_of=[];
  for(const section of ['amendments','votes']){
    const response=await x.service.query(x.q(section));
    assert.equal(response.coverage.status,'unavailable');assert.equal(response.coverage.observedCount,null);assert.equal(response.coverage.retryable,false);
  }
});

test('known unscanned linked debates remain partial until their own page is checked',async t=>{
  const x=setup(t);
  for(const [id,day] of [['MTG-PL-2026-09-16-PVCRE-ITM-15','2026-09-16'],['MTG-PL-2026-09-17-PVCRE-ITM-16','2026-09-17']]){
    x.work.consists_of.push({id:uri(id),activity_date:day,had_activity_type:'def/ep-activities/PLENARY_DEBATE'});
    x.records.set('/events/'+id,record('/events/'+id,{id:uri(id),activity_date:day,consists_of:[]}));
  }
  const first=await x.service.query(x.q('speeches'));
  assert.equal(first.coverage.status,'partial');assert.deepEqual(first.pagination.next,{offset:0,targetOffset:2});
  assert.deepEqual(first.coverage.uncheckedTargets,['MTG-PL-2026-09-17-PVCRE-ITM-16']);
  const last=await x.service.query(x.q('speeches',MEMBER,'target-offset=2'));
  assert.equal(last.coverage.status,'partial');assert.deepEqual(last.coverage.checkedTargets,['MTG-PL-2026-09-17-PVCRE-ITM-16']);assert.equal(last.coverage.observedCount,0);assert.equal(last.pagination.next,null);
});

test('unobserved amendment relationships do not invent missing amendments',async t=>{
  const x=setup(t),coverage={observationComplete:false,targetGaps:['Amendment relationships have not been observed.']};
  const service=new DossierActivity(x.store,{reader:x.service.reader,readAmendments:()=>({items:[],total:0,coverage})});
  const unknown=await service.query(x.q('amendments'));
  assert.equal(unknown.coverage.status,'unavailable');assert.equal(unknown.coverage.observedCount,null);
  const work=x.records.get('/plenary-documents/'+DOC).payload.data[0];
  work.inverse_foresees_change_of=['eli/dl/doc/A-10-2026-9999-AM-001-003'];
  assert.equal((await service.query(x.q('amendments'))).coverage.status,'unavailable');
  work.inverse_foresees_change_of=['eli/dl/doc/'+DOC+'-AM-001-003'];
  const missing=await service.query(x.q('amendments'));
  assert.equal(missing.coverage.status,'partial');assert.equal(missing.coverage.observedCount,0);
  Object.assign(coverage,{observationComplete:true,targetGaps:[]});
  work.inverse_foresees_change_of=[];
  const empty=await service.query(x.q('amendments'));
  assert.equal(empty.coverage.status,'complete');assert.equal(empty.coverage.observedCount,0);
});

test('an invalid declared debate is a concrete source gap',async t=>{
  const x=setup(t);x.work.consists_of.push({id:'eli/dl/event/bad-debate',had_activity_type:'def/ep-activities/PLENARY_DEBATE'});
  const response=await x.service.query(x.q('speeches'));
  assert.equal(response.coverage.status,'partial');assert.match(response.coverage.gaps.join(' '),/invalid identifier/);
});

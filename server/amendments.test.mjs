import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENTS_VERSION, amendmentLists, amendmentOutcome, amendmentQuery, amendmentReference } from './amendments.mjs';
import { amendmentFailures, amendmentsPage, enqueueAmendment, nextAmendmentTask, recordSplitResults, saveAmendmentRows } from './amendments-store.mjs';
import { failAmendmentTask, parseSavedSplits, prepareAmendments, rebuildAmendmentTarget, refreshSittingTargets, scheduleAmendments } from './amendments-worker.mjs';
import { SPLIT_PARSER_VERSION, parseSplitRequest } from './amendment-splits.mjs';
import { resolveAmendmentAuthors } from './amendment-authors.mjs';
import { AMENDMENT_EXTRACTION_VERSION, extractAmendments } from './amendment-documents.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254', otherTarget='B-10-2026-0254', sitting='MTG-PL-2026-10-07';
const tabled='2026-10-02', fetchedAt='2026-10-16T17:00:00.000Z', earlier='2026-10-15T17:00:00.000Z';
const sourceUrl='https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/vote-results?format=application%2Fld%2Bjson';
const target={id:'eli/dl/doc/'+targetId,identifier:targetId,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:tabled,title_dcterms:{en:'A public report',fr:'Un rapport public'},inverse_created_a_realization_of:['eli/dl/proc/2025-0233'],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-123'],isAboutSubjectMatter:['http://publications.europa.eu/resource/authority/subject-matter/ENV']};
const listId=targetId+'-AM-001-004';
const amendment=(number,extra={})=>({number,authors:[],targetLabel:'Article '+number,originalText:'Original '+number,proposedText:'Proposal '+number,date:tabled,language:'en',gaps:[],...extra});
const list=(amendments,extra={})=>({id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,document_date:tabled,work_type:'def/ep-document-types/AMENDMENT_LIST',extraction:{amendments,gaps:[],language:'en',sourceUrl:'https://data.europarl.europa.eu/distribution/example/amendments_en.docx',fetchedAt:earlier,parserVersion:AMENDMENT_EXTRACTION_VERSION},...extra});
const decision=(number,refs,outcome,extra={})=>({id:'eli/dl/event/'+sitting+'-DEC-'+number,decided_on_a_realization_of:refs,activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/'+outcome,decision_method:'def/ep-vote-methods/ROLL_CALL',referenceText:{en:'The same public title'},...extra});
const part=(number,description)=>({id:'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-1-'+number,number:String(number),numbering:number,expressionContent:{en:'<partValue>'+description+'</partValue>'}});
const request=(parts)=>({id:'eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-1',had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:parts});
const coverage={complete:true,gaps:[],lastUpdated:earlier};
const metadata={id:targetId,date:tabled,titles:target.title_dcterms,procedureIds:['2025-0233']};
const row=(number,extra={})=>({id:targetId+'-AM-'+number,targetDocumentId:targetId,number,date:tabled,titles:target.title_dcterms,procedureIds:['2025-0233'],authors:[],decisions:[],gaps:[],...extra});
const completeSitting=(sittingId=sitting)=>({
  amendmentVersion:AMENDMENTS_VERSION,splitRequests:[],coverage:{missingResultIds:[],missingDecisionIds:[]},truncated:false,lastRefreshFailure:null,
  results:[{id:'eli/dl/event/'+sittingId+'-VOT-ITM-123',consists_of:['eli/dl/event/'+sittingId+'-DEC-1'],sittingResultIds:[]}],
  decisions:[{...decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED'),id:'eli/dl/event/'+sittingId+'-DEC-1'}],
});
const outcomeJobs=(store,generation)=>store.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='motion-outcomes' ORDER BY key").all(generation);

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendments-test-'));
  let now=Date.parse(fetchedAt);
  const store=new ActivityStore(directory,{clock:()=>now});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const worker=new ActivityWorker(store,{clock:()=>now,fetchRecord:async()=>{throw new Error('Unexpected network request in amendment test.');}});
  return {store,worker,generation,advance:milliseconds=>{now+=milliseconds;store.renew();}};
}
function seedTarget(store,generation,amendments) {
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',list(amendments),earlier);
}

test('decision joins use the exact target and amendment URI, preserving collective and split decisions',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[1,2,3,4].map(number=>amendment(number)));
  const split=request([part(1,'Text as a whole without the word: ‘old’'),part(2,'‘old’')]);
  const work=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[split],decisions:[
    decision(1,['eli/dl/doc/'+targetId+'-AM-1','eli/dl/doc/'+targetId+'-AM-2'],'ADOPTED',{number_of_votes_favor:300,number_of_votes_against:200,number_of_votes_abstention:0}),
    decision(2,['eli/dl/doc/'+targetId+'-AM-3',split.created_a_realization_of[0].id],'REJECTED'),
    decision(3,['eli/dl/doc/'+targetId+'-AM-3',split.created_a_realization_of[1].id],'LAPSED',{decision_method:'def/ep-vote-methods/SHOW_HANDS'}),
    decision(4,['eli/dl/doc/'+otherTarget+'-AM-4'],'ADOPTED'),
    decision(5,['eli/dl/doc/'+targetId+'-AM-5'],'ADOPTED',{decision_method:'def/ep-vote-methods/SHOW_HANDS'}),
    decision(6,['eli/dl/doc/'+targetId],'ADOPTED'),
  ]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',work,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),byNumber=new Map(page.items.map(item=>[item.number,item]));
  assert.equal(page.total,5);
  for(const number of [1,2]) {
    assert.equal(byNumber.get(number).outcome,'ADOPTED');
    assert.deepEqual(byNumber.get(number).decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
    assert.deepEqual(byNumber.get(number).decisions[0].totals,{for:300,against:200,abstaining:0});
  }
  assert.equal(byNumber.get(3).outcome,'mixed');
  assert.deepEqual(byNumber.get(3).decisions.map(vote=>[vote.partNumber,vote.outcome]),[[1,'REJECTED'],[2,'LAPSED']]);
  assert.deepEqual(byNumber.get(3).decisions.map(vote=>vote.partId),split.created_a_realization_of.map(component=>component.id));
  assert.equal(byNumber.get(3).splitParts.length,2);
  assert(byNumber.get(3).splitParts.every(component=>component.grounding==='not_attempted'));
  assert(byNumber.get(3).gaps.some(gap=>gap.includes('have not been validated')));
  assert.equal(byNumber.get(4).outcome,'unavailable');
  assert.deepEqual(byNumber.get(4).decisions,[]);
  assert(byNumber.get(4).gaps.includes('No explicit amendment outcome is indexed.'));
  assert.equal(byNumber.get(5).originalText,null);
  assert.equal(byNumber.get(5).decisions[0].totals,null);
  assert(byNumber.get(5).gaps.includes('Amendment wording and authorship are unavailable.'));
  assert.deepEqual(byNumber.get(1).procedureIds,['2025-0233']);
  assert.equal(byNumber.get(1).topics[0].basis,'dossier');
  assert.equal(amendmentsPage(store,{document:otherTarget}).total,0);
  assert.equal(amendmentsPage(store,{procedure:'2025-0233'}).total,5);
  assert.equal(amendmentsPage(store,{procedure:'2025-9999'}).total,0);
  assert.equal(amendmentsPage(store,{outcome:'mixed'}).total,1);
  assert.equal(amendmentsPage(store,{limit:1,offset:1}).items[0].number,2);
});

test('split descriptions join on the full canonical URI rather than a shared document and event leaf',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const description=part(1,'‘selected wording’'),decisionPartId=description.id;
  description.id=description.id.replace('/doc/','/event/');
  const work=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[request([description])],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',decisionPartId],'ADOPTED')]});
  assert.equal(work.parsedSplits[0].parts[0].status,'parsed');
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',work,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.decisions[0].partId,decisionPartId);
  assert.deepEqual(item.splitParts,[]);
  assert(item.gaps.includes('A split component has no indexed description.'));
});

test('a refreshed decision replaces its prior split bindings while entirely absent decisions remain retained',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const description=part(1,'‘selected wording’'),documentPartId=description.id,eventPartId=documentPartId.replace('/doc/','/event/');
  const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[request([description])],decisions:[
    decision(1,['eli/dl/doc/'+targetId+'-AM-1',documentPartId],'ADOPTED'),
    decision(2,['eli/dl/doc/'+targetId+'-AM-1'],'REJECTED'),
  ]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  let [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.splitParts[0].id,documentPartId);
  assert.equal(item.decisions.find(vote=>vote.id===sitting+'-DEC-1').partId,documentPartId);
  const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',eventPartId],'LAPSED')],sources:[{url:sourceUrl,fetchedAt}]};
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  [item]=amendmentsPage(store,{document:targetId}).items;
  assert.deepEqual(item.splitParts,[]);
  assert.equal(item.decisions.length,2);
  const current=item.decisions.filter(vote=>vote.id===sitting+'-DEC-1');
  assert.equal(current.length,1);assert.equal(current[0].partId,eventPartId);assert.equal(current[0].outcome,'LAPSED');
  assert(!item.decisions.some(vote=>vote.partId===documentPartId));
  assert.equal(item.decisions.find(vote=>vote.id===sitting+'-DEC-2').outcome,'REJECTED');
  assert(item.gaps.includes('A split component has no indexed description.'));
});

test('fresh split parsing takes precedence when a retained absent decision references the same component',t=>{
  for(const previous of [{status:'unresolved',plan:null},{status:'parsed',plan:{type:'text',quote:'Old selection'}}]) {
    const {store,generation}=setup(t),partId=part(1,'unused').id;
    const oldPart={id:partId,number:1,description:'Old description',...previous};
    saveAmendmentRows(store,generation,metadata,[row(1,{decisions:[{id:sitting+'-DEC-2',outcome:'REJECTED',partId}],splitParts:[oldPart],sources:[]})],coverage);
    const freshPart={id:partId,number:1,description:'Fresh description',status:'parsed',plan:{type:'text',quote:'Fresh selection'}};
    saveAmendmentRows(store,generation,metadata,[row(1,{decisions:[{id:sitting+'-DEC-1',outcome:'ADOPTED',partId}],splitParts:[freshPart],sources:[]})],coverage);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.deepEqual(item.decisions.map(vote=>vote.id).sort(),[sitting+'-DEC-1',sitting+'-DEC-2']);
    assert.equal(item.outcome,'mixed');
    assert.deepEqual(item.splitParts,[freshPart]);
    assert(item.retainedComponents.includes('decisions'));
  }
});

test('a fresh decision moving between amendment numbers invalidates its old binding even when old wording is retained',t=>{
  for(const missingOldText of [false,true]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1),amendment(2),amendment(3)]);
    const oldPart=part(1,'‘old selected wording’');
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[request([oldPart])],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',oldPart.id],'ADOPTED'),decision(2,['eli/dl/doc/'+targetId+'-AM-3'],'REJECTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].outcome,'ADOPTED');
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].splitParts[0].id,oldPart.id);
    if(missingOldText)store.putSource(generation,'amendment:list:'+listId,'amendment-list',list([amendment(2),amendment(3)]),fetchedAt);
    const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-2'],'LAPSED')]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    const byNumber=new Map(amendmentsPage(store,{document:targetId}).items.map(item=>[item.number,item]));
    assert.equal(byNumber.get(1).proposedText,'Proposal 1');
    assert.equal(byNumber.get(1).outcome,'unavailable');assert.deepEqual(byNumber.get(1).decisions,[]);
    assert.deepEqual(byNumber.get(1).splitParts,[]);
    assert.equal(byNumber.get(2).outcome,'LAPSED');
    assert.deepEqual(byNumber.get(2).decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
    assert.equal(byNumber.get(3).outcome,'REJECTED');
    assert.deepEqual(byNumber.get(3).decisions.map(vote=>vote.id),[sitting+'-DEC-2']);
  }
});

test('a fresh sitting decision moving to another target also rebuilds the previously referenced target',t=>{
  for(const legacyTargetMetadata of [false,true]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    const secondTarget={...target,id:'eli/dl/doc/'+otherTarget,identifier:otherTarget};
    store.putSource(generation,'/plenary-documents/'+otherTarget,'document',secondTarget,earlier);
    const secondListId=otherTarget+'-AM-001-001';
    store.putSource(generation,'amendment:list:'+secondListId,'amendment-list',list([amendment(1,{proposedText:'Other target wording'})],{id:'eli/dl/doc/'+secondListId,identifier:secondListId,targetDocumentId:otherTarget}),earlier);
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    rebuildAmendmentTarget(worker,generation,otherTarget);
    if(legacyTargetMetadata) {
      const previous=JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId).body);
      delete previous.sittingIds;
      store.db.prepare('UPDATE amendment_targets SET body=? WHERE generation=? AND id=?').run(JSON.stringify(previous),generation,targetId);
    }
    const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+otherTarget+'-AM-1'],'LAPSED')]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    refreshSittingTargets(worker,generation,sitting,refreshed);
    const [oldItem]=amendmentsPage(store,{document:targetId}).items,[newItem]=amendmentsPage(store,{document:otherTarget}).items;
    assert.equal(oldItem.proposedText,'Proposal 1');
    assert.equal(oldItem.outcome,'unavailable');assert.deepEqual(oldItem.decisions,[]);
    assert.equal(newItem.proposedText,'Other target wording');assert.equal(newItem.outcome,'LAPSED');
    assert.deepEqual(newItem.decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
  }
});

test('missing or unrecognised decision relationships retain accepted bindings while an explicit whole-document reference clears them',t=>{
  const cases=[
    ['missing',undefined,true],
    ['empty',[],true],
    ['foreign URI',['https://unrelated.example/eli/dl/doc/'+targetId+'-AM-2'],true],
    ['bare fragment',[targetId+'-AM-2'],true],
    ['split component only',[part(1,'unused').id],true],
    ['explicit whole document',['eli/dl/doc/'+targetId],false],
  ];
  for(const [label,references,retain] of cases) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const freshDecision=decision(1,references,'REJECTED');
    if(references===undefined)delete freshDecision.decided_on_a_realization_of;
    const refreshed={...original,decisions:[freshDecision]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    refreshSittingTargets(worker,generation,sitting,refreshed);
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(item.proposedText,'Proposal 1',label);
    assert.equal(item.outcome,retain?'ADOPTED':'unavailable',label);
    assert.equal(item.decisions.length,retain?1:0,label);
    if(retain) {
      assert.equal(item.decisions[0].id,sitting+'-DEC-1',label);
      assert(item.retainedComponents.includes('decisions'),label);
      assert(page.coverage.gaps.some(gap=>gap.includes('retained')),label);
      assert.equal(page.coverage.complete,false,label);
    }
  }
});

test('voting aliases from the exact linked sitting resolve authors on their earlier tabling date',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno G.','Sérgio G.','Former MEP']})]);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[
    {id:'101',givenName:'Bruno',familyName:'Gonçalves'},
    {id:'102',givenName:'Sérgio',familyName:'Gonçalves'},
  ],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
  store.putSource(generation,'amendment:aliases:'+sitting,'amendment-aliases',{aliases:[
    {alias:'Bruno G.',personId:101,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
    {alias:'Sérgio G.',personId:102,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
    {alias:'Former MEP',personId:103,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
  ]},fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.deepEqual(item.authors.map(author=>author.personId),['101','102',null]);
  assert(item.authors.slice(0,2).every(author=>author.method==='official_voting_alias_active_mandate'));
  assert.equal(amendmentsPage(store,{member:'101'}).total,1);
  assert.equal(amendmentsPage(store,{member:'103'}).total,0);
  assert(item.gaps.includes('Some author identities are unresolved.'));
});

test('dated roster pagination keeps its cursor and publishes identities only after a valid terminating page',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves']})]);
  const offsets=[];
  worker.fetchRecord=async(endpoint,params)=>{
    assert.equal(endpoint,'/meps/show-current');assert.equal(params['mandate-date'],tabled);
    offsets.push(params.offset);
    return {fetchedAt,payload:{data:params.offset?[]:[{identifier:'101',givenName:'Bruno',familyName:'Gonçalves'}]}};
  };
  enqueueAmendment(store,generation,'roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
  assert.equal(nextAmendmentTask(store,generation).body.offset,1);
  await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(offsets,[0,1]);
  assert.equal(nextAmendmentTask(store,generation),null);
  const saved=store.source(generation,'amendment:roster:'+tabled);
  assert.equal(saved.work.members[0].id,'101');assert.equal(saved.work.sources.length,2);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].authors[0].personId,'101');
});

test('dated rosters reject duplicate, zero and unsafe identities before accepting a page',async t=>{
  for(const identities of [['101','101'],['0'],['9007199254740993']]) {
    const {store,worker,generation}=setup(t);
    worker.fetchRecord=async()=>({fetchedAt,payload:{data:identities.map(identifier=>({identifier,givenName:'A',familyName:'Member'}))}});
    enqueueAmendment(store,generation,'roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]});
    await assert.rejects(worker.task(nextAmendmentTask(store,generation)),/invalid|repeated/i,identities.join(','));
    assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
    assert.equal(nextAmendmentTask(store,generation).body.offset,0);
  }
});

test('a failed dated roster falls back to exact author profiles and their actual mandate intervals',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves']}),amendment(2,{authors:['Former Member']})]);
  rebuildAmendmentTarget(worker,generation,targetId);
  enqueueAmendment(store,generation,'dated-roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]},114);
  const failed={...nextAmendmentTask(store,generation),attempts:2};
  assert.equal(failAmendmentTask(worker,failed,Object.assign(new Error('EP roster HTTP 500'),{status:500})),true);
  assert.equal(store.get('amendmentMandateFallback'),true);
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    if(endpoint==='/meps') {
      assert.equal(params['parliamentary-term'],10);
      return {fetchedAt,payload:{data:params.offset?[]:[{identifier:'101',givenName:'Bruno',familyName:'Gonçalves'},{identifier:'102',givenName:'Former',familyName:'Member'},{identifier:'103',givenName:'Unrelated',familyName:'Person'}]}};
    }
    assert(['/meps/101','/meps/102'].includes(endpoint));
    const id=endpoint.split('/').at(-1),active=id==='101';
    return {fetchedAt,payload:{data:[{identifier:id,givenName:active?'Bruno':'Former',familyName:active?'Gonçalves':'Member',hasMembership:[{role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16',...(active?{}:{endDate:'2026-09-01'})}},{role:'def/ep-roles/CHAIR',memberDuring:{startDate:'2026-01-01'}}]}]}};
  };
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-members');
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(nextAmendmentTask(store,generation).body.offset,3);
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE kind='amendment-member'").get().n,2);
  for(let n=0;n<2;n++)await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(calls.slice(0,2),[['/meps',0],['/meps',3]]);
  assert(!calls.some(([endpoint])=>endpoint==='/meps/103'));
  const items=amendmentsPage(store,{document:targetId}).items;
  assert.equal(items[0].authors[0].personId,'101');
  assert.equal(items[1].authors[0].personId,null);assert.equal(items[1].authors[0].status,'inactive');
  const evidence=items[0].authors[0].evidence;
  assert(!evidence.some(item=>item.type==='dated_roster'||item.mandateObservedOn));
  const profileEvidence=evidence.find(item=>item.type==='full_name');
  assert.deepEqual(profileEvidence.activeMandate,{start:'2024-07-16',end:null});
  assert.deepEqual(profileEvidence.mandates,[{start:'2024-07-16',end:null}]);
  assert.equal(new URL(profileEvidence.sourceUrl).pathname,'/api/v2/meps/101');
  assert.equal(profileEvidence.fetchedAt,fetchedAt);
  assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
});

test('the same amendment number in different lists retains variants and withholds an arbitrary author or wording',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves'],proposedText:'First wording'})]);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].proposedText,'First wording');
  const revisionListId=targetId+'-AM-001-001';
  const revision=list([amendment(1,{authors:['Sérgio Gonçalves'],proposedText:'Second wording'})],{id:'eli/dl/doc/'+revisionListId,identifier:revisionListId});
  revision.extraction.sourceUrl='https://data.europarl.europa.eu/distribution/example/revision_en.docx';
  store.putSource(generation,'amendment:list:'+revisionListId,'amendment-list',revision,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(page.total,1);assert.equal(item.conflicted,true);
  assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.targetLabel,null);
  assert.equal(item.listId,null);assert.equal(item.language,null);assert.deepEqual(item.authors,[]);
  assert.equal(item.variants.length,2);
  assert.deepEqual(item.variants.map(variant=>variant.proposedText).sort(),['First wording','Second wording']);
  assert.deepEqual(item.variants.map(variant=>variant.listId).sort(),[listId,revisionListId].sort());
  assert.deepEqual(item.variants.flatMap(variant=>variant.authors.map(author=>author.name)).sort(),['Bruno Gonçalves','Sérgio Gonçalves']);
  assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.some(gap=>/variant|conflict/i.test(gap)));
});

test('split failures remain durable across publication and pruning, and a parser upgrade resolves the saved case',async t=>{
  const {store,worker,generation}=setup(t);
  const split=request([part(1,'‘old’')]);
  const parsed=parseSplitRequest(split,{sourceUrl,fetchedAt:earlier});
  saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
  recordSplitResults(store,{...parsed,sourceUrl,fetchedAt:earlier,failures:[{partId:parsed.parts[0].id,description:'‘old’',language:'en',code:'legacy_unsupported',message:'An earlier grammar did not recognise this selector.',sourceUrl,fetchedAt:earlier}]});
  const savedWork={splitRequests:[split],splitParserVersion:SPLIT_PARSER_VERSION-1,sources:[{url:sourceUrl,fetchedAt:earlier}],decisions:[]};
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',savedWork,earlier);
  store.publish(generation);
  for(let n=0;n<2;n++) {const cycle=store.beginCycle();store.publish(cycle.generation);}
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE generation=?').get(generation).n,0);
  let failures=amendmentFailures(store,{status:'unresolved'});
  assert.equal(failures.total,1);assert.equal(failures.items[0].count,1);
  assert.equal(failures.items[0].firstOccurrence,earlier);
  const cycle=store.beginCycle();
  prepareAmendments(worker,cycle);
  const reparse=nextAmendmentTask(store,cycle.generation);
  assert.equal(reparse.kind,'amendment-reparse');
  await worker.task(reparse);
  failures=amendmentFailures(store,{status:'resolved'});
  assert.equal(failures.total,1);assert.equal(failures.unresolved,0);
  assert.equal(failures.items[0].parserVersion,SPLIT_PARSER_VERSION);
  assert.equal(failures.items[0].firstOccurrence,earlier);
  assert.equal(failures.items[0].count,1);
  assert.equal(failures.items[0].sourceUrl,sourceUrl);
  assert(failures.items[0].resolvedAt);
  assert.equal(store.source(cycle.generation,motionSourceKey(sitting)).work.parsedSplits[0].parts[0].status,'parsed');
  const broken=request([part(1,'Unpublished voting instructions')]);broken.id+='-OTHER';
  parseSavedSplits(worker,{splitRequests:[broken],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(amendmentFailures(store,{status:'resolved'}).total,1);
  assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
  assert.equal(amendmentFailures(store,{limit:1}).items.length,1);
  assert.equal(amendmentFailures(store).summary.total,2);
  const reader=new ActivityStore(path.dirname(store.filename));
  try {assert.equal(amendmentFailures(reader).total,2);}finally {reader.close();}
});

test('request-level split parse failures are retained even when the request has no components',t=>{
  const {store,worker}=setup(t);
  const split=request([]);
  const result=parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(result.parsedSplits[0].failures[0].code,'missing_parts');
  const failures=amendmentFailures(store,{status:'unresolved'});
  assert.equal(failures.total,1);
  assert.equal(failures.items[0].requestId,split.id);
  assert.equal(failures.items[0].code,'missing_parts');
  assert.equal(failures.items[0].sourceUrl,sourceUrl);
  parseSavedSplits(worker,{splitRequests:[request([part(1,'‘now published’')])],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(amendmentFailures(store,{status:'unresolved'}).total,0);
  assert.equal(amendmentFailures(store,{status:'resolved'}).total,1);
});

test('repeated unparsed components retain the literal source and first occurrence',t=>{
  const {store,worker,advance}=setup(t);
  const split=request([part(1,'Apply the chairman’s unpublished oral instructions')]);
  parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt:earlier}]});
  advance(1000);
  const nextAt='2026-10-16T17:00:01.000Z';
  parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt:nextAt}]});
  const failure=amendmentFailures(store).items[0];
  assert.equal(failure.status,'unresolved');assert.equal(failure.count,2);
  assert.equal(failure.description,'Apply the chairman’s unpublished oral instructions');
  assert.equal(failure.rawDescription,split.created_a_realization_of[0].expressionContent.en);
  assert.equal(failure.firstOccurrence,earlier);assert.equal(failure.lastOccurrence,nextAt);
  assert.match(failure.sourceDescriptionHash,/^[a-f0-9]{64}$/);
});

test('amendment work has durable retries without changing legacy task progress or blocking its publication',t=>{
  const {store,generation,advance}=setup(t);
  store.enqueue(generation,'ordinary','document',{},10);
  const expected={total:1,completed:0,retrying:0};
  enqueueAmendment(store,generation,'amendment:one','amendment-extract',{listId},50);
  assert.deepEqual({...store.taskCounts(generation)},expected);
  let task=nextAmendmentTask(store,generation);
  assert(task.amendmentJob);assert.equal(task.key,'amendment:one');
  store.taskProgress(task,{listId,offset:10});
  task=nextAmendmentTask(store,generation);assert.equal(task.body.offset,10);
  store.failTask(task,new Error('Temporary amendment source failure'));
  assert.equal(nextAmendmentTask(store,generation),null);
  assert.deepEqual({...store.taskCounts(generation)},expected);
  advance(31_000);
  task=nextAmendmentTask(store,generation);assert.equal(task.attempts,1);
  store.finishTask(store.nextTask(generation));
  store.publish(generation);
  assert.equal(store.get('active'),generation);
  const next=store.beginCycle();
  const resumed=nextAmendmentTask(store,next.generation);
  assert.equal(resumed.body.offset,10);assert.equal(resumed.attempts,1);
  store.finishTask(resumed);assert.equal(nextAmendmentTask(store,next.generation),null);
});

test('report-only sittings refresh stale outcomes using recent and older sitting cache lifetimes',t=>{
  const cases=[
    [sitting,5*60*60_000,false],
    [sitting,7*60*60_000,true],
    ['MTG-PL-2026-09-01',6*24*60*60_000,false],
    ['MTG-PL-2026-09-01',8*24*60*60_000,true],
  ];
  for(const [sittingId,age,refresh] of cases) {
    const {store,worker,generation}=setup(t);
    const work={...target,inverse_based_on_a_realization_of:['eli/dl/event/'+sittingId+'-VOT-ITM-123']};
    store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',completeSitting(sittingId),new Date(Date.parse(fetchedAt)-age).toISOString());
    scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
    const jobs=outcomeJobs(store,generation);
    assert.equal(jobs.length,refresh?1:0,sittingId+' age '+age);
    if(refresh) {
      assert.equal(jobs[0].key,motionSourceKey(sittingId)+':2026-10-16');
      assert.equal(JSON.parse(jobs[0].body).sittingId,sittingId);
      assert.equal(JSON.parse(jobs[0].body).stage,'results');
    }
  }
});

test('incomplete report sitting caches are refreshed even when their retrieval timestamp is fresh',t=>{
  const cases=[
    {truncated:true},
    {lastRefreshFailure:{attemptedAt:earlier}},
    {coverage:{missingResultIds:['eli/dl/event/missing-result'],missingDecisionIds:[]}},
    {coverage:{missingResultIds:[],missingDecisionIds:['eli/dl/event/missing-decision']}},
    {amendmentVersion:0},
    {splitRequests:null},
    {results:[]},
    {decisions:[]},
  ];
  for(const incomplete of cases) {
    const {store,worker,generation}=setup(t);
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),...incomplete},fetchedAt);
    scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
    assert.equal(outcomeJobs(store,generation).length,1,JSON.stringify(incomplete));
  }
});

test('reports and motions reuse one sitting refresh and do not repeat a completed attempt on the same day',t=>{
  const {store,worker,generation}=setup(t);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,{...target,identifier:otherTarget,id:'eli/dl/doc/'+otherTarget,work_type:'def/ep-document-types/RESOLUTION_MOTION'});
  let jobs=outcomeJobs(store,generation);
  assert.equal(jobs.length,1);assert.equal(jobs[0].key,motionSourceKey(sitting)+':2026-10-16');
  store.finishTask(jobs[0]);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,target);
  jobs=outcomeJobs(store,generation);
  assert.equal(jobs.length,1);assert.equal(jobs[0].done,1);
});

test('an existing sitting task under an older amendment key preserves its pagination and retry state',t=>{
  const {store,worker,generation}=setup(t);
  const key=motionSourceKey(sitting)+':amendments:2026-10-15';
  const body={sittingId:sitting,stage:'decisions',offset:1000,results:[{id:'saved-result'}],decisions:[{id:'saved-decision'}],splits:[{id:'saved-split'}],sources:[{url:sourceUrl,fetchedAt:earlier}]};
  store.enqueue(generation,key,'motion-outcomes',body,113);
  store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(Date.parse(fetchedAt)+60_000,'Retained upstream failure',generation,key);
  const before=outcomeJobs(store,generation);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,target);
  assert.deepEqual(outcomeJobs(store,generation),before);
  assert.deepEqual(JSON.parse(outcomeJobs(store,generation)[0].body),body);
});

test('candidate workers recover retained amendment rows and cursors after a legacy worker advances core generations',t=>{
  for(const legacyCreatedWorking of [false,true]) {
    const {store,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    saveAmendmentRows(store,generation,metadata,[row(1,{proposedText:'Accepted before rollback'})],coverage);
    enqueueAmendment(store,generation,'roster-cursor','amendment-roster',{date:tabled,offset:1000,members:[{id:'101'}],sources:[]});
    store.db.prepare('UPDATE amendment_jobs SET attempts=2,error=? WHERE generation=? AND key=?').run('Retained retry',generation,'roster-cursor');
    recordSplitResults(store,parseSplitRequest(request([part(1,'Unpublished instructions')]),{sourceUrl,fetchedAt}));
    store.publish(generation);
    // The released worker knows only core tables. Its cycle advances metadata
    // and copies sources without touching the additive amendment tables.
    store.db.prepare('INSERT INTO sources SELECT 2,key,kind,body,fetched_at,1 FROM sources WHERE generation=?').run(generation);
    const setMeta=store.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)');
    setMeta.run('active','2');setMeta.run('sequence','2');setMeta.run('previous',JSON.stringify(generation));
    if(legacyCreatedWorking) {
      store.db.prepare('INSERT INTO sources SELECT 3,key,kind,body,fetched_at,0 FROM sources WHERE generation=2').run();
      setMeta.run('sequence','3');
      setMeta.run('working',JSON.stringify({generation:3,initial:false,startedAt:earlier,phase:'discovering',requests:7,legacyCheckpoint:'retained'}));
    }
    const before=amendmentsPage(store,{document:targetId});
    assert.equal(before.coverage.servingGeneration,generation);
    assert.equal(before.items[0].proposedText,'Accepted before rollback');
    assert.equal(store.status().amendments.indexed,1);
    const recovered=store.beginCycle();
    assert.equal(recovered.generation,3);
    if(legacyCreatedWorking) {assert.equal(recovered.requests,7);assert.equal(recovered.legacyCheckpoint,'retained');}
    const after=amendmentsPage(store,{document:targetId});
    assert.equal(after.coverage.servingGeneration,3);
    assert.equal(after.items[0].proposedText,'Accepted before rollback');
    const job=nextAmendmentTask(store,3);
    assert.equal(job.key,'roster-cursor');assert.equal(job.body.offset,1000);
    assert.equal(job.attempts,2);assert.equal(job.error,'Retained retry');
    assert.deepEqual(job.body.members,[{id:'101'}]);
    assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
    store.publish(3);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE generation=?').get(generation).n,0);
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].proposedText,'Accepted before rollback');
    assert.equal(nextAmendmentTask(store,3).body.offset,1000);
    assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
  }
});

// A minimal real DOCX exercises extraction during a worker refresh without
// downloading any corpus or replacing the parser with an implementation stub.
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
function comparisonDocx(rows,{author='Bruno Gonçalves',language='en'}={}) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const tableRow=cells=>'<w:tr>'+cells.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  return docx('<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>1</NumAm>')+(author?paragraph('<Members>'+author+'</Members>'):'')+paragraph('<Article>Article 1</Article>')+'<w:tbl>'+tableRow(['Text proposed by the Commission',language==='fr'?'Amendement':'Amendment'])+rows.map(tableRow).join('')+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>');
}

test('losing a comparison row within the same amendment retains its full accepted columns and source date',async t=>{
  const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
  const oldUrl='https://data.europarl.europa.eu/distribution/example/accepted_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_en.docx';
  const accepted=extractAmendments(comparisonDocx([['Before one','After one'],['Before two','After two']]),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
  const degraded=comparisonDocx([['Changed one','Changed proposal one'],['Before two','After two','Unsupported extra column']]);
  const fresh=extractAmendments(degraded,{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:newUrl,fetchedAt});
  assert.equal(fresh.amendments[0].number,1);assert.equal(fresh.amendments[0].proposedText,null);
  assert(fresh.gaps.some(gap=>gap.code==='comparison-columns'&&gap.number===1));
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...accepted,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
  worker.downloadAmendmentDocx=async()=>({buffer:degraded});
  enqueueAmendment(store,generation,'degraded-comparison','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const saved=store.source(generation,'amendment:list:'+singleListId);
  assert.equal(saved.fetchedAt,earlier);assert.equal(saved.work.extraction.fetchedAt,earlier);
  assert.equal(saved.work.extraction.sourceUrl,oldUrl);
  assert.equal(saved.work.extraction.amendments[0].originalText,'Before one\nBefore two');
  assert.equal(saved.work.extraction.amendments[0].proposedText,'After one\nAfter two');
  assert.equal(saved.work.extraction.lastRefreshFailure.attemptedAt,fetchedAt);
  assert.equal(saved.work.extraction.lastRefreshFailure.sourceUrl,newUrl);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.originalText,'Before one\nBefore two');assert.equal(item.proposedText,'After one\nAfter two');
  assert(item.sources.some(source=>source.url===oldUrl&&source.fetchedAt===earlier));
});

test('a failed v3 parse cannot resurrect structurally incomplete wording cached by extractor v2',async t=>{
  const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
  const oldUrl='https://data.europarl.europa.eu/distribution/example/partial_v2_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_v3_en.docx';
  const structuralGap={code:'comparison-columns',number:1,message:'A comparison row does not contain exactly two columns.',sourceUrl:oldUrl};
  const cached=amendment(1,{originalText:'Cached first row only',proposedText:'Cached proposed first row only'});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{amendments:[cached],gaps:[structuralGap],sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'2'}},earlier);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:cached.originalText,proposedText:cached.proposedText,splitParts:[],sources:[{url:oldUrl,fetchedAt:earlier}]})],{...coverage,complete:false});
  const damaged=comparisonDocx([['Fresh first row','Fresh proposed first row'],['Unsupported second row','Second proposal','Extra column']]);
  worker.downloadAmendmentDocx=async()=>({buffer:damaged});
  enqueueAmendment(store,generation,'v2-to-v3','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const saved=store.source(generation,'amendment:list:'+singleListId);
  assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(saved.work.extraction.amendments[0].originalText,null);assert.equal(saved.work.extraction.amendments[0].proposedText,null);
  assert(saved.work.extraction.gaps.some(gap=>gap.code==='comparison-columns'));
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(item.originalText,null);assert.equal(item.proposedText,null);
  assert.equal(item.textIntegrity,'incomplete');
  assert.equal(page.coverage.complete,false);
});

test('missing authors or non-English text alone do not reject otherwise complete refreshed columns',async t=>{
  for(const options of [{author:null,language:'en'},{author:'Bruno Gonçalves',language:'fr'}]) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/accepted_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_'+options.language+'.docx';
    const accepted=extractAmendments(comparisonDocx([['Before one','After one'],['Before two','After two']]),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    const complete=comparisonDocx([['Fresh original one','Fresh proposal one'],['Fresh original two','Fresh proposal two']],options);
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:options.language,url:newUrl}],extraction:{...accepted,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
    worker.downloadAmendmentDocx=async()=>({buffer:complete});
    enqueueAmendment(store,generation,'complete-comparison','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const saved=store.source(generation,'amendment:list:'+singleListId);
    assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.sourceUrl,newUrl);
    assert.equal(saved.work.extraction.lastRefreshFailure,undefined);
    assert.equal(saved.work.extraction.amendments[0].originalText,'Fresh original one\nFresh original two');
    assert.equal(saved.work.extraction.amendments[0].proposedText,'Fresh proposal one\nFresh proposal two');
    assert.equal(saved.work.extraction.amendments[0].language,options.language);
    if(!options.author)assert(saved.work.extraction.gaps.some(gap=>gap.code==='authors-unavailable'));
    if(options.language==='fr')assert(amendmentsPage(store,{document:targetId}).items[0].gaps.some(gap=>gap.includes('English amendment text is unavailable')));
  }
});

test('a partial extraction refresh retains accepted wording and dates and reports the failed refresh',async t=>{
  const {store,worker,generation}=setup(t);
  const file={format:'DOCX',language:'en',url:'https://data.europarl.europa.eu/distribution/example/amendments_en.docx'};
  seedTarget(store,generation,[amendment(1),amendment(2)]);
  const previous=store.source(generation,'amendment:list:'+listId).work;
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',{...previous,files:[file]},earlier);
  let downloads=0;
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,file.url);downloads++;return {buffer:docx('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>&lt;Amend&gt;&lt;Date&gt;2.10.2026&lt;/Date&gt;&lt;NumAm&gt;1&lt;/NumAm&gt;</w:t></w:r></w:p><w:p><w:r><w:t>&lt;/Amend&gt;</w:t></w:r></w:p></w:body></w:document>')};};
  enqueueAmendment(store,generation,'partial','amendment-extract',{listId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);
  const accepted=store.source(generation,'amendment:list:'+listId);
  assert.equal(accepted.fetchedAt,earlier);
  assert.deepEqual(accepted.work.extraction.amendments.map(item=>item.number),[1,2]);
  assert.deepEqual(accepted.work.extraction.lastRefreshFailure.missingAmendmentNumbers,['2']);
  const page=amendmentsPage(store,{document:targetId});
  assert.deepEqual(page.items.map(item=>item.proposedText),['Proposal 1','Proposal 2']);
  assert(page.coverage.gaps.some(gap=>/refresh|partial|extract/i.test(gap)));
  assert.equal(page.coverage.complete,false);
});

test('partial amendment refreshes retain accepted rows while the activity generation is still building',t=>{
  const {store,generation}=setup(t);
  saveAmendmentRows(store,generation,metadata,[row(1,{proposedText:'Accepted one'}),row(2,{proposedText:'Accepted two'})],coverage);
  store.publish(generation);
  const next=store.beginCycle();
  saveAmendmentRows(store,next.generation,metadata,[row(1,{proposedText:'Refreshed one'})],{...coverage,complete:false,gaps:['A source is unavailable.']});
  enqueueAmendment(store,next.generation,'pending','amendment-extract',{listId});
  const page=amendmentsPage(store,{document:targetId,language:'fr'});
  assert.equal(page.coverage.servingGeneration,next.generation);
  assert.equal(page.coverage.pending,true);assert.equal(page.coverage.complete,false);
  assert.deepEqual(page.items.map(item=>item.proposedText),['Refreshed one','Accepted two']);
  assert(page.items.every(item=>item.title==='Un rapport public'));
  store.finishTask(nextAmendmentTask(store,next.generation));
  store.publish(next.generation);
  const updated=amendmentsPage(store,{document:targetId});
  assert.equal(updated.total,2);
  assert.equal(updated.items[1].proposedText,'Accepted two');
  assert(updated.items[1].gaps.some(gap=>gap.includes('latest partial refresh')));
  assert.equal(updated.coverage.complete,false);
});

test('a same-ID incomplete refresh retains accepted components while an explicit empty legal cell remains valid',t=>{
  const {store,generation}=setup(t);
  const accepted=row(1,{originalText:'Before',proposedText:'After',targetLabel:'Article 1',language:'en',authors:[{name:'Bruno G.',personId:'101',status:'resolved'}],decisions:[{id:sitting+'-DEC-1',outcome:'ADOPTED'}],sources:[{url:sourceUrl,fetchedAt:earlier}]});
  saveAmendmentRows(store,generation,metadata,[accepted],coverage);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:null,proposedText:null,authors:[{name:'Bruno G.',personId:null,status:'missing'}],sources:[]})],{...coverage,complete:false,gaps:['A source is unavailable.']});
  let page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].originalText,'Before');assert.equal(page.items[0].proposedText,'After');
  assert.equal(page.items[0].authors[0].personId,'101');
  assert.equal(page.items[0].outcome,'ADOPTED');
  assert(page.items[0].sources.some(source=>source.url===sourceUrl&&source.fetchedAt===earlier));
  assert.equal(page.coverage.complete,false);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:'',proposedText:'Inserted wording',sources:[]})],coverage);
  page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].originalText,'');
  assert.equal(page.items[0].proposedText,'Inserted wording');
});

test('fresh conflicting or inactive author evidence clears an accepted link while missing evidence retains its history',t=>{
  const name='Alex Common',active={id:'101',givenName:'Alex',familyName:'Common',mandates:[{start:'2024-07-16',end:null}]};
  const resolve=members=>resolveAmendmentAuthors([name],{members,date:tabled}).map(author=>({...author,personId:author.personId==null?null:String(author.personId)}));
  const cases=[
    ['ambiguous',[active,{...active,id:'102'}],false],
    ['inactive',[{...active,mandates:[{start:'2024-07-16',end:'2026-09-01'}]}],false],
    ['missing',[],true],
    ['missing_mandate',[{...active,mandates:[]}],true],
  ];
  for(const [status,members,retain] of cases) {
    const {store,generation}=setup(t);
    saveAmendmentRows(store,generation,metadata,[row(1,{authors:resolve([active])})],coverage);
    assert.equal(amendmentsPage(store,{member:'101'}).total,1);
    const fresh=resolve(members);assert.equal(fresh[0].status,status);
    saveAmendmentRows(store,generation,metadata,[row(1,{authors:fresh})],{...coverage,complete:false});
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.authors[0].personId,retain?'101':null,status);
    assert.equal(amendmentsPage(store,{member:'101'}).total,retain?1:0,status);
    if(retain) {
      assert.equal(item.authors[0].latestResolution.status,status);
      assert(item.retainedComponents.includes('author identity'));
    } else {
      assert.equal(item.authors[0].status,status);
      assert.deepEqual(item.authors[0].evidence,fresh[0].evidence);
    }
  }
});

test('split failure and amendment writes require the existing index writer lease',t=>{
  const {store,generation}=setup(t);
  const result=parseSplitRequest(request([part(1,'Unpublished instructions')]),{sourceUrl,fetchedAt});
  store.release();
  assert.throws(()=>recordSplitResults(store,result),/writer lease/);
  assert.throws(()=>saveAmendmentRows(store,generation,metadata,[row(1)],coverage),/writer lease/);
  assert.equal(amendmentFailures(store).total,0);
  assert.equal(amendmentsPage(store).total,0);
});

test('empty pages explicitly report missing coverage and never imply an amendment count of zero is complete',t=>{
  const {store}=setup(t);
  const all=amendmentsPage(store),specific=amendmentsPage(store,{document:targetId});
  assert.equal(all.total,0);assert.equal(all.coverage.complete,false);
  assert(all.coverage.gaps.includes('Amendment discovery is incomplete.'));
  assert.equal(specific.coverage.complete,false);
  assert(specific.coverage.gaps.includes('This document has no indexed amendment records.'));
  assert.equal(amendmentOutcome([]),'unavailable');
  assert.equal(amendmentOutcome([{outcome:'ADOPTED'},{outcome:'unavailable'}]),'unavailable');
});

test('amendment discovery accepts only explicit list and target relationships',t=>{
  const {store,worker,generation}=setup(t);
  const linked={...list([]),foresees_change_of:[target.id]};
  const wrong={...linked,identifier:'A-10-2026-9999-AM-001-004',foresees_change_of:['eli/dl/doc/A-10-2026-9999']};
  const ambiguous={...linked,identifier:'A-10-2026-9998-AM-001-004',foresees_change_of:[]};
  const work={...target,inverse_foresees_change_of:[linked,wrong,ambiguous,'eli/dl/doc/'+listId]};
  assert.deepEqual(amendmentLists(work).map(item=>item.identifier),[listId]);
  store.putSource(generation,'/plenary-documents/'+targetId,'document',work,fetchedAt);
  scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
  const jobs=store.db.prepare("SELECT body FROM amendment_jobs WHERE kind='amendment-extract'").all().map(job=>JSON.parse(job.body));
  assert.equal(jobs.length,1);assert.equal(jobs[0].listId,listId);
  assert.equal(amendmentReference('eli/dl/doc/'+targetId+'-AM-0'),null);
  assert.equal(amendmentReference('eli/dl/doc/'+targetId+'-AM-001-004'),null);
  assert.equal(amendmentReference('https://unrelated.example/eli/dl/doc/'+targetId+'-AM-1'),null);
  assert.equal(amendmentReference('eli/dl/event/'+targetId+'-AM-1'),null);
});

test('the published amendment-list processing limit remains an explicit gap after later target rebuilds',t=>{
  const {store,worker,generation}=setup(t);
  const publishedLists=Array.from({length:65},(_,index)=>{
    const number=index+1,padded=String(number).padStart(3,'0'),id=targetId+'-AM-'+padded+'-'+padded;
    const url='https://data.europarl.europa.eu/distribution/example/amendment-'+number+'_en.docx';
    return {id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:tabled,foresees_change_of:[target.id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]};
  });
  const work={...target,inverse_foresees_change_of:publishedLists};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',work,fetchedAt);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
  for(const [index,published] of publishedLists.slice(0,64).entries()) {
    const stored={...published,targetDocumentId:targetId,extraction:{amendments:[amendment(index+1,{authors:['Alex Common']})],gaps:[],language:'en',sourceUrl:published.is_realized_by[0].is_embodied_by[0].is_exemplified_by,fetchedAt:earlier,parserVersion:AMENDMENT_EXTRACTION_VERSION}};
    store.putSource(generation,'amendment:list:'+published.identifier,'amendment-list',stored,earlier);
  }
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{amendmentVersion:AMENDMENTS_VERSION,splitRequests:[],parsedSplits:[],sources:[{url:sourceUrl.replace('/vote-results?','/decisions?'),fetchedAt}],decisions:[decision(1,Array.from({length:64},(_,index)=>'eli/dl/doc/'+targetId+'-AM-'+(index+1)),'ADOPTED')]},fetchedAt);
  store.putSource(generation,'amendment:aliases:'+sitting,'amendment-aliases',{aliases:[]},fetchedAt);
  scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
  let page=amendmentsPage(store,{document:targetId});
  assert.equal(page.total,64);assert.equal(page.coverage.pending,false);
  assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('This target exceeds the amendment-list processing limit.'));
  rebuildAmendmentTarget(worker,generation,targetId);
  page=amendmentsPage(store,{document:targetId});
  assert.equal(page.coverage.pending,false);assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('This target exceeds the amendment-list processing limit.'));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE generation=? AND kind='amendment-list'").get(generation).n,64);
});

test('amendment and failure queries reject unsupported, repeated, malformed and unbounded inputs',()=>{
  const valid=amendmentQuery(new URLSearchParams({document:targetId,procedure:'2025-0233',member:'101',outcome:'mixed',lang:'fr',limit:'50',offset:'10'}));
  assert.equal(valid.document,targetId);assert.equal(valid.member,'101');assert.equal(valid.language,'fr');
  for(const query of ['document='+targetId+'&document='+targetId,'unknown=x','document='+targetId+'-AM-1','document=A-9-2024-0254','procedure=2025/0233','member=0','member=9007199254740993','outcome=adopted','limit=0','limit=51','limit=1.5','limit=01','offset=-1','offset=1000001','lang=not-a-language']) {
    assert.throws(()=>amendmentQuery(new URLSearchParams(query)),error=>error.status===400,query);
  }
  assert.equal(amendmentQuery(new URLSearchParams('status=unresolved&limit=1'),{failures:true}).status,'unresolved');
  for(const query of ['status=bogus','status=all&status=all','document='+targetId])assert.throws(()=>amendmentQuery(new URLSearchParams(query),{failures:true}),error=>error.status===400,query);
});

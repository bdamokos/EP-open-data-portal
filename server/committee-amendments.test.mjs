import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';
import {projectProcedure,projectDocument} from './activity-index-model.mjs';
import {committeeAmendmentReference,committeeDiscoveryReferences,committeeTargetRelationship,committeeProcedureIds} from './committee-amendments.mjs';
import {prepareCommitteeList,scheduleCommitteeDiscovery,prepareCommitteeAmendments} from './committee-amendments-worker.mjs';
import {amendmentTask,rebuildAmendmentTarget} from './amendments-worker.mjs';
import {amendmentById,amendmentsPage,amendmentContributors,amendmentProcedureTargets,saveAmendmentRows,nextAmendmentTask,enqueueAmendment,amendmentReadVersion,committeeAmendmentIndexVersion} from './amendments-store.mjs';
import {amendmentReference,amendmentQuery,currentDocxDescriptor,amendmentProposerDate} from './amendments.mjs';
import {extractAmendments,AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {topicAmendments} from './topic-involvement.mjs';
import {DossierActivity,dossierActivityQuery} from './dossier-activity.mjs';
import {DocumentContext,documentContextQuery} from './document-context.mjs';
import {humanSourceUrl} from './source-links.mjs';
import {documentDetailEndpoint,documentRouteOwned,documentRouteDeferredOwners} from './document-detail-routing.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';
import {createInsights} from './insights.mjs';
import {yearCatalogue} from './test-support/catalogue-fixture.mjs';
import {alternateAuthorDescriptor} from './amendment-author-names.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/committee-amendments.json',import.meta.url)));
const at='2026-10-30T08:40:00.000Z',day='2025-05-20';
const doc=id=>structuredClone(fixture.documents.find(item=>item.work.identifier===id).work);
const proc=id=>structuredClone(fixture.procedures.find(item=>item.process_id===id));
// ZIP only the attributable first-block excerpts, never download a corpus.
function archive(entry) {
  const locals=[],directory=[];let offset=0;
  for(const [filename,xml] of [['word/document.xml',entry.documentXml],['word/styles.xml',entry.stylesXml]]) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
function setup(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'committee-amendments-')),store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());const {generation}=store.beginCycle();const calls=[];
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),runUpstream:unthrottledUpstream,fetchRecord:async(endpoint,params)=>{
    calls.push([endpoint,params]);const work=endpoint.startsWith('/procedures/')?proc(endpoint.split('/').at(-1)):doc(endpoint.split('/').at(-1));
    assert(work,'Unexpected public source '+endpoint);return {payload:{data:[work]},fetchedAt:at};
  },downloadAmendmentDocx:async url=>{const entry=fixture.documents.find(entry=>entry.docxUrl===url);assert(entry,'Unrequested distribution');return {buffer:archive(entry),resolvedSourceUrl:url};},extractAmendmentList:async(buffer,options)=>({...extractAmendments(buffer,options),parserVersion:AMENDMENT_EXTRACTION_VERSION,...options})});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,generation,calls,directory};
}
function roster(x,date=day,members=[{id:'100',givenName:'Martin',familyName:'Häusling'},{id:'200',givenName:'David',familyName:'Cormand'}]) {
  x.store.putSource(x.generation,'amendment:roster:'+date,'amendment-roster',{members,sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:at}]},at);
}
function seed(x,id='AGRI-AM-773343',{authors=['Martin Häusling'],date=day,number=51,procedures=['2024-0318']}={}) {
  const work=doc(id);work.document_date=date;
  work.inverse_created_a_realization_of=procedures.map(id=>'eli/dl/proc/'+id);
  x.store.putSource(x.generation,'/documents/'+id,'document',projectDocument(work),at);
  prepareCommitteeList(x.worker,x.generation,work,at,'/documents/'+id,{rebuild:rebuildAmendmentTarget});
  const saved=x.store.source(x.generation,'amendment:list:'+id).work;
  saved.extraction={amendments:[{number,authors,date,documentDate:date,dateBasis:'amendment-list-document',targetLabel:'Recital 1',originalText:'Existing wording',proposedText:'New wording',language:'en',gaps:[]}],gaps:[],language:'en',sourceUrl:currentDocxDescriptor(saved).url,sourceDescriptor:currentDocxDescriptor(saved),fetchedAt:at,parserVersion:AMENDMENT_EXTRACTION_VERSION};
  x.store.putSource(x.generation,'amendment:list:'+id,'amendment-list',saved,at);
  rebuildAmendmentTarget(x.worker,x.generation,saved.scopeKey);
  return saved;
}

test('public AGRI/IMCO native list excerpts keep cover dates, bylines and the Commission baseline; drafts have no individual bylines',()=>{
  for(const entry of fixture.documents.filter(entry=>entry.documentXml)) {
    const id=entry.work.identifier,isList=id.includes('-AM-');
    const parsed=extractAmendments(archive(entry),{scope:'committee',sourceKind:isList?'amendment-list':id.includes('-PR-')?'draft-report':'draft-opinion',listId:id,targetDocumentId:entry.work.foresees_change_of?.split('/').at(-1)||null,language:'en',sourceUrl:entry.docxUrl,fetchedAt:at});
    assert.equal(parsed.amendments.length,1,id);
    const amendment=parsed.amendments[0];assert.equal(amendment.date,entry.work.document_date,id);assert.equal(amendment.baseline,'commission-proposal',id);
    assert.equal(amendment.authors.length,isList?1:0,id);
    assert.equal(amendment.number,id==='AGRI-AM-773343'?51:id==='IMCO-AM-772127'?40:1,id);
    assert.equal(typeof amendment.originalText,'string');assert.equal(typeof amendment.proposedText,'string');
  }
  const entry=structuredClone(fixture.documents.find(entry=>entry.work.identifier==='AGRI-AM-773343'));
  entry.documentXml=entry.documentXml.replace('&lt;NumAm&gt;','&lt;Date&gt;20.5.2025&lt;/Date&gt;&lt;Date&gt;21.5.2025&lt;/Date&gt;&lt;NumAm&gt;');
  const [conflicting]=extractAmendments(archive(entry),{scope:'committee',sourceKind:'amendment-list',listId:entry.work.identifier,language:'en'}).amendments;
  assert.equal(conflicting.proposerDateConflict,true);assert.equal(amendmentProposerDate({...conflicting,listDocumentDate:day}),null,'A conflicting explicit date cannot fall back to the metadata date');
});

test('procedure and inverse draft discovery include opinion lists and targetless joint lists through the single bounded queue',async t=>{
  const x=setup(t);
  for(const id of ['2024-0318','2025-0176']) {
    const work=projectProcedure(proc(id));x.store.putSource(x.generation,'/procedures/'+id,'procedure',work,at);
    scheduleCommitteeDiscovery(x.worker,x.generation,work,at,'/procedures/'+id);
  }
  assert(!committeeDiscoveryReferences(proc('2024-0318')).some(ref=>ref.id==='IMCO-AM-772127'));
  for(let n=0;n<100;n++) {
    const row=x.store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND done=0 AND kind NOT IN ('amendment-extract','amendment-roster') ORDER BY priority DESC,key DESC LIMIT 1").get(x.generation);
    if(!row)break;
    await x.worker.task({...row,body:JSON.parse(row.body),amendmentJob:true});
    assert(n<99,'Discovery must settle without a relationship loop');
  }
  const targets=amendmentProcedureTargets(x.store,'2024-0318',{scope:'committee'});
  assert.deepEqual(targets.map(target=>target.listId).sort(),['AGRI-AM-773343','IMCO-AM-772127']);
  assert.equal(targets.find(target=>target.listId==='IMCO-AM-772127').committeeDocumentKind,'draft-opinion');
  for(const target of amendmentProcedureTargets(x.store,'2025-0176',{scope:'committee'})) {
    assert.equal(target.targetDocumentId,null);assert.equal(target.targetRelationship.status,'unavailable');
    assert.deepEqual(target.committees,[{code:'CJ61'}]);
  }
  assert.equal(x.calls.filter(([url])=>url==='/documents/IMCO-AM-772127').length,1);
  assert(!x.calls.some(([url])=>url==='/committee-documents/IMCO-AM-772127'));
  assert(!x.store.db.prepare("SELECT 1 FROM amendment_jobs WHERE kind='amendment-extract' AND json_extract(body,'$.listId') LIKE '%-P_-%'").get());
});

test('committee identity and selection stay list scoped across stages and leave plenary validators narrow',t=>{
  const x=setup(t);roster(x);seed(x);
  seed(x,'IMCO-AM-772127',{authors:['Martin Häusling'],number:51});
  const target={id:'A-10-2025-0153',procedureIds:['2024-0318']};
  saveAmendmentRows(x.store,x.generation,target,[{id:target.id+'-AM-51',targetDocumentId:target.id,number:51,documentDate:day,authors:[{personId:'100',status:'resolved'}],procedureIds:['2024-0318'],gaps:[]}],{complete:false});
  assert.equal(amendmentsPage(x.store).total,1);
  const page=amendmentsPage(x.store,{scope:'committee',procedure:'2024-0318',member:'100'});assert.equal(page.total,2);
  assert.equal(amendmentsPage(x.store,amendmentQuery(new URLSearchParams({scope:'committee',list:'AGRI-AM-773343',document:'AGRI-PR-773115',procedure:'2024-0318',committee:'AGRI',member:'100'}))).total,1);
  assert.equal(new Set(page.items.map(item=>item.id)).size,2);assert(page.items.every(item=>item.officialIds.length===0));
  assert.equal(amendmentById(x.store,{document:'AGRI-PR-773115',id:'committee:AGRI-AM-773343:51'}).listId,'AGRI-AM-773343');
  assert.equal(amendmentById(x.store,{document:'IMCO-PA-770204',id:'committee:AGRI-AM-773343:51'}),null);
  assert.equal(amendmentReference('eli/dl/doc/committee:AGRI-AM-773343:51'),null);
  assert.equal(committeeAmendmentReference('committee:AGRI-AM-773343:051'),null);
  assert.equal(amendmentQuery(new URLSearchParams('scope=committee&list=CJ61-AM-778402')).scope,'committee');
  assert.throws(()=>amendmentQuery(new URLSearchParams('list=CJ61-AM-778402')),error=>error.status===400);
  assert.deepEqual(committeeProcedureIds({inverse_created_a_realization_of:['https://unrelated.example/2024-0318','eli/dl/proc/2024-0318']}),['2024-0318']);
});

test('dated attribution excludes a mandate boundary and checks a conflicting tabling date independently',t=>{
  const x=setup(t);roster(x);const list=seed(x);
  const key='amendment:list:'+list.identifier;
  list.procedureEvidence=[{activityType:'COMMITTEE_TABLING_AMENDMENT',date:'2025-05-21'}];
  x.store.putSource(x.generation,key,'amendment-list',list,at);rebuildAmendmentTarget(x.worker,x.generation,list.scopeKey);
  assert.equal(amendmentsPage(x.store,{scope:'committee',member:'100'}).total,0);
  roster(x,'2025-05-21',[{id:'999',givenName:'Other',familyName:'Person'}]);rebuildAmendmentTarget(x.worker,x.generation,list.scopeKey);
  assert.equal(amendmentsPage(x.store,{scope:'committee',member:'100'}).total,0);
  roster(x,'2025-05-21');rebuildAmendmentTarget(x.worker,x.generation,list.scopeKey);
  assert.equal(amendmentsPage(x.store,{scope:'committee',member:'100'}).total,1);
  assert.equal(amendmentContributors(x.store,{procedures:['2024-0318'],asOf:day}).items.length,0,'Later tabling is outside a historical sitting');
  list.procedureEvidence.push({activityType:'COMMITTEE_TABLING_AMENDMENT',date:'2025-05-22'});
  x.store.putSource(x.generation,key,'amendment-list',list,at);rebuildAmendmentTarget(x.worker,x.generation,list.scopeKey);
  assert.equal(amendmentsPage(x.store,{scope:'committee',member:'100'}).total,0);
});

test('exact dossier contributors are discovered before agenda people, respect historical cutoffs and remain read only',async t=>{
  const x=setup(t);roster(x);seed(x);roster(x,'2025-04-11');seed(x,'IMCO-AM-772127',{authors:['Martin Häusling'],date:'2025-04-11',number:40});
  const before=x.store.get('amendmentMutationRevision');
  x.store.db.exec('PRAGMA query_only=ON');
  const earlier=topicAmendments(x.store,[],[],{procedureIds:['2024-0318'],asOf:'2025-04-30'});
  assert.deepEqual(earlier.authorIds,['100']);assert.equal(earlier.countsByStage['100'].committee,1);assert.equal(earlier.countsByStage['100'].plenary,null);assert.equal(earlier.authorDates['100'],'2025-04-11');
  assert.equal(topicAmendments(x.store,[],[],{procedureIds:['2025-0176'],asOf:day}).authorIds.length,0);
  const work=proc('2024-0318'),reader={record:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[work]}})};
  const result=await new DossierActivity(x.store,{reader}).query(dossierActivityQuery(new URLSearchParams({reference:work.label,section:'roles'})));
  const person=result.participants.find(person=>person.id==='100');assert(person);assert.equal(person.amendmentCounts.committee,2);assert.equal(person.amendments.length,2);assert.equal(person.roles.length,0);
  const selected=await new DossierActivity(x.store,{reader}).query(dossierActivityQuery(new URLSearchParams({reference:work.label,section:'amendments',member:'100',stage:'committee',committee:'IMCO'})));
  assert.equal(selected.items.length,1);assert.equal(selected.items[0].amendment.listId,'IMCO-AM-772127');
  assert.equal(x.store.get('amendmentMutationRevision'),before);
});

test('contributor continuation and source mutation revision survive a prepared reopen',t=>{
  const x=setup(t);roster(x);seed(x);
  const revision=x.store.get('amendmentMutationRevision');seed(x,'IMCO-AM-772127',{authors:['Martin Häusling'],number:51});
  assert(x.store.get('amendmentMutationRevision')>revision);
  const first=amendmentContributors(x.store,{procedures:['2024-0318'],limit:1});assert.equal(first.next,1);
  const second=amendmentContributors(x.store,{procedures:['2024-0318'],limit:1,offset:first.next});assert.notEqual(first.items[0].id,second.items[0].id);assert.equal(second.next,null);
  x.store.release();x.store.set('committeeAmendmentIndexVersion',0);x.store.set('amendmentReadVersion','old-parser');
  x.store.db.exec('DELETE FROM amendment_contributors; DELETE FROM amendment_read_flags; DROP TRIGGER amendment_contributor_update;');
  prepareIndexes({activityDirectory:x.directory,clock:()=>Date.parse(at),log:()=>{}});
  const reopened=new ActivityStore(x.directory,{preparedOnly:true,clock:()=>Date.parse(at)});
  try {assert.equal(reopened.get('committeeAmendmentIndexVersion'),committeeAmendmentIndexVersion);assert.equal(reopened.get('amendmentReadVersion'),amendmentReadVersion);assert.equal(amendmentContributors(reopened,{procedures:['2024-0318']}).items.length,2);assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM amendment_read_flags').get().n,2);}finally{reopened.close();}
});

test('competing distributions, conflicting targets and exact joint source links stay explicit',t=>{
  const x=setup(t),work=doc('AGRI-AM-773343');
  work.is_realized_by.push(structuredClone(work.is_realized_by[0]));
  prepareCommitteeList(x.worker,x.generation,work,at,'/documents/'+work.identifier,{rebuild:rebuildAmendmentTarget});
  assert.equal(currentDocxDescriptor(x.store.source(x.generation,'amendment:list:'+work.identifier).work),null);
  assert.equal(committeeTargetRelationship(work,['IMCO-PA-770204']).status,'conflicting');
  assert.equal(humanSourceUrl('https://data.europarl.europa.eu/distribution/reds_iCmDoc_Amd/CJ61-AM-778402/CJ61-AM-778402_fr.docx'),'https://www.europarl.europa.eu/doceo/document/CJ61-AM-778402_FR.html');
  assert.equal(humanSourceUrl('https://data.europarl.europa.eu/api/v2/documents/CJ61-AM-778402'),'https://www.europarl.europa.eu/doceo/document/CJ61-AM-778402_EN.html');
  assert.equal(documentDetailEndpoint('/committee-documents/CJ61-AM-778402'),'/documents/CJ61-AM-778402');
  enqueueAmendment(x.store,x.generation,'/documents/CJ61-AM-778402','document',{endpoint:'/documents/CJ61-AM-778402'},105);
  assert(documentRouteOwned(x.store,x.generation,'/committee-documents/CJ61-AM-778402',documentRouteDeferredOwners(x.store,x.generation)));
});

test('committee context selects an exact internal list/number and retains the actual wording baseline',async t=>{
  const x=setup(t);roster(x);const list=seed(x);
  const query=documentContextQuery('AGRI-PR-773115',new URLSearchParams({scope:'committee',amendment:'committee:AGRI-AM-773343:51',list:'AGRI-AM-773343',body:'0'}));
  const reader=new DocumentContext({request:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[doc(endpoint.split('/').at(-1))]}}),download:async()=>assert.fail('Indexed wording must be reused')});
  const result=await reader.query(query,{store:x.store});assert.equal(result.amendment.basis,'index');assert.equal(result.amendment.variants[0].listId,list.identifier);assert.equal(result.target.status,'not-requested');
  const targetless=documentContextQuery('CJ61-AM-778402',new URLSearchParams({amendment:'committee:CJ61-AM-778402:1',list:'CJ61-AM-778402',body:'0'}));assert.equal(targetless.id,'CJ61-AM-778402');
  assert.throws(()=>documentContextQuery('CJ61-AM-778402',new URLSearchParams({amendment:'committee:CJ61-AM-779431:1'})));
  assert.throws(()=>documentContextQuery('AGRI-PR-773115',new URLSearchParams('adopted=1')));
  const wrongTerm=new DocumentContext({request:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[{...doc('AGRI-PR-773115'),parliamentary_term:'org/ep-9'}]}})});
  await assert.rejects(wrongTerm.query(query),error=>error.code==='invalid_document_source');
});

test('an exact agenda discovers newly checked amendment-only people in the same generation and keeps their amendment date',async t=>{
  const x=setup(t),sitting='MTG-PL-2025-05-22',topic=sitting+'-OJ-ITM-D-1',container=sitting+'-TF-01';
  x.store.setMembers([{id:'100',firstName:'Martin',lastName:'Häusling'}]);
  const meeting={id:'eli/dl/event/'+sitting,activity_id:sitting,activity_date:'2025-05-22',had_activity_type:'def/ep-activities/PLENARY_SITTING',was_scheduled_in:['eli/dl/event/'+container]};
  const agenda=[{id:'eli/dl/event/'+container,had_activity_type:'def/ep-activities/MEETING_PART',activity_id:container,consists_of:['eli/dl/event/'+topic]},
    {id:'eli/dl/event/'+topic,activity_id:topic,activity_date:'2025-05-22',had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_label:{en:'Public dossier'},inverse_was_scheduled_in:['eli/dl/proc/2024-0318']}];
  const work=projectProcedure(proc('2024-0318'));x.store.putSource(x.generation,'/procedures/2024-0318','procedure',work,at);
  const calls=[],service=createInsights(x.store,{clock:()=>Date.parse(at),viewCache:{directory:path.join(x.directory,'views')},loadMetadata:async()=>new Map(),request:yearCatalogue(async(endpoint,params)=>{
    calls.push(endpoint);assert(endpoint==='/meetings'||endpoint.endsWith('/foreseen-activities'));
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse(at),payload:{data:endpoint==='/meetings'?params.offset===0?[meeting]:[]:agenda}};
  })});
  const query=new URLSearchParams({sitting,topic});
  const before=await service.query('legislation',query);assert.equal(before.detail.people.length,0);
  roster(x);seed(x);const revision=x.store.get('amendmentMutationRevision');
  x.store.db.exec('PRAGMA query_only=ON');
  const after=await service.query('legislation',query);
  assert.equal(after.coverage.servingGeneration,before.coverage.servingGeneration);
  assert.equal(after.detail.people.length,1);assert.equal(after.detail.people[0].id,'100');
  assert.equal(after.detail.amendments.authorDates['100'],day);assert.equal(after.detail.amendments.countsByStage['100'].committee,1);
  assert.equal(after.detail.speeches.length,0);assert.equal(x.store.get('amendmentMutationRevision'),revision);
  assert(!calls.some(endpoint=>endpoint.includes('/documents/')||endpoint.includes('/meps/')));
});

test('bounded backfill resumes after queue saturation and does not reset another document owner',async t=>{
  const x=setup(t),work=projectProcedure(proc('2024-0318'));delete work.committeeProjectionVersion;
  x.store.putSource(x.generation,'/procedures/2024-0318','procedure',work,at);
  prepareCommitteeAmendments(x.worker,x.generation);
  const row=x.store.db.prepare("SELECT * FROM amendment_jobs WHERE kind='amendment-committee-prepare'").get(),task={...row,body:JSON.parse(row.body),amendmentJob:true};
  for(let n=0;n<199;n++)x.store.db.prepare('INSERT INTO amendment_jobs(generation,key,kind,body,priority) VALUES (?,?,?,?,?)').run(x.generation,'occupied:'+n,'amendment-extract','{}',1);
  await amendmentTask(x.worker,task);
  assert.equal(JSON.parse(x.store.db.prepare('SELECT body FROM amendment_jobs WHERE key=?').get(task.key).body).afterKey,'');
  x.store.db.prepare('DELETE FROM amendment_jobs WHERE key=?').run('occupied:0');
  await amendmentTask(x.worker,task);
  assert(x.store.db.prepare("SELECT 1 FROM amendment_jobs WHERE key='/procedures/2024-0318'").get());
  assert.equal(x.store.db.prepare('SELECT done FROM amendment_jobs WHERE key=?').get(task.key).done,1);
  x.store.enqueue(x.generation,'/documents/AGRI-AM-773343','document',{endpoint:'/documents/AGRI-AM-773343'},103);
  x.store.db.prepare("UPDATE tasks SET attempts=2,retry_at=12345 WHERE key='/documents/AGRI-AM-773343'").run();
  assert(documentRouteOwned(x.store,x.generation,'/documents/AGRI-AM-773343',documentRouteDeferredOwners(x.store,x.generation)));
  assert.deepEqual({...x.store.db.prepare("SELECT attempts,retry_at FROM tasks WHERE key='/documents/AGRI-AM-773343'").get()},{attempts:2,retry_at:12345});
});

test('an explicit cross-list revision keeps both observations and withholds combined distinct counts',t=>{
  const x=setup(t);roster(x);const first=seed(x);seed(x,'IMCO-AM-772127',{authors:['Martin Häusling'],number:51});
  first.replaces=['eli/dl/doc/IMCO-AM-772127'];x.store.putSource(x.generation,'amendment:list:'+first.identifier,'amendment-list',first,at);
  rebuildAmendmentTarget(x.worker,x.generation,first.scopeKey);
  const rows=amendmentsPage(x.store,{scope:'committee',procedure:'2024-0318'}).items;assert.equal(rows.length,2);
  assert(rows.some(row=>row.countConflict&&row.sourceVersion.revisionRelationships.replaces.length));
  const topic=topicAmendments(x.store,[],[],{procedureIds:['2024-0318'],asOf:day});
  assert.deepEqual(topic.authorIds,['100']);assert.equal(topic.countsByStage['100'].committee,null);assert.equal(topic.counts['100'],null);
  assert.equal(alternateAuthorDescriptor({scope:'committee',distributionEvidence:{descriptors:[{url:'https://data.europarl.europa.eu/distribution/example/one_fr.docx',language:'fr'},{url:'https://data.europarl.europa.eu/distribution/example/two_fr.docx',language:'fr'}]}},{sourceUrl:'https://data.europarl.europa.eu/distribution/example/el.docx',amendments:[{authors:['Δημόσιο όνομα']}]}),null);
});

test('collection reuses the existing extraction path and dated roster rebuild for a public committee list',async t=>{
  const x=setup(t),work=doc('AGRI-AM-773343');work.inverse_created_a_realization_of=['eli/dl/proc/2024-0318'];
  x.store.putSource(x.generation,'/documents/'+work.identifier,'document',work,at);
  prepareCommitteeList(x.worker,x.generation,work,at,'/documents/'+work.identifier,{rebuild:rebuildAmendmentTarget});
  roster(x);
  const task=nextAmendmentTask(x.store,x.generation);
  // Existing roster work remains owned by its ordinary task; choose only the
  // collection job here and rebuild from the retained dated observation.
  const row=x.store.db.prepare("SELECT * FROM amendment_jobs WHERE kind='amendment-extract'").get();assert(row);assert(task);
  await amendmentTask(x.worker,{...row,body:JSON.parse(row.body),amendmentJob:true});
  const [item]=amendmentsPage(x.store,{scope:'committee',list:work.identifier,member:'100'}).items;
  assert(item);assert.equal(item.id,'committee:AGRI-AM-773343:51');assert.equal(item.baseline,'commission-proposal');assert.equal(item.proposerDate,day);assert.equal(item.authors[0].personId,'100');assert.equal(item.sourceVersion.sourceHash.length,64);
  assert.equal(item.outcome,'unavailable');assert.equal(item.decisions.length,0);
});

function signedRows(x,listId,n=1) {
  const key='committee:'+listId,procedureIds=['2024-0318'],from={url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt:at,language:null};
  saveAmendmentRows(x.store,x.generation,{id:key,listId,scope:'committee',procedureIds,committees:[{code:'AGRI'}],committeeProjectionVersion:1,sources:[from]},Array.from({length:n},(_,i)=>({id:key+':'+(i+1),number:i+1,listId,scope:'committee',procedureIds,targetDocumentId:null,documentDate:day,textParserVersion:AMENDMENT_EXTRACTION_VERSION,authors:[{name:'Published member',personId:'100',status:'resolved'}],proposerSource:from,gaps:[]})),{complete:false,proposerComplete:true});
}
test('participant amendment evidence continues through existing offset/target cursors without dropping list-scoped IDs',async t=>{
  const x=setup(t);for(let i=0;i<5;i++)signedRows(x,'AGRI-AM-'+(900000+i),401);
  const work={...proc('2024-0318'),consists_of:[]},reader={record:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[work]}})},service=new DossierActivity(x.store,{reader});
  x.store.db.exec('PRAGMA query_only=ON');
  const first=await service.query(dossierActivityQuery(new URLSearchParams({reference:work.label,section:'roles'})));
  assert.deepEqual(first.pagination.next,{offset:2000,targetOffset:0});assert.equal(first.participants[0].amendments.length,2000);
  assert(first.participantCoverage.uncheckedTargets.every(id=>/^AGRI-AM-\d+$/.test(id)));
  const second=await service.query(dossierActivityQuery(new URLSearchParams({reference:work.label,section:'roles',offset:String(first.pagination.next.offset),'target-offset':'0'})));
  assert.equal(second.participants[0].amendments.length,5);assert.equal(second.pagination.next,null);
  assert.equal(new Set([...first.participants[0].amendments,...second.participants[0].amendments].map(item=>item.id)).size,2005);
  assert.equal(second.participantCoverage.retryable,false);
});
test('list-specific dossier continuation reaches a target after the first 24 lists, including missing draft targets',async t=>{
  const x=setup(t);for(let i=0;i<25;i++)signedRows(x,'AGRI-AM-'+(900000+i));
  const work=proc('2024-0318'),reader={record:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[work]}})};
  const result=await new DossierActivity(x.store,{reader}).query(dossierActivityQuery(new URLSearchParams({reference:work.label,section:'amendments',member:'100',stage:'committee','target-offset':'24'})));
  assert.equal(result.checkedTarget,'AGRI-AM-900024');assert.equal(result.items.length,1);assert.equal(result.items[0].amendment.targetDocumentId,null);assert.equal(result.pagination.next,null);
});

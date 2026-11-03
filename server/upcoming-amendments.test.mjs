import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaTopics} from './insights-legislation-model.mjs';
import {amendmentTarget} from './amendments.mjs';
import {scheduledVotes,withScheduledVotes} from './upcoming-amendments.mjs';
import {activePlenaryWindow} from './plenary-window.mjs';
import {dispatchCollector,ordinaryCollectorTurn} from './collector-dispatch.mjs';
const date='2026-11-12',sitting='MTG-PL-'+date,id='A-9-2024-0160';
const item={id:sitting+'-OJ-ITM-V-14',kind:'PLENARY_VOTE',date,documentIds:[id]};
test('agenda preserves exact deadlines and multilingual labels',()=>{
 const slot='eli/dl/event/'+sitting+'-TF-1100',uri='eli/dl/event/'+item.id;
 const deadline={id:'eli/dl/event/GMTG-PL-2026-11-11-DL-14-1',type:'eli-dl:Deadline',activity_id:'GMTG-PL-2026-11-11-DL-14-1',activity_end_date:'2026-11-04T13:00:00+01:00',had_activity_type:'def/ep-activities/TABLING_DEADLINE',activity_label:{en:'Amendments; rejection',hu:'Módosítások; elutasítás'}};
 const topics=agendaTopics({payload:{data:[{was_scheduled_in:[slot]}]}},{payload:{data:[{id:slot,had_activity_type:'MEETING_PART',consists_of:[uri]},{id:uri,activity_id:item.id,had_activity_type:'PLENARY_VOTE',was_purpose_of:[deadline]}]}});
 assert.deepEqual(topics[0].deadlines,[{id:deadline.activity_id,end:deadline.activity_end_date,type:deadline.had_activity_type,labels:deadline.activity_label}]);
});
test('term 9 targets require an exact current-term vote agenda relationship',()=>{
 assert.equal(amendmentTarget(id),false);assert.equal(amendmentTarget(id,{agendaItems:[item]}),true);
 for(const changed of [{kind:'PLENARY_DEBATE'},{date:'2024-01-01'},{documentIds:['A-9-2024-0162']}])assert.equal(amendmentTarget(id,{agendaItems:[{...item,...changed}]}),false);
 assert.equal(amendmentTarget('A-10-2026-0093'),true);assert.equal(amendmentTarget('A-8-2019-0160',{agendaItems:[item]}),false);
});
test('only dates after the latest earlier exact VOT-ITM count; voting-list numbers override',()=>{
 const work={identifier:id,plenaryVoteHistoryObserved:true,inverse_based_on_a_realization_of:['eli/dl/event/MTG-PL-2026-04-29-VOT-ITM-190027','eli/dl/event/MTG-PL-2026-11-12-VOT-ITM-2','eli/dl/event/MTG-PL-2026-11-11-DEC-123']};
 const options={today:'2026-11-03'};
 assert.deepEqual(scheduledVotes(work,{document_date:'2026-04-29'},[item],options),[]);
 assert.equal(scheduledVotes(work,{document_date:'2026-11-05'},[item],options)[0].previousVoteDate,'2026-04-29');
 assert.equal(scheduledVotes({identifier:id}, {document_date:'2026-11-05'},[item],options),null);
 const ballot={sittingId:sitting,agendaItemId:item.id,documentId:id,rows:[{amendments:[{number:7}]}]};
 assert.equal(scheduledVotes(work,{document_date:'2026-04-01'},[item],{...options,number:7,votingLists:[ballot]})[0].basis,'voting-list');
 assert.deepEqual(scheduledVotes(work,{document_date:'2026-11-05'},[item],{...options,number:8,votingLists:[ballot]}),[]);
});
test('Brussels plenary window includes four days before at 07 and ends last day at 23, including DST',()=>{
 const dates=['2026-11-11','2026-11-12'].map(date=>({date}));
 for(const [time,active] of [['2026-11-07T05:59Z',false],['2026-11-07T06:00Z',true],['2026-11-12T21:59Z',true],['2026-11-12T22:00Z',false]])assert.equal(Boolean(activePlenaryWindow(dates,Date.parse(time))),active);
 assert(activePlenaryWindow([{date:'2026-03-30'}],Date.parse('2026-03-26T06:00Z')));
});
test('upcoming refresh and extraction share the existing one-in-six optional counter',async()=>{
 const saved=new Map(),worker={store:{get:k=>saved.get(k),set:(k,v)=>saved.set(k,v)},requests:0,budget:100,controller:new AbortController()};const seen=[];
 const options={busy:true,topic:async()=>{seen.push('topic');return true;},story:async()=>{seen.push('story');return true;},upcoming:async()=>{seen.push('upcoming');return true;}};
 let core=0;for(let i=0;i<36;i++)if(!await dispatchCollector(worker,options)){ordinaryCollectorTurn(worker);core++;}
 assert.equal(core,30);assert.deepEqual(seen,['topic','story','upcoming','topic','story','upcoming']);
});

import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {collectUpcomingAmendments} from './upcoming-amendments-collector.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function setup(t){
 let now=Date.parse('2026-11-10T12:00Z');const directory=mkdtempSync(path.join(os.tmpdir(),'upcoming-'));
 const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());const {generation}=store.beginCycle();
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 const window={first:'2026-11-11',last:'2026-11-12',sittingIds:[sitting]};
 const state={window:window.first,items:[item],checked:{[sitting]:now+24*3600000}};
 store.putSource(generation,'upcoming:agenda','upcoming-agenda',state,new Date(now).toISOString());
 return {store,generation,window,clock:()=>now,advance:hours=>{now+=hours*3600000;store.acquire();}};
}
test('generation begin skips are coalesced into one read and add no document backlog',async t=>{
 const {store,generation,window,clock,advance}=setup(t);let reads=0;
 const worker={store,clock,task:async()=>{reads++;}};
 store.generationTaskActive=true;assert.equal(await collectUpcomingAmendments(worker,{window}),false);
 advance(3);assert.equal(await collectUpcomingAmendments(worker,{window}),false);assert.equal(reads,0);
 store.generationTaskActive=false;assert.equal(await collectUpcomingAmendments(worker,{window}),true);
 assert.equal(await collectUpcomingAmendments(worker,{window}),false);assert.equal(reads,1);
 assert.equal(store.db.prepare("SELECT count(*) n FROM tasks WHERE generation=? AND key=?").get(generation,'/plenary-documents/'+id).n,0);
});
test('hourly metadata re-read does not download unchanged list bytes',async t=>{
 const {store,generation,window,clock}=setup(t);
 const {AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
 const {distributionEvidenceFor}=await import('./amendments.mjs');
 const listId=id+'-AM-001-001',url='https://data.europarl.europa.eu/distribution/example/amendments_en.docx';
 const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:'2026-11-09',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]};
 const stamp=new Date(clock()-8*86400000).toISOString(),proof={url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt:stamp};
 const distributionEvidence=distributionEvidenceFor(list,proof);
 store.putSource(generation,'amendment:list:'+listId,'amendment-list',{...list,targetDocumentId:id,distributionEvidence,extraction:{parserVersion:AMENDMENT_EXTRACTION_VERSION,sourceDescriptor:distributionEvidence.descriptors[0],sourceUrl:url,fetchedAt:stamp,amendments:[],gaps:[]}},stamp);
 let downloads=0,requests=0;
 const work={id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:'2024-04-01',inverse_foresees_change_of:[list],inverse_based_on_a_realization_of:[]};
 const worker=new ActivityWorker(store,{clock,runUpstream:unthrottledUpstream,fetchRecord:async endpoint=>{requests++;return {payload:{data:[work]},fetchedAt:new Date(clock()).toISOString(),url:'https://data.europarl.europa.eu/api/v2'+endpoint};},downloadAmendmentDocx:async()=>{downloads++;throw Error('must not download');}});
 assert.equal(await collectUpcomingAmendments(worker,{window}),true);
 assert.equal(requests,1);assert.equal(downloads,0);
 assert.equal(store.db.prepare("SELECT count(*) n FROM amendment_jobs WHERE generation=? AND kind='amendment-extract' AND done=0").get(generation).n,0);
});

test('priority extraction reads held bytes without another download',async t=>{
 const {store,generation,clock}=setup(t);
 const {amendmentSourceStore}=await import('./amendment-source-store.mjs');
 const {amendmentTask}=await import('./amendments-worker.mjs');
 const {enqueueAmendment,nextAmendmentTask}=await import('./amendments-store.mjs');
 const {AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
 const listId=id+'-AM-001-001',descriptor={url:'https://www.europarl.europa.eu/doceo/document/held_EN.docx',language:'en',byteSize:4},bytes=Buffer.from('held'),stamp=new Date(clock()).toISOString();
 store.putSource(generation,'amendment:list:'+listId,'amendment-list',{id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:id,document_date:'2026-11-09',distributionEvidence:{version:2,state:'available',descriptors:[descriptor]}},stamp);
 await amendmentSourceStore(store).save(descriptor,bytes,stamp,{listId});
 let downloads=0,parses=0;
 const worker=new ActivityWorker(store,{clock,runUpstream:unthrottledUpstream,downloadAmendmentDocx:async()=>{downloads++;throw Error('unexpected download');},extractAmendmentList:async buffer=>{assert.deepEqual(buffer,bytes);parses++;return {parserVersion:AMENDMENT_EXTRACTION_VERSION,amendments:[],gaps:[]};}});
 const body={listId,targetDocumentId:id,upcoming:true,upcomingUntil:clock()+3600000};
 enqueueAmendment(store,generation,'held','amendment-extract',body,112);
 assert.equal(nextAmendmentTask(store,generation),null);
 await amendmentTask(worker,{generation,key:'held',kind:'amendment-extract',body,amendmentJob:true});
 assert.equal(parses,1);assert.equal(downloads,0);
});

test('a new list gets an optional extraction turn after exact metadata verification',async t=>{
 const {store,generation,window,clock}=setup(t);const {AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
 const listId=id+'-AM-002-002',url='https://data.europarl.europa.eu/distribution/example/new_en.docx',stamp=new Date(clock()).toISOString();
 const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:'2026-11-10',foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]};
 const work={id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_foresees_change_of:[list],inverse_based_on_a_realization_of:[]};
 let downloads=0;
 const worker=new ActivityWorker(store,{clock,runUpstream:unthrottledUpstream,fetchRecord:async endpoint=>({payload:{data:[endpoint==='/documents/'+listId?list:work]},fetchedAt:stamp,url:'https://data.europarl.europa.eu/api/v2'+endpoint}),downloadAmendmentDocx:async()=>{downloads++;return {buffer:Buffer.from('new')};},extractAmendmentList:async()=>({parserVersion:AMENDMENT_EXTRACTION_VERSION,amendments:[],gaps:[]})});
 await collectUpcomingAmendments(worker,{window});assert.equal(downloads,0);
 const job=store.db.prepare("SELECT body FROM amendment_jobs WHERE generation=? AND kind IN ('amendment-extract','amendment-list-detail') AND done=0").get(generation);
 assert(job,JSON.stringify(store.db.prepare('SELECT key,kind,body FROM amendment_jobs WHERE generation=?').all(generation)));
 assert.equal(JSON.parse(job.body).upcoming,true);
 for(let turn=0;turn<4&&!downloads;turn++)await collectUpcomingAmendments(worker,{window});
 assert.equal(downloads,1);
});

test('API row enrichment consumes the shared official ballot reader and overrides spent-list dates',async t=>{
 const {store,generation,clock}=setup(t);const {withScheduledVotes}=await import('./upcoming-amendments.mjs');
 const listId=id+'-AM-001-008',stamp=new Date(clock()).toISOString();
 store.putSource(generation,'/plenary-documents/'+id,'document',{identifier:id,inverse_based_on_a_realization_of:['eli/dl/event/MTG-PL-2026-04-29-VOT-ITM-190027']},stamp);
 store.putSource(generation,'amendment:list:'+listId,'amendment-list',{identifier:listId,document_date:'2026-04-01'},stamp);
 store.votingListsForSitting=selected=>{assert.equal(selected,sitting);return [{sittingId:sitting,agendaItemId:item.id,documentId:id,rows:[{amendments:[{number:7}]}]}];};
 assert.equal(withScheduledVotes(store,generation,{targetDocumentId:id,listId,number:7}).scheduledVotes[0].basis,'voting-list');
 assert.deepEqual(withScheduledVotes(store,generation,{targetDocumentId:id,listId,number:8}).scheduledVotes,[]);
});

test('scheduler ticks reuse inactive and active windows until the next hour',async t=>{
 const {SittingSnapshotReader}=await import('./sitting-snapshot-store.mjs');
 const {upcomingRefreshDue}=await import('./upcoming-amendments-collector.mjs');
 let now=Date.parse('2026-11-07T05:59Z'),reads=0;
 t.mock.method(SittingSnapshotReader.prototype,'read',()=>{reads++;return {nodes:[{activity_date:'2026-11-11'},{activity_date:'2026-11-12'}]};});
 const worker={clock:()=>now,store:{db:{},get:()=>0}};
 for(let tick=0;tick<100;tick++)assert.equal(upcomingRefreshDue(worker),false);
 assert.equal(reads,3,'outside ticks reuse a cached null window');
 now=Date.parse('2026-11-07T06:00Z');
 for(let tick=0;tick<100;tick++)assert.equal(upcomingRefreshDue(worker),true);
 assert.equal(reads,6,'07:00 Brussels recomputes once');
 now=Date.parse('2026-11-12T22:00Z');assert.equal(upcomingRefreshDue(worker),false);
 assert.equal(reads,9,'23:00 Brussels expires the cached active window');
});

test('target admission loads agenda evidence only for term-9 identifiers',()=>{
 let loads=0;const options={agendaItems:()=>{loads++;return [item];}};
 for(const document of ['A-10-2026-0093','B-10-2026-0001','RC-10-2026-0001'])assert.equal(amendmentTarget(document,options),true);
 for(const document of ['A-8-2019-0001','invalid',null])assert.equal(amendmentTarget(document,options),false);
 assert.equal(loads,0);
 assert.equal(amendmentTarget(id,options),true);assert.equal(loads,1);
 assert.equal(amendmentTarget('A-9-2024-0162',options),false);assert.equal(loads,2);
});

test('held histories stay unknown until explicitly observed or an exact ballot supplies scope',()=>{
 const work={identifier:id,inverse_based_on_a_realization_of:[]},list={document_date:'2026-11-05'},options={today:'2026-11-03'};
 for(const observed of [undefined,false,null])assert.equal(scheduledVotes({...work,plenaryVoteHistoryObserved:observed},list,[item],options),null);
 assert.equal(scheduledVotes({...work,plenaryVoteHistoryObserved:true},list,[item],options).length,1);
 const ballot={sittingId:sitting,agendaItemId:item.id,documentId:id,rows:[{amendments:[{number:7}]}]};
 assert.equal(scheduledVotes(work,list,[item],{...options,number:7,votingLists:[ballot]})[0].basis,'voting-list');
 assert.equal(scheduledVotes(work,list,[item],{...options,number:7,votingLists:[{...ballot,documentId:'A-9-2024-0162'}]}),null);
});

test('the scope context reads each sitting ballot once for all rows and variants',async t=>{
 const {store,generation,clock}=setup(t),{upcomingScopeContext,withScheduledVotes}=await import('./upcoming-amendments.mjs');
 const listId=id+'-AM-001-008',stamp=new Date(clock()).toISOString();let reads=0;
 store.putSource(generation,'/plenary-documents/'+id,'document',{identifier:id,plenaryVoteHistoryObserved:true,inverse_based_on_a_realization_of:[]},stamp);
 store.putSource(generation,'amendment:list:'+listId,'amendment-list',{identifier:listId,document_date:'2026-11-05'},stamp);
 store.votingListsForSitting=()=>{reads++;return [];};
 const context=upcomingScopeContext(store,generation);
 for(const number of [1,2,3])assert.equal(withScheduledVotes(store,generation,{targetDocumentId:id,listId,number,variants:[{listId}]},context).scheduledVotes.length,1);
 assert.equal(reads,1);
});

test('default and request-context dates roll over at Brussels midnight in winter and summer',async t=>{
 const {upcomingScopeContext}=await import('./upcoming-amendments.mjs');
 const work={identifier:id,plenaryVoteHistoryObserved:true,inverse_based_on_a_realization_of:[]};
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-12T23:30Z')});
 assert.deepEqual(scheduledVotes(work,{document_date:'2026-11-05'},[item]),[]);
 const store={clock:Date.now,db:{prepare:()=>({get:()=>({body:JSON.stringify({items:[item]})})})}};
 assert.equal(upcomingScopeContext(store,1).today,'2026-11-13');
 t.mock.timers.setTime(Date.parse('2026-07-01T22:30Z'));
 const summer={...item,id:'MTG-PL-2026-07-01-OJ-ITM-V-14',date:'2026-07-01'};
 assert.deepEqual(scheduledVotes(work,{document_date:'2026-06-30'},[summer]),[]);
 assert.equal(upcomingScopeContext(store,1).today,'2026-07-02');
});

test('priority work rejoins the ordinary queue at Brussels 23:00, including DST',async t=>{
 const {plenaryWindowEnd}=await import('./plenary-window.mjs');
 const {enqueueAmendment,nextAmendmentTask}=await import('./amendments-store.mjs');
 for(const [last,utc] of [['2026-11-12','2026-11-12T22:00Z'],['2026-07-16','2026-07-16T21:00Z'],['2026-03-29','2026-03-29T21:00Z'],['2026-10-25','2026-10-25T22:00Z']])assert.equal(plenaryWindowEnd(last),Date.parse(utc));
 const {store,generation,window,clock,advance}=setup(t);let until;
 const worker={store,clock,task:async()=>{until=worker.upcomingUntil;}};
 await collectUpcomingAmendments(worker,{window});assert.equal(until,Date.parse('2026-11-12T22:00Z'));
 enqueueAmendment(store,generation,'window-expiry','amendment-extract',{upcoming:true,upcomingUntil:until},112);
 assert.equal(nextAmendmentTask(store,generation),null);
 advance((until-clock())/3600000);assert.equal(nextAmendmentTask(store,generation).key,'window-expiry');
});

test('absence from the observed upcoming agenda is known without plenary history',()=>{
 const unknown={identifier:id};assert.deepEqual(scheduledVotes(unknown,null,[],{today:'2026-11-03'}),[]);assert.deepEqual(scheduledVotes(unknown,null,[{...item,documentIds:['A-10-2026-0270']}],{today:'2026-11-03'}),[]);assert.equal(scheduledVotes(unknown,null,[item],{today:'2026-11-03'}),null);
 // A missing work record must retain the exact target ID from the indexed row.
 const row={scope:'plenary',targetDocumentId:id,listId:'fixture-list',number:1},context={agenda:{items:[item]},items:[item],votingLists:[],sources:new Map([['/plenary-documents/'+id,null],['amendment:list:fixture-list',null]]),today:'2026-11-03'};
 assert.equal(withScheduledVotes({},1,row,context).scheduledVotes,null);assert.deepEqual(withScheduledVotes({},1,row,{...context,items:[]}).scheduledVotes,[]);
});

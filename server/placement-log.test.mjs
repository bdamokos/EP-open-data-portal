import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore,ACTIVITY_SCHEMA_GATES} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {baseSourceKey} from './base-source-descriptor.mjs';
import {DocumentContext} from './document-context.mjs';
import {amendmentById} from './amendments-store.mjs';
import {classify} from '../scripts/amendment-benchmark-model.mjs';
import {evaluateList,heldSourceClients,jsonBytesOver,placementOutcome,placementEvaluator} from './placement-log-evaluate.mjs';
import {PLACEMENT_LOG_LIMITS,commitEvaluation,hasDueList,notePlacementLists,preparePlacementLog,reopenForEvaluator} from './placement-log-store.mjs';
import {PlacementLog} from './placement-log.mjs';
import {placementLogReport,reportOptions} from './placement-log-report.mjs';
import {evaluateOffThread} from './placement-log-thread.mjs';
import {word,p} from './test-support/nle-native-fixture.mjs';
import {provisionalFixture} from './test-support/provisionalFixture.mjs';

const at=Date.parse('2026-11-09T10:00:00Z');
function fixture(t,{lists=[]}={}) {
  const root=mkdtempSync(path.join(os.tmpdir(),'placement-log-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  let now=at;
  const directory=path.join(root,'index');
  const store=new ActivityStore(directory,{clock:()=>now});
  assert(store.acquire());
  const generation=store.beginCycle().generation;
  for(const listId of lists)store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES (?,?,'amendment-list','{}',?)").run(generation,'amendment:list:'+listId,new Date(now).toISOString());
  t.after(()=>{try{store.close();}catch{/* Already closed by the test. */}});
  return {root,directory,store,generation,advance:ms=>{now+=ms;store.acquire();},now:()=>now};
}
const row=(id,listId,extra={})=>({id,listId,language:'en',textIntegrity:'complete',textParserVersion:'27',originalText:'old',proposedText:'new',wordingSource:{contentHash:'a'.repeat(64)},...extra});
const result=(listId,amendments)=>({listId,documentId:'A-10-2026-0001',scope:'plenary',declared:amendments.length,amendments:amendments.map(([id,outcome,reason])=>({id,listId,documentId:'A-10-2026-0001',language:'en',outcome,reason}))});
const list='A-10-2026-0001-AM-001-003';
const failures=store=>store.db.prepare('SELECT * FROM placement_log_failures ORDER BY amendment_id,reason').all();
const listRow=(store,id=list)=>store.db.prepare('SELECT * FROM placement_log_lists WHERE list_id=?').get(id);

test('an existing database gets the log on writer acquisition, without touching generation gates',t=>{
  const {directory,store,generation}=fixture(t,{lists:[list,'B-10-2026-0002-AM-001-001']});
  // The state an image before this log leaves behind.
  store.db.exec('DROP TABLE placement_log_lists; DROP TABLE placement_log_failures;');
  store.db.prepare("DELETE FROM meta WHERE key='placementLogSchema'").run();
  store.set('generationBegin',{probe:true});
  store.release();store.close();
  const reopened=new ActivityStore(directory);t.after(()=>reopened.close());
  assert(reopened.acquire());
  assert.equal(reopened.get('placementLogSchema'),1);
  assert.deepEqual(reopened.db.prepare('SELECT list_id,state,next_check FROM placement_log_lists ORDER BY list_id').all().map(row=>({...row})),[
    {list_id:list,state:'baseline',next_check:null},{list_id:'B-10-2026-0002-AM-001-001',state:'baseline',next_check:null},
  ]);
  assert.equal(ACTIVITY_SCHEMA_GATES.some(gate=>gate.key==='placementLogSchema'),false);
  assert.equal(reopened.get('generationBegin').discard,undefined);
  // A later acquisition, or a rotated generation, cannot re-baseline a list.
  assert.equal(preparePlacementLog(reopened),false);
  assert.ok(generation);
});

test('wording that becomes held makes a new list due; older lists and unchanged lists stay quiet',t=>{
  const {store}=fixture(t);
  store.db.prepare("INSERT INTO placement_log_lists(list_id,state,first_seen) VALUES (?,'baseline','2026-11-01')").run(list);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  assert.equal(listRow(store).next_check,null,'an older list is not read');
  const fresh='A-10-2026-0002-AM-001-002';
  assert.equal(hasDueList(store),false);
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh,{originalText:null,proposedText:null})]);
  assert.equal(listRow(store,fresh),undefined,'no wording yet, nothing placeable');
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh),row('A-10-2026-0002-AM-2',fresh)]);
  assert.equal(listRow(store,fresh).state,'pending');
  assert.equal(hasDueList(store),true);
  commitEvaluation(store,result(fresh,[['A-10-2026-0002-AM-1','placed','placed'],['A-10-2026-0002-AM-2','placed','placed']]));
  assert.equal(hasDueList(store),false);
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh),row('A-10-2026-0002-AM-2',fresh)]);
  assert.equal(hasDueList(store),false,'the same content is not evaluated again');
  notePlacementLists(store,[row('A-10-2026-0002-AM-2',fresh),row('A-10-2026-0002-AM-1',fresh,{textParserVersion:'26'})]);
  assert.equal(hasDueList(store),false,'a parser version alone is not new content');
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh),row('A-10-2026-0002-AM-2',fresh,{wordingSource:{contentHash:'a'.repeat(64),fetchedAt:'2026-11-10T00:00:00Z'}})]);
  assert.equal(hasDueList(store),false,'a later retrieval of the same wording is not new content');
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh),row('A-10-2026-0002-AM-2',fresh,{proposedText:'corrected'})]);
  assert.equal(hasDueList(store),true,'wording corrected at the same URL is');
  commitEvaluation(store,result(fresh,[['A-10-2026-0002-AM-1','placed','placed'],['A-10-2026-0002-AM-2','placed','placed']]));
  notePlacementLists(store,[row('A-10-2026-0002-AM-1',fresh,{decisions:[{id:'decision-1',reference:'§ 2',amendmentIds:['A-10-2026-0002-AM-1']}]}),row('A-10-2026-0002-AM-2',fresh,{proposedText:'corrected'})]);
  assert.equal(hasDueList(store),true,'a vote reference is a placement input');
});

test('the log records first sightings, last seen and when a failure stopped, and loses nothing',t=>{
  const {store,advance,now}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  const first=commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-2','acquisition-unavailable','acquisition-source-not-held'],['A-10-2026-0001-AM-3','placed','placed']]));
  assert.equal(first.added,1,'only placement failures count as new');
  assert.deepEqual(first.reasons,{target_not_found:1});
  const firstSeen=new Date(now()).toISOString();
  advance(3600_000);
  const again=commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-2','acquisition-unavailable','acquisition-source-not-held'],['A-10-2026-0001-AM-3','placed','placed']]));
  assert.equal(again.added,0,'no re-log');
  const rows=failures(store);
  assert.equal(rows.length,2);
  assert.equal(rows[0].first_seen,firstSeen);
  assert.equal(rows[0].last_seen,new Date(now()).toISOString());
  assert.equal(rows[0].stopped_at,null);
  advance(3600_000);
  const fixedAt=new Date(now()).toISOString();
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','placed','placed'],['A-10-2026-0001-AM-2','withheld-pipeline','duplicate_target_label']]));
  const after=failures(store);
  assert.deepEqual(after.map(row=>[row.amendment_id,row.reason,row.stopped_at,row.stopped_outcome]),[
    ['A-10-2026-0001-AM-1','target_not_found',fixedAt,'placed'],
    ['A-10-2026-0001-AM-2','acquisition-source-not-held',fixedAt,'withheld-pipeline'],
    ['A-10-2026-0001-AM-2','duplicate_target_label',null,null],
  ]);
  // A failure that returns keeps its original first sighting.
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]));
  const reopened=failures(store).find(row=>row.reason==='target_not_found');
  assert.equal(reopened.first_seen,firstSeen);assert.equal(reopened.stopped_at,null);
  assert.equal(failures(store).find(row=>row.reason==='duplicate_target_label').stopped_outcome,'absent-from-list');
  const saved=listRow(store);
  assert.equal(JSON.parse(saved.first_counts)['withheld-pipeline'],1);
  assert.equal(JSON.parse(saved.first_counts).placed,1);
  assert.equal(JSON.parse(saved.counts)['withheld-pipeline'],1);
  assert.equal(JSON.parse(saved.counts).amendments,1);
});

test('the log survives generation publication and rotation',t=>{
  const {store,generation}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]));
  store.publish(generation);
  const next=store.beginCycle().generation;
  assert.notEqual(next,generation);
  store.publish(next);
  assert.equal(failures(store).length,1);
  assert.equal(listRow(store).state,'evaluated');
  // A reparse or rebuild in a later generation with the same content is quiet.
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]));
  assert.equal(failures(store).length,1);
});

test('the row limit is counted and reported, never silent',t=>{
  const {store}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  const outcome=commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-2','withheld-pipeline','target_not_found']]),{maxRows:1});
  assert.equal(outcome.dropped,1);
  assert.equal(listRow(store).dropped,1);
  assert.equal(JSON.parse(listRow(store).counts)['withheld-pipeline'],2,'the percentage stays exact');
  assert.match(placementLogReport(store.db,{since:'2026-11-01'}),/1 failures were counted but not recorded/);
});

test('a source that may still arrive is re-checked for a bounded time; new code re-opens only failing lists',t=>{
  const {store,advance}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','acquisition-unavailable','acquisition-source-not-held']]),{evaluator:'v1'});
  assert.equal(hasDueList(store),false);
  advance(PLACEMENT_LOG_LIMITS.recheckMs);
  assert.equal(hasDueList(store),true);
  advance(PLACEMENT_LOG_LIMITS.recheckForMs);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','acquisition-unavailable','acquisition-source-not-held']]),{evaluator:'v1'});
  assert.equal(listRow(store).next_check,null,'the re-check ends');
  const clean='A-10-2026-0003-AM-001-001';
  notePlacementLists(store,[row('A-10-2026-0003-AM-1',clean)]);
  commitEvaluation(store,result(clean,[['A-10-2026-0003-AM-1','placed','placed']]),{evaluator:'v1'});
  store.set('placementLogEvaluator','v1');
  assert.equal(reopenForEvaluator(store,'v1'),0);
  assert.equal(reopenForEvaluator(store,'v2'),1);
  assert.equal(listRow(store,clean).next_check,null,'a list that placed cleanly is not read again');
  assert.equal(listRow(store).next_check,store.clock());
});

test('classes match the benchmark classifier they reuse',()=>{
  const passed={status:'passed'},blocked=reason=>({status:'blocked',reason}),unverified={status:'unverified',reason:'oracle'};
  for(const [stages,expected] of [
    [{S2:blocked('source-wording-empty')},'withheld-source'],
    [{S2:blocked('source-document-unavailable')},'withheld-source'],
    [{S2:blocked('acquisition-wording-not-held')},'acquisition-unavailable'],
    [{S2:blocked('wording-incomplete')},'withheld-pipeline'],
    [{S4:blocked('acquisition-proposal-source-unavailable')},'acquisition-unavailable'],
    [{S4:blocked('proposal-projection-unavailable')},'withheld-pipeline'],
    [{S4:blocked('council_position_unavailable')},'withheld-pipeline'],
    [{S5:{status:'unresolved',reason:'target_not_found'}},'withheld-pipeline'],
    [{S5:{status:'report-quotation'}},'withheld-pipeline'],
    [{S5:{status:'not-applicable',reason:'language_version_unaffected'},S6:{status:'verified',reason:'x'}},'not-applicable'],
    [{S5:{status:'placed'},S6:unverified},'placed-unverified'],
  ]) {
    const notPlaced={status:'unresolved',reason:'placement-not-evaluated'};
    const benchmark=classify({S1:passed,S2:passed,S3:passed,S4:passed,S5:notPlaced,S6:{status:'not-applicable',reason:'x'},...stages});
    assert.equal(benchmark.outcome,expected);
    const ours=placementOutcome({wording:stages.S2||passed,source:stages.S4||passed,placement:stages.S5||notPlaced});
    assert.equal(ours.outcome,expected==='placed-unverified'?'placed':expected,JSON.stringify(stages));
  }
  assert.equal(placementOutcome({wording:passed,source:passed,placement:{status:'document-operation'}}).outcome,'placed');
});

const docxUrl='https://data.europarl.europa.eu/distribution/reds_iPlRp/A-10-2026-0001/A-10-2026-0001_en.docx';
const paragraphs=['The European Parliament,','A. whereas the rules are unclear;','1. Calls on the Commission to publish the report;','2. Stresses the need for clear rules;'];
function document(t,{held=true}={}) {
  const base=fixture(t,{lists:[]});
  const {root,store,generation}=base;
  const cacheDirectory=path.join(root,'cache');
  mkdirSync(path.join(cacheDirectory,'base-sources-v1'),{recursive:true});
  if(held) {
    const buffer=word(paragraphs.map(text=>p(text)).join('')),sha256=createHash('sha256').update(buffer).digest('hex');
    const request={accept:'*/*',language:'en'},key=baseSourceKey(docxUrl,request);
    writeFileSync(path.join(cacheDirectory,'base-sources-v1',sha256+'.blob'),buffer);
    writeFileSync(path.join(cacheDirectory,'base-sources-v1',key+'.json'),JSON.stringify({schemaVersion:1,key,url:docxUrl,request,status:200,fetchedAt:new Date(at).toISOString(),sha256,bytes:buffer.length}));
  }
  const work={id:'eli/dl/doc/A-10-2026-0001',identifier:'A-10-2026-0001',work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:'org/ep-10',languageVersionsObserved:true,is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:docxUrl}]}],inverse_foresees_change_of:['eli/dl/doc/'+list]};
  store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES (?,?,'document',?,?)").run(generation,'/plenary-documents/A-10-2026-0001',JSON.stringify(work),new Date(at).toISOString());
  const amendments=[{number:1,targetLabel:'Paragraph 1',originalText:paragraphs[2],proposedText:'1. Calls on the Commission to publish a detailed report;'},{number:2,targetLabel:'Paragraph 9',originalText:'9. A paragraph this motion does not have;',proposedText:'9. A different paragraph;'},{number:3,targetLabel:'Paragraph 2',originalText:null,proposedText:null,textIntegrity:'incomplete'}];
  store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES (?,?,'amendment-list',?,?)").run(generation,'amendment:list:'+list,JSON.stringify({targetDocumentId:'A-10-2026-0001',itemNumberBegin:1,itemNumberEnd:3,extraction:{amendments:amendments.map(({number})=>({number}))}}),new Date(at).toISOString());
  store.db.prepare('INSERT INTO amendment_targets(generation,id,body) VALUES (?,?,?)').run(generation,'A-10-2026-0001','{}');
  for(const amendment of amendments) {
    const id='A-10-2026-0001-AM-'+amendment.number;
    store.db.prepare('INSERT INTO amendments(generation,id,target,date,outcome,body) VALUES (?,?,?,?,?,?)').run(generation,id,'A-10-2026-0001','2026-11-09',null,JSON.stringify({id,scope:'plenary',listId:list,targetDocumentId:'A-10-2026-0001',officialIds:['eli/dl/doc/'+id],language:'en',targetLabelLanguage:'en',baseline:'motion-resolution',baselineSource:{category:'motion-resolution',conflicted:false},textParserVersion:'27',textIntegrity:'complete',wordingSource:{url:docxUrl,language:'en'},sourceFreshness:{status:'fresh'},decisions:[],authors:[],gaps:[],sources:[],topics:[],documentReferences:[],originalFormatting:[],proposedFormatting:[],...amendment}));
  }
  return {...base,cacheDirectory};
}

test('held sources give what a reader would see, with no network call',async t=>{
  const {store,generation,cacheDirectory}=document(t);
  const calls=[],fetchBefore=globalThis.fetch;
  globalThis.fetch=(...args)=>{calls.push(args[0]);throw new Error('no network in this test');};
  t.after(()=>{globalThis.fetch=fetchBefore;});
  const evaluated=await evaluateList({store,listId:list,directory:cacheDirectory});
  assert.equal(evaluated.documentId,'A-10-2026-0001');
  assert.equal(evaluated.declared,3);
  assert.deepEqual(evaluated.amendments.map(row=>[row.id,row.outcome,row.language]),[
    ['A-10-2026-0001-AM-1','placed','en'],
    ['A-10-2026-0001-AM-2','withheld-pipeline','en'],
    ['A-10-2026-0001-AM-3','withheld-pipeline','en'],
  ]);
  assert.equal(evaluated.amendments[2].reason,'wording-incomplete');
  // The reader path, with the same clients, over the same rows.
  const clients=heldSourceClients({store,generation,directory:cacheDirectory});
  const context=new DocumentContext({request:clients.request,readText:clients.readText,readProposal:clients.readProposal,readCouncil:clients.readCouncil,readExistingLaw:clients.readExistingLaw,download:clients.download});
  for(const row of evaluated.amendments.slice(0,2)) {
    const read=await clients.run(()=>context.collect({id:row.documentId,amendmentId:row.id,listId:list,language:'en',wordingLanguage:'en',includeBody:true},amendmentById(store,{document:row.documentId,id:row.id,language:'en'}),null));
    assert.equal(read.placement.status==='placed',row.outcome==='placed');
    if(row.outcome!=='placed')assert.equal(read.placement.reason,row.reason);
  }
  assert.deepEqual(calls,[]);
});

test('a source that is not held is not a placement failure',async t=>{
  const {store,cacheDirectory}=document(t,{held:false});
  const evaluated=await evaluateList({store,listId:list,directory:cacheDirectory});
  assert.deepEqual([...new Set(evaluated.amendments.slice(0,2).map(row=>row.outcome))],['acquisition-unavailable']);
});

test('evaluation runs on its own thread, read-only, and returns exact identifiers only',async t=>{
  const {store,directory,cacheDirectory}=document(t);
  const before=store.db.prepare('SELECT COUNT(*) n FROM placement_log_failures').get().n;
  store.release();
  const evaluated=await evaluateOffThread({kind:'list',listId:list,indexDirectory:directory,cacheDirectory});
  assert.equal(evaluated.amendments[0].outcome,'placed');
  assert.equal(evaluated.evaluator,placementEvaluator());
  assert.equal(JSON.stringify(evaluated).includes('Calls on the Commission'),false);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM placement_log_failures').get().n,before);
  assert(store.acquire());
  await assert.rejects(evaluateOffThread({kind:'list',listId:'A-10-2026-0001-AM-001-003',indexDirectory:path.join(directory,'missing'),cacheDirectory}));
});

function laneFixture(t,{evaluate}={}) {
  const base=fixture(t);
  const logged=[];let clock=0;
  const lane=new PlacementLog(base.store,{evaluate,clock:base.store.clock,monotonic:()=>clock,log:value=>logged.push(value),cacheDirectory:'/nowhere',indexDirectory:'/nowhere'});
  return {...base,lane,logged,tick:ms=>{clock+=ms;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('the lane does nothing at idle and starts no thread',t=>{
  let started=0;
  const {store,lane}=laneFixture(t,{evaluate:async()=>{started++;}});
  assert.equal(lane.due(),false);
  assert.equal(lane.step(),false);
  assert.equal(started,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM placement_log_failures').get().n,0);
  // An unprepared database cannot make the lane fail before the writer acquires it.
  store.db.prepare("DELETE FROM meta WHERE key='placementLogSchema'").run();
  assert.equal(lane.due(),false);
});

test('one list at a time; the step never waits; the next list waits as long as the last took',async t=>{
  const pending=[];
  const {store,lane,tick,logged}=laneFixture(t,{evaluate:(job,{signal})=>new Promise(resolve=>pending.push({job,resolve,signal}))});
  const other='A-10-2026-0004-AM-001-001';
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list),row('A-10-2026-0004-AM-1',other)]);
  assert.equal(lane.due(),true);
  assert.equal(lane.step(),true);
  assert.equal(pending.length,1);
  assert.equal(lane.due(),false,'a running list is not due');
  assert.equal(lane.step(),false);
  assert.equal(pending.length,1);
  tick(4000);
  pending[0].resolve({...result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]),evaluator:'v1'});
  await settle();await settle();
  assert.equal(lane.due(),true,'a finished list waits for a lease to commit');
  assert.equal(lane.step(),false,'the commit leaves the next start for later');
  assert.equal(failures(store).length,1);
  assert.equal(store.get('placementLogEvaluator'),'v1');
  assert.deepEqual(logged,[{list,document:'A-10-2026-0001',amendments:1,placed:0,unplaced:1,new:1,reasons:{target_not_found:1},ms:4000}]);
  assert.equal(lane.due(),false);
  tick(4000);
  assert.equal(lane.due(),true);
  lane.step();
  assert.equal(pending.length,2);
  assert.equal(pending[1].job.listId,other);
  lane.stop();
  assert.equal(pending[1].signal.aborted,true);
  assert.equal(lane.due(),false);
});

test('no new failure, no log line; a re-evaluated failure is not new',async t=>{
  let answer;
  const {store,lane,tick,logged}=laneFixture(t,{evaluate:async()=>answer});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  answer={...result(list,[['A-10-2026-0001-AM-1','placed','placed']]),evaluator:'v1'};
  lane.step();await settle();await settle();lane.step();
  assert.deepEqual(logged,[]);
  store.db.prepare('UPDATE placement_log_lists SET next_check=0').run();
  tick(1);
  answer={...result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]),evaluator:'v1'};
  lane.step();await settle();await settle();lane.step();
  assert.equal(logged.length,1);
  store.db.prepare('UPDATE placement_log_lists SET next_check=0').run();
  tick(1);
  lane.step();await settle();await settle();lane.step();
  assert.equal(logged.length,1);
});

test('a thread that fails is retried, then reported, and is never a placement result',async t=>{
  const {store,lane,tick,logged,advance}=laneFixture(t,{evaluate:async()=>{throw Object.assign(new Error('out of memory'),{code:'ERR_WORKER_OUT_OF_MEMORY'});}});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  for(let attempt=0;attempt<PLACEMENT_LOG_LIMITS.attempts;attempt++) {
    assert.equal(lane.due(),true);
    lane.step();await settle();await settle();lane.step();
    advance(PLACEMENT_LOG_LIMITS.retryMs);tick(1);
  }
  assert.equal(listRow(store).state,'failed');
  assert.equal(listRow(store).error,'ERR_WORKER_OUT_OF_MEMORY');
  assert.equal(lane.due(),false);
  assert.equal(failures(store).length,0);
  assert.deepEqual(logged.map(line=>line.evaluation),['will-retry','will-retry','failed']);
  assert.match(placementLogReport(store.db,{since:'2026-11-01'}),/Could not evaluate\n  A-10-2026-0001-AM-001-003: ERR_WORKER_OUT_OF_MEMORY/);
});

test('losing the lease commits nothing and costs the writer nothing',async t=>{
  const {store,lane,logged}=laneFixture(t,{evaluate:async()=>({...result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]),evaluator:'v1'})});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  lane.step();await settle();await settle();
  store.release();
  assert.equal(lane.step(),false);
  assert.equal(failures(store).length,0);
  assert.equal(logged.length,1);
  assert.equal(listRow(store).state,'pending');
  assert.equal(hasDueList(store),true,'still due for the next owner');
});

test('a re-started writer re-checks open failures only when the placement code changed',async t=>{
  const jobs=[];let answer;
  const {store,lane}=laneFixture(t,{evaluate:async job=>{jobs.push(job.kind);return answer;}});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]),{evaluator:'v1'});
  store.set('placementLogEvaluator','v1');
  answer={evaluator:'v1'};
  assert.equal(lane.due(),true);
  lane.step();await settle();await settle();lane.step();
  assert.deepEqual(jobs,['evaluator']);
  assert.equal(hasDueList(store),false);
  const restarted=new PlacementLog(store,{evaluate:async job=>{jobs.push(job.kind);return {evaluator:'v2'};},log:()=>{},monotonic:()=>0});
  restarted.step();await settle();await settle();restarted.step();
  assert.equal(store.get('placementLogEvaluator'),'v2');
  assert.equal(hasDueList(store),true);
});

test('the report prints exact identifiers and reasons, on a read-only connection, with no wording',t=>{
  const {store,directory,advance}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-2','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-3','acquisition-unavailable','acquisition-source-not-held'],['A-10-2026-0001-AM-4','placed','placed'],['A-10-2026-0001-AM-5','not-applicable','language_version_unaffected']]));
  advance(86400_000);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','placed','placed'],['A-10-2026-0001-AM-2','withheld-pipeline','target_not_found'],['A-10-2026-0001-AM-3','acquisition-unavailable','acquisition-source-not-held'],['A-10-2026-0001-AM-4','placed','placed'],['A-10-2026-0001-AM-5','not-applicable','language_version_unaffected']]));
  store.release();store.close();
  const db=new DatabaseSync(path.join(directory,'activities-v1.sqlite'),{readOnly:true});t.after(()=>db.close());
  const report=placementLogReport(db,{since:'2026-11-01'});
  assert.match(report,/Lists first seen: 1 \(evaluated 1, waiting 0, could not evaluate 0\)/);
  assert.match(report,/target_not_found +1 +1 +1/);
  assert.match(report,/A-10-2026-0001-AM-001-003 \(A-10-2026-0001\): 1 open of 5 amendments/);
  assert.match(report,/target_not_found: A-10-2026-0001-AM-1\/en \(stopped 2026-11-10\) A-10-2026-0001-AM-2\/en/);
  assert.match(report,/acquisition-unavailable +acquisition-source-not-held +1 +0 +1/);
  assert.match(report,/2026-11-09 +1 +5 +2 +1 +1 +1 +66.7% +33.3%/);
  assert.equal(placementLogReport(db,{since:'2026-12-01'}).includes('target_not_found'),false);
  assert.throws(()=>db.exec("INSERT INTO meta VALUES ('x','1')"));
});

test('the report says plainly when the log has not started, and takes only its documented arguments',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  assert.match(placementLogReport(db,{since:'2026-11-01'}),/has not started/);
  assert.deepEqual(reportOptions(['--since','2026-10-01','--index-dir','/data/index'],{clock:()=>at}),{since:'2026-10-01',directory:'/data/index'});
  assert.throws(()=>reportOptions(['--since','yesterday','--index-dir','/data/index']),/Usage/);
  assert.equal(reportOptions(['--index-dir','/data/index'],{clock:()=>at}).since,'2026-11-02');
});

test('the writer gives the lane a turn under its lease, and its iteration does not wait for a running list',async t=>{
  const {store}=fixture(t);
  store.publish(store.get('working').generation);
  store.release();
  const worker=new ActivityWorker(store,{clock:store.clock,budget:1,fetchRecord:async()=>assert.fail('no source request')});
  worker.due=()=>false;
  let steps=0;
  const lane=new PlacementLog(store,{evaluate:()=>new Promise(()=>{}),log:()=>{},monotonic:()=>0,indexDirectory:'/nowhere',cacheDirectory:'/nowhere'});
  const step=lane.step.bind(lane);
  lane.step=()=>{steps++;assert.equal(store.renew(),true,'the turn runs under the lease');return step();};
  worker.placementLog=lane;
  assert(store.acquire());
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  store.release();
  await worker.runIteration();
  worker.stop();
  assert.equal(steps,1);
  assert.notEqual(lane.running,null,'the thread is still running after the iteration ended');
  assert.equal(lane.due(),false);
});

test('the response budget check agrees with JSON.stringify around its limit',()=>{
  const value=[{kind:'act',index:0,proposal:{paragraphs:[{text:'é"\\n',complete:true,none:null,skip:undefined}],count:12,ratio:1.5,list:[1,undefined,'x']}}];
  const size=Buffer.byteLength(JSON.stringify(value));
  assert.equal(jsonBytesOver(value,size),false);
  assert.equal(jsonBytesOver(value,size-1),true);
});

test('an amendment failing on two lists stays open on the one that still fails',t=>{
  const {store}=fixture(t);
  const other='A-10-2026-0001-AM-004-004';
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list),row('A-10-2026-0001-AM-1',other)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]));
  commitEvaluation(store,result(other,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]));
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','placed','placed']]));
  assert.deepEqual(failures(store).map(row=>[row.list_id,row.stopped_outcome]),[[list,'placed'],[other,null]]);
});

test('rows saved while a list was being read make it due again',t=>{
  const {store}=fixture(t);
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  const read=listRow(store).fingerprint;
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list,{proposedText:'re-saved'})]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','placed','placed']]),{fingerprint:read});
  assert.equal(listRow(store).next_check,store.clock());
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','placed','placed']]),{fingerprint:listRow(store).fingerprint});
  assert.equal(listRow(store).next_check,null);
});

test('a failed evaluator check is tried again after the pause',async t=>{
  let calls=0;
  const {store,lane,tick}=laneFixture(t,{evaluate:async()=>{calls++;if(calls===1)throw new Error('thread exited');return {evaluator:'v2'};}});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  commitEvaluation(store,result(list,[['A-10-2026-0001-AM-1','withheld-pipeline','target_not_found']]),{evaluator:'v1'});
  store.set('placementLogEvaluator','v1');
  for(let turn=0;turn<4&&store.get('placementLogEvaluator')!=='v2';turn++){tick(1);lane.step();await settle();await settle();}
  assert.equal(calls,2);
  assert.equal(store.get('placementLogEvaluator'),'v2');
});

test('the evaluator identity covers the placement rule files',()=>{
  assert.match(JSON.parse(placementEvaluator()).rules,/^[a-f0-9]{64}$/);
});

test('a provisional agreement is placed whole even without comparison wording, as the reader places it',async t=>{
  const {store,generation,cacheDirectory}=document(t);
  const input=provisionalFixture();
  const sha256=createHash('sha256').update(input.buffer).digest('hex'),request={accept:'*/*',language:'en'},key=baseSourceKey(input.source.url,request);
  writeFileSync(path.join(cacheDirectory,'base-sources-v1',sha256+'.blob'),input.buffer);
  writeFileSync(path.join(cacheDirectory,'base-sources-v1',key+'.json'),JSON.stringify({schemaVersion:1,key,url:input.source.url,request,status:200,fetchedAt:input.source.fetchedAt,sha256,bytes:input.buffer.length}));
  store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES (?,?,'amendment-list',?,?)").run(generation,'amendment:list:'+input.listId,JSON.stringify({targetDocumentId:input.documentId,itemNumberBegin:3,itemNumberEnd:3}),new Date(at).toISOString());
  const saved=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,input.id).body);
  store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(JSON.stringify({...saved,listId:input.listId,wordingSource:input.source,decisions:input.decisions}),generation,input.id);
  const evaluated=await evaluateList({store,listId:input.listId,directory:cacheDirectory});
  assert.deepEqual(evaluated.amendments.map(row=>[row.id,row.outcome,row.reason]),[[input.id,'placed','document-operation']]);
  const clients=heldSourceClients({store,generation,directory:cacheDirectory});
  const context=new DocumentContext({request:clients.request,readText:clients.readText,readProposal:clients.readProposal,readCouncil:clients.readCouncil,readExistingLaw:clients.readExistingLaw,download:clients.download});
  const read=await clients.run(()=>context.collect({id:input.documentId,amendmentId:input.id,listId:input.listId,language:'en',wordingLanguage:'en',includeBody:true},amendmentById(store,{document:input.documentId,id:input.id,language:'en'}),null));
  assert.equal(read.placement.status,'document-operation');
  assert.equal(read.placement.scope,'whole-document');
});

test('a list that could not be evaluated is retried when the evaluator changes, with no other failure open',async t=>{
  const jobs=[];
  const {store,lane}=laneFixture(t,{evaluate:async job=>{jobs.push(job.kind);throw new Error('thread exited');}});
  notePlacementLists(store,[row('A-10-2026-0001-AM-1',list)]);
  store.set('placementLogEvaluator','v1');
  store.db.prepare("UPDATE placement_log_lists SET state='failed',next_check=NULL,attempts=3,error='thread exited'").run();
  assert.equal(failures(store).length,0);
  assert.equal(hasDueList(store),false);
  const restarted=new PlacementLog(store,{evaluate:async job=>{jobs.push(job.kind);return {evaluator:'v2'};},log:()=>{},monotonic:()=>0,indexDirectory:'/nowhere',cacheDirectory:'/nowhere'});
  assert.equal(restarted.due(),true);
  restarted.step();await settle();await settle();restarted.step();
  assert.deepEqual(jobs,['evaluator','list'],'the failed list is read again at once');
  assert.equal(listRow(store).state,'pending');
  restarted.stop();lane.stop();
});

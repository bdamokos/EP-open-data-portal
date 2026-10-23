import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {memberVoteWeeks} from './member-vote-weeks.mjs';
import {followingResponse,followingIdsSql} from './insights-following.mjs';
import {activityOnly,motionDocuments} from './activity-read-projections.mjs';
import {discoverQuestionFiles,changedQuestionsSql,missingQuestionFilesSql} from './question-discovery.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';

const now=()=>Date.parse('2026-10-20T09:00:00Z'),fetched=new Date(now()).toISOString();
const key='/parliamentary-questions/E-10-2026-000001';
const file=(id,language)=>({language,is_embodied_by:[{format:'DOCX',is_exemplified_by:`https://data.europarl.europa.eu/distribution/test/${id}_${language}.docx`}]});
const question=(languages=['en','fr','hu'])=>({identifier:'E-10-2026-000001',document_date:'2026-10-01',originalLanguage:['hu'],is_realized_by:languages.map(language=>file('q',language)),
  inverse_answers_to:[{identifier:'E-10-2026-000001-ASW',document_date:'2026-10-10',is_realized_by:[file('answer','en')]}]});
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'remaining-reads-')),index=new ActivityStore(path.join(directory,'index'),{clock:now});index.acquire();
  const corpus=new CorpusStore(path.join(directory,'corpus'),{indexFile:index.filename,clock:now});corpus.acquire();
  t.after(()=>{corpus.close();index.close();rmSync(directory,{recursive:true,force:true});});
  return {index,corpus,worker:new CorpusWorker(corpus,{clock:now}),directory};
}
const plan=(db,sql,...args)=>db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(r=>r.detail).join('; ');

test('question discovery seeks manifests, anti-joins URLs and acknowledges only changed sources across publication',async t=>{
  const {index,corpus,worker}=fixture(t),cycle=index.beginCycle();index.putSource(cycle.generation,key,'document',question(),fetched);index.publish(cycle.generation);
  const projected=index.db.prepare('SELECT body FROM question_files WHERE generation=1 ORDER BY ordinal').all().map(r=>JSON.parse(r.body));
  assert.equal(projected.length,4);assert.deepEqual(projected.map(f=>f.language),['en','fr','hu','en']);
  const existing=projected[0];corpus.putDocument({sourceId:existing.sourceId,kind:existing.kind},[{sourceKey:'en',language:'en',translationType:'unspecified',sourceFormat:'docx',sourceUrl:existing.url,fetchedAt:fetched,body:'retained'}]);
  assert.match(plan(corpus.db,changedQuestionsSql,1,'','all'),/SEARCH source USING INDEX/);
  assert.match(plan(corpus.db,changedQuestionsSql,1,'','all'),/SEARCH seen USING INDEX/);
  assert.match(plan(corpus.db,missingQuestionFilesSql,1,key,'all'),/SEARCH text USING COVERING INDEX text_source_url/);
  await discoverQuestionFiles(worker,1);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='docx'").get().n,3);
  assert.equal(corpus.db.prepare(changedQuestionsSql).all(1,'','all').length,0);
  const next=index.beginCycle();assert.equal(next.generation,2);
  assert.equal(corpus.db.prepare(changedQuestionsSql).all(2,'','all').length,0,'copy retains the acknowledged file signature');
  index.putSource(2,key,'document',question(['en','fr','hu','de']),fetched);
  assert.equal(corpus.indexGeneration(),1,'working files cannot leak into the serving generation');
  await discoverQuestionFiles(worker,1);assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='docx'").get().n,3);
  index.publish(2);await discoverQuestionFiles(worker,2);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='docx'").get().n,4);
  assert.equal(corpus.db.prepare(changedQuestionsSql).all(2,'','all').length,0);
  index.putSource(2,key,'document',{...question(['en','fr','hu','de']),title_dcterms:{en:'New title'}},fetched);
  assert.equal(corpus.db.prepare(changedQuestionsSql).all(2,'','all').length,0,'unrelated metadata does not trigger corpus work');
  index.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(1,key);
  assert.equal(index.db.prepare('SELECT COUNT(*) n FROM question_files WHERE generation=1').get().n,0);
  assert.equal(index.db.prepare('SELECT COUNT(*) n FROM question_files WHERE generation=2').get().n,5);
});

test('policy widening, queue rollback and cancellation leave durable restartable discovery',async t=>{
  const {index,corpus,worker}=fixture(t);index.putSource(1,key,'document',question(),fetched);
  worker.languages='primary';await discoverQuestionFiles(worker,1);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,3);
  worker.languages='all';const enqueue=corpus.enqueue.bind(corpus);let calls=0;
  t.mock.method(corpus,'enqueue',(...args)=>{if(++calls===2)throw new Error('simulated failure');return enqueue(...args);});
  await assert.rejects(discoverQuestionFiles(worker,1),/simulated failure/);
  assert.equal(corpus.db.prepare('SELECT policy FROM question_discovery').get().policy,'primary');
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,3);
  t.mock.restoreAll();await discoverQuestionFiles(worker,1);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,4);
  index.putSource(1,key,'document',question(['en','fr','hu','de']),fetched);worker.stopped=true;
  await assert.rejects(discoverQuestionFiles(worker,1),/stopped/);
  assert.equal(corpus.db.prepare(changedQuestionsSql).all(1,'','all').length,0,'acknowledged source has its whole durable queue');
  worker.stopped=false;await discoverQuestionFiles(worker,1);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,5);
});

test('motion summaries and motion preparation use generation-local indexes through replacements and deletes',t=>{
  const {index}=fixture(t),sitting='MTG-PL-2026-10-19',sourceKey='motion-outcomes:'+sitting;
  index.putSource(1,sourceKey,'motion-outcomes',{decisions:[{id:'eli/dl/event/'+sitting+'-DEC-1'}],decisionsUrl:'unavailable'},fetched);
  index.set('active',1);
  assert.equal(memberVoteWeeks(index,{now:now()}).weeks[0].sittings[0].sourceUrl,null);
  assert.equal(memberVoteWeeks(index,{now:now()}).coverage.status,'partial');
  assert.match(plan(index.db,'SELECT source_key FROM motion_sitting_summary WHERE generation=? AND decisions_present=1 ORDER BY source_key DESC LIMIT 1001',1),/COVERING INDEX motion_sitting_weeks/);
  index.putSource(1,sourceKey,'motion-outcomes',{decisions:[{id:'eli/dl/event/MTG-PL-2026-10-18-DEC-1'}]},fetched);
  assert.equal(memberVoteWeeks(index,{now:now()}).weeks.length,0);
  index.putSource(1,'motion','document',{work_type:'RESOLUTION_MOTION',motionLinksVersion:1,document_date:'2026-01-01'},fetched);
  index.putSource(1,'ordinary','document',{work_type:'x/QUESTION_WRITTEN'},fetched);
  index.putSource(1,'object-motion','document',{work_type:{id:'x/RESOLUTION_MOTION_JOINT'},motionLinksVersion:1,document_date:'2026-01-01'},fetched);
  index.putSource(1,'lowercase','document',{work_type:'x/resolution_motion'},fetched);
  assert.deepEqual([...index.motionDocuments(1)].map(s=>s.key),['motion','object-motion']);
  assert.match(plan(index.db,'SELECT key,body,fetched_at FROM sources INDEXED BY motion_documents WHERE generation=? AND '+motionDocuments,1),/SEARCH sources USING INDEX motion_documents/);
  t.mock.method(index,'iterateSources',()=>assert.fail('full document scan'));
  new ActivityWorker(index,{clock:now}).prepareMotionOutcomes(1);
  index.putSource(1,'motion','document',{work_type:'x/REPORT_PLENARY'},fetched);
  assert.deepEqual([...index.motionDocuments(1)].map(s=>s.key),['object-motion']);
  index.db.prepare('DELETE FROM sources WHERE generation=1 AND key=?').run(sourceKey);
  assert.equal(index.db.prepare('SELECT COUNT(*) n FROM motion_sitting_summary').get().n,0);
});

test('saved counts cover exact distinct activity sources, excluding answers, with no body reads',t=>{
  const {index}=fixture(t);index.set('active',1);index.setMembers([{id:'42',name:'Member'}]);
  const rows=[{sourceId:'q',mepId:'42',category:'written-questions',date:'2026-10-01'},
    {sourceId:'q',mepId:'42',category:'oral-questions',date:'2026-10-01',recordKind:null},
    {sourceId:'a',mepId:'42',category:'written-questions',date:'2026-10-10',recordKind:'answer',relatedQuestionId:'q'}];
  index.putSource(1,'q','document',{},fetched,rows);
  const sql='SELECT COUNT(DISTINCT source_id) n FROM items INDEXED BY saved_activity_sources WHERE generation=? AND mep=? AND '+activityOnly;
  assert.match(plan(index.db,sql,1,'42'),/saved_activity_sources/);assert.doesNotMatch(plan(index.db,sql,1,'42'),/TEMP B-TREE/);
  // The partial predicate is proven by the index; SQLite must not fetch body.
  const bodyColumn=index.db.prepare('PRAGMA table_info(items)').all().find(r=>r.name==='body').cid;
  const opcodes=index.db.prepare('EXPLAIN '+sql).all(1,'42');
  const tableCursors=new Set(opcodes.filter(r=>r.opcode==='OpenRead'&&r.p4==='7').map(r=>r.p1));
  assert(!opcodes.some(r=>r.opcode==='Column'&&tableCursors.has(r.p1)&&r.p2===bodyColumn));
  index.publish(1);
  assert.match(plan(index.db,followingIdsSql,1,'42','42',1,'42','42'),/saved_activity_sources/);
  const result=followingResponse(index,'following-member',new URLSearchParams({epoch:index.get('marksEpoch'),generation:'1',member:'42'})).body;
  assert.equal(result.ids.filter(x=>x[1]===0).length,1);assert.equal(result.ids.filter(x=>x[1]===1).length,1);
  index.replaceRows(1,'q',[]);assert.equal(index.db.prepare(sql).get(1,'42').n,0);
});

test('offline preparation backfills new projections once while preserving bodies, generations and texts',t=>{
  const {index,corpus,directory}=fixture(t);index.putSource(1,key,'document',question(),fetched);index.set('active',1);
  const before=index.source(1,key);index.set('activityReadVersion',null);corpus.set('questionDiscoveryVersion',null);
  index.db.exec('DELETE FROM question_files; DELETE FROM question_file_sources; DROP INDEX saved_activity_sources;');
  index.release();corpus.release();
  assert.throws(()=>new ActivityStore(path.join(directory,'index')),/migrate-indexes/);
  assert.throws(()=>new CorpusStore(path.join(directory,'corpus'),{readOnly:true}),/migrate-indexes/);
  const options={activityDirectory:path.join(directory,'index'),corpusDirectory:path.join(directory,'corpus'),clock:now,log:()=>{}};
  assert(prepareIndexes(options).every(r=>!r.noop));
  assert.equal(index.db.prepare('SELECT COUNT(*) n FROM question_files').get().n,4);
  assert.deepEqual(index.source(1,key),before);assert.equal(index.get('active'),1);assert.equal(index.get('working'),null);
  assert(prepareIndexes(options).every(r=>r.noop));
});

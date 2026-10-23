import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';
import {followingResponse,followingStatus,followingIdsSql} from './insights-following.mjs';
import {documentRows} from './activity-index-model.mjs';

function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'follow-marks-'));
  let now=Date.parse('2026-10-23T10:00:00Z');
  const store=new ActivityStore(directory,{clock:()=>now});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  assert(store.acquire());
  const put=(generation,id,{date='2026-10-20',members=['42'],categories=['written-questions'],kind='document'}={})=>store.putSource(generation,id,'document',{},new Date(now).toISOString(),members.flatMap(mepId=>categories.map(category=>({sourceId:id,mepId,category,date,recordKind:kind,titles:{en:id,fr:'Titre '+id}}))));
  const read=(view,generation=store.get('active'),member='42',extra={})=>followingResponse(store,view,new URLSearchParams({epoch:store.get('marksEpoch'),generation,...(view==='following-member'?{member}:{}),...extra}));
  return {store,directory,put,read,tick:()=>{now+=1000;}};
}

test('only published identities get durable marks; backdates, categories, kinds and reappearance retain exact semantics',t=>{
  const {store,put,read,tick}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'},{id:'43'},{id:'44'}]);
  assert.equal(followingStatus(store).marksReady,false);
  assert.equal(read('following-manifest',g1).status,503);
  put(g1,'shared',{categories:['written-questions','oral-questions'],members:['42','43']});
  put(g1,'shared',{kind:'answer',categories:['written-questions','oral-questions'],members:['42','43']});
  // Same identity can be an activity and an answer in distinct category rows.
  store.db.prepare('UPDATE items SET body=? WHERE generation=? AND category=?').run(JSON.stringify({recordKind:'document'}),g1,'oral-questions');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM item_marks').get().n,0);
  store.publish(g1);tick();
  assert.deepEqual(read('following-manifest').body.members,{'42':[g1,g1,1,1],'43':[g1,g1,1,1],'44':[null,null,0,0]});
  assert.equal(store.get('markBaseline'),g1);
  assert.equal(followingStatus(store).publishedAt,'2026-10-23T10:00:00.000Z');
  const epoch=followingStatus(store).epoch;
  const g2=store.beginCycle().generation;
  put(g2,'late',{date:'2020-01-01',categories:['written-questions','oral-questions']});
  put(g2,'unpublished');
  assert.equal(store.db.prepare("SELECT mark FROM item_marks WHERE source_id='late'").get(),undefined);
  assert(!read('following-member',g1).body.ids.some(([id])=>id==='late'));
  store.enqueue(g2,'pending','document',{});
  assert.throws(()=>store.publish(g2),/incomplete generation/);
  assert.equal(store.get('active'),g1);
  assert.equal(store.db.prepare("SELECT mark FROM item_marks WHERE source_id='late'").get(),undefined);
  store.db.prepare('DELETE FROM tasks WHERE generation=?').run(g2);
  store.db.prepare("DELETE FROM items WHERE generation=? AND source_id='unpublished'").run(g2);
  store.publish(g2);
  assert.equal(followingStatus(store).epoch,epoch);
  assert.deepEqual(read('following-manifest').body.members['42'],[g2,g1,2,1]);
  assert.equal(read('following-member').body.ids.find(([id])=>id==='late')[2],g2);
  assert.equal(read('following-member').body.entries[0].id,'late');
  assert.equal(read('following-manifest',g1).status,200);
  // Frozen roster membership survives changes to the live roster.
  store.setMembers([{id:'99'}]);
  assert('42' in read('following-manifest').body.members);
  assert.equal(read('following-member',g1,'99').body.status,'outside-roster');
  const g3=store.beginCycle().generation;
  assert.equal(read('following-manifest',g1).status,409,'beginCycle prunes the previous snapshot with its items');
  assert.equal(store.db.prepare('SELECT 1 FROM follow_generations WHERE generation=?').get(g1),undefined);
  store.db.prepare("DELETE FROM items WHERE generation=? AND source_id='late'").run(g3);store.publish(g3);
  const g4=store.beginCycle().generation;put(g4,'late');store.publish(g4);
  assert.equal(store.db.prepare("SELECT mark FROM item_marks WHERE mep='42' AND kind='activity' AND source_id='late'").get().mark,g2);
  assert.equal(store.db.prepare('SELECT 1 FROM follow_summary WHERE generation=?').get(g2),undefined);
});

test('answers are marked separately for every exact question author',t=>{
  const {store,read}=fixture(t),generation=store.beginCycle().generation;
  store.setMembers([{id:'42'},{id:'43'}]);
  const work={identifier:'E-10-2026-000001',work_type:'QUESTION_WRITTEN',document_date:'2026-10-01',title_dcterms:{en:'Question',fr:'Question française'},parliamentary_term:'org/ep-10',creator:['person/42','person/43'],inverse_answers_to:[{identifier:'E-10-2026-000001-ASW',document_date:'2026-10-02'}]};
  const rows=documentRows(work,'/parliamentary-questions/'+work.identifier,'2026-10-23T10:00:00Z');
  assert.equal(rows.rows.filter(row=>row.recordKind==='answer').length,2);
  store.putSource(generation,'/parliamentary-questions/'+work.identifier,'document',work,'2026-10-23T10:00:00Z',rows.rows);
  store.publish(generation);
  for(const member of ['42','43']) {
    const body=read('following-member',generation,member,{lang:'fr'}).body;
    assert.equal(body.ids.length,2);
    const answer=body.entries.find(row=>row.kind==='answer');
    assert.equal(answer.title,'Question française');assert.equal(answer.titleLanguage,'fr');assert.equal(answer.relatedQuestionId,work.identifier);
  }
});

test('readiness distinguishes no publication, unknown roster and missing preparation; epochs change with the database',t=>{
  const {store,read}=fixture(t),initial=followingStatus(store);
  assert.equal(initial.generation,0);assert.equal(initial.marksReady,false);assert.equal(initial.indexComplete,false);assert.equal(initial.publishedAt,null);
  const generation=store.beginCycle().generation;store.publish(generation);
  assert.equal(followingStatus(store).marksReady,false);assert.equal(read('following-member').body.error.code,'marks_unavailable');
  store.setMembers([{id:'42'}]);assert.equal(followingStatus(store).marksReady,false,'a live roster cannot fill a published summary');
  store.set('followMarksVersion',null);assert.equal(followingStatus(store).marksReady,false);
  const other=fixture(t).store;assert.notEqual(other.get('marksEpoch'),initial.epoch);
});

test('offline preparation backfills previous before active, excludes work, fences leases, and runs once',t=>{
  const {store,directory,put,read}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'},{id:'43'}]);put(g1,'old');store.publish(g1);
  const g2=store.beginCycle().generation;put(g2,'new');store.publish(g2);
  // Simulate a retained previous generation alongside unfinished work without beginCycle pruning it.
  store.set('sequence',g2+1);store.set('working',{generation:g2+1});put(g2+1,'never-published');
  const readVersion=store.get('activityReadVersion');
  store.db.exec('DROP TABLE item_marks; DROP TABLE follow_summary; DROP TABLE follow_generations;');
  store.set('followMarksVersion',null);store.set('marksEpoch',null);
  assert.throws(()=>new ActivityStore(directory),/need preparation/);
  assert.throws(()=>prepareIndexes({activityDirectory:directory,log:()=>{}}),/lease is active/);
  store.release();
  const prepared=prepareIndexes({activityDirectory:directory,log:()=>{}});assert.equal(prepared[0].noop,false);
  assert.equal(store.get('activityReadVersion'),readVersion);assert.equal(store.get('markBaseline'),g2);
  assert.equal(read('following-member',g1).body.ids[0][2],g1);
  assert.deepEqual(new Map(read('following-member',g2).body.ids.map(([id,,mark])=>[id,mark])),new Map([['old',g1],['new',g2]]));
  assert.equal(store.db.prepare("SELECT 1 FROM item_marks WHERE source_id='never-published'").get(),undefined);
  assert.equal(followingStatus(store).marksReady,true);
  assert.equal(store.db.prepare('SELECT published_at FROM follow_generations WHERE generation=?').get(g1).published_at,null);
  const epoch=store.get('marksEpoch');assert.equal(prepareIndexes({activityDirectory:directory,log:()=>{}})[0].noop,true);assert.equal(store.get('marksEpoch'),epoch);
  store.set('active',g1);store.set('previous',g2);store.set('refreshPolicyGeneration',g1);
  assert.equal(followingStatus(store).generation,g1);assert.equal(read('following-manifest',g2).status,200,'retained recovery snapshots remain readable');
});

test('detail identities are complete and covering, while previews stop at 200 ordered by mark then date',t=>{
  const {store,put,read}=fixture(t),g1=store.beginCycle().generation;store.setMembers([{id:'42'}]);
  for(let n=0;n<205;n++)put(g1,'item-'+String(n).padStart(3,'0'),{categories:['written-questions','oral-questions']});
  store.publish(g1);const g2=store.beginCycle().generation;put(g2,'late',{date:'2020-01-01'});store.publish(g2);
  store.db.exec('PRAGMA query_only=ON');
  const body=read('following-member',g2,'42',{lang:'fr'}).body;
  assert.equal(body.ids.length,206);assert.equal(body.entries.length,200);assert.equal(body.truncated,6);assert.equal(body.entries[0].id,'late');assert.equal(body.entries[0].titleLanguage,'fr');
  const plan=store.db.prepare('EXPLAIN '+followingIdsSql).all(...Array(2).fill([g2,'42','42']).flat());
  const itemRoots=store.db.prepare("SELECT rootpage FROM sqlite_master WHERE name='items'").all().map(row=>row.rootpage);
  const itemCursors=plan.filter(row=>row.opcode==='OpenRead'&&itemRoots.includes(row.p2)).map(row=>row.p1);
  assert(!plan.some(row=>row.opcode==='Column'&&itemCursors.includes(row.p1)),'the identity query must not read item table bodies');
});


test('publication rolls back marks, summaries and timestamps together after a write failure',t=>{
  const {store,put,read}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'}]);put(g1,'old');store.publish(g1);
  const g2=store.beginCycle().generation;put(g2,'new');
  store.db.exec(`CREATE TRIGGER reject_summary BEFORE INSERT ON follow_summary WHEN NEW.generation=${g2} BEGIN SELECT RAISE(ABORT,'synthetic summary failure'); END`);
  assert.throws(()=>store.publish(g2),/synthetic summary failure/);
  assert.equal(store.get('active'),g1);assert.equal(store.get('working').generation,g2);
  assert.equal(store.db.prepare("SELECT 1 FROM item_marks WHERE source_id='new'").get(),undefined);
  assert.equal(store.db.prepare('SELECT 1 FROM follow_generations WHERE generation=?').get(g2),undefined);
  assert.equal(read('following-member',g1).body.ids.length,1);
});

test('frozen completeness retains published gaps independently of markers and live work',t=>{
  const {store,put,read}=fixture(t),generation=store.beginCycle().generation;
  store.setMembers([{id:'42'}]);put(generation,'old');
  store.db.prepare('INSERT INTO refresh_gaps(generation,key,kind,body,priority,error,attempts,failed_at,retry_at) VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'gap','document','{}',50,'unavailable',5,'2026-10-23',0);
  store.publish(generation);
  assert.equal(followingStatus(store).marksReady,true);assert.equal(followingStatus(store).indexComplete,false);
  assert.equal(read('following-manifest').body.indexComplete,false);
  store.set('followMarksVersion',null);assert.equal(read('following-member').status,503);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';
import {followingResponse,followingStatus,followingIdsSql} from './insights-following.mjs';
import {documentRows} from './activity-index-model.mjs';
import {freezeFollowSummary} from './follow-marks.mjs';

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
  assert.equal(read('following-manifest').body.rosterBasis,'publication');
  assert.equal(read('following-member',g1,'99').body.rosterBasis,'publication');
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
  store.transaction(()=>store.replaceRows(g3,'late',[]));store.publish(g3);
  const g4=store.beginCycle().generation;put(g4,'late');store.publish(g4);
  assert.equal(store.db.prepare("SELECT mark FROM item_marks WHERE mep='42' AND kind=0 AND source_id='late'").get().mark,g2);
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
  assert(store.db.prepare('SELECT 1 FROM follow_generations WHERE generation=?').get(generation),'publication metadata alone is insufficient');
  assert.equal(read('following-manifest').body.error.code,'marks_unavailable');
  store.setMembers([{id:'42'}]);assert.equal(followingStatus(store).marksReady,false,'a live roster cannot fill a published summary');
  const next=store.beginCycle().generation;store.publish(next);
  assert.equal(followingStatus(store).marksReady,true,'missing previous summary falls back to a full roster build');
  const empty=store.beginCycle().generation;store.setMembers([]);store.publish(empty);
  assert.equal(followingStatus(store).marksReady,false,'an empty roster cannot inherit readiness from the previous summary');
  store.setMembers([{id:'42'}]);assert.equal(read('following-manifest').status,503);
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
  assert.throws(()=>prepareIndexes({activityDirectory:directory,clock:store.clock,log:()=>{}}),/lease is active/);
  store.release();
  const prepared=prepareIndexes({activityDirectory:directory,clock:store.clock,log:()=>{}});assert.equal(prepared[0].noop,false);
  assert.equal(store.get('activityReadVersion'),readVersion);assert.equal(store.get('markBaseline'),g2);
  assert.equal(read('following-member',g1).body.ids[0][2],g1);
  for(const snapshot of [g1,g2]) {
    assert.equal(read('following-manifest',snapshot).body.rosterBasis,'preparation');
    const missing=read('following-member',snapshot,'99').body;
    assert.equal(missing.status,'outside-roster');assert.equal(missing.rosterBasis,'preparation');
  }
  assert.deepEqual(new Map(read('following-member',g2).body.ids.map(([id,,mark])=>[id,mark])),new Map([['old',g1],['new',g2]]));
  assert.equal(store.db.prepare("SELECT 1 FROM item_marks WHERE source_id='never-published'").get(),undefined);
  assert.equal(followingStatus(store).marksReady,true);
  assert.equal(store.db.prepare('SELECT published_at FROM follow_generations WHERE generation=?').get(g1).published_at,null);
  const epoch=store.get('marksEpoch');assert.equal(prepareIndexes({activityDirectory:directory,clock:store.clock,log:()=>{}})[0].noop,true);assert.equal(store.get('marksEpoch'),epoch);
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


test('incremental publication handles deletions, shared identities, kind changes and roster changes without probing unchanged marks',t=>{
  const {store,put,read}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'},{id:'43'},{id:'44'}]);
  put(g1,'unchanged',{members:['44']});put(g1,'base');put(g1,'removed',{members:['43']});
  const shared=(generation,key,category)=>store.transaction(()=>store.replaceRows(generation,key,[{sourceId:'shared',mepId:'42',category,date:'2026-01-01',recordKind:'document'}]));
  shared(g1,'left','oral-questions');shared(g1,'right','written-questions');store.publish(g1);
  const g2=store.beginCycle().generation;
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM follow_touched').get().n,0,'copying and pruning do not dirty unchanged sources');
  put(g2,'late',{date:'2020-01-01'});store.publish(g2);
  const g3=store.beginCycle().generation;
  store.transaction(()=>{store.replaceRows(g3,'left',[]);store.replaceRows(g3,'removed',[]);store.replaceRows(g3,'late',[]);});
  put(g3,'base',{kind:'answer'});put(g3,'new-roster',{members:['45']});
  store.setMembers([{id:'42'},{id:'44'},{id:'45'},{id:'46'}]);
  // A full assignment would attempt this INSERT even though it is ignored by the PK.
  store.db.exec("CREATE TRIGGER unchanged_marks BEFORE INSERT ON item_marks WHEN NEW.source_id='unchanged' BEGIN SELECT RAISE(ABORT,'unchanged identity scanned'); END");
  store.publish(g3);
  assert.deepEqual(read('following-manifest').body.members,{'42':[g1,g3,1,1],'44':[g1,null,1,0],'45':[g3,null,1,0],'46':[null,null,0,0]});
  assert.deepEqual(read('following-member').body.ids.map(([id,kind])=>[id,kind]).sort(),[['base',1],['shared',0]]);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM follow_touched').get().n,0);
  const incremental=read('following-manifest').body.members;
  store.transaction(()=>freezeFollowSummary(store.db,g3));
  assert.deepEqual(read('following-manifest').body.members,incremental,'delta summary equals a full distinct-identity build');
  const g4=store.beginCycle().generation;
  shared(g4,'replacement','written-questions'); // REPLACE displaces right through the items PK.
  const keys=store.db.prepare('SELECT source_key FROM follow_touched WHERE generation=? ORDER BY source_key').all(g4).map(row=>row.source_key);
  assert.deepEqual(keys,['replacement','right']);
  store.publish(g4);assert.equal(read('following-manifest').body.members['42'][2],1);
});

test('preparation upgrades integer marks without losing first appearance and captures pre-existing working deletions',t=>{
  const {store,directory,put,read}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'}]);put(g1,'old');store.publish(g1);
  const g2=store.beginCycle().generation;put(g2,'later');store.publish(g2);
  const g3=store.beginCycle().generation;store.transaction(()=>store.replaceRows(g3,'later',[]));
  const epoch=store.get('marksEpoch');
  store.db.exec(`ALTER TABLE item_marks RENAME TO integer_marks;
    CREATE TABLE item_marks(mep TEXT,kind TEXT,source_id TEXT,mark INTEGER,PRIMARY KEY(mep,kind,source_id));
    INSERT INTO item_marks SELECT mep,CASE kind WHEN 0 THEN 'activity' ELSE 'answer' END,source_id,mark FROM integer_marks;
    DROP TABLE integer_marks; DROP TABLE follow_touched; ALTER TABLE follow_generations DROP COLUMN roster_basis;`);
  store.set('followMarksVersion',1);store.release();
  prepareIndexes({activityDirectory:directory,log:()=>{}});
  assert.equal(store.get('marksEpoch'),epoch);
  assert.match(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='item_marks'").get().sql,/WITHOUT ROWID/);
  assert.equal(store.db.prepare("SELECT mark,typeof(kind) AS type FROM item_marks WHERE source_id='old'").get().mark,g1);
  assert.equal(store.db.prepare("SELECT typeof(kind) AS type FROM item_marks LIMIT 1").get().type,'integer');
  assert(store.acquire());store.publish(g3);
  assert.deepEqual(read('following-manifest').body.members['42'],[g1,null,1,0]);
  assert.equal(read('following-manifest').body.rosterBasis,'publication');
  assert.equal(read('following-manifest',g2).body.rosterBasis,'preparation');
});

test('live completeness remains a gate and failed publication retains touched sources for retry',t=>{
  const {store,put,read}=fixture(t),g1=store.beginCycle().generation;
  store.setMembers([{id:'42'}]);put(g1,'old');store.publish(g1);
  assert.equal(followingStatus(store).indexComplete,true);
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind) VALUES (?,'live-gap','document')").run(g1);
  assert.equal(followingStatus(store).indexComplete,false);
  store.db.prepare("DELETE FROM refresh_gaps WHERE key='live-gap'").run();
  const g2=store.beginCycle().generation;put(g2,'new');
  store.db.exec(`CREATE TRIGGER fail_publish BEFORE INSERT ON follow_generations WHEN NEW.generation=${g2} BEGIN SELECT RAISE(ABORT,'retry publication'); END`);
  assert.throws(()=>store.publish(g2),/retry publication/);
  assert.equal(store.db.prepare('SELECT source_key FROM follow_touched WHERE generation=?').get(g2).source_key,'new');
  assert.equal(store.beginCycle().generation,g2,'resume preserves touched sources');
  store.db.exec('DROP TRIGGER fail_publish');store.publish(g2);
  assert.deepEqual(read('following-manifest').body.members['42'],[g2,null,2,0]);
});

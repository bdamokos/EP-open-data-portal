import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {activityAvailability,indexAvailability} from './availability-evidence.mjs';

const at='2026-10-25T09:00:00.000Z';
function fixture(t) {
  const dir=mkdtempSync(path.join(os.tmpdir(),'activity-availability-'));
  const store=new ActivityStore(dir,{clock:()=>Date.parse(at)});assert(store.acquire());
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.set('lastSuccess','2026-10-23T01:43:08.951Z');store.set('availabilityRevision',42);
  let sequence=0;
  const insert=({generation=1,category='plenary-contributions',date='2026-10-20',mep='42',recordKind='speech'}={})=>{
    const id=String(++sequence);
    store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(generation,'/source/'+id,id,mep,category,date,JSON.stringify({recordKind}));
    return id;
  };
  return {store,insert};
}
// The previous aggregate defines the result contract, independently of the
// new index traversal. It is used only on this small synthetic fixture.
function aggregate(store,generation,{category=null,limited=false}={}) {
  const rows=store.db.prepare("SELECT category,MAX(date) date FROM items WHERE generation=? AND COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer' GROUP BY category").all(generation);
  return (category?[rows.find(row=>row.category===category)||{category,date:null}]:rows).map(row=>indexAvailability(store,{sourceKey:row.category,family:row.category.includes('questions')?'questions':row.category==='plenary-contributions'?'speeches':'documents',stage:'activity-role',generation,latestObservedDate:row.date,limited}));
}

test('role frontiers preserve cross-member, subtype, generation, gap and unavailable evidence',t=>{
  const {store,insert}=fixture(t);
  insert();insert({mep:'99',date:'2026-10-24'});insert({recordKind:'answer',date:'2026-10-25'});
  insert({category:'written-questions',recordKind:'document',date:'2026-09-01'});
  insert({category:'written-questions',recordKind:'answer',date:'2026-10-24'});
  insert({category:'unclassified-motions',recordKind:null,date:'2026-10-10'});
  insert({category:'stored-role',recordKind:'document',date:null});
  insert({generation:2,date:'2026-10-25'});
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (1,'speech-gap','speeches',?)").run(JSON.stringify({start:'2026-10-01',end:'2026-10-03'}));
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (1,'/parliamentary-questions/missing','document',?)").run(JSON.stringify({start:'2026-09-01',end:'2026-09-02'}));
  for(const options of [{},{limited:true},{category:'plenary-contributions'},{category:'written-questions',limited:true},{category:'reports-shadow'},{category:'stored-role'}])
    assert.deepEqual(activityAvailability(store,1,options),aggregate(store,1,options));
  const speech=activityAvailability(store,1,{category:'plenary-contributions'})[0];
  assert.equal(speech.latestObservedDate,'2026-10-24');assert.equal(speech.subtype,null);assert.equal(speech.stage,'activity-role');
  assert.equal(speech.publicationMaturity,'unknown');assert.equal(speech.authoritativeComplete,false);
  assert.deepEqual(speech.snapshot,{generation:1,revision:store.get('availabilityRevision')});assert.equal(speech.gaps[0].sourceId,'speech-gap');
  assert.equal(activityAvailability(store,1,{category:'reports-shadow'})[0].latestObservedDate,null);
  assert.deepEqual(activityAvailability(store,3),[]);
  // Preserve the existing treatment of a future maximum, rather than silently
  // replacing it with an earlier date and changing the availability contract.
  insert({date:'2099-01-01'});
  assert.deepEqual(activityAvailability(store,1),aggregate(store,1));
});

test('frontiers follow replacements, deletions and retained generations without a cache',t=>{
  const {store,insert}=fixture(t);
  const old=insert({date:'2026-10-01'}),latest=insert({date:'2026-10-20'});
  const date=()=>activityAvailability(store,1,{category:'plenary-contributions'})[0].latestObservedDate;
  assert.equal(date(),'2026-10-20');
  store.db.prepare('UPDATE items SET date=? WHERE source_id=?').run('2026-10-24',old);
  assert.equal(date(),'2026-10-24');
  store.db.prepare('UPDATE items SET body=? WHERE source_id=?').run('{"recordKind":"answer"}',old);
  assert.equal(date(),'2026-10-20');
  store.db.prepare('INSERT INTO items SELECT 2,source_key,source_id,mep,category,date,body FROM items WHERE generation=1').run();
  store.db.prepare('DELETE FROM items WHERE generation=1 AND source_id=?').run(latest);
  assert.equal(date(),null);assert.equal(activityAvailability(store,2)[0].latestObservedDate,'2026-10-20');
  assert.deepEqual(activityAvailability(store,1),aggregate(store,1));
});

test('each role frontier is a bounded index seek with no body reads or temporary grouping',t=>{
  const {store,insert}=fixture(t);insert();insert({category:'written-questions',recordKind:'document'});
  const prepare=store.db.prepare.bind(store.db),queries=[];
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes('INDEXED BY activity_role_frontier')) {
      const get=statement.get.bind(statement);
      statement.get=(...args)=>{queries.push({sql,args});return get(...args);};
    }
    return statement;
  });
  activityAvailability(store,1,{category:'plenary-contributions'});
  assert.equal(queries.length,1);assert.match(queries[0].sql,/category=\?/);
  const selected=[...queries];
  queries.length=0;activityAvailability(store,1);
  assert.equal(queries.length,3); // Two roles, then the end-of-index lookup.
  for(const {sql,args} of [...selected,...queries]) {
    const plan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH items USING (?:COVERING )?INDEX activity_role_frontier/);
    assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
    const program=prepare('EXPLAIN '+sql).all(...args);
    const tableCursor=program.find(row=>row.opcode==='OpenRead'&&row.p2===prepare("SELECT rootpage FROM sqlite_schema WHERE name='items'").get().rootpage)?.p1;
    assert(!program.some(row=>row.opcode==='Column'&&row.p1===tableCursor),'frontier must not fetch item bodies/table pages');
    assert.match(sql,/LIMIT 1$/);
  }
});

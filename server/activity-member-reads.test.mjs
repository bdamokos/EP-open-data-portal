import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {CATEGORIES} from './activity-index-model.mjs';

const at='2026-10-25T09:00:00.000Z';
const predicate="COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer'";
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'activity-member-reads-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const {generation}=store.beginCycle();store.setMembers([{id:'42',name:'Member'},{id:'99',name:'Other member'}]);
  const rows=[
    ['speech-a','plenary-contributions','2026-10-20','speech'],
    ['speech-b','plenary-contributions','2026-10-20','speech'],
    ['speech-c','plenary-contributions','2026-10-19','speech'],
    ['report','reports-rapporteur','2026-10-18','document'],
    ['report','reports-shadow','2026-10-18','document'],
    ['question','written-questions','2026-10-17','document'],
    ['answer','written-questions','2026-10-24','answer'],
    ['legacy','unclassified-motions','2026-10-16',null],
    ['extra','stored-role','2026-10-15',undefined],
  ];
  const insert=store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)');
  for(const [sourceId,category,date,recordKind] of rows) {
    const body={id:sourceId,sourceId,mepId:'42',category,date,recordKind,titles:{en:sourceId},files:[]};
    insert.run(generation,'/source/'+sourceId,sourceId,'42',category,date,JSON.stringify(body));
  }
  const other={id:'other',sourceId:'other',mepId:'99',category:'plenary-contributions',date:'2026-10-25',recordKind:'speech',titles:{en:'Other'},files:[]};
  insert.run(generation,'/other','other','99',other.category,other.date,JSON.stringify(other));
  store.publish(generation);
  return {store,generation};
}
// Independent table reads on a small fixture preserve the former count and
// ordering contract, including one source projected into multiple roles.
function expected(store,generation,category,limit=2,offset=0) {
  const where='generation=? AND mep=? AND '+predicate+(category?' AND category=?':'');
  const args=[generation,'42',...(category?[category]:[])];
  return {
    total:store.db.prepare('SELECT COUNT(*) n FROM items NOT INDEXED WHERE '+where).get(...args).n,
    rows:store.db.prepare('SELECT source_id,category FROM items NOT INDEXED WHERE '+where+' ORDER BY date DESC,source_id DESC,category LIMIT ? OFFSET ?').all(...args,limit,offset).map(row=>({...row})),
    counts:Object.fromEntries(store.db.prepare('SELECT category,COUNT(*) n FROM items NOT INDEXED WHERE generation=? AND mep=? AND '+predicate+' GROUP BY category').all(generation,'42').map(row=>[row.category,row.n])),
  };
}

test('member pages retain counts, role filters, source selection and pagination order',t=>{
  const {store,generation}=fixture(t);
  for(const category of [null,'plenary-contributions','reports-rapporteur','written-questions','oral-questions'])for(const offset of [0,1,2]) {
    const reference=expected(store,generation,category,2,offset);
    const page=store.page('42',{category,limit:2,offset,sourceId:'answer'});
    assert.equal(page.indexedTotal,reference.total);assert.equal(page.total,reference.total);
    assert.deepEqual(page.items.map(row=>({source_id:row.sourceId,category:row.category})),reference.rows);
    assert.equal(page.nextOffset,offset+page.items.length<reference.total?offset+page.items.length:null);
    for(const id of Object.keys(CATEGORIES))assert.equal(page.categoryCoverage[id].indexedCount,reference.counts[id]||0);
    assert.equal(page.unclassifiedMotionCount,1);
    assert.deepEqual(page.selectedItems.map(row=>[row.sourceId,row.recordKind]),[['answer','answer']]);
  }
  assert.equal(store.page('42').indexedTotal,8); // Answers excluded; both report roles retained.
  assert.equal(store.page('99').indexedTotal,1);assert.equal(store.page('100'),null);
});

test('member counts follow row eligibility, serving generation and incomplete coverage',t=>{
  const {store,generation}=fixture(t);
  const next=store.beginCycle();
  store.db.prepare("UPDATE items SET body=json_set(body,'$.recordKind','answer') WHERE generation=? AND source_id='speech-b'").run(next.generation);
  assert.equal(store.page('42').indexedTotal,8); // Unpublished rows do not change the serving generation.
  store.publish(next.generation);
  assert.equal(store.page('42').indexedTotal,7);
  store.db.prepare("DELETE FROM items WHERE generation=? AND source_id='speech-c'").run(next.generation);
  assert.equal(store.page('42',{category:'plenary-contributions'}).indexedTotal,1);
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,'missing','speeches','{}')").run(next.generation);
  const page=store.page('42',{category:'plenary-contributions'});
  assert.equal(page.total,null);assert.equal(page.indexedTotal,1);
  assert.equal(page.categoryCoverage['plenary-contributions'].status,'incomplete-joins');
  assert.equal(page.categoryCoverage['plenary-contributions'].total,null);
  assert.equal(page.categoryCoverage['union-act-proposals'].status,'source-not-verified');
  assert.equal(page.categoryCoverage['union-act-proposals'].total,null);
  assert.equal(page.availability[0].limited,true);
  assert.equal(page.availability[0].gaps[0].sourceId,'missing');
  assert.equal(expected(store,generation,null).total,8);
});

test('actual member counts are index-only and filtered pages avoid sorting or JSON evaluation',t=>{
  const {store}=fixture(t),prepare=store.db.prepare.bind(store.db),queries=[];
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes('INDEXED BY activity_member_roles'))for(const method of ['get','all']) {
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>{queries.push({sql,args});return execute(...args);};
    }
    return statement;
  });
  store.page('42');store.page('42',{category:'plenary-contributions',limit:2,offset:1});
  assert.equal(queries.length,5); // Two total counts, two category counts, one filtered page.
  const tableRoot=prepare("SELECT rootpage FROM sqlite_schema WHERE name='items'").get().rootpage;
  for(const {sql,args} of queries) {
    const plan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
    assert.match(plan,/activity_member_roles \(generation=\? AND mep=\?/);
    assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
    const program=prepare('EXPLAIN '+sql).all(...args);
    assert(!program.some(row=>row.opcode==='Function'&&/json_extract/.test(row.p4)),'eligibility must come from the partial index');
    if(sql.includes('COUNT(*)')) {
      const tableCursor=program.find(row=>row.opcode==='OpenRead'&&row.p2===tableRoot)?.p1;
      assert(!program.some(row=>row.opcode==='Column'&&row.p1===tableCursor),'counts must not read table columns');
    } else assert.match(plan,/category=\?/);
  }
});

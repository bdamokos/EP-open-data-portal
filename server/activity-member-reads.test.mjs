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
// Independent table reads on a small fixture verify the default document feed and explicit role
// ordering contract, including one source projected into multiple roles.
function expected(store,generation,category,limit=2,offset=0) {
  const where='generation=? AND mep=? AND '+predicate+(category?' AND category=?':" AND category<>'plenary-contributions'");
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
  assert.equal(store.page('42').indexedTotal,5); // Speeches and answers excluded; both report roles retained.
  assert.equal(store.page('99').indexedTotal,0);assert.equal(store.page('100'),null);
});

test('member counts follow row eligibility, serving generation and incomplete coverage',t=>{
  const {store,generation}=fixture(t);
  const next=store.beginCycle();
  store.db.prepare("UPDATE items SET body=json_set(body,'$.recordKind','answer') WHERE generation=? AND source_id='speech-b'").run(next.generation);
  assert.equal(store.page('42').indexedTotal,5); // Unpublished rows do not change the serving generation.
  store.publish(next.generation);
  assert.equal(store.page('42').indexedTotal,5);
  store.db.prepare("DELETE FROM items WHERE generation=? AND source_id='speech-c'").run(next.generation);
  assert.equal(store.page('42',{category:'plenary-contributions'}).indexedTotal,1);
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,'missing','speeches','{}')").run(next.generation);
  const page=store.page('42',{category:'plenary-contributions'});
  assert.equal(page.total,1);assert.equal(page.indexedTotal,1);
  assert.equal(page.categoryCoverage['plenary-contributions'].status,'available');
  assert.equal(page.categoryCoverage['plenary-contributions'].total,1);
  assert.equal(page.categoryCoverage['union-act-proposals'].status,'source-not-verified');
  assert.equal(page.categoryCoverage['union-act-proposals'].total,null);
  assert.equal(page.availability[0].limited,false);
  assert.equal(page.availability[0].gaps[0].sourceId,'missing');
  assert.equal(expected(store,generation,null).total,5);
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


test('refresh gaps qualify only their projected member and roles',t=>{
  const {store,generation}=fixture(t);
  const gap=store.db.prepare('INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,?,?)');
  gap.run(generation,'/source/report','document','{}');
  assert.equal(store.page('42',{category:'reports-rapporteur'}).total,null);
  assert.equal(store.page('42').categoryCoverage['reports-shadow'].status,'incomplete-joins');
  assert.equal(store.page('99',{category:'reports-rapporteur'}).total,0);
  assert.equal(store.page('42',{category:'written-questions'}).total,1);
  gap.run(generation,'recovery:/source/speech-a','speeches','{}');
  assert.equal(store.page('42',{category:'plenary-contributions'}).total,null);
  assert.equal(store.page('99',{category:'plenary-contributions'}).total,1);
  store.db.prepare("DELETE FROM refresh_gaps WHERE generation=? AND key='/source/report'").run(generation);
  assert.equal(store.page('42').total,5); // Default feed excludes plenary contributions.
  store.db.prepare('DELETE FROM refresh_gaps WHERE generation=?').run(generation);
  assert.equal(store.page('42',{category:'reports-rapporteur'}).total,1);
});

test('unattributed matching windows stay global even during the member term',t=>{
  const {store,generation}=fixture(t);
  store.db.prepare('INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,?,?)')
    .run(generation,'catalog:/parliamentary-questions','catalog',JSON.stringify({endpoint:'/parliamentary-questions',start:'2026-10-01',end:'2026-10-31'}));
  const page=store.page('42',{category:'written-questions'});
  assert.equal(page.total,1);assert.equal(page.categoryCoverage['written-questions'].status,'available');
  assert.equal(store.status().coverageGaps.count,1);assert.equal(store.status().complete,false);
  assert(page.availability.some(source=>source.gaps.length));
});

test('cold and repeated profile reads never aggregate global status',t=>{
  const {store}=fixture(t),prepare=store.db.prepare.bind(store.db),queries=[];
  t.mock.method(store,'status',()=>{throw Error('profile must not call status');});
  t.mock.method(store.db,'prepare',sql=>{queries.push(sql);return prepare(sql);});
  store.page('42',{category:'written-questions'});store.page('99');
  assert(!queries.some(sql=>/COUNT\s*\(|GROUP BY/i.test(sql)&&!/FROM items/i.test(sql)),queries.join('\n'));
  const scoped=queries.find(sql=>sql.includes('SELECT DISTINCT item.category'));
  const plan=prepare('EXPLAIN QUERY PLAN '+scoped).all(store.get('active'),'42').map(row=>row.detail).join('\n');
  assert.doesNotMatch(plan,/SCAN (?:item|gap)/);assert.match(plan,/generation=\? AND source_key=\?/);
});

test('initial activity backfill and unreconciled snapshots retain their coverage states',t=>{
  const {store,generation}=fixture(t);
  store.set('active',null);store.set('refreshPolicyGeneration',null);
  assert.equal(store.page('42',{category:'written-questions'}).categoryCoverage['written-questions'].status,'backfilling');
  store.set('active',generation);store.set('refreshPolicyGeneration',generation+1);
  assert.equal(store.page('42',{category:'written-questions'}).categoryCoverage['written-questions'].status,'incomplete-joins');
});


test('gap queue aliases use the worker endpoint and exact speech recovery identity',t=>{
  const {store,generation}=fixture(t),gap=store.db.prepare('INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,?,?)');
  gap.run(generation,'retry:question','document',JSON.stringify({endpoint:'/source/question'}));
  assert.equal(store.page('42',{category:'written-questions'}).total,null);
  assert.equal(store.page('99',{category:'written-questions'}).total,0);
  store.db.prepare("UPDATE items SET source_key='/speeches/speech-a' WHERE source_id='speech-a'").run();
  gap.run(generation,'retry:speech','speeches',JSON.stringify({recoveryId:'speech-a'}));
  assert.equal(store.page('42',{category:'plenary-contributions'}).total,null);
  assert.equal(store.page('99',{category:'plenary-contributions'}).total,1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { projectDocument,documentRows } from './activity-index-model.mjs';
import { analyzeQuestions,questionFromSource,demographicStats,ageAt,personId } from './insights-model.mjs';
import { QuestionInsights,insightQuery,savedMetadata } from './insights-store.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url)));
const question=fixture.documents.find(d=>d.endpoint.startsWith('/parliamentary-questions'));
const now=()=>Date.parse('2026-10-14T11:00:00Z');
const from=(work,key=question.endpoint)=>questionFromSource({work,key,fetchedAt:fixture.verifiedAt});

test('question authors and named voters resolve only exact official person identities',()=>{
  assert.equal(personId('person/257043'),'257043');
  assert.equal(personId({id:'https://data.europarl.europa.eu/person/257043'}),'257043');
  for(const ref of ['https://example.org/person/257043','other/person/257043','person/0257043','person/9007199254740992','https://data.europarl.europa.eu/person/257043?x=1','https://user@data.europarl.europa.eu/person/257043'])assert.equal(personId(ref),null);
});

test('saved demographics select the matching person and retain explicit values without guessing',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insight-metadata-test-'));
  const write=(endpoint,params,data,fetchedAt=now(),legacy=false)=>{
    const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
    const filename=legacy?Buffer.from(url.href).toString('base64url'):createHash('sha256').update(url.href).digest('hex');
    writeFileSync(path.join(directory,filename+'.json'),JSON.stringify({url:url.href,fetchedAt,payload:{data}}));
  };
  try {
    write('/meps/show-current',{limit:1000,offset:0},[{id:'person/1',hasGender:'authority/FEMALE'},{id:'person/2'},{id:'person/3'},{id:'person/4'}]);
    write('/meps/1',{},[{id:'org/not-person',hasGender:'authority/MALE'},{id:'person/1',bday:'1990-01-01'}]);
    write('/meps/2',{},[{id:'person/999',hasGender:'authority/MALE'}]);
    write('/meps/3',{},[{id:'person/3',hasGender:'authority/MALE'}],null);
    write('/meps/4',{},[{id:'person/4',hasGender:'authority/MALE'}],now(),true);
    const members=new Map(['1','2','3','4'].map(id=>[id,{id}]));
    const metadata=await savedMetadata({directory,members});
    assert.equal(metadata.get('1').hasGender,'authority/FEMALE');assert.equal(metadata.get('1').bday,'1990-01-01');
    assert.equal(metadata.get('2').hasGender,undefined);assert.equal(metadata.get('3').hasGender,undefined);
    assert.equal(metadata.get('4').hasGender,'authority/MALE');
    assert.deepEqual(demographicStats([...members.keys()],members,metadata,'2026-10-14').dimensions.gender,[{label:'Unknown',count:2},{label:'Female',count:1},{label:'Male',count:1}]);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('real Blue Flag question deduplicates all 30 documented co-authors and retains separate answer dates/institution',()=>{
  const q=from(question.work);
  assert.equal(q.id,'E-10-2026-003031');assert.equal(q.date,'2026-07-16');
  assert.equal(q.authors.length,30);assert.equal(new Set(q.authors.map(p=>p.id)).size,30);
  assert(q.authors.some(p=>p.id==='257043'));
  assert.equal(q.answers[0].id,'E-10-2026-003031-ASW');assert.equal(q.answers[0].date,'2026-09-18');
  assert(q.answers[0].creatorUris.every(p=>!p.startsWith('person/')));
  const a=analyzeQuestions([q,q]);assert.equal(a.questions.length,1);assert.equal(a.words.find(w=>w.word==='blue-flag-programme').questionCount,1);
});
test('deterministic title clustering uses related title words; missing English and isolated questions stay unassigned',()=>{
  const q=from(question.work);
  const copy=(id,title)=>({...q,id,titles:{en:title}});
  const input=[copy('E-10-2026-000002','Protecting blue flag beaches'),copy('E-10-2026-000001','Blue flag programme beaches'),copy('E-10-2026-000003','Mineral extraction safety'),{...q,id:'E-10-2026-000004',titles:{hu:'Kék zászló'}}];
  const a=analyzeQuestions(input),b=analyzeQuestions([...input].reverse());
  assert.deepEqual(a,b);assert.equal(a.clusters.length,1);assert.equal(a.clusters[0].questionCount,2);assert.equal(a.analysis.missingEnglishTitles,1);assert.equal(a.analysis.unassignedQuestions,2);
  assert.equal(a.words.find(w=>w.word==='blue').questionCount,2);
});
test('current unique-person denominator excludes people outside roster; absent gender and invalid birthday stay Unknown',()=>{
  const members=[{id:'1',name:'One'},{id:'2',name:'Two'},{id:'3',name:'Three'}];
  const metadata=new Map([['1',{'api:country-of-representation':'HU','api:political-group':'PPE',hasGender:'authority/FEMALE',bday:'1980-10-15'}],['2',{hasGender:'authority/NKN',bday:'2026-99-99'}]]);
  const s=demographicStats(['1','1','2','3','99'],members,metadata,'2026-10-14');
  assert.equal(s.uniquePeople,4);assert.equal(s.uniqueCurrentMeps,3);assert.equal(s.peopleOutsideCurrentRoster,1);
  assert.equal(s.dimensions.gender.find(d=>d.label==='Unknown').count,2);assert(!s.dimensions.gender.some(d=>d.label==='Male'));
  for(const values of Object.values(s.dimensions))assert.equal(values.reduce((n,v)=>n+v.count,0),3);
  assert.equal(ageAt('1980-10-15','2026-10-14'),45);assert.equal(ageAt('1980-10-15','2026-10-15'),46);assert.equal(ageAt('2020-02-30','2026-10-14'),null);
});
test('strict query rejects unknown/repeated parameters, invalid dates/windows and over-limit paging',()=>{
  const q=s=>insightQuery(new URLSearchParams(s),{now:now()});
  assert.equal(q('days=90').start,'2026-07-17');assert.equal(q('days=1&end=2026-07-16').start,'2026-07-16');
  for(const s of ['days=822','days=-1','days=30&days=30','end=2026-02-30','end=2026-10-15','foo=1','offset=5001','lang=xx','end=2024-07-16&days=2','cluster=bad','word=%3Cscript%3E'])assert.throws(()=>q(s),e=>e.status===400,s);
});
test('analysis periods cover the full current term without a fixed day cap',()=>{
  const q=s=>insightQuery(new URLSearchParams(s),{now:now()});
  const term=q('days=term');
  assert.equal(term.start,'2024-07-16');assert.equal(term.end,'2026-10-14');assert.equal(term.days,821);
  assert.equal(q('days=366').start,'2025-10-14');assert.equal(q('days=821').start,term.start);
  assert.equal(q('days=term&end=2024-07-16').days,1);
  assert.equal(q('days=term&end=2024-12-31').start,term.start);
  assert.equal(q('days=term&from=2024-07-16&to=2024-07-17').from,term.start);
  const midnight=insightQuery(new URLSearchParams('days=term'),{now:Date.parse('2026-10-14T22:30:00Z')});
  assert.equal(midnight.end,'2026-10-15');assert.equal(midnight.days,822);
  const leap=insightQuery(new URLSearchParams('days=term&end=2028-03-01'),{now:Date.parse('2028-03-01T12:00:00Z')});
  assert.equal(leap.start,term.start);assert(leap.days>1000);
  for(const s of ['days=all','days=term&days=90','days=term&end=2024-07-15','days=term&end=2026-02-30','days=term&end=2026-10-15','days=term&from=2024-07-15&to=2024-07-16','days=9007199254740992'])assert.throws(()=>q(s),e=>e.status===400,s);
});
test('saved aggregation filters QUESTION document_date, deduplicates coauthors, never selects answers, and cannot change SQL state',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'insights-test-')),store=new ActivityStore(dir,{clock:now});
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers(question.work.workHadParticipation.flatMap(p=>p.had_participant_person||[]).filter(p=>p.startsWith('person/')).map(p=>({id:p.split('/').at(-1),name:p})));
    store.putSource(generation,question.endpoint,'document',projectDocument(question.work),fixture.verifiedAt,documentRows(question.work,question.endpoint,fixture.verifiedAt).rows);
    store.enqueue(generation,'pending','speeches',{},0);
    const before=store.db.prepare('SELECT * FROM meta ORDER BY key').all(),lease=store.db.prepare('SELECT * FROM lease').all(),tasks=store.db.prepare('SELECT * FROM tasks').all();
    // query_only makes every accidental mutation a test failure, including PRAGMAs/DDL.
    store.db.exec('PRAGMA query_only=ON');
    let loads=0;const insights=new QuestionInsights(store,{clock:now,loadMetadata:async()=>{loads++;return new Map();}});
    const q=s=>insightQuery(new URLSearchParams(s),{now:now()});
    const july=await insights.query(q('days=1&end=2026-07-16'));
    assert.equal(july.counts.indexedMatchingQuestions,1);assert.equal(july.questions.length,1);assert.equal(july.stats.uniquePeople,30);assert.equal(july.counts.totalQuestions,null);assert.equal(july.coverage.indexComplete,false);
    await insights.query(q('days=1&end=2026-07-16&word=blue'));assert.equal(loads,1);
    const answerDate=await insights.query(q('days=1&end=2026-09-18'));assert.equal(answerDate.counts.indexedMatchingQuestions,0);assert.equal(answerDate.counts.totalQuestions,null);
    assert.deepEqual(store.db.prepare('SELECT * FROM meta ORDER BY key').all(),before);assert.deepEqual(store.db.prepare('SELECT * FROM lease').all(),lease);assert.deepEqual(store.db.prepare('SELECT * FROM tasks').all(),tasks);
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});}
});

test('explorers reuse saved demographic metadata across date windows and refresh after five minutes',async()=>{
  const {createInsights}=await import('./insights.mjs');
  const dir=mkdtempSync(path.join(os.tmpdir(),'insights-shared-metadata-')),store=new ActivityStore(dir);
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043',name:'Maravillas Abadía Jover'}]);
    store.putSource(generation,question.endpoint,'document',projectDocument(question.work),fixture.verifiedAt,documentRows(question.work,question.endpoint,fixture.verifiedAt).rows);
    let time=now(),loads=0;const service=createInsights(store,{clock:()=>time,loadMetadata:async()=>{loads++;return new Map([['257043',{hasGender:'authority/FEMALE'}]]);}});
    await Promise.all([service.query('questions',new URLSearchParams('days=1&end=2026-07-16')),service.query('questions',new URLSearchParams('days=2&end=2026-07-16'))]);
    assert.equal(loads,1);
    time+=61_000;await service.query('questions',new URLSearchParams('days=1&end=2026-07-16'));assert.equal(loads,1);
    time+=300_001;const result=await service.query('questions',new URLSearchParams('days=1&end=2026-07-16'));assert(result.viewCache.stale);await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,2);assert.deepEqual(result.stats.dimensions.gender,[{label:'Female',count:1}]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('undated question coverage uses only the existing partial index and preserves date/type scope',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'undated-question-index-'));
  const store=new ActivityStore(directory,{clock:now});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  assert(store.acquire());const {generation}=store.beginCycle();store.setMembers([{id:'42',name:'Member'}]);
  const insert=store.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,1)');let sequence=0;
  const save=(type,date,extra={})=>{
    const id='E-10-2026-'+String(++sequence).padStart(6,'0');
    const work={identifier:id,work_type:type,title_dcterms:{en:'Question '+id},creator:['person/42'],...(date===undefined?{}:{document_date:date})};
    insert.run(extra.generation??generation,(extra.prefix??'/parliamentary-questions/')+id,extra.kind??'document',JSON.stringify(work),new Date(now()).toISOString());
  };
  for(const type of ['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL']) {
    for(const date of [undefined,null,''])save('def/'+type,date);
    save('def/'+type,'2026-10-01');
  }
  save('def/QUESTION_WRITTEN',null,{prefix:'/different-source/'}); // Scope is work type, not key prefix.
  save('def/question_written',null); // Preserve SQLite LIKE's existing ASCII case behavior.
  save('QUESTION_WRITTEN',null);save('def/QUESTION_WRITTEN_ANSWER',null);save('def/REPORT_PLENARY',null);
  save('def/QUESTION_WRITTEN',' ');save('def/QUESTION_WRITTEN','invalid');
  save('def/QUESTION_WRITTEN',null,{kind:'catalog'});
  save('def/QUESTION_WRITTEN',null,{generation:generation+1});
  const prepare=store.db.prepare.bind(store.db),queries=[];
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes('INDEXED BY question_window')) {
      const get=statement.get.bind(statement);
      statement.get=(...args)=>{queries.push({sql,args});return get(...args);};
    }
    return statement;
  });
  store.db.exec('PRAGMA query_only=ON');
  const result=await new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()})
    .query(insightQuery(new URLSearchParams('days=90&lang=hu'),{now:now()}));
  assert.equal(result.coverage.undatedQuestions,11);assert.equal(result.counts.indexedMatchingQuestions,3);
  assert.equal(result.counts.totalQuestions,null);assert.equal(result.coverage.indexComplete,false);
  assert.equal(queries.length,1,'only the undated count is pinned to this index');
  const {sql,args}=queries[0];
  const original=sql.replace(' INDEXED BY question_window',' NOT INDEXED');
  assert.equal(prepare(original).get(...args).n,result.coverage.undatedQuestions);
  const plan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH sources USING INDEX question_window \(generation=\?\)/);assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
  const program=prepare('EXPLAIN '+sql).all(...args),root=prepare("SELECT rootpage FROM sqlite_schema WHERE name='sources'").get().rootpage;
  const tableCursors=new Set(program.filter(row=>row.opcode==='OpenRead'&&row.p2===root).map(row=>row.p1));
  assert(!program.some(row=>row.opcode==='Column'&&tableCursors.has(row.p1)),'undated count must not read source-table columns');
  assert(!program.some(row=>row.opcode==='Function'&&/json_extract/.test(row.p4)),'undated count must not parse source JSON');
  store.db.exec('PRAGMA query_only=OFF');
});

test('subject filters validate exact place IDs and reject labels, unknown and repeated IDs',()=>{
  assert.equal(insightQuery(new URLSearchParams('subject=USA'),{now:now()}).subject,'USA');
  for(const value of ['subject=','subject=US','subject=usa','subject=United+States','subject=ZZZ','subject=USA&subject=FRA'])assert.throws(()=>insightQuery(new URLSearchParams(value),{now:now()}),error=>error.status===400);
});

test('subject selection matches aliases by place ID, intersects filters and retains empty/incomplete states without writes',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'subject-query-test-')),store=new ActivityStore(directory);
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'1',name:'One',countryCode:'IT'},{id:'2',name:'Two',countryCode:'ES'}]);
    const titles=['US pharmaceutical policies','United States energy security','France pharmaceutical policies','Medicines without a place','U.S. medicines in France'];
    for(const [i,title] of titles.entries()) {
      const work={...question.work,id:'eli/dl/doc/E-10-2026-00000'+(i+1),identifier:'E-10-2026-00000'+(i+1),title_dcterms:{en:title},is_realized_by:[],workHadParticipation:i===3?[]:[{participation_role:'def/ep-roles/ADDRESSEE',had_participant_organization:['org/'+([1,2].includes(i)?'CS':'COM')]}],document_date:'2026-10-0'+(i+1),creator:['person/'+(i===1?'2':'1')],inverse_answers_to:[]},key='/parliamentary-questions/'+work.identifier;
      store.putSource(generation,key,'document',projectDocument(work),fixture.verifiedAt,documentRows(work,key,fixture.verifiedAt).rows);
    }
    store.db.exec('PRAGMA query_only=ON');
    const service=new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()}),query=s=>service.query(insightQuery(new URLSearchParams('days=30&'+s),{now:now()}));
    const selected=await query('subject=USA');assert.equal(selected.counts.selectedQuestions,3);assert.equal(selected.selection.subjectLabel,'United States');
    assert(selected.questions.every(q=>q.places.some(p=>p.id==='USA')));assert.equal(selected.coverage.indexComplete,false);assert.equal(selected.counts.totalQuestions,null);
    assert.equal(selected.trend.bins.reduce((n,b)=>n+b.total,0),3);
    assert.equal(selected.facets.countries.find(c=>c.code==='IT').count,2);assert.equal(selected.facets.countries.find(c=>c.code==='ES').count,1);
    assert.equal(selected.facets.addressees.find(a=>a.id==='org/COM').count,2);assert.equal(selected.facets.addressees.find(a=>a.id==='org/CS').count,1);
    const recipient=await query('subject=USA&addressee=org/CS');assert.equal(recipient.counts.selectedQuestions,1);assert.equal(recipient.questions[0].title,'United States energy security');assert.equal(recipient.trend.bins.reduce((n,b)=>n+b.total,0),1);assert.equal(recipient.facets.addressees.find(a=>a.id==='org/COM').count,2);
    const intersect=await query('subject=USA&addressee=org/COM&country=IT&from=2026-10-01&to=2026-10-03');assert.equal(intersect.counts.selectedQuestions,1);assert.equal(intersect.selectedStats.uniqueCurrentMeps,1);
    assert.equal((await query('subject=USA&word=pharmaceutical')).counts.selectedQuestions,1);
    const page=await query('subject=USA&limit=1&offset=1');assert.equal(page.questions.length,1);assert.equal(page.nextOffset,2);
    const empty=await query('subject=DEU');assert.equal(empty.counts.selectedQuestions,0);assert.equal(empty.selection.subjectLabel,'Germany');assert.equal(empty.coverage.indexComplete,false);
    assert.equal((await query('')).counts.selectedQuestions,5);
  } finally {store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});

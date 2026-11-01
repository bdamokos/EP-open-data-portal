import {retainDemographicRecord} from './demographic-metadata.mjs';
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
import {indexAvailability} from './availability-evidence.mjs';
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

test('question counts and ordered windows use the existing partial index and preserve date/type scope',async t=>{
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
  while(store.backfillFastReads(generation)){}
  const prepare=store.db.prepare.bind(store.db),queries=[];
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes('INDEXED BY read_question_window')||sql.includes('FROM question_frontiers')) {
      if(sql.includes('FROM question_frontiers')) {
        const iterate=statement.iterate.bind(statement);
        statement.iterate=function*(...args){const record={sql,args,method:'iterate',result:[]};queries.push(record);for(const row of iterate(...args)){record.result.push(row);yield row;}};
      }
      for(const method of ['get','all']) {
        const execute=statement[method].bind(statement);
        statement[method]=(...args)=>{const result=execute(...args);queries.push({sql,args,method,result});return result;};
      }
    }
    return statement;
  });
  store.db.exec('PRAGMA query_only=ON');
  const result=await new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()})
    .query(insightQuery(new URLSearchParams('days=90&lang=hu'),{now:now()}));
  assert.equal(result.coverage.undatedQuestions,11);assert.equal(result.counts.indexedMatchingQuestions,3);
  assert.equal(result.counts.totalQuestions,null);assert.equal(result.coverage.indexComplete,false);
  assert.equal(queries.length,6,'both counts, the ordered window and coverage history use the question index');
  for(const {sql,args,method,result} of queries) {
    const original=sql.replace(' INDEXED BY read_question_window',' NOT INDEXED');
    const expected=method==='iterate'?prepare(original).all(...args).slice(0,result.length):prepare(original)[method](...args);
    assert.deepEqual(expected,result,'the indexed read preserves the source-scan order, including the streamed prefix');
    const plan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH (?:question_reads USING INDEX read_question_window|question_frontiers USING COVERING INDEX question_frontier_date)/);assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
  }
  const {sql,args}=queries[0];
  const plan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH question_frontiers USING COVERING INDEX question_frontier_date \(generation=\?\)/);assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
  const program=prepare('EXPLAIN '+sql).all(...args),root=prepare("SELECT rootpage FROM sqlite_schema WHERE name='question_frontiers'").get().rootpage;
  const tableCursors=new Set(program.filter(row=>row.opcode==='OpenRead'&&row.p2===root).map(row=>row.p1));
  assert(!program.some(row=>row.opcode==='Column'&&tableCursors.has(row.p1)),'undated count must not read source-table columns');
  assert(!program.some(row=>row.opcode==='Function'&&/json_extract/.test(row.p4)),'undated count must not parse source JSON');
  store.db.exec('PRAGMA query_only=OFF');
});

test('country facets count shared questions and distinct current authors while retaining alternative countries',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'question-country-facets-')),store=new ActivityStore(directory,{clock:now});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  store.acquire();const {generation}=store.beginCycle();
  store.setMembers([{id:'1',countryCode:'FR'},{id:'2',countryCode:'DE'},{id:'3',countryCode:'DE'},{id:'4'}]);
  const rows=[['Water safety',['1','2','3','99']],['Digital safety',['2','4']],['Water quality',['3']]];
  for(const [i,[title,authors]] of rows.entries()) {
    const id='E-10-2026-00000'+(i+1),key='/parliamentary-questions/'+id;
    store.putSource(generation,key,'document',{identifier:id,work_type:'def/QUESTION_WRITTEN',document_date:'2026-10-01',title_dcterms:{en:title},creator:authors.map(id=>'person/'+id)},fixture.verifiedAt);
  }
  const metadata=new Map([['2',{'api:country-of-representation':'FR'}],['99',{'api:country-of-representation':'FR'}]]);
  const service=new QuestionInsights(store,{clock:now,loadMetadata:async()=>metadata,loadQuestionBodies:async()=>new Map()});
  store.db.exec('PRAGMA query_only=ON');
  const query=s=>service.query(insightQuery(new URLSearchParams('days=30&'+s),{now:now()}));
  const result=await query('country=FR');
  assert.equal(result.counts.selectedQuestions,2);
  assert.deepEqual(result.facets.countries.filter(c=>c.count),[{code:'FR',count:2,authors:2},{code:'DE',count:2,authors:1}]);
  assert.deepEqual(result.facets.countries.find(c=>c.code==='HU'),{code:'HU',count:0,authors:0});
  const water=await query('country=FR&word=water');
  assert.equal(water.counts.selectedQuestions,1);
  assert.deepEqual(water.facets.countries.filter(c=>c.count),[{code:'FR',count:1,authors:2},{code:'DE',count:2,authors:1}]);
  assert.equal(water.selectedStats.uniqueCurrentMeps,2);
  assert.equal(water.coverage.indexComplete,false);assert.equal(water.counts.totalQuestions,null);
});

test('indexed question coverage preserves historical, path, subtype and retrieval-date evidence',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'question-frontier-index-')),store=new ActivityStore(directory,{clock:now});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'42',countryCode:'FR'}]);
  const insert=store.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,1)');let sequence=0;
  const save=(subtype,date,{prefix='/parliamentary-questions/',kind='document',g=generation,fetchedAt='2026-10-14T10:00:00Z'}={})=>{
    const id='E-10-2026-'+String(++sequence).padStart(6,'0');
    insert.run(g,prefix+id,kind,JSON.stringify({identifier:id,work_type:subtype,document_date:date,title_dcterms:{en:'Water safety'},creator:['person/42']}),fetchedAt);
  };
  save('def/QUESTION_WRITTEN','2026-10-13',{fetchedAt:'2026-10-12T22:30:00Z'}); // Brussels next day.
  save('def/QUESTION_WRITTEN','2026-10-14',{fetchedAt:'2026-10-12T22:30:00Z'}); // Future at retrieval.
  save('def/QUESTION_WRITTEN_PRIORITY','2026-08-15'); // History outside the selected week.
  save('def/QUESTION_WRITTEN_PRIORITY','2026-10-11',{prefix:'/Parliamentary-Questions/'}); // Preserve LIKE case behavior.
  save('def/QUESTION_WRITTEN_PRIORITY','2026-10-15'); // Future today.
  save('def/QUESTION_ORAL','2026-10-12');
  save('def/QUESTION_ORAL','2026-02-30');
  save('def/QUESTION_ORAL',null);
  save('def/QUESTION_ORAL','2026-10-14',{prefix:'/different-source/'});
  save('def/QUESTION_ORAL','2026-10-14',{prefix:'/parliamentary-questions-old/'});
  save('def/QUESTION_ORAL','2026-10-14',{kind:'catalog'});
  save('def/QUESTION_ORAL','2026-10-14',{g:generation+1});
  save('def/question_oral','2026-10-14');
  save('QUESTION_ORAL','2026-10-14');
  save('def/QUESTION_WRITTEN_ANSWER','2026-10-14');
  save('def/REPORT_PLENARY','2026-10-14');
  const original=store.db.prepare("SELECT json_extract(body,'$.work_type') subtype,json_extract(body,'$.document_date') date,fetched_at fetchedAt FROM sources WHERE generation=? AND kind='document' AND key LIKE '/parliamentary-questions/%'");
  store.db.exec('PRAGMA query_only=ON');
  async function verify(frontiers) {
    const service=new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()}),observations=original.all(generation);
    for(const days of ['7','term']) {
      const query=insightQuery(new URLSearchParams({days}),{now:now()}),result=await service.query(query);
      const expected=['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL'].map(subtype=>indexAvailability(store,{
        sourceKey:subtype,family:'questions',subtype,start:query.start,end:query.end,generation,
        records:observations.filter(row=>String(row.subtype).endsWith('/'+subtype))
      }));
      assert.deepEqual(result.availability,expected,'coverage must match the original broad document read in each date window');
      assert.deepEqual(result.availability.map(row=>row.latestObservedDate),frontiers);
      assert.equal(result.coverage.indexComplete,false);assert.equal(result.counts.totalQuestions,null);
    }
  }
  await verify(['2026-10-13','2026-10-11','2026-10-12']);
  store.db.exec('PRAGMA query_only=OFF');
  store.db.prepare("DELETE FROM sources WHERE generation=? AND json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL'").run(generation);
  store.db.exec('PRAGMA query_only=ON');
  await verify(['2026-10-13','2026-10-11',null]);
});

test('coverage closes its newest-first read early and retains future observations across Brussels midnight',async t=>{
  let time=Date.parse('2026-10-14T21:59:00Z');
  const clock=()=>time,directory=mkdtempSync(path.join(os.tmpdir(),'question-frontier-midnight-')),store=new ActivityStore(directory,{clock});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
  store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'42',countryCode:'FR'}]);
  const insert=store.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,1)');let sequence=0;
  for(const subtype of ['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL'])for(const date of ['2026-10-15','2026-10-14',...Array(10).fill('2026-10-13')]) {
    const id='E-10-2026-'+String(++sequence).padStart(6,'0');
    insert.run(generation,'/parliamentary-questions/'+id,'document',JSON.stringify({identifier:id,work_type:'def/'+subtype,document_date:date,title_dcterms:{en:'Water safety'},creator:['person/42']}),'2026-10-14T22:30:00Z');
  }
  while(store.backfillFastReads(generation)){}
  const prepare=store.db.prepare.bind(store.db);let visited=0,closed=false;
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes('FROM question_frontiers')) {
      const iterate=statement.iterate.bind(statement);
      statement.iterate=function*(...args){try{for(const row of iterate(...args)){visited++;yield row;}}finally{closed=true;}};
    }
    return statement;
  });
  store.db.exec('PRAGMA query_only=ON');
  const query=insightQuery(new URLSearchParams('days=7'),{now:time});
  const result=await new QuestionInsights(store,{clock,loadMetadata:async()=>{time=Date.parse('2026-10-14T22:31:00Z');return new Map();},loadQuestionBodies:async()=>new Map()}).query(query);
  assert.equal(visited,6,'three future and three current observations suffice; older bodies are never read');
  assert.equal(closed,true,'breaking the read closes the SQLite iterator');
  assert.deepEqual(result.availability.map(row=>row.latestObservedDate),Array(3).fill('2026-10-15'));
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

test('background demographic recovery invalidates assembled and shared metadata caches without a profile visit or TTL delay',async()=>{
 const {createInsights}=await import('./insights.mjs');
 const directory=mkdtempSync(path.join(os.tmpdir(),'insights-demographic-recovery-')),store=new ActivityStore(directory,{clock:now});
 try {
  store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043'}]);
  store.putSource(generation,question.endpoint,'document',projectDocument(question.work),fixture.verifiedAt,documentRows(question.work,question.endpoint,fixture.verifiedAt).rows);
  const service=createInsights(store,{clock:now,loadMetadata:args=>savedMetadata({...args,directory:null}),loadQuestionBodies:async()=>new Map()}),query=new URLSearchParams('days=1&end=2026-07-16');
  const cold=await service.query('questions',query);
  assert.deepEqual(cold.stats.dimensions.age,[{label:'Unknown',count:1}]);
  assert.equal(cold.stats.demographicEvidence['257043'].bday.status,'missing_acquisition');
  retainDemographicRecord(store,generation,'257043',{url:'https://data.europarl.europa.eu/api/v2/meps/257043?format=application%2Fld%2Bjson',fetchedAt:now(),payload:{data:[{identifier:'257043',bday:'1980-01-01'}]}});
  const recovered=await service.query('questions',query);
  assert.deepEqual(recovered.stats.dimensions.age,[{label:'35–49',count:1}]);
  assert.equal(recovered.stats.demographicEvidence['257043'].bday.status,'available');
 } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

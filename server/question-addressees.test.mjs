import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {questionAddressees,organizationId,validAddresseeFilter,questionNumber} from './question-addressees.mjs';
import {questionFromSource} from './insights-model.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {projectDocument,documentRows} from './activity-index-model.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {corpusSearchOptions} from './corpus-worker.mjs';

const now=()=>Date.parse('2026-10-20T12:00:00Z'),fetchedAt=new Date(now()).toISOString();
const participation=(org,role='ADDRESSEE')=>({id:'eli/dl/participation/exact_'+org,participation_role:'def/ep-roles/'+role,had_participant_organization:[org]});
function work(n,orgs=[],country=1) {
  const id='O-10-2026-'+String(n).padStart(6,'0');
  return {id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-10-15',work_type:'def/ep-document-types/QUESTION_ORAL',parliamentary_term:'org/ep-10',
    title_dcterms:{en:n===4?'Ocean pollution':'European medicines policy'},workHadParticipation:[...orgs.map(id=>participation(id)),{participation_role:'def/ep-roles/AUTHOR',had_participant_person:['person/'+country]}]};
}

test('question addressees preserve exact source roles and organisations without inferring recipients',()=>{
  const w=work(43,['org/CS']);
  w.workHadParticipation.push(participation({id:'https://data.europarl.europa.eu/org/CS'}),participation('org/COM','AUTHOR'),participation('org/Unfamiliar_1'),participation('https://example.org/org/COM'));
  w.creator=['org/COM'];
  assert.deepEqual(questionAddressees(w).map(x=>[x.id,x.label]),[['org/CS','Council'],['org/Unfamiliar_1','org/Unfamiliar_1']]);
  const q=questionFromSource({work:w,key:'/parliamentary-questions/'+w.identifier,fetchedAt});
  assert.equal(q.apiUrl,'https://data.europarl.europa.eu/api/v2/parliamentary-questions/'+w.identifier);assert.equal(q.fetchedAt,fetchedAt);
  assert.equal(q.addressees[0].uri,'https://data.europarl.europa.eu/org/CS');assert.equal(q.addressees[0].participationIds.length,2);
  assert.deepEqual(questionAddressees({creator:['org/COM'],inverse_answers_to:[{creator:['org/COM']}]}),[]);
  assert.equal(organizationId({id:'http://data.europarl.europa.eu/org/COM'}),'org/COM');
  for(const value of ['https://example.org/org/COM','org/COM?x','https://user@data.europarl.europa.eu/org/CS','org/COM/other','org/'+('A'.repeat(101))])assert.equal(organizationId(value),null,value);
  assert.equal(questionNumber('O-10-2026-000043'),'O-000043/2026');assert.equal(questionNumber('P-10-2026-004146'),'P-004146/2026');
});

test('insights and corpus accept the same bounded exact addressee grammar',()=>{
  for(const value of ['org/COM','org/CS','org/Unknown_123-4','org/'+('A'.repeat(100)),'unavailable']) {
    assert(validAddresseeFilter(value));assert.equal(insightQuery(new URLSearchParams({addressee:value}),{now:now()}).addressee,value);assert.equal(corpusSearchOptions({query:'medicines',addressee:value}).addressee,value);
  }
  assert.equal(insightQuery(new URLSearchParams(),{now:now()}).addressee,null);assert.equal(corpusSearchOptions({query:'medicines',addressee:null}).addressee,null);
  for(const value of ['',{},[],42,'COM','org/','org/COM/','org/'+('A'.repeat(101)),'https://data.europarl.europa.eu/org/CS','org/COM?x','org/é']) {
    assert(!validAddresseeFilter(value),String(value));assert.throws(()=>corpusSearchOptions({query:'medicines',addressee:value}),e=>e.status===400);
    assert.throws(()=>insightQuery(new URLSearchParams({addressee:String(value)}),{now:now()}),e=>e.status===400);
  }
  assert.throws(()=>insightQuery(new URLSearchParams('addressee=org%2FCS&addressee=org%2FCOM'),{now:now()}),e=>e.status===400);
});

test('saved question filtering keeps recipients, country facets, topic counts and timeline denominators consistent',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'question-addressees-')),store=new ActivityStore(directory,{clock:now});
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'1',name:'One',countryCode:'DK'},{id:'2',name:'Two',countryCode:'FR'}]);
    for(const w of [work(43,['org/CS']),work(44,['org/COM']),work(45,['org/CS','org/COM'],2),work(4,[],2)]) {
      const key='/parliamentary-questions/'+w.identifier;store.putSource(generation,key,'document',projectDocument(w),fetchedAt,documentRows(w,key,fetchedAt).rows);
    }
    const before=store.db.prepare('SELECT * FROM meta ORDER BY key').all();store.db.exec('PRAGMA query_only=ON');
    const insights=new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()});
    const query=s=>insights.query(insightQuery(new URLSearchParams('days=7&'+s),{now:now()}));
    const all=await query('');assert.equal(all.counts.selectedQuestions,4);assert.equal(all.facets.addressees.find(x=>x.id==='unavailable').count,1);
    const council=await query('addressee=org%2FCS');assert.equal(council.counts.selectedQuestions,2);assert.equal(council.facets.countries.find(x=>x.code==='FR').count,1);
    assert.equal(council.trend.bins.reduce((n,b)=>n+b.total,0),2);assert.equal(council.trend.bins.reduce((n,b)=>n+b.count,0),2);assert(council.questions.every(q=>q.addressees.some(x=>x.id==='org/CS')));
    assert(council.words.every(w=>w.contextQuestionCount<=2));assert.equal(council.geography.countries.find(c=>c.code==='FR').questionCount,1);
    const french=await query('addressee=org%2FCS&country=FR');assert.equal(french.counts.selectedQuestions,1);assert.deepEqual(french.facets.addressees.map(x=>[x.id,x.count]),[['org/COM',1],['org/CS',1],['unavailable',1]]);
    const unknown=await query('addressee=unavailable');assert.equal(unknown.counts.selectedQuestions,1);assert.deepEqual(unknown.questions[0].addressees,[]);
    const empty=await query('addressee=org%2FNotPresent');assert.equal(empty.counts.selectedQuestions,0);assert(empty.facets.addressees.some(x=>x.id==='org/NotPresent'&&x.count===0));
    assert.deepEqual(store.db.prepare('SELECT * FROM meta ORDER BY key').all(),before);
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});

test('corpus addressee scopes match parent questions before grouping and paging, using the serving generation',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-addressees-')),index=new ActivityStore(path.join(directory,'index'),{clock:now});let corpus;
  try {
    index.acquire();index.db.exec("INSERT INTO meta VALUES ('active','1')");
    for(const [generation,w] of [[1,work(43,['org/CS'])],[1,work(44,['org/COM'])],[1,work(45,[])],[2,work(43,['org/COM'])]])index.putSource(generation,'/parliamentary-questions/'+w.identifier,'document',projectDocument(w),fetchedAt);
    corpus=new CorpusStore(path.join(directory,'corpus'),{indexFile:index.filename,clock:now});corpus.acquire();
    for(const [sourceId,kind,parentId] of [['O-10-2026-000043','question',null],['O-10-2026-000043-ASW','answer','O-10-2026-000043'],['O-10-2026-000044-ASW','answer','O-10-2026-000044'],['O-10-2026-000045','question',null],['MTG-PL-2026-10-15-OTH-1','speech',null]]) {
      corpus.putDocument({sourceId,kind,parentId,date:'2026-10-15',term:10,originalLanguages:['en']},[{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'docx',sourceUrl:'https://example.test/'+sourceId,fetchedAt,body:'Medicines policy',raw:null}]);
    }
    const search=extra=>corpus.search({query:'medicines',group:'question',...extra});
    const council=search({addressee:'org/CS'});assert.equal(council.total,1);assert.equal(council.results[0].hits.length,2);assert.equal(council.results[0].sourceId,'O-10-2026-000043');
    assert.equal(search({addressee:'org/COM'}).total,1);assert.equal(search({addressee:'org/COM'}).results[0].sourceId,'O-10-2026-000044');
    assert.equal(search({addressee:'unavailable'}).total,1,'speeches cannot enter the unavailable-recipient bucket');
    assert.equal(search({addressee:'org/CS',offset:1,limit:1}).total,1);assert.equal(search({addressee:'org/CS',offset:1,limit:1}).results.length,0);
    assert.equal(search({addressee:'org/CS',sourceIds:['O-10-2026-000044-ASW']}).total,0);
    index.db.exec("DELETE FROM meta WHERE key='active'");assert.equal(search({addressee:'org/CS'}).unavailableCode,'corpus_addressee_metadata_unavailable');
  }finally{corpus?.close();index.close();rmSync(directory,{recursive:true,force:true});}
});

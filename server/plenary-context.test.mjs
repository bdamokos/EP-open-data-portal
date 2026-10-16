import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {projectDocument,projectProcedure} from './activity-index-model.mjs';
import {SpeechCloudInsights,speechCloudQuery,analyzeSpeechCloud,meaningfulSpeakerName,CLOUD_SORT} from './speech-cloud.mjs';
import {OfficialContextSources,officialSourceUrl,parseProcedurePage,parseSummaryPage} from './official-context.mjs';
import {parseEurovoc,eurovocQuery,EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext,procedureContextQuery} from './procedure-context.mjs';
import {TopicTrends,topicTrendsQuery,savedProcedureEvents,topicTimeline} from './topic-trends.mjs';
import {questionStatuses} from './question-status.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/plenary-context-live-20261015.json',import.meta.url)));
const pagination=JSON.parse(readFileSync(new URL('./fixtures/speech-pagination-20261015.json',import.meta.url)));
const activityFixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url)));
const procedureHtml=readFileSync(new URL('./fixtures/oeil-procedure-2025-0407.html',import.meta.url),'utf8'),summaryHtml=readFileSync(new URL('./fixtures/oeil-first-reading-1908635.html',import.meta.url),'utf8');
const now=()=>Date.parse('2026-10-15T08:00:00Z');
function storeFor(run){const directory=mkdtempSync(path.join(os.tmpdir(),'plenary-context-test-')),store=new ActivityStore(directory,{clock:now});store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'125065',name:'Elissavet VOZEMBERG-VRIONIDI',countryCode:'GR'}]);return Promise.resolve().then(()=>run(store,generation)).finally(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});}

test('speech cloud validates exact scope, dates, page limits and countries',()=>{
  const q=value=>speechCloudQuery(new URLSearchParams(value),{now:now()});
  assert.equal(q('member=125065&days=365').start,'2025-10-16');assert.equal(q('member=125065&country=GR').country,'EL');
  assert.equal(q('member=125065&days=term').start,'2024-07-16');assert.equal(q('member=125065&days=366').start,'2025-10-15');
  assert.equal(q('week=2026-10-05').week,'2026-10-05');assert.equal(q('week=2026-10-05&page=99').page,99);
  for(const value of ['week=2026-10-06','week=2026-02-30','week=2026-10-05&sitting=MTG-PL-2026-10-08','week=2026-10-05&days=90','week=2026-10-05&topic=MTG-PL-2026-10-08-OJ-ITM-D-72','week=2026-10-05&page=100'])assert.throws(()=>q(value),error=>error.status===400,value);
  for(const value of ['','member=125065&sitting=MTG-PL-2026-10-08','member=0','member=125065&days=823','member=125065&page=20','member=125065&lang=mt','member=125065&foo=x','member=125065&member=4465','sitting=MTG-PL-2026-10-08&days=90','sitting=MTG-PL-2026-10-08&topic=MTG-PL-2026-10-07-OJ-ITM-D-72'])assert.throws(()=>q(value),error=>error.status===400,value);
});
test('actual Vrionidi speech batch builds seven English transcripts with one request and no SQL writes',()=>storeFor(async store=>{
  store.db.exec('PRAGMA query_only=ON');let calls=0;const cloud=new SpeechCloudInsights(store,{clock:now,request:async(endpoint,params)=>{calls++;assert.equal(endpoint,'/speeches');assert.equal(params['person-id'],'125065');assert.equal(params['include-output'],'xml_fragment');assert.equal(params.language,'en');assert.equal(params['sitting-date'],'2024-07-16');assert.equal(params['sitting-date-end'],'2026-10-15');return fixture.speeches;}}),query=speechCloudQuery(new URLSearchParams('member=125065&days=term'),{now:now()});
  const result=await cloud.query(query);assert.equal(result.coverage.transcripts,7);assert.equal(result.coverage.complete,true);assert.equal(result.nextPage,null);assert.equal(calls,1);assert(result.words.some(term=>term.label?.toLowerCase()==='international law'));assert(!result.words.some(term=>/president|commissioner|madam|^mr$/.test(term.label?.toLowerCase()||term.word)));assert(result.speeches.every(s=>s.people.some(p=>p.id==='125065'&&p.currentMep)));
  await cloud.query(query);assert.equal(calls,1);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources').get().n,0);
}));
test('cloud rejects wrong-person rows, joins topic children exactly and never fetches unheld sitting speeches',()=>storeFor(async store=>{
  const sitting={activity_id:'MTG-PL-2026-10-08',activity_date:'2026-10-08'},future={activity_id:'MTG-PL-2026-10-19',activity_date:'2026-10-19'},id=fixture.speeches.payload.data.at(-1).activity_id;
  let calls=0;const legislation={catalogue:async()=>({sittings:[sitting,future]}),query:async()=>({detail:{title:'Exact topic',people:[],coverage:{speechAssociations:{sources:[{eventDate:'2026-10-08',contributionIds:[id]}]}}}})};
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation,request:async()=>{calls++;return fixture.speeches;}});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('sitting=MTG-PL-2026-10-08&topic=MTG-PL-2026-10-08-OJ-ITM-D-72'),{now:now()}));assert.deepEqual(result.speeches.map(s=>s.id),[id]);
  const unheld=await cloud.query(speechCloudQuery(new URLSearchParams('sitting=MTG-PL-2026-10-19'),{now:now()}));assert.equal(unheld.coverage.transcripts,0);assert.equal(calls,1);
  const wrong=await cloud.query({...speechCloudQuery(new URLSearchParams('member=125065'),{now:now()}),member:'4465'}).catch(error=>error);assert.equal(wrong.status,404);
}));
test('cloud pagination deduplicates repeated source pages and stops with explicit partial coverage',()=>storeFor(async store=>{
  const raw=fixture.speeches.payload.data[0],nodes=Array.from({length:50},(_,i)=>({...raw,activity_id:'MTG-PL-2025-12-16-OTH-'+(10000+i)}));let calls=0;
  const cloud=new SpeechCloudInsights(store,{clock:now,request:async()=>{calls++;return {...fixture.speeches,payload:{meta:{total:200},data:nodes}};}}),query=speechCloudQuery(new URLSearchParams('member=125065&days=365'),{now:now()});
  const first=await cloud.query(query);assert.equal(first.nextPage,1);assert.equal(first.coverage.transcripts,50);
  const second=await cloud.query({...query,page:1});assert.equal(second.coverage.transcripts,50);assert.equal(second.coverage.truncated,true);assert.equal(second.coverage.complete,false);assert.equal(second.nextPage,null);assert.equal(calls,2);
}));
test('an unexpectedly short source page cannot claim complete transcript coverage',()=>storeFor(async store=>{
  const cloud=new SpeechCloudInsights(store,{clock:now,request:async()=>({...fixture.speeches,payload:{...fixture.speeches.payload,meta:{total:80}}})});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=125065&days=365'),{now:now()}));assert.equal(result.coverage.transcripts,7);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.truncated,true);assert.equal(result.nextPage,null);
}));
test('a plenary week cloud reads each held sitting day and skips unheld days',()=>storeFor(async store=>{
  const sittings=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-19'].map(date=>({activity_id:'MTG-PL-'+date,activity_date:date})),dates=[];
  const cloud=new SpeechCloudInsights(store,{clock:()=>Date.parse('2026-10-07T08:00:00Z'),legislation:{catalogue:async()=>({sittings})},request:async(endpoint,params)=>{dates.push([params['sitting-date'],params['sitting-date-end']]);return {...fixture.speeches,payload:{meta:{total:0},data:[]}};}});
  let result=await cloud.query(speechCloudQuery(new URLSearchParams('week=2026-10-05'),{now:now()}));
  while(result.nextPage!==null)result=await cloud.query({...speechCloudQuery(new URLSearchParams('week=2026-10-05'),{now:now()}),page:result.nextPage});
  assert.deepEqual(dates,[['2026-10-05','2026-10-05'],['2026-10-06','2026-10-06'],['2026-10-07','2026-10-07']]);assert.equal(result.scope.kind,'week');assert.deepEqual(result.window,{start:'2026-10-05',end:'2026-10-07',days:null});
  const upcoming=await cloud.query(speechCloudQuery(new URLSearchParams('week=2026-10-19'),{now:now()}));assert.equal(upcoming.scope.phase,'upcoming');assert.equal(dates.length,3);
  assert.equal((await cloud.query(speechCloudQuery(new URLSearchParams('week=2026-10-12'),{now:now()})).catch(error=>error)).status,404);
}));
const oct8Catalogue={catalogue:async()=>({sittings:[{activity_id:'MTG-PL-2026-10-08',activity_date:'2026-10-08'}]})};
test('weekly cloud pagination accumulates distinct speeches across day boundaries beyond the single-day page cap',()=>storeFor(async store=>{
  const days=['2026-10-07','2026-10-08'],calls=[],raw=fixture.speeches.payload.data[0];
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation:{catalogue:async()=>({sittings:days.map(date=>({activity_id:'MTG-PL-'+date,activity_date:date}))})},request:async(endpoint,params)=>{
    const date=params['sitting-date'],total=date===days[0]?1000:2;calls.push([date,params.offset]);
    const data=Array.from({length:Math.min(50,total-params.offset)},(_,i)=>({...raw,activity_id:'MTG-PL-'+date+'-OTH-'+(params.offset+i),activity_date:date,recorded_in_a_realization_of:[{'api:xmlFragment':{en:'<root><p>Climate energy transport.</p></root>'}}]}));
    return {...fixture.speeches,payload:{meta:{total},data}};
  }});
  const query=speechCloudQuery(new URLSearchParams('week=2026-10-05'),{now:now()});let result=await cloud.query(query);
  while(result.nextPage!==null)result=await cloud.query({...query,page:result.nextPage});
  assert.equal(calls.length,21);assert.deepEqual(calls.at(-1),['2026-10-08',0]);
  assert.equal(result.coverage.transcripts,1002);assert.equal(result.coverage.complete,true);
  assert.equal(result.words.find(term=>term.word==='climate').speechCount,1002);
  assert.deepEqual(result.coverage.sourceRecords,{unique:1002,declared:1002,duplicates:0,issues:[]});
  assert(result.speeches.some(s=>s.date===days[1]));assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources').get().n,0);
}));
const oct8Query=()=>speechCloudQuery(new URLSearchParams('sitting=MTG-PL-2026-10-08'),{now:now()});
test('retained chronological Oct8 pages reconcile 198 distinct IDs with the declared total',()=>storeFor(async store=>{
  store.db.exec('PRAGMA query_only=ON');const offsets=[];
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation:oct8Catalogue,request:async(endpoint,params)=>{
    assert.equal(endpoint,'/speeches');assert.equal(params['sort-by'],CLOUD_SORT);assert.equal(params['sort-by'],'sitting-date:asc,video-start-time:asc,numbering:asc');offsets.push(params.offset);return pagination.pages[params.offset/50];
  }});let result;
  for(let page=0;page<4;page++){result=await cloud.query({...oct8Query(),page});assert.equal(result.coverage.sourceRecords.unique,[50,100,150,198][page]);assert.equal(result.coverage.complete,page===3);}
  assert.deepEqual(offsets,[0,50,100,150]);assert.deepEqual(result.coverage.sourceRecords,{unique:198,declared:198,duplicates:0,issues:[]});assert.equal(result.coverage.truncated,false);assert.equal(result.nextPage,null);assert.equal(result.coverage.matchedSpeechRecords,198);
  // The fixture deliberately omits XML; paging completeness is separate from supplied text.
  assert.equal(result.coverage.missingLanguage,198);assert.equal(result.coverage.transcripts,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources').get().n,0);
}));
test('the reported 50/50/50/48 overlap pattern cannot be accepted as complete at 172 of 198 IDs',()=>storeFor(async store=>{
  let calls=0;const cloud=new SpeechCloudInsights(store,{clock:now,legislation:oct8Catalogue,request:async(endpoint,params)=>{calls++;return pagination.rejectedPages[params.offset/50];}});let result;
  for(let page=0;page<4;page++)result=await cloud.query({...oct8Query(),page});
  assert.equal(result.coverage.sourceRecords.unique,172);assert.equal(result.coverage.sourceRecords.declared,198);assert.equal(result.coverage.sourceRecords.duplicates,26);assert(result.coverage.sourceRecords.issues.includes('overlapping-pages'));assert(result.coverage.sourceRecords.issues.includes('source-total-mismatch'));assert.equal(result.coverage.complete,false);assert.equal(result.coverage.truncated,true);assert.equal(result.nextPage,null);
  await cloud.query({...oct8Query(),page:3});assert.equal(calls,4,'partial results must not launch unbounded recovery reads');
}));
test('changed totals and disagreement between search hits and graph IDs remain partial',()=>storeFor(async store=>{
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation:oct8Catalogue,request:async(endpoint,params)=>{
    const page=structuredClone(pagination.pages[params.offset/50]);if(params.offset===50)page.payload.meta.total=199;return page;
  }});let result;for(let page=0;page<4;page++)result=await cloud.query({...oct8Query(),page});
  assert.equal(result.coverage.complete,false);assert.equal(result.coverage.sourceRecords.unique,198);assert.equal(result.coverage.sourceRecords.declared,null);assert(result.coverage.sourceRecords.issues.includes('total-changed'));
  const mismatch=structuredClone(fixture.speeches);mismatch.payload.searchResults.hits[0].id='eli/dl/event/MTG-PL-2026-10-08-OTH-99999';
  const second=new SpeechCloudInsights(store,{clock:now,request:async()=>mismatch});const result2=await second.query(speechCloudQuery(new URLSearchParams('member=125065&days=365'),{now:now()}));
  assert.equal(result2.coverage.complete,false);assert(result2.coverage.sourceRecords.issues.includes('search-hit-mismatch'));
}));
test('missing source totals do not become a full-coverage claim',()=>storeFor(async store=>{
  const raw=structuredClone(fixture.speeches);delete raw.payload.meta.total;
  const cloud=new SpeechCloudInsights(store,{clock:now,request:async()=>raw});const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=125065&days=365'),{now:now()}));
  assert.equal(result.coverage.transcripts,7);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.sourceRecords.declared,null);assert(result.coverage.sourceRecords.issues.includes('total-unavailable'));assert.equal(result.nextPage,null);
}));
test('country filtering does not compare a national subset with the whole source total',()=>storeFor(async store=>{
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation:oct8Catalogue,request:async(endpoint,params)=>pagination.pages[params.offset/50]});let result;
  for(let page=0;page<4;page++)result=await cloud.query({...oct8Query(),country:'EL',page});
  assert.equal(result.coverage.complete,true);assert.equal(result.coverage.sourceRecords.unique,198);assert.equal(result.coverage.sourceRecords.declared,198);assert.equal(result.coverage.truncated,false);
}));
test('speaker aliases are never names and speech phrases remain whole',()=>{
  for(const name of ['President','Speaker','The Chair','Chairman'])assert.equal(meaningfulSpeakerName(name),false);assert(meaningfulSpeakerName('Raffaele Fitto'));
  const words=analyzeSpeechCloud([{id:'one',title:'Digital Services Act',text:'The Digital Services Act protects users. The Digital Services Act matters.'},{id:'two',title:'Digital Services Act',text:'Enforce the Digital Services Act to protect users.'}],'en');assert(words.some(w=>w.label==='Digital Services Act'&&w.speechCount===2));
});
test('published OEIL summaries preserve exact reference, stage and printed date despite wrong HTML datetime',()=>{
  const page=parseProcedurePage(procedureHtml,'2025/0407(COD)');assert.equal(page.subjects.length,2);assert.deepEqual(page.summaries.map(s=>[s.id,s.stage]),[['1880434','proposal'],['1908635','first-reading'],['1910217','final-act']]);
  const summary=parseSummaryPage(summaryHtml,'2025/0407(COD)');assert.equal(summary.date,'2026-07-07');assert.equal(summary.blocks.length,6);assert(summary.blocks[0].text.includes('654 votes to 4'));assert(summary.blocks[1].text.includes('first reading'));assert.equal(summary.method,null);
  assert.throws(()=>parseSummaryPage(summaryHtml,'2025/0408(COD)'),/does not match/);assert.throws(()=>parseProcedurePage(procedureHtml,'2025/0408(COD)'),/does not match/);assert.throws(()=>parseSummaryPage('<!DOCTYPE x [<!ENTITY x "x">]>'+summaryHtml,'2025/0407(COD)'),/unreadable/);
});
test('official source reader rejects redirects outside supported public sources and refuses 202/oversize',async()=>{
  for(const url of ['http://oeil.europarl.europa.eu/oeil/en/procedure-file','https://user@oeil.europarl.europa.eu/oeil/en/procedure-file','https://127.0.0.1/oeil/en/procedure-file','https://oeil.europarl.europa.eu/private'])assert.throws(()=>officialSourceUrl(url));
  const url='https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0407%28COD%29';
  for(const response of [new Response(null,{status:302,headers:{location:'https://example.org'}}),new Response('',{status:202}),new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'text/html'}})]){const reader=new OfficialContextSources({directory:null,run:load=>load(),fetchSource:async()=>response});await assert.rejects(()=>reader.get(url));}
});
test('CELLAR topics join exact dossier reference and initiating work with localized labels; ambiguities stay unmapped',()=>{
  const values=parseEurovoc(fixture.topics,['2025-0407','2025-9999'],'el'),mapping=values.get('2025-0407');assert.equal(mapping.reference,'2025/0407(COD)');assert.equal(mapping.concepts.length,11);assert.equal(mapping.concepts.find(c=>c.id.endsWith('/4353')).label,'Αυστρία');assert.equal(values.get('2025-9999').state,'unmapped');
  const bad=structuredClone(fixture.topics);bad.results.bindings.push({...bad.results.bindings[0],reference:{type:'literal',value:'2025/0407/CNS'}});assert.equal(parseEurovoc(bad,['2025-0407'],'en').get('2025-0407').state,'ambiguous');
  assert(eurovocQuery(['2025-0407'],'en').includes('"2025"^^xsd:gYear "0407"^^xsd:string'));assert.throws(()=>eurovocQuery(['2025-0407) DROP ALL'],'en'));
});
test('summary service defaults to real first reading and fetches only actual linked summary IDs',async()=>{
  let reads=[];const sources={get:async url=>{reads.push(url);return {url,fetchedAt:new Date(now()).toISOString(),html:url.includes('document-summary')?summaryHtml:procedureHtml};}},catalog={known:async()=>parseEurovoc(fixture.topics,['2025-0407'],'en')};
  const service=new ProcedureContext(sources,catalog),result=await service.query(procedureContextQuery(new URLSearchParams('reference=2025%2F0407(COD)')));assert.equal(result.summary.id,'1908635');assert.equal(result.topics.length,11);assert.equal(reads.length,2);
  reads=[];await assert.rejects(()=>service.query({reference:'2025/0407(COD)',language:'en',summary:'99999'}),error=>error.status===400);assert.equal(reads.length,1);
});
test('EuroVoc catalogue coalesces identical batches and persists reproducible per-dossier results',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'eurovoc-test-'));let calls=0;const sources={get:async url=>{calls++;await new Promise(resolve=>setImmediate(resolve));return {url,fetchedAt:new Date(now()).toISOString(),data:fixture.topics};}};
  try{const catalog=new EurovocCatalog(sources,{directory,clock:now});await Promise.all([catalog.load(['2025-0407'],'en'),catalog.load(['2025-0407'],'en')]);assert.equal(calls,1);const second=new EurovocCatalog(sources,{directory,clock:now});assert.equal((await second.known(['2025-0407'],'en')).get('2025-0407').concepts.length,11);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('saved timeline keeps votes, debates and committee work separate and deduplicates shared events',()=>storeFor(async(store,generation)=>{
  const raw=fixture.procedure.payload.data[0];store.putSource(generation,'/procedures/2025-0407','procedure',projectProcedure(raw),fixture.procedure.fetchedAt,[]);store.db.exec('PRAGMA query_only=ON');
  const query=topicTrendsQuery(new URLSearchParams('days=term'),{now:now()}),saved=savedProcedureEvents(store,query);assert.equal(query.start,'2024-07-16');assert.equal(query.days,822);assert.equal(saved.procedures.length,1);assert.equal(saved.procedures[0].events.filter(e=>e.kind==='votes').length,1);assert.equal(saved.procedures[0].events.filter(e=>e.kind==='committee').length,4);
  const mapping=parseEurovoc(fixture.topics,['2025-0407'],'en'),timeline=topicTimeline([...saved.procedures,...saved.procedures],mapping,query);assert.equal(timeline.topics.length,11);assert.equal(timeline.topics[0].events.length,5);assert.equal(timeline.topics[0].series.reduce((sum,s)=>sum+s.votes,0),1);assert.equal(timeline.topics[0].series.reduce((sum,s)=>sum+s.committee,0),4);
  const service=new TopicTrends(store,{known:async()=>mapping},{clock:now});const result=await service.query(query);assert.equal(result.coverage.mapped,1);assert.equal(result.nextPage,null);assert.equal(result.savedSources.length,1);
}));
test('question activity badges use saved exact question-answer links and do not change source state',()=>storeFor(async(store,generation)=>{
  const source=activityFixture.documents.find(d=>d.endpoint.startsWith('/parliamentary-questions'));store.putSource(generation,source.endpoint,'document',projectDocument(source.work),activityFixture.verifiedAt,[]);store.db.exec('PRAGMA query_only=ON');const id=source.work.identifier;
  const result=questionStatuses(store,{items:[{sourceId:id,category:'written-questions',recordKind:'question'},{sourceId:id+'-ASW',category:'written-questions',recordKind:'answer'},{sourceId:'E-10-2026-999999',category:'written-questions'}],selectedItems:[]});assert.equal(result.items[0].answerStatus,'answered');assert.equal(result.items[1].answerStatus,undefined);assert.equal(result.items[2].answerStatus,undefined);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources').get().n,1);
}));
test('question facets intersect time, country and topic in any order; weekly totals equal distinct questions',()=>storeFor(async(store,generation)=>{
  const source=activityFixture.documents.find(d=>d.endpoint.startsWith('/parliamentary-questions')),base=projectDocument(source.work);
  store.setMembers([{id:'1',name:'Greek author',countryCode:'GR'},{id:'2',name:'Spanish author',countryCode:'ES'}]);
  const entries=[['2026-09-01','1','Digital Services Act enforcement'],['2026-09-02','1','Digital Services Act protection'],['2026-09-03','2','Digital Services Act safeguards'],['2026-09-15','1','Digital Services Act safeguards'],['2026-09-16','2','Road transport cabotage']];
  entries.forEach(([date,person,title],index)=>{const id='E-10-2026-90000'+index,work={...base,id:'eli/dl/doc/'+id,identifier:id,document_date:date,title_dcterms:{en:title},workHadParticipation:[{participation_role:'def/ep-roles/AUTHOR',had_participant_person:['person/'+person]}]};store.putSource(generation,'/parliamentary-questions/'+id,'document',work,new Date(now()).toISOString(),[]);});
  store.db.exec('PRAGMA query_only=ON');const service=new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()}),q=value=>insightQuery(new URLSearchParams('days=90&end=2026-10-15&'+value),{now:now()});
  const all=await service.query(q(''));assert.equal(all.counts.selectedQuestions,5);assert.equal(all.trend.bins.reduce((sum,b)=>sum+b.count,0),5);assert(Math.max(...all.trend.bins.map(b=>b.count))>1);
  const a=await service.query(q('country=EL&word=digital-services-act&from=2026-09-01&to=2026-09-07')),b=await service.query(q('from=2026-09-01&word=digital-services-act&to=2026-09-07&country=GR'));
  assert.equal(a.counts.selectedQuestions,2);assert.deepEqual(a.questions,b.questions);assert.equal(a.facets.countries.find(c=>c.code==='ES').count,1);assert.equal(a.facets.countries.find(c=>c.code==='EL').count,2);assert.equal(a.trend.bins.reduce((sum,b)=>sum+b.count,0),3);assert(a.words.some(w=>w.word==='digital-services-act'&&w.contextQuestionCount===2));
  for(const value of ['from=2026-09-01','from=2026-02-30&to=2026-09-01','from=2026-09-10&to=2026-09-01','from=2024-01-01&to=2026-09-01'])assert.throws(()=>q(value),error=>error.status===400);
}));

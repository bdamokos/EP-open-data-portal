import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {countryQuestions,enrichmentProbability,adjustProbabilities} from './insights-countries.mjs';
import {analyzeQuestions} from './insights-model.mjs';import {insightQuery} from './insights-store.mjs';
import {SpeechWordInsights,speechParagraphText,speechWordTokens,speechWordsQuery,speechWordLanguages} from './insights-speech-words.mjs';
import {ActivityStore} from './activity-index-store.mjs';import {speechRows} from './activity-index-model.mjs';
import {participation,participationQuery} from './insights-participation.mjs';import {LegislationInsights} from './insights-legislation.mjs';
const now=()=>Date.parse('2026-10-14T10:00:00Z');
test('exact enrichment probabilities and multiple-comparison adjustment match known tables',()=>{
 assert(Math.abs(enrichmentProbability(10,5,5,5)-1/252)<1e-12);assert.equal(enrichmentProbability(10,5,5,0),1);
 const rows=adjustProbabilities([{p:.01},{p:.04},{p:1}]);assert.equal(rows[0].adjustedP,.03);assert.equal(rows[1].adjustedP,.06);
});
test('country topics deduplicate co-authors, retain country overlap and suppress tiny-sample highlights',()=>{
 const members=new Map(['1','2','3','4'].map(id=>[id,{id,countryCode:id==='4'?'ES':'IT'}]));
 const question=(i,title,authors)=>({id:'E-10-2026-'+String(i).padStart(6,'0'),date:'2026-10-01',titles:{en:title},authors:authors.map(id=>({id}))});
 const rows=[question(1,'Semiconductor supply',['1','2','4']),question(2,'Semiconductor supply',['1','3'])];const a=countryQuestions(analyzeQuestions(rows),members,new Map()),it=a.countries.find(c=>c.code==='IT'),es=a.countries.find(c=>c.code==='ES');
 assert.equal(it.questionCount,2);assert.equal(it.authorCount,3);assert.equal(es.questionCount,1);assert.equal(it.features.find(f=>f.id==='word:semiconductor').count,2);assert(it.features.every(f=>!f.highlighted));
 const broad=Array.from({length:100},(_,i)=>question(i+10,i<25?'Semiconductor supply security':'Agricultural water resilience',i<25?['1','2','3']:['4']));const b=countryQuestions(analyzeQuestions(broad),members,new Map());assert(b.countries.find(c=>c.code==='IT').features.find(f=>f.id==='word:semiconductor').highlighted);
 assert.equal(insightQuery(new URLSearchParams('country=GR'),{now:now()}).country,'EL');assert.throws(()=>insightQuery(new URLSearchParams('country=UK'),{now:now()}),e=>e.status===400);
});
test('speech word extraction excludes speaker headers, attributes and XML entities; all advertised language filters exist',()=>{
 const xml='<oralStatements><speech xml:lang="en"><from><person>Speaker NAME</person></from><p><time at="123">Thank you, President. Climate climate.</time></p><p>Water and climate.</p></speech></oralStatements>';
 assert.equal(speechParagraphText(xml),'Thank you, President. Climate climate. Water and climate.');const words=speechWordTokens(speechParagraphText(xml),'en');assert(!words.includes('president'));assert(!words.includes('speaker'));assert(speechWordTokens('AI regulation','en').includes('ai'));assert(!speechWordTokens('7%-kal árak','hu').includes('kal'));assert(!speechWordTokens('είναι ότι προστασία','el').includes('είναι'));assert.equal(words.filter(w=>w==='climate').length,3);
 assert.equal(speechParagraphText('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///x">]><p>&y;</p>'),'');assert.equal(speechParagraphText('<p>broken'),'');assert.equal(speechWordLanguages.length,23);assert(speechWordTokens('az és klímaváltozás','hu').includes('klímaváltozás'));assert(!speechWordTokens('az és klímaváltozás','hu').includes('és'));assert.throws(()=>speechWordsQuery(new URLSearchParams('member=1&lang=mt'),{now:now()}),e=>e.status===400);
});
test('speech clouds use only existing saved requested-language XML and deduplicate speech mentions under query-only SQL',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'speech-words-test-')),store=new ActivityStore(dir),fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url))),calls=[];
 try{store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043',name:'Abadia'}]);const speech={...fixture.speech.payload.data[0],activity_label:{bg:'Bulgarian speech',fr:'French speech'}};store.putSource(generation,'/speeches/'+speech.activity_id,'speech',{id:speech.activity_id},'2026-10-01',speechRows(speech,'2026-10-01'));store.db.exec('PRAGMA query_only=ON');
  const xml='<oralStatements><speech xml:lang="es-t-en-mtec"><p>Climate climate water.</p></speech></oralStatements>',service=new SpeechWordInsights(store,{clock:now,readTranscript:async id=>{calls.push(id);return {fetchedAt:now(),payload:{data:[{...speech,recorded_in_a_realization_of:[{'api:xmlFragment':{en:xml}}]}]}};}});
  const en=await service.query(speechWordsQuery(new URLSearchParams('member=257043&lang=en'),{now:now()}));assert.equal(en.coverage.analyzedTranscripts,1);assert.equal(en.words.find(w=>w.word==='climate').speechCount,1);assert.equal(en.words.find(w=>w.word==='climate').occurrences,2);assert.equal(en.speeches[0].machineTranslation,true);assert.equal(en.speeches[0].title,'French speech');
  await service.query(speechWordsQuery(new URLSearchParams('member=257043&lang=en'),{now:now()}));assert.equal(calls.length,1);
  const hu=await service.query(speechWordsQuery(new URLSearchParams('member=257043&lang=hu'),{now:now()}));assert.equal(hu.coverage.analyzedTranscripts,0);assert.equal(hu.coverage.missingRequestedLanguage,1);assert.deepEqual(hu.words,[]);
 }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});}
});
test('saved participation links count distinct voters and current delegation shares; future never asks for votes or speeches',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url))),dir=mkdtempSync(path.join(os.tmpdir(),'participation-test-')),store=new ActivityStore(dir),calls=[];
 try{store.acquire();const {generation}=store.beginCycle();
  // Country assignments and ballots are controlled; event links retain the saved public fixture IDs.
  store.setMembers([{id:'257043',countryCode:'IT'},{id:'900001',countryCode:'IT'},{id:'900002',countryCode:'IT'},{id:'900003',countryCode:'ES'},{id:'900004',countryCode:'ES'}]);
  const firstVote={...fixture.decisions.payload.data[0],had_voter_favor:['person/257043','person/257043','person/900003','person/999999'],had_voter_against:['person/900002'],had_voter_abstention:[]};
  const secondVote={...firstVote,id:fixture.decisions.payload.data[1].id,activity_id:fixture.decisions.payload.data[1].activity_id,had_voter_favor:['person/900002'],had_voter_against:[],had_voter_abstention:['person/900003']};
  const decisions={...fixture.decisions,payload:{data:[firstVote,secondVote,firstVote]}};
  const speech=fixture.speech.payload.data[0];store.putSource(generation,'/speeches/'+speech.activity_id,'speech',{id:speech.activity_id},'2026-10-07',speechRows(speech,'2026-10-07'));
  const request=async(ep,params)=>{calls.push(ep);if(ep==='/meetings')return params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}};if(ep.endsWith('/foreseen-activities'))return fixture.foreseen;if(ep.endsWith('/vote-results'))return fixture.results;if(ep.endsWith('/decisions'))return decisions;throw Error('Unexpected upstream fan-out '+ep);};
  const service=new LegislationInsights(store,{clock:now,request,loadMetadata:async()=>new Map()});store.db.exec('PRAGMA query_only=ON');const result=await participation(service,store,participationQuery(new URLSearchParams('sitting=MTG-PL-2026-10-07&country=IT')),{clock:now,readEvent:async id=>id===fixture.speechParent.payload.data[0].activity_id?fixture.speechParent:null});assert.equal(result.topics.find(t=>t.id.endsWith('-D-69')).speakers,1);const italy=result.countries.find(c=>c.code==='IT'),spain=result.countries.find(c=>c.code==='ES');
  assert.equal(italy.delegationSize,3);assert.equal(spain.delegationSize,2);
  const debate=result.topics.find(t=>t.id.endsWith('-D-69')),debateIT=italy.topics.find(t=>t.id===debate.id);
  assert.equal(debate.allSpeakers,1);assert.equal(debate.voters,null);assert.equal(debate.allVoters,null);
  assert.equal(debateIT.speakers,1);assert(Math.abs(debateIT.speakingShare-100/3)<1e-10);assert.equal(debateIT.votingShare,null);assert.equal(debateIT.voters,null);
  const voteTopicId=fixture.results.payload.data[0].executed[0].split('/').at(-1),vote=result.topics.find(t=>t.id===voteTopicId),voteIT=italy.topics.find(t=>t.id===voteTopicId),voteES=spain.topics.find(t=>t.id===voteTopicId);
  assert.equal(vote.voters,2);assert.equal(vote.allVoters,3);assert.equal(vote.rollCalls,2);
  assert.equal(voteIT.voters,2);assert.equal(voteIT.votingShare,2/3*100);assert.equal(voteES.voters,1);assert.equal(voteES.votingShare,50);
  assert.equal(result.countries.find(c=>c.code==='HU').topics.find(t=>t.id===voteTopicId).votingShare,null);
  assert(!calls.some(ep=>ep.startsWith('/speeches/')||ep.startsWith('/events/')));
  let reads=0;const tomorrow={...service,catalogue:async()=>({sittings:[{activity_id:'MTG-PL-2026-10-19',activity_date:'2026-10-19'}]}),query:async()=>({topics:[{id:'future',uri:'eli/dl/event/future',date:'2026-10-19',title:'Future'}]}),record:async()=>{throw Error('Future source requested');},loadMetadata:async()=>new Map()};
  const upcoming=await participation(tomorrow,store,participationQuery(new URLSearchParams('sitting=MTG-PL-2026-10-19')),{clock:now,readEvent:async()=>{reads++;}});assert.equal(upcoming.topics[0].speakers,null);assert.equal(upcoming.topics[0].voters,null);assert.equal(reads,0);
 }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});}
});
test('country query restricts demographic people and uses the appropriate trend denominator',async()=>{
 const {QuestionInsights}=await import('./insights-store.mjs'),fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url))),{projectDocument,documentRows}=await import('./activity-index-model.mjs'),dir=mkdtempSync(path.join(os.tmpdir(),'country-query-test-')),store=new ActivityStore(dir);
 try{store.acquire();const {generation}=store.beginCycle(),doc=fixture.documents.find(d=>d.work.identifier==='E-10-2026-003031'),authors=[...new Set(doc.work.creator.map(p=>p.split('/').at(-1)))];
  // Controlled country assignments test the filter, not real national preferences.
  store.setMembers(authors.map((id,i)=>({id,name:id,countryCode:i<3?'IT':'ES'})));store.putSource(generation,doc.endpoint,'document',projectDocument(doc.work),fixture.verifiedAt,documentRows(doc.work,doc.endpoint,fixture.verifiedAt).rows);store.db.exec('PRAGMA query_only=ON');const service=new QuestionInsights(store,{clock:now,loadMetadata:async()=>new Map()});
  const result=await service.query(insightQuery(new URLSearchParams('days=180&country=IT'),{now:now()}));assert.equal(result.selectedStats.uniqueCurrentMeps,3);assert.equal(result.geography.selected.authorCount,3);assert.equal(result.counts.selectedQuestions,1);assert.equal(result.counts.countryUnassignedQuestions,1);assert.equal(result.questions[0].authors.length,30);assert.equal(result.trend.bins.reduce((n,b)=>n+b.total,0),1);
  const empty=await service.query(insightQuery(new URLSearchParams('days=180&country=HU'),{now:now()}));
  assert.equal(empty.counts.selectedQuestions,0);
  assert.equal(empty.trend.latestObservedDate,result.questions[0].date);
  assert(empty.trend.bins.some(b=>b.availability==='partial'&&b.total===0),'missing question subtypes qualify observed zeroes without changing the collection frontier');
  assert.deepEqual(empty.trend.bins.at(-1),{start:result.trend.bins.at(-1).start,end:result.trend.bins.at(-1).end,availability:'unavailable',count:null,total:null,share:null});
 }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});}
});
test('distinctive national vocabulary is considered even outside the global word cloud',()=>{
 const members=new Map(['1','2','3','4'].map(id=>[id,{id,countryCode:id==='4'?'ES':'IT'}])),rows=[];let id=0;
 const question=(title,authors)=>({id:'E-10-2026-'+String(++id).padStart(6,'0'),date:'2026-10-01',titles:{en:title},authors:authors.map(id=>({id}))});
 for(let i=0;i<70;i++){const suffix=String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26);for(let n=0;n<15;n++)rows.push(question('sector'+suffix+' infrastructure'+suffix,['4']));}
 for(let i=0;i<8;i++)rows.push(question('Semiconductor resilience',['1','2','3']));const analyzed=analyzeQuestions(rows);assert(!analyzed.words.some(w=>w.word==='semiconductor-resilience'));const result=countryQuestions(analyzed,members,new Map());assert(result.wordCandidates.some(w=>w.word==='semiconductor-resilience'));assert(result.countries.find(c=>c.code==='IT').features.find(f=>f.id==='word:semiconductor-resilience').highlighted);
});

test('speech topics omit routine temporal words and Hungarian forms of address',()=>{
 assert.deepEqual(speechWordTokens('Madam President, today citizens need healthcare','en'),['citizens','healthcare']);
 assert.deepEqual(speechWordTokens('Tisztelt Elnök Asszony, köszönöm. Egészségügy','hu'),['egészségügy']);
});

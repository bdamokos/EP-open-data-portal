import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {storyLists,rankFacts,selectWeekStory,pressExcerpt,projectStoryLanguage} from './week-story-model.mjs';
import {weekStory,weekStoryQuery,storySitting} from './week-story.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';
import {createInsights} from './insights.mjs';
const vote=(key,differing=0)=>({key,id:key,linked:true,date:'2026-10-22',outcome:'ADOPTED',totals:{for:100,against:99,abstaining:0},differing});
test('competition ranks retain every fifth-place tie and exclude unknown differing only',()=>{
 const rows=Array.from({length:7},(_,i)=>({...vote('v'+i),speeches:i<4?10-i:6}));
 assert.deepEqual(rankFacts(rows,r=>r.speeches,{descending:true}).map(r=>r.rank),[1,2,3,4,5,5,5]);
 const lists=storyLists({votes:[vote('known',1),vote('unknown',null)]});assert.equal(lists.closest.length,2);assert.equal(lists.differing.length,1);
});
test('stories sort by number of lists then rank then exact key; no press leaves highlights',()=>{
 const lists=storyLists({votes:[vote('a'),vote('b',2)],speeches:[{key:'b',linked:true,speeches:5},{key:'c',linked:true,speeches:10}]});
 const result=selectWeekStory(lists,{pressByKey:new Map(['a','b','c'].map(k=>[k,{url:k}]))});
 assert.deepEqual(result.stories.map(s=>s.key),['b','a','c']);
 assert.equal(result.stories[0].vote.id,'b');
 assert.deepEqual(selectWeekStory(lists).stories,[]);assert(selectWeekStory(lists).highlights.length);
 assert.deepEqual(selectWeekStory(storyLists({votes:[vote('a')],completeVotes:false}),{pressByKey:new Map([['a',{}]]),completeVotes:false}),{stories:[],highlights:[]});
});
test('excerpt preserves exact substrings and extends abbreviations, headings add nothing',()=>{
 const paragraph='Dr. Example cited Art. 2. Another sentence.';
 assert.deepEqual(pressExcerpt({lead:' Lead. ',paragraphs:['Lead.',paragraph]}),{lead:'Lead.',second:'Dr. Example cited Art. 2.'});
 assert.equal(pressExcerpt({paragraphs:['Lead','A heading']}).second,null);
});
test('mainVote fallback includes unclassified decisions and differing remains unknown without history',()=>{
 const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};
 const projected=storySitting(f.day);assert(projected.votes.some(v=>v.id===f.raw.activity_id));assert.equal(projected.votes[0].differing,null);
});
const week='2026-10-05',date='2026-10-07',id='MTG-PL-'+date;
const periods={collect:async()=>({weeks:[{week,sittings:[{sittingId:id,date}]}]})};
const clock=()=>Date.parse('2026-11-06T12:00:00Z');
const observedSpeechDay=()=>({records:[{id:'chair',date,type:'chair',parentIds:[],people:[]}]});
test('unfinished weeks do not read votes, press or corpus',async()=>{
 const result=await weekStory({week:'2026-11-09'},{periods,clock,readSpeechFacts:()=>assert.fail()});assert.equal(result.status,'unavailable');assert.deepEqual(result.highlights,[]);
});
test('missing classification suppresses blue cards only; exact executed links and full labels survive',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const readEvent=async eventId=>({payload:{data:[{activity_id:eventId,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_label:{en:'Complete debate label'},executed:f.day.agenda[0].id}]}});
 const options={periods,clock,snapshots:{read:()=>({day:f.day})},readEvent,readSpeechFacts:async()=>({records:[{id:'speech',date,type:'speech',parentIds:['debate'],people:[{id:'1'}]},{id:'blue',date,type:'blue-card-reaction',parentIds:['debate'],people:[{id:'2'}]},{id:'unknown',date,type:null,parentIds:['other'],people:[]}]})};
 const result=await weekStory({week},options);assert.equal(result.status,'complete');assert(result.highlights.some(h=>h.list==='speeches'&&h.titles.en==='Complete debate label'));assert(!result.highlights.some(h=>h.list==='blueCards'));
 const failed=await weekStory({week},{...options,readSpeechFacts:async()=>null});assert.equal(failed.status,'partial');
});
test('query validates week and language',()=>{assert.equal(weekStoryQuery(new URLSearchParams({week,lang:'hu'})).language,'hu');assert.throws(()=>weekStoryQuery(new URLSearchParams({week:'2026-10-06'})));});
test('cache coalesces complete views, retries partial views and changes with generation/day',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 let reads=0,generation=1,now=clock();const insights=createInsights({status:()=>({servingGeneration:generation}),get:()=>0},{clock:()=>now,viewCache:{directory:null},weekStory:{store:null,periods,readSpeechFacts:async()=>{reads++;return reads===1?null:observedSpeechDay();},snapshots:{read:()=>({day:f.day})}}});
 const query=new URLSearchParams({week});await Promise.all([insights.query('week-story',query),insights.query('week-story',query)]);assert.equal(reads,1);
 await insights.query('week-story',query);await insights.query('week-story',query);assert.equal(reads,2);
 generation++;await insights.query('week-story',query);assert.equal(reads,3);now+=86400000;await insights.query('week-story',query);assert.equal(reads,4);
});
test('the top fact survives in every list and closest rejected highlight is distinct',()=>{
 const v={...vote('same',2),outcome:'REJECTED'};
 const result=selectWeekStory(storyLists({votes:[v]}));
 assert.deepEqual(result.highlights.map(r=>r.list),['closest','differing']);
});
test('duplicate reference keeps the best ranked fact regardless of source order',()=>{
 const a={...vote('same'),speeches:20},b={...vote('same'),speeches:1};
 assert.equal(rankFacts([a,b],r=>r.speeches,{descending:true})[0].speeches,20);
});
test('a partial sitting suppresses every vote list and story even with a matching release',async()=>{
 const f=voteFixture();f.day.coverage={state:'partial'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>observedSpeechDay(),pressStore:{forWeek:()=>[{id:'release',url:'https://example.test',lead:'Source words.'}]}});
 assert.deepEqual(result.stories,[]);assert.deepEqual(result.highlights,[]);
});
test('joint debates take one rank and keep all exact keys and agenda items',()=>{
 const joint={key:'a|b',keys:['a','b'],id:'joint',linked:true,agendaItemIds:['item-a','item-b'],speeches:100,blueCards:10};
 const rows=[joint,...Array.from({length:4},(_,i)=>({key:'c'+i,id:'d'+i,speeches:99-i,linked:true}))];
 const lists=storyLists({speeches:rows,blueCards:[joint]});assert.equal(lists.speeches.length,5);assert.equal(lists.speeches[4].rank,5);
 const result=selectWeekStory(lists,{pressByKey:new Map([['b',{url:'press'}]])});assert.equal(result.stories.length,1);assert.equal(result.stories[0].key,'b');assert.deepEqual(result.stories[0].item.agendaItemIds,['item-a','item-b']);assert.deepEqual(result.highlights,[]);
 const highlights=selectWeekStory(lists).highlights;assert.equal(highlights.length,1);assert.deepEqual(highlights[0].lists,['speeches','blueCards']);
});
test('bare blue-card and catch-the-eye rows are spoken; bare blue cards suppress the blue list',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readEvent:async()=>null,readSpeechFacts:async()=>({records:['blue-card','blue-card','catch-the-eye'].map((type,i)=>({id:String(i),date,type,parentIds:['debate'],people:['123']}))})});
 const highlighted=result.highlights.find(row=>row.list==='speeches');assert.equal(highlighted.speeches,3);assert.equal(highlighted.speakers,1);assert.deepEqual(highlighted.titles,{});assert.equal(result.status,'partial');assert.equal(highlighted.linked,false);assert(!result.highlights.some(row=>row.list==='blueCards'));
});
test('missing vote facts and missing debate labels remain partial and retryable',async()=>{
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>null},readSpeechFacts:async()=>observedSpeechDay()});assert.equal(result.status,'partial');
 const f=voteFixture();f.day.coverage={state:'complete'};
 const missing=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readEvent:async()=>null,readSpeechFacts:async()=>({records:[{id:'s',date,type:'speech',parentIds:['missing'],people:[]}]})});assert.equal(missing.status,'partial');assert.equal(missing.highlights.find(h=>h.id==='missing').labelStatus,'unavailable');
});
test('hands main votes remain in story lookup while ranking requires counted totals',()=>{
 const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};f.raw.decision_method='def/ep-decision-methods/VOTE_HAND';
 for(const field of ['had_voter_favor','had_voter_against','had_voter_abstention','number_of_votes_favor','number_of_votes_against','number_of_votes_abstention'])delete f.raw[field];
 const result=storySitting(f.day);const shown=result.storyVotes.find(row=>row.id===f.raw.activity_id);assert(shown);assert.equal(shown.method,'VOTE_HAND');assert.equal(result.votes.some(v=>v.id===shown.id),false);
});
test('language projection keeps requested labels and English, with held fallback',()=>{
 const value={highlights:[{titles:{en:'English source',hu:'Hungarian source',fr:'French source'}}]};
 assert.deepEqual(projectStoryLanguage(value,'hu').highlights[0].titles,{en:'English source',hu:'Hungarian source'});
 assert.deepEqual(projectStoryLanguage(value,'en').highlights[0].titles,{en:'English source'});
});
test('languages share complete raw facts; stable partials reuse memory briefly and never persist',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};let reads=0,ready=false,now=clock();
 const insights=createInsights({status:()=>({servingGeneration:1}),get:()=>0},{clock:()=>now,viewCache:{directory:null},weekStory:{store:null,periods,snapshots:{read:()=>ready?{day:f.day}:null},readSpeechFacts:async()=>{reads++;return observedSpeechDay();}}});
 await insights.query('week-story',new URLSearchParams({week,lang:'en'}));await insights.query('week-story',new URLSearchParams({week,lang:'en'}));assert.equal(reads,1);
 ready=true;now+=61_000;
 // InsightViewCache serves the short-lived partial while refreshing it.
 await insights.query('week-story',new URLSearchParams({week,lang:'hu'}));
 for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
 await Promise.all(['en','hu','fr'].map(lang=>insights.query('week-story',new URLSearchParams({week,lang}))));assert.equal(reads,2);
});
test('press lookup uses exact procedure/document IDs and the full Brussels week window',async()=>{
 const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};f.day.coverage={state:'complete'};
 const requests=[];await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>observedSpeechDay(),pressStore:{forWeek:query=>{requests.push(query);return [];}}});
 assert(requests.length>0);for(const query of requests){assert.equal(query.from,'2026-10-05');assert.equal(query.to,'2026-10-11');const expected={'MTG-PL-2026-10-07-OJ-ITM-V-45':{procedures:['2023-0134'],documents:['C-10-2025-0235','A-10-2026-0131']},'MTG-PL-2026-10-07-OJ-ITM-V-48':{procedures:['2025-2117'],documents:['A-10-2026-0237']}}[query.agendaItemId];assert(expected);assert.deepEqual(query.procedureIds,expected.procedures);assert.deepEqual(query.documentIds,expected.documents);}
});
test('a similar label cannot create an exact event or procedure join',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records:[{id:'speech',date,type:'speech',parentIds:['debate'],people:['1']}]}),readEvent:async()=>({payload:{data:[{activity_id:'different-debate',activity_label:{en:'Similar title'},executed:f.day.agenda[0].id}]}}),pressStore:{forWeek:()=>[{url:'press',lead:'Verbatim source.'}]}});
 const highlighted=result.highlights.find(h=>h.id==='debate');assert(highlighted);assert.equal(highlighted.linked,false);assert.deepEqual(highlighted.agendaItemIds,[]);assert.equal(result.status,'partial');
});
test('a missing speech day suppresses every speech ranking and remains partial',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 for(const records of [[],[{id:'speech',date:'2026-10-06',type:'speech',parentIds:['debate'],people:['1']}]]) {
  const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records}),readEvent:()=>assert.fail('an incomplete speech week must not resolve ranks')});
  assert.equal(result.status,'partial');assert(!result.highlights.some(row=>['speeches','blueCards'].includes(row.list)));
 }
});
test('one release linked to several references produces one story with every key and reason',()=>{
 const lists=storyLists({votes:[{...vote('a',3),label:'Exact vote label'}],speeches:[{id:'joint',key:'a|b|c',keys:['a','b','c'],linked:true,speeches:100}]});
 const press={id:'same-release',url:'press',title:'Published title'};
 const result=selectWeekStory(lists,{pressByKey:new Map(['a','b','c'].map(key=>[key,press]))});
 assert.equal(result.stories.length,1);assert.deepEqual(result.stories[0].keys.sort(),['a','b','c']);assert.deepEqual(result.stories[0].reasons.map(r=>r.list).sort(),['closest','differing','speeches']);assert.equal(result.highlights.length,0);assert.equal(result.stories[0].vote.label,'Exact vote label');
});
test('a ranked vote label never comes from a different decision on the same reference',()=>{
 const ranked={...vote('a'),id:'ranked',label:'Label of ranked vote'};
 const result=selectWeekStory(storyLists({votes:[ranked]}),{pressByKey:new Map([['a',{id:'press'}]]),voteByKey:new Map([['a',{id:'other',label:'Label of another vote'}]])});
 assert.equal(result.stories[0].vote.id,'ranked');assert.equal(result.stories[0].vote.label,'Label of ranked vote');
});
test('held oral vote explanation events cannot enter the debate lists',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records:[{id:'speech',date,type:'speech',parentIds:['explanation'],people:['1']}]}),readEvent:async()=>({payload:{data:[{activity_id:'explanation',had_activity_type:'def/ep-activities/PLENARY_VOTE_EXPLANATIONS',activity_label:{en:'Published explanation label'}}]}})});
 assert(!result.highlights.some(row=>row.id==='explanation'));
});
test('conflicting summary decisions cannot become story votes',()=>{
 const f=voteFixture();f.raw._conflictingSourceObservations=['fixture'];
 assert(!storySitting(f.day).storyVotes.some(row=>row.id===f.raw.activity_id));
});
test('lasting speech gaps reuse memory across languages without being written to disk',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'week-partial-cache-'));let reads=0;
 const f=voteFixture();f.day.coverage={state:'complete'};
 try {
  const insights=createInsights({status:()=>({servingGeneration:1}),get:()=>0},{clock,viewCache:{directory},weekStory:{store:null,periods,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>{reads++;return {records:[]};}}});
  for(const lang of ['en','hu','en'])assert.equal((await insights.query('week-story',new URLSearchParams({week,lang}))).status,'partial');
  assert.equal(reads,1);assert.deepEqual(readdirSync(directory,{recursive:true}),[]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('a shared release keeps vote-derived reasons attached to its displayed vote',()=>{
 const a={...vote('a',5),id:'vote-a',label:'Published A label',totals:{for:100,against:99,abstaining:0}};
 const b={...vote('b',50),id:'vote-b',label:'Published B label',totals:{for:100,against:90,abstaining:0}};
 const press={id:'joint-release',url:'press'};
 const [story]=selectWeekStory(storyLists({votes:[a,b]}),{pressByKey:new Map([['a',press],['b',press]])}).stories;
 assert.equal(story.vote.id,'vote-a');
 assert.deepEqual(story.reasons.map(({list,rank,value,key,voteId})=>({list,rank,value,key,voteId})),[
  {list:'closest',rank:1,value:1,key:'a',voteId:'vote-a'},
  {list:'differing',rank:2,value:5,key:'a',voteId:'vote-a'},
 ]);
 assert(!story.reasons.some(reason=>reason.value===50));assert.deepEqual(story.keys,['a','b']);
});
test('disabled and absent corpus states reuse vote projections for sixty seconds',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'week-no-corpus-')),previous={CORPUS_DIR:process.env.CORPUS_DIR,CORPUS_ENABLED:process.env.CORPUS_ENABLED};
 const f=voteFixture();f.day.coverage={state:'complete'};
 try {
  for(const enabled of ['false','true']) {
   process.env.CORPUS_DIR=directory;process.env.CORPUS_ENABLED=enabled;let voteReads=0;
   const insights=createInsights({status:()=>({servingGeneration:1}),get:()=>0},{clock,viewCache:{directory:null},weekStory:{store:null,periods,snapshots:{read:()=>{voteReads++;return {day:f.day};}}}});
   for(const lang of ['en','hu','en'])assert.equal((await insights.query('week-story',new URLSearchParams({week,lang}))).status,'partial');
   assert.equal(voteReads,1,'lasting corpus absence must not reproject votes on every visit');
  }
 }finally{
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  rmSync(directory,{recursive:true,force:true});
 }
});

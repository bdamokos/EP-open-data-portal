import test from 'node:test';
import assert from 'node:assert/strict';
import {storyLists,rankFacts,selectWeekStory,pressExcerpt} from './week-story-model.mjs';
import {weekStory,weekStoryQuery,storySitting} from './week-story.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';
import {createInsights} from './insights.mjs';
const vote=(key,differing=0)=>({key,id:key,linked:true,date:'2026-10-22',outcome:'ADOPTED',totals:{for:100,against:99,abstaining:0},differing});
test('competition ranks retain every fifth-place tie and exclude unknown differing only',()=>{
 const rows=Array.from({length:7},(_,i)=>({...vote('v'+i),speeches:i<4?10-i:6}));
 assert.deepEqual(rankFacts(rows,r=>r.speeches,{descending:true}).map(r=>r.rank),[1,2,3,4,5,5,5]);
 const lists=storyLists({votes:[vote('known'),vote('unknown',null)]});assert.equal(lists.closest.length,2);assert.equal(lists.differing.length,1);
});
test('stories sort by number of lists then rank then exact key; no press leaves highlights',()=>{
 const lists=storyLists({votes:[vote('a'),vote('b',2)],speeches:[{key:'b',linked:true,speeches:5},{key:'c',linked:true,speeches:10}]});
 const result=selectWeekStory(lists,{pressByKey:new Map(['a','b','c'].map(k=>[k,{url:k}]))});
 assert.deepEqual(result.stories.map(s=>s.key),['b','a','c']);
 assert.equal(result.stories[0].vote,null);
 assert.deepEqual(selectWeekStory(lists).stories,[]);assert(selectWeekStory(lists).highlights.length);
 assert.deepEqual(selectWeekStory(storyLists({votes:[vote('a')],completeVotes:false}),{pressByKey:new Map([['a',{}]]),completeVotes:false}),{stories:[],highlights:[]});
});
test('excerpt preserves exact substrings and extends abbreviations, headings add nothing',()=>{
 const paragraph='Dr. Example cited Art. 2. Another sentence.';
 assert.deepEqual(pressExcerpt({lead:' Lead. ',paragraphs:['Lead.',paragraph]}),{lead:'Lead.',sentence:'Dr. Example cited Art. 2.'});
 assert.equal(pressExcerpt({paragraphs:['Lead','A heading']}).sentence,null);
});
test('mainVote fallback includes unclassified decisions and differing remains unknown without history',()=>{
 const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};
 const projected=storySitting(f.day);assert(projected.votes.some(v=>v.id===f.raw.activity_id));assert.equal(projected.votes[0].differing,null);
});
const week='2026-10-05',date='2026-10-07',id='MTG-PL-'+date;
const periods={collect:async()=>({weeks:[{week,sittings:[{sittingId:id,date}]}]})};
const clock=()=>Date.parse('2026-11-06T12:00:00Z');
test('unfinished weeks do not read votes, press or corpus',async()=>{
 const result=await weekStory({week:'2026-11-09'},{periods,clock,readSpeechFacts:()=>assert.fail()});assert.equal(result.status,'unavailable');assert.deepEqual(result.highlights,[]);
});
test('missing classification suppresses blue cards only; exact executed links and full labels survive',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const readEvent=async eventId=>({payload:{data:[{activity_id:eventId,activity_label:{en:'Complete debate label'},executed:f.day.agenda[0].id}]}});
 const options={periods,clock,snapshots:{read:()=>({day:f.day})},readEvent,readSpeechFacts:async()=>({records:[{id:'speech',type:'speech',parentIds:['debate'],people:[{id:'1'}]},{id:'blue',type:'blue-card-reaction',parentIds:['debate'],people:[{id:'2'}]},{id:'unknown',type:null,parentIds:['other'],people:[]}]})};
 const result=await weekStory({week},options);assert.equal(result.status,'complete');assert(result.highlights.some(h=>h.list==='speeches'&&h.titles.en==='Complete debate label'));assert(!result.highlights.some(h=>h.list==='blueCards'));
 const failed=await weekStory({week},{...options,readSpeechFacts:async()=>null});assert.equal(failed.status,'partial');
});
test('query validates week and language',()=>{assert.equal(weekStoryQuery(new URLSearchParams({week,lang:'hu'})).language,'hu');assert.throws(()=>weekStoryQuery(new URLSearchParams({week:'2026-10-06'})));});
test('cache coalesces complete views, retries partial views and changes with generation/day',async()=>{
 let reads=0,generation=1,now=clock();const insights=createInsights({status:()=>({servingGeneration:generation}),get:()=>0},{clock:()=>now,viewCache:{directory:null},weekStory:{store:null,periods,readSpeechFacts:async()=>{reads++;return reads===1?null:{records:[]};},snapshots:{read:()=>null}}});
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
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records:[]}),pressStore:{forWeek:()=>[{id:'release',url:'https://example.test',lead:'Source words.'}]}});
 assert.deepEqual(result.stories,[]);assert.deepEqual(result.highlights,[]);
});

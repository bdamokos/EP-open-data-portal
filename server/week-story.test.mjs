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
 const f=voteFixture();f.day.coverage={state:'complete'};
 let reads=0,generation=1,now=clock();const insights=createInsights({status:()=>({servingGeneration:generation}),get:()=>0},{clock:()=>now,viewCache:{directory:null},weekStory:{store:null,periods,readSpeechFacts:async()=>{reads++;return reads===1?null:{records:[]};},snapshots:{read:()=>({day:f.day})}}});
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
test('joint debates take one rank and keep all exact keys and agenda items',()=>{
 const joint={key:'a|b',keys:['a','b'],id:'joint',linked:true,agendaItemIds:['item-a','item-b'],speeches:100,blueCards:10};
 const rows=[joint,...Array.from({length:4},(_,i)=>({key:'c'+i,id:'d'+i,speeches:99-i,linked:true}))];
 const lists=storyLists({speeches:rows,blueCards:[joint]});assert.equal(lists.speeches.length,5);assert.equal(lists.speeches[4].rank,5);
 const result=selectWeekStory(lists,{pressByKey:new Map([['b',{url:'press'}]])});assert.equal(result.stories.length,1);assert.equal(result.stories[0].key,'b');assert.deepEqual(result.stories[0].item.agendaItemIds,['item-a','item-b']);assert.deepEqual(result.highlights,[]);
 const highlights=selectWeekStory(lists).highlights;assert.equal(highlights.length,1);assert.deepEqual(highlights[0].lists,['speeches','blueCards']);
});
test('bare blue-card and catch-the-eye rows are spoken; bare blue cards suppress the blue list',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readEvent:async()=>null,readSpeechFacts:async()=>({records:['blue-card','blue-card','catch-the-eye'].map((type,i)=>({id:String(i),type,parentIds:['debate'],parentTitles:{debate:{en:'Held parent label'}},people:['123']}))})});
 const highlighted=result.highlights.find(row=>row.list==='speeches');assert.equal(highlighted.speeches,3);assert.equal(highlighted.speakers,1);assert.deepEqual(highlighted.titles,{en:'Held parent label'});assert.equal(highlighted.linked,false);assert(!result.highlights.some(row=>row.list==='blueCards'));
});
test('missing vote facts and missing debate labels remain partial and retryable',async()=>{
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>null},readSpeechFacts:async()=>({records:[]})});assert.equal(result.status,'partial');
 const f=voteFixture();f.day.coverage={state:'complete'};
 const missing=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readEvent:async()=>null,readSpeechFacts:async()=>({records:[{id:'s',type:'speech',parentIds:['missing'],people:[]}]})});assert.equal(missing.status,'partial');assert.equal(missing.highlights.find(h=>h.id==='missing').labelStatus,'unavailable');
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
test('languages share complete raw facts; partial vote facts are retried',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};let reads=0,ready=false;
 const insights=createInsights({status:()=>({servingGeneration:1}),get:()=>0},{clock,viewCache:{directory:null},weekStory:{store:null,periods,snapshots:{read:()=>ready?{day:f.day}:null},readSpeechFacts:async()=>{reads++;return {records:[]};}}});
 await insights.query('week-story',new URLSearchParams({week,lang:'en'}));await insights.query('week-story',new URLSearchParams({week,lang:'en'}));assert.equal(reads,2);
 ready=true;await Promise.all(['en','hu','fr'].map(lang=>insights.query('week-story',new URLSearchParams({week,lang}))));assert.equal(reads,3);
});
test('press lookup uses exact procedure/document IDs and the full Brussels week window',async()=>{
 const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};f.day.coverage={state:'complete'};
 const requests=[];await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records:[]}),pressStore:{forWeek:query=>{requests.push(query);return [];}}});
 assert(requests.length>0);for(const query of requests){assert.equal(query.from,'2026-10-05');assert.equal(query.to,'2026-10-11');assert(Array.isArray(query.procedureIds));assert(Array.isArray(query.documentIds));}
});
test('a similar label cannot create an exact event or procedure join',async()=>{
 const f=voteFixture();f.day.coverage={state:'complete'};
 const result=await weekStory({week},{periods,clock,snapshots:{read:()=>({day:f.day})},readSpeechFacts:async()=>({records:[{id:'speech',type:'speech',parentIds:['debate'],people:['1']}]}),readEvent:async()=>({payload:{data:[{activity_id:'different-debate',activity_label:{en:'Similar title'},executed:f.day.agenda[0].id}]}}),pressStore:{forWeek:()=>[{url:'press',lead:'Verbatim source.'}]}});
 const highlighted=result.highlights.find(h=>h.id==='debate');assert(highlighted);assert.equal(highlighted.linked,false);assert.deepEqual(highlighted.agendaItemIds,[]);assert.equal(result.status,'partial');
});

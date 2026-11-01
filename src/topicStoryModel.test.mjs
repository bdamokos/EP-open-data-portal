import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTopicStories,storyNumber,cleanStoryTitle} from './topicStoryModel.mjs';
const periods=['2025-Q1','2025-Q2','2025-Q3','2025-Q4'];
const debate=(id,place,meps,format=null)=>({id,date:'2025-07-09',q:'2025-Q3',title:'Official title '+id,rawTitle:'Official title '+id,meps,format,places:{[place]:['official']},docs:[]});
const questions=(place,q,n,home=[])=>Array.from({length:n},(_,i)=>({id:place+q+'-'+i,d:q==='2025-Q1'?'2025-01-01':q==='2025-Q2'?'2025-04-01':'2025-07-01',t:place+' official question '+i,places:[place],home}));
const facts=()=>({questions:[...questions('IND','2025-Q1',2),...questions('IND','2025-Q2',2),...questions('IND','2025-Q3',8),...questions('FRA','2025-Q3',12,['FRA'])],debates:[debate('MTG-PL-2025-07-09-PVCRE-ITM-1','FRA',20),debate('MTG-PL-2025-07-09-PVCRE-ITM-2','FRA',10),debate('MTG-PL-2025-07-09-PVCRE-ITM-3','IND',5,'urgency')],docs:[],topics:{}});
const selection={periods,partial:[],period:'2025-Q3',labels:{FRA:'France',IND:'India'}};
test('stories select at most four sentences in maintainer priority order with exact linked record sets',()=>{
 const rows=buildTopicStories(facts(),selection);assert.deepEqual(rows.map(r=>r.id),['topics.story.busiest','topics.story.urgencyOne','topics.story.mostDebated','topics.story.rise']);assert.equal(rows[3].values.questions.text,'12');assert.equal(rows[3].values.questions.records.length,12);
 for(const row of rows)assert(Object.values(row.values).some(v=>v?.records?.length||Array.isArray(v)&&v.some(x=>x.records.length)));
});
test('zoom excludes countries outside the approved geometry box; own-country filtering removes only matching origins',()=>{
 const europe=buildTopicStories(facts(),{...selection,zoom:'eu'});assert(!JSON.stringify(europe).includes('India'));assert.equal(europe.find(r=>r.id==='topics.story.rise').values.place.text,'France');
 const other=buildTopicStories(facts(),{...selection,excludeOwn:true});assert.equal(other.find(r=>r.id==='topics.story.rise').values.place.text,'India');assert(!other.some(r=>r.id==='topics.story.leader'));
});
test('partial quarters cannot claim a rise and document mode never emits question stories',()=>{
 assert(!buildTopicStories(facts(),{...selection,partial:['2025-Q3']}).some(r=>r.id==='topics.story.rise'));
 assert(!buildTopicStories(facts(),{...selection,mode:'d'}).some(r=>/rise|leader|Questions/.test(r.id)));
});
test('unknown outcomes never become none; known adopted and rejected decisions retain their exact text and tally',()=>{
 const f=facts(),doc={id:'RC-10-2025-0001',date:'2025-07-09',type:'RESOLUTION_MOTION_JOINT',title:'JOINT MOTION FOR A RESOLUTION on India',places:['IND'],keywords:[],outcome:{outcome:'UNKNOWN',for:null,against:null,abst:null}};f.docs.push(doc);f.debates[2].docs=[doc.id];
 assert(!buildTopicStories(f,{...selection,place:'IND'}).some(r=>/adopted|rejected/.test(r.id)));
 doc.outcome={outcome:'ADOPTED',for:400,against:50,abst:12};const adopted=buildTopicStories(f,{...selection,place:'IND'}).find(r=>r.id==='topics.story.adoptedTally');assert.equal(adopted.values.text.text,'India');assert.equal(adopted.values.text.records[0].id,doc.id);
 doc.outcome.outcome='REJECTED';assert(buildTopicStories(f,{...selection,place:'IND'}).some(r=>r.id==='topics.story.rejectedTally'));
});
test('numbers spell one through nine in English only; official title text is unchanged after its fixed prefix',()=>{
 assert.equal(storyNumber(1,'en'),'one');assert.equal(storyNumber(9,'en-GB'),'nine');assert.equal(storyNumber(9,'hu'),'9');assert.equal(storyNumber(10,'en'),'10');
 assert.equal(cleanStoryTitle('JOINT MOTION FOR A RESOLUTION on India: an exact title'),'India: an exact title');assert.equal(cleanStoryTitle('India — an exact title'),'India — an exact title');
});

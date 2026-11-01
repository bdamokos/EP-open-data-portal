import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTopicStories,storyNumber,cleanStoryTitle,strongStoryPlace,primaryStoryPlace} from './topicStoryModel.mjs';
const periods=['2025-Q1','2025-Q2','2025-Q3','2025-Q4'];
const selection={periods,partial:[],period:'2025-Q3',labels:{FRA:'France',IND:'India',ESP:'Spain'}};
const debate=(id,p,meps=10,format=null)=>({id,date:'2025-07-09',q:'2025-Q3',title:'Exact title '+id,rawTitle:'Exact title '+id,meps,format,places:{[p]:['title']},docs:[]});
const qs=(p,period,n,home=[])=>Array.from({length:n},(_,i)=>({id:p+period+'-'+i,d:period==='2025-Q1'?'2025-01-01':period==='2025-Q2'?'2025-04-01':period==='2025-Q3'?'2025-07-01':'2025-10-01',t:'Exact question '+i,places:[p],home,authors:home.length?['home']:['outside']}));
const facts=()=>({questions:[...qs('IND','2025-Q1',2),...qs('IND','2025-Q2',2),...qs('IND','2025-Q3',8),...qs('FRA','2025-Q3',12,['FRA'])],debates:[debate('big','FRA',20),debate('other','FRA',10),debate('urgency','IND',5,'urgency')],docs:[],topics:{},mepCountry:{home:'FR',outside:'ES'}});
const doc=(id,outcome='ADOPTED',groups=['PPE','S_D'])=>({id,title:'JOINT MOTION FOR A RESOLUTION on India',date:'2025-07-09',type:'RESOLUTION_MOTION_JOINT',places:['IND'],keywords:['123'],groups,outcome:{id:'decision-'+id,date:'2025-07-09',outcome,for:400,against:50,abst:12}});
const lines=(f,s={})=>buildTopicStories(f,{...selection,...s});
function refs(value,out=[]){if(!value||typeof value==='string')return out;if(Array.isArray(value)){value.forEach(v=>refs(v,out));return out;}if(value.records){out.push(value);refs(value.text,out);}else Object.values(value.values||{}).forEach(v=>refs(v,out));return out;}
function messages(value,out=[]){if(!value||typeof value==='string')return out;if(Array.isArray(value)){value.forEach(v=>messages(v,out));return out;}if(value.message)out.push(value.message);if(value.text)messages(value.text,out);Object.values(value.values||{}).forEach(v=>messages(v,out));return out;}
test('map uses reviewed priority and display order with a strict four-sentence budget and exact records',()=>{
 const rows=lines(facts());assert.deepEqual(rows.map(r=>r.id),['topics.story.map.bigDebate.place','topics.story.map.urgency.one','topics.story.map.mostDebated','topics.story.map.rise.rare']); // sole riser leads: no fabricated leader sentence
 assert(rows.reduce((n,r)=>n+r.cost,0)<=4);for(const r of rows)assert(refs(r).every(v=>v.records.length));
 const rise=rows.find(r=>r.id.includes('.rise.'));assert.equal(rise.values.questions.records.length,12);assert.equal(rise.values.questions.text.values.count,'12');
});
test('weak keyword links never make debates on a place; geography and own-country filters use exact identities',()=>{
 const f=facts();f.debates=[{...debate('weak','FRA',100),places:{FRA:['official']}}];assert.equal(primaryStoryPlace(f.debates[0]),null);assert.equal(strongStoryPlace(f.debates[0],'FRA'),false);assert(!lines(f,{place:'FRA'}).some(r=>r.id.includes('.debate')));
 const own=facts();own.questions.push(...qs('FRA','2025-Q3',3,['FRA','IND']));const without=lines(own,{excludeOwn:true});const rise=without.find(r=>r.id.includes('.rise.'));assert.equal(rise.values.place.text,'India');assert.equal(rise.values.questions.records.length,8);
 assert(!JSON.stringify(lines(facts(),{zoom:'eu'})).includes('Exact title urgency'));
});
test('ties never declare a sole leader; a tie breaks a later leadership streak',()=>{
 const f={questions:[...qs('FRA','2025-Q1',2),...qs('ESP','2025-Q1',2),...qs('FRA','2025-Q2',3),...qs('ESP','2025-Q2',2),...qs('FRA','2025-Q3',4),...qs('ESP','2025-Q3',2)],debates:[],docs:[],topics:{}};
 const tied=lines(f,{period:'2025-Q1'});assert.equal(tied[0].id,'topics.story.map.lead.tied');assert.equal(tied[0].values.places.length,2);assert.equal(lines(f)[0].id,'topics.story.map.lead.again');
 f.questions.push(...qs('FRA','2025-Q4',5));const streak=lines(f,{period:'2025-Q4'})[0];assert.equal(streak.id,'topics.story.map.lead.streak');assert.equal(streak.values.ordinal.text.message,'topics.story.ordinal.words.3');assert.equal(streak.values.ordinal.records.length,12);
});
test('urgency place links contain the debate and its adopted resolution, retaining the exact decision',()=>{
 const f=facts(),a=doc('RC-10-2025-0001'),b=doc('RC-10-2025-0002','REJECTED');f.docs=[a,b];f.debates=[{...debate('u1','IND',10,'urgency'),docs:[a.id]},{...debate('u2','ESP',10,'urgency'),docs:[b.id]}];
 const row=lines(f).find(r=>r.id.includes('.urgency.'));const india=row.values.places.find(p=>p.text==='India');assert.deepEqual(india.records.map(r=>r.id),['u1',a.id]);assert.equal(india.records[1].outcome.id,'decision-'+a.id);assert.equal(row.values.resolutions,null);
});
test('place quarters use the joint motion’s own groups and show-of-hands wording; unknown outcomes make no assertion',()=>{
 const f=facts(),joint=doc('RC-10-2025-0001','ADOPTED',['PPE','S_D']);joint.derivedFrom=['B-10-2025-0001'];const original={...doc('B-10-2025-0001','ADOPTED',['PPE','S_D','ECR','RENEW']),type:'RESOLUTION_MOTION'};f.docs=[joint,original];f.debates=[{...debate('u','IND',10,'urgency'),docs:[joint.id]}];
 let row=lines(f,{place:'IND'}).find(r=>r.id==='topics.story.place.quarter.debate');assert(messages(row).includes('topics.story.outcome.jointPassed'));assert.equal(row.values.outcome.values.value.values.groups.text,'two');
 joint.outcome={...joint.outcome,for:null,against:null,abst:null,method:'VOTE_HAND'};row=lines(f,{place:'IND'}).find(r=>r.id==='topics.story.place.quarter.debate');assert(messages(row).includes('topics.story.outcome.showOfHands'));
 delete joint.outcome;row=lines(f,{place:'IND'}).find(r=>r.id==='topics.story.place.quarter.debate');assert.equal(row.values.outcome,null);
});
test('place summaries and question clauses describe any home-country author accurately',()=>{
 const f=facts();const summary=lines(f,{place:'FRA',period:undefined});assert.equal(summary[0].id,'topics.story.place.summary.questionsElsewhere');assert.equal(summary[0].values.elsewhere.text,'0');
 const home=lines(f,{place:'FRA'}).find(r=>r.id==='topics.story.place.quarter.questions');assert(messages(home).includes('topics.story.origin.eachHome'));
 f.questions.push(...qs('FRA','2025-Q3',1,[]));const mixed=lines(f,{place:'FRA'}).find(r=>r.id==='topics.story.place.quarter.questions');assert(messages(mixed).includes('topics.story.origin.onlyElsewhere'));
});
test('partial quarters suppress rises; text mode has no question story and unknown outcomes are not zero',()=>{
 assert(!lines(facts(),{partial:['2025-Q3']}).some(r=>r.id.includes('.rise.')));assert(!lines(facts(),{mode:'d'}).some(r=>r.id.includes('.lead.')||r.id.includes('map.rise.')));
 const f=facts(),unknown=doc('RC-10-2025-0001','UNKNOWN');f.docs=[unknown];assert(!JSON.stringify(lines(f,{mode:'d'})).includes(unknown.id));
});
test('English numbers one–nine and exact title cleaning follow the reviewed rules',()=>{
 assert.equal(storyNumber(1,'en'),'one');assert.equal(storyNumber(9,'en-GB'),'nine');assert.equal(storyNumber(9,'hu'),'9');assert.equal(storyNumber(10,'en'),'10');assert.equal(cleanStoryTitle('JOINT MOTION FOR A RESOLUTION on India: an exact title'),'India: an exact title');assert.equal(cleanStoryTitle('OPINION on India'),'OPINION on India');
});

test('unknown author origin never becomes an assertion that only other-country MEPs asked',()=>{const f=facts();f.questions.push({...qs('FRA','2025-Q3',1)[0],id:'unknown',authors:['missing']});const row=lines(f,{place:'FRA'}).find(r=>r.id==='topics.story.place.quarter.questions');assert.equal(row.values.origin,null);const summary=lines(f,{place:'FRA',period:undefined})[0];assert.equal(summary.id,'topics.story.place.summary.questions');});

test('term totals count distinct group keys instead of repeating a dossier across quarters',()=>{const f=facts();f.topics['eurovoc:123']={label:'Human rights',groups:{'2025-Q1':1,'2025-Q2':1},members:[['A-10-2025-0001','document','2025-01-01','2025-0001'],['A-10-2025-0002','document','2025-04-01','2025-0001']]};const summary=lines(f,{topic:'eurovoc:123',period:undefined})[0];assert.equal(summary.values.groups.text.values.count,'one');assert.equal(summary.values.groups.text.counts.count,1);});

test('story debate headings and their record links remove only leading agenda numbering',()=>{
 const f=facts();f.debates=[{...debate('numbered','FRA',20),title:'19.2. Exact heading (debate)',rawTitle:'19.2. Exact heading (debate)'}];const rows=lines(f);const serialized=JSON.stringify(rows);assert(!serialized.includes('19.2.'));assert(serialized.includes('Exact heading (debate)'));assert.equal(f.debates[0].rawTitle,'19.2. Exact heading (debate)');
});

test('story debate selection requires at least three MEP speakers',()=>{
 const f=facts();f.debates=[debate('one','FRA',1),debate('two','FRA',2)];assert(!JSON.stringify(lines(f)).includes('Exact title'));assert(!lines(f).some(r=>r.id.includes('mostDebated')));assert(!lines(f,{place:'FRA',period:undefined}).some(r=>r.id.includes('plenary')));
 f.debates.push(debate('three','FRA',3));assert(lines(f).some(r=>r.id.includes('bigDebate')));
});
test('bounded debate arrays cannot supply place debate totals or most-debated claims',()=>{
 const f=facts();f.debatesTruncated=true;assert(!lines(f).some(r=>r.id.includes('mostDebated')));assert(!lines(f,{place:'FRA',period:undefined}).some(r=>r.id.includes('plenary')||r.id.endsWith('.peak')));assert(lines(f).some(r=>r.id.includes('bigDebate')));
 f.debatesTruncated={'2025-Q1':false,'2025-Q3':true};assert(!lines(f).some(r=>r.id.includes('mostDebated')));f.debatesTruncated={'2025-Q3':false};assert(lines(f).some(r=>r.id.includes('mostDebated')));
});

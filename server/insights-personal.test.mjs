import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {savedQuery,savedStates} from './insights-saved.mjs';import {participationQuery,participationRows} from './insights-participation.mjs';
import {createSavedStore,savedLinks} from '../src/pocBookmarks.mjs';
import {ActivityStore} from './activity-index-store.mjs';import {projectDocument,documentRows} from './activity-index-model.mjs';import {titleTokens} from './insights-model.mjs';
test('saved-item and participation queries reject duplicate, excessive, malformed and unsupported selections',()=>{
  for(const query of ['questions=E-10-2026-003031,E-10-2026-003031','members=0','members=1&members=2','foo=1','questions=../../x','members='+Array.from({length:101},(_,i)=>i+1).join(',')])assert.throws(()=>savedQuery(new URLSearchParams(query)),e=>e.status===400);
  for(const query of ['week=2026-10-14','week=2026-02-30','week=2026-10-12&sitting=MTG-PL-2026-10-07','topic=x'])assert.throws(()=>participationQuery(new URLSearchParams(query)),e=>e.status===400);
  assert.equal(participationQuery(new URLSearchParams('week=2026-10-12')).week,'2026-10-12');
});
test('batch bookmark checks use existing saved source and item data under query-only SQLite',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url))),directory=mkdtempSync(path.join(os.tmpdir(),'saved-check-')),store=new ActivityStore(directory);
  try{store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043',name:'Abadia'}]);const work=fixture.documents.find(d=>d.work.identifier==='E-10-2026-003031').work;
    const key='/parliamentary-questions/'+work.identifier;store.putSource(generation,key,'document',projectDocument(work),fixture.verifiedAt,documentRows(work,key,fixture.verifiedAt).rows);
    store.db.exec('PRAGMA query_only=ON');const a=savedStates(store,savedQuery(new URLSearchParams('questions=E-10-2026-003031&members=257043'))),b=savedStates(store,savedQuery(new URLSearchParams('questions=E-10-2026-003031&members=257043&lang=hu')));
    assert.equal(a.questions[0].answers[0].id,'E-10-2026-003031-ASW');assert.equal(a.questions[0].revision,b.questions[0].revision);assert.equal(a.questions[0].latest[0].id,'E-10-2026-003031-ASW');assert.equal(a.questions[0].latest[0].recordKind,'answer');assert.equal(a.members[0].total,1);assert.equal(a.members[0].answers[0].id,'E-10-2026-003031-ASW');assert.equal(a.members[0].latest[0].recordKind,'answer');assert.deepEqual(a.members[0].activityIds,['E-10-2026-003031']);assert.equal(a.members[0].name,'Abadia');assert.equal(sources(store),1);
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});
function sources(store){return store.db.prepare('SELECT count(*) n FROM sources').get().n;}
test('participation counts distinct actual voters and oral speakers, not repeated votes, intended corrections or written statements',()=>{
  const topics=[{id:'t',uri:'eli/dl/event/t',kind:'PLENARY_VOTE'},{id:'d',uri:'eli/dl/event/d',kind:'PLENARY_DEBATE'}],results={payload:{data:[{id:'eli/dl/event/v',had_activity_type:'def/PLENARY_VOTE_RESULTS',executed:['eli/dl/event/t']}]}},vote={id:'eli/dl/event/x',inverse_consists_of:['eli/dl/event/v'],had_voter_favor:['person/1'],had_voter_against:['person/2'],had_voter_intended_favor:['person/3'],referenceText:{en:'Amendment 1'}},decisions={payload:{data:[vote,{...vote,id:'eli/dl/event/y'}]}},speechRows=new Map([['d',[{mepId:'1',speechKind:'PLENARY_DEBATE_SPEECH'},{mepId:'1',speechKind:'PLENARY_DEBATE_SPEECH'},{mepId:'2',speechKind:'PLENARY_DEBATE_WRITTEN_STATEMENT'},{mepId:'99',speechKind:'PLENARY_DEBATE_SPEECH'}]]]),members=new Set(['1','2','3']);
  const rows=participationRows(topics,results,decisions,speechRows,members);assert.equal(rows[0].voterIds.size,2);assert(!rows[0].voterIds.has('3'));assert.equal(rows[0].amendmentVotes,2);assert.equal(rows[1].speakerIds.size,1);
  assert.equal(participationRows(topics,null,null,new Map(),members)[0].voterIds,null);
});
test('administrative topic words never join or enter the cloud',()=>{
  assert.deepEqual(titleTokens('EU act regulation directive policy policies'),[]);assert(titleTokens('EU policy on semiconductor supply').includes('semiconductor'));assert.deepEqual(titleTokens('AI Act'),['ai']);
});

test('late answers beyond the rich preview limit change the member revision and survive browser reloads',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url))),directory=mkdtempSync(path.join(os.tmpdir(),'saved-late-answer-')),store=new ActivityStore(directory);
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'257043',name:'Abadia'}]);
    const base=fixture.documents.find(d=>d.work.identifier==='E-10-2026-003031').work;
    const put=(index,answered)=>{const id='E-10-2026-'+String(index).padStart(6,'0'),work={...base,id:'eli/dl/doc/'+id,identifier:id,inverse_answers_to:answered?[{...base.inverse_answers_to[0],id:'eli/dl/doc/'+id+'-ASW',identifier:id+'-ASW',document_date:index===101?'2026-08-01':'2026-09-01'}]:[]};const key='/parliamentary-questions/'+id;store.putSource(generation,key,'document',projectDocument(work),fixture.verifiedAt,documentRows(work,key,fixture.verifiedAt).rows);};
    for(let index=1;index<=101;index++)put(index,index<=100);
    const query=savedQuery(new URLSearchParams('members=257043'));
    const before=savedStates(store,query),disk=new Map(),storage={getItem:key=>disk.get(key)||null,setItem:(key,value)=>disk.set(key,value)},browser=createSavedStore(storage);
    browser.toggle({kind:'mep',id:'257043',title:'Abadia'});browser.observe(before);
    put(101,true);store.db.exec('PRAGMA query_only=ON');
    const after=savedStates(store,query);assert.notEqual(after.members[0].revision,before.members[0].revision);assert.equal(after.members[0].total,before.members[0].total);assert.deepEqual(after.members[0].latest,before.members[0].latest);assert.equal(after.members[0].answers.length,101);
    browser.observe(after);let item=browser.snapshot().items[0];assert(item.newAnswer);assert(!item.newActivity);assert.equal(savedLinks(item)[0].id,'E-10-2026-000101-ASW');assert.equal(savedLinks(item)[0].date,'2026-08-01');assert.equal(savedLinks(item)[0].relatedQuestionId,'E-10-2026-000101');
    browser.markAnswerRead('mep:257043','E-10-2026-000101-ASW');const restarted=createSavedStore(storage);restarted.observe(after);item=restarted.snapshot().items[0];assert.equal(item.baseline.answerIds.length,101);assert(!item.updated);assert(!item.newAnswer);
  } finally {store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});

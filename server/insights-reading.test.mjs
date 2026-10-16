import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {analyzeQuestions,questionFromSource,questionTrend,memberPeople} from './insights-model.mjs';
import {titlePlaces} from './insights-places.mjs';
import {committeeEvent} from './insights-legislation-model.mjs';
import {speechSpeakers} from './speech-speakers.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {runWithRequestSignal,requestSignal} from './request-budget.mjs';

test('an assembled view owns its shared source after the first reader disconnects',async()=>{
  const cache=new InsightViewCache({directory:null}),a=new AbortController(),b=new AbortController(),reason=new Error('reader closed');
  let finish,owner,loads=0;
  const load=async()=>{loads++;owner=requestSignal();await new Promise(resolve=>finish=resolve);return {items:['retained']};};
  const first=runWithRequestSignal(a.signal,()=>assert.rejects(cache.get(['shared-readers'],load),e=>e===reason));
  const second=runWithRequestSignal(b.signal,()=>cache.get(['shared-readers'],load));
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  a.abort(reason);await first;assert(owner);assert.equal(owner.aborted,false);finish();
  assert.deepEqual((await second).items,['retained']);assert.equal(loads,1);
  assert.deepEqual((await cache.get(['shared-readers'],()=>assert.fail('reuse the saved view'))).items,['retained']);
});

test('an expired shared cache owner releases its entry and cannot overwrite a replacement later',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const cache=new InsightViewCache({directory:null});let finish;
  const expired=assert.rejects(cache.get(['late-owner'],()=>new Promise(resolve=>finish=resolve)),e=>e.code==='request_timeout');
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(50000);await expired;assert.equal(cache.pending.size,0);
  assert.deepEqual((await cache.get(['late-owner'],async()=>({items:['replacement']}))).items,['replacement']);
  finish({items:['expired']});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual((await cache.get(['late-owner'],()=>assert.fail('retain replacement'))).items,['replacement']);
});
import {ActivityStore} from './activity-index-store.mjs';
import {projectDocument,documentRows} from './activity-index-model.mjs';
import {createInsights} from './insights.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-reading-live-20261014.json',import.meta.url)));
const sourceQuestions=fixture.questions.map(record=>questionFromSource({key:new URL(record.url).pathname.replace('/api/v2',''),work:record.payload.data[0],fetchedAt:new Date(record.fetchedAt).toISOString()}));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('actual Togo and Colombia questions cannot be merged by human-rights words or a place-free bridge',()=>{
  const bridge={...sourceQuestions[0],id:'TEST-BRIDGE',titles:{en:'Human rights safeguards and public oversight in light of violations'}};
  const result=analyzeQuestions([...sourceQuestions,bridge]);
  const [togo,colombia]=sourceQuestions.map(q=>result.questions.find(x=>x.id===q.id));
  assert(togo.places.some(p=>p.id==='TGO'));assert(colombia.places.some(p=>p.id==='COL'));
  assert(!togo.clusterId||togo.clusterId!==colombia.clusterId);
  assert.equal(result.questions.length,3);
});
test('place recognition uses whole names, longest matches and explicit co-occurrence, not pronoun us',()=>{
  assert.deepEqual(titlePlaces('Help us improve safeguards').places,[]);
  assert.equal(titlePlaces('EU relations with the US').places[0].id,'USA');
  assert.deepEqual(titlePlaces('Trade between Togo and Colombia').places.map(p=>p.id).sort(),['COL','TGO']);
  assert.deepEqual(titlePlaces('Papua New Guinea cooperation').places.map(p=>p.id),['PNG']);
  assert(!analyzeQuestions([{...sourceQuestions[0],titles:{en:'The situation and implementation of measures'}}]).words.length);
});
test('frequent substantive words remain visible and identical informative titles cluster without quadratic pairs',()=>{
  const input=Array.from({length:50},(_,i)=>({...sourceQuestions[0],id:'TEST-'+i,titles:{en:'Commission safeguards for human rights in Togo'}}));
  const result=analyzeQuestions(input);assert.equal(result.clusters.length,1);assert.equal(result.clusters[0].questionCount,50);
  assert.equal(result.words.find(w=>w.word==='togo').questionCount,50);assert.equal(result.words.find(w=>w.word==='rights').questionCount,50);assert(!result.words.some(w=>w.word==='commission'));
});
test('time trend counts one question across all authors, retains empty periods and separates rate from count',()=>{
  const all=[{id:'1',date:'2026-10-01'},{id:'2',date:'2026-10-01'},{id:'3',date:'2026-10-03'}];
  const trend=questionTrend(all,[all[0]],{start:'2026-10-01',end:'2026-10-03',days:3});
  assert.equal(trend.bins[0].count,1);assert.equal(trend.bins[0].share,50);assert.equal(trend.bins[1].total,0);assert.equal(trend.bins[1].share,null);assert.equal(trend.bins[2].share,0);
  const weekly=questionTrend(all,all,{start:'2026-10-01',end:'2026-10-31',days:31});assert.equal(weekly.interval,'week');assert.equal(weekly.bins.at(-1).end,'2026-10-31');assert.equal(weekly.bins.reduce((n,b)=>n+b.count,0),3);
});
test('cards expose explicit current group and country; unknown affiliations remain unknown',()=>{
  const members=new Map([['1',{name:'MEP'}]]),metadata=new Map([['1',{'api:political-group':'S&D','api:country-of-representation':'HU'}]]);
  assert.equal(memberPeople(['1'],members,metadata)[0].group,'S&D');assert.equal(memberPeople(['1'],members,metadata)[0].country,'HU');assert.equal(memberPeople(['2'],members,metadata)[0].group,null);
});
test('actual committee opinions resolve their committee from provided document references; unassigned decision is not invented',()=>{
  const work=fixture.procedure.payload.data[0],event=work.consists_of.find(e=>e.activity_id==='2023-0441-DEC-ADCP-AFET-2024-03-20');
  const row=committeeEvent(event,'2023-0441',fixture.procedure,'en');assert(row.documentIds.includes('AFET-AD-758853'));assert.equal(row.committees[0].code,'AFET');assert.match(row.committees[0].name,/Foreign Affairs/);
  assert.deepEqual(committeeEvent(work.consists_of.find(e=>e.activity_id==='2023-0441-DEC-ADCP-2024-04-18'),'2023-0441',fixture.procedure,'en').committees,[]);
});
test('real guest speaker name and office come from the matching API XML person reference',()=>{
  const {activity,headerXml}=fixture.speaker,result=speechSpeakers(activity,headerXml);assert.equal(result[0].id,'4465');assert.equal(result[0].name,'Raffaele Fitto');assert.match(result[0].role,/Executive Vice-President/);
  assert.equal(speechSpeakers(activity,headerXml.replaceAll('<speech','<question').replaceAll('</speech','</question'))[0].name,'Raffaele Fitto');
  assert.deepEqual(speechSpeakers({...activity,had_participation:{had_participant_person:'https://example.org/person/4465'}},headerXml),[]);
  assert.deepEqual(speechSpeakers(activity,headerXml.replace('person/4465','person/999')),[]);assert.deepEqual(speechSpeakers(activity,'<!DOCTYPE x>'+headerXml),[]);
});
test('assembled views survive restart, serve stale immediately and retain last good during a failed refresh',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-views-'));let now=1000,loads=0;
  try {
    const cache=new InsightViewCache({directory,clock:()=>now,freshMs:100});
    const results=await Promise.all([cache.get(['view'],async()=>{loads++;return {items:[1]};}),cache.get(['view'],async()=>{loads++;return {items:[2]};})]);assert.equal(loads,1);assert.deepEqual(results[0].items,results[1].items);const initial=results[0].items;
    const restarted=new InsightViewCache({directory,clock:()=>now,freshMs:100});assert.deepEqual((await restarted.get(['view'],()=>assert.fail('should read disk'))).items,initial);
    now+=101;let release;
    const first=await restarted.get(['view'],()=>new Promise(resolve=>{loads++;release=resolve;}));assert.deepEqual(first.items,initial);assert(first.viewCache.stale);assert(first.viewCache.refreshInProgress);
    await restarted.get(['view'],()=>assert.fail('refresh must coalesce'));await turn();assert.equal(loads,2);release({items:[3]});await restarted.pending.values().next().value;
    assert.deepEqual((await restarted.get(['view'],()=>assert.fail())).items,[3]);now+=101;
    assert.deepEqual((await restarted.get(['view'],()=>Promise.reject(new Error('offline')))).items,[3]);await turn();await Promise.allSettled([...restarted.pending.values()]);
    const saved=await restarted.get(['view'],()=>assert.fail('bounded failure retry'));assert.deepEqual(saved.items,[3]);assert.equal(saved.viewCache.refreshError,'offline');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('view cache pruning is limited to its generated records, not unrelated files',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-prune-'));
  try {writeFileSync(path.join(directory,'keep.txt'),'keep');const cache=new InsightViewCache({directory,maxEntries:2});for(let i=0;i<4;i++)await cache.get([i],async()=>({id:i}));assert.equal(readdirSync(directory).filter(n=>n.endsWith('.json')).length,2);assert.equal(readFileSync(path.join(directory,'keep.txt'),'utf8'),'keep');}finally{rmSync(directory,{recursive:true,force:true});}
});
test('the Brussels day invalidates an assembled upcoming sitting before its five-minute cache expires',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-day-')),store=new ActivityStore(directory);
  const source=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));
  let now=Date.parse('2026-10-06T21:59:00Z');
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'Maravillas Abadía Jover'}]);store.db.exec('PRAGMA query_only=ON');
    const service=createInsights(store,{clock:()=>now,viewCache:{directory:path.join(directory,'views')},loadMetadata:async()=>new Map(),request:async(endpoint,params)=>endpoint==='/meetings'?params.offset===0?source.meetings:{...source.meetings,payload:{data:[]}}:source.foreseen});
    const search=new URLSearchParams('sitting=MTG-PL-2026-10-07');
    assert.equal((await service.query('legislation',search)).sitting.phase,'upcoming');
    now=Date.parse('2026-10-06T22:01:00Z');assert.equal((await service.query('legislation',search)).sitting.phase,'today');
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});
test('existing answer rows receive the parent subject without reindexing or changing stored data',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'insights-answer-title-')),store=new ActivityStore(dir);
  try {
    store.acquire();const {generation}=store.beginCycle();const original=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url))).documents.find(d=>d.endpoint.startsWith('/parliamentary-questions'));
    const person=original.work.workHadParticipation.find(p=>p.participation_role.endsWith('/AUTHOR')).had_participant_person[0].split('/').at(-1);store.setMembers([{id:person,name:'Actual author'}]);
    const rows=documentRows(original.work,original.endpoint,'2026-10-13T00:00:00Z').rows;for(const row of rows)if(row.recordKind==='answer')row.titles={en:'Answer for question E-000000/26'};
    store.putSource(generation,original.endpoint,'document',projectDocument(original.work),'2026-10-13T00:00:00Z',rows);
    store.db.exec('PRAGMA query_only=ON');const answer=store.page(person,{language:'en',sourceId:original.work.identifier+'-ASW'}).selectedItems.find(row=>row.recordKind==='answer');assert.equal(answer.title,original.work.title_dcterms.en);assert.equal(answer.relatedQuestionId,original.work.identifier);
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});}
});

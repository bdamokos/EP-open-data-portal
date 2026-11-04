import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {HemicycleCollector,clearHemicycleCache,diffPlans,fetchHemicyclePlan,hemicycleResponse,normalizePlan,parseGeometry,prepareHemicycle} from './hemicycle.mjs';
import {dispatchCollector} from './collector-dispatch.mjs';
import {backoffUpstream} from './odp.mjs';

const svg=(count=700)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">${Array.from({length:count},(_,i)=>`<circle id="${i+1}" cx="${i%30}.5" cy="${Math.floor(i/30)}.5" r="7"/>`).join('')}</svg>`;
const person=(id,seat,groupId=7018)=>({seatId:seat,groupId,persId:id,countryCode:'de',firstName:'First'+id,name:'Name'+id});
const source=(seats=Array.from({length:400},(_,i)=>person(i+100,i+10)),startDate='2026-10-22T05:05:11.153+02:00')=>({startDate,groups:[{groupId:7018,name:{short:'EPP'}},{groupId:7028,name:{short:'Greens/EFA'}},{groupId:999995,name:{short:'Council of the European Union'}},{groupId:0,name:{short:'All seats'}}],seats:[...seats,{seatId:1,groupId:999995}]});
const plan=(...args)=>normalizePlan('str',source(...args),svg());
const memoryStore=(t,at=Date.parse('2026-11-04T10:00:00Z'))=>{
  let now=at;const db=new DatabaseSync(':memory:'),meta=new Map();
  const store={db,clock:()=>now,get:k=>meta.get(k),set:(k,v)=>meta.set(k,v),assertWriter(){},transaction(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  prepareHemicycle(store);t.after(()=>db.close());return {store,now:()=>now,advance:ms=>now+=ms};
};
const worker=()=>({controller:new AbortController(),requests:0});

test('a plan keeps exact identifiers, app group codes and every drawn seat',()=>{
  const result=plan();
  assert.equal(result.seats.length,700);
  assert.deepEqual(result.seats.find(seat=>seat.seat===10),{seat:10,x:9.5,y:0.5,r:7,member:100,name:'Name100',firstName:'First100',group:'PPE',country:'DE'});
  assert.equal(result.seats.find(seat=>seat.seat===1).institution,'council');
  assert.equal(result.seats.find(seat=>seat.seat===2).member,undefined,'an unassigned seat stays drawn and has no Member');
  assert.equal(result.sourceDate,'2026-10-22T03:05:11.153Z');
  assert.equal(normalizePlan('str',source([person(1,10,7028),...Array.from({length:400},(_,i)=>person(i+100,i+11))]),svg()).seats.find(seat=>seat.member===1).group,'Verts/ALE');
});
test('only the source date changing is not a new plan',()=>{
  const seats=Array.from({length:400},(_,i)=>person(i+100,i+10));
  assert.equal(plan(seats,'2026-10-22T05:05:11.153+02:00').hash,plan(seats,'2026-11-01T05:05:11.153+01:00').hash);
});
test('damaged or placeholder files are rejected, not published as a smaller chamber',()=>{
  assert.throws(()=>parseGeometry('<html>Please wait</html>'),/viewBox/);
  assert.throws(()=>parseGeometry(svg(10)),/seat count/);
  assert.throws(()=>parseGeometry('<svg viewBox="0 0 9 9">'+'<circle id="1" cx="1" cy="1" r="1"/>'.repeat(700)+'</svg>'),/repeats/);
  assert.throws(()=>parseGeometry('<svg viewBox="0 0 9 9">'+'<circle id="1" '.repeat(40)),/malformed/);
  const started=performance.now();assert.throws(()=>parseGeometry('<svg viewBox="0 0 9 9">'+'<circle '.repeat(100000)),/malformed/);assert(performance.now()-started<200,'unterminated tags fail without rescanning');
  assert.throws(()=>parseGeometry(svg().replace('</svg>','<!-- unterminated')),/malformed/);
  assert.throws(()=>parseGeometry('<svg viewBox="0 0 9 9"/><circle data-id="1" cx="1" cy="1" r="1"/>'),/invalid seat/,'a longer attribute name is not an id');
  assert.throws(()=>parseGeometry(svg().replace('id="1" cx="0.5"','id="1" cx=""')),/invalid seat/,'an empty position is not zero');
  assert.throws(()=>normalizePlan('str',{},svg()),/shape/);
  assert.throws(()=>normalizePlan('str',source([person(1,10)]),svg()),/Member list/);
  assert.throws(()=>normalizePlan('str',source([person(1,9999)]),svg()),/disagree/);
  assert.throws(()=>normalizePlan('str',source([person(1,10),person(1,11),...Array.from({length:400},(_,i)=>person(i+100,i+12))]),svg()),/Member list/);
});
test('comments, CDATA and longer element names are not seats',()=>{
  const seats=parseGeometry(svg().replace('</svg>','<!-- <circle id="1" cx="1" cy="1" r="1"/> --><![CDATA[<circle id="9998" cx="1" cy="1" r="1"/>]]><circles id="9999" cx="1" cy="1" r="1"/></svg>')).seats;
  assert.equal(seats.size,700);assert(!seats.has(9998));assert(!seats.has(9999));
  assert.equal(parseGeometry(`<?xml version="1.0"?><!-- <svg viewBox="0 0 1 1"> -->${svg()}`).width,900);
});
test('a diff names who joined, left, moved and changed group by identifier',()=>{
  const seats=Array.from({length:400},(_,i)=>person(i+100,i+10));
  const next=seats.slice(1).map(seat=>seat.persId===101?{...seat,seatId:500}:seat.persId===102?{...seat,groupId:7028}:seat);
  next.push(person(9000,10));
  const diff=diffPlans(plan(seats),plan(next));
  assert.deepEqual(diff.joined.map(item=>[item.member,item.seat]),[[9000,10]]);
  assert.deepEqual(diff.left.map(item=>item.member),[100]);
  assert.deepEqual(diff.moved.map(item=>[item.member,item.from,item.seat]),[[101,11,500]]);
  assert.deepEqual(diff.regrouped.map(item=>[item.member,item.from,item.group]),[[102,'PPE','Verts/ALE']]);
});
test('the collector records revisions only on change, checks six-hourly and retries after a failure',async t=>{
  const s=memoryStore(t),calls=[];let next=()=>({plan:plan(),validators:{plan:'a',geometry:'b'}});
  const collector=new HemicycleCollector(s.store,{clock:s.now,fetchPlan:async(chamber,options)=>{calls.push([chamber,options.validators]);return next();}});
  const revisions=()=>s.store.db.prepare('SELECT chamber,diff FROM hemicycle_revisions ORDER BY observed_at,chamber').all();
  assert(collector.due());
  assert.equal(await collector.step(worker()),true);assert.equal(await collector.step(worker()),true);
  assert.equal(await collector.step(worker()),false,'both chambers checked');assert(!collector.due());
  assert.deepEqual(calls.map(call=>call[0]),['str','bru']);assert.equal(revisions().length,2);assert.equal(revisions()[0].diff,null,'the first plan is a baseline, not a change');

  s.advance(6*3600000);next=()=>({notModified:true,validators:{plan:'a',geometry:'b'}});
  await collector.step(worker());assert.deepEqual(calls.at(-1),['str',{plan:'a',geometry:'b'}],'held validators are sent');assert.equal(revisions().length,2);

  // A regenerated file with identical seats keeps one revision and updates its date.
  await collector.step(worker());s.advance(6*3600000);
  next=()=>({plan:plan(undefined,'2026-11-05T05:00:00+01:00'),validators:{plan:'c',geometry:'b'}});await collector.step(worker());
  assert.equal(revisions().length,2);assert.equal((await hemicycleResponse('str',{store:s.store,fetchPlan:()=>assert.fail('stored plans are read locally')})).sourceDate,'2026-11-05T04:00:00.000Z');
  await collector.step(worker());

  // A failed check keeps the last plan, reports nothing as changed and retries in an hour.
  s.advance(6*3600000);next=()=>{throw new Error('Hemicycle source returned 500');};
  await collector.step(worker());assert.equal(collector.state().str.error,'Hemicycle source returned 500');assert.equal(collector.state().str.validators.plan,'c');
  await collector.step(worker());s.advance(3599000);assert(!collector.due());s.advance(1000);assert(collector.due());
  assert.equal((await hemicycleResponse('str',{store:s.store})).changes.length,0);

  const moved=Array.from({length:400},(_,i)=>person(i+100,i===0?600:i+10));
  next=()=>({plan:plan(moved),validators:{plan:'d',geometry:'b'}});await collector.step(worker());
  const read=await hemicycleResponse('str',{store:s.store});
  assert.equal(read.changes.length,1);assert.deepEqual(read.changes[0].moved.map(item=>[item.member,item.from,item.seat]),[[100,10,600]]);assert.equal(read.seats.find(seat=>seat.seat===600).member,100);

  // A corrected name is stored but is not listed as a change.
  await collector.step(worker());s.advance(6*3600000);
  next=()=>({plan:plan(moved.map(seat=>seat.persId===101?{...seat,name:'Corrected'}:seat)),validators:{plan:'e',geometry:'b'}});await collector.step(worker());
  const corrected=await hemicycleResponse('str',{store:s.store});
  assert.equal(corrected.seats.find(seat=>seat.member===101).name,'Corrected');assert.equal(corrected.changes.length,1);
});
test('an aborted check leaves the source due without recording an error',async t=>{
  const s=memoryStore(t),run=worker(),collector=new HemicycleCollector(s.store,{clock:s.now,fetchPlan:async()=>{run.controller.abort();throw new Error('aborted');}});
  await assert.rejects(collector.step(run));assert(collector.due());assert.equal(collector.state().str,undefined);
});
test('the hemicycle collector takes a turn in the shared dispatcher',async t=>{
  const s=memoryStore(t);let checks=0;
  const run={...worker(),store:s.store,hemicycle:new HemicycleCollector(s.store,{clock:s.now,fetchPlan:async()=>{checks++;return {plan:plan(),validators:{}};}})};
  assert.equal(await dispatchCollector(run,{topic:async()=>false,story:async()=>false,upcoming:async()=>false}),true);
  assert.equal(checks,1);
});
test('without the index a plan is read live, cached and retained through a failure; changes stay unknown',async t=>{
  clearHemicycleCache();t.after(clearHemicycleCache);
  let now=0,reads=0,fail=false;const clock=()=>now,fetchPlan=async()=>{reads++;if(fail)throw new Error('down');return {plan:plan()};};
  const first=await hemicycleResponse('str',{clock,fetchPlan});
  assert.equal(first.changes,null);assert.equal(first.seats.length,700);assert.equal(first.seats[0].seat,1);
  assert.equal(first.sourcePageUrl,'https://www.europarl.europa.eu/plenary/en/hemicycle.html');
  await hemicycleResponse('str',{clock,fetchPlan});assert.equal(reads,1);
  now=2*3600000;fail=true;assert.equal((await hemicycleResponse('str',{clock,fetchPlan})).seats.length,700);assert.equal(reads,2);
  assert.equal((await hemicycleResponse('str',{clock,fetchPlan})).seats.length,700);assert.equal(reads,2,'a failed read is not repeated by the next page view');
  now+=5*60000;await hemicycleResponse('str',{clock,fetchPlan});assert.equal(reads,3,'it is retried after the pause');
  await assert.rejects(hemicycleResponse('bru',{clock,fetchPlan}),error=>error.status===503);assert.equal(reads,4);
  await assert.rejects(hemicycleResponse('bru',{clock,fetchPlan}),error=>error.status===503);assert.equal(reads,4,'a cold failure is held too');
  await assert.rejects(hemicycleResponse('xxx',{clock,fetchPlan}),error=>error.status===404);
});
test('the collector leaves a check for a run with enough request budget and counts a third read',async t=>{
  const s=memoryStore(t);let checks=0;
  const collector=new HemicycleCollector(s.store,{clock:s.now,fetchPlan:async(chamber,options)=>{checks++;options.onExtraRead();throw new Error('third read failed');}});
  assert.equal(await collector.step({...worker(),budget:10,requests:8}),false);assert.equal(checks,0);assert(collector.due());
  const run={...worker(),budget:10,requests:7};assert.equal(await collector.step(run),true);assert.equal(run.requests,10,'a failed third read is still counted');
});
test('source transport sends validators, refuses redirects and fetches a complete pair when one file changed',async t=>{
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];
  const respond=(url,options)=>{
    calls.push([url,options.headers['If-None-Match']]);assert.equal(options.redirect,'error');assert.match(options.headers['User-Agent'],/^Mozilla\/5\.0 \(compatible; EP-OpenData-Explorer/);
    if(url.endsWith('.json'))return new Response(JSON.stringify(source()),{status:200,headers:{etag:'new'}});
    return options.headers['If-None-Match']?new Response(null,{status:304}):new Response(svg(),{status:200,headers:{etag:'shape'}});
  };
  globalThis.fetch=async(url,options)=>respond(String(url),options);
  const result=await fetchHemicyclePlan('str',{validators:{plan:'old',geometry:'shape'}});
  assert.deepEqual(calls.map(call=>[call[0].split('/').pop(),call[1]]),[['en.json','old'],['str.svg','shape'],['str.svg',undefined]]);
  assert.equal(result.plan.seats.length,700);assert.deepEqual(result.validators,{plan:'new',geometry:'shape'});
  calls.length=0;await fetchHemicyclePlan('bru');
  assert.deepEqual(calls.map(call=>call[0].replace('https://www.europarl.europa.eu','')),['/erpl-public/hemicycle/bru/en.json','/commonFrontResources/evostrap/4.0.1/lib/widgets/hemicycle/svg/bru.svg']);
});
test('source reads stop at the size limit without a declared length and enforce a deadline',async t=>{
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  let pulled=0,cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){pulled++;controller.enqueue(new Uint8Array(256*1024));},cancel(){cancelled=true;}}),{status:200});
  await assert.rejects(fetchHemicyclePlan('str'),/size limit/);
  assert(cancelled,'the oversized body is cancelled');assert(pulled<=16,'reading stops near the limit: '+pulled);
});
test('a stalled body and a paused queue both release the reader at the deadline',async t=>{
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  // Like native fetch, the abort signal errors a body that is still being read.
  globalThis.fetch=async(url,options)=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));options.signal.addEventListener('abort',()=>controller.error(options.signal.reason));}}),{status:200});
  await assert.rejects(fetchHemicyclePlan('str',{timeoutMs:30}),error=>error.name==='TimeoutError');
  let admitted=0;globalThis.fetch=async()=>{admitted++;return new Response('{}',{status:200});};
  backoffUpstream(1,{source:'website'});
  const started=performance.now();
  await assert.rejects(fetchHemicyclePlan('str',{timeoutMs:30}),error=>error.name==='TimeoutError');
  assert(performance.now()-started<900,'the wait ends before the pause does');
  assert.equal(admitted,0,'a paused queue admits nothing');
});

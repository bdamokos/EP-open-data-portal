import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {membershipPersons,membershipSnapshot,scheduleMembership} from './following-membership.mjs';
import {followingResponse,followingStatus} from './insights-following.mjs';
const mandate=(id,start,end)=>({identifier:id,organization:'org/ep-10',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:start,...(end?{endDate:end}:{})}});
const person=(id,...memberships)=>({identifier:String(id),hasMembership:memberships});
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'membership-'));
  const store=new ActivityStore(directory);assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const put=(generation,list,rows)=>store.putSource(generation,'membership:'+list,'membership',{generation,...membershipPersons(rows),retrievedAt:'2026-10-23T09:00:00Z',sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-'+list,retrievedAt:'2026-10-23T09:00:00Z'}]},'2026-10-23T09:00:00Z');
  const read=(generation,extra={})=>followingResponse(store,'following-membership',new URLSearchParams({epoch:store.get('marksEpoch'),generation,...extra}));
  return {store,put,read};
}
test('only exact valid mandate identifiers and dates classify; multiple mandates return',t=>{
  const {store,put}=fixture(t),g=store.beginCycle().generation;
  store.setMembers([{id:'42'},{id:'44'}]);
  put(g,'outgoing',[person(42,mandate('42-m-1','2024-07-16','2025-01-01'),mandate('42-m-2','2025-01-03')),person(43,mandate('43-m-1','2024-07-16','2026-04-13')),person(44,mandate('44-m-1','2024-07-16','2026-04-13')),person(45,mandate('45-m-1','2025-02-01'))]);
  put(g,'incoming',[person(42,mandate('42-m-1','2024-07-16','2025-01-01'),mandate('42-m-2','2025-01-03')),person(46,mandate('46-m-1','2025-02-01'))]);
  store.publish(g);
  const result=membershipSnapshot(store,g);
  assert.equal(result.events.filter(event=>event.id==='42-m-1:end').length,1);
  assert.equal(result.events.find(event=>event.id==='42-m-2:start').subtype,'returned');
  assert.equal(result.events.find(event=>event.id==='46-m-1:start').subtype,'joined');
  assert.deepEqual(result.members['43'],{roster:'absent',status:'former',endDate:'2026-04-13'});
  assert.equal(result.members['42'].status,'current');assert.equal(result.members['44'].status,'unverified');assert.equal(result.members['45'].status,'unverified');
  const parsed=membershipPersons([null,{identifier:'42'},person(42,null,mandate('41-m-1','2025-01-01'),mandate('42-m-4','2025-02-31'),mandate('42-m-5','2025-03-01','2025-01-01'),{...mandate('42-f-1','2025-01-01'),role:'def/ep-roles/MEMBER'})]);
  assert.equal(parsed.malformed,6);assert.deepEqual(parsed.mandates,[]);
});
test('one page per task, full pagination, valid empty list and failed partial pages retain last complete observation',async t=>{
  const {store,put}=fixture(t),g=store.beginCycle().generation;
  put(g,'outgoing',[person(43,mandate('43-m-1','2024-07-16','2026-04-13'))]);store.setMembers([{id:'42'}]);store.publish(g);
  const next=store.beginCycle().generation,calls=[];
  let fail=true;
  const worker=new ActivityWorker(store,{fetchRecord:async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    if(endpoint.endsWith('outgoing')&&params.offset===100)throw Error('offline');
    if(endpoint.endsWith('outgoing'))return {payload:{data:Array.from({length:100},(_,i)=>person(100+i,mandate(`${100+i}-m-1`,'2025-01-01')))},fetchedAt:'2026-10-23T10:00:00Z'};
    if(fail)throw Error('offline');
    return {payload:{data:[]},fetchedAt:'2026-10-23T10:00:00Z'};
  }});
  scheduleMembership(store,next);
  let task;while((task=store.nextTask(next)))await worker.task(task);
  store.publish(next);
  const snapshot=membershipSnapshot(store,next);
  assert.equal(snapshot.lists.outgoing.status,'stale');assert.equal(snapshot.lists.incoming.status,'unavailable');assert.equal(snapshot.events.length,1);
  assert(calls.some(([endpoint,offset])=>endpoint.endsWith('outgoing')&&offset===100));
  const third=store.beginCycle().generation;fail=false;scheduleMembership(store,third);
  while((task=store.nextTask(third)))await worker.task(task);
  store.publish(third);
  assert.equal(membershipSnapshot(store,third).lists.incoming.status,'fresh');assert.equal(membershipSnapshot(store,third).lists.outgoing.status,'stale');
  assert.equal(membershipSnapshot(store,third).lists.incoming.sources.length,1);
});
test('snapshots freeze publication roster, stable marks, 503/409 validation and generation pruning',t=>{
  const {store,put,read}=fixture(t),g1=store.beginCycle().generation;
  assert.equal(read(g1).status,503);assert.equal(followingStatus(store).membershipReady,false);
  store.setMembers([{id:'42'}]);put(g1,'outgoing',[person(43,mandate('43-m-1','2024-07-16','2026-04-13'))]);put(g1,'incoming',[]);store.publish(g1);
  const frozen=read(g1);assert.equal(frozen.status,200);assert.equal(frozen.cacheControl,'public, max-age=3600');assert.equal(followingStatus(store).membershipReady,true);
  const g2=store.beginCycle().generation;store.setMembers([{id:'42'},{id:'43'}]);
  assert.deepEqual(read(g1),frozen);put(g2,'incoming',[person(42,mandate('42-m-1','2026-10-22'))]);store.publish(g2);
  const current=read(g2);assert.equal(current.body.events.find(event=>event.id==='43-m-1:end').mark,g1);
  assert.equal(current.body.events.find(event=>event.id==='42-m-1:start').mark,g2);assert.equal(current.body.members['43'].status,'unverified');
  assert.deepEqual(read(g1),frozen);
  assert.equal(read(g2,{epoch:'00000000-0000-0000-0000-000000000000'}).status,409);
  for(const extra of [{member:'42'},{lang:'en'},{generation:'01'}])assert.throws(()=>read(g2,extra),error=>error.status===400);
  store.beginCycle();assert.equal(read(g1).status,409);assert.equal(membershipSnapshot(store,g1),null);
  assert.equal(store.db.prepare('SELECT mark FROM membership_marks WHERE event_id=?').get('43-m-1:end').mark,g1);
});

test('a complete multi-page observation retains each source URL and counts malformed rows',async t=>{
  const {store}=fixture(t),g=store.beginCycle().generation;
  const worker=new ActivityWorker(store,{fetchRecord:async(endpoint,params)=>({payload:{data:params.offset===0?Array.from({length:100},(_,i)=>person(100+i,mandate(`${100+i}-m-1`,'2025-01-01'))):[null]},fetchedAt:'2026-10-23T10:00:00Z'})});
  store.enqueue(g,'membership:incoming','membership',{list:'incoming',offset:0},109);
  let task;while((task=store.nextTask(g)))await worker.task(task);
  store.setMembers([{id:'100'}]);store.publish(g);
  const result=membershipSnapshot(store,g);assert.equal(result.events.length,100);assert.equal(result.lists.incoming.status,'fresh');assert.equal(result.lists.incoming.malformed,1);
  assert.deepEqual(result.lists.incoming.sources.map(source=>new URL(source.url).searchParams.get('offset')),['0','100']);
  assert.equal(result.lists.outgoing.status,'unavailable');
});

test('existing deployments start without a fabricated snapshot, then baseline at first publication',t=>{
  const {store,read}=fixture(t),g=store.beginCycle().generation;
  store.setMembers([{id:'42'}]);store.publish(g);
  store.db.exec('DROP TABLE membership_snapshots; DROP TABLE membership_marks');store.release();
  const reopened=new ActivityStore(path.dirname(store.filename));t.after(()=>reopened.close());assert(reopened.acquire());
  assert.equal(followingStatus(reopened).membershipReady,false);
  const response=followingResponse(reopened,'following-membership',new URLSearchParams({epoch:reopened.get('marksEpoch'),generation:g}));assert.equal(response.status,503);
  const next=reopened.beginCycle().generation;reopened.publish(next);
  assert.equal(followingStatus(reopened).membershipReady,true);assert.equal(read(next).status,200);
});

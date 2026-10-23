import test from 'node:test';
import assert from 'node:assert/strict';
import {createMembershipStore,MEMBERSHIP_KEY,MEMBERSHIP_WINDOW,membershipEntries,validMembershipEvent} from './followMembership.mjs';
import {createSavedStore,SAVED_KEY} from './bookmarks.mjs';
const epoch='00000000-0000-0000-0000-000000000001';
const event=(mark=1,mep='42',suffix='end')=>({id:`${mep}-m-1:${suffix}`,mep,type:suffix==='end'?'mandate-ended':'mandate-started',subtype:suffix==='end'?null:'joined',date:'2026-04-13',mark});
const snapshot=(generation,events=[],extra={})=>({epoch,generation,lists:{outgoing:{status:'fresh'},incoming:{status:'fresh'}},events,members:{'42':{status:'former',roster:'absent',endDate:'2026-04-13'}},...extra});
const follows=[{kind:'mep',id:'42',savedAt:100,title:'Member 42'}];
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('first availability suppresses backlog, later follow uses current generation; no automatic unfollow',()=>{
  const store=createMembershipStore(storage());store.observe(snapshot(3,[event()]),follows);
  assert.deepEqual(store.snapshot().entries,[]);assert.equal(store.snapshot().baselines['42'].generation,3);
  store.observe(snapshot(4,[event(),event(4,'43')]),follows);
  store.observe(snapshot(4,[event(),event(4,'43')]),[...follows,{...follows[0],id:'43',savedAt:200}]);
  assert.deepEqual(store.snapshot().entries,[]);
  store.observe(snapshot(5,[event(),event(4,'43'),event(5,'42','start')]),[...follows,{...follows[0],id:'43',savedAt:200}]);
  assert.equal(store.snapshot().entries.length,1);assert.equal(store.snapshot().members['42'].status,'former');assert.equal(follows.length,1);
  assert.equal(store.observe(snapshot(4),follows),false);
});
test('epoch change and unavailable recovery establish baselines; a fresh list can work while other list unavailable',()=>{
  const store=createMembershipStore(storage());
  const one={outgoing:{status:'fresh'},incoming:{status:'unavailable'}};
  store.observe(snapshot(1,[],{lists:one}),follows);store.observe(snapshot(2,[event(2)],{lists:one}),follows);
  assert.equal(store.snapshot().entries.length,1);
  store.unavailable();assert.deepEqual(store.snapshot().members,{});
  store.observe(snapshot(4,[event(2),event(4,'42','start')]),follows);assert.equal(store.snapshot().entries.length,1);
  store.observe(snapshot(1,[event(1,'42','start')],{epoch:'00000000-0000-0000-0000-000000000002'}),follows);
  assert.equal(store.snapshot().baselines['42'].generation,1);assert.equal(store.snapshot().entries.length,1);
});
test('membership acknowledgment is independent, all history persists after 24h, old v2 writes do not touch state',()=>{
  let now=1000;const disk=storage(),store=createMembershipStore(disk,()=>{},()=>now);
  store.observe(snapshot(1),follows);store.observe(snapshot(2,[event(2)]),follows);
  assert.equal(membershipEntries(store.snapshot(),'42',now).fresh.length,1);
  const activities=createSavedStore(disk);activities.toggle(follows[0]);activities.markRead('mep:42');
  assert.equal(membershipEntries(store.snapshot(),'42',now).fresh.length,1);
  store.markRead('42',event().id);assert.equal(membershipEntries(store.snapshot(),'42',now).history.length,1);
  store.observe(snapshot(3,[event(2),event(3,'42','start')]),follows);
  now+=MEMBERSHIP_WINDOW;assert.equal(membershipEntries(store.snapshot(),'42',now).fresh.length,0);assert.equal(membershipEntries(store.snapshot(),'42',now).history.length,2);
  const saved=disk.getItem(MEMBERSHIP_KEY);disk.setItem(SAVED_KEY,JSON.stringify({items:[]}));assert.equal(disk.getItem(MEMBERSHIP_KEY),saved);
  const reloaded=createMembershipStore(disk);assert.equal(reloaded.snapshot().entries.length,2);reloaded.syncFollows(follows);assert.equal(reloaded.snapshot().entries.length,2);
  reloaded.syncFollows([]);assert.equal(reloaded.snapshot().entries.length,0);
});
test('storage failures surface and retry; membership validator is distinct from source IDs',()=>{
  let fails=true;const disk=storage(),write=disk.setItem;disk.setItem=(...args)=>{if(fails)throw Error('quota');write(...args);};
  const store=createMembershipStore(disk);store.observe(snapshot(1),follows);assert.equal(store.snapshot().storageError,true);
  fails=false;assert.equal(store.retryStorage(),true);assert.equal(store.snapshot().storageError,false);
  assert.equal(validMembershipEvent(event()),true);assert.equal(validMembershipEvent({...event(),id:'E-10-2026-000001'}),false);
  assert.equal(validMembershipEvent({...event(),mep:'43'}),false);assert.equal(validMembershipEvent({...event(),date:'2026-02-31'}),false);
});

test('a recovering list baselines its own backlog without hiding healthy-list events',()=>{
 const disk=storage(),store=createMembershipStore(disk),one={outgoing:{status:'fresh'},incoming:{status:'unavailable'}};
 store.observe(snapshot(3,[],{lists:one}),follows);
 const departure={...event(4),lists:['outgoing']},backlog={...event(4,'42','start'),lists:['incoming']};
 store.observe(snapshot(4,[departure,backlog]),follows);
 assert.deepEqual(store.snapshot().entries.map(entry=>entry.id),[departure.id]);
 assert.deepEqual(store.snapshot().baselines['42'].lists,{outgoing:3,incoming:4});
 const reloaded=createMembershipStore(disk);reloaded.observe(snapshot(5,[departure,backlog,{...event(5,'42','start'),id:'42-m-2:start',lists:['incoming']}]),follows);
 assert.equal(reloaded.snapshot().entries.length,2);
});
test('a follow made with stale cached status baselines at its first successful snapshot',()=>{
 const store=createMembershipStore(storage());store.observe(snapshot(3),follows);
 const next=[...follows,{...follows[0],id:'43',savedAt:200}];store.syncFollows(next);
 assert.equal(store.snapshot().baselines['43'].generation,null);
 store.observe(snapshot(4,[{...event(4,'43'),lists:['outgoing']}]),next);
 assert.equal(store.snapshot().entries.length,0);assert.equal(store.snapshot().baselines['43'].generation,4);
 store.observe(snapshot(5,[{...event(5,'43','start'),lists:['incoming']}]),next);
 assert.equal(store.snapshot().entries.length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupsStore,GROUPS_KEY,groupEntries,validGroupsSnapshot} from './followGroups.mjs';
const epoch='00000000-0000-0000-0000-000000000001',items=[{kind:'mep',id:'42',savedAt:1},{kind:'mep',id:'43',savedAt:2}];
const event=(mep='42',mark=6,date='2026-06-17',org='2')=>({id:`${mep}:group:${date}:${org}`,mep,type:'group-changed',date,mark,from:{org:'org/1',groupId:'org/SD',code:'S&D'},to:{org:'org/'+org,groupId:'org/RENEW',code:'Renew'}});
const snapshot=(generation=5,events=[],members={'42':{coverage:'complete',stale:false},'43':{coverage:'complete',stale:false}})=>({epoch,generation,events,members});
function fixture() {
 const data=new Map([['ep.following.membership.v1','existing C state'],['ep.following.v2','existing activity state']]),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 let now=100;
 const store=createGroupsStore(storage,()=>{},()=>now);
 return {store,data,storage,time:value=>now=value};
}
test('C upgrade and old-tab writes leave independent group state and suppress historical switches',()=>{
 const {store,data,storage}=fixture();store.observe(snapshot(5,[event('42',5)]),items);assert.equal(store.snapshot().entries.length,0);assert.equal(data.get('ep.following.membership.v1'),'existing C state');
 storage.setItem('ep.following.membership.v1','old tab C update');storage.setItem('ep.following.v2','old tab activity update');store.reload();assert.equal(store.snapshot().baselines['42'].generation,5);
 store.observe(snapshot(6,[event()]),items);assert.equal(store.snapshot().entries.length,1);assert(data.has(GROUPS_KEY));assert.equal(data.get('ep.following.membership.v1'),'old tab C update');
});
test('each person baselines only on first complete coverage; delayed availability has no backlog',()=>{
 const {store}=fixture();store.observe(snapshot(5,[event('42',5)],{'42':{coverage:'partial',stale:false},'43':{coverage:'unavailable',stale:false}}),items);
 assert.equal(store.snapshot().baselines['42'].generation,null);assert.equal(store.snapshot().baselines['43'].generation,null);
 store.observe(snapshot(6,[event('42',5),event('43',6)]),items);assert.equal(store.snapshot().entries.length,0);
 store.observe(snapshot(7,[event('42',7,'2026-07-01'),event('43',7,'2026-07-01')]),items);assert.equal(store.snapshot().entries.length,2);
});
test('validated per-person unavailability rebases that person, while fetch/validation failures never do',()=>{
 const {store}=fixture();store.observe(snapshot(),items);const before=store.snapshot();assert.equal(store.observe({...snapshot(6),epoch:'invalid'},items),false);assert.deepEqual(store.snapshot(),before);
 store.observe(snapshot(6,[],{'42':{coverage:'unavailable',stale:false},'43':{coverage:'complete',stale:false}}),items);
 store.observe(snapshot(7,[event('42',7),event('43',7)]),items);assert.deepEqual(store.snapshot().entries.map(e=>e.mep),['43']);
 assert.equal(store.snapshot().baselines['42'].generation,7);assert.equal(store.snapshot().baselines['43'].generation,5);
});
test('corrections/retractions require a fresh complete person; acknowledgments and expiry stay independent',()=>{
 const {store,time}=fixture();store.observe(snapshot(),items);store.observe(snapshot(6,[event()]),items);assert.equal(groupEntries(store.snapshot(),'42',100).fresh.length,1);
 store.observe(snapshot(7,[],{'42':{coverage:'partial',stale:false},'43':{coverage:'complete',stale:false}}),items);assert.equal(store.snapshot().entries.length,1);
 store.observe(snapshot(8,[],{'42':{coverage:'complete',stale:true},'43':{coverage:'complete',stale:false}}),items);assert.equal(store.snapshot().entries.length,1);
 store.observe(snapshot(9,[event('42',9,'2026-06-18')]),items);assert.deepEqual(store.snapshot().entries.map(e=>e.date),['2026-06-18']);
 store.markRead('42');assert.equal(groupEntries(store.snapshot(),'42',100).fresh.length,0);assert.equal(groupEntries(store.snapshot(),'42',100).history.length,1);
 store.observe(snapshot(10,[event('42',10,'2026-07-01')]),items);time(86_400_101);assert.equal(groupEntries(store.snapshot(),'42',86_400_101).fresh.length,0);
});
test('new follow, epoch restart, out-of-order reads, reload and failed storage',()=>{
 const {store,storage}=fixture();store.observe(snapshot(),items);store.observe(snapshot(6,[event()]),items);assert(store.snapshot().entries.length);
 assert.equal(store.observe(snapshot(4),items),false);store.observe(snapshot(7,[event('42',7)]),[{...items[0],savedAt:3}]);assert.equal(store.snapshot().entries.length,0);
 store.observe({...snapshot(8,[event('42',8)]),epoch:'00000000-0000-0000-0000-000000000002'},items);assert.equal(store.snapshot().entries.length,0);
 const reloaded=createGroupsStore(storage);assert.equal(reloaded.snapshot().baselines['42'].generation,8);
 const broken=createGroupsStore({getItem:()=>null,setItem:()=>{throw Error('full');}});assert(broken.observe(snapshot(),items));assert.equal(broken.snapshot().storageError,true);
});
test('malformed snapshots, event ids, codes, markers and dates are rejected',()=>{
 for(const bad of [{...event(),id:'42-m-1:end'},{...event(),date:'2026-02-31'},{...event(),mark:7},{...event(),to:{org:'org/2',groupId:null,code:'Renew'}}])assert.equal(validGroupsSnapshot(snapshot(6,[bad])),false);
});


test('epoch changes rebaseline while retaining unread entries, read history and discovery times',()=>{
 const {store,storage,time}=fixture();store.observe(snapshot(),items);
 store.observe(snapshot(6,[event(),event('43')]),items);time(200);store.markRead('43');
 const entries=store.snapshot().entries;
 const rebuiltEpoch='00000000-0000-0000-0000-000000000002';
 store.observe({...snapshot(1),epoch:rebuiltEpoch},items);
 assert.deepEqual(store.snapshot().entries,entries);
 assert.equal(groupEntries(store.snapshot(),'42',200).fresh.length,1);
 assert.equal(groupEntries(store.snapshot(),'43',200).history.length,1);
 assert.equal(store.snapshot().baselines['42'].generation,1);
 assert.deepEqual(createGroupsStore(storage).snapshot().entries,entries);
 // Rebuilt marks refresh event metadata without rediscovery or losing acknowledgment.
 store.observe({...snapshot(2,[event('42',1),event('43',1),event('42',2,'2026-07-01')]),epoch:rebuiltEpoch},items);
 assert.equal(store.snapshot().entries.length,3);
 assert.equal(store.snapshot().entries[0].discoveredAt,100);
 assert.equal(store.snapshot().entries[1].readAt,200);
 assert.equal(store.snapshot().entries[2].discoveredAt,200);
});

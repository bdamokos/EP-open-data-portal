import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoverageStore,COVERAGE_KEY,coverageReason} from './followCoverage.mjs';
import {matchesCommittee} from './memberFilters.mjs';
const member=(id,groupCode='S&D',extra={})=>({id,firstName:'Member',lastName:String(id),countryCode:'MT',groupCode,memberships:[],...extra});
const directory=(members,complete=true)=>({members,committees:[{id:'AGRI',code:'AGRI'}],index:{complete,error:null}});
const follows=(...ids)=>ids.map(id=>({kind:'mep',id:String(id)}));
const harness=()=>{const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};return {store:createCoverageStore(storage,()=>{},()=>Date.parse('2026-10-01')),storage,data};};
test('singleton enrolls silently; newcomer persists through observations and reload; dismiss persists',()=>{
 const {store,storage}=harness();store.observe(directory([member(1)]),follows(1));assert.equal(store.snapshot().coverages.length,2);
 store.observe(directory([member(1),member(2)]),follows(1));assert.equal(store.suggestions().length,1);assert.equal(store.suggestions()[0].reasons.length,2);
 store.observe(directory([member(1),member(2)]),follows(1));assert.equal(store.suggestions().length,1);
 const reloaded=createCoverageStore(storage);reloaded.observe(directory([member(1),member(2)]),follows(1));assert.equal(reloaded.suggestions().length,1);
 reloaded.dismiss(2);reloaded.observe(directory([member(1),member(2)]),follows(1));assert.equal(reloaded.suggestions().length,0);
});
test('known group switch gets Now in; unknown to known never suggests',()=>{
 const {store}=harness();store.observe(directory([member(1),member(2,'EPP'),member(3,null,{countryCode:null})]),follows(1));
 store.observe(directory([member(1),member(2),member(3)]),follows(1));assert.deepEqual(store.suggestions().map(s=>s.member.id),[2]);assert.equal(store.suggestions()[0].reasons[0].reason,'Now in the S&D group');
 assert.ok(store.snapshot().coverages.find(c=>c.dimension==='group').members.includes('3'));
});
test('committee uses actual predicate; incomplete observations cannot enroll or create candidates',()=>{
 const chair={id:'AGRI',role:'CHAIR',current:true,start:'2026-10-03'};
 assert.ok(matchesCommittee(member(1,'S&D',{memberships:[chair]}),'AGRI','member'));
 assert.ok(!matchesCommittee(member(1,'S&D',{memberships:[chair]}),'AGRI','substitute'));
 const {store}=harness();store.observe(directory([member(1,'S&D',{memberships:[chair]})],false),follows(1));assert.ok(!store.snapshot().coverages.some(c=>c.dimension==='committee'));
 store.observe(directory([member(1,'S&D',{memberships:[chair]}),member(2,'EPP',{countryCode:'FR'})],true),follows(1));
 store.observe(directory([member(1,'S&D',{memberships:[chair]}),member(2,'EPP',{countryCode:'FR',memberships:[chair]})],false),follows(1));assert.equal(store.suggestions().length,0);
 store.observe(directory([member(1,'S&D',{memberships:[chair]}),member(2,'EPP',{countryCode:'FR',memberships:[chair]})]),follows(1));assert.match(store.suggestions()[0].reasons[0].reason,/Became chair on AGRI/);
});
test('follow adds pending member; explicit unfollow anywhere drops all affected coverages',()=>{
 const {store}=harness();store.observe(directory([member(1)]),follows(1));store.observe(directory([member(1),member(2)]),follows(1));
 store.syncFollows(follows(1,2));assert.equal(store.suggestions().length,0);assert.ok(store.snapshot().coverages.every(c=>c.members.includes('2')));
 store.syncFollows(follows(1));assert.equal(store.snapshot().coverages.length,0);
});
test('departure retains membership; untrusted errors do not create newcomers',()=>{
 const {store}=harness();store.observe(directory([member(1)]),follows(1));store.observe(directory([]),follows(1));
 assert.ok(store.snapshot().coverages.every(c=>c.members.includes('1')));
 store.observe(directory([member(1),member(2)]),follows(1),true);assert.equal(store.suggestions().length,0);
 store.observe(directory([member(1),member(2)]),follows(1));assert.equal(store.suggestions().length,1);
});
test('dated mandate has priority; future group provider fits same reason function',()=>{
 const c={dimension:'group',value:'S&D',enrolledAt:Date.parse('2026-10-01')},m=member(2),d=directory([m]);
 const event={mep:'2',type:'mandate-started',subtype:'returned',date:'2026-10-02'};
 assert.equal(coverageReason(c,m,d,[event]).reason,'Returned to Parliament on October 2, 2026');
 assert.equal(coverageReason(c,m,d,[{mep:'2',type:'group-joined',value:'S&D',date:'2026-10-03'}]).reason,'Joined the S&D group on October 3, 2026');
});
test('storage errors surfaced, malformed state rejected, separate key used',()=>{
 const {store,data}=harness();store.observe(directory([member(1)]),follows(1));assert.ok(data.has(COVERAGE_KEY));
 const bad=createCoverageStore({getItem:()=>'{"version":1,"coverages":[{}]}',setItem:()=>{throw Error('full');}});bad.observe(directory([member(1)]),follows(1));assert.equal(bad.snapshot().storageError,true);
 assert.equal(createCoverageStore(null).snapshot().storageError,true);
});
test('v1 migration preserves coverage state and consolidates differing baselines conservatively',()=>{
 const {storage}=harness();
 const coverage={dimension:'group',value:'S&D',enrolledAt:123,members:['1'],pending:['2'],dismissed:['3'],last:{1:'S&D',2:'EPP',3:'EPP',4:'EPP'}};
 storage.setItem(COVERAGE_KEY,JSON.stringify({version:1,followed:['1'],coverages:[coverage,{...coverage,value:'EPP',members:['4'],pending:[],dismissed:[],last:{1:'S&D',2:'EPP',3:'EPP',4:'S&D'}}]}));
 const store=createCoverageStore(storage);
 assert.equal(store.snapshot().version,2);
 assert.deepEqual(store.snapshot().coverages[0],Object.fromEntries(Object.entries(coverage).filter(([key])=>key!=='last')));
 assert.equal(store.snapshot().last.group['4'],null);
 store.observe(directory([member(1),member(2),member(3),member(4)]),follows(1));
 assert.deepEqual(store.suggestions().map(s=>s.member.id),[2]);
 const restored=createCoverageStore(storage);assert.deepEqual(restored.snapshot(),store.snapshot());
});
test('observation storage scales by dimensions rather than coverages',()=>{
 const {store,storage}=harness();
 const members=Array.from({length:720},(_,i)=>member(i+1,'G'+i%9,{countryCode:['MT','FR','DE'][i%3],memberships:[{id:'C'+i%25,role:'MEMBER',current:true}]}));
 store.observe(directory(members),follows(...members.map(m=>m.id)));
 const saved=JSON.parse(storage.getItem(COVERAGE_KEY));
 assert.equal(saved.coverages.length,37);
 assert.deepEqual(Object.keys(saved.last).sort(),['committee','country','group']);
 for(const map of Object.values(saved.last))assert.equal(Object.keys(map).length,720);
 assert.ok(saved.coverages.every(c=>!Object.hasOwn(c,'last')));
 assert.ok(storage.getItem(COVERAGE_KEY).length<100000);
});
test('directory-only updates publish a new snapshot without writes, restoring suggestions and refreshing names and dates',()=>{
 const {store,storage}=harness(),chair={id:'AGRI',role:'CHAIR',current:true,start:'2026-10-03'};
 const first=directory([member(1,'S&D',{memberships:[chair]}),member(2,'EPP',{countryCode:'FR'})]);
 const next=directory([first.members[0],member(2,'EPP',{countryCode:'FR',memberships:[chair]})]);
 store.observe(first,follows(1));store.observe(next,follows(1));
 let writes=0,notifications=0;
 const reloaded=createCoverageStore({getItem:key=>storage.getItem(key),setItem(){writes++;}},()=>notifications++);
 assert.deepEqual(reloaded.suggestions(),[]);
 let previous=reloaded.snapshot();
 reloaded.observe(next,follows(1));
 assert.notEqual(reloaded.snapshot(),previous);assert.equal(notifications,1);assert.equal(writes,0);
 assert.equal(reloaded.suggestions()[0].member.id,2);
 previous=reloaded.snapshot();
 const changed=directory([next.members[0],{...next.members[1],firstName:'Updated',memberships:[{...chair,start:'2026-10-04'}]}]);
 reloaded.observe(changed,follows(1));
 assert.notEqual(reloaded.snapshot(),previous);assert.equal(notifications,2);assert.equal(writes,0);
 assert.equal(reloaded.suggestions()[0].member.firstName,'Updated');
 assert.match(reloaded.suggestions()[0].reasons[0].reason,/October 4, 2026/);
 reloaded.observe(changed,follows(1));assert.equal(notifications,2);
});
test('explicit unfollow cancellation survives departure, reload and return until a matching follow action',()=>{
 const {store,storage}=harness();
 store.observe(directory([member(1),member(2)]),follows(1,2));
 store.observe(directory([member(1)]),follows(1,2));
 store.syncFollows(follows(1));
 store.observe(directory([member(1)]),follows(1));
 assert.equal(store.snapshot().coverages.length,0);assert.equal(store.snapshot().cancelled.length,2);
 const restored=createCoverageStore(storage);
 restored.observe(directory([member(1),member(2)]),follows(1));
 assert.equal(restored.snapshot().coverages.length,0);assert.deepEqual(restored.suggestions(),[]);
 // An unrelated user follow cannot clear the cancelled filters.
 const other=member(3,'EPP',{countryCode:'FR'});
 restored.observe(directory([member(1),other]),follows(1,3));
 assert.equal(restored.snapshot().cancelled.length,2);
 // A new matching follow clears only its dimension/value cancellations.
 const matching=member(4,'EPP');
 restored.observe(directory([member(1),other,matching]),follows(1,3,4));
 assert.deepEqual(restored.snapshot().cancelled,[{dimension:'group',value:'S&D'}]);
 restored.observe(directory([member(1),other,matching,member(2)]),follows(1,3,4));
 assert.deepEqual(restored.suggestions().map(s=>s.member.id),[2]);
 assert.equal(restored.suggestions()[0].reasons.length,1);
 assert.match(restored.suggestions()[0].reasons[0].context,/Malta/);
});

test('follow before directory load clears cancellation once matching values become known',()=>{
 const {store,storage}=harness();
 store.observe(directory([member(1),member(2)]),follows(1,2));
 store.observe(directory([member(1)]),follows(1,2));
 store.syncFollows(follows(1));
 const reloaded=createCoverageStore(storage);
 reloaded.syncFollows(follows(1,2));
 assert.equal(reloaded.snapshot().cancelled.length,2);
 // The unresolved action survives another reload and an observation without that MEP.
 const restored=createCoverageStore(storage);
 restored.observe(directory([member(1)]),follows(1,2));
 assert.equal(restored.snapshot().cancelled.length,2);
 restored.observe(directory([member(1),member(2)]),follows(1,2));
 assert.deepEqual(restored.snapshot().cancelled,[]);
 assert.equal(restored.snapshot().coverages.length,2);
 restored.observe(directory([member(1),member(2),member(3)]),follows(1,2));
 assert.deepEqual(restored.suggestions().map(s=>s.member.id),[3]);
 assert.equal(restored.suggestions()[0].reasons.length,2);
});
test('unresolved follows resolve per dimension and are discarded on unfollow',()=>{
 const {store,storage}=harness();
 store.observe(directory([member(1),member(2)]),follows(1,2));
 store.observe(directory([member(1)]),follows(1,2));
 store.syncFollows(follows(1));
 const restored=createCoverageStore(storage);
 restored.syncFollows(follows(1,2));
 restored.observe(directory([member(1),member(2,null)]),follows(1,2));
 assert.deepEqual(restored.snapshot().cancelled,[{dimension:'group',value:'S&D'}]);
 assert.deepEqual(restored.snapshot().unresolvedFollows,{group:['2']});
 restored.observe(directory([member(1),member(2)]),follows(1,2));
 assert.deepEqual(restored.snapshot().cancelled,[]);
 assert.deepEqual(restored.snapshot().unresolvedFollows,{});
 // An unresolved follow that is reversed must not reactivate coverage later.
 restored.observe(directory([member(1)]),follows(1,2));
 restored.syncFollows(follows(1));
 restored.syncFollows(follows(1,2));
 restored.syncFollows(follows(1));
 assert.deepEqual(restored.snapshot().unresolvedFollows,{});
 restored.observe(directory([member(1),member(2)]),follows(1));
 assert.equal(restored.snapshot().cancelled.length,2);
 assert.equal(restored.snapshot().coverages.length,0);
});

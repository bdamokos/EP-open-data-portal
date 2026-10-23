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

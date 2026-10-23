import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectGroupHistory,groupEvents,groupHistorySnapshot,scheduleGroupHistory} from './group-history.mjs';
import {followingResponse} from './insights-following.mjs';
const day='2026-10-23T09:00:00Z',mapping={'org/1':{groupId:'org/SD',code:'S&D'},'org/2':{groupId:'org/RENEW',code:'Renew'},'org/3':{groupId:'org/NI',code:'NI'}};
const period=(id,org,start,end,extra={})=>({identifier:'42-'+id,organization:org,memberDuring:{startDate:start,...(end?{endDate:end}:{})},...extra});
const mandate=(start='2024-07-16',end,id='m-1')=>period(id,'org/ep-10',start,end,{role:'def/ep-roles/MEMBER_PARLIAMENT'});
const group=(id,org,start,end)=>period(id,org,start,end,{membershipClassification:'def/ep-entities/EU_POLITICAL_GROUP'});
const person=(...memberships)=>({identifier:'42',hasMembership:memberships});
const full=()=>person(mandate(),group('f-1','org/1','2024-07-16','2026-06-16'),group('f-2','org/2','2026-06-17'));
function fixture(t) {
 const directory=mkdtempSync(path.join(tmpdir(),'groups-'));const store=new ActivityStore(directory,{clock:()=>Date.parse(day)});assert(store.acquire());
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 const put=(g,p=full())=>store.putSource(g,'group-history:42','group-history',{...projectGroupHistory(p,mapping),generation:g,retrievedAt:day,url:'https://data.europarl.europa.eu/api/v2/meps/42'},day);
 return {store,put};
}
test('role-free group periods merge by exact organization and clip to mandates, preserving membership ids',()=>{
 const result=projectGroupHistory(person(mandate(),group('f-1','org/1','2020-01-01','2025-01-01'),group('f-2','org/1','2025-01-02','2026-06-16'),group('f-3','org/2','2026-06-17')),mapping);
 assert.equal(result.coverage,'complete');assert.equal(result.groups.length,2);assert.deepEqual(result.groups[0].membershipIds,['42-f-1','42-f-2']);assert.equal(result.groups[0].start,'2024-07-16');
 const events=groupEvents('42',result,'2026-06-17');assert.equal(events.length,1);assert.equal(events[0].id,'42:group:2026-06-17:2');assert.equal(events[0].to.groupId,'org/RENEW');assert.equal(groupEvents('42',result,'2026-06-16').length,0);
});
test('one-day NI, multiple switches, inclusive boundaries, outgoing mandate and mandate gaps',()=>{
 const result=projectGroupHistory(person(mandate('2024-07-16','2026-07-01'),group('f-1','org/1','2024-07-16','2026-05-04'),group('f-2','org/3','2026-05-05','2026-05-05'),group('f-3','org/2','2026-05-06')),mapping);
 assert.equal(result.coverage,'complete');assert.deepEqual(groupEvents('42',result,'2026-10-23').map(e=>e.date),['2026-05-05','2026-05-06']);assert.equal(result.groups.at(-1).end,'2026-07-01');
 const gap=projectGroupHistory(person(mandate('2024-07-16','2025-01-01'),mandate('2025-02-01',null,'m-2'),group('f-1','org/1','2024-07-16','2025-01-01'),group('f-2','org/2','2025-02-01')),mapping);
 assert.equal(gap.coverage,'complete');assert.deepEqual(groupEvents('42',gap,'2026-10-23'),[]);
 const adjacent=projectGroupHistory(person(mandate('2024-07-16','2025-01-01'),mandate('2025-01-02',null,'m-2'),group('f-1','org/1','2024-07-16','2025-01-01'),group('f-2','org/2','2025-01-02')),mapping);
 assert.equal(groupEvents('42',adjacent,'2026-10-23').length,1);
});
test('gaps, malformed periods, unmapped organizations and cross-group overlap never infer NI or safe switches',()=>{
 const base=full();
 for(const bad of [person(mandate(),group('f-2','org/2','2026-06-17')),person(mandate(),group('f-1','org/404','2024-07-16')),person(mandate(),group('f-1','org/1','2024-07-16'),group('f-2','org/2','2026-06-17'))]) {
  const result=projectGroupHistory(bad,mapping);assert.equal(result.coverage,'partial');assert.equal(groupEvents('42',result,'2026-10-23').length,0);
 }
 base.hasMembership.push(group('f-3','org/2','2026-02-31'));assert.equal(projectGroupHistory(base,mapping).coverage,'partial');
});
test('frozen generations, correction/retraction, stable marks, stale failures, 409/503 and pruning',t=>{
 const {store,put}=fixture(t);const g1=store.beginCycle().generation;store.setMembers([{id:'42'}]);put(g1);store.publish(g1);
 const read=(view,g=g1,epoch=store.get('marksEpoch'))=>followingResponse(store,view,new URLSearchParams({epoch,generation:g}));
 const before=read('group-history');assert.equal(before.status,200);assert.equal(before.body.events[0].mark,g1);
 const next=store.beginCycle().generation;put(next,person(mandate(),group('f-1','org/1','2024-07-16')));assert.deepEqual(read('group-history'),before);store.publish(next);
 assert.equal(read('following-groups',next).body.events.length,0);assert.deepEqual(read('group-history'),before);
 const third=store.beginCycle().generation;put(third);store.publish(third);assert.equal(read('following-groups',third).body.events[0].mark,g1);assert.equal(read('group-history').status,409);assert.equal(groupHistorySnapshot(store,g1),null);
 assert.equal(read('following-groups',third,'00000000-0000-0000-0000-000000000000').status,409);
 assert.throws(()=>followingResponse(store,'group-history',new URLSearchParams({epoch:store.get('marksEpoch'),generation:third,member:'42'})),e=>e.status===400);
 store.db.prepare('DELETE FROM group_history_snapshots WHERE generation=?').run(third);assert.equal(read('group-history',third).status,503);
});
test('failed publication rolls back group snapshot and namespaced marks',t=>{
 const {store,put}=fixture(t),g=store.beginCycle().generation;store.setMembers([{id:'42'}]);put(g);
 store.db.exec("CREATE TRIGGER reject_groups BEFORE INSERT ON group_history_snapshots BEGIN SELECT RAISE(ABORT,'rejected'); END");
 assert.throws(()=>store.publish(g),/rejected/);assert.equal(store.get('active'),null);assert.equal(store.db.prepare('SELECT count(*) n FROM membership_marks').get().n,0);
});
test('resumable per-person acquisition uses cache first, durable 150-refetch ceiling and explicitly refreshes outgoing persons',async t=>{
 const {store}=fixture(t),g=store.beginCycle().generation;store.setMembers(Array.from({length:153},(_,i)=>({id:String(42+i)})));
 store.putSource(g,'membership:outgoing','membership',{mandates:[{mep:'999',id:'999-m-1',start:'2024-07-16',end:'2026-01-01'}]},day);
 const calls=[];
 const worker=new ActivityWorker(store,{clock:()=>Date.parse(day),fetchRecord:async endpoint=>{calls.push(endpoint);const id=endpoint.split('/').at(-1);return {payload:{data:[{...full(),identifier:id,hasMembership:full().hasMembership.map(m=>({...m,identifier:m.identifier.replace('42-',id+'-')}))}]},fetchedAt:day};}});
 worker.readCachedMepRecord=async id=>id==='42'?{payload:{data:[full()]},fetchedAt:Date.parse(day),url:'https://data.europarl.europa.eu/api/v2/meps/42?format=application%2Fld%2Bjson'}:null;
 store.enqueue(g,'group-history:discover','group-history-discover',{},106);await worker.task(store.nextTask(g));
 // Interruption leaves all not-yet-processed exact person tasks in SQLite.
 await worker.task(store.nextTask(g));assert.equal(calls.length,0);assert.equal(store.nextTask(g).body.id,'43');
 let task;while((task=store.nextTask(g)))await worker.task(task);
 assert.equal(calls.length,150);assert.equal(store.get('working').groupHistoryRefetches,150);assert.equal(store.taskCounts(g).completed,155);
 store.publish(g);assert.equal(groupHistorySnapshot(store,g).coverage.unavailable,3);
 const next=store.beginCycle().generation;store.enqueue(next,'group-history:discover','group-history-discover',{},106);await worker.task(store.nextTask(next));
 assert.equal(store.nextTask(next).body.id,'193'); // First deferred observation, ahead of refreshed people.
 while((task=store.nextTask(next)))await worker.task(task);assert(calls.includes('/meps/999'));assert.equal(calls.length,153);
});
test('failed refresh preserves last good complete history and events with stale/error provenance',async t=>{
 const {store,put}=fixture(t),g=store.beginCycle().generation;store.setMembers([{id:'42'}]);put(g);store.publish(g);
 const next=store.beginCycle().generation;
 store.db.prepare('UPDATE sources SET fetched_at=? WHERE generation=? AND key=?').run('2024-01-01T00:00:00Z',next,'group-history:42');
 const worker=new ActivityWorker(store,{fetchRecord:async()=>{throw Error('offline');}});worker.readCachedMepRecord=async()=>null;
 store.enqueue(next,'group-history:42','group-history-person',{id:'42'});await worker.task(store.nextTask(next));store.publish(next);
 const snapshot=groupHistorySnapshot(store,next);assert.equal(snapshot.members['42'].stale,true);assert.equal(snapshot.members['42'].lastError,'offline');assert.equal(snapshot.events.length,1);assert.equal(snapshot.members['42'].retrievedAt,day);
});

test('catalogue pagination and exact body details separate display codes from stable identities',async t=>{
 const {store}=fixture(t),g=store.beginCycle().generation,calls=[];
 const worker=new ActivityWorker(store,{clock:()=>Date.parse(day),fetchRecord:async(endpoint,params)=>{
  calls.push([endpoint,params]);
  return {fetchedAt:day,payload:{data:endpoint.endsWith('show-current')?[{id:'org/1',classification:'def/ep-entities/EU_POLITICAL_GROUP',label:'S&D'},{id:'org/2',classification:'def/ep-entities/EU_POLITICAL_GROUP',label:'Renew'}]:[{id:'org/'+endpoint.split('/').at(-1),classification:'def/ep-entities/EU_POLITICAL_GROUP',isVersionOf:endpoint.endsWith('/1')?'org/SD':'org/RENEW'}]}};
 }});
 scheduleGroupHistory(store,g);let task;while((task=store.nextTask(g)))await worker.task(task);
 assert.equal(calls[0][0],'/corporate-bodies/show-current');assert.deepEqual(calls.slice(1).map(([endpoint])=>endpoint).sort(),['/corporate-bodies/1','/corporate-bodies/2']);
 assert.deepEqual(store.source(g,'group-body:2').work,{org:'org/2',groupId:'org/RENEW',code:'Renew',url:'https://data.europarl.europa.eu/api/v2/corporate-bodies/2?format=application%2Fld%2Bjson',retrievedAt:day});
 store.setMembers([{id:'42'}]);store.publish(g);assert.equal(groupHistorySnapshot(store,g).catalogue.bodies.length,2);
 const next=store.beginCycle().generation;scheduleGroupHistory(store,next);while((task=store.nextTask(next)))await worker.task(task);
 assert.equal(calls.length,4); // Only the previously unavailable person is fetched; catalogue identities reuse their daily cache.
});


test('known term-10 people survive later roster/list omissions and correction identities get new marks',t=>{
 const {store,put}=fixture(t),g=store.beginCycle().generation;store.setMembers([{id:'42'}]);put(g);store.publish(g);
 const next=store.beginCycle().generation;store.setMembers([]);store.publish(next);
 const retained=groupHistorySnapshot(store,next);assert.equal(retained.members['42'].coverage,'complete');assert.equal(retained.members['42'].stale,true);assert.equal(retained.events.length,1);
 const third=store.beginCycle().generation;
 put(third,person(mandate(),group('f-1','org/1','2024-07-16','2026-06-17'),group('f-2','org/2','2026-06-18')));store.publish(third);
 const corrected=groupHistorySnapshot(store,third);assert.equal(corrected.events.length,1);assert.equal(corrected.events[0].id,'42:group:2026-06-18:2');assert.equal(corrected.events[0].mark,third);
});


test('failed and deferred first observations survive roster/list omissions and are retried',async t=>{
 const {store}=fixture(t),g=store.beginCycle().generation;
 store.setMembers([{id:'42'}]);
 store.putSource(g,'membership:outgoing','membership',{mandates:[{mep:'43',id:'43-m-1',start:'2024-07-16',end:'2026-01-01'}]},day);
 let offline=true;const calls=[];
 const worker=new ActivityWorker(store,{clock:()=>Date.parse(day),fetchRecord:async endpoint=>{
  calls.push(endpoint);if(offline)throw Error('offline');
  const id=endpoint.split('/').at(-1);
  return {payload:{data:[{...full(),identifier:id,hasMembership:full().hasMembership.map(m=>({...m,identifier:m.identifier.replace('42-',id+'-')}))}]},fetchedAt:day};
 }});worker.readCachedMepRecord=async()=>null;
 store.enqueue(g,'group-history:discover','group-history-discover',{},106);await worker.task(store.nextTask(g));
 await worker.task(store.nextTask(g)); // 42 fails its first fetch.
 store.updateCycle({groupHistoryRefetches:150});
 await worker.task(store.nextTask(g)); // 43 is deferred before its first fetch.
 assert.deepEqual(calls,['/meps/42']);
 assert.equal(store.source(g,'group-history:42'),undefined);assert.equal(store.source(g,'group-history:43'),undefined);
 store.publish(g);
 const next=store.beginCycle().generation;store.setMembers([]);
 store.putSource(next,'membership:outgoing','membership',{mandates:[]},day);store.publish(next);
 const retained=groupHistorySnapshot(store,next);
 assert.deepEqual(Object.keys(retained.members).sort(),['42','43']);
 assert.equal(retained.coverage.unavailable,2);assert.equal(retained.members['42'].lastError,'offline');assert.equal(retained.members['43'].lastAttemptAt,null);
 // Retry after another generation and pruning, with neither roster nor list evidence.
 const third=store.beginCycle().generation;offline=false;
 for(const [org,identity]of Object.entries(mapping))store.putSource(third,'group-body:'+org.slice(4),'group-body',{org,...identity},day);
 store.enqueue(third,'group-history:discover','group-history-discover',{},106);await worker.task(store.nextTask(third));
 let task;while((task=store.nextTask(third)))await worker.task(task);
 assert.deepEqual(calls.slice(1).sort(),['/meps/42','/meps/43']);store.publish(third);
 assert.equal(groupHistorySnapshot(store,third).coverage.complete,2);
});

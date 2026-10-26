import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {scheduleHistoryReadiness,runHistoryReadiness,publishMissingHistory,historyCacheKey} from './history-readiness.mjs';
import {followingResponse,followingStatus} from './insights-following.mjs';
import {generationGroupOn} from './group-attribution.mjs';
import {groupContributions} from './group-aggregation.mjs';
import {createInsights} from './insights.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';

const at='2026-10-26T09:00:00.000Z',clock=()=>Date.parse(at);
// Synthetic period records use the exact public person/body identities from the
// reported sitting; no production index or source cache is imported.
const identities=[['249603','7018','PPE'],['197435','7038','S&D'],['197691','7150','PfE'],['257055','7037','ECR'],['257257','7035','Renew'],['97236','7028','Verts/ALE'],['257083','7036','The Left'],['256945','7151','ESN']];
const rawPerson=(id,org)=>({identifier:id,hasMembership:[{identifier:id+'-m-1',organization:'org/ep-10',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16'}},{identifier:id+'-f-1',organization:'org/'+org,membershipClassification:'def/ep-entities/EU_POLITICAL_GROUP',memberDuring:{startDate:'2024-07-16'}}]});
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'history-readiness-'));
  const store=new ActivityStore(directory,{clock});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const serving=store.beginCycle().generation;store.setMembers(identities.map(([id])=>({id,name:id,groupCode:'NI'})));store.publish(serving);
  // Simulate a serving index published before membership/history existed.
  store.db.exec('DELETE FROM group_history_snapshots; DELETE FROM membership_snapshots;');
  const generation=store.beginCycle().generation,calls=[];
  const worker=new ActivityWorker(store,{clock,budget:100,fetchRecord:async(endpoint)=>{
    calls.push(endpoint);
    let rows=[];
    if(endpoint==='/corporate-bodies/show-current')rows=identities.map(([,id,code])=>({id:'org/'+id,classification:'def/ep-entities/EU_POLITICAL_GROUP',label:code}));
    else if(endpoint.startsWith('/corporate-bodies/')){const id=endpoint.split('/').at(-1);rows=[{id:'org/'+id,classification:'def/ep-entities/EU_POLITICAL_GROUP',isVersionOf:'org/GROUP_'+id}];}
    else if(/^\/meps\/\d+$/.test(endpoint)){const id=endpoint.split('/').at(-1),identity=identities.find(row=>row[0]===id);rows=[rawPerson(id,identity[1])];}
    else assert(['/meps/show-incoming','/meps/show-outgoing'].includes(endpoint));
    return {payload:{data:rows},fetchedAt:at};
  }});worker.readCachedMepRecord=async()=>null;
  const read=view=>followingResponse(store,view,new URLSearchParams({epoch:store.get('marksEpoch'),generation:serving}));
  return {store,worker,serving,generation,calls,read,directory};
}

test('pre-feature serving generation gains bound immutable history despite a full higher-priority amendment queue',async t=>{
  const {store,worker,serving,generation,read,calls}=fixture(t);
  for(let n=0;n<200;n++)store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,0,0,0,NULL)').run(generation,'busy:'+n,'amendment-extract','{}',112);
  store.enqueue(generation,'bulk','document',{endpoint:'/plenary-documents/UNRELATED'},100);
  assert.equal(read('group-history').status,503);assert.equal(read('following-membership').status,503);assert.equal(historyCacheKey(store,serving),0);
  await runHistoryReadiness(worker,generation);
  assert.equal(store.get('active'),serving);assert.equal(store.get('working').generation,generation);
  assert.deepEqual(followingStatus(store),{epoch:store.get('marksEpoch'),generation:serving,marksReady:true,membershipReady:true,groupsReady:true,indexComplete:true,publishedAt:at});
  const frozen=read('group-history');assert.equal(frozen.status,200);
  assert.deepEqual(frozen.body.publication,{version:1,boundGeneration:serving,sourceGeneration:generation,asOf:'2026-10-26',publishedAt:at});
  const chart=groupContributions(identities.map(([id])=>({id,date:'2026-10-19'})),generationGroupOn(store,serving));
  assert.equal(chart.total,8);assert.equal(chart.unavailable,0);assert.equal(chart.rows.length,8);assert(chart.rows.every(row=>row.count===1));
  assert.equal(read('following-groups').status,200);assert.deepEqual(read('following-groups').body.publication,frozen.body.publication);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs WHERE done=0').get().n,200);
  assert.equal(calls.length,19);assert.equal(store.get('working').groupHistoryRefetches,8);
  assert.equal(historyCacheKey(store,serving),1);assert.equal(store.status().history.groups.coverage.complete,8);
  store.putSource(generation,'group-history:'+identities[0][0],'group-history',{coverage:'unavailable',mandates:[],groups:[],ambiguous:[]},at);
  assert.equal(publishMissingHistory(store,generation),false);assert.deepEqual(read('group-history'),frozen);
  // Ordinary publication freezes a new snapshot; the upgrade snapshot stays retained.
  store.db.prepare('UPDATE tasks SET done=1 WHERE generation=?').run(generation);store.publish(generation);
  assert.deepEqual(read('group-history'),frozen);
});

test('bounded slices preserve cursors and shared request budget across interruption and recovery',async t=>{
  const {store,worker,generation,read}=fixture(t);worker.budget=5;
  scheduleHistoryReadiness(store,generation);
  store.db.prepare('UPDATE tasks SET body=? WHERE generation=? AND key=?').run(JSON.stringify({list:'outgoing',offset:100}),generation,'membership:outgoing');
  await runHistoryReadiness(worker,generation);
  assert.equal(worker.requests,1);assert.equal(read('group-history').status,503);
  const pendingBefore=store.taskCounts(generation);scheduleHistoryReadiness(store,generation);assert.deepEqual(store.taskCounts(generation),pendingBefore);
  let rounds=0;while(read('group-history').status!==200&&rounds++<40){worker.requests=0;await runHistoryReadiness(worker,generation);assert(worker.requests<=1);}
  assert.equal(read('group-history').status,200);assert(rounds>1);
  assert.equal(store.source(generation,'membership:outgoing').work.sources[0].url.includes('offset=100'),true);
});

test('failed upgrade publication is atomic and recovery never overwrites successful snapshots',async t=>{
  const {store,worker,generation,read}=fixture(t);
  store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON group_history_snapshots BEGIN SELECT RAISE(ABORT,'rejected'); END");
  await assert.rejects(runHistoryReadiness(worker,generation),/rejected/);
  assert.equal(read('following-membership').status,503);assert.equal(read('group-history').status,503);
  store.db.exec('DROP TRIGGER reject_history');assert.equal(publishMissingHistory(store,generation),true);
  const snapshot=read('group-history');assert.equal(publishMissingHistory(store,generation),false);assert.deepEqual(read('group-history'),snapshot);
  store.db.exec('DELETE FROM group_history_snapshots');store.release();assert.throws(()=>publishMissingHistory(store,generation),/lease/);
});

test('first history publication invalidates fresh memory and persisted question views in the same generation',async t=>{
  const {store,worker,generation,serving,directory}=fixture(t),id=identities[0][0];
  const work={identifier:'E-10-2026-000001',id:'eli/dl/doc/E-10-2026-000001',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-10-19',title_dcterms:{en:'Digital safeguards'},creator:['person/'+id],inverse_answers_to:[]};
  store.putSource(serving,'/parliamentary-questions/'+work.identifier,'document',work,at);
  const options={clock,viewCache:{directory:path.join(directory,'views')},loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()};
  const service=createInsights(store,options),query=new URLSearchParams('days=term');
  const before=await service.query('questions',query);assert.equal(before.selectedStats.groupContributions.unavailable,1);
  await runHistoryReadiness(worker,generation);
  const after=await service.query('questions',query);assert.equal(after.selectedStats.groupContributions.unavailable,0);assert.equal(after.selectedStats.groupContributions.rows[0].label,'PPE');
  const restarted=await createInsights(store,options).query('questions',query);assert.equal(restarted.selectedStats.groupContributions.unavailable,0);
});

test('newer working memberships and roster never leak past the serving publication day',async t=>{
  const {store,worker,serving,generation,read}=fixture(t),[id,org]=identities[0];
  store.db.prepare('UPDATE follow_generations SET published_at=? WHERE generation=?').run('2026-10-23T01:43:08.951Z',serving);
  store.setMembers([{id:'999',name:'Later joiner'}]);
  const person=rawPerson(id,org);person.hasMembership[1].memberDuring.endDate='2026-10-24';
  person.hasMembership.push({identifier:id+'-f-2',organization:'org/7035',membershipClassification:'def/ep-entities/EU_POLITICAL_GROUP',memberDuring:{startDate:'2026-10-25'}});
  worker.readCachedMepRecord=async personId=>identities.some(row=>row[0]===personId)?{payload:{data:[personId===id?person:rawPerson(personId,identities.find(row=>row[0]===personId)[1])]},url:'https://data.europarl.europa.eu/api/v2/meps/'+personId,fetchedAt:at}:null;
  // Keep every serving person discoverable even though the newer roster differs.
  store.putSource(generation,'group-history:known-people','group-history-known-people',{ids:identities.map(row=>row[0])},at);
  const request=worker.fetchRecord;worker.fetchRecord=async(endpoint,params)=>{
    if(endpoint==='/meps/999')return {payload:{data:[rawPerson('999','7018')]},fetchedAt:at};
    if(endpoint==='/meps/show-incoming')return {payload:{data:[{identifier:'999',hasMembership:[{identifier:'999-m-1',organization:'org/ep-10',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2026-10-25'}}]}]},fetchedAt:at};
    return request(endpoint,params);
  };
  await runHistoryReadiness(worker,generation);
  const snapshot=read('group-history').body;assert.equal(snapshot.publication.asOf,'2026-10-23');
  assert.equal(snapshot.members['999'],undefined);assert.equal(snapshot.members[id].generation,generation);
  assert.equal(snapshot.members[id].groups.length,1);assert.equal(snapshot.members[id].groups[0].end,'2026-10-23');
  assert.equal(snapshot.events.length,0);assert.equal(read('following-membership').body.members['999'],undefined);
  assert.equal(generationGroupOn(store,serving)(id,'2026-10-19').code,'PPE');
  assert.equal(generationGroupOn(store,serving)(id,'2026-10-25'),'unavailable');
});

test('Questions, Legislation and Participation assembled cache identities recover from missing history',async t=>{
  const {store,worker,generation}=fixture(t),keys=[];
  t.mock.method(InsightViewCache.prototype,'get',async function(key){keys.push(key);return {key};});
  const service=createInsights(store,{clock,viewCache:{directory:null}});
  const queries=[['questions','days=term'],['legislation','sitting=MTG-PL-2026-10-19'],['participation','']];
  for(const [view,query]of queries)await service.query(view,new URLSearchParams(query));
  await runHistoryReadiness(worker,generation);
  for(const [view,query]of queries)await service.query(view,new URLSearchParams(query));
  for(let n=0;n<3;n++) {
    assert.notDeepEqual(keys[n],keys[n+3]);
    assert.equal(keys[n][keys[n].indexOf(queries[n][0])+2],0);
    assert.equal(keys[n+3][keys[n+3].indexOf(queries[n][0])+2],1);
  }
});

test('a one-request budget alternates readiness with ordinary work after other budget users yield',async t=>{
  const {store,worker,generation}=fixture(t);worker.budget=1;worker.requests=1;
  await runHistoryReadiness(worker,generation);assert.equal(worker.historyTurn,undefined);
  worker.requests=0;await runHistoryReadiness(worker,generation);assert.equal(worker.requests,1);
  worker.requests=0;await runHistoryReadiness(worker,generation);assert.equal(worker.requests,0);
  worker.requests=0;await runHistoryReadiness(worker,generation);assert.equal(worker.requests,1);
  assert(store.taskCounts(generation).completed>0);
});

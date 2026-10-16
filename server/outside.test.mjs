import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {outsideSpeech,outsideAgenda,outsidePerson} from './outside-model.mjs';
import {recordOutside,outsideDirectory,outsideSpeaker,outsideQuery} from './outside-store.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/outside-speakers-20261016.json',import.meta.url),'utf8'));
const sample=(id)=>fixture.contributions.find(row=>row.activity.activity_id===id);
const project=row=>outsideSpeech(row.activity,row.retrievedAt,row.sourceUrl);
const saved={url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date=2025-03-11',fetchedAt:'2026-10-16T06:00:00.000Z'};
function withStore(fn) {return async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'outside-voices-')),store=new ActivityStore(dir);try{store.acquire();await fn(store,store.beginCycle().generation);}finally{store.close();rmSync(dir,{recursive:true,force:true});}};}
function roster(store,generation,date,ids=[]) {store.putSource(generation,'outside:roster:'+date,'outside-roster',{date,ids,sources:[{...saved,url:saved.url.replace('2025-03-11',date)}]},saved.fetchedAt);}
function seed(store,generation,contributions=fixture.contributions) {
  store.putSource(generation,'outside:state','outside-state',{version:1},saved.fetchedAt);
  for(const row of contributions) {const speech=project(row);roster(store,generation,speech.date);store.putSource(generation,'/speeches/'+speech.id,speech.term===9?'outside-speech':'speech',{id:speech.id,outside:speech},row.retrievedAt);recordOutside(store,generation,speech);}
  for(const row of fixture.agendas)store.putSource(generation,'outside:agenda:'+row.activity.activity_id,'outside-agenda',outsideAgenda(row.activity,row.retrievedAt,row.sourceUrl),row.retrievedAt);
}

test('public headers resolve exact person IDs and mixed-language originals without speech body storage',()=>{
  const speech=project(sample('MTG-PL-2025-10-22-OTH-2017044754053'));
  assert.equal(speech.headers.find(p=>p.personId==='227855').name,'Sviatlana Tsikhanouskaya');
  assert.equal(speech.headers[0].languageTag,'en');assert.equal(speech.headers[0].original,true);
  assert.equal(speech.parentIds[0],'MTG-PL-2025-10-22-PVCRE-ITM-7');
  assert(!JSON.stringify(speech).includes('blockContainer'));
  const bad=structuredClone(sample('MTG-PL-2025-10-22-OTH-2017044754053').activity);
  bad.had_participation.had_participant_person=['person/999999'];
  assert.equal(outsideSpeech(bad,saved.fetchedAt).headers[0].name,null);
  bad.activity_date='2025-10-23';assert.equal(outsideSpeech(bad,saved.fetchedAt),null);
  const foreign=structuredClone(fixture.contributions[0].activity);foreign.inverse_consists_of=['https://elsewhere.example/eli/dl/event/MTG-PL-2025-10-22-PVCRE-ITM-7'];
  assert.deepEqual(outsideSpeech(foreign,saved.fetchedAt).parentIds,[]);
});
test('legacy website URLs use published hyphenated references; repeated guests retain one cross-term identity',()=>{
  const rows=fixture.contributions.map(project).filter(s=>s.participants.includes('227855')).map(s=>({...s,personId:'227855',header:s.headers.find(h=>h.personId==='227855')}));
  const person=outsidePerson(rows);assert.equal(person.sittingDays,4);assert.equal(person.appearances,4);assert.deepEqual(person.terms,[9,10]);
  assert.match(rows.find(row=>row.date==='2021-11-24').websiteUrl,/INT-3-103-0000_EN\.html$/);
  assert.match(rows.find(row=>row.date==='2023-09-13').websiteUrl,/INT-3-110-0000_EN\.html$/);
  assert.match(rows.find(row=>row.date==='2025-10-22').websiteUrl,/INT-2017044754053_EN\.html$/);
});
test('three speeches in one exact Council-presidency item count as one appearance and one day',()=>{
  const rows=fixture.contributions.map(project).filter(s=>s.participants.includes('105800')).map(s=>({...s,personId:'105800',header:s.headers.find(h=>h.personId==='105800')}));
  const person=outsidePerson(rows);assert.equal(person.contributions,3);assert.equal(person.appearances,1);assert.equal(person.sittingDays,1);assert.equal(person.capacity,'council');
});
test('actual agenda items follow their exact procedure membership instead of a matching title',()=>{
  const source=fixture.agendas.find(row=>row.activity.activity_id==='MTG-PL-2025-11-12-PVCRE-ITM-23');assert(source);
  const agenda=outsideAgenda(source.activity,source.retrievedAt,source.sourceUrl);assert.deepEqual(agenda.procedureIds,['2023-0163']);
  const unrelated={...source.activity,inverse_consists_of:['eli/dl/event/MTG-PL-2025-11-12'],inverse_was_scheduled_in:[]};
  assert.deepEqual(outsideAgenda(unrelated,source.retrievedAt,source.sourceUrl).procedureIds,[]);
});
test('an original-language capacity error stays visible alongside the date-specific majority',()=>{
  const bad=project(sample('MTG-PL-2025-02-11-OTH-2017014866369'));
  const row={...bad,personId:'264609',header:bad.headers.find(h=>h.personId==='264609')};
  assert.equal(row.header.role,'President of the Commission');assert.equal(row.header.original,true);
  const good=[1,2].map(n=>({...row,id:row.id+'-'+n,header:{...row.header,role:'President-in-Office of the Council',capacity:'council'}}));
  const person=outsidePerson([row,...good]);assert.equal(person.capacity,'council');assert.deepEqual(person.roleConflicts,[bad.id]);
});
test('a dated mandate excludes historical MEPs even when the current roster no longer contains them',withStore((store,generation)=>{
  const old=fixture.rosters.find(r=>r.date==='2024-10-09'),current=new Set(fixture.rosters.find(r=>r.date==='2026-10-15').ids);
  const former=old.ids.find(id=>!current.has(id));assert(former);
  roster(store,generation,'2024-10-09',old.ids);store.setMembers([...current].map(id=>({id})));
  const speech={...project(fixture.contributions.find(r=>r.activity.activity_date==='2024-10-09')),participants:[former],headers:[{personId:former,name:'Historical MEP',role:null}]};
  recordOutside(store,generation,speech);assert.equal(outsideDirectory(store,{term:'all',language:'en'}).people.length,0);
}));
test('absent roster evidence creates pending work and never classifies everyone as outside',withStore((store,generation)=>{
  recordOutside(store,generation,project(fixture.contributions[0]));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM outside_contributions').get().n,0);
  assert.equal(store.nextTask(generation).kind,'outside-roster');
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.complete,false);
}));
test('read-only queries preserve special events, co-speakers and distinct query scope without network work',withStore((store,generation)=>{
  seed(store,generation);const before=store.taskCounts(generation);store.db.exec('PRAGMA query_only=ON');
  const all=outsideDirectory(store,{term:'all',language:'en'}),term10=outsideDirectory(store,{term:'10',language:'en'});
  assert.equal(all.people.find(p=>p.id==='227855').sittingDays,4);assert.equal(term10.people.find(p=>p.id==='227855').sittingDays,2);
  const detail=outsideSpeaker(store,'227855',{language:'en'});
  assert(detail.agendas.some(a=>a.kind==='PLENARY_ACTIVITY'));
  assert(detail.coSpeakers.some(c=>c.personId==='266640'));
  assert.equal(detail.person.appearances,4);assert(detail.contributions.every(c=>c.source.url&&c.rosterSource.sources.length));
  assert(!Object.hasOwn(detail.contributions[0],'headers'));assert.deepEqual(store.taskCounts(generation),before);
  store.db.exec('PRAGMA query_only=OFF');
}));
test('metadata refresh retains the checked header and its original retrieval date',withStore((store,generation)=>{
  const source=fixture.contributions.find(row=>row.activity.activity_id==='MTG-PL-2025-10-22-OTH-2017044754053');
  roster(store,generation,source.activity.activity_date);const worker=new ActivityWorker(store);
  worker.saveSpeech(generation,source.activity,source.retrievedAt);
  const metadata=structuredClone(source.activity);for(const doc of metadata.recorded_in_a_realization_of)delete doc['api:xmlFragment'];
  worker.saveSpeech(generation,metadata,'2026-10-17T06:00:00Z');
  const row=outsideSpeaker(store,'227855',{language:'en'}).contributions[0];assert.equal(row.header.name,'Sviatlana Tsikhanouskaya');assert.equal(row.headerSource.fetchedAt,source.retrievedAt);
}));
test('term-9 contributions stay out of the current-term MEP activity list',withStore((store,generation)=>{
  const source=fixture.contributions.find(row=>row.activity.activity_date==='2021-11-24');roster(store,generation,'2021-11-24');
  new ActivityWorker(store).saveSpeech(generation,source.activity,source.retrievedAt,true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM items').get().n,0);
  assert.equal(outsideSpeaker(store,'227855',{language:'en'}).person.contributions,1);
}));
test('language-filtered detail keeps catalogue titles while retaining the separate header source',withStore((store,generation)=>{
  const row=fixture.contributions.find(row=>row.activity.activity_date==='2025-03-11'&&row.activity.had_participation.had_participant_person.includes('person/227855'));
  const catalogue=structuredClone(row.activity);for(const doc of catalogue.recorded_in_a_realization_of)delete doc['api:xmlFragment'];
  roster(store,generation,row.activity.activity_date);const worker=new ActivityWorker(store);
  worker.saveSpeech(generation,catalogue,row.retrievedAt,false,'https://data.europarl.europa.eu/api/v2/speeches?parliamentary-term=10');
  const filtered=structuredClone(row.activity);filtered.activity_label={};
  worker.saveSpeech(generation,filtered,'2026-10-16T07:00:00Z',false,'https://data.europarl.europa.eu/api/v2/speeches/'+filtered.activity_id+'?language=mul&include-output=xml_fragment');
  const result=outsideSpeaker(store,'227855',{language:'en'}).contributions[0];
  assert.equal(result.titles.en,'International Women’s Day');assert.match(result.source.url,/parliamentary-term=10/);assert.match(result.headerSource.url,/language=mul/);
}));
test('publication and generation copying retain the accepted speaker view during refresh',withStore((store,generation)=>{
  seed(store,generation);store.db.prepare('UPDATE tasks SET done=1 WHERE generation=?').run(generation);store.publish(generation);
  const accepted=outsideDirectory(store,{term:'all',language:'en'});
  const next=store.beginCycle();assert.equal(next.generation,generation+1);
  store.db.prepare('DELETE FROM outside_contributions WHERE generation=? AND person=?').run(next.generation,'227855');
  assert.deepEqual(outsideDirectory(store,{term:'all',language:'en'}).people,accepted.people);
  store.publish(next.generation);assert(!outsideDirectory(store,{term:'all',language:'en'}).people.some(p=>p.id==='227855'));
}));
test('dated-roster work validates paging and an empty source remains a retryable error',withStore(async(store,generation)=>{
  const worker=new ActivityWorker(store,{fetchRecord:async()=>({payload:{data:[]},fetchedAt:saved.fetchedAt})});
  store.enqueue(generation,'roster-test','outside-roster',{date:'2025-03-11',offset:0,ids:[],sources:[]},102);
  const task=store.nextTask(generation);await assert.rejects(worker.task(task),/unavailable/);
  assert.equal(store.source(generation,'outside:roster:2025-03-11'),undefined);
  assert.equal(store.taskCounts(generation).completed,0);
}));
test('speaker endpoint query validation rejects duplicate and unsupported terms and parameters',()=>{
  assert.deepEqual(outsideQuery(new URLSearchParams('term=9&lang=hu')),{term:'9',language:'hu'});
  for(const q of ['term=8','term=10&term=9','person=123','limit=100000'])assert.throws(()=>outsideQuery(new URLSearchParams(q)),error=>error.status===400);
});
test('upgrade preserves old speech cursors and queues each historical month only once',withStore((store,generation)=>{
  const old='catalog:/speeches:2025-01-01:2025-01-31';
  store.putSource(generation,'/speeches/old','speech',{id:'old'},saved.fetchedAt);
  store.enqueue(generation,old,'speeches',{offset:250,params:{}},100);
  const worker=new ActivityWorker(store);worker.initializeOutside(store.get('working'));
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE generation=? AND key=?').get(generation,old).body).offset,250);
  const count=store.taskCounts(generation).total;worker.initializeOutside(store.get('working'));assert.equal(store.taskCounts(generation).total,count);
  const history=store.db.prepare("SELECT body FROM tasks WHERE generation=? AND key LIKE 'outside:catalog:%'").all(generation).map(row=>JSON.parse(row.body));
  assert.equal(history.length,61);assert(history.some(t=>t.params['sitting-date']==='2019-07-02'));assert(history.some(t=>t.params['sitting-date-end']==='2024-07-15'));
}));
test('older workers cannot consume new outside tasks or publish their unfinished generation',withStore((store,generation)=>{
  store.enqueue(generation,'normal','speeches',{offset:0},100);
  store.enqueue(generation,'outside:detail:test','outside-detail',{id:'test'},102);
  store.enqueue(generation,'outside:catalog:test','speeches',{outsideOnly:true},50);
  store.enqueue(generation,'outside:upgrade:test','speeches',{offset:0},100);
  const legacy=store.db.prepare('SELECT key FROM tasks WHERE generation=? AND (done=0 OR done IS NULL)').all(generation);
  assert.deepEqual(legacy.map(row=>row.key),['normal']);
  assert.equal(store.nextTask(generation).kind,'outside-detail');
  assert.equal(store.taskCounts(generation).completed,0);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.pending,4);
  store.finishTask(store.nextTask(generation));assert.equal(store.taskCounts(generation).completed,1);
}));
test('optional context failures retain gaps, permit publication, and retry on the next generation',withStore((store,generation)=>{
  store.putSource(generation,'outside:state','outside-state',{version:1},saved.fetchedAt);
  store.enqueue(generation,'outside:agenda:missing','outside-agenda',{id:'missing'},101);
  const worker=new ActivityWorker(store),task=store.nextTask(generation),error=new Error('EP API returned 404');
  assert.equal(worker.failOutside(task,error),false);assert.equal(worker.failOutside({...task,attempts:2},error),true);
  assert.equal(store.taskCounts(generation).completed,1);store.publish(generation);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.complete,false);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.gaps,1);
  const next=store.beginCycle();worker.initializeOutside(next);const retry=store.nextTask(next.generation);
  assert.equal(retry.key,task.key);store.finishTask(retry);worker.finishOutsideGap(retry);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.gaps,1); // accepted generation stays visible
  store.publish(next.generation);assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.gaps,0);
}));
test('historical member metadata is discarded after the dated-roster check',withStore((store,generation)=>{
  const row=structuredClone(fixture.contributions.find(r=>r.activity.activity_date==='2021-11-24'));
  row.activity.had_participation.had_participant_person=['person/42'];roster(store,generation,'2021-11-24',['42']);
  new ActivityWorker(store).saveSpeech(generation,row.activity,row.retrievedAt,true);
  assert.equal(store.source(generation,'/speeches/'+row.activity.activity_id),undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM outside_contributions').get().n,0);
}));
test('HTTP outside-speaker routes read the index and enforce query, method and origin rules',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'outside-http-'));
  process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
  const {activityIndex}=await import('./activity-index-worker.mjs');const {store}=activityIndex();store.acquire();const {generation}=store.beginCycle();seed(store,generation);
  const {server}=await import('./index.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    store.db.exec('PRAGMA query_only=ON');
    const response=await fetch(base+'/api/poc/outside/227855?term=all&lang=en');assert.equal(response.status,200);assert.equal((await response.json()).person.sittingDays,4);
    const current=await fetch(base+'/api/poc/outside/227855?term=10');assert.equal((await current.json()).person.sittingDays,2);
    for(const url of ['/api/poc/outside/directory?term=8','/api/poc/outside/directory?term=9&term=10','/api/poc/outside/directory?url=https://example.com','/api/poc/outside/0','/api/poc/outside/directory?lang=bad'])assert.equal((await fetch(base+url)).status,400,url);
    assert.equal((await fetch(base+'/api/poc/outside/999999')).status,404);
    assert.equal((await fetch(base+'/api/poc/outside/directory',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/api/poc/outside/directory',{headers:{Origin:'https://elsewhere.example'}})).status,403);
    const head=await fetch(base+'/api/poc/outside/directory',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }finally{store.db.exec('PRAGMA query_only=OFF');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();rmSync(directory,{recursive:true,force:true});}
});

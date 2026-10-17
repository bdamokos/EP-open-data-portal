import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {groupVoiceProjection,groupVoicesQuery} from './group-voices-model.mjs';
import {groupVoicesPage,initializeGroupVoices,nextGroupVoiceTask,groupVoicesCopy,enqueueGroupVoice} from './group-voices-store.mjs';
const now=()=>Date.parse('2026-10-17T12:00Z'),stamp=new Date(now()).toISOString();
const participation=(person,group)=>({id:'participation/'+person,participation_role:'def/ep-roles/SPEAKER',had_participant_person:['person/'+person],participation_in_name_of:'org/'+group});
const speech=(id='1',date='2026-10-06',ps=[participation('42','S_D')])=>({activity_id:`MTG-PL-${date}-OTH-${id}`,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:ps});
function setup(t){const dir=mkdtempSync(path.join(os.tmpdir(),'group-voices-')),store=new ActivityStore(dir,{clock:now});store.acquire();t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
const query=(text='')=>groupVoicesQuery(new URLSearchParams(text),{now:now()});
test('designation and person belong to the same exact speaking participation; duplicates count once',()=>{
 const a=speech('1','2026-10-06',[participation('42','S_D'),participation('42','S_D'),{had_participant_person:'person/43'}, {participation_in_name_of:'org/PPE'},participation('44','NI'),{...participation('45','PPE'),participation_role:'def/ep-roles/PRESIDING'}]);
 const p=groupVoiceProjection(a,{fetchedAt:stamp});assert.deepEqual(p.designations,[{person:'42',group:'S_D',participationIds:['participation/42']}]);
 assert.equal(groupVoiceProjection({...a,had_activity_type:'def/ep-activities/PLENARY_DEBATE_WRITTEN_STATEMENT'}),null);
 assert.equal(groupVoiceProjection({...a,activity_date:'2026-02-31'}),null);
 assert.equal(groupVoiceProjection({...a,had_participation:[]}).designations.length,0);
 assert.equal(groupVoiceProjection({...a,had_participation:participation('42','S_D'),inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-06-PVCRE-ITM-18']}).subject,'foreign');
});
test('retained public fixture has exact structured group designations without parsing translated headers',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/speech-interventions-live-20261015.json',import.meta.url)));
 const nodes=[];const visit=v=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'){if(v.activity_id)nodes.push(v);else Object.values(v).forEach(visit);}};visit(fixture);
 const projections=nodes.map(n=>groupVoiceProjection(n)).filter(Boolean),designations=projections.flatMap(p=>p.designations);
 assert(designations.some(p=>p.group==='S_D'&&p.person==='197591'));assert(designations.every(p=>p.participationIds.length));
});
test('indexed summaries, subject/person intersections and evidence pages use saved metadata only',t=>{
 const store=setup(t),cycle=store.beginCycle(),worker=new ActivityWorker(store,{clock:now});
 initializeGroupVoices(worker,cycle.generation,[]);store.setMembers([{id:'42',name:'Éva Example'},{id:'43',name:'Other Example'}]);
 for(const a of [speech('1','2026-09-01'),speech('2','2026-10-06'),speech('3','2026-10-06',[participation('43','S_D')]),speech('4','2026-10-06',[participation('42','PPE')])])worker.saveSpeech(cycle.generation,a,stamp,false,'https://data.europarl.europa.eu/api/v2/speeches');
 worker.saveSpeech(cycle.generation,speech('2','2026-10-06'),stamp); // idempotent
 const summary=groupVoicesPage(store,query());assert.equal(summary.people.length,2);assert.equal(summary.people[0].total,2);assert.equal(summary.people[0].name,'Éva Example');assert.deepEqual(summary.months,['2026-10','2026-09']);
 const page=groupVoicesPage(store,query('part=contributions&person=42&subject=unclassified&limit=1'));assert.equal(page.total,2);assert.equal(page.nextOffset,1);assert.equal(page.contributions[0].designation.group,'S_D');assert(page.contributions[0].source.fetchedAt);
 assert.equal(groupVoicesPage(store,query('period=2026-08')).coverage.authoritativeComplete,false);
 const plan=store.db.prepare('EXPLAIN QUERY PLAN SELECT speech,person,date,subject FROM group_voice_designations WHERE generation=? AND group_id=? AND date>=? AND date<=? ORDER BY date DESC,speech,person LIMIT 20001').all(cycle.generation,'S_D','2024-07-16','2026-10-17');assert(plan.some(p=>/COVERING INDEX group_voice_group_date/.test(p.detail)));
});
test('projection writes roll back atomically with speech sources',t=>{
 const store=setup(t),gen=store.beginCycle().generation,p=groupVoiceProjection(speech());
 store.db.exec("CREATE TEMP TRIGGER projection_failure BEFORE INSERT ON group_voice_designations BEGIN SELECT RAISE(ABORT,'projection failure'); END;");
 assert.throws(()=>store.putSource(gen,'/speeches/'+p.id,'speech',{groupVoices:p},stamp),/projection failure/);
 assert.equal(store.source(gen,'/speeches/'+p.id),undefined);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM group_voice_observations').get().n,0);
});
test('upgrade cursors survive core publication, restart and an old-image generation advance',t=>{
 const store=setup(t),gen=store.beginCycle().generation,worker=new ActivityWorker(store,{clock:now});
 store.enqueue(gen,'existing','speeches',{offset:750},100);store.finishTask(store.nextTask(gen));
 initializeGroupVoices(worker,gen,[{start:'2026-09-01',end:'2026-09-30'}]);let task=nextGroupVoiceTask(store,gen);store.taskProgress(task,{...task.body,offset:250});
 store.putSource(gen,'/speeches/test','speech',{groupVoices:groupVoiceProjection(speech(),{fetchedAt:stamp})},stamp);store.publish(gen); // optional queue cannot block publication
 const second=store.beginCycle().generation;task=nextGroupVoiceTask(store,second);assert.equal(task.body.offset,250);initializeGroupVoices(worker,second,[{start:'2026-09-01',end:'2026-09-30'}]);assert.equal(nextGroupVoiceTask(store,second).body.offset,250);
 store.publish(second);
 // Legacy code copies core sources/items, not these additive tables.
 store.set('active',second+1);store.set('sequence',second+1);store.transaction(()=>groupVoicesCopy(store.db,second+1,second+1));
 assert.equal(nextGroupVoiceTask(store,second+1).body.offset,250);assert.equal(groupVoicesPage(store,query()).people[0].total,1);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM group_voice_jobs WHERE generation=?').get(second+1).n,1);
});
test('optional split/recovery jobs keep their own cursors and cannot reset core tasks',async t=>{
 const store=setup(t),gen=store.beginCycle().generation;initializeGroupVoices({store,clock:now},gen,[]);
 store.enqueue(gen,'catalog:/speeches:2026-10-01:2026-10-04','speeches',{offset:500},100);
 enqueueGroupVoice(store,gen,'large',{params:{'sitting-date':'2026-10-01','sitting-date-end':'2026-10-04'},offset:0});
 const worker=new ActivityWorker(store,{clock:now,fetchRecord:async()=>({payload:{data:[],meta:{total:10000}},fetchedAt:stamp})});await worker.task(nextGroupVoiceTask(store,gen));
 const split=store.db.prepare('SELECT body FROM group_voice_jobs WHERE generation=? AND done=0 ORDER BY key').all(gen).map(r=>JSON.parse(r.body));assert.equal(split.length,2);assert.deepEqual(split.map(p=>p.params['sitting-date']),['2026-10-01','2026-10-03']);
 assert.equal(JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE generation=?').get(gen).body).offset,500);
 const a=speech('77');const hit='eli/dl/event/'+a.activity_id;worker.fetchRecord=async()=>({payload:{data:[],searchResults:{hits:[{id:hit}]}},fetchedAt:stamp});const parent=nextGroupVoiceTask(store,gen);await worker.task(parent);
 const recovery=store.db.prepare("SELECT * FROM group_voice_jobs WHERE generation=? AND key LIKE 'group-voices:%:recovery:%'").get(gen);assert.equal(JSON.parse(recovery.body).recoveryId,a.activity_id);assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE key LIKE 'recovery:%'").get().n,0);
});
test('API validates every filter, bounds and duplicates while keeping empty months partial',()=>{
 for(const raw of ['group=NI','person=one','subject=unknown','period=2026-13','period=2023-01','limit=0','offset=20001','lang=en&lang=de','unknown=x'])assert.throws(()=>query(raw));
 assert.equal(query('period=2026-07').from,'2026-07-01');assert.equal(query('period=2024-07').from,'2024-07-16');assert.equal(query('period=12m').from,'2025-10-17');
});

test('optional pagination resumes within the shared request budget without modifying core sources',async t=>{
 const store=setup(t),gen=store.beginCycle().generation;
 initializeGroupVoices({store,clock:now},gen,[{start:'2026-09-01',end:'2026-09-30'}]);store.publish(gen);store.release();
 let calls=0;const offsets=[];
 const fetchRecord=async(endpoint,params)=>{assert.equal(endpoint,'/speeches');calls++;offsets.push(params.offset);return {payload:{data:params.offset===0?[speech('88','2026-09-01')]:[]},fetchedAt:stamp};};
 const worker=new ActivityWorker(store,{clock:now,budget:1,fetchRecord});await worker.run();assert.equal(calls,1);assert.equal(nextGroupVoiceTask(store,gen).body.offset,1);assert.equal(store.get('working'),null);
 assert.equal(store.source(gen,'/speeches/MTG-PL-2026-09-01-OTH-88'),undefined);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks WHERE done<>1').get().n,0);
 const resumed=new ActivityWorker(store,{clock:now,budget:1,fetchRecord});await resumed.run();assert.deepEqual(offsets,[0,1]);assert.equal(nextGroupVoiceTask(store,gen),null);assert.equal(groupVoicesPage(store,query()).people[0].total,1);
});
test('a disk pause after core publication cannot recreate a generation-less working cycle',async t=>{
 const store=setup(t),gen=store.beginCycle().generation;store.release();
 const worker=new ActivityWorker(store,{clock:now,budget:5,fetchRecord:async()=>({payload:{data:[]},fetchedAt:stamp})});
 worker.initialize=async()=>store.updateCycle({initialized:true,reportJoinsReady:true,procedureTitlesQueued:true,motionOutcomesDay:'2026-10-17'});
 worker.initializeOutside=()=>{};worker.prepareMotionOutcomes=()=>{};
 const task=worker.task.bind(worker);worker.task=async job=>{if(job.groupVoiceJob)await task(job);else store.finishTask(job);};
 const finalize=worker.finalize.bind(worker);worker.finalize=generation=>{finalize(generation);worker.diskLimit=1;};
 await worker.run();assert.equal(store.get('active'),gen,JSON.stringify({working:store.get('working'),tasks:store.db.prepare('SELECT key,kind,done,error FROM tasks').all()}));assert.equal(store.get('working'),null);assert.equal(store.status().refreshInProgress,false);
 assert(store.acquire());assert.equal(store.beginCycle().generation,gen+1);
});

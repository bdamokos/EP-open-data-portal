import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectProcedure} from './activity-index-model.mjs';
import {procedureClassification,procedureTypes} from './procedure-types.mjs';
import {outsideDirectory,recordOutside} from './outside-store.mjs';
import {followingDossiers} from './follow-dossiers.mjs';

const now=()=>Date.parse('2026-10-31T12:00:00Z'),fetchedAt=new Date(now()).toISOString();
const uri=code=>'def/ep-procedure-types/'+code;
const id='2026-0001A';
const procedure=fields=>({id:'eli/dl/proc/'+id,process_id:id,label:'2026/0001A(COD)',...fields});
function setup(t,work) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'outside-procedure-types-'));
  const store=new ActivityStore(directory,{clock:now});store.acquire();
  const {generation}=store.beginCycle();let calls=0;
  const worker=new ActivityWorker(store,{clock:now,runUpstream:fn=>fn(worker.controller.signal),fetchRecord:async endpoint=>{
    calls++;assert.equal(endpoint,'/procedures/'+id);return {payload:{data:[work]},fetchedAt};
  }});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const task=(kind,key,body)=>{store.enqueue(generation,key,kind,body,101);return {generation,key,kind,body,attempts:0};};
  return {store,worker,generation,task,calls:()=>calls};
}

test('canonical procedure projection preserves every type alias and its classification',()=>{
  const cases=[
    {process_type:uri('COD'),procedure_type:uri('RSP')},
    {procedure_type:[{id:uri('COD')},{'@id':uri('RSP')}]},
    {process_type:[uri('COD')],procedure_type:{id:uri('COD')},had_procedure_type:uri('COD')},
    {had_procedure_type:{id:uri('COD'),'@id':uri('RSP')}},
    {process_type:0,procedure_type:uri('COD')},
    {process_type:null,had_procedure_type:uri('COD')},
    {},
  ];
  for(const fields of cases) {
    const work=procedure(fields),projected=projectProcedure(work);
    assert.deepEqual(procedureClassification(projected),procedureClassification(work));
    for(const field of ['process_type','procedure_type','had_procedure_type'])if(Object.hasOwn(fields,field))assert.deepEqual(projected[field],fields[field]);
  }
});

test('Outside procedure writes use the shared catalogue without dropping aliases or conflicts',async t=>{
  const cases=[
    ...Object.keys(procedureTypes).map(code=>({label:null,process_type:[{id:uri(code)}],procedure_type:uri(code)})),
    {process_type:[uri('COD'),uri('RSP')]},
    {process_type:[uri('RSP'),uri('COD')]},
    {process_type:uri('COD'),had_procedure_type:uri('RSP')},
    {process_type:{id:uri('COD'),'@id':uri('RSP')}},
    {label:null,procedure_type:'ZZZ'},
    {label:null},
  ];
  for(const fields of cases) {
    const work=procedure(fields),{store,worker,generation,task,calls}=setup(t,work);
    await worker.task(task('outside-procedure','outside:procedure:'+id,{id}));
    const saved=store.source(generation,'outside:procedure:'+id),expected=procedureClassification(work);
    assert.equal(saved.work.type,expected.code);assert.equal(saved.work.typeStatus,expected.status);
    assert.deepEqual(saved.work.typeDeclarations,Object.fromEntries(['process_type','procedure_type','had_procedure_type'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]])));
    assert.equal(saved.work.label,work.label);assert.equal(saved.fetchedAt,fetchedAt);
    assert.deepEqual(saved.work.source,{url:'https://data.europarl.europa.eu/api/v2/procedures/'+id+'?format=application%2Fld%2Bjson',fetchedAt});
    assert.equal(calls(),1);
  }
});

test('conflicting procedure declarations cannot give an Outside appearance a legislative marker',async t=>{
  for(const types of [[uri('COD'),uri('RSP')],[uri('RSP'),uri('COD')],[uri('COD')]]) {
    const {store,worker,generation,task}=setup(t,procedure({process_type:types})),date='2026-10-01',agenda='MTG-PL-'+date+'-PVCRE-ITM-1';
    store.putSource(generation,'outside:state','outside-state',{version:1},fetchedAt);
    store.putSource(generation,'outside:roster:'+date,'outside-roster',{date,ids:[],sources:[]},fetchedAt);
    store.putSource(generation,'outside:agenda:'+agenda,'outside-agenda',{id:agenda,date,kind:'PLENARY_DEBATE',procedureIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/events/'+agenda,fetchedAt}},fetchedAt);
    recordOutside(store,generation,{id:'MTG-PL-'+date+'-OTH-1',date,term:10,participants:['424242'],headers:[{personId:'424242',name:'Example speaker',role:'Guest speaker'}],parentIds:[agenda],source:{url:'https://data.europarl.europa.eu/api/v2/speeches/MTG-PL-'+date+'-OTH-1',fetchedAt}});
    await worker.task(task('outside-procedure','outside:procedure:'+id,{id}));
    const person=outsideDirectory(store,{term:'10',language:'en'}).people.find(p=>p.id==='424242');
    assert.ok(person);assert.equal(person.days[0].legislative,types.length===1);
  }
});

test('ordinary procedure refresh updates only existing working Outside context without extra requests or retry changes',async t=>{
  const work=procedure({process_type:uri('COD'),procedure_type:uri('RSP')}),{store,worker,generation}=setup(t,work),key='outside:procedure:'+id;
  store.putSource(generation,key,'outside-procedure',{id,type:'COD',source:{url:'https://data.europarl.europa.eu/api/v2/procedures/'+id,fetchedAt:'2026-10-01T00:00:00Z'}},'2026-10-01T00:00:00Z');
  store.publish(generation);const working=store.beginCycle().generation;
  store.enqueue(working,key,'outside-procedure',{id},101);
  store.db.prepare('UPDATE tasks SET attempts=5,retry_at=?,error=? WHERE generation=? AND key=?').run(now()+86400000,'Existing future retry',working,key);
  const before=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(working,key),old=store.source(generation,key);
  const endpoint='/procedures/'+id;store.enqueue(working,endpoint,'procedure',{endpoint},101);
  await worker.task({generation:working,key:endpoint,kind:'procedure',body:{endpoint},attempts:0});
  assert.equal(store.source(working,key).work.type,null);assert.equal(store.source(working,key).work.typeStatus,'conflicting');
  assert.deepEqual(store.source(generation,key),old);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(working,key),before);
  assert.deepEqual(procedureClassification(store.source(working,endpoint).work),procedureClassification(work));
});

test('ordinary procedure work does not admit a new Outside context',async t=>{
  const {store,worker,generation,task,calls}=setup(t,procedure({process_type:uri('COD')}));
  await worker.task(task('procedure','/procedures/'+id,{endpoint:'/procedures/'+id}));
  assert.equal(store.source(generation,'outside:procedure:'+id),undefined);assert.equal(calls(),1);
});

test('complete procedure projections support Following aliases and reject conflicts without reinterpreting legacy snapshots',t=>{
  const {store,generation}=setup(t,procedure({})),endpoint='/procedures/'+id;
  const old={id:'eli/dl/proc/'+id,process_type:{'@id':uri('COD')}};
  store.putSource(generation,endpoint,'procedure',old,fetchedAt);store.publish(generation);
  const search=g=>new URLSearchParams({epoch:store.get('marksEpoch'),generation:String(g),procedures:'2026/0001A(COD)'});
  const legacy=followingDossiers(store,search(generation));assert.equal(legacy.items[0].status,'unavailable');
  const working=store.beginCycle().generation;
  store.putSource(working,endpoint,'procedure',projectProcedure(procedure({procedure_type:{'@id':uri('COD')}})),fetchedAt);
  store.publish(working);
  assert.equal(followingDossiers(store,search(working)).items[0].status,'available');
  assert.deepEqual(followingDossiers(store,search(generation)),legacy);
  const next=store.beginCycle().generation;
  store.putSource(next,endpoint,'procedure',projectProcedure(procedure({process_type:uri('COD'),procedure_type:uri('RSP')})),fetchedAt);
  store.publish(next);
  assert.equal(followingDossiers(store,search(next)).items[0].status,'unavailable');
  assert.equal(followingDossiers(store,search(working)).items[0].status,'available');
});

test('procedure writers reject duplicate or contradictory identities before saving type evidence',async t=>{
  const good=procedure({process_type:uri('COD')});
  for(const data of [[good,{...good,process_type:uri('RSP')}],[{...good,'@id':'eli/dl/proc/2026-9999'}],[{...good,process_id:'2026-9999'}],[{...good,id:'https://foreign.example/eli/dl/proc/'+id}],[good,{'@id':'eli/dl/proc/'+id}]])for(const kind of ['procedure','outside-procedure']) {
    const {store,worker,generation,task}=setup(t,good);worker.fetchRecord=async()=>({payload:{data},fetchedAt});
    const key=kind==='procedure'?'/procedures/'+id:'outside:procedure:'+id;
    const pending=task(kind,key,kind==='procedure'?{endpoint:key}:{id}),before=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
    await assert.rejects(worker.task(pending),/Invalid or conflicting exact procedure/);
    assert.equal(store.source(generation,key),undefined);
    assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key),before);
  }
});

test('cancelled procedure responses cannot retain canonical or Outside type evidence',async t=>{
  for(const kind of ['procedure','outside-procedure']) {
    const good=procedure({process_type:uri('COD')}),{store,worker,generation,task}=setup(t,good);
    worker.fetchRecord=async()=>{worker.controller.abort(Error('Procedure read cancelled'));return {payload:{data:[good]},fetchedAt};};
    const key=kind==='procedure'?'/procedures/'+id:'outside:procedure:'+id;
    const pending=task(kind,key,kind==='procedure'?{endpoint:key}:{id}),before=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
    await assert.rejects(worker.task(pending),/Procedure read cancelled/);
    assert.equal(store.source(generation,key),undefined);
    assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key),before);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DossierStatus} from './dossier-status.mjs';
import {DossierActivity} from './dossier-activity.mjs';
import {dossierStatuses,dossierStatusesQuery} from './dossier-statuses.mjs';

const {procedures}=JSON.parse(readFileSync(new URL('./fixtures/reader-first-helpers.json',import.meta.url)));
const [erasmus,fisheries]=procedures;
const ids={[erasmus.reference]:'2025-0222',[fisheries.reference]:'2025-0235'};
const work=(fixture,id,label=fixture.reference)=>({id:'eli/dl/proc/'+id,label,process_title:{en:'Title'},consists_of:fixture.indexEvents.map(event=>({...event,id:'eli/dl/event/'+event.activity_id}))});
const held={
  '/procedures/2025-0222':work(erasmus,'2025-0222'),
  '/procedures/2025-0235':work(fisheries,'2025-0235'),
  '/procedures/2026-2000':work({reference:'2026/2000(RSP)',indexEvents:[{activity_id:'MTG-PL-2026-10-22-VOT-ITM-993260',activity_date:'2026-10-22',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS'}]},'2026-2000'),
  '/procedures/2025-0999':work(erasmus,'2025-0999','2025/0888(COD)')
};
const reads=[];
const store={status:()=>({servingGeneration:7}),source:(generation,key)=>{reads.push([generation,key]);return held[key]?{work:held[key],fetchedAt:'2026-11-05T10:00:00Z'}:null;}};
const activity=new DossierActivity(store,{reader:{record:async()=>{throw new Error('a page view reads no source');}}});
const clock=()=>Date.parse('2026-11-06T09:00:00Z');

test('the query takes exact identifiers, one group page at most, in a stable order',()=>{
  assert.deepEqual(dossierStatusesQuery(new URLSearchParams({procedures:'2025-0235,2025-0222'})),{ids:['2025-0222','2025-0235']});
  assert.equal(dossierStatusesQuery(new URLSearchParams({procedures:Array.from({length:20},(_,i)=>'2025-'+String(i+1).padStart(4,'0')).join(',')})).ids.length,20);
  for(const text of ['procedures=','procedures=2025/0222(COD)','procedures=2025-0222,2025-0222','procedures=2025-0222&lang=en','procedures=2025-0222&procedures=2025-0235','procedures='+Array.from({length:21},(_,i)=>'2025-'+String(i+1).padStart(4,'0')).join(',')])
    assert.throws(()=>dossierStatusesQuery(new URLSearchParams(text)),error=>error.status===400,text);
});
test('ordinary legislative files read the stage dossier-status gives, from saved procedures only',async()=>{
  const result=dossierStatuses(activity,{ids:['2025-0222','2025-0235']},{clock});
  assert.deepEqual(result.items,[{id:'2025-0222',reference:'2025/0222(COD)',stage:'position-talks'},{id:'2025-0235',reference:'2025/0235(COD)',stage:'drafting'}]);
  for(const [reference,id] of Object.entries(ids)) {
    const single=await new DossierStatus({activity:{procedure:async()=>({work:held['/procedures/'+id]})},calendar:{catalogue:async()=>({nodes:[]})},votes:{snapshot:async()=>({days:[]})},readAgenda:async()=>null,clock}).query({reference,language:'en'});
    assert.equal(result.items.find(row=>row.id===id).stage,single.stage,reference+' says the same on both pages');
  }
});
test('other families, mismatched and unsaved procedures get no status',()=>{
  const result=dossierStatuses(activity,{ids:['2025-0999','2026-2000','2024-0001']},{clock});
  assert.deepEqual(result.items,[]);
  assert.ok(reads.some(([,key])=>key==='/procedures/2024-0001'));
});

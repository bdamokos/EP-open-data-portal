import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {participation,participationQuery} from './insights-participation.mjs';

const clock=()=>Date.parse('2026-10-17T12:00:00Z'),day='2026-10-16',sitting='MTG-PL-'+day,topic=sitting+'-OJ-ITM-D-1',event=sitting+'-PVCRE-ITM-1';
const speech=(date,id)=>({activity_id:`MTG-PL-${date}-OTH-${id}`,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:{had_participant_person:['person/42'],participation_role:'def/ep-roles/SPEAKER'}});
for(const [frontier,retained] of [['2026-10-09',false],['2026-10-17',false],['2026-10-17',true]])test(`participation topic and country values preserve projection gaps (${frontier}, retained=${retained})`,async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'participation-availability-')),store=new ActivityStore(dir,{clock});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'42',name:'Test member',countryCode:'HU'}]);
  const worker=new ActivityWorker(store,{clock});worker.saveSpeech(generation,speech(frontier,'1'),clock());
  const saved=speech(day,'2');if(retained)worker.saveSpeech(generation,saved,clock());
  const source=data=>({url:'https://data.europarl.europa.eu/api/v2/events/'+event,fetchedAt:clock(),payload:{data}});
  const legislation={cache:new Map(),catalogue:async()=>({complete:true,sittings:[{activity_id:sitting,activity_date:day,consists_of:['eli/dl/event/'+event]}]}),loadMetadata:async()=>new Map(),record:async()=>source([]),query:async()=>({topics:[{id:topic,uri:'eli/dl/event/'+topic,date:day,kind:'PLENARY_DEBATE',title:'Saved debate'}],coverage:{sources:[]}})};
  const response=await participation(legislation,store,participationQuery(new URLSearchParams({sitting})),{clock,readEvent:async()=>source([{id:'eli/dl/event/'+event,activity_date:day,had_activity_type:'def/ep-activities/PLENARY_DEBATE',executed:['eli/dl/event/'+topic],consists_of:['eli/dl/event/'+saved.activity_id,'eli/dl/event/'+sitting+'-OTH-999']}])});
  const row=response.topics[0],country=response.countries.find(row=>row.code==='HU').topics[0];
  assert.equal(response.series[0].speakers,retained?1:null);
  assert.equal(row.speakers,retained?1:null);assert.equal(row.allSpeakers,retained?1:null);
  assert.equal(row.availability.speakers,retained?'partial':'unavailable');
  assert.equal(country.speakers,retained?1:null);assert.equal(country.speakingShare,retained?100:null);
  assert.equal(country.availability.speakers,retained?'partial':'unavailable');
});

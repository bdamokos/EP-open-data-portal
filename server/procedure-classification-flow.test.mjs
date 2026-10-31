import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {insightQuery} from './insights-store.mjs';
import {yearCatalogue} from './test-support/catalogue-fixture.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));

test('agenda procedure types preserve exact references and vote denominators without vocabulary reads',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'procedure-classification-')),store=new ActivityStore(directory);
  const clock=()=>Date.parse('2026-10-14T09:30:00Z'),calls=[];
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'Fixture member'}]);
    const query=insightQuery(new URLSearchParams('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'),{kind:'legislation',now:clock()});
    let baseline;
    for(const code of ['INI','COD','CNS','NLE','RSP','APP','DEC','INL','ACI','BUI','GBD','AVC','SYN','XYZ']) {
      const procedure=structuredClone(fixture.procedure);
      Object.assign(procedure.payload.data[0],{process_type:'def/ep-procedure-types/'+code,label:'2025/2117('+code+')',consists_of:[]});
      const service=new LegislationInsights(store,{clock,loadMetadata:async()=>new Map(),request:yearCatalogue(async(endpoint,params)=>{
        calls.push(endpoint);
        const record=endpoint==='/meetings'?params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}}:
          endpoint.endsWith('/foreseen-activities')?fixture.foreseen:endpoint.endsWith('/vote-results')?fixture.results:
          endpoint.endsWith('/decisions')?fixture.decisions:endpoint==='/procedures/2025-2117'?procedure:
          endpoint.startsWith('/plenary-documents/')?fixture.report:null;
        if(!record)throw new Error('Fixture observation unavailable: '+endpoint);
        return record;
      })});
      const result=await service.query(query),row=result.detail.procedures[0];
      assert.equal(row.code,code);assert.equal(row.status,code==='XYZ'?'unknown':'known');
      assert.equal(row.reference,'2025/2117('+code+')');assert.equal(new URL(row.websiteUrl).searchParams.get('reference'),row.reference);
      assert.equal(row.apiUrl,procedure.url);assert.equal(row.fetchedAt,new Date(procedure.fetchedAt).toISOString());
      assert.equal(row.declarations[0].value,procedure.payload.data[0].process_type);
      const observed={topics:result.topics,votes:result.detail.votes,patterns:result.detail.finalVotePatterns,people:result.detail.people};
      baseline??=observed;assert.deepEqual(observed,baseline,'changing procedure family must not change named vote scope, totals or people');
    }
    assert(!calls.some(endpoint=>/ep-procedure-types|vocab|authority/.test(endpoint)));
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('conflicting procedure fields or suffixes withhold agenda dossier links while preserving evidence',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'procedure-conflict-')),store=new ActivityStore(directory),clock=()=>Date.parse('2026-10-14T09:30:00Z');
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'Fixture member'}]);
    for(const fields of [{process_type:['COD','CNS'],label:'2025/2117(COD)'},{process_type:'COD',had_procedure_type:'APP',label:'2025/2117(COD)'},{process_type:'COD',label:'2025/2117(CNS)'}]) {
      const procedure={...fixture.procedure,payload:{data:[{id:'eli/dl/proc/2025-2117',...fields,consists_of:[]}]}};
      const service=new LegislationInsights(store,{clock,loadMetadata:async()=>new Map(),request:yearCatalogue(async(endpoint,params)=>{
        if(endpoint==='/meetings')return params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}};
        if(endpoint.endsWith('/foreseen-activities'))return fixture.foreseen;
        if(endpoint==='/procedures/2025-2117')return procedure;
        if(endpoint.endsWith('/vote-results'))return fixture.results;
        if(endpoint.endsWith('/decisions'))return fixture.decisions;
        throw new Error('Unavailable fixture source');
      })});
      const result=await service.query(insightQuery(new URLSearchParams('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'),{kind:'legislation',now:clock()}));
      const row=result.detail.procedures[0];assert.equal(row.status,'conflicting');assert.equal(row.code,null);assert.equal(row.reference,null);assert.equal(row.websiteUrl,null);assert.equal(row.declaredReference,fields.label);assert.equal(row.referenceCode,fields.label.match(/\(([^)]+)\)/)[1]);assert(row.declarations.length);
    }
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

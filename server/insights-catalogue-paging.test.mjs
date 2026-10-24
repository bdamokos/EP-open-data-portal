import {test} from 'node:test';
import assert from 'node:assert/strict';

// This test process uses a stubbed transport and never reads or writes a saved cache.
process.env.ODP_CACHE_DIR='';
const {LegislationInsights}=await import('./insights-legislation.mjs');
const {HttpError}=await import('./http-utils.mjs');

test('real HTTP 204 ends an exactly full catalogue but keeps selected agendas unavailable',async t=>{
  const nodes=Array.from({length:150},(_,i)=>{
    const date=new Date(Date.parse('2024-07-16T12:00:00Z')+i*86400_000).toISOString().slice(0,10);
    return {id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'};
  }),calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);calls.push(url);
    if(url.pathname.endsWith('/meetings')){
      const page=nodes.filter(n=>n.activity_date.startsWith(url.searchParams.get('year'))).slice(Number(url.searchParams.get('offset')),Number(url.searchParams.get('offset'))+50);
      return page.length||Number(url.searchParams.get('offset'))===0?new Response(JSON.stringify({data:page}),{headers:{'content-type':'application/ld+json'}}):new Response(null,{status:204});
    }
    assert(url.pathname.endsWith('/MTG-PL-2024-07-16/foreseen-activities'));
    return new Response(null,{status:204});
  });
  const service=new LegislationInsights({status:()=>({currentMeps:1,servingGeneration:1})},{clock:()=>Date.parse('2026-10-16T12:00:00Z')});
  const catalogue=await service.catalogue();
  assert.equal(catalogue.sittings.length,150);assert.equal(catalogue.complete,true);
  assert.deepEqual(calls.map(url=>Number(url.searchParams.get('offset'))),[0,50,100,150,0,0]);
  const result=await service.query({language:'en',sitting:'MTG-PL-2024-07-16'});
  assert.equal(result.sitting.date,'2024-07-16');assert.equal(result.sittings.length,150);
  assert.equal(result.coverage.agendaComplete,false);
  assert.match(result.coverage.agendaError,/supplied no content/);
  assert.equal(calls.length,7,'only the selected agenda is requested after cached catalogue pages');
});

test('an unavailable first catalogue page and malformed later pages remain errors',async()=>{
  const clock=()=>Date.parse('2026-10-16T12:00:00Z');
  const missing=new LegislationInsights(null,{clock,request:async()=>{throw new HttpError(502,'odp_no_content','No content');}});
  await assert.rejects(missing.catalogue(),error=>error.code==='odp_no_content');
  const malformed=new LegislationInsights(null,{clock,request:async(endpoint,params)=>{
    if(params.offset)throw new HttpError(502,'odp_invalid','Malformed source');
    return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:clock(),payload:{data:Array.from({length:50},(_,i)=>({id:'eli/dl/event/'+i,activity_id:String(i)}))}};
  }});
  const result=await malformed.catalogue();assert.equal(result.complete,false);assert(result.coverage.years.every(y=>y.error.code==='odp_invalid'));
});

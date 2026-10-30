import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {ParliamentSearch,parliamentSearchQuery} from './parliament-search.mjs';
import {yearCatalogue} from './test-support/catalogue-fixture.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));
const activity=JSON.parse(readFileSync(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url)));
const clock=()=>Date.parse('2026-10-15T12:00:00Z');
const query=value=>parliamentSearchQuery(new URLSearchParams(value));
function setup(t,{missing=false,agenda}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'parliament-search-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  store.acquire();const {generation}=store.beginCycle();
  store.setMembers([{id:'43',name:'Éva Example',nameVariants:[{value:'Eva Alternate'}]}]);
  const work=activity.documents.find(d=>d.endpoint.startsWith('/parliamentary-questions')).work;
  store.putSource(generation,'/parliamentary-questions/'+work.identifier,'document',projectDocument(work),activity.verifiedAt);
  store.publish(generation);store.release();
  const calls=[],request=yearCatalogue(async(endpoint,params)=>{
    calls.push([endpoint,params]);
    if(missing)throw Object.assign(new Error('Not retained'),{code:'odp_cache_miss'});
    if(endpoint!=='/meetings'&&agenda)return agenda(endpoint,params);
    return endpoint==='/meetings'?{...fixture.meetings,fetchedAt:clock()}: {...fixture.foreseen,fetchedAt:clock()};
  });
  return {store,generation,calls,service:new ParliamentSearch(store,{request,clock}),work};
}
test('names and exact question metadata are searchable without a text corpus',async t=>{
  const {service,calls,work}=setup(t);
  const names=await service.query(query('q=eva&type=mep'));
  assert.deepEqual(names.sections[0].results.map(r=>r.id),['43']);assert.equal(calls.length,0);
  assert.equal((await service.query(query('q=alternate&type=mep'))).sections[0].total,1,'retained name variants are searched');
  const question=(await service.query(query('q=Blue+Flag&type=question'))).sections[0];
  assert.equal(question.total,1);assert.equal(question.results[0].id,work.identifier);
  assert.equal(question.results[0].source.fetchedAt,activity.verifiedAt);
  assert.equal((await service.query(query('q='+work.identifier+'&type=question'))).sections[0].total,1);
  assert.equal((await service.query(query('q=Blue&type=question&from=2026-08-01'))).sections[0].total,0);
  assert.equal(calls.length,0,'question/name selection never reads agenda sources');
});
test('question search names its own failed records instead of inheriting unrelated archive failures',async t=>{
  const {service,store,generation}=setup(t);store.acquire();
  const put=store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,'document','{}')");
  put.run(generation,'/plenary-documents/A-10-2026-0001');
  const read=async()=>(await service.query(query('q=Blue&type=question'))).sections[0];
  assert.equal((await read()).coverage.complete,true);
  const missing='/parliamentary-questions/E-10-2026-001715';put.run(generation,missing);
  const section=await read();assert.equal(section.coverage.complete,false);
  assert.deepEqual(section.coverage.availability.gaps.map(gap=>gap.sourceId),[missing]);
  assert.equal(section.total,1,'a failed other record does not erase retained matches');
});
test('dated question failures qualify only the matching search interval',async t=>{
  const {service,store,generation}=setup(t);store.acquire();
  const put=store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,'document',?)");
  put.run(generation,'/parliamentary-questions/E-10-2024-000999',JSON.stringify({start:'2024-10-01',end:'2024-10-01'}));
  const read=async period=>(await service.query(query('q=nonexistent&type=question'+period))).sections[0];
  assert.equal((await read('&from=2026-01-01&to=2026-10-15')).coverage.complete,true);
  assert.equal((await read('&from=2024-07-16&to=2026-10-15')).coverage.complete,false);
  put.run(generation,'/parliamentary-questions/E-10-2026-000999',JSON.stringify({start:'2026-10-14',end:'2026-10-14'}));
  assert.equal((await read('&from=2026-01-01&to=2026-10-15')).coverage.complete,false);
});

test('a fully read saved agenda is complete for search, while a full last page keeps its real limit',async t=>{
  const sitting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  const topics=fixture.foreseen.payload.data.slice(0,5);
  const {service}=setup(t,{agenda:()=>({...fixture.foreseen,payload:{data:topics},fetchedAt:clock()})});
  service.meetings.catalogue=async()=>({nodes:[sitting],coverage:{status:'complete'}});
  const section=(await service.query(query('q=energy&type=topic&from=2026-10-07&to=2026-10-07'))).sections[0];
  assert.equal(section.coverage.missingAgendas,0);assert.equal(section.coverage.limited,false);assert.equal(section.coverage.complete,true);
  const full=Array.from({length:50},(_,i)=>({id:'eli/dl/event/'+sitting.activity_id+'-UNRELATED-'+i,activity_id:sitting.activity_id+'-UNRELATED-'+i}));
  const limited=setup(t,{agenda:()=>({...fixture.foreseen,payload:{data:full},fetchedAt:clock()})});
  limited.service.meetings.catalogue=async()=>({nodes:[sitting],coverage:{status:'complete'}});
  const result=(await limited.service.query(query('q=energy&type=topic&from=2026-10-07&to=2026-10-07'))).sections[0];
  assert.equal(result.coverage.pageLimitedAgendas,1);assert.equal(result.coverage.limited,true);assert.equal(result.coverage.complete,false);
});
test('plenary topics use exact calendar-to-agenda relationships and retain dates and provenance',async t=>{
  const {service}=setup(t);
  const result=await service.query(query('q='+encodeURIComponent('energy')+'&type=topic'));
  const section=result.sections[0];assert(section.total>0);
  for(const row of section.results){assert(row.id.startsWith(row.sittingId+'-'));assert.match(row.title,/energy/i);assert(row.source.url);assert.equal(row.source.fetchedAt,new Date(clock()).toISOString());}
  assert.equal(section.coverage.complete,false,'retained agendas are never a whole-archive claim');
  assert.equal((await service.query(query('q=energy&type=topic&from=2026-11-01'))).sections[0].total,0);
});
test('a failed old calendar stays disclosed only when its year is in the selected search period',async t=>{
  const sitting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  const {service}=setup(t,{agenda:()=>({...fixture.foreseen,payload:{data:fixture.foreseen.payload.data.slice(0,5)},fetchedAt:clock()})});
  service.meetings.catalogue=async()=>({nodes:[sitting],coverage:{status:'partial',years:[{year:2024,state:'partial'},{year:2026,state:'complete'}]}});
  const broad=(await service.query(query('q=energy&type=topic'))).sections[0].coverage;
  assert.deepEqual(broad.incompleteCalendarYears,[2024]);assert.equal(broad.complete,false);
  const current=(await service.query(query('q=energy&type=topic&from=2026-10-07&to=2026-10-07'))).sections[0].coverage;
  assert.deepEqual(current.incompleteCalendarYears,[]);assert.equal(current.complete,true);
});
test('a missing second agenda page retains the first page but cannot establish a complete search',async t=>{
  const sitting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  const first=[...fixture.foreseen.payload.data.slice(0,5),...Array.from({length:45},(_,i)=>({id:'eli/dl/event/'+sitting.activity_id+'-X-'+i,activity_id:sitting.activity_id+'-X-'+i}))];
  const {service}=setup(t,{agenda:(_endpoint,params)=>{if(params.offset)throw Object.assign(new Error('Not retained'),{code:'odp_cache_miss'});return {...fixture.foreseen,payload:{data:first},fetchedAt:clock()};}});
  service.meetings.catalogue=async()=>({nodes:[sitting],coverage:{status:'complete'}});
  const section=(await service.query(query('q=energy&type=topic'))).sections[0];
  assert.equal(section.coverage.complete,false);assert.equal(section.coverage.agendasRead,1);
  assert.deepEqual(section.coverage.missingAgendaPages,[{sittingId:sitting.activity_id,offset:50}]);
});
test('missing calendar observations remain unavailable while MEP and question results survive',async t=>{
  const {service}=setup(t,{missing:true});
  const response=await service.query(query('q=eva'));
  assert.equal(response.sections.find(s=>s.type==='mep').total,1);
  assert.equal(response.sections.find(s=>s.type==='topic').coverage.available,false);
});
test('conflicting agenda topics and containers are withheld while identical repeats keep exact first-page provenance',async t=>{
  const sitting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  const topic=fixture.foreseen.payload.data.find(node=>node.activity_id===sitting.activity_id+'-OJ-ITM-D-63');
  const container=fixture.foreseen.payload.data.find(node=>JSON.stringify(node.consists_of||[]).includes(topic.id));
  assert(topic&&container);
  for(const conflict of ['none','title','container'])await t.test(conflict,async t=>{
    const first={...topic,activity_label:{en:'Old energy title'}},second=conflict==='title'?{...first,activity_label:{en:'Revised climate title'}}:structuredClone(first);
    const page0=[container,first,...Array.from({length:48},(_,i)=>({id:'eli/dl/event/'+sitting.activity_id+'-UNRELATED-'+i,activity_id:sitting.activity_id+'-UNRELATED-'+i}))];
    const page1=conflict==='container'?[second,{...container,consists_of:[]}]:[second];
    const url=offset=>'https://data.europarl.europa.eu/api/v2/meetings/'+sitting.activity_id+'/foreseen-activities?limit=50&offset='+offset;
    const {service}=setup(t,{agenda:(endpoint,params)=>({url:url(params.offset),fetchedAt:clock()+params.offset,payload:{data:params.offset===0?page0:page1}})});
    const section=(await service.query(query('q=old&type=topic'))).sections[0];
    if(conflict==='none') {
      assert.equal(section.total,1);assert.equal(section.results[0].title,'Old energy title');assert.equal(section.results[0].source.url,url(0));assert.equal(section.results[0].source.fetchedAt,new Date(clock()).toISOString());assert.deepEqual(section.coverage.conflicts,[]);
    } else {
      assert.equal(section.total,0);assert(section.coverage.conflicts.length>0);
      assert.deepEqual(section.coverage.conflicts[0].sources.map(source=>source.url),[url(0),url(50)]);
      assert.equal((await service.query(query('q=revised&type=topic'))).sections[0].total,0,'a disputed replacement cannot become a result');
    }
  });
});
test('question title pages retain exact totals, newest ordering and expression-only titles',async t=>{
  const {service,store,generation,work}=setup(t);
  store.acquire();
  for(let i=1;i<=13;i++){
    const id='E-10-2026-'+String(i).padStart(6,'0');
    store.putSource(generation,'/parliamentary-questions/'+id,'document',projectDocument({...work,id:'eli/dl/doc/'+id,identifier:id,document_date:'2026-10-'+String(i).padStart(2,'0'),title_dcterms:{},is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',title:{en:'Expression title for paging'},is_embodied_by:[]}]}),activity.verifiedAt);
  }
  store.release();
  const first=(await service.query(query('q=expression&type=question'))).sections[0],second=(await service.query(query('q=expression&type=question&offset=10'))).sections[0];
  assert.equal(first.total,13);assert.equal(first.results.length,10);assert.equal(first.nextOffset,10);assert.equal(first.results[0].id,'E-10-2026-000013');
  assert.equal(second.total,13);assert.equal(second.results.length,3);assert.equal(second.nextOffset,null);assert.equal(second.results.at(-1).id,'E-10-2026-000001');
  assert.equal(new Set([...first.results,...second.results].map(row=>row.id)).size,13);
});
test('query validation bounds types, dates, offsets and repeated parameters',()=>{
  assert.deepEqual(query('q=%22blue+flag%22+beach').terms,['blue flag','beach']);
  for(const value of ['q=','q=a&type=wrong','q=a&offset=-1','q=a&offset=1001','q=a&offset=1.5','q=a&from=2026-02-30','q=a&from=2026-10-01&to=2026-09-01','q=a&q=b','q=a&other=x'])assert.throws(()=>query(value),error=>error.status===400,value);
});

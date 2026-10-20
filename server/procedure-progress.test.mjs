import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfficialContextSources} from './official-context.mjs';
import {ProcedureProgress,PROGRESS_LIMITS,procedureProgressQuery,progressSparql,parseProgress,parseProgressDocuments,readableDocumentUrl} from './procedure-progress.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const dossier='http://publications.europa.eu/resource/cellar/9d07a799-630b-11f0-bf4e-01aa75ed71a1';
const work='http://publications.europa.eu/resource/cellar/e0649735-a372-11eb-9585-01aa75ed71a1';
const u=value=>({type:'uri',value}),l=value=>({type:'literal',value}),label=(value,language='en')=>({...l(value),'xml:lang':language});
const query={reference:'2025/0223(COD)',language:'en',detail:'events'};
const mapping={kind:l('0'),reference:l('2025/0223/COD'),dossier:u(dossier)};
const row=(id='0001',extra={})=>({...mapping,kind:l('1'),event:u(dossier+'.'+id),date:l('2026-10-01'),type:u('http://publications.europa.eu/resource/authority/event/ADP_REP_byEP_CMT'),label:label('Committee report adopted'),...extra});
const data=rows=>({results:{bindings:rows}});

test('public source fixture keeps Parliament position, Council adoption and publication distinct',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/procedure-progress.json',import.meta.url)));
  const parsed=parseProgress(fixture.response,fixture.query);
  assert.equal(parsed.events.length,3);
  assert.deepEqual(parsed.events.map(e=>e.date),['2026-07-07','2026-07-13','2026-07-17']);
  assert(parsed.events[0].types.some(type=>type.code==='ADP_R1_POS_byEP'));
  assert(parsed.events[1].types.some(type=>type.code==='APR_R1_byCONSIL'));
  assert(parsed.events[2].types.some(type=>type.code==='PUB_OJ'));
});

test('progress grammar validates the complete procedure and finite optional detail',()=>{
  assert.deepEqual(procedureProgressQuery(new URLSearchParams('reference=2023%2F0077B(COD)&lang=hu&detail=documents')),{reference:'2023/0077B(COD)',language:'hu',detail:'documents'});
  for(const suffix of ['&reference=2025%2F0223(COD)','&detail=','&detail=all','&url=https://example.test','&lang=en&lang=fr'])assert.throws(()=>procedureProgressQuery(new URLSearchParams('reference=2025%2F0223(COD)'+suffix)),{status:400});
  assert.throws(()=>progressSparql({...query,reference:'2025/0223(COD)" UNION {}'}),{status:400});
  assert.throws(()=>progressSparql({...query,language:'en"'}),{status:400});
  const sparql=progressSparql(query);
  assert.match(sparql,/2025\/0223\/COD/);
  assert.match(sparql,/OPTIONAL \{ \?event cdm:event_legal_date/);
  assert.match(sparql,/ORDER BY \?event LIMIT 301/);
  assert.match(sparql,/ORDER BY \?kind/);
});
test('duplicate institution and label rows remain one exact event; scheduled is never completed',()=>{
  const projected=row('0002',{date:l('2020-01-01'),status:u('http://publications.europa.eu/resource/authority/event-status/PROJECTED')});
  const parsed=parseProgress(data([mapping,row('0001',{institution:u('http://publications.europa.eu/resource/authority/corporate-body/EP')}),row('0001',{institution:u('http://publications.europa.eu/resource/authority/corporate-body/CONSIL')}),projected]),query);
  assert.equal(parsed.events.length,2);
  const report=parsed.events.find(e=>e.id.endsWith('0001'));
  assert.equal(report.institutions.length,2);
  assert.equal(parsed.events.find(e=>e.id.endsWith('0002')).status,'projected');
});
test('missing and contradictory dates/types/statuses retain the event with explicit gaps',()=>{
  const rows=[mapping,row('0001',{date:undefined,type:undefined,label:undefined}),row('0002'),row('0002',{date:l('2026-09-30')}),row('0003',{date:l('2026-02-30'),status:u('https://example.test/PROJECTED')})];
  const parsed=parseProgress(data(rows),query);
  assert.equal(parsed.events.length,3);
  assert.equal(parsed.coverage.incompleteEvents,3);
  assert(parsed.events.every(e=>e.date===null));
  assert.equal(parsed.events.find(e=>e.id.endsWith('0003')).status,'unknown');
});
test('exact missing, ambiguous and mismatched references do not become a zero-event mapped file',()=>{
  assert.equal(parseProgress(data([]),query).state,'unmapped');
  const alternative={...mapping,dossier:u(work)};
  const parsed=parseProgress(data([mapping,alternative,row()]),query);
  assert.equal(parsed.state,'ambiguous');assert.deepEqual(parsed.events,[]);
  assert.throws(()=>parseProgress(data([{...mapping,reference:l('2025/0223/CNS')}]),query),{code:'progress_source_identity'});
  assert.throws(()=>parseProgress(data([row()]),query),{code:'progress_source_identity'});
});
test('official requested labels win, fallback language is retained, conflicts are not selected',()=>{
  const parsed=parseProgress(data([mapping,row(),row('0001',{label:label('Bizottsági jelentés','hu')}),row('0002',{label:label('One')}),row('0002',{label:label('Two')})]),{...query,language:'hu'});
  assert.equal(parsed.events[0].label,'Bizottsági jelentés');assert.equal(parsed.events[0].labelLanguage,'hu');
  assert.equal(parsed.events[1].label,null);assert(parsed.events[1].issues.includes('label'));
  assert.equal(parseProgress(data([mapping,row()]),{...query,language:'hu'}).events[0].labelLanguage,'en');
});
test('event and source-row caps explicitly limit retained observations',()=>{
  const parsed=parseProgress(data([mapping,...Array.from({length:301},(_,i)=>row(String(i).padStart(4,'0')))]),query);
  assert.equal(parsed.events.length,300);assert.equal(parsed.coverage.limited,true);
  assert.equal(parseProgress(data([mapping,...Array.from({length:PROGRESS_LIMITS.eventRows-1},()=>row())]),query).coverage.limited,true);
});
test('document links use exact CELEX and withhold conflicting or unsupported identifiers',()=>{
  const doc={...row(),work:u(work),celex:l('52021PC0206'),title:label('Legislative proposal')};
  const parsed=parseProgressDocuments(data([mapping,doc]),query);
  assert.equal(parsed.documents[0].url,'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52021PC0206');
  assert.equal(parseProgressDocuments(data([mapping,doc]),{...query,language:'hu'}).documents[0].url,parsed.documents[0].url,'missing translated titles retain the available document language');
  const conflict=parseProgressDocuments(data([mapping,doc,{...doc,alias:u('http://publications.europa.eu/resource/celex/32024R1689')}]),query);
  assert.equal(conflict.documents[0].url,null);
  assert.equal(readableDocumentUrl({celex:[],aliases:['http://publications.europa.eu/resource/consil/ST_12778_2021_REV_1']},'en'),null);
  assert.equal(readableDocumentUrl({celex:[],aliases:[work,'https://example.test/doc','http://publications.europa.eu/resource/consil/ST_12778_2021_INIT/evil']},'en'),null);
});
test('shared official-source cache coalesces views and preserves stale progress after a failed one-hour refresh',async()=>{
  let now=Date.parse('2026-10-20T10:00:00Z'),calls=0,fail=false;
  const sources=new OfficialContextSources({directory:null,clock:()=>now,run:operation=>operation(),fetchSource:async()=>{calls++;if(fail)throw new Error('Source failed');return Response.json(data([mapping,row()]));}});
  const service=new ProcedureProgress(sources);
  const [a,b]=await Promise.all([service.query(query),service.query(query)]);
  assert.equal(calls,1);assert.deepEqual(a.events,b.events);
  now+=PROGRESS_LIMITS.freshMs+1;fail=true;
  const stale=await service.query(query);assert.equal(stale.source.stale,true);assert.equal(stale.events.length,1);
  await Promise.allSettled([...sources.cache.pending.values()]);
  const saved=await service.query(query);assert.equal(saved.source.refreshError,'Source failed');assert.equal(saved.source.fetchedAt,a.source.fetchedAt);assert.equal(calls,2);
});
test('progress transport caches only fresh complete mapped or explicit unmatched observations',()=>{
  const request={method:'GET',headers:{}},url=new URL('https://example.test/api/insights/procedure-progress?reference=2025%2F0223(COD)&lang=en');
  const result={state:'mapped',coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{stale:false,refreshError:null}};
  assert.deepEqual(apiCachePolicy(request,url,result),{cacheControl:'public, max-age=0',cdnCacheControl:'public, max-age=300, stale-if-error=0'});
  for(const changed of [{state:'ambiguous'},{coverage:{limited:true}},{coverage:{invalidRows:1}},{coverage:{incompleteEvents:1}},{source:{stale:true}},{source:{refreshError:'Failed'}}])assert.equal(apiCachePolicy(request,url,{...result,...changed}).cdnCacheControl,'no-store');
  assert.equal(apiCachePolicy({...request,headers:{authorization:'test'}},url,result).cacheControl,'no-store');
  assert.equal(apiCachePolicy({...request,method:'POST'},url,result).cacheControl,'no-store');
});

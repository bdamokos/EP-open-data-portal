import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OfficialContextSources} from './official-context.mjs';
import {ProcedureProgress,PROGRESS_LIMITS,procedureProgressQuery,progressSparql,parseProgress,parseProgressDocuments,readableDocumentUrl} from './procedure-progress.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {createInsights} from './insights.mjs';
import {parseProcedureProgressPage} from './official-context.mjs';

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
test('the actual insight dispatcher admits the independent finite route without reading an index',async()=>{
  let calls=0;
  const service=createInsights(new Proxy({},{get(){throw new Error('Progress must not read the index');}}),{officialSources:{get:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'publications.europa.eu');assert.equal(options.freshMs,3600_000);return {url,fetchedAt:'2026-10-20T10:00:00Z',data:data([mapping,row()])};}}});
  const response=await service.query('procedure-progress',new URLSearchParams({reference:query.reference,lang:'en'}));
  assert.equal(response.version,3);assert.equal(response.events.length,1);assert.equal(calls,1);
  for(const suffix of ['&reference=2025%2F0223(COD)','&detail=','&detail=all','&unknown=x'])await assert.rejects(service.query('procedure-progress',new URLSearchParams('reference=2025%2F0223(COD)'+suffix)),{status:400});
  assert.equal(calls,1,'invalid semantic queries never reach the source');
});

const rsp={reference:'2026/2937(RSP)',language:'en',detail:'events'};
const oeilHtml=readFileSync(new URL('./fixtures/oeil-procedure-2026-2937-progress.html',import.meta.url),'utf8');
test('exact public OEIL key events recover a non-legislative procedure without inventing a Cellar mapping',async()=>{
  const calls=[],sources={get:async(url,options)=>{
    calls.push(url);const record={url,fetchedAt:'2026-10-27T12:10:00Z',...(url.includes('/sparql')?{data:data([])}:{html:oeilHtml})};options.validate(record);return record;
  }};
  const result=await new ProcedureProgress(sources).query(rsp);
  assert.equal(result.state,'mapped');assert.equal(result.dossier,null);assert.equal(result.basis,'oeil');
  assert.equal(result.cellar.state,'unmapped');assert.equal(result.status.label,'Procedure completed');
  assert.deepEqual(result.events.map(e=>[e.date,e.label]),[['2026-10-20','Debate in Parliament'],['2026-10-20','End of procedure in Parliament']]);
  assert(result.events.every(e=>e.labelLanguage==='en'&&e.works.length===0));
  assert.equal(result.sources.length,2);assert.equal(result.source.fetchedAt,'2026-10-27T12:10:00Z');
  assert.equal(new URL(calls[1]).searchParams.get('reference'),rsp.reference);
  const repeat=await new ProcedureProgress(sources).query({...rsp,language:'hu'});
  assert.deepEqual(repeat.events.map(e=>e.id),result.events.map(e=>e.id));assert.equal(repeat.events[0].labelLanguage,'en');
  await new ProcedureProgress(sources).query({...rsp,detail:'documents'});
  assert.equal(calls.length,5,'documents remain an independent Cellar-only lazy read');
});
test('OEIL parser isolates the key-events table and retains missing, capped and future observations',()=>{
  const parsed=parseProcedureProgressPage(oeilHtml,rsp.reference);
  assert.equal(parsed.events.length,2);assert.equal(parsed.coverage.timeline,'available');
  assert.throws(()=>parseProcedureProgressPage(oeilHtml,'2026/2937B(RSP)'),{code:'procedure_identity'});
  const missing=parseProcedureProgressPage(oeilHtml.replaceAll('Key events','Other documents'),rsp.reference);
  assert.equal(missing.events.length,0);assert.equal(missing.coverage.timeline,'unavailable');assert.equal(missing.status.label,'Procedure completed');
  const malformed=parseProcedureProgressPage(oeilHtml.replace('20/10/2026','31/02/2026'),rsp.reference);
  assert.equal(malformed.events[0].date,null);assert.deepEqual(malformed.events[0].issues,['date']);
  assert.equal(malformed.coverage.incompleteEvents,1);
  const capped=parseProcedureProgressPage(oeilHtml,rsp.reference,'en',{limit:1});assert.equal(capped.events.length,1);assert.equal(capped.coverage.limited,true);
  const future=parseProcedureProgressPage(oeilHtml.replaceAll('20/10/2026','20/10/2099'),rsp.reference);assert.equal(future.events[0].date,'2099-10-20');
  const french=readFileSync(new URL('./fixtures/oeil-procedure-2026-2937-progress-fr.html',import.meta.url),'utf8');
  const fr=parseProcedureProgressPage(french,rsp.reference,'fr');assert.equal(fr.status.label,'Procédure terminée');assert.equal(fr.events[1].label,'Fin de la procédure au Parlement');assert.equal(fr.events[1].language,'fr');
  assert.equal(parseProcedureProgressPage(oeilHtml,rsp.reference,'fr').language,'en','printed source language survives a website language fallback');
  const conflict=parseProcedureProgressPage(oeilHtml.replace('<p class="text-danger">Procedure completed</p>','<p class="text-danger">Procedure completed</p></div><div><p>Status</p><p>Awaiting decision</p>'),rsp.reference);
  assert.equal(conflict.status,null);assert.equal(conflict.coverage.status,'ambiguous');
});
test('OEIL cannot hide ambiguous Cellar identity, replace institutional events or substitute a different reference',async()=>{
  for(const rows of [[mapping,{...mapping,dossier:u(work)}],[mapping,row()]]){
    let calls=0;const result=await new ProcedureProgress({get:async url=>{calls++;assert(url.includes('/sparql'));return {url,fetchedAt:'2026-10-27T12:10:00Z',data:data(rows)};}}).query(query);
    assert.equal(calls,1);assert.equal(result.basis,'cellar');
  }
  const result=await new ProcedureProgress({get:async(url,options)=>{
    const record={url,fetchedAt:'2026-10-27T12:10:00Z',...(url.includes('/sparql')?{data:data([])}:{html:oeilHtml})};options.validate(record);return record;
  }}).query({...rsp,reference:'2026/2937B(RSP)'});
  assert.equal(result.state,'unmapped');assert.equal(result.fallback.status,'unavailable');assert.equal(result.events.length,0);
});
test('OEIL stale refresh settles to updated events and malformed refreshes preserve the last-good exact page',async()=>{
  let now=Date.parse('2026-10-27T12:10:00Z'),html=oeilHtml;
  const sources=new OfficialContextSources({directory:null,clock:()=>now,run:operation=>operation(),fetchSource:async url=>url.includes('/sparql')?Response.json(data([])):new Response(html,{headers:{'content-type':'text/html'}})});
  const service=new ProcedureProgress(sources),initial=await service.query(rsp);
  now+=PROGRESS_LIMITS.freshMs+1;html=oeilHtml.replace('Debate in Parliament','Debate concluded in Parliament');
  const stale=await service.query(rsp);assert(stale.source.refreshInProgress);assert.equal(stale.events[0].label,initial.events[0].label);
  await Promise.allSettled([...sources.cache.pending.values()]);
  const settled=await service.query(rsp);assert.equal(settled.source.stale,false);assert.equal(settled.source.refreshInProgress,false);assert.match(settled.events[0].label,/concluded/);
  now+=PROGRESS_LIMITS.freshMs+1;html=oeilHtml.replaceAll(rsp.reference,'2026/2937B(RSP)');
  await service.query(rsp);await Promise.allSettled([...sources.cache.pending.values()]);
  const failed=await service.query(rsp);assert(failed.source.refreshError);assert.deepEqual(failed.events,settled.events);assert.equal(failed.source.fetchedAt,settled.source.fetchedAt);
});
test('OEIL admission failures retain backoff and unavailable status without asserting zero activity',async()=>{
  const result=await new ProcedureProgress({get:async url=>{
    if(url.includes('/sparql'))return {url,fetchedAt:'2026-10-27T12:10:00Z',data:data([])};
    throw Object.assign(new Error('Busy'),{code:'upstream_busy',retryAt:123456});
  }}).query(rsp);
  assert.equal(result.state,'unmapped');assert.equal(result.fallback.status,'unavailable');assert.equal(result.fallback.retryAt,123456);
  assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/insights/procedure-progress'),result).cdnCacheControl,'no-store');
});
test('OEIL examines every status pair in one container and requires verified supported language',()=>{
  const conflicting=oeilHtml.replace('<p class="text-danger">Procedure completed</p>','<p class="text-danger">Procedure completed</p><p>Status</p><p>Awaiting decision</p>');
  assert.notEqual(conflicting,oeilHtml);
  const parsed=parseProcedureProgressPage(conflicting,rsp.reference);
  assert.equal(parsed.status,null);assert.equal(parsed.coverage.status,'ambiguous');assert.equal(parsed.coverage.invalidRows,1);assert.equal(parsed.events.length,2);
  for(const language of ['', ' lang="de"']) {
    const unsupported=oeilHtml.replace(' lang="en"',language);assert.notEqual(unsupported,oeilHtml);
    assert.throws(()=>parseProcedureProgressPage(unsupported,rsp.reference,'fr'),{code:'procedure_language'});
  }
});
test('structurally degraded or unverified-language OEIL replacements preserve the good cached observation',async()=>{
  const unusable=oeilHtml.replace('<p class="text-danger">Procedure completed</p>','').replaceAll('Key events','Other documents');
  assert.throws(()=>parseProcedureProgressPage(unusable,rsp.reference),{code:'procedure_progress_shape'});
  for(const replacement of [unusable,oeilHtml.replace(' lang="en"',''),oeilHtml.replace(' lang="en"',' lang="de"')]) {
    let now=Date.parse('2026-10-27T12:10:00Z'),html=oeilHtml;
    const sources=new OfficialContextSources({directory:null,clock:()=>now,run:operation=>operation(),fetchSource:async url=>url.includes('/sparql')?Response.json(data([])):new Response(html,{headers:{'content-type':'text/html'}})});
    const service=new ProcedureProgress(sources),saved=await service.query(rsp);
    now+=PROGRESS_LIMITS.freshMs+1;html=replacement;
    await service.query(rsp);await Promise.allSettled([...sources.cache.pending.values()]);
    const retained=await service.query(rsp);
    assert.deepEqual(retained.events,saved.events);assert.deepEqual(retained.status,saved.status);assert.equal(retained.source.fetchedAt,saved.source.fetchedAt);
    assert.equal(retained.source.stale,true);assert(retained.source.refreshError);assert.equal(retained.source.refreshInProgress,false);
  }
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
test('explicit empty or invalid date bindings cannot be hidden by a valid date row',()=>{
  for(const invalid of [l(''),u('2026-10-01'),null,l('2026-02-30')]){
    const parsed=parseProgress(data([mapping,row(),row('0001',{date:invalid})]),query);
    assert.equal(parsed.events[0].date,null);
    assert.deepEqual(parsed.events[0].dates,['2026-10-01']);
    assert(parsed.events[0].issues.includes('date'));
    assert.equal(parsed.coverage.incompleteEvents,1);
    assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/insights/procedure-progress'),parsed).cdnCacheControl,'no-store');
  }
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
test('row-capped document metadata retains observations without asserting readable identifiers',()=>{
  const doc=row('0001',{work:u(work),celex:l('52021PC0206')});
  // A conflicting CELEX can be outside the returned slice of this work group.
  const parsed=parseProgressDocuments(data([mapping,...Array.from({length:PROGRESS_LIMITS.documentRows-1},()=>doc)]),query);
  assert.equal(parsed.coverage.limited,true);
  assert.deepEqual(parsed.documents[0].celex,['52021PC0206']);
  assert.equal(parsed.documents[0].url,null);
  assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/insights/procedure-progress?detail=documents'),parsed).cdnCacheControl,'no-store');
});
test('document event caps retain at most 300 events and preserve the sentinel without a work',()=>{
  const docRows=Array.from({length:301},(_,i)=>row(String(i).padStart(4,'0'),{work:u(work),celex:l('52021PC0206')}));
  for(const rows of [docRows,[...docRows.slice(0,300),row('0300')]]){
    const parsed=parseProgressDocuments(data([mapping,...rows]),query);
    assert.equal(parsed.documents.length,300);
    assert.equal(new Set(parsed.documents.map(d=>d.event)).size,300);
    assert.equal(parsed.coverage.limited,true);
    assert.equal(parsed.coverage.invalidRows,0);
    assert(parsed.documents.every(d=>d.url===null));
    assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/insights/procedure-progress?detail=documents'),parsed).cdnCacheControl,'no-store');
  }
  const sparql=progressSparql({...query,detail:'documents'});
  assert.match(sparql,/OPTIONAL \{ \?event cdm:event_legal_contains_work \?work\./);
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
for(const detail of ['events','documents'])test('malformed '+detail+' cannot replace good cached progress and recovery remains retryable',async()=>{
  let now=Date.parse('2026-10-20T10:00:00Z'),calls=0,malformed=false;
  const good=data([mapping,row('0001',{work:u(work),celex:l('52021PC0206')})]);
  const sources=new OfficialContextSources({directory:null,clock:()=>now,run:operation=>operation(),fetchSource:async()=>{calls++;return Response.json(malformed?{results:{bindings:null}}:good);}});
  const service=new ProcedureProgress(sources),selected={...query,detail},initial=await service.query(selected);
  now+=PROGRESS_LIMITS.freshMs+1;malformed=true;
  const stale=await service.query(selected);assert.equal(stale.source.fetchedAt,initial.source.fetchedAt);
  await Promise.allSettled([...sources.cache.pending.values()]);
  const retained=await service.query(selected);
  assert.equal(retained.source.stale,true);assert.equal(retained.source.refreshError,'Legislative progress could not be read.');
  assert.deepEqual(retained[detail],initial[detail]);assert.equal(calls,2);
  assert.equal(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/insights/procedure-progress'),retained).cdnCacheControl,'no-store');
  malformed=false;now+=60_001;
  await service.query(selected);await Promise.allSettled([...sources.cache.pending.values()]);
  const recovered=await service.query(selected);assert.equal(recovered.source.stale,false);assert.equal(recovered.source.refreshError,null);assert.equal(calls,3);
  assert.notEqual(recovered.source.fetchedAt,initial.source.fetchedAt);
  const cold=new OfficialContextSources({directory:null,run:operation=>operation(),fetchSource:async()=>Response.json(malformed?{results:{bindings:null}}:good)});
  const firstRead=new ProcedureProgress(cold);malformed=true;
  await assert.rejects(firstRead.query(selected),{code:'progress_source_shape'});
  malformed=false;assert.deepEqual((await firstRead.query(selected))[detail],initial[detail],'a rejected cold response is not cached for an hour');
});
test('progress transport caches only fresh complete mapped or explicit unmatched observations',()=>{
  const request={method:'GET',headers:{}},url=new URL('https://example.test/api/insights/procedure-progress?reference=2025%2F0223(COD)&lang=en');
  const result={state:'mapped',coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{stale:false,refreshError:null}};
  assert.deepEqual(apiCachePolicy(request,url,result),{cacheControl:'public, max-age=0',cdnCacheControl:'public, max-age=300, stale-if-error=0'});
  for(const changed of [{state:'ambiguous'},{coverage:{limited:true}},{coverage:{invalidRows:1}},{coverage:{incompleteEvents:1}},{source:{stale:true}},{source:{refreshError:'Failed'}}])assert.equal(apiCachePolicy(request,url,{...result,...changed}).cdnCacheControl,'no-store');
  assert.equal(apiCachePolicy({...request,headers:{authorization:'test'}},url,result).cacheControl,'no-store');
  assert.equal(apiCachePolicy({...request,method:'POST'},url,result).cacheControl,'no-store');
});

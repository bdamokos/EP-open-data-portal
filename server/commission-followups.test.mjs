import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CommissionFollowups,commissionFollowupsQuery,followupReaderLink} from './commission-followups.mjs';
import {cancelledRequest,runWithRequestSignal} from './request-budget.mjs';

const sample=JSON.parse(await readFile(new URL('./fixtures/commission-followup.json',import.meta.url),'utf8'));
const ta='TA-10-2025-0247',sp='SP-2026-05-11-TA-10-2025-0247';
const query={id:ta,language:'en'},ref=id=>'eli/dl/doc/'+id;
const adopted=(inverse=[ref(sp)])=>({id:ref(ta),identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',inverse_answers_to:inverse});
const reply=(id=sp)=>({...structuredClone(sample.payload.data[0]),id:ref(id),identifier:id});
function reader({taWork=adopted(),replies={},limits={},fail,stale=false}={}) {
  const reads=[],service=new CommissionFollowups({limits,request:async(endpoint,_params,options)=>{
    reads.push(endpoint);if(fail)await fail(endpoint);
    const payload={data:endpoint.startsWith('/adopted-texts/')?[taWork]:replies[endpoint.slice('/external-documents/'.length)]||[reply(endpoint.slice('/external-documents/'.length))]};
    options.validate(payload);
    return {payload,url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse(sample.retrievedAt),stale};
  }});return {service,reads};
}
test('query accepts only an exact adopted text and one language',()=>{
  assert.deepEqual(commissionFollowupsQuery(ta,new URLSearchParams('lang=hu')),{id:ta,language:'hu'});
  for(const [id,q] of [['B-10-2025-0247',''],[ta,'lang=en&lang=fr'],[ta,'ids='+sp],[ta,'url=https://example.org'],[ta,'lang=xx'],['TA-9-2025-0247','']])assert.throws(()=>commissionFollowupsQuery(id,new URLSearchParams(q)),{status:400});
});
test('retains exact source, expression language and three separate dates',async()=>{
  const {service,reads}=reader();const result=await service.query(query);
  assert.equal(result.status,'available');assert.equal(result.relationshipObservation,'observed');assert.equal(result.checkedCount,1);assert.equal(result.declaredCount,1);
  const item=result.items[0];assert.equal(item.id,sp);assert.equal(item.documentDate,'2026-05-11');assert.deepEqual(item.relationship,{from:sp,field:'answers_to',to:ta});
  assert.deepEqual(item.files.map(f=>[f.language,f.format]),[['fr','PDF'],['fr','DOCX'],['en','PDF'],['en','DOCX']]);
  assert.equal(item.files[2].url,'https://data.europarl.europa.eu/distribution/doc/'+sp+'_en.pdf');assert.equal(item.files[2].issued,'2026-06-10T16:53:54+02:00');assert.equal(item.source.fetchedAt,new Date(sample.retrievedAt).toISOString());
  await service.query(query);assert.equal(reads.length,2,'clean projection cached');
});
for(const [name,change] of [
  ['id',work=>work.id=ref('SP-other')],['identifier',work=>work.identifier='SP-other'],['type',work=>work.work_type='def/ep-document-types/REPORT_PLENARY'],['creator',work=>work.creator=['org/EU_PARLIAMENT']],['target',work=>work.answers_to=ref('TA-10-2025-0248')],['multiple targets',work=>work.answers_to=[ref(ta),ref('TA-10-2025-0248')]],
])test('withholds reply with mismatched '+name,async()=>{
  const work=reply();change(work);const {service,reads}=reader({replies:{[sp]:[work]}});
  const result=await service.query(query);assert.equal(result.items.length,0);assert.equal(result.status,'partial');assert.equal(result.gaps[0].reason,'record-unverified');await service.query(query);assert.equal(reads.length,4);
});
for(const nodes of [[],[reply(),reply()],[reply(),reply('SP-other')]])test('rejects absent, duplicate or extra returned work identities '+nodes.length,async()=>{
  const {service}=reader({replies:{[sp]:nodes}});assert.equal((await service.query(query)).items.length,0);
});
for(const [label,inverse,status,count,observation] of [['absent',undefined,'unavailable',null,'unobserved'],['null',null,'unavailable',null,'unobserved'],['empty',[],'none-listed',0,'observed'],['malformed','value','unavailable',null,'unobserved']])test('distinguishes '+label+' relationships',async()=>{
  const work=adopted();if(label==='absent')delete work.inverse_answers_to;else work.inverse_answers_to=inverse;
  const {service,reads}=reader({taWork:work});const result=await service.query(query);assert.equal(result.status,status);assert.equal(result.declaredCount,count);assert.equal(result.relationshipObservation,observation);assert.equal(reads.length,1);
});
test('opaque older IDs, canonical references, deduplication, non-SP gaps and date ordering',async()=>{
  const ids=['SP-2005-COM-old','SP-opaque'];const a=reply(ids[0]),b=reply(ids[1]);a.document_date='2026-06-01';b.document_date='2025-01-01';
  const {service,reads}=reader({taWork:adopted([ref(ids[0]),{id:'https://data.europarl.europa.eu/'+ref(ids[1])},ref(ids[0]),ref('COM-2026-1')]),replies:{[ids[0]]:[a],[ids[1]]:[b]}});
  const result=await service.query(query);assert.deepEqual(result.items.map(i=>i.id),[ids[1],ids[0]]);assert.equal(result.status,'partial');assert.equal(result.checkedCount,2);assert.equal(reads.length,3);assert(result.gaps.some(g=>g.reason==='unrecognised-relationship'));
});
test('unsafe and unsupported relationship tokens never cause reads',async()=>{
  const {service,reads}=reader({taWork:adopted(['https://evil.example/'+ref(sp),ref('SP--bad'),ref('SP-bad-'),ref('SP-../escape'),ref('SP-'+ 'a'.repeat(121)),42,{}])});
  const result=await service.query(query);assert.equal(reads.length,1);assert.equal(result.status,'partial');assert.equal(result.items.length,0);
});
test('four sequential reads, truncation and retained successful replies',async()=>{
  const ids=Array.from({length:6},(_,i)=>'SP-'+i),{service,reads}=reader({taWork:adopted(ids.map(ref))});
  const result=await service.query(query);assert.equal(result.checkedCount,4);assert.equal(reads.length,5);assert.equal(result.items.length,4);assert.equal(result.truncated,true);assert.equal(result.status,'partial');
});
test('metadata and response bounds retain only bounded projections',async()=>{
  for(const limits of [{metadataBytes:1000},{responseBytes:1800}]){const {service}=reader({limits});const result=await service.query(query);assert(result.truncated);assert.equal(result.status,'partial');assert(result.gaps.some(g=>g.reason.endsWith('-budget')));assert(Buffer.byteLength(JSON.stringify(result))<1800);}
});
test('one shared deadline keeps earlier replies when a later read stalls',async()=>{
  const {service}=reader({taWork:adopted([ref(sp),ref('SP-slow')]),limits:{timeout:40},fail:endpoint=>endpoint.endsWith('SP-slow')?new Promise(()=>{}):null});
  const keepAlive=setTimeout(()=>{},1000);
  try {const result=await service.query(query);assert.equal(result.items.length,1);assert(result.truncated);assert(result.gaps.some(g=>g.reason==='time-budget'));}finally{clearTimeout(keepAlive);}
});
test('absent and rejected files retain the verified reply with a gap',async()=>{
  for(const expressions of [undefined,[{id:ref(sp)+'/en',language:'ENG',is_embodied_by:[{id:'rejected',is_exemplified_by:'https://evil.example/file.pdf'}]}]]){
    const work=reply();work.is_realized_by=expressions;const {service}=reader({replies:{[sp]:[work]}});const result=await service.query(query);assert.equal(result.items.length,1);assert.deepEqual(result.items[0].files,[]);assert(result.gaps.some(g=>g.reason===(expressions?'file-rejected':'file-unavailable')));
  }
});
test('reader URLs reject unsafe paths, authorities and mismatched declarations',()=>{
  const path='distribution/doc/SP-old_en.pdf';assert.equal(followupReaderLink({is_exemplified_by:path}).format,'PDF');
  for(const url of ['http://data.europarl.europa.eu/'+path,'https://data.europarl.europa.eu:443/'+path,'https://user@data.europarl.europa.eu/'+path,'https://evil.example/'+path,path+'?x=1',path+'#x','distribution/doc/../file.pdf','distribution/doc/file%2fother.pdf','distribution/doc/file%2Epdf','distribution/doc/file\\x.pdf','distribution/doc/file\n.pdf','distribution/doc/file.rdf'])assert.equal(followupReaderLink({is_exemplified_by:url}),null,url);
  assert.equal(followupReaderLink({is_exemplified_by:path,format:'http://publications.europa.eu/resource/authority/file-type/DOCX'}),null);
  assert.equal(followupReaderLink({is_exemplified_by:path,media_type:'text/html'}),null);
});
test('a caller cancellation detaches without cancelling the shared owner',async()=>{
  let release;const barrier=new Promise(resolve=>release=resolve),{service,reads}=reader({fail:()=>barrier});
  const caller=new AbortController(),first=runWithRequestSignal(caller.signal,()=>service.query(query));const second=service.query(query);caller.abort(cancelledRequest());await assert.rejects(first,{code:'request_cancelled'});release();assert.equal((await second).items.length,1);assert.equal(reads.length,2);
});
test('lookup failures and stale sources never gain a projection TTL',async()=>{
  let failed=true;const {service,reads}=reader({fail:endpoint=>{if(failed&&endpoint.startsWith('/external-documents/'))throw Error('offline');}});
  assert((await service.query(query)).gaps.some(g=>g.reason==='lookup-failed'));failed=false;assert.equal((await service.query(query)).status,'available');assert.equal(reads.length,4);
  const stale=reader({stale:true});await stale.service.query(query);await stale.service.query(query);assert.equal(stale.reads.length,4);
});

test('ODP retains a verified reply after a rejected refresh and accepts recovery',async t=>{
  const {odp}=await import('./odp.mjs');
  const id='SP-cache-retention',endpoint='/external-documents/'+id;let phase='seed';
  t.mock.method(globalThis,'fetch',async()=>{
    const work=reply(id);if(phase==='bad')work.answers_to=ref('TA-10-2025-9999');if(phase==='recovery')work.document_date='2026-06-01';
    return Response.json({data:[work]});
  });
  const valid=payload=>{const work=payload.data[0];if(payload.data.length!==1||work.id!==ref(id)||work.identifier!==id||work.answers_to!==ref(ta))throw Error('unverified');};
  const saved=await odp(endpoint,{}, {validate:valid});phase='bad';await assert.rejects(odp(endpoint,{}, {validate:valid,force:true}),/unverified/);
  const retained=await odp(endpoint,{}, {validate:valid,cachedOnly:true});assert.deepEqual(retained.payload,saved.payload);assert.equal(retained.fetchedAt,saved.fetchedAt);
  const service=new CommissionFollowups({request:async(path,params,options)=>path.startsWith('/adopted-texts/')?{payload:{data:[adopted([ref(id)])]},fetchedAt:Date.now()}:odp(path,params,{...options,ttl:0})});
  const stale=await service.query(query);assert.equal(stale.items[0].documentDate,'2026-05-11');assert.equal(stale.items[0].source.stale,true);assert.equal(service.cache.size,0);
  phase='recovery';await odp(endpoint,{}, {validate:valid,force:true});const recovered=await service.query(query);assert.equal(recovered.items[0].documentDate,'2026-06-01');
});

test('TA source identities and type must match before relationship reads',async()=>{
  for(const change of [work=>work.identifier='TA-10-2025-9999',work=>work.id=ref('TA-10-2025-9999'),work=>work.work_type='def/ep-document-types/REPORT_PLENARY']){
    const work=adopted();change(work);const {service,reads}=reader({taWork:work});await assert.rejects(service.query(query),{code:'invalid_followup_source'});assert.equal(reads.length,1);
  }
});

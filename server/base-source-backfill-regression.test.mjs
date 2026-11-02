import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore} from './activity-index-store.mjs';
import {BaseSourceStore,retainBaseSelection} from './base-source-store.mjs';
import {BaseSourceBackfill,backfillJobs} from './base-source-backfill.mjs';
import {runBaseBackfill,backfillContext} from './base-source-backfill-context.mjs';
import {setRetentionForwarder} from './base-source-rpc.mjs';
import {CellarDocuments,CELLAR_DOCX_MIME,proposalCandidatesSparql} from './cellar-documents.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {createProposalBaseline} from './proposal-baseline.mjs';
import {resolveProposalTree} from './commission-proposal-identity.mjs';
import {RetainedInputs} from '../scripts/amendment-benchmark-retained.mjs';
import {createHash} from 'node:crypto';
const baseSourceKey=(url,request={})=>createHash('sha256').update(JSON.stringify([url,request.accept??null,request.language??null])).digest('hex');
import {amendmentSourceStore} from './amendment-source-store.mjs';
import {boundedUpstream,upstreamResponseError,upstreamPortServices} from './odp.mjs';
const CELLAR_RDF_ACCEPT='application/rdf+xml;notice=tree';
const at='2026-10-30T12:00:00.000Z',target='A-10-2026-0202';
const work='http://publications.europa.eu/resource/cellar/731e787f-f4fb-11ef-b7db-01aa75ed71a1';
function docx(){
 const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Fixture</w:t></w:r></w:p></w:body></w:document>');
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
 return Buffer.concat([local,name,body,central,name,end]);
}
async function fixture(t){
 t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected fixture request'));
 const root=await mkdtemp(path.join(os.tmpdir(),'base-delta-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const name of ['index','corpus','cache'])await mkdir(path.join(root,name));
 for(const file of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite']){const db=new DatabaseSync(path.join(root,file));db.exec('CREATE TABLE meta(key TEXT,value TEXT)');db.close();}
 const store=new ActivityStore(path.join(root,'writer-index'));assert(store.acquire());store.set('active',1);t.after(()=>store.close());
 const directory=path.join(root,'cache'),retention=new BaseSourceStore(path.join(directory,'base-sources-v1'));
 setRetentionForwarder(({observation,body})=>retention.save(observation,body));t.after(()=>setRetentionForwarder(null));
 const worker=new BaseSourceBackfill(store,{directory,retention,log:()=>{}});worker.hits=0;
 return {root,directory,retention,store,worker,context:{held:q=>worker.held(q),hit:()=>worker.hits++,full:false}};
}
function selection(decision){return {url:'base-selection:proposal:fixture',status:200,fetchedAt:at,request:{accept:'application/json'},selection:{type:'proposal',input:{reportId:target,language:'en',documentReferences:[]}}};}
for(const status of ['unavailable','partial'])test(`saved ${status} acquisition retries after restart, including omitted items`,async t=>{
 const f=await fixture(t);let now=1000,calls=0;
 const decision={status,celex:'52025PC0990',workId:work,items:[],gaps:[{code:'cellar_limited',itemId:work+'.0001.01/DOC_1'}]};
 await f.retention.save(selection(decision),Buffer.from(JSON.stringify(decision)));
 f.store.set('baseBackfillSeeded',true);
 const job={kind:'proposal',target,reportId:target,language:'en'};
 f.store.db.prepare('INSERT INTO base_backfill_jobs(key,target,body) VALUES (?,?,?)').run('retry',target,JSON.stringify(job));
 const options={directory:f.directory,retention:f.retention,clock:()=>now,log:()=>{},proposal:async()=>{calls++;return calls===1?decision:{status:'available',items:[{itemId:work+'.0001.01/DOC_1'}],gaps:[]};}};
 await new BaseSourceBackfill(f.store,options).step();assert.equal(calls,1);
 assert.equal(f.store.db.prepare('SELECT state FROM base_backfill_jobs').get().state,'pending');
 now+=300_001;
 const restarted=new BaseSourceBackfill(f.store,options);await restarted.step();assert.equal(calls,2);
 assert.equal(f.store.db.prepare('SELECT state FROM base_backfill_jobs').get().state,'done');assert.equal(restarted.due(),false);
});
test('verified amendment source bytes are adopted with their retrieval provenance and stop on capacity',async t=>{
 const f=await fixture(t),buffer=docx(),descriptor={url:'https://data.europarl.europa.eu/distribution/fixture/en.docx',language:'en',byteSize:buffer.length,issued:null};
 await amendmentSourceStore(f.store).save(descriptor,buffer,at);
 f.worker.read=async()=>({payload:{data:[{id:'eli/dl/doc/'+target,is_realized_by:[{language:'en',is_embodied_by:[{format:'DOCX',is_exemplified_by:descriptor.url,byteSize:buffer.length}]}]}]}});
 f.worker.download=()=>assert.fail('held bytes must not be fetched');
 await runBaseBackfill(f.context,()=>f.worker.collect({kind:'document',target,language:'en'}));
 const record=[...f.retention.records.values()][0]?.record;assert(record);assert.equal(record.fetchedAt,at);assert.equal(record.descriptor.format,'DOCX');
 const reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());
 const value=await reader.get(descriptor.url,{accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',language:'en'});assert.equal(value.ok,true);assert.deepEqual(value.body,buffer);
 f.worker.retention=new BaseSourceStore(path.join(f.directory,'full-base'),{maxBytes:1});f.context.full=false;
 await assert.rejects(runBaseBackfill(f.context,()=>f.worker.collect({kind:'document',target,language:'en'})),/storage full/);
 assert.equal(f.context.full,true);
});
for(const format of ['DOCX','XHTML'])test(`cached Cellar ${format} bytes are adopted without fetch, preserve time, and respect capacity`,async t=>{
 const f=await fixture(t),documents=new CellarDocuments({directory:path.join(f.directory,'commission-proposals-v1'),fetchSource:()=>assert.fail('cache hit fetched')}),buffer=format==='DOCX'?docx():Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Fixture</p></body></html>'),mime=format==='DOCX'?CELLAR_DOCX_MIME:'application/xhtml+xml';
 const item={celex:format==='DOCX'?'52025PC0990':'52025AG0001(01)',language:'http://publications.europa.eu/resource/authority/language/ENG',itemId:work+'.0001.01/DOC_1',expressionId:work+'.0001',manifestationId:work+'.0001.01'};
 const identity=JSON.stringify([item.celex,item.language,item.itemId,format.toLowerCase()]),key=(await import('node:crypto')).createHash('sha256').update(identity).digest('hex');
 const source={...item,schemaVersion:1,key,identity,format,url:item.itemId.replace('http:','https:'),resolvedSourceUrl:item.itemId.replace('http:','https:'),accept:mime,contentType:mime,fetchedAt:at,checkedAt:at,sha256:(await import('node:crypto')).createHash('sha256').update(buffer).digest('hex')};
 await mkdir(documents.directory,{recursive:true});await writeFile(path.join(documents.directory,key+'.json'),JSON.stringify(source));await writeFile(path.join(documents.directory,source.sha256+'.blob'),buffer);
 await runBaseBackfill(f.context,()=>documents.content({...item,format}));
 assert.equal(f.retention.records.size,1);assert.equal([...f.retention.records.values()][0].record.fetchedAt,at);
 const reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());assert.deepEqual((await reader.get(source.url,{accept:mime,language:'eng'})).body,buffer);
 const full=new BaseSourceStore(path.join(f.directory,'full-cellar'),{maxBytes:1});f.worker.retention=full;setRetentionForwarder(({observation,body})=>full.save(observation,body));await assert.rejects(runBaseBackfill(f.context,()=>documents.content({...item,format})),/storage full/);assert.equal(f.context.full,true);
});
// Synthetic route fixtures: exact requested report/proposal identifiers and row
// counts, with the existing small public RDF fixture as the distribution shape.
for(const [reportId,celex,count] of [['A-10-2026-0202','52025PC0990',108],['A-10-2026-0260','52026PC0510',41]])test(`${reportId}: ${count} rows retain cached RDF notice and native candidates for offline benchmark`,async t=>{
 const f=await fixture(t),xml=(await readFile(new URL('./fixtures/proposal-52025PC0087.rdf',import.meta.url),'utf8')).replaceAll('52025PC0087',celex).replace('>2025</ns2:resource_legal_internal_number_year>',`>${celex.slice(1,5)}</ns2:resource_legal_internal_number_year>`).replace('>87</ns2:resource_legal_internal_number_sequential_number>',`>${Number(celex.slice(-4))}</ns2:resource_legal_internal_number_sequential_number>`).replaceAll('COM_2025_0087','COM_'+celex.slice(1,5)+'_'+celex.slice(-4)).replaceAll('COM%282025%2987','COM%28'+celex.slice(1,5)+'%29'+Number(celex.slice(-4)));
 const report=JSON.parse(await readFile(new URL('./fixtures/proposal-report-reference.json',import.meta.url),'utf8')).report;
 report.id='eli/dl/doc/'+reportId;report.identifier=reportId;report.is_realized_by[0].title_alternative.en=report.is_realized_by[0].title_alternative.en.replace('COM(2025)0087',`COM(${celex.slice(1,5)})${celex.slice(-4)}`);
 const buffer=docx(),rdfUrl='https://publications.europa.eu/resource/celex/'+celex,finalUrl=work.replace('http:','https:')+'/rdf/tree/full';
 const sources=new OfficialContextSources({directory:path.join(f.directory,'official-context-v1'),fetchSource:()=>assert.fail('cached metadata fetched')});
 // Simulate metadata cached before #473. The normal route must adopt this XML.
 await sources.cache.save(sources.cache.key(['proposal-tree-v1',celex]),{url:rdfUrl,resolvedSourceUrl:finalUrl,fetchedAt:at,xml});
 const documents=new CellarDocuments({directory:path.join(f.directory,'commission-proposals-v1'),sources,fetchSource:async()=>new Response(buffer,{headers:{'content-type':CELLAR_DOCX_MIME}})});
 const candidatesUrl=new URL('https://publications.europa.eu/webapi/rdf/sparql');candidatesUrl.searchParams.set('query',proposalCandidatesSparql(celex));candidatesUrl.searchParams.set('format','application/sparql-results+json');
 const candidates={results:{bindings:[{work:{type:'uri',value:work},celex:{type:'literal',value:celex},version:{type:'literal',value:'final'}}]}};
 await sources.cache.save(sources.cache.key(['official-context-v1',candidatesUrl.href]),{url:candidatesUrl.href,fetchedAt:at,data:candidates});
 const route=createProposalBaseline({documents,request:async()=>({url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+reportId,fetchedAt:at,payload:{data:[report]}})});
 f.worker.proposal=route;
 const list={targetDocumentId:reportId,extraction:{language:'en',amendments:Array.from({length:count},(_,i)=>({number:i+1,originalText:'Before',proposedText:'After',baseline:'commission-proposal'}))}};
 assert.equal(list.extraction.amendments.length,count);
 const job=backfillJobs(list).find(j=>j.kind==='proposal');
 const identity=resolveProposalTree(xml,{celex,language:'en',procedure:'2025/0039(COD)'});
 await retainBaseSelection('proposal',{reportId,language:'en',documentReferences:[]},{status:'partial',celex,workId:work,items:identity.items.slice(0,1),gaps:[{code:'cellar_limited'}]},{directory:f.directory});
 const result=await runBaseBackfill(f.context,()=>f.worker.collect(job));assert.equal(result.status,'available',JSON.stringify(result.gaps));
 const reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());assert.deepEqual(reader.inventoryGaps,[]);
 const candidateResponse=await reader.get(candidatesUrl.href,{accept:'application/sparql-results+json'});assert.equal(candidateResponse.ok,true);assert.deepEqual(JSON.parse(candidateResponse.body),candidates);assert.equal(candidateResponse.retainedSource.provenance.representation,'cached-json-serialization');
 for(const url of [rdfUrl,finalUrl]){
  const key=baseSourceKey(url,{accept:CELLAR_RDF_ACCEPT});assert.equal(f.retention.records.get(key)?.record.request.language,undefined);
  assert.equal((await reader.get(url,{accept:CELLAR_RDF_ACCEPT})).body.toString(),xml);
  assert.equal((await reader.get(url,{accept:CELLAR_RDF_ACCEPT,language:'eng'})).acquisitionUnavailable,true);
 }
 for(const item of result.items)assert.deepEqual((await reader.get(item.itemId.replace('http:','https:'),{accept:CELLAR_DOCX_MIME,language:'eng'})).body,buffer);
 // A repeated backfill may neither re-download the candidate files nor invent
 // another RDF request or language-specific notice binding.
 documents.fetchSource=()=>assert.fail('held native candidate fetched');
 assert.equal((await runBaseBackfill(f.context,()=>f.worker.collect(job))).status,'available');
 assert.equal([...f.retention.records.values()].filter(r=>r.record.request.accept===CELLAR_RDF_ACCEPT).length,2);
 f.context.selection={...identity,items:[{...identity.items[0],expressionId:work+'.9999'}]};
 assert.deepEqual((await runBaseBackfill(f.context,()=>route(job))).gaps,['retained-selection-conflict']);
});
test('lane activates adaptive shared ODP admission and seeds Cellar pacing; 429 honors Retry-After',async()=>{
 const service=upstreamPortServices(),queues=['odp','https://publications.europa.eu'].map(s=>service.queueFor(s));
 try{
  await runBaseBackfill({},()=>boundedUpstream(()=>{}, {source:'odp',priority:'background'}));
  assert.equal(queues[0].adaptive,true);assert(queues[0].interval>0);
  assert(queues[1].interval>0);assert.equal(queues[1].adaptive,true);
  for(const [i,source] of ['odp','https://publications.europa.eu'].entries()){
   const before=queues[i].interval;
   upstreamResponseError(new Response(null,{status:429,headers:{'retry-after':'120'}}),{source});
   assert(queues[i].interval>before);assert(queues[i].cooldownUntil>=Date.now()+119_000);
  }
 }finally{for(const q of queues){clearTimeout(q.timer);q.timer=null;q.nextStart=0;q.cooldownUntil=0;}}
});

test('cached work-keyed RDF is adopted under its exact URL and language-free notice key',async t=>{
 const f=await fixture(t),celex='52025PC0087',url=work.replace('http:','https:')+'/rdf/tree/full',xml=await readFile(new URL('./fixtures/proposal-52025PC0087.rdf',import.meta.url),'utf8');
 const sources=new OfficialContextSources({directory:null,fetchSource:()=>assert.fail('cached work RDF fetched')});
 await sources.cache.save(sources.cache.key(['proposal-work-tree-v1',work,celex]),{url,resolvedSourceUrl:url,fetchedAt:at,xml});
 const documents=new CellarDocuments({directory:path.join(f.directory,'commission-proposals-v1'),sources});
 await runBaseBackfill(f.context,()=>documents.metadataByWork(work,{celex}));
 const reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());
 assert.equal((await reader.get(url,{accept:CELLAR_RDF_ACCEPT})).body.toString(),xml);
 assert.equal(f.retention.records.get(baseSourceKey(url,{accept:CELLAR_RDF_ACCEPT})).record.fetchedAt,at);
});

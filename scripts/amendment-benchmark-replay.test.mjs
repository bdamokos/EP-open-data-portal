import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {InputCache,allowedSource} from './amendment-benchmark-cache.mjs';
import {replayRuntime,sourceReplay,publicDocumentUrl} from './amendment-benchmark-replay.mjs';
import {acquireReport,evaluateReport,contextUrl} from './amendment-benchmark.mjs';
import {metrics,compareBaseline} from './amendment-benchmark-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),apiBase='https://explorer.example';
const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body>'+xml+'</w:body></w:document>'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
function fixture(commission=true,referenceOnly=false,omittedLanguage=false) {
  const document=(commission?'A':'B')+'-10-2026-0001',id=document+'-AM-1',listId=document+'-AM-001-001';
  const listUrl='https://data.europarl.europa.eu/distribution/test/'+document+'-list.docx',bodyUrl='https://data.europarl.europa.eu/distribution/test/'+document+'-body.docx';
  const row={id,targetDocumentId:document,number:1,listId,language:'en',baseline:'unknown',originalText:null,wordingSource:{url:listUrl},decisions:[{id:'vote',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const cell=value=>'<w:tc>'+p(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const list=docx(p('<Amend><NumAm>1</NumAm>')+(referenceOnly?p('<DocRef>COM(2026)1 final – 2026/0001(COD)</DocRef>'):'')+p('<Article>'+(commission?'Article 1 – paragraph 1':'Paragraph 1')+'</Article>')+'<w:tbl>'+tr(commission?'Text proposed by the Commission':'Motion for a resolution','Amendment')+tr('First paragraph.','Changed paragraph.')+'</w:tbl>'+p('</Amend>'));
  const language='http://publications.europa.eu/resource/authority/language/ENG',file={format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:bodyUrl};
  const work={id:'eli/dl/doc/'+document,identifier:document,work_type:'def/ep-document-types/'+(commission?'REPORT_PLENARY':'RESOLUTION_MOTION'),inverse_created_a_realization_of:['eli/dl/proc/2026-0001'],is_realized_by:[{language:omittedLanguage?'fr':language,title_alternative:referenceOnly?{}:{en:'COM(2026)1 final – 2026/0001(COD)'},is_embodied_by:[file]}]};
  const w='http://publications.europa.eu/resource/cellar/00000000-0000-0000-0000-000000000001',e=w+'.0001',m=e+'.01',item=m+'/DOC_1',celex='52026PC0001';
  const prop=(name,value,uri=false)=>`<c:${name}${uri?` r:resource="${value}"/>`:`>${value}</c:${name}>`}`;
  const desc=(id,body)=>`<r:Description r:about="${id}">${body}</r:Description>`;
  const rdf='<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:c="http://publications.europa.eu/ontology/cdm#" xmlns:o="http://www.w3.org/2002/07/owl#">'+
    desc(w,prop('resource_legal_id_celex',celex)+prop('work_created_by_agent','http://publications.europa.eu/resource/authority/corporate-body/COM',true)+prop('work_has_resource-type','http://publications.europa.eu/resource/authority/resource-type/PROP_REG',true)+prop('work_version','final')+prop('resource_legal_internal_number_year','2026')+prop('resource_legal_internal_number_sequential_number','1')+prop('act_preparatory_initiates_dossier','http://publications.europa.eu/resource/procedure/2026_1',true)+'<o:sameAs r:resource="http://publications.europa.eu/resource/comnat/COM_2026_0001_FIN"/>')+
    desc(e,prop('expression_belongs_to_work',w,true)+prop('expression_uses_language',language,true))+
    desc(m,prop('manifestation_manifests_expression',e,true)+prop('manifestation_type','docx'))+
    desc(item,prop('item_belongs_to_manifestation',m,true)+'<o:sameAs r:resource="http://example.org/synthetic_ACT_part1.docx"/>')+'</r:RDF>';
  const live={documentId:document,version:1,document:{selectedText:null,...(omittedLanguage?{selectedDocumentId:document,files:[{url:bodyUrl,language:'en',format:'DOCX'}]}:{})},proposal:null,baseline:null};
  const files=new Map([[listUrl,list],[bodyUrl,docx(['MOTION FOR A EUROPEAN PARLIAMENT RESOLUTION','The European Parliament,','1. First paragraph.','2. Second paragraph.','ANNEX'].map(p).join(''))],[publicDocumentUrl(document),{data:[work]}],[contextUrl(apiBase,document,'en'),live],[contextUrl(apiBase,document,'en',row,row),live]]);
  const fetcher=async(url,options)=>{
    if(files.has(url)){const value=files.get(url);return new Response(Buffer.isBuffer(value)?value:JSON.stringify(value),{headers:{'content-type':Buffer.isBuffer(value)?'application/octet-stream':'application/ld+json'}});}
    if(url.includes('/webapi/'))return new Response(JSON.stringify({results:{bindings:[{work:{type:'uri',value:w},celex:{type:'literal',value:celex},version:{type:'literal',value:'final'}}]}}),{headers:{'content-type':'application/sparql-results+json'}});
    if(url.endsWith('/celex/'+celex))return new Response(null,{status:303,headers:{location:w+'/rdf/tree/full'}});
    if(url.endsWith('/rdf/tree/full'))return new Response(rdf,{headers:{'content-type':'application/rdf+xml'}});
    if(url===item.replace('http:','https:')){assert.equal(options.headers['Accept-Language'],'eng');return new Response(docx([p('Article 1'),p('1. First paragraph.')].join('')),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'}});}
    throw new Error('Unexpected URL: '+url);
  };
  return {row,document,fetcher};
}
const sample={mode:'documents',asOf:'2026-10-27'};
test('offline replay improves proposal-parser outcomes on identical bytes despite empty outdated live projections',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:20,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));
  const manifest=cache.manifest();assert(manifest.some(m=>m.request?.accept==='application/rdf+xml;notice=tree'));assert(manifest.every(m=>m.sha256&&m.fetchedAt));assert.equal(cache.missing.size,0);
  const offline=new InputCache(directory,{apiBase,fetcher:()=>{throw new Error('Network forbidden');}});
  await offline.seal(manifest);
  const broken={...runtime,parseProposal:()=>{throw new Error('old parser');}};
  const before=await evaluateReport([f.row],sample,offline,{runtime:broken,replay:sourceReplay(offline,broken)});
  const identityChanged={...runtime,createProposalBaseline:()=>async()=>({status:'unresolved',items:[],gaps:['changed-identity-rule']})};
  const withheld=await evaluateReport([f.row],sample,offline,{runtime:identityChanged,replay:sourceReplay(offline,identityChanged)});
  assert.equal(withheld[0].outcome,'acquisition-unavailable');
  assert.deepEqual(offline.manifest(),manifest,'a producer reading fewer files retains the full sealed manifest');
  const after=await evaluateReport([f.row],sample,offline,{runtime,replay:sourceReplay(offline,runtime)});
  assert.equal(before[0].outcome,'withheld-pipeline');assert.equal(after[0].outcome,'correct',JSON.stringify(after[0].stages));assert.equal(offline.requests,0);
  assert.deepEqual(offline.manifest(),manifest);
  const report=rows=>({sample,snapshotId:'same',projectionMode:'cached-source-replay',inputs:manifest,compatibility:{compatible:false},rows,metrics:metrics(rows)});
  const baseline=report(before),candidate=report(after);baseline.code={producerFingerprint:{sha256:'old'}};candidate.code={producerFingerprint:{sha256:'new'}};
  const migration=structuredClone(baseline);migration.projectionMode='live-projection-comparison';assert.equal(compareBaseline(candidate,migration).failed,false);
  const result=compareBaseline(candidate,baseline,{placementOnly:true});assert.equal(result.failed,false);assert.equal(result.refused,undefined);assert.equal(result.deltas['counts.correct'],1);
  assert.throws(()=>compareBaseline({...candidate,inputs:[]},baseline),/hashes differ/);
  assert.equal(compareBaseline(baseline,candidate).regressions.length,1);
});
test('motion text and resolution selection use cached DOCX even when the live body is absent',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-motion-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(false),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:10,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));cache.fetchMissing=false;
  const [result]=await evaluateReport([f.row],sample,cache,{runtime,replay:sourceReplay(cache,runtime)});
  assert.equal(result.outcome,'correct',JSON.stringify(result.stages));assert.equal(result.stages.S5.span.start,2);
});
test('cache misses in the proposal reader abort instead of becoming source gaps',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-replay-missing-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),cache=new InputCache(directory,{apiBase});
  await assert.rejects(()=>sourceReplay(cache,runtime).proposal({celex:'52026PC0001',language:'en'}),/input-not-cached/);assert.equal(cache.requests,0);
  for(const url of ['https://eur-lex.europa.eu/x','https://publications.europa.eu/login','https://data.europarl.europa.eu/api/v2/meps'])assert.equal(allowedSource(url),false);
});

test('raw template references acquire proposals even when the report and live index omit COM identity',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-raw-ref-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(true,true),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:20,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));cache.fetchMissing=false;
  const [result]=await evaluateReport([f.row],sample,cache,{runtime,replay:sourceReplay(cache,runtime)});
  assert.equal(result.outcome,'correct',JSON.stringify(result.stages));
  assert(cache.manifest().some(m=>m.request?.accept==='application/rdf+xml;notice=tree'));
});

test('a CELLAR metadata request beyond the shared cap aborts the proposal reader',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-replay-cap-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:1,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await assert.rejects(()=>sourceReplay(cache,runtime).proposal({celex:'52026PC0001',language:'en'}),/request-cap-exhausted/);
  assert.equal(cache.requests,1);
});

test('transient 500 retries are capped and CELLAR metadata keeps the production byte bound',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-replay-bounds-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let calls=0;const url='https://publications.europa.eu/resource/celex/52026PC0001';
  const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:2,delay:0,sleep:async()=>{},fetcher:async()=>++calls===1?new Response('busy',{status:500}):new Response('rdf')});
  assert.equal((await cache.get(url,{accept:'application/rdf+xml;notice=tree',raw:true})).body.toString(),'rdf');
  assert.equal(cache.requests,2);assert.equal(cache.manifest().length,1);
  const oversized=new InputCache(directory,{apiBase,fetchMissing:true,cap:1,delay:0,sleep:async()=>{},fetcher:async()=>new Response('x'.repeat(3*1024*1024+1))});
  await assert.rejects(()=>oversized.get(url.replace('0001','0002'),{accept:'application/rdf+xml;notice=tree',raw:true}),/input-size-limit/);
  assert.equal(oversized.manifest().length,0);
});

test('a frozen manifest rejects even cached files outside its declared inputs',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-replay-seal-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const first=apiBase+'/api/amendments?offset=0',second=apiBase+'/api/amendments?offset=50';
  const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:2,delay:0,sleep:async()=>{},fetcher:async()=>new Response('{}')});
  await cache.get(first);const manifest=cache.manifest();await cache.get(second);
  const replay=new InputCache(directory,{apiBase});await replay.seal(manifest);
  await assert.rejects(()=>replay.get(second),/input-not-in-snapshot/);assert.equal(replay.requests,0);
});

test('motion extraction failures improve through checkout replay without new source requests',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-motion-parser-change-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(false),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:10,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));const manifest=cache.manifest();await cache.seal(manifest);const requests=cache.requests;
  const broken={...runtime,documentText:async()=>({status:'error',paragraphs:[],textLanguage:'en',reason:'synthetic extraction failure'})};
  const before=await evaluateReport([f.row],sample,cache,{runtime:broken,replay:sourceReplay(cache,broken)});
  assert.equal(before[0].outcome,'withheld-pipeline');assert.equal(before[0].stages.S4.projection.reason,'synthetic extraction failure');
  const after=await evaluateReport([f.row],sample,cache,{runtime,replay:sourceReplay(cache,runtime)});
  assert.equal(after[0].outcome,'correct');assert.equal(cache.requests,requests);
  const report=rows=>({sample,snapshotId:'frozen-motion',inputs:manifest,projectionMode:'cached-source-replay',rows,metrics:metrics(rows)});
  assert.equal(compareBaseline(report(after),report(before)).deltas['counts.correct'],1);
});

test('an exact frozen public file declaration supplements a missing metadata language without using live text',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-metadata-language-gap-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(false,false,true),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:10,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));await cache.seal(cache.manifest());
  const [result]=await evaluateReport([f.row],sample,cache,{runtime,replay:sourceReplay(cache,runtime)});
  assert.equal(result.outcome,'correct',JSON.stringify(result.stages));
  assert(result.stages.S4.gaps.includes('requested-language-omitted-by-current-EP-metadata'));
  assert.equal(result.stages.S4.projection.fileDeclarationSource.language,'en');
  assert.equal(result.stages.S4.projection.fileDeclarationSource.catalogue.url,contextUrl(apiBase,f.document,'en'));
});

test('translated-wording extraction helper retains the measured runtime on sealed replay',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-runtime-extractor-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(false),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:10,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));await cache.seal(cache.manifest());const requests=cache.requests;
  const broken={...runtime,extractAmendments:()=>{throw new Error('synthetic measured extractor failure');}};
  const [before]=await evaluateReport([f.row],sample,cache,{runtime:broken,replay:sourceReplay(cache,broken)});
  assert.equal(before.outcome,'withheld-pipeline');assert.equal(before.stages.S2.reason,'docx-parser-error');
  const [after]=await evaluateReport([f.row],sample,cache,{runtime,replay:sourceReplay(cache,runtime)});
  assert.equal(after.outcome,'correct');assert.equal(cache.requests,requests);
});

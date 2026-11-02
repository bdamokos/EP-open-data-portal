import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HybridInputs,compactHybridReceipt} from './amendment-benchmark-hybrid.mjs';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {replayRuntime,publicDocumentUrl,sourceReplay} from './amendment-benchmark-replay.mjs';
import {execFileSync} from 'node:child_process';
import {acquireReport,contextUrl,options} from './amendment-benchmark.mjs';
const apiBase='https://explorer.example',id='B-10-2026-0001',url='https://data.europarl.europa.eu/distribution/test/base.docx',wording=url.replace('base','wording');
const file={format:'DOCX',is_exemplified_by:url,byteSize:10,issued:'2026-01-01'},work={id:'eli/dl/doc/'+id,work_type:'def/ep-document-types/RESOLUTION_MOTION',is_realized_by:[{language:'en',is_embodied_by:[file]}]};
const record=(url,body,request)=>{body=Buffer.from(typeof body==='string'?body:JSON.stringify(body));return {url,status:200,ok:true,fetchedAt:'2026-10-27T00:00:00Z',bytes:body.length,sha256:digest(body),error:null,headers:{},...(request?{request}:{}),body};};
const gap=url=>({...record(url,''),status:null,ok:false,fetchedAt:null,error:'acquisition-unavailable',acquisitionUnavailable:true,acquisitionUnavailableReason:'not-retained'});
async function seal(directory,records){await mkdir(path.join(directory,'inputs'),{recursive:true});for(const {body,...meta} of records){const k=digest(meta.request?JSON.stringify([meta.url,meta.request]):meta.url);await writeFile(path.join(directory,'inputs',k+'.body'),body);await writeFile(path.join(directory,'inputs',k+'.json'),JSON.stringify(meta));}const manifest=records.map(({body,...m})=>m).sort((a,b)=>a.url.localeCompare(b.url,'en')),sample={asOf:'2026-10-27'};const snapshot={schemaVersion:3,apiBase,asOf:sample.asOf,sample,manifest,snapshotId:digest(JSON.stringify({apiBase,sample,manifest}))};await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot));return snapshot;}
async function tree(directory){return Promise.all((await readdir(directory,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(async f=>[path.join(f.parentPath,f.name),digest(await readFile(path.join(f.parentPath,f.name)))]));}
async function fixture(t,change=()=>{},copy=work){const root=await mkdtemp(path.join(os.tmpdir(),'hybrid-'));t.after(()=>rm(root,{recursive:true,force:true}));const a=path.join(root,'a'),b=path.join(root,'b'),out=path.join(root,'out');const old=structuredClone(work);change(old);const metadata=w=>record(publicDocumentUrl(id),{data:[w]},{accept:'application/ld+json'});const sa=await seal(a,[metadata(copy),gap(url),record(wording,'COPY')]),sb=await seal(b,[metadata(old),record(url,'OLD BASE'),record(wording,'OLD WORDING')]);const before=await Promise.all([tree(a),tree(b)]),h=await HybridInputs.open(a,b,out);h.runtime=await replayRuntime(path.resolve('.'));await mkdir(out);const cache=new InputCache(out,{apiBase,cap:0,retained:h,fetcher:()=>{throw Error('fetch forbidden');}});const identity={type:'ep-document',documentId:id,file:{url,language:'en',format:'DOCX'}};return {a,b,out,h,cache,identity,sa,sb,before};}
test('exact settled fallback seals and replays original chronology and per-row provenance without source writes',async t=>{const f=await fixture(t);f.h.trackRows([{id:id+'-AM-1',listId:'list',language:'en',wordingSource:{url:wording}}]);const input=await f.h.baseScope(f.identity,()=>f.cache.get(url));assert.equal(input.body.toString(),'OLD BASE');assert.equal(input.hybridSource.snapshotId,f.sb.snapshotId);assert.equal(input.fetchedAt,'2026-10-27T00:00:00Z');await f.cache.get(wording);const manifest=f.cache.manifest();await f.cache.seal(manifest);const offline=new InputCache(f.out,{apiBase,cap:0,fetcher:()=>{throw Error('fetch forbidden');}});await offline.seal(manifest);assert.equal((await offline.get(url)).body.toString(),'OLD BASE');assert.equal(f.cache.requests,0);assert.equal(f.h.receipt().rows[id+'-AM-1'].inputs.length,2);assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),f.before);});
for(const [name,change] of [['type',w=>w.work_type='def/ep-document-types/AMENDMENT_LIST'],['edition',w=>w.epNumberVersion='2'],['hash',w=>w.is_realized_by[0].is_embodied_by[0].sha256='a'.repeat(64)],['id',w=>w.id+='9'],['language',w=>w.is_realized_by[0].language='fr'],['URL',w=>w.is_realized_by[0].is_embodied_by[0].is_exemplified_by+='x'],['descriptor',w=>w.is_realized_by[0].is_embodied_by[0].issued='2026-02-01'],['ambiguous',w=>w.is_realized_by.push(w.is_realized_by[0])]])test('rejects different '+name,async t=>{const f=await fixture(t,change,name==='edition'?{...work,epNumberVersion:'1'}:work),input=await f.h.baseScope(f.identity,()=>f.cache.get(url));assert.equal(input.acquisitionUnavailable,true);assert.equal(input.hybridSource.reason,name==='hash'?'base-source-hash-mismatch':'base-identity-mismatch');});
test('copy bytes and wording gaps win over older bodies, including dual-role report URL',async t=>{const f=await fixture(t);assert.equal((await f.h.baseScope(f.identity,()=>f.cache.get(wording))).body.toString(),'COPY');f.h.registerWording({wordingSource:{url}});const input=await f.h.baseScope(f.identity,()=>f.cache.get(url));assert.equal(input.acquisitionUnavailable,true);assert.equal(input.hybridSource.snapshotId,f.sa.snapshotId);});
test('unscoped, missing-both and absent frozen requests remain distinct acquisition gaps',async t=>{const f=await fixture(t);assert.equal((await f.cache.get(url)).acquisitionUnavailable,true);const other=url.replace('base','missing');assert.equal((await f.h.baseScope(f.identity,()=>f.cache.get(other))).acquisitionUnavailable,true);await f.cache.seal(f.cache.manifest());assert.equal((await f.cache.get(url.replace('base','unsealed'))).acquisitionUnavailableReason,'frozen-input-absent');f.cache.assertHealthy();});
test('source metadata hash tampering and overlapping outputs are rejected',async t=>{const f=await fixture(t);await assert.rejects(()=>HybridInputs.open(f.a,f.b,path.join(f.a,'nested')),/separate/);await assert.rejects(()=>HybridInputs.open(f.a,f.b,path.join(path.dirname(f.out),'new'),f.b),/separate/);const k=digest(publicDocumentUrl(id));void k;const m=f.sb.manifest.find(m=>m.url===url);await writeFile(path.join(f.b,'inputs',digest(url)+'.body'),'changed');await assert.rejects(()=>f.h.baseScope(f.identity,()=>f.cache.get(url)),/hash mismatch/);assert(m);});
test('CLI requires both sources and offline acquire-only mode',()=>{const args=['--hybrid-snapshot','a','--base-snapshot','b','--acquire-only','--request-cap','0'];assert.equal(options(args).cap,0);for(const extra of [['--fetch'],['--production-data-dir','x'],['--language-variants']])assert.throws(()=>options([...args,...extra]),/Hybrid/);assert.throws(()=>options(['--hybrid-snapshot','a']),/Hybrid/);});

test('normal CLI acquisition seals hybrid with copy catalogue, per-row inputs, and replay-only evaluation',async t=>{
  const f=await fixture(t),row={id:id+'-AM-1',targetDocumentId:id,number:1,listId:'list',language:'en',decisions:[{id:'vote',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://example.org/vote',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const catalogue=apiBase+'/api/amendments?limit=50&offset=0&lang=en&document='+id;
  const context=apiBase+'/api/document-context/'+id+'?lang=en';
  const records=[record(catalogue,{items:[row],total:1,offset:0,limit:50,coverage:{servingGeneration:21}}),record(context,{documentId:id,document:{},baseline:null}),record(context+'&amendment='+id+'-AM-1&list=list&wording-lang=en',{documentId:id,document:{},baseline:null}),record(publicDocumentUrl(id),{data:[work]},{accept:'application/ld+json'}),gap(url)];
  const saved=await seal(f.a,records);saved.sample={term:10,asOf:'2026-10-27',mode:'documents',documents:[id],decisionBasis:'indexed-plenary-decision-date',variantPolicy:'one exact variant per amendment: English, then language code, then list ID',indexGeneration:21,indexedAmendments:1};saved.snapshotId=digest(JSON.stringify({apiBase,sample:saved.sample,manifest:saved.manifest}));await writeFile(path.join(f.a,'snapshot.json'),JSON.stringify(saved));
  const destination=path.join(path.dirname(f.out),'cli'),args=['scripts/amendment-benchmark.mjs','--api-base',apiBase,'--cache-dir',destination,'--document',id,'--request-cap','0'];
  const result=JSON.parse(execFileSync(process.execPath,[...args,'--hybrid-snapshot',f.a,'--base-snapshot',f.b,'--acquire-only'],{encoding:'utf8'}));assert.equal(result.requests,0);assert.equal(result.hybrid.fallback,1);
  const snapshot=JSON.parse(await readFile(path.join(destination,'snapshot.json')));assert.equal(snapshot.sample.indexGeneration,21);assert.equal(snapshot.hybrid.rows[row.id].catalogue,saved.snapshotId);assert(snapshot.hybrid.rows[row.id].inputs.some(i=>i.snapshotId===f.sb.snapshotId));
  snapshot.hybrid.rows[row.id].inputs[0].identity={proof:'x'.repeat(100000)};await writeFile(path.join(destination,'snapshot.json'),JSON.stringify(snapshot));const frozen=await readFile(path.join(destination,'snapshot.json'));
  const replay=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));assert.equal(replay.acquisition.requests,0);const report=JSON.parse(await readFile(replay.jsonPath));assert(report.rows[0].inputProvenance);assert.equal(report.rows.length,1);assert.equal(report.rows[0].inputProvenance.inputs[0].identity,undefined);assert.equal(report.hybrid.rows[row.id].inputs[0].identity,undefined);assert(report.inputs.some(m=>m.hybridSource?.identity));assert.deepEqual(await readFile(path.join(destination,'snapshot.json')),frozen);
});

const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body>'+xml+'</w:body></w:document>'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
function proposalFixture(commission=true,referenceOnly=false,omittedLanguage=false,reportWording=false) {
  const document=(commission?'A':'B')+'-10-2026-0001',id=document+'-AM-1',listId=document+'-AM-001-001';
  const listUrl='https://data.europarl.europa.eu/distribution/test/'+document+'-list.docx',bodyUrl='https://data.europarl.europa.eu/distribution/test/'+document+'-body.docx';
  const row={id,targetDocumentId:document,number:1,listId,language:'en',baseline:'unknown',originalText:null,wordingSource:{url:listUrl},decisions:[{id:'vote',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const cell=value=>'<w:tc>'+p(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  if(reportWording)row.wordingSource.reportId=document;
  const list=docx((reportWording?p('<NoDocSe>A10-0001/2026</NoDocSe>')+p('<RepeatBlock-Amend>'):'')+p('<Amend><NumAm>1</NumAm>')+(referenceOnly?p('<DocRef>COM(2026)1 final – 2026/0001(COD)</DocRef>'):'')+p('<Article>'+(commission?'Article 1 – paragraph 1':'Paragraph 1')+'</Article>')+'<w:tbl>'+tr(commission?'Text proposed by the Commission':'Motion for a resolution','Amendment')+tr('First paragraph.','Changed paragraph.')+'</w:tbl>'+p('</Amend>')+(reportWording?p('</RepeatBlock-Amend>'):''));
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

for(const wrongReference of [false,true,'compact'])test('canonical Cellar chain '+(wrongReference===true?'rejects a different exact proposal':wrongReference==='compact'?'uses recorded raw metadata when compact references are missing':'seals only anchored discovery and native dependencies'),async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hybrid-cellar-'));t.after(()=>rm(root,{recursive:true,force:true}));const runtime=await replayRuntime(path.resolve('.')),f=proposalFixture(),sample={mode:'documents',asOf:'2026-10-27'},b=path.join(root,'b'),a=path.join(root,'a'),out=path.join(root,'out');
  await mkdir(b);const capture=new InputCache(b,{apiBase,fetchMissing:true,cap:30,delay:0,sleep:async()=>{},fetcher:f.fetcher});await acquireReport([f.row],sample,capture,sourceReplay(capture,runtime));
  const records=[];for(const meta of capture.manifest()){const input=await capture.get(meta.url,{...meta.request,raw:true});records.push(input);}
  await seal(b,records);
  const copy=records.filter(r=>!r.url.startsWith('https://publications.europa.eu'));
  if(wrongReference==='compact'){const metadata=copy.find(r=>r.url===publicDocumentUrl(f.document)),payload=JSON.parse(metadata.body);for(const e of payload.data[0].is_realized_by)delete e.title_alternative;Object.assign(metadata,record(metadata.url,payload,metadata.request),{status:null,fetchedAt:null,localProjection:{representation:'retained-index-projection',sourceFetchedAt:'2026-11-01T00:00:00Z'}});}
  if(wrongReference===true){const metadata=copy.find(r=>r.url===publicDocumentUrl(f.document));const w=JSON.parse(metadata.body);w.data[0].is_realized_by[0].title_alternative.en='COM(2026)2 final – 2026/0002(COD)';Object.assign(metadata,record(metadata.url,w,metadata.request));}
  await seal(a,copy);const h=await HybridInputs.open(a,b,out);h.runtime=runtime;h.trackRows([f.row]);await mkdir(out);const cache=new InputCache(out,{apiBase,retained:h,cap:0,fetcher:()=>{throw Error('fetch forbidden');}});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));await cache.seal(cache.manifest());assert.equal(cache.requests,0);
  const fallback=cache.manifest().filter(r=>r.hybridSource.reason==='settled-base-fallback'&&r.url.startsWith('https://publications.europa.eu'));
  if(wrongReference===true){assert.equal(fallback.length,0);}else{assert(fallback.some(r=>r.hybridSource.identity.method==='candidates'));assert(fallback.some(r=>r.hybridSource.identity.method==='content'));assert(fallback.every(r=>r.hybridSource.identity.arguments.some(arg=>JSON.stringify(arg).includes('52026PC0001'))));}
});

for(const kind of ['council','existingLaw'])test('exact '+kind+' direct discovery uses B, while unrelated retained discovery stays unavailable',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hybrid-discovery-'));t.after(()=>rm(root,{recursive:true,force:true}));const runtime=await replayRuntime(path.resolve('.')),reportId='A-10-2026-0001',report={id:'eli/dl/doc/'+reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2026-0001'],is_realized_by:[{language:'en',title_alternative:{en:'12345/1/2026 – 2026/0001(COD)'}}]},opts=kind==='council'?{reportId,language:'en'}:{language:'en',documentDate:'2026-09-09',targetPath:{underlying:[{document:'32023R0956',raw:'Article 1'}]},documentReferences:[]};
  const identity=kind==='council'?runtime.reportCouncilReference(report,opts):runtime.existingLawReference(opts);assert.equal(identity.status,'resolved');const query=kind==='council'?runtime.councilCandidatesSparql(identity):runtime.consolidationsSparql(identity.baseCelex,opts.language),url=new URL('https://publications.europa.eu/webapi/rdf/sparql');url.searchParams.set('query',query);url.searchParams.set('format','application/sparql-results+json');
  const a=path.join(root,'a'),b=path.join(root,'b'),out=path.join(root,'out'),metadata=record(publicDocumentUrl(reportId),{data:[report]},{accept:'application/ld+json'});await seal(a,[metadata]);await seal(b,[metadata,record(url.href,{results:{bindings:[]}},{accept:'application/sparql-results+json'})]);const h=await HybridInputs.open(a,b,out);h.runtime=runtime;await mkdir(out);const cache=new InputCache(out,{apiBase,retained:h,cap:0,fetcher:()=>{throw Error('fetch forbidden');}});await sourceReplay(cache,runtime)[kind](opts);const discovery=cache.manifest().find(m=>m.url===url.href);assert.equal(discovery.hybridSource.reason,'settled-base-fallback');assert.equal(discovery.hybridSource.identity.method,kind==='council'?'council-discovery':'existing-law-discovery');assert.equal(discovery.hybridSource.identity.arguments[0].language,'en');
  const other=url.href+'&unrelated=1',missing=await h.baseScope(discovery.hybridSource.identity,()=>cache.get(other,{accept:'application/sparql-results+json'}));assert.equal(missing.acquisitionUnavailable,true);assert.equal(missing.hybridSource.reason,'base-identity-mismatch');assert.equal(cache.requests,0);await cache.seal(cache.manifest());
});

test('EP base fallback follows only its recorded official redirect chain',async t=>{
  const f=await fixture(t),redirectUrl='https://redmapl3.europarl.europa.eu/RedmapFront/media/test/base.docx',other=redirectUrl.replace('base','other');
  const records=await Promise.all(f.sb.manifest.filter(m=>m.url!==url).map(m=>f.h.b.read(m.url,m.request)));
  const redirect={...record(url,''),status:302,ok:false,error:'HTTP 302',headers:{location:redirectUrl},redirectUrl};
  const b=await seal(f.b,[...records,redirect,record(redirectUrl,'OLD BASE'),record(other,'UNRELATED')]);
  const before=await Promise.all([tree(f.a),tree(f.b)]),h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;
  const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('no network')});
  const input=await h.baseScope(f.identity,()=>cache.get(url));assert.equal(input.body.toString(),'OLD BASE');assert.equal(input.resolvedSourceUrl,redirectUrl);assert.equal(input.hybridSource.snapshotId,b.snapshotId);assert.equal(input.hybridSource.identity.proof.redirects[0].url,url);
  const wrong=await h.baseScope(f.identity,()=>cache.get(other,{officialRedirect:true}));assert.equal(wrong.acquisitionUnavailable,true);assert.equal(wrong.hybridSource.reason,'base-identity-mismatch');
  await cache.seal(cache.manifest());assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),before);assert.equal(cache.requests,0);
});
test('hybrid discovery preserves canonical unavailable results for invalid existing-act queries',async t=>{
  const f=await fixture(t),opts={language:'en',documentDate:'2026-09-09',targetPath:{underlying:[{document:'Regulation No 1/58',raw:'Article 1'}]},documentReferences:[]};
  assert.equal(f.h.runtime.existingLawReference(opts).status,'resolved');
  const result=await sourceReplay(f.cache,f.h.runtime).existingLaw(opts);assert.equal(result.baseline.status,'unresolved');assert(result.baseline.gaps.includes('invalid_existing_law_celex'));assert.equal(f.cache.requests,0);assert.equal(f.cache.manifest().length,0);
});

for(const conflict of [false,true])test('compact EP declarations '+(conflict?'reject an observed edition conflict':'match rich declarations without inventing omitted edition facts'),async t=>{
 const f=await fixture(t,w=>{w.epNumberVersion='0200';Object.assign(w.is_realized_by[0].is_embodied_by[0],{id:'eli/dl/doc/'+id+'/en/docx',type:'Manifestation',media_type:'https://www.iana.org/assignments/media-types/application/vnd.openxmlformats-officedocument.wordprocessingml.document'});});
 const records=await Promise.all(f.sa.manifest.map(m=>f.h.a.read(m.url,m.request))),metadata=records.find(r=>r.url===publicDocumentUrl(id));
 if(conflict){const payload=JSON.parse(metadata.body);payload.data[0].epNumberVersion='0100';Object.assign(metadata,record(metadata.url,payload,metadata.request));}
 metadata.status=null;metadata.fetchedAt=null;metadata.localProjection={representation:'retained-index-projection',generation:21,sourceFetchedAt:'2026-10-27T00:00:00Z'};await seal(f.a,records);
 const before=await Promise.all([tree(f.a),tree(f.b)]),h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('no network')});
 const input=await h.baseScope(f.identity,()=>cache.get(url));
 if(conflict)assert.equal(input.acquisitionUnavailable,true);else{assert.equal(input.body.toString(),'OLD BASE');assert.deepEqual(input.hybridSource.identity.proof.declaration.edition,{copy:{},base:{epNumberVersion:'0200'}});}
 assert.equal(cache.requests,0);assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),before);
});

test('one-sided optional size, date and edition evidence stays unknown while exact identity remains required',async t=>{
 const copy=structuredClone(work);delete copy.is_realized_by[0].is_embodied_by[0].byteSize;delete copy.is_realized_by[0].is_embodied_by[0].issued;copy.epNumberVersion='0200';
 const f=await fixture(t,()=>{},copy),input=await f.h.baseScope(f.identity,()=>f.cache.get(url));assert.equal(input.body.toString(),'OLD BASE');
 const proof=input.hybridSource.identity.proof.declaration;assert.equal(proof.descriptor.copy.byteSize,null);assert.equal(proof.descriptor.base.byteSize,10);assert.deepEqual(proof.edition,{copy:{epNumberVersion:'0200'},base:{}});assert.equal(f.cache.requests,0);
});

test('raw null publisher size stays unknown instead of the canonical numeric zero',async t=>{
 const copy=structuredClone(work);copy.is_realized_by[0].is_embodied_by[0].byteSize=null;
 const f=await fixture(t,()=>{},copy),input=await f.h.baseScope(f.identity,()=>f.cache.get(url));assert.equal(input.body.toString(),'OLD BASE');
 assert.equal(input.hybridSource.identity.proof.declaration.descriptor.copy.byteSize,null);assert.equal(f.cache.requests,0);
});
for(const corrupt of [false,true])test('native hashes validate final bytes after a nonempty cached redirect'+(corrupt?' and reject corrupt targets':''),async t=>{
 const f=await fixture(t),redirectUrl='https://redmapl3.europarl.europa.eu/RedmapFront/media/test/base.docx',hash=digest(Buffer.from('OLD BASE'));
 const withHash=records=>records.map(r=>{if(r.url!==publicDocumentUrl(id))return r;const payload=JSON.parse(r.body);payload.data[0].is_realized_by[0].is_embodied_by[0].sha256=hash;return record(r.url,payload,r.request);});
 await seal(f.a,withHash(await Promise.all(f.sa.manifest.map(m=>f.h.a.read(m.url,m.request)))));
 const records=withHash(await Promise.all(f.sb.manifest.filter(m=>m.url!==url).map(m=>f.h.b.read(m.url,m.request))));
 const redirect={...record(url,'<html>Moved</html>'),status:302,ok:true,headers:{location:redirectUrl},redirectUrl};await seal(f.b,[...records,redirect,record(redirectUrl,corrupt?'CORRUPT':'OLD BASE')]);
 const before=await Promise.all([tree(f.a),tree(f.b)]),h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('no network')});
 const input=await h.baseScope(f.identity,()=>cache.get(url));
 if(corrupt){assert.equal(input.acquisitionUnavailable,true);assert.equal(input.hybridSource.reason,'base-source-hash-mismatch');}else{assert.equal(input.body.toString(),'OLD BASE');assert.equal(input.sha256,hash);assert.equal(input.resolvedSourceUrl,redirectUrl);}
 assert.equal(cache.requests,0);assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),before);
});

for(const conflict of [false,true])test('compact metadata preserves compatible raw B declarations and chronology'+(conflict?' but blocks edition conflicts':''),async t=>{
 const f=await fixture(t),records=await Promise.all(f.sa.manifest.map(m=>f.h.a.read(m.url,m.request))),m=records.find(r=>r.url===publicDocumentUrl(id));
 const payload=JSON.parse(m.body);if(conflict)payload.data[0].epNumberVersion='1';
 Object.assign(m,record(m.url,payload,m.request),{status:null,fetchedAt:null,localProjection:{representation:'retained-index-projection',sourceFetchedAt:'2026-11-01T00:00:00Z'}});
 const old=await Promise.all(f.sb.manifest.map(m=>f.h.b.read(m.url,m.request))),bm=old.find(r=>r.url===publicDocumentUrl(id)),bw=JSON.parse(bm.body);bw.data[0].epNumberVersion='2';Object.assign(bm,record(bm.url,bw,bm.request));
 await seal(f.a,records);await seal(f.b,old);const h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;
 const found=await h.get(m.url,m.request);assert.equal(found.status,conflict?null:200);assert.equal(found.fetchedAt,conflict?null:'2026-10-27T00:00:00Z');assert.equal(found.hybridSource.reason,conflict?'copy-input':'settled-base-metadata');
 if(!conflict){assert.deepEqual(found.body,bm.body);assert.equal(found.hybridSource.identity.copyObservation.sha256,m.sha256);}
});

for(const conflict of ['none','id','listId','language','url','hash'])test('missing wording uses only exact frozen catalogue bindings: '+conflict,async t=>{
 const f=await fixture(t),row={id:id+'-AM-1',targetDocumentId:id,number:1,listId:id+'-AM-001-001',language:'en',wordingSource:{url,sha256:digest(Buffer.from('OLD BASE'))}};
 const old=structuredClone(row);if(conflict==='hash')old.wordingSource.sha256='a'.repeat(64);else if(conflict==='url')old.wordingSource.url+='x';else if(conflict!=='none')old[conflict]+='x';
 const catalogue=apiBase+'/api/amendments?limit=50&offset=0';const records=await Promise.all(f.sb.manifest.map(m=>f.h.b.read(m.url,m.request)));await seal(f.b,[...records,record(catalogue,{items:[old]})]);
 const h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;h.trackRows([row]);const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('transport forbidden')});
 const input=await cache.get(url);assert.equal(Boolean(input.acquisitionUnavailable),conflict!=='none');if(conflict==='none'){assert.equal(input.body.toString(),'OLD BASE');assert.equal(input.hybridSource.reason,'settled-wording-fallback');}assert.equal(cache.requests,0);
});

test('row provenance references preserve source keys while full identity proofs remain once in the manifest',async t=>{
 const f=await fixture(t);f.h.trackRows([{id:id+'-AM-1',targetDocumentId:id,listId:'list',language:'en',wordingSource:{url:wording}}]);
 await f.h.baseScope(f.identity,()=>f.cache.get(url));const manifest=f.cache.manifest(),input=manifest.find(m=>m.url===url),reference=f.h.receipt().rows[id+'-AM-1'].inputs.find(m=>m.url===url);
 assert(input.hybridSource.identity.proof);assert.equal(reference.identity,undefined);assert.equal(reference.url,input.url);assert.equal(reference.sha256,input.sha256);assert.equal(reference.snapshotId,input.hybridSource.snapshotId);
 const legacy={...f.h.receipt(),rows:{example:{inputs:[{...reference,identity:{proof:'x'.repeat(100000)}}]}}},before=JSON.stringify(legacy),compact=compactHybridReceipt(legacy);
 assert.equal(compact.rows.example.inputs[0].identity,undefined);assert.deepEqual(compact.rows.example.inputs[0],reference);assert.equal(JSON.stringify(legacy),before);assert.deepEqual(compactHybridReceipt(compact),compact);assert(JSON.stringify(compact).length<1000);
});

for(const conflict of ['none','url','edition'])test('sparse shared Czech metadata proves report edition but historical languages stay scoped: '+conflict,async t=>{
 const f=await fixture(t),copy=structuredClone(work);copy.is_realized_by[0].language='cs';if(conflict==='edition')copy.epNumberVersion='1';
 const old=structuredClone(copy);old.epNumberVersion='2';if(conflict==='url')old.is_realized_by[0].is_embodied_by[0].is_exemplified_by+='other';old.is_realized_by.push({language:'ro',is_embodied_by:[{...file,is_exemplified_by:url+'.ro'}]});
 const request={accept:'application/ld+json'},m={...record(publicDocumentUrl(id),{data:[copy]},request),status:null,fetchedAt:null,localProjection:{representation:'retained-index-projection'}};
 await seal(f.a,[m,gap(url)]);await seal(f.b,[record(m.url,{data:[old]},request),record(url+'.ro','HISTORICAL')]);const h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;
 assert.equal(Boolean(await h.metadataProof(m)),conflict==='none');assert.equal(await h.epProof({documentId:id,file:{url:url+'.ro',language:'ro'}}),null);
});
for(const mode of ['good','legacy','corrupt','wrong-id','alias','missing','unapproved','four-hops'])test('identity-bound wording redirects: '+mode,async t=>{
 const f=await fixture(t),target='https://redmapl3.europarl.europa.eu/RedmapFront/media/test/wording.docx',hash=digest(Buffer.from('OLD BASE'));
 const row={id:id+'-AM-1',targetDocumentId:id,number:1,listId:id+'-AM-001-001',language:'en',wordingSource:{url,sha256:hash}},old=structuredClone(row);if(mode==='wrong-id')old.id+='x';
 const catalogue=apiBase+'/api/amendments?limit=50',redirect=(from,to)=>({...record(from,''),status:302,ok:false,headers:{location:to},redirectUrl:to});
 let chain=[redirect(url,mode==='unapproved'?'https://example.org/wording.docx':target),record(target,mode==='corrupt'?'CORRUPT':'OLD BASE')];
 if(mode==='legacy')delete chain[0].headers;if(mode==='missing')chain.pop();if(mode==='four-hops')chain=[redirect(url,target),redirect(target,target+'1'),redirect(target+'1',target+'2'),redirect(target+'2',target+'3'),record(target+'3','OLD BASE')];
 await seal(f.b,[record(catalogue,{items:[old]}),...chain,record(target.replace('.docx','-alias.docx'),'OLD BASE')]);const before=await Promise.all([tree(f.a),tree(f.b)]),h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;h.trackRows([row]);const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('zero requests')});
 const input=await cache.get(mode==='alias'?target.replace('.docx','-alias.docx'):url,{officialRedirect:true});assert.equal(Boolean(input.acquisitionUnavailable),!['good','legacy'].includes(mode));if(['good','legacy'].includes(mode)){assert.equal(input.sha256,hash);assert.equal(input.hybridSource.identity.proof.redirects[0].status,302);assert.equal(input.resolvedSourceUrl,target);assert.equal((await h.nativeSelections(id,'en')).length,1);}assert.equal(cache.requests,0);assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),before);
});
for(const mode of ['good','wrong-id','wrong-selected','wrong-language','conflicting-url','hash','edition'])test('sparse metadata uses exact frozen context file declaration: '+mode,async t=>{
 const copy=structuredClone(work);if(mode==='edition')copy.epNumberVersion='1';const f=await fixture(t,old=>{old.is_realized_by[0].language=mode==='conflicting-url'?'en':'cs';if(mode==='conflicting-url')old.is_realized_by[0].is_embodied_by[0].is_exemplified_by+='other';if(mode==='edition')old.epNumberVersion='2';},copy);
 const context=apiBase+'/api/document-context/'+id+'?lang=en',value={documentId:mode==='wrong-id'?id+'9':id,document:{selectedDocumentId:mode==='wrong-selected'?id+'9':id,files:[{url,language:mode==='wrong-language'?'fr':'en',format:'DOCX',...(mode==='hash'?{sha256:'a'.repeat(64)}:{})}]}};
 const records=await Promise.all(f.sb.manifest.map(m=>f.h.b.read(m.url,m.request)));await seal(f.b,[...records,record(context,value)]);const before=await Promise.all([tree(f.a),tree(f.b)]),h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;const cache=new InputCache(f.out,{apiBase,cap:0,retained:h,fetcher:()=>assert.fail('zero requests')});const input=await h.baseScope(f.identity,()=>cache.get(url));assert.equal(Boolean(input.acquisitionUnavailable),mode!=='good');if(mode==='good'){const contexts=input.hybridSource.identity.proof.declaration.contexts.base;assert.equal(contexts[0].url,context);assert(contexts[0].sha256);assert(contexts[0].fetchedAt);}assert.equal(cache.requests,0);assert.deepEqual(await Promise.all([tree(f.a),tree(f.b)]),before);
});

test('wording fallback proves only captured owners of the requested URL',async t=>{
 const f=await fixture(t),row={id:id+'-AM-1',targetDocumentId:id,number:1,listId:id+'-AM-001-001',language:'en',wordingSource:{url}};
 const catalogue=apiBase+'/api/amendments?limit=50&offset=0',records=await Promise.all(f.sb.manifest.map(m=>f.h.b.read(m.url,m.request)));await seal(f.b,[...records,record(catalogue,{items:[row]})]);
 const h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;h.trackRows([row]);
 for(let i=0;i<200;i++)h.registerWording({...row,id:row.id+'-'+i,wordingSource:{url:wording+'-'+i+'.docx'}});
 const prove=h.wordingProof.bind(h);let proofs=0;h.wordingProof=async declared=>{assert.equal(declared,url);proofs++;return prove(declared);};
 const selected=await h.wordingFallback(url);assert.equal(selected.input.body.toString(),'OLD BASE');assert.equal(proofs,1);
 assert.equal(await h.wordingFallback(url.replace('base','unrelated')),null);assert.equal(proofs,1);
});

for(const hops of [0,1,2,3])test('metadata prefilter retains every full-proof acceptance through '+hops+' captured redirects',async t=>{
 const f=await fixture(t),row={id:id+'-AM-1',targetDocumentId:id,number:1,listId:id+'-AM-001-001',language:'en',wordingSource:{url,sha256:digest(Buffer.from('OLD BASE'))}};
 const urls=[url,...Array.from({length:hops},(_,i)=>'https://redmapl3.europarl.europa.eu/RedmapFront/media/test/hop-'+i+'.docx')];
 const records=await Promise.all(f.sb.manifest.filter(m=>m.url!==url).map(m=>f.h.b.read(m.url,m.request)));
 for(let i=0;i<hops;i++)records.push({...record(urls[i],'<moved/>'),status:302,ok:true,redirectUrl:urls[i+1],headers:i%2?{location:new URL(urls[i+1]).pathname}:{}});
 records.push(record(urls.at(-1),'OLD BASE'),record(apiBase+'/api/amendments?limit=50&offset=0',{items:[row]}));await seal(f.b,records);
 const h=await HybridInputs.open(f.a,f.b,f.out);h.runtime=f.h.runtime;
 h.registerWording({...row,id:row.id+'-unrelated',wordingSource:{url:wording}});h.trackRows([row]);
 const filteredOwners=h.wordingOwners.bind(h);
 for(const requested of urls){
  const filtered=await h.wordingFallback(requested);
  // Disable only the prefilter; run the exact same full proof on all owners.
  h.wordingOwners=()=>[...h.wording];const full=await h.wordingFallback(requested);h.wordingOwners=filteredOwners;
  assert(full?.input,'the full proof accepts this captured chain position');assert.deepEqual(filtered,full);assert.equal(filtered.proof.finalObservation.sha256,row.wordingSource.sha256);
 }
});

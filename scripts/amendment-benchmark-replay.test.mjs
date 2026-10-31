import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {InputCache,allowedSource,digest} from './amendment-benchmark-cache.mjs';
import {replayRuntime,sourceReplay,replaySourceClients,publicDocumentUrl,rawExistingLawReferences,missingDeclaredRepresentation} from './amendment-benchmark-replay.mjs';
import {acquireReport,evaluateReport,contextUrl} from './amendment-benchmark.mjs';
import {metrics,compareBaseline} from './amendment-benchmark-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),apiBase='https://explorer.example';

test('offline metadata retains its age and observation through delayed immutable refreshes',async()=>{
  const runtime=await replayRuntime(root),celex='52024PC0531';
  const rdf=await readFile(new URL('../server/fixtures/proposal-52024PC0531.rdf',import.meta.url));
  const laterRdf=await readFile(new URL('../server/fixtures/proposal-52025PC0087.rdf',import.meta.url));
  // The old metadata and next-day transport times reproduce the retained
  // 0531 chronology. The second real RDF fixture supplies the clock advance;
  // its virtual time is a scheduling probe, not a new source observation.
  const oldAt='2026-10-27T16:35:15.589Z',laterAt='2026-10-28T11:33:25.950Z';
  const outcomes=[];
  for(const slow of [false,true]) {
    let reads=0;
    const calls=[],cache={get:async(url,options)=>{
      calls.push({url,accept:options.accept});
      if(slow)await new Promise(resolve=>setTimeout(resolve,3));
      const later=url.endsWith('52025PC0087');
      if(!later)reads++;
      return {url,body:later?laterRdf:rdf,fetchedAt:later?laterAt:oldAt,status:200,headers:{'content-type':'application/rdf+xml'}};
    }};
    const {sources,documents}=replaySourceClients(cache,runtime);
    const first=await documents.metadata(celex);
    assert.equal(first.viewCache.stale,false);
    assert.equal(first.fetchedAt,oldAt);
    await documents.metadata('52025PC0087');
    const repeated=[];
    for(let i=0;i<3;i++) {
      const record=await documents.metadata(celex);
      assert.equal(record.xml,rdf.toString());
      assert.equal(record.fetchedAt,oldAt);
      assert.equal(record.viewCache.computedAt,oldAt);
      assert.equal(record.viewCache.stale,true);
      // Already-admitted replays finish at the boundary and cannot rewind
      // the next read's age or re-date the captured observation.
      assert.equal(sources.cache.pending.size,0);
      repeated.push(record);
    }
    assert.equal(reads,4);
    assert.equal(calls.length,5);
    outcomes.push(repeated);
  }
  assert.deepEqual(outcomes[0],outcomes[1]);
});
const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body>'+xml+'</w:body></w:document>'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
function fixture(commission=true,referenceOnly=false,omittedLanguage=false,reportWording=false) {
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
const sample={mode:'documents',asOf:'2026-10-27'};
test('sealed CNS replay reports only a missing resolved discovery request as an acquisition gap',async()=>{
  const original=await replayRuntime(root),examples=JSON.parse(await readFile(new URL('../server/fixtures/cns-source-identity-excerpts.json',import.meta.url))).examples;
  for(const e of examples) {
    let fallback=0;const calls=[],options={reportId:e.reportId,language:'en',documentReferences:[{field:'DocRef',raw:e.reportReference}]};
    const runtime={...original,createProposalBaseline:()=>async()=>{fallback++;return {status:'unresolved',gaps:['normal-runtime-result'],items:[]};}};
    const reportUrl=publicDocumentUrl(e.reportId),cache={sealed:new Set(),assertHealthy(){},get:async url=>{calls.push(url);assert.equal(url,reportUrl);return {ok:true,url,body:Buffer.from(JSON.stringify({data:[e.report]})),fetchedAt:'2026-10-30T11:00:00Z'};}};
    const replay=sourceReplay(cache,runtime),missing=await replay.proposal(options);
    assert.deepEqual(missing.baseline.gaps,['consultation-source-not-in-snapshot']);assert.deepEqual(missing.items,[]);assert.equal(fallback,0);assert.deepEqual(calls,[reportUrl]);
    const url=new URL('https://publications.europa.eu/webapi/rdf/sparql');url.searchParams.set('query',runtime.proposalCandidatesSparql(e.celex));url.searchParams.set('format','application/sparql-results+json');
    cache.sealed.add(JSON.stringify([url.href,{accept:'application/sparql-results+json'}]));
    assert.deepEqual((await replay.proposal(options)).baseline.gaps,['normal-runtime-result']);assert.equal(fallback,1,'present discovery observations continue through the normal runtime');
    cache.sealed.clear();assert.deepEqual((await replay.proposal({...options,language:'fr'})).baseline.gaps,['normal-runtime-result']);
    assert.deepEqual((await replay.proposal({...options,documentReferences:[{field:'DocRef',raw:e.reportReference.replace('(CNS)','(COD)')}]})).baseline.gaps,['normal-runtime-result']);
  }
});
test('raw existing-law acquisition binds a prospective citation to its own amendment, before extraction',async()=>{
  const runtime=await replayRuntime(root);
  const bytes=docx(p('<Date>{24/04/2026}24.4.2026</Date>')+p('Amendment 1')+p('Regulation (EC) No 1223/2009')+p('Article 15 – paragraph 2')+p('Present text')+p('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02009R1223-20260501')+p('Amendment 2')+p('Regulation (EU) 2023/956')+p('Article 5 – paragraph 1')+p('Present text'));
  const refs=rawExistingLawReferences(bytes,runtime);assert.equal(refs.length,2);assert.deepEqual(refs.map(r=>r.documentDate),['2026-04-24','2026-04-24']);
  assert.equal(refs[0].documentReferences[0].raw,'02009R1223-20260501');assert.deepEqual(refs[1].documentReferences,[]);
  assert.equal(runtime.existingLawReference({...refs[0],language:'en'}).gaps[0],'existing-law-prospective-version');
});
test('Council source replay freezes discovered XHTML and evaluates it without borrowing a live projection',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'council-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(),excerpts=JSON.parse(await readFile(new URL('../server/fixtures/council-position-excerpts.json',import.meta.url),'utf8')),rdf=await readFile(new URL('../server/fixtures/council-position-metadata.rdf',import.meta.url),'utf8');
  const cell=value=>'<w:tc>'+p(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const list=docx(p('<Amend><NumAm>1</NumAm>')+p('<DocRef>17037/1/2025 – 2023/0226(COD)</DocRef>')+p('<DocAmend>Council position</DocAmend>')+p('<Article>Article 30 – paragraph 3 – point b</Article>')+'<w:tbl>'+tr('Council position','Amendment')+tr('(b) arrangements for the licensing of patents under fair and reasonable conditions, including through the voluntary platforms referred to in paragraph 2;','(b) New licensing arrangements;')+'</w:tbl>'+p('</Amend>'));
  const fetcher=async(url,options)=>{
    if(url===f.row.wordingSource.url)return new Response(list);
    if(url.includes('/sparql?'))return Response.json({results:{bindings:[{work:{type:'uri',value:'http://publications.europa.eu/resource/cellar/94b1ab29-4450-11f1-8095-01aa75ed71a1'},celex:{type:'literal',value:excerpts.celex}}]}},{headers:{'content-type':'application/sparql-results+json'}});
    if(url.includes('/celex/52026AG0006%2801%29'))return new Response(rdf,{headers:{'content-type':'application/rdf+xml'}});
    if(url===excerpts.sourceUrl)return new Response(excerpts.xhtml,{headers:{'content-type':'application/xhtml+xml'}});
    const result=await f.fetcher(url,options);
    if(url===publicDocumentUrl(f.document)) {
      const data=await result.json();data.data[0].inverse_created_a_realization_of=['eli/dl/proc/2023-0226'];data.data[0].is_realized_by[0].title_alternative={en:'17037/1/2025 – 2023/0226(COD)'};return Response.json(data);
    }
    return result;
  };
  const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:20,delay:0,sleep:async()=>{},fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));
  const manifest=cache.manifest();assert(manifest.some(meta=>meta.url===excerpts.sourceUrl&&meta.request.accept==='application/xhtml+xml'));
  const offline=new InputCache(directory,{apiBase,fetcher:()=>{throw new Error('Network forbidden');}});await offline.seal(manifest);
  const rows=await evaluateReport([f.row],sample,offline,{runtime,replay:sourceReplay(offline,runtime)});
  assert.equal(rows[0].outcome,'correct',JSON.stringify(rows[0].stages));assert.equal(rows[0].stages.S4.kind,'council-position');assert.equal(rows[0].stages.S6.status,'verified');
  const query=manifest.find(meta=>meta.url.includes('/sparql?')&&decodeURIComponent(meta.url).includes('POSIT'));
  assert(query);offline.sealed.delete(JSON.stringify([query.url,query.request]));
  const missing=await sourceReplay(offline,runtime).council({reportId:f.document,language:'en',documentReferences:[{field:'DocRef',raw:'17037/1/2025 – 2023/0226(COD)'}]});
  assert.deepEqual(missing.baseline.gaps,['council-source-not-in-snapshot']);offline.assertHealthy();
});
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

test('source replay preserves report wording identity through the measured extractor helper',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-report-wording-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=await replayRuntime(root),f=fixture(true,false,false,true),cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:20,delay:0,sleep:async()=>{},fetcher:f.fetcher});
  await acquireReport([f.row],sample,cache,sourceReplay(cache,runtime));await cache.seal(cache.manifest());const requests=cache.requests;let calls=0;
  const measured={...runtime,extractAmendments:(bytes,options)=>{calls++;assert.equal(options.reportId,f.document);return runtime.extractAmendments(bytes,options);}};
  const [result]=await evaluateReport([f.row],sample,cache,{runtime:measured,replay:sourceReplay(cache,measured)});
  assert.equal(calls,1);assert.equal(result.outcome,'correct',JSON.stringify(result.stages));assert.equal(cache.requests,requests);
});

test('only the exact absent declared representation maps to a sealed acquisition gap',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'cellar-declared-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const recorded=JSON.parse(await readFile(new URL('../server/fixtures/cellar-docx-negotiation.json',import.meta.url),'utf8'));
  const url=recorded.source.url,standard={accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',language:'eng'},declared={accept:'application/zip;type=akn4eu',language:'eng'};
  const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:2,delay:0,sleep:async()=>{},fetcher:async()=>new Response(recorded.errorXml,{status:406,headers:{'content-type':'application/xml'}})});
  await cache.get(url,standard);await cache.seal(cache.manifest());
  const before=cache.manifest(),requests=cache.requests,error=await missingDeclaredRepresentation(cache,url,declared);
  assert.equal(error.code,'missing-declared-representation');assert.equal(error.source.status,406);assert.equal(error.source.sha256,recorded.advertisement.sha256);assert.deepEqual(error.request,{url,...declared});assert.equal(cache.requests,requests);assert.deepEqual(cache.manifest(),before);cache.assertHealthy();
  for(const [u,r] of [[url,{...declared,language:'fra'}],[url.replace('/DOC_1','/DOC_2'),declared],[url,{...declared,accept:'application/zip'}],[url,standard]])assert.equal(await missingDeclaredRepresentation(cache,u,r),null);
  const exact=JSON.stringify([url,declared]);cache.sealed.add(exact);assert.equal(await missingDeclaredRepresentation(cache,url,declared),null);cache.sealed.delete(exact);
  // The narrow mapping does not swallow InputCache's unexpected-missing error.
  await assert.rejects(cache.get(url,{...declared,language:'fra'}),/input-not-in-snapshot/);assert.throws(()=>cache.assertHealthy(),/input-not-in-snapshot/);
});
test('a406 without the declared advertisement and a404 are not mapped to a representation gap',async()=>{
  const url='https://publications.europa.eu/resource/cellar/efd95e89-a29d-11ef-85f0-01aa75ed71a1.0001.01/DOC_1',standard={accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',language:'eng'},declared={accept:'application/zip;type=akn4eu',language:'eng'};
  for(const input of [{status:404,body:Buffer.from('resource mimetype [application/zip;type=akn4eu]')},{status:406,body:Buffer.from('resource mimetype [application/xml]')}]) {
    const cache={sealed:new Set([JSON.stringify([url,standard])]),get:async()=>input};assert.equal(await missingDeclaredRepresentation(cache,url,declared),null);
  }
});


test('proposal replay binds each native NLE or unresolved selection despite shared references',async()=>{
  for(const procedure of [' – 2026/0001(NLE)','']) {
  const document='A-10-2026-0001',firstList=document+'-AM-001-002',secondList=document+'-AM-003-003';
  const firstUrl='https://data.europarl.europa.eu/distribution/test/first-list.docx';
  const secondUrl='https://data.europarl.europa.eu/distribution/test/second-list.docx';
  const block=number=>p('<Amend><NumAm>'+number+'</NumAm>')+p('<DocRef>COM(2026)1 final'+procedure+'</DocRef>')+
    p('<Article>Recital 1</Article>')+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('Original wording.')+'</w:tc><w:tc>'+p('Changed wording '+number+'.')+'</w:tc></w:tr></w:tbl>'+p('</Amend>');
  const bytes=new Map([[firstUrl,docx(block(1)+block(2))],[secondUrl,docx(block(3))]]);
  const rows=[1,2,3].map(number=>{
    const id=document+'-AM-'+number,listId=number<3?firstList:secondList,url=number<3?firstUrl:secondUrl;
    return {id,targetDocumentId:document,number,listId,language:'en',baseline:'commission-proposal',wordingSource:{url},decisions:[{id:'vote-'+number,date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  });
  const cache={apiBase,json:async url=>({input:{url},value:{documentId:document,document:{selectedText:null},proposal:null,baseline:null}}),get:async url=>({ok:true,url,body:bytes.get(url),sha256:digest(bytes.get(url)),fetchedAt:'2026-10-27T00:00:00Z',status:200})};
  const runtime=await replayRuntime(root),eligibility=sourceReplay(cache,runtime);
  const calls=[],replay={proposalRequiresSelection:eligibility.proposalRequiresSelection,observeFiles(){},request:async()=>({payload:{data:[{id:'eli/dl/doc/'+document}]}}),proposal:async(options,selected)=>{
    calls.push({options,selected});return {baseline:{status:'unresolved',language:'en',gaps:['source-test-unavailable']},items:[]};
  }};
  const result=await evaluateReport(rows,sample,cache,{runtime,replay});
  assert.equal(result.length,3);assert.equal(calls.length,3,'each exact selected amendment needs its own source validation');
  assert.deepEqual(calls.map(c=>c.selected),rows.map(row=>({listId:row.listId,number:row.number,wordingSource:{url:row.wordingSource.url,sha256:digest(bytes.get(row.wordingSource.url))},originalText:'Original wording.',proposedText:'Changed wording '+row.number+'.'})));
  assert.deepEqual(calls.map(c=>c.options.documentReferences),[calls[0].options.documentReferences,calls[0].options.documentReferences,calls[0].options.documentReferences]);
  }
});

test('native selection eligibility keeps unresolved NLE contexts and excludes explicit COD/CNS and legacy runtimes',async()=>{
  const runtime=await replayRuntime(root),reader=sourceReplay({},runtime),report=raw=>({is_realized_by:[{title_alternative:{en:raw}}]});
  const options=raw=>({reportId:'A-10-2026-0001',language:'en',documentReferences:raw?[{field:'DocRef',raw}]:[]});
  for(const type of ['COD','CNS']) {
    assert.equal(reader.proposalRequiresSelection(options('COM(2026)1 – 2026/0001('+type+')'),report('')),false);
    assert.equal(reader.proposalRequiresSelection(options(),report('COM(2026)1 – 2026/0001('+type+')')),false);
  }
  assert.equal(reader.proposalRequiresSelection(options('COM(2026)1 – 2026/0001(NLE)'),report('')),true);
  assert.equal(reader.proposalRequiresSelection(options(),report('COM(2026)1 – 2026/0001(NLE)')),true);
  assert.equal(reader.proposalRequiresSelection(options(),report('COM(2026)1')),true,'unresolved procedure identity cannot share native selections');
  assert.equal(reader.proposalRequiresSelection(options('2026/0001(COD)'),report('2026/0001(NLE)')),true,'conflicting NLE evidence remains selected');
  const legacy=sourceReplay({},{...runtime,DocumentContext:undefined});
  assert.equal(legacy.proposalRequiresSelection(options('2026/0001(NLE)'),report('')),false);
});

test('ordinary Commission projections keep their first availability after an intervening later source observation',async()=>{
  const document='A-10-2026-0001',listId=document+'-AM-001-003',listUrl='https://data.europarl.europa.eu/distribution/test/mixed-list.docx';
  const block=(number,baseline)=>p('<Amend><NumAm>'+number+'</NumAm>')+p('<DocRef>COM(2024)0531 – 2024/0001(COD)</DocRef>')+p('<Article>Article 1</Article>')+
    '<w:tbl><w:tr><w:tc>'+p(baseline)+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('Original.')+'</w:tc><w:tc>'+p('Changed '+number+'.')+'</w:tc></w:tr></w:tbl>'+p('</Amend>');
  const bytes=docx(block(1,'Text proposed by the Commission')+block(2,'Present text')+block(3,'Text proposed by the Commission'));
  const rows=[1,2,3].map(number=>({id:document+'-AM-'+number,targetDocumentId:document,number,listId,language:'en',baseline:'unknown',wordingSource:{url:listUrl},decisions:[{id:'vote-'+number,date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[document+'-AM-'+number],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]}));
  const cache={apiBase,json:async url=>({input:{url},value:{documentId:document,document:{selectedText:null},proposal:null,baseline:null}}),get:async()=>({ok:true,url:listUrl,body:bytes,sha256:digest(bytes),fetchedAt:'2026-10-27T00:00:00Z',status:200})};
  const runtime=await replayRuntime(root),eligibility=sourceReplay(cache,runtime),oldRdf=await readFile(new URL('../server/fixtures/proposal-52024PC0531.rdf',import.meta.url)),laterRdf=await readFile(new URL('../server/fixtures/proposal-52025PC0087.rdf',import.meta.url));
  const calls=[],clients=replaySourceClients({get:async url=>{const later=url.endsWith('52025PC0087');calls.push(url);return {url,body:later?laterRdf:oldRdf,fetchedAt:later?'2026-10-27T23:34:00.867Z':'2026-10-27T16:51:59.253Z',status:200,headers:{'content-type':'application/rdf+xml'}};}},runtime);
  let proposalCalls=0;
  const replay={observeFiles(){},request:async()=>({payload:{data:[{id:'eli/dl/doc/'+document}]}}),proposalRequiresSelection:eligibility.proposalRequiresSelection,
    proposal:async(options,selected)=>{proposalCalls++;assert.equal(selected,undefined);const metadata=await clients.documents.metadata('52024PC0531');return {baseline:{language:'en',status:metadata.viewCache.stale?'partial':'available',gaps:metadata.viewCache.stale?['stale-metadata']:[]},items:[]};},
    existingLaw:async()=>{await clients.documents.metadata('52025PC0087');return {baseline:{language:'en',status:'available',gaps:[]},items:[]};}};
  const result=await evaluateReport(rows,sample,cache,{runtime,replay});
  assert.equal(proposalCalls,1);assert.equal(calls.length,2,'ordinary sharing must not re-read old metadata after the clock advances');
  for(const index of [0,2]){assert.equal(result[index].stages.S4.projection.status,'available');assert.deepEqual(result[index].stages.S4.gaps,[]);}
  const uncached=await clients.documents.metadata('52024PC0531');assert.equal(uncached.viewCache.stale,true,'the source freshness policy itself is unchanged');
});

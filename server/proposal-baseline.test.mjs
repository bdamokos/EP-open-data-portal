import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveProposalTree,resolveProposalCandidates,commissionReferences,reportProposalReference} from './commission-proposal-identity.mjs';
import {CellarDocuments,CELLAR_DOCX_MIME,CELLAR_LIMITS,cellarTransportUrl,limitedCellarBody} from './cellar-documents.mjs';
import {createProposalBaseline} from './proposal-baseline.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {runWithRequestSignal,requestSignal,waitForRequest,requestTimeout,cancelledRequest} from './request-budget.mjs';
import {comparisonHeading,isAmendmentHeading,COMPARISON_HEADINGS} from './amendment-baseline.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {nativeConsultationProcedure} from './commission-proposal-native-identity.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';

const fixture=celex=>readFileSync(new URL(`./fixtures/proposal-${celex}.rdf`,import.meta.url),'utf8');
const celex='52025PC0087',xml=fixture(celex),resolved=()=>resolveProposalTree(xml,{celex,language:'en'});
// A stored ZIP with the single XML part exercises the existing bounded DOCX reader.
function docx(text='Source text') {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(`<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return archive(name,body);
}
function archive(name,body) {
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
const item=()=>({...resolved().items[0],celex,language:resolved().items[0].languageUri});
const sourceOptions=fetchSource=>({directory:null,fetchSource,sources:new OfficialContextSources({directory:null,fetchSource})});
const content=(buffer=docx(),extra={})=>new Response(buffer,{headers:{'content-type':CELLAR_DOCX_MIME,...extra}});
const report=JSON.parse(readFileSync(new URL('./fixtures/proposal-report-reference.json',import.meta.url),'utf8')).report;
const consultations=JSON.parse(readFileSync(new URL('./fixtures/cns-source-identity-excerpts.json',import.meta.url),'utf8')).examples;
const nativeHeader=(example,xml=example.nativeHeadingXml)=>archive(Buffer.from('word/document.xml'),Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`));

test('consultation reports require their native typed reference and exact linked procedure',()=>{
  for(const e of consultations) {
    const refs=[{field:'DocRef',raw:e.reportReference}],actual=reportProposalReference(e.report,{reportId:e.reportId,documentReferences:refs});
    assert.equal(actual.status,'resolved');assert.equal(actual.celex,e.celex);assert.equal(actual.procedure,`2025/${e.celex.slice(-4)}(CNS)`);
    assert.equal(reportProposalReference(e.report,{reportId:e.reportId}).gaps[0],'missing-native-report-reference');
    assert.equal(reportProposalReference({...e.report,inverse_created_a_realization_of:['eli/dl/proc/2025-9999']},{reportId:e.reportId,documentReferences:refs}).status,'unresolved');
    const mixed=[...refs,{field:'DocRef',raw:e.reportReference.replace('(CNS)','(COD)')}];assert.equal(reportProposalReference(e.report,{reportId:e.reportId,documentReferences:mixed}).status,'unresolved');
    const tree=resolveProposalTree(e.rdfExcerpt,{celex:e.celex,language:'en',procedure:actual.procedure});assert.equal(tree.status,'resolved');assert.equal(tree.workId,e.workId);assert.equal(tree.procedure,actual.procedure);
    const untyped=resolveProposalTree(e.rdfExcerpt,{celex:e.celex,language:'en'});assert.equal(untyped.procedure,null,'numeric RDF codes never invent COD');assert.deepEqual(untyped.evidence[0].procedures,[]);
    assert.deepEqual(untyped.evidence[0].procedureCodes,[actual.procedure.slice(0,9)]);
  }
});

test('native CNS proof requires the visible source heading and preserves its printed number',()=>{
  for(const e of consultations) {
    const procedure=`2025/${e.celex.slice(-4)}(CNS)`,bytes=nativeHeader(e),actual=nativeConsultationProcedure(bytes,{procedure,language:'en'});
    assert.equal(actual.status,'verified');assert.equal(actual.procedure,procedure);assert.match(actual.raw,e.celex.endsWith('580')?/^2025\/580 /:/^2025\/0581 /);
    assert.equal(nativeConsultationProcedure(bytes,{procedure,language:'fr'}).status,'unresolved');
    assert.equal(nativeConsultationProcedure(bytes,{procedure:'2025/9999(CNS)',language:'en'}).reason,'native-procedure-reference-conflict');
    assert.equal(nativeConsultationProcedure(nativeHeader(e,e.nativeHeadingXml.repeat(2)),{procedure,language:'en'}).reason,'native-procedure-heading-ambiguous');
    assert.equal(nativeConsultationProcedure(nativeHeader(e,e.nativeHeadingXml.replaceAll('Rfrenceinterinstitutionnelle','Normal')),{procedure,language:'en'}).status,'unresolved');
    const hidden=e.nativeHeadingXml.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/gu,(_whole,attributes,body)=>{
      const changed=body.replace(/^<w:rPr>/u,'<w:rPr><w:vanish/>');
      return '<w:r'+attributes+'>'+(changed===body?'<w:rPr><w:vanish/></w:rPr>'+body:changed)+'</w:r>';
    });
    assert.notEqual(hidden,e.nativeHeadingXml);
    assert.equal(nativeConsultationProcedure(nativeHeader(e,hidden),{procedure,language:'en'}).status,'unresolved');
    assert.equal(nativeConsultationProcedure(nativeHeader(e,'<w:tbl><w:tr><w:tc>'+e.nativeHeadingXml+'</w:tc></w:tr></w:tbl>'),{procedure,language:'en'}).reason,'native-procedure-heading-incomplete');
  }
});

test('candidate-work metadata uses its exact recorded request and validates that work',async()=>{
  for(const e of consultations) {
    const calls=[],docs=new CellarDocuments(sourceOptions(async(u,o)=>{calls.push({url:u,accept:o.headers.Accept});return new Response(e.rdfExcerpt,{headers:{'content-type':'application/rdf+xml'}});}));
    const actual=await docs.metadataByWork(e.workId,{celex:e.celex});assert.equal(actual.url,e.rdfSource.url);assert.equal(actual.resolvedSourceUrl,e.rdfSource.url);
    await docs.metadataByWork(e.workId,{celex:e.celex});assert.deepEqual(calls,[{url:e.rdfSource.url,accept:'application/rdf+xml;notice=tree'}]);
    const other=e.workId.replace(/\/[^/]+$/,'/00000000-0000-0000-0000-000000000001');await assert.rejects(docs.metadataByWork(other,{celex:e.celex}),{code:'cellar_metadata'});
  }
});

test('the CNS baseline binds current report, candidate work, declared items and native heading',async()=>{
  for(const e of consultations) {
    const procedure=`2025/${e.celex.slice(-4)}(CNS)`,calls=[],items=resolveProposalTree(e.rdfExcerpt,{celex:e.celex,language:'en',procedure}).items;
    let mode='valid';
    const documents={
      candidates:async c=>({url:'https://publications.europa.eu/webapi/rdf/sparql',fetchedAt:0,data:{results:{bindings:[{work:{type:'uri',value:e.workId},celex:{type:'literal',value:c},version:{type:'literal',value:'final'}}]}}}),
      metadata:async()=>{throw Error('CNS must not relabel a CELEX response');},
      metadataByWork:async(w,{celex})=>{assert.equal(w,e.workId);assert.equal(celex,e.celex);calls.push('work');return {url:e.rdfSource.url,resolvedSourceUrl:e.rdfSource.url,fetchedAt:0,xml:mode==='wrong-type'?e.rdfExcerpt.replaceAll('/PROP_DIR','/PROP_REG'):e.rdfExcerpt};},
      docx:async item=>{assert(items.some(x=>x.itemId===item.itemId));calls.push(item.kind);return {buffer:item.kind==='act'?(mode==='no-heading'?docx():nativeHeader(e)):docx('ANNEX'),source:{url:cellarTransportUrl(item.itemId,{redirect:true}),fetchedAt:0}};},
    };
    const baseline=createProposalBaseline({documents,request:async()=>({url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+e.reportId,payload:{data:[e.report]},fetchedAt:0})});
    const options={reportId:e.reportId,language:'en',documentReferences:[{field:'DocRef',raw:e.reportReference}]};const good=await baseline(options);
    assert.equal(good.status,'available',JSON.stringify(good.gaps));assert.equal(good.items.length,items.length);assert.equal(good.evidence.find(x=>x.kind==='native-procedure').procedure,procedure);assert.deepEqual(calls,['work',...items.map(x=>x.kind)]);
    mode='no-heading';assert.equal((await baseline(options)).status,'unresolved');
    mode='wrong-type';assert((await baseline(options)).gaps.includes('native-procedure-type-unavailable'));
    assert.equal((await baseline({...options,language:'fr'})).status,'language-unavailable');
  }
});

test('CNS compound body-and-note columns remain unresolved without changing their payload',()=>{
  const chosen={language:'en',targetLabelLanguage:'en',baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},documentReferences:[{field:'DocRef',raw:consultations[0].reportReference}],targetLabel:'Recital 2 a (new)',originalText:'',proposedText:'(2a) New provision1a.\n___________\n1a Published note.\n+ OJ: Retain this instruction.',proposedFormatting:[{kind:'superscript',start:18,end:20}]};
  const before=structuredClone(chosen),placement=documentContextPlacement({chosen,items:[]});
  assert.equal(placement.status,'unresolved');assert.equal(placement.reason,'proposal_note_scope_unavailable');assert.equal(placement.operation,'insert');assert(!placement.span&&placement.insertAfter===undefined&&placement.insertBefore===undefined);assert.deepEqual(chosen,before);
  const plain={...chosen,proposedText:'(2a) Literal [OJ: retain the citation] stays in the provision.'};assert.equal(documentContextPlacement({chosen:plain,items:[]}).reason,'proposal_baseline_unavailable');
});

test('recorded CBAM, AI Act and Green Claims metadata resolve exact works and DOCX parts',()=>{
  const cases=[['52025PC0087','731e787f-f4fb-11ef-b7db-01aa75ed71a1','2025/0039(COD)',2],['52021PC0206','e0649735-a372-11eb-9585-01aa75ed71a1','2021/0106(COD)',2],['52023PC0166','cbafeec2-c94e-11ed-a05c-01aa75ed71a1','2023/0085(COD)',1]];
  for(const [celex,work,procedure,count] of cases) {
    const r=resolveProposalTree(fixture(celex),{celex,language:'en',procedure});assert.equal(r.status,'resolved',JSON.stringify(r.gaps));
    assert.equal(r.workId,`http://publications.europa.eu/resource/cellar/${work}`);assert.equal(r.items.length,count);assert.equal(r.items[0].kind,'act');
    if(count===2)assert.equal(r.items[1].kind,'annex');assert(r.items.every(i=>i.aliases.some(a=>a.endsWith('.docx'))));
  }
});
test('work authorship, proposal type, version, COM identity and procedure must all agree',()=>{
  for(const [before,after,gap] of [['corporate-body/COM','corporate-body/CONSIL','commission-author-unverified'],['/PROP_REG','/REG','proposal-type-unverified'],['>final<','>final/2<','proposal-version-unresolved'],['COM_2025_0087_FIN','COM_2025_0088_FIN','com-reference-unverified'],['procedure/2025_39','procedure/2025_40','proposal-procedure-mismatch']]) {
    const r=resolveProposalTree(xml.replaceAll(before,after),{celex,language:'en',procedure:'2025/0039(COD)'});assert.notEqual(r.status,'resolved');assert(r.gaps.includes(gap),gap+JSON.stringify(r.gaps));
  }
  assert.equal(resolveProposalTree(xml,{celex,language:'fr'}).status,'language-unavailable');
  assert(resolveProposalTree(xml,{celex:'52025PC9999',language:'en'}).gaps.includes('proposal-work-missing'));
  const ambiguous=xml;
  const end=ambiguous.match(/<\/(\w+):RDF>$/)?.[0];
  const prefix=ambiguous.match(/xmlns:(\w+)="http:\/\/www.w3.org\/1999\/02\/22-rdf-syntax-ns#"/)?.[1];
  const cdm=ambiguous.match(/xmlns:(\w+)="http:\/\/publications.europa.eu\/ontology\/cdm#"/)?.[1];
  const second=`<${prefix}:Description ${prefix}:about="http://publications.europa.eu/resource/cellar/00000000-0000-0000-0000-000000000001"><${cdm}:resource_legal_id_celex>${celex}</${cdm}:resource_legal_id_celex></${prefix}:Description>`;
  assert(resolveProposalTree(ambiguous.replace(end,second+end),{celex,language:'en'}).gaps.includes('ambiguous-proposal-work'));
});
test('report COM extraction preserves qualifiers and refuses ambiguous or conflicting references',()=>{
  assert.equal(reportProposalReference(report,{reportId:'A-10-2025-0085'}).celex,celex);
  assert.equal(commissionReferences('COM(2025)87 final/2')[0].qualifier,'final/2');
  for(const text of ['COM(2025)87 final/2 – 2025/0039(COD)','COM(2025)87 – COM(2025)88 – 2025/0039(COD)','no COM reference']) {
    const r=reportProposalReference({...report,is_realized_by:[{title_alternative:{en:text}}]},{reportId:'A-10-2025-0085'});assert.equal(r.status,'unresolved');
  }
  assert.equal(reportProposalReference({...report,inverse_created_a_realization_of:['eli/dl/proc/2025-0040']},{reportId:'A-10-2025-0085'}).status,'unresolved');
  assert.equal(reportProposalReference(report,{reportId:'A-10-2025-0085',documentReferences:[{field:'DocRef',raw:'COM(2025)88'}]}).status,'unresolved');
  assert.equal(reportProposalReference(report,{reportId:'A-10-2025-0085',documentReferences:[{field:'DocRef',raw:'COM(2025)87 – 2025/0040(COD)'}]}).status,'unresolved');
});
test('exact recorded headings cover 24 languages; unfamiliar labels stay unknown',()=>{
  const rows=JSON.parse(readFileSync(new URL('./fixtures/proposal-comparison-headings.json',import.meta.url),'utf8'));assert.equal(rows.length,24);
  for(const row of rows)for(const e of row.examples) {assert.equal(comparisonHeading(e.left,row.language).category,e.category);assert(isAmendmentHeading(e.right,row.language));assert(e.sourceUrl||row.sourceUrl);}
  assert.equal(comparisonHeading('Possibly a Commission proposal','en').category,'unknown');assert.equal(comparisonHeading('Text proposed by the Commission','hu').category,'unknown');
  assert.equal(Object.keys(COMPARISON_HEADINGS).length,24);
});
test('CBAM amendment 7 keeps Commission baseline and separate proposal / underlying-act paths',()=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url),'utf8')).documents.find(d=>d.targetDocumentId==='A-10-2025-0085');
  const buffer=archive(Buffer.from('word/document.xml'),Buffer.from(f.documentXml));
  const a=extractAmendments(buffer,f).amendments.find(a=>a.number===7);
  assert.equal(a.baseline,'commission-proposal');assert.equal(a.baselineSource.headings[0].left.raw,'Text proposed by the Commission');
  assert.equal(a.targetPath.proposal[0].raw,'Article 1 – paragraph 1 – point 21 – point a');assert.equal(a.targetPath.underlying[0].raw,'Article 26 – paragraph 1 a (new)');
  assert(a.documentReferences.some(r=>r.field==='DocAmend2'&&/2023\/956/.test(r.raw)));
});
test('CELLAR transport upgrades only allowlisted HTTP redirects and bounds paths',async()=>{
  const i=item(),url=i.itemId.replace('http:','https:');let calls=0;
  const docs=new CellarDocuments(sourceOptions(async u=>{calls++;return calls===1?new Response(null,{status:303,headers:{location:i.itemId}}):content();}));
  assert.equal((await docs.docx(i)).source.resolvedSourceUrl,url);assert.equal(calls,2);
  for(const bad of ['http://evil.example/resource/cellar/x','https://publications.europa.eu.evil.example/','https://user@publications.europa.eu/resource/celex/52025PC0087','https://publications.europa.eu:8443/resource/celex/52025PC0087','file:///tmp/a','https://publications.europa.eu/resource/celex/52025PC0087?x=1','https://publications.europa.eu/login'])assert.throws(()=>cellarTransportUrl(bad,{redirect:true}));
  const bad=new CellarDocuments(sourceOptions(async()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}})));await assert.rejects(bad.docx(i),{code:'cellar_url'});
  const otherItem=new CellarDocuments(sourceOptions(async()=>new Response(null,{status:302,headers:{location:url.replace('/DOC_1','/DOC_2')}})));await assert.rejects(otherItem.docx(i),{code:'cellar_redirect_identity'});
  const loop=new CellarDocuments(sourceOptions(async()=>new Response(null,{status:302,headers:{location:url}})));await assert.rejects(loop.docx(i),{code:'cellar_redirect'});
});
test('cache coalesces, persists content hashes, conditionally refreshes, and retains old data on errors',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'proposal-cache-'));let now=1000,calls=0,mode='ok',headers=[];
  const fetchSource=async(_url,options)=>{calls++;headers.push(options.headers);if(mode==='304')return new Response(null,{status:304,headers:{etag:'"v1"'}});if(mode==='fail')throw new Error('upstream failed');if(mode==='invalid')return content(Buffer.from('not a ZIP'));return content(docx(),{etag:'"v1"','last-modified':'Wed, 21 Oct 2026 12:00:00 GMT'});};
  try {
    const options={...sourceOptions(fetchSource),directory,clock:()=>now,freshMs:10},docs=new CellarDocuments(options),i=item();
    const [a,b]=await Promise.all([docs.docx(i),docs.docx(i)]);assert.equal(calls,1);assert.deepEqual(a.buffer,b.buffer);assert.match(a.source.sha256,/^[a-f0-9]{64}$/);
    assert.equal((await readdir(directory)).filter(n=>n.endsWith('.blob')).length,1);
    const restart=new CellarDocuments(options);assert.deepEqual((await restart.docx(i)).buffer,a.buffer);assert.equal(calls,1);
    now+=20;mode='304';const refreshed=await restart.docx(i);assert.equal(calls,2);assert.equal(headers[1]['If-None-Match'],'"v1"');assert(headers[1]['If-Modified-Since']);assert.equal(refreshed.source.fetchedAt,a.source.fetchedAt);assert.notEqual(refreshed.source.checkedAt,a.source.checkedAt);
    now+=20;mode='invalid';const stale=await restart.docx(i);assert.equal(stale.source.stale,true);assert.equal(stale.source.refreshError,'cellar_docx');assert.deepEqual(stale.buffer,a.buffer);
    await restart.docx(i);assert.equal(calls,3);
    now+=61_000;mode='fail';assert.equal((await restart.docx(i)).source.stale,true);
    const blob=(await readdir(directory)).find(n=>n.endsWith('.blob'));await writeFile(path.join(directory,blob),'corrupt');
    const cold=new CellarDocuments(options);await assert.rejects(cold.docx(i));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('size, MIME, multipart, throttling and cancellation failures remain explicit',async()=>{
  await assert.rejects(limitedCellarBody(new Response('x'.repeat(100)),10),{code:'cellar_size'});
  for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('x',{status:300}),new Response(null,{status:404})]) {
    const docs=new CellarDocuments(sourceOptions(async()=>response));await assert.rejects(docs.docx(item()));
  }
  const sources=new OfficialContextSources({directory:null,fetchSource:async()=>new Response(null,{status:429,headers:{'retry-after':'120'}})}),docs=new CellarDocuments({sources,directory:null});
  await assert.rejects(docs.docx(item()),e=>e.code==='cellar_limited'&&e.retryAfter===120);assert(sources.queues.get('https://publications.europa.eu'));
  const controller=new AbortController(),reason=Object.assign(new Error('closed'),{code:'request_cancelled'});controller.abort(reason);
  await assert.rejects(runWithRequestSignal(controller.signal,()=>docs.docx(item())),e=>e===reason);
});
test('proposalBaseline returns exact buffers and metadata gaps without substituting languages',async()=>{
  const fetchSource=async url=>url.includes('/sparql')?Response.json(JSON.parse(readFileSync(new URL('./fixtures/proposal-52025PC0087-candidates.json',import.meta.url),'utf8'))):url.includes('/celex/')?new Response(xml,{headers:{'content-type':'application/rdf+xml'}}):content();
  const documents=new CellarDocuments(sourceOptions(fetchSource));
  const load=createProposalBaseline({documents,request:async()=>({payload:{data:[report]},url:'https://data.europarl.europa.eu/api/v2/plenary-documents/A-10-2025-0085',fetchedAt:Date.now()})});
  const r=await load({reportId:'A-10-2025-0085',language:'en'});assert.equal(r.status,'available',JSON.stringify(r.gaps));assert.equal(r.items.length,2);assert(Buffer.isBuffer(r.items[0].buffer));assert.equal(r.celex,celex);
  assert.equal((await load({celex,language:'fr'})).status,'language-unavailable');
  assert.equal((await load({reportId:'A-10-2025-0085',celex:'52021PC0206',language:'en'})).status,'unresolved');
  assert.equal((await load({celex,documentReferences:[{field:'DocRef',raw:'COM(2025)87 final/2 – 2025/0039(COD)'}]})).status,'unresolved');
  assert.equal((await load({celex,documentReferences:[{field:'DocRef',raw:'COM(2021)206'}]})).status,'unresolved');
  assert.equal((await load({celex,documentReferences:[{field:'DocRef',raw:'COM(2025)87 – 2025/0040(COD)'}]})).status,'unresolved');
  assert.throws(()=>load({celex:'../../x'}));assert.throws(()=>load({celex,language:'xx'}));
});

test('candidate discovery refuses competing works, corrigenda, missing versions and capped results',()=>{
  const data=JSON.parse(readFileSync(new URL('./fixtures/proposal-52025PC0087-candidates.json',import.meta.url),'utf8')),row=data.results.bindings[0];
  assert.equal(resolveProposalCandidates(data,{celex}).status,'resolved');
  for(const rows of [[],[row,{...row,work:{type:'uri',value:'http://publications.europa.eu/resource/cellar/00000000-0000-0000-0000-000000000001'}}],[{...row,version:{type:'literal',value:'final/2'}}],[{...row,celex:{type:'literal',value:celex+'R(01)'}}],[{...row,version:undefined}],Array(65).fill(row)])assert.equal(resolveProposalCandidates({results:{bindings:rows}},{celex}).status,'unresolved');
});

test('a closing reader cancels its wait while a coalesced reader retains the bounded owner',async()=>{
  let finish,reached,calls=0;const started=new Promise(resolve=>reached=resolve),response=new Promise(resolve=>finish=resolve);
  const docs=new CellarDocuments(sourceOptions(async()=>{calls++;reached();return response;})),i=item(),controller=new AbortController(),reason=Object.assign(new Error('reader closed'),{code:'request_cancelled'});
  const first=runWithRequestSignal(controller.signal,()=>docs.docx(i));await started;
  const second=docs.docx(i);controller.abort(reason);await assert.rejects(first,e=>e===reason);
  finish(content());assert(Buffer.isBuffer((await second).buffer));assert.equal(calls,1);
});
test('metadata cache rejects malformed refreshes and keeps its validated tree',async()=>{
  let now=0,broken=false;
  const fetchSource=async()=>new Response(broken?'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>':xml,{headers:{'content-type':'application/rdf+xml'}});
  const sources=new OfficialContextSources({clock:()=>now,directory:null,fetchSource}),docs=new CellarDocuments({sources,clock:()=>now,directory:null});
  const first=await docs.metadata(celex);now=CELLAR_LIMITS.metadataFreshMs+1;broken=true;
  const stale=await docs.metadata(celex);assert(stale.viewCache.stale);assert.equal(stale.xml,first.xml);
  await Promise.allSettled([...sources.cache.pending.values()]);
  const failed=await docs.metadata(celex);assert.equal(failed.xml,first.xml);assert(failed.viewCache.refreshError);
});
test('a missing annex stays partial and retains the manifest identifying the missing part',async()=>{
  const candidates=JSON.parse(readFileSync(new URL('./fixtures/proposal-52025PC0087-candidates.json',import.meta.url),'utf8'));
  const fetchSource=async url=>url.includes('/sparql')?Response.json(candidates):url.includes('/celex/')?new Response(xml,{headers:{'content-type':'application/rdf+xml'}}):url.endsWith('/DOC_2')?new Response(null,{status:404}):content();
  const load=createProposalBaseline({documents:new CellarDocuments(sourceOptions(fetchSource))});
  const r=await load({celex,language:'en'});assert.equal(r.status,'partial');assert.equal(r.items.length,1);assert(r.gaps.some(g=>g.itemId?.endsWith('/DOC_2')));assert.equal(r.evidence.find(e=>e.kind==='cellar-manifest').items.length,2);
});

test('all recorded localized column headings are accepted by amendment extraction',()=>{
  const rows=JSON.parse(readFileSync(new URL('./fixtures/proposal-comparison-headings.json',import.meta.url),'utf8'));
  const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const p=text=>`<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`;
  for(const row of rows)for(const example of row.examples) {
    const document=`<w:document xmlns:w="urn:word"><w:body>${p('<Amend><NumAm>1</NumAm>')}<w:tbl><w:tr><w:tc>${p(example.left)}</w:tc><w:tc>${p(example.right)}</w:tc></w:tr><w:tr><w:tc>${p('Before')}</w:tc><w:tc>${p('After')}</w:tc></w:tr></w:tbl>${p('</Amend>')}</w:body></w:document>`;
    const result=extractAmendments(archive(Buffer.from('word/document.xml'),Buffer.from(document)),{language:row.language});
    assert.equal(result.amendments[0].baseline,example.category);assert.equal(result.amendments[0].originalText,'Before');assert.equal(result.amendments[0].proposedText,'After');
    assert.equal(result.amendments[0].baselineSource.category,example.category);
    assert.deepEqual(result.amendments[0].baselineSource.headings[0].left,{raw:example.left,category:example.category});
    assert.equal(result.amendments[0].baselineSource.headings[0].right.raw,example.right);
  }
  assert.equal(comparisonHeading('Tairiscint i gcomhair rúin','en').category,'unknown');
  assert.equal(comparisonHeading('Tairiscint i gcomhair rún','ga').category,'unknown');
});

test('CELLAR admission and body deadline reports the app request_timeout error',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const docs=new CellarDocuments(sourceOptions(async()=>new Promise(()=>{})));
  const pending=docs.request(item().itemId.replace('http:','https:'),{accept:CELLAR_DOCX_MIME});
  const rejected=assert.rejects(pending,{code:'request_timeout'});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(20_001);await rejected;
});


test('selected expression rejects unsupported and conflicting versions while the work stays final',()=>{
  const changed=fixture('52025PC0087-expression-final-2');
  assert.equal(changed,xml.replace('>final<','>final/2<'));
  for(const version of ['final/2','draft','final</ns2:version><ns2:version>final/2']) {
    const r=resolveProposalTree(changed.replace('>final/2<','>'+version+'<'),{celex,language:'en'});
    assert.equal(r.status,'unresolved');assert.deepEqual(r.items,[]);
    assert(r.gaps.includes('proposal-expression-version-unresolved'));
  }
});

test('source deadline retains validated stale DOCX content and exposes the refresh error',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=1000,stalled=false;
  const docs=new CellarDocuments({...sourceOptions(async()=>stalled?new Promise(()=>{}):content()),clock:()=>now,freshMs:10}),i=item();
  const old=await docs.docx(i);now+=20;stalled=true;
  const pending=docs.docx(i);await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(20_001);
  const stale=await pending;
  assert.equal(stale.source.stale,true);assert.equal(stale.source.refreshError,'request_timeout');
  assert.deepEqual(stale.buffer,old.buffer);assert.equal(stale.source.checkedAt,old.source.checkedAt);
});

test('origin pause retains validated stale content and proposalBaseline reports its gaps',async()=>{
  let now=1000,calls=0;
  const docs=new CellarDocuments({...sourceOptions(async()=>{calls++;return content();}),clock:()=>now,freshMs:10});
  const candidates=JSON.parse(readFileSync(new URL('./fixtures/proposal-52025PC0087-candidates.json',import.meta.url),'utf8'));
  docs.candidates=async()=>({data:candidates});docs.metadata=async()=>({xml});
  const load=createProposalBaseline({documents:docs}),old=await load({celex});
  assert.equal(old.status,'available');now+=20;
  docs.sources.queues.get('https://publications.europa.eu').backoff(120);
  const stale=await load({celex});
  assert.equal(stale.status,'partial');assert.equal(calls,2);
  for(const [index,entry] of stale.items.entries()) {
    assert.equal(entry.source.stale,true);assert.equal(entry.source.refreshError,'upstream_busy');
    assert.deepEqual(entry.buffer,old.items[index].buffer);
    assert(stale.gaps.some(gap=>gap.code==='stale-content'&&gap.itemId===entry.itemId&&gap.refreshError==='upstream_busy'));
  }
});

test('reader cancellation and expiry propagate even when validated stale content exists',async()=>{
  for(const reason of [cancelledRequest(),requestTimeout()]) {
    let now=1000,finish,reached;
    const started=new Promise(resolve=>reached=resolve),response=new Promise(resolve=>finish=resolve);
    const docs=new CellarDocuments({...sourceOptions(async()=>content()),clock:()=>now,freshMs:10}),i=item();
    const old=await docs.docx(i);now+=20;
    docs.fetchSource=async()=>{reached();return response;};
    const controller=new AbortController(),pending=runWithRequestSignal(controller.signal,()=>docs.docx(i));
    await started;const coalesced=docs.docx(i);
    controller.abort(reason);await assert.rejects(pending,error=>error===reason);
    finish(content());assert.deepEqual((await coalesced).buffer,old.buffer);
  }
});

test('source cancellation propagates without serving stale content or recording a failed refresh',async()=>{
  let now=1000;
  const docs=new CellarDocuments({...sourceOptions(async()=>content()),clock:()=>now,freshMs:10}),i=item();
  await docs.docx(i);now+=20;
  const reason=cancelledRequest();docs.request=async()=>{throw reason;};
  await assert.rejects(docs.docx(i),error=>error===reason);
  assert.equal(docs.failures.size,0);
});

test('shared request owner expiry propagates instead of returning stale content',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=1000;
  const docs=new CellarDocuments({...sourceOptions(async()=>content()),clock:()=>now,freshMs:10});
  await docs.docx(item());now+=20;
  docs.request=()=>waitForRequest(new Promise(()=>{}),requestSignal());
  const pending=docs.docx(item()),rejected=assert.rejects(pending,{code:'request_timeout'});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(45_001);await rejected;
  assert.equal(docs.failures.size,0);
});

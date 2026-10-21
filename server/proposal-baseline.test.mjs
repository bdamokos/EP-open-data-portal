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
import {runWithRequestSignal} from './request-budget.mjs';
import {comparisonHeading,isAmendmentHeading,COMPARISON_HEADINGS} from './amendment-baseline.mjs';
import {extractAmendments} from './amendment-documents.mjs';

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
  }
  assert.equal(comparisonHeading('Tairiscint i gcomhair rúin','ga').category,'unknown');
});

test('CELLAR admission and body deadline reports the app request_timeout error',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const docs=new CellarDocuments(sourceOptions(async()=>new Promise(()=>{})));
  const pending=docs.request(item().itemId.replace('http:','https:'),{accept:CELLAR_DOCX_MIME});
  const rejected=assert.rejects(pending,{code:'request_timeout'});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(20_001);await rejected;
});

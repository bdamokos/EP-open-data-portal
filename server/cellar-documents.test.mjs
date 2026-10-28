import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CellarDocuments,CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME,CELLAR_LIMITS,declaredDocxRepresentation} from './cellar-documents.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {resolveProposalTree} from './commission-proposal-identity.mjs';
import {createProposalBaseline} from './proposal-baseline.mjs';
import {runWithRequestSignal} from './request-budget.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/cellar-docx-negotiation.json',import.meta.url),'utf8'));
const rdf=await readFile(new URL('./fixtures/proposal-52024PC0531.rdf',import.meta.url),'utf8');
const resolved=resolveProposalTree(rdf,fixture),item={...resolved.items[0],celex:fixture.celex,language:resolved.items[0]?.languageUri},url=fixture.source.url;
// Construct small stored OPC packages from attributed native metadata. Full
// source bytes/hash validation is a separate offline source-extension gate.
function archive(entries) {
  const local=[],central=[];let offset=0;
  for(const [key,value] of Object.entries(entries)) {
    const name=Buffer.from(key),body=Buffer.from(value),l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);l.writeUInt32LE(body.length,18);l.writeUInt32LE(body.length,22);l.writeUInt16LE(name.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    local.push(l,name,body);central.push(c,name);offset+=l.length+name.length+body.length;
  }
  const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(local.length/3,8);end.writeUInt16LE(local.length/3,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const entries=()=>({'[Content_Types].xml':fixture.package.contentTypes,'_rels/.rels':fixture.package.relationships,'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Source text.</w:t></w:r></w:p></w:body></w:document>'});
const advertised=(xml=fixture.errorXml)=>new Response(xml,{status:406,headers:{'content-type':'application/xml'}});
const payload=(buffer=archive(entries()),type=fixture.source.headers['Content-Type'])=>new Response(buffer,{headers:{'content-type':type,etag:'"word-package"'}});
function documents(fetchSource,extra={}){return new CellarDocuments({directory:null,sources:new OfficialContextSources({directory:null,fetchSource}),...extra});}

test('attributed metadata binds the exact English COM work to its DOCX manifestation and item',()=>{
  assert.equal(resolved.status,'resolved');assert.equal(resolved.procedure,fixture.procedure);assert.equal(resolved.items.length,1);
  assert.equal(item.itemId.replace('http:','https:'),url);assert.equal(item.language,'http://publications.europa.eu/resource/authority/language/ENG');
  assert.equal(declaredDocxRepresentation(Buffer.from(fixture.errorXml),url),CELLAR_DECLARED_DOCX_MIME);
  assert.equal(resolveProposalTree(rdf,{celex:fixture.celex,language:'ga'}).status,'language-unavailable');
});
test('one declared-type request retains item, language, format, response type and406 provenance',async()=>{
  const calls=[],docs=documents(async(u,o)=>{calls.push({url:u,headers:o.headers});return calls.length===1?advertised():payload();});
  const result=await docs.docx(item);
  assert.equal(calls.length,2);assert(calls.every(c=>c.url===url&&c.headers['Accept-Language']==='eng'));
  assert.deepEqual(calls.map(c=>c.headers.Accept),[CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME]);
  assert.equal(result.source.format,'DOCX');assert.equal(result.source.accept,CELLAR_DECLARED_DOCX_MIME);assert.equal(result.source.contentType,fixture.source.headers['Content-Type']);
  assert.equal(result.source.negotiation.status,406);assert.equal(result.source.negotiation.sha256,fixture.advertisement.sha256);assert.equal(result.source.negotiation.request.accept,CELLAR_DOCX_MIME);
  assert.equal(result.source.expressionId,item.expressionId);assert.equal(result.source.manifestationId,item.manifestationId);
  // The compatibility rule is not keyed to this UUID/CELEX.
  const other={...item,celex:'52025PC0087',itemId:item.itemId.replace('efd95e89','00000001')};let n=0;
  const generic=documents(async()=>++n===1?advertised(fixture.errorXml.replaceAll('efd95e89','00000001')):payload());
  assert.equal((await generic.docx(other)).source.itemId,other.itemId);
});
test('only a bounded, item-bound explicit advertisement enables negotiation',async()=>{
  for(const xml of [fixture.errorXml.replaceAll('application/zip;type=akn4eu','application/zip'),fixture.errorXml.replaceAll('efd95e89','00000001'),fixture.errorXml.replaceAll('<id>406</id>','<id>400</id>'),'not XML',fixture.errorXml+' '.repeat(16*1024)]) {
    let calls=0;const docs=documents(async()=>{calls++;return advertised(xml);});await assert.rejects(docs.docx(item));assert.equal(calls,1);
  }
  let calls=0;const repeated=documents(async()=>{calls++;return advertised();});await assert.rejects(repeated.docx(item),{code:'cellar_unavailable'});assert.equal(calls,2);
});
test('negotiation rejects AKN, bare ZIPs, incorrect OPC contracts and unsupported MIME',async()=>{
  const bad=[];
  bad.push([Buffer.from('<akomaNtoso/>'),CELLAR_DECLARED_DOCX_MIME]);
  const bare=entries();delete bare['[Content_Types].xml'];bad.push([archive(bare),CELLAR_DECLARED_DOCX_MIME]);
  for(const [key,before,after] of [['[Content_Types].xml',CELLAR_DOCX_MIME,'application/xml'],['_rels/.rels','Target="word/document.xml"','Target="https://example.org/word/document.xml" TargetMode="External"'],['word/document.xml','http://schemas.openxmlformats.org/wordprocessingml/2006/main','urn:not-word']]) {
    const e=entries();e[key]=e[key].replace(before,after);bad.push([archive(e),CELLAR_DECLARED_DOCX_MIME]);
  }
  bad.push([archive(entries()),'application/zip'],[archive(entries()),'application/zip;type=other'],[archive(entries()),'text/html']);
  for(const [bytes,type] of bad) {let calls=0;const docs=documents(async()=>++calls===1?advertised():payload(bytes,type));await assert.rejects(docs.docx(item),e=>['cellar_docx','cellar_type'].includes(e.code));assert.equal(calls,2);}
  let n=0;const oversized=documents(async()=>++n===1?advertised():new Response('x',{headers:{'content-type':CELLAR_DECLARED_DOCX_MIME,'content-length':String(CELLAR_LIMITS.itemBytes+1)}}));await assert.rejects(oversized.docx(item),{code:'cellar_size'});
});
test('negotiation obeys origin admission, redirect identity and throttling without probing',async()=>{
  for(const status of [300,429,503])for(const after406 of [false,true]) {
    let calls=0;const docs=documents(async()=>{calls++;return after406&&calls===1?advertised():new Response(null,{status,headers:{'retry-after':'120'}});});
    await assert.rejects(docs.docx(item));assert.equal(calls,after406?2:1);
    if(status!==300)assert(docs.sources.queues.get(new URL(url).origin).snapshot().cooldownMs>0);
  }
  let calls=0;const docs=documents(async()=>++calls===1?advertised():new Response(null,{status:302,headers:{location:url.replace('/DOC_1','/DOC_2')}}));await assert.rejects(docs.docx(item),{code:'cellar_redirect_identity'});assert.equal(calls,2);
  calls=0;const unsafe=documents(async()=>++calls===1?advertised():new Response(null,{status:302,headers:{location:'https://evil.example/'}}));await assert.rejects(unsafe.docx(item),{code:'cellar_url'});assert.equal(calls,2);
  calls=0;const queue=documents(async()=>{calls++;queue.sources.queues.get(new URL(url).origin).backoff(120);return advertised();});await assert.rejects(queue.docx(item),{code:'upstream_busy'});assert.equal(calls,1);
});
test('negotiation shares the original deadline and caller cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const docs=documents(async()=>++calls===1?advertised():new Promise(()=>{}));
  const pending=docs.request(url,{accept:CELLAR_DOCX_MIME,language:'eng'}),rejected=assert.rejects(pending,{code:'request_timeout'});
  await new Promise(r=>setImmediate(r));assert.equal(calls,2);t.mock.timers.tick(20_001);await rejected;
  const controller=new AbortController(),reason=new Error('reader closed');let n=0;
  const cancelled=documents(async()=>{n++;controller.abort(reason);return advertised();});
  await assert.rejects(runWithRequestSignal(controller.signal,()=>cancelled.request(url,{accept:CELLAR_DOCX_MIME})),e=>e===reason);assert.equal(n,1);
});
test('negotiated cache keeps its representation validators, provenance and stale bytes',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'cellar-negotiation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let now=1000,calls=[],mode='negotiate';
  const fetchSource=async(u,o)=>{calls.push(o.headers);if(mode==='negotiate')return o.headers.Accept===CELLAR_DOCX_MIME?advertised():payload();if(mode==='304')return new Response(null,{status:304});return payload(Buffer.from('bad'));};
  const options={directory,clock:()=>now,freshMs:10};const first=documents(fetchSource,options),saved=await first.docx(item);assert.equal(calls.length,2);
  const restart=documents(fetchSource,options);assert.equal((await restart.docx(item)).source.sha256,saved.source.sha256);assert.equal(calls.length,2);
  now+=20;mode='304';const checked=await restart.docx(item);assert.equal(calls[2].Accept,CELLAR_DECLARED_DOCX_MIME);assert.equal(calls[2]['If-None-Match'],'"word-package"');assert.deepEqual(checked.source.negotiation,saved.source.negotiation);assert.equal(checked.source.fetchedAt,saved.source.fetchedAt);
  now+=20;mode='bad';const stale=await restart.docx(item);assert.equal(stale.source.stale,true);assert.equal(stale.source.refreshError,'cellar_docx');assert.deepEqual(stale.buffer,saved.buffer);
  // Validators from an earlier standard-MIME response cannot validate the newly
  // negotiated representation, even if the item bytes happen to be identical.
  let phase=0,seen=[];const standard=documents(async(u,o)=>{seen.push(o.headers);return phase===0?new Response(archive(entries()),{headers:{'content-type':CELLAR_DOCX_MIME,etag:'"standard"'}}):o.headers.Accept===CELLAR_DOCX_MIME?advertised():payload();},{clock:()=>now,freshMs:10});
  await standard.docx(item);phase=1;now+=20;await standard.docx(item);assert.equal(seen[1]['If-None-Match'],'"standard"');assert.equal(seen[2]['If-None-Match'],undefined);
});
test('a missing declared representation retains the raw406 observation in the baseline gap',async()=>{
  const missing=Object.assign(new Error('not acquired'),{code:'missing-declared-representation',source:fixture.advertisement,request:{url,...fixture.source.request}});
  const docs=documents(async(u,o)=>o.headers.Accept===CELLAR_DOCX_MIME?advertised():Promise.reject(missing));
  docs.candidates=async()=>({data:{results:{bindings:[{work:{type:'uri',value:resolved.workId},celex:{type:'literal',value:fixture.celex},version:{type:'literal',value:'final'}}]}}});docs.metadata=async()=>({xml:rdf});
  const result=await createProposalBaseline({documents:docs})({celex:fixture.celex,language:'en'});
  assert.equal(result.status,'unavailable');assert.equal(result.gaps[0].code,'missing-declared-representation');assert.equal(result.gaps[0].source.sha256,fixture.advertisement.sha256);assert.equal(result.gaps[0].negotiation.sha256,fixture.advertisement.sha256);
});

test('a negotiated304 cannot borrow saved bytes from a different representation',async()=>{
  let now=1000,phase=0;
  const docs=documents(async(u,o)=>phase===0?new Response(archive(entries()),{headers:{'content-type':CELLAR_DOCX_MIME,etag:'"standard"'}}):o.headers.Accept===CELLAR_DOCX_MIME?advertised():new Response(null,{status:304}),{clock:()=>now,freshMs:10});
  const old=await docs.docx(item);phase=1;now+=20;
  const stale=await docs.docx(item);assert.equal(stale.source.stale,true);assert.equal(stale.source.refreshError,'cellar_validator');assert.equal(stale.source.accept,CELLAR_DOCX_MIME);assert.deepEqual(stale.buffer,old.buffer);
});

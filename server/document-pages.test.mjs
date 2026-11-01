import test from 'node:test';import assert from 'node:assert/strict';
import {DocumentPages,allowedPdf,pdfEdition,PDF_MAX_BYTES} from './document-pages.mjs';
const id='A-10-2025-0275',url='https://data.europarl.europa.eu/distribution/reds_iPlRp/'+id+'/'+id+'_en.pdf',body=Buffer.from('%PDF-1.7\n%%EOF');
const work=(extra={})=>({id:'eli/dl/doc/'+id,identifier:id,is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'PDF',is_exemplified_by:url}]}],...extra});
const reader=w=>async()=>({payload:{data:[w]}});
test('page reads use only the uniquely declared PDF in the selected language',async()=>{
 let calls=0;const service=new DocumentPages({read:reader(work()),download:async u=>{assert.equal(u,url);calls++;return {body,sha256:'hash'};}});
 const one=await service.query(id,'en');assert.equal(one.language,'en');assert.equal(one.sourceUrl,url);await service.query(id,'en');assert.equal(calls,1);
 await assert.rejects(()=>service.query(id,'fr'),e=>e.code==='pdf_unavailable');assert.equal(calls,1);
});
test('arbitrary URLs, conflicting PDF editions, unsupported IDs and mismatched source identities never download',async()=>{
 const conflicting=work();conflicting.is_realized_by[0].is_embodied_by.push({format:'PDF',is_exemplified_by:url.replace('_en','_v2_en')});assert.equal(pdfEdition(conflicting,'en'),null);
 let calls=0;const service=new DocumentPages({read:reader(work({id:'eli/dl/doc/OTHER'})),download:async()=>{calls++;return {body};}});
 await assert.rejects(()=>service.query(id,'en'));await assert.rejects(()=>service.query('https://example.com/a.pdf','en'));assert.equal(calls,0);
 for(const unsafe of [url.replace('https:','http:'),url+'?x=1',url+'#x',url.replace('data.europarl.europa.eu','evil.example'),url.replace('https://','https://user:pass@')])assert.equal(allowedPdf(unsafe),false);
});
test('invalid bytes and oversized PDFs fail without filling the cache',async()=>{
 for(const b of [Buffer.from('<html/>'),Buffer.alloc(PDF_MAX_BYTES+1)]){
  const service=new DocumentPages({read:reader(work()),download:async()=>({body:b})});await assert.rejects(()=>service.query(id,'en'));assert.equal(service.saved.size,0);
 }
});
test('answer pages require the exact answer relationship in the parent question',async()=>{
 const question='E-10-2025-000001',answer=question+'-ASW',root=work({id:'eli/dl/doc/'+question,identifier:question,inverse_answers_to:[work({id:'eli/dl/doc/'+answer,identifier:answer})]});let endpoint;
 const service=new DocumentPages({read:async path=>{endpoint=path;return {payload:{data:[root]}};},download:async()=>({body})});await service.query(answer,'en');assert.equal(endpoint,'/parliamentary-questions/'+question);
 root.inverse_answers_to=[];await assert.rejects(()=>service.query(answer,'en'));
});

test('PDF hops use HTTP-owned admission and propagate cooldown to the matching origin',async t=>{
 const https=(await import('node:https')).default,{Readable}=await import('node:stream'),{EventEmitter}=await import('node:events');
 const {setUpstreamBridge}=await import('./odp.mjs'),{downloadPdf}=await import('./document-pages.mjs');
 const admissions=[],pauses=[];
 setUpstreamBridge({queue:source=>({run:async(fn,{priority})=>{admissions.push([source,priority]);return fn();},recordResponse:()=>{},backoff:seconds=>pauses.push([source,seconds])})});
 t.after(()=>setUpstreamBridge(null));let hop=0;
 t.mock.method(https,'get',(_url,_options,receive)=>{
  const response=Readable.from([]);response.statusCode=hop++===0?302:429;
  response.headers=hop===1?{location:'https://redmapl3.europarl.europa.eu/RedmapFront/media/redirect.pdf'}:{'retry-after':'60'};
  queueMicrotask(()=>receive(response));return new EventEmitter();
 });
 await assert.rejects(downloadPdf(url,{priority:'background'}),error=>error.retryAfter===60);
 assert.deepEqual(admissions,[['odp','background'],['document-files','background']]);assert.deepEqual(pauses,[['document-files',60]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {advertisedRepresentation,docxXmlSizes,sourceDiagnostics} from './amendment-benchmark-source-diagnostics.mjs';
import {options} from './amendment-benchmark.mjs';
import {CELLAR_DOCX_MIME} from '../server/cellar-documents.mjs';

test('a recorded 406 negotiates only its explicit public AKN representation and keeps it diagnostic',async()=>{
  const meta={url:'https://publications.europa.eu/resource/cellar/efd95e89-a29d-11ef-85f0-01aa75ed71a1.0001.01/DOC_1',request:{accept:CELLAR_DOCX_MIME,language:'eng'},status:406,ok:false,sha256:'recorded',fetchedAt:'2026-10-27T00:00:00Z'};
  const input={...meta,body:Buffer.from('<message>resource mimetype [application/zip;type=akn4eu]</message>')},calls=[];
  const diagnostic=await sourceDiagnostics({get:async()=>input},[meta],{negotiationCache:{get:async(url,options)=>{calls.push({url,options});return {status:200,headers:{'content-type':'application/zip;type=akn4eu'},bytes:123,sha256:'observed',request:options};}}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,meta.url);assert.equal(calls[0].options.accept,'application/zip;type=akn4eu');assert.equal(calls[0].options.language,'eng');
  assert.equal(diagnostic[0].kind,'source-representation-mismatch');assert.equal(diagnostic[0].requestedAccept,CELLAR_DOCX_MIME);assert.equal(diagnostic[0].observation.status,200);
  assert.equal(meta.status,406,'the frozen source observation remains unchanged');
  assert.equal(advertisedRepresentation({...input,body:Buffer.from('Accept */* instead')}),null);
  assert.equal(advertisedRepresentation({...input,status:200}),null);
  assert.equal((await sourceDiagnostics({get:async()=>input},[meta]))[0].observation,undefined,'offline diagnostics never fetch another representation');
});

test('XML size diagnostics inspect the ZIP directory without inflating document content',()=>{
  const name=Buffer.from('word/document.xml'),central=Buffer.alloc(46),end=Buffer.alloc(22);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(8_602_381,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(0,16);
  const bytes=Buffer.concat([central,name,end]);
  assert.deepEqual(docxXmlSizes(bytes),{parts:[{name:'word/document.xml',bytes:8_602_381}],totalXmlBytes:8_602_381});
  assert.equal(docxXmlSizes(Buffer.from('not zip')),null);
});

test('negotiated diagnostic requests keep the public acquisition pacing floor',()=>{
  assert.throws(()=>options(['--diagnose-sources','--source-negotiation-cache','/tmp/diagnostic','--delay-ms','0']),/at least 750/);
  assert.throws(()=>options(['--source-negotiation-cache','/tmp/diagnostic']),/requires --diagnose-sources/);
});

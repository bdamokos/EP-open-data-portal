import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {bindCitationNativeInputs,pairedCitationVerification,CITATION_CALIBRATION_MODE} from './amendment-benchmark-citation-bindings.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-citation-native.json',import.meta.url)));
const projection=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-citation-excerpts.json',import.meta.url)));
function zip(body) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
function input() {
  const documentId='B-10-2026-0424',listId=documentId+'-AM-073-082',number=73;
  const amendment=fixture.amendments.find(row=>row.number===number),wording={...amendment.wording,listId,targetDocumentId:documentId};
  const motionUrl='https://data.europarl.europa.eu/distribution/reds_iPlRe/'+documentId+'/'+documentId+'_en.docx',amendmentUrl=amendment.source.url;
  const resolve=url=>url.replace('https://data.europarl.europa.eu/distribution/','https://redmapl3.europarl.europa.eu/RedmapFront/media/');
  const work={id:'eli/dl/doc/'+documentId,identifier:documentId,work_type:'def/ep-document-types/RESOLUTION_MOTION',is_realized_by:[{id:'eli/dl/doc/'+documentId+'/en',language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{id:'eli/dl/doc/'+documentId+'/en/docx',format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:motionUrl}]}]};
  const inputs=[],add=(url,body,extra={})=>{const value={url,fetchedAt:'2026-10-27T17:08:03.604Z',status:200,ok:true,bytes:body.length,sha256:hash(body),error:null,headers:{},...extra,body};inputs.push(value);return value;};
  const metadataUrl='https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId+'?format=application%2Fld%2Bjson';
  const metadata=add(metadataUrl,Buffer.from(JSON.stringify({data:[work]})),{request:{accept:'application/ld+json'}});
  add(motionUrl,Buffer.alloc(0),{status:302,redirectUrl:resolve(motionUrl),headers:{location:resolve(motionUrl)}});
  const motion=add(resolve(motionUrl),zip('<w:p/>'.repeat(17)+fixture.motionParagraphs.map(row=>row.xml).join('')));
  add(amendmentUrl,Buffer.alloc(0),{status:302,redirectUrl:resolve(amendmentUrl),headers:{location:resolve(amendmentUrl)}});
  const source=add(resolve(amendmentUrl),zip(amendment.bodyXml));
  const manifest=()=>inputs.map(({body,...meta})=>meta),calls=[];
  const readObservation=async(url,request)=>{calls.push({url,request});return inputs.find(row=>row.url===url&&JSON.stringify(row.request)===JSON.stringify(request));};
  return {offline:true,manifest:manifest(),readObservation,documentId,listId,number,language:'en',wording,motionSource:{...motion,url:motionUrl},amendmentSource:{...source,url:amendmentUrl,resolvedSourceUrl:source.url},work,metadata,inputs,manifestForInputs:manifest,calls};
}
const refreshMetadata=arg=>{arg.metadata.body=Buffer.from(JSON.stringify({data:[arg.work]}));arg.metadata.bytes=arg.metadata.body.length;arg.metadata.sha256=hash(arg.metadata.body);arg.manifest=arg.manifestForInputs();};

test('native inputs retain exact requests, all redirect observations, language and response hashes',async()=>{
  const arg=input(),result=await bindCitationNativeInputs(arg);
  assert.equal(result.status,'bound');assert.equal(result.binding.motion.length,2);assert.equal(result.binding.amendment.length,2);
  assert.deepEqual(result.binding.metadata.request,{accept:'application/ld+json'});
  assert.equal(result.binding.declaration.language,'http://publications.europa.eu/resource/authority/language/ENG');
  assert.equal(result.binding.motion.at(-1).sha256,hash(result.nativeCitation.motionBuffer));
  assert.equal(result.binding.amendment.at(-1).sha256,hash(result.nativeCitation.amendmentBuffer));
  assert.equal(arg.calls.length,5);
});
test('missing retained observations never trigger a callback or source substitution',async()=>{
  const arg=input(),missing=arg.manifest[2].url;arg.manifest=arg.manifest.filter(row=>row.url!==missing);
  assert.equal((await bindCitationNativeInputs(arg)).status,'unavailable');assert.ok(!arg.calls.some(call=>call.url===missing));
  const unsealed=input();unsealed.offline=false;assert.equal((await bindCitationNativeInputs(unsealed)).status,'unavailable');assert.equal(unsealed.calls.length,0);
});
test('legacy captured redirectUrl remains exact when the original observation omitted response headers',async()=>{
  const arg=input();delete arg.inputs[3].headers;arg.manifest=arg.manifestForInputs();
  const result=await bindCitationNativeInputs(arg);assert.equal(result.status,'bound');
  assert.ok(!Object.hasOwn(result.binding.amendment[0],'headers'));
  assert.equal(result.binding.amendment[0].redirectUrl,arg.inputs[4].url);
});
test('retained bytes, request headers and metadata cannot disagree with their sealed observations',async()=>{
  const body=input();body.inputs[2].body=Buffer.from('different bytes');await assert.rejects(bindCitationNativeInputs(body),/differs from sealed manifest/);
  const request=input();request.inputs[0].request={accept:'application/json'};await assert.rejects(bindCitationNativeInputs(request),/differs from sealed manifest/);
  const time=input();time.inputs[2].fetchedAt='2026-10-28T00:00:00.000Z';await assert.rejects(bindCitationNativeInputs(time),/differs from sealed manifest/);
});
test('wrong work identity, language and competing distributions remain unsupported',async()=>{
  for(const change of [arg=>arg.work.identifier='B-10-2026-0425',arg=>arg.work.work_type='def/ep-document-types/REPORT_PLENARY',arg=>arg.work.is_realized_by[0].language='http://publications.europa.eu/resource/authority/language/FRA',arg=>arg.work.is_realized_by[0].is_embodied_by.push({...arg.work.is_realized_by[0].is_embodied_by[0]})]) {
    const arg=input();change(arg);refreshMetadata(arg);assert.equal((await bindCitationNativeInputs(arg)).status,'unavailable',String(change));
  }
});
test('redirects cannot switch language, owner or leave the retained approved source chain',async()=>{
  for(const suffix of ['_fr.docx','/unrelated_en.docx']){
    const arg=input();arg.inputs[1].redirectUrl=arg.inputs[1].redirectUrl.replace('_en.docx',suffix);arg.inputs[1].headers.location=arg.inputs[1].redirectUrl;arg.manifest=arg.manifestForInputs();
    assert.equal((await bindCitationNativeInputs(arg)).status,'unavailable');
  }
  const arg=input();arg.inputs[1].headers.location='https://example.test/source.docx';arg.manifest=arg.manifestForInputs();assert.equal((await bindCitationNativeInputs(arg)).status,'unavailable');
});
test('runtime source selection, list identity and resolved buffers must equal the native binding',async()=>{
  for(const change of [arg=>arg.motionSource.sha256='0'.repeat(64),arg=>arg.amendmentSource.fetchedAt='2026-10-28T00:00:00.000Z',arg=>arg.amendmentSource.resolvedSourceUrl=arg.amendmentSource.url,arg=>arg.amendmentSource.body=Buffer.from('substitute'),arg=>arg.wording.listId+='x',arg=>arg.wording.number++]) {
    const arg=input();change(arg);assert.equal((await bindCitationNativeInputs(arg)).status,'unavailable',String(change));
  }
});
function pair(arg) {
  return {mode:CITATION_CALIBRATION_MODE,canonical:{status:'failed',reason:'oracle-original-span-mismatch'},cache:{manifest:()=>arg.manifest,fetchMissing:false,cap:0,sealed:new Set(arg.manifest.map(row=>row.request?JSON.stringify([row.url,row.request]):row.url)),get:(url,options)=>arg.readObservation(url,options.accept?{accept:options.accept,...(options.language?{language:options.language}:{})}:undefined)},row:{targetDocumentId:arg.documentId,number:arg.number},variant:{listId:arg.listId,language:arg.language},fetched:arg.amendmentSource,text:{...structuredClone(projection),textLanguage:'en',sourceInput:arg.motionSource},wording:arg.wording,placement:{status:'placed',operation:'replace',span:{start:2,end:2}}};
}
test('one supplied-byte proof records both classifications and full raw assertions without changing canonical results',async()=>{
  const arg=input(),request=pair(arg),result=await pairedCitationVerification(request);
  assert.deepEqual(result.canonical,request.canonical);assert.equal(result.proposed.status,'verified');assert.equal(result.accepted,false);assert.equal(result.changed,true);
  assert.equal(result.native.assertion.nativePreamble.length,20);assert.equal(result.rawComparison.originalText,arg.wording.originalText);assert.equal(result.binding.motion.at(-1).sha256,result.native.assertion.motionSha256);
});
test('unsupported or failed native proof and every other canonical result remain unchanged',async()=>{
  const arg=input(),request=pair(arg);request.placement.span={start:3,end:3};
  const wrong=await pairedCitationVerification(request);assert.equal(wrong.native.status,'failed');assert.deepEqual(wrong.proposed,request.canonical);
  const missing=input(),missingRequest=pair(missing);missing.manifest=[];assert.deepEqual((await pairedCitationVerification(missingRequest)).proposed,missingRequest.canonical);
  const unplaced=input(),unplacedRequest=pair(unplaced);unplacedRequest.canonical={status:'not-applicable',reason:'not-placed'};unplacedRequest.placement.status='unresolved';assert.deepEqual((await pairedCitationVerification(unplacedRequest)).proposed,unplacedRequest.canonical);
  await assert.rejects(pairedCitationVerification({...pair(input()),mode:undefined}),/Explicit citation calibration mode/);
});

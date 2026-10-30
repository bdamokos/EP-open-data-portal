import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {retainedSourceSelection,compareSelection} from './amendment-benchmark-selection.mjs';
import {options,contextUrl,evaluateReport} from './amendment-benchmark.mjs';
import {replayRuntime} from './amendment-benchmark-replay.mjs';
import {metrics} from './amendment-benchmark-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),apiBase='https://explorer.example';
const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body>'+xml+'</w:body></w:document>'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
async function fixture(t,kind='declared-list',change=()=>{}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'source-selection-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const report=kind==='report-list',documentId=(report?'A':'B')+'-10-2026-0001',listId=documentId+'-AM-001-001',id=documentId+'-AM-1';
  const declaredUrl='https://data.europarl.europa.eu/distribution/test/'+(report?documentId:listId)+'_en.docx';
  const url=report?'https://redmapl3.europarl.europa.eu/RedmapFront/media/test/'+documentId+'_en.docx':declaredUrl;
  const cell=value=>'<w:tc>'+p(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const body=docx((report?p('<NoDocSe>A10-0001/2026</NoDocSe>')+p('<RepeatBlock-Amend>'):'')+p('<Amend><NumAm>1</NumAm>')+p('<Article>Paragraph 1</Article>')+'<w:tbl>'+tr('Motion for a resolution','Amendment')+tr('Original wording.','Changed wording.')+'</w:tbl>'+p('</Amend>')+(report?p('</RepeatBlock-Amend>'):''));
  const realization={language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:declaredUrl}]};
  const list={id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:'eli/dl/doc/'+documentId,itemNumberBegin:'1',itemNumberEnd:'1',...(report?{}:{is_realized_by:[realization]})};
  const work={id:'eli/dl/doc/'+documentId,identifier:documentId,work_type:'def/ep-document-types/'+(report?'REPORT_PLENARY':'RESOLUTION_MOTION'),inverse_foresees_change_of:[list],...(report?{is_realized_by:[realization]}:{})};
  const parentUrl='https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId+'?format=application%2Fld%2Bjson';
  const manifest=[],supplement=[];
  async function seed(folder,entries,url,body,{request,status=200}={}) {
    await mkdir(folder,{recursive:true});const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
    const meta={url,fetchedAt:'2026-10-27T12:00:00.000Z',status,ok:status===200,bytes:bytes.length,sha256:digest(bytes),error:status===200?null:'http-'+status,...(request?{request}:{})};
    const key=digest(request?JSON.stringify([url,request]):url);await writeFile(path.join(folder,key+'.json'),JSON.stringify(meta));await writeFile(path.join(folder,key+'.body'),bytes);entries.push(meta);return meta;
  }
  change({work,list,body});
  const baseDir=path.join(directory,'base'),extraDir=path.join(directory,'extra');await mkdir(extraDir);
  const parent=await seed(baseDir,manifest,parentUrl,{data:[work]},{request:{accept:'application/ld+json'}});
  const plainUrl=contextUrl(apiBase,documentId,'en');await seed(baseDir,manifest,plainUrl,{documentId,document:{selectedText:{status:'unavailable',availableTextLanguages:['en'],paragraphs:[]}}});
  const missingList='https://data.europarl.europa.eu/api/v2/documents/'+listId+'?format=application%2Fld%2Bjson';await seed(baseDir,manifest,missingList,{error:'not found'},{status:404});
  await seed(report?baseDir:extraDir,report?manifest:supplement,url,body);
  const order=(a,b)=>a.url.localeCompare(b.url,'en')||JSON.stringify(a.request||{}).localeCompare(JSON.stringify(b.request||{}),'en');manifest.sort(order);supplement.sort(order);
  const cache=new InputCache(baseDir,{apiBase,fetchMissing:false,cap:0});await cache.seal(manifest);
  const sample={mode:'plenary-weeks',asOf:'2026-10-27',weeks:['2026-10-19']};
  const row={id,number:1,targetDocumentId:documentId,language:null,listId:null,variants:[],decisions:[{id:'vote',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const config={schemaVersion:1,baseSnapshotId:'sealed-example',supplement:{directory:extraDir,manifest:supplement},bindings:[{id,documentId,number:1,listId,language:'en',kind,parent:{url:parentUrl,request:parent.request,sha256:parent.sha256,fetchedAt:parent.fetchedAt},source:{url,declaredUrl,sha256:digest(body)}}]};
  const filename=path.join(directory,'selection.json'),runtime=await replayRuntime(root),snapshot={snapshotId:'sealed-example'};
  const create=async()=>{await writeFile(filename,JSON.stringify(config));return retainedSourceSelection({file:filename,snapshot,cache,runtime});};
  return {directory,config,create,cache,manifest,supplement,plainUrl,missingList,row,sample,runtime,url,filename};
}

test('retained declaration selection preserves captured catalogue fields, null language and404 observations',async t=>{
  const f=await fixture(t),before=structuredClone(f.row),manifest=structuredClone(f.cache.manifest()),selection=await f.create();
  const [row]=selection.apply([f.row],f.sample,contextUrl);assert.deepEqual(f.row,before);assert.equal(row.language,null);assert.equal(row.variants[0].language,'en');
  assert.equal(row.variants[0].wordingSource.url,f.url);assert.deepEqual(f.cache.manifest(),manifest);
  const missing=await selection.cache.get(f.missingList);assert.equal(missing.status,404);assert.equal(missing.fetchedAt,'2026-10-27T12:00:00.000Z');
  const context=contextUrl(apiBase,f.row.targetDocumentId,'en',row.variants[0],row);
  const absence=await selection.comparison(context);assert.equal(absence.value,null);assert.equal(absence.input.status,null);assert.equal(absence.input.role,'internal-processing-absence-not-HTTP');
  assert(!selection.cache.manifest().some(entry=>entry.url===context));assert.deepEqual((await selection.comparison(f.plainUrl)).value.document.selectedText.availableTextLanguages,['en']);
  assert.equal(selection.receipt().derived.length,1);assert.equal(selection.cache.requests,0);
});

test('a fileless list uses exact retained native report bytes without inventing a distribution response',async t=>{
  const f=await fixture(t,'report-list'),selection=await f.create();const [row]=selection.apply([f.row],f.sample,contextUrl);
  assert.equal(row.variants[0].wordingSource.reportId,f.row.targetDocumentId);assert.equal(row.variants[0].wordingSource.url,f.url);
  assert.equal((await selection.cache.get(f.url)).url,f.url);assert(!selection.cache.manifest().some(x=>x.url===f.config.bindings[0].source.declaredUrl));
  await assert.rejects(evaluateReport([row],f.sample,f.cache,{runtime:f.runtime}),/Unsupported indexed DOCX URL/);
  const [result]=await evaluateReport([row],f.sample,selection.cache,{runtime:f.runtime,selection});
  assert.equal(result.stages.S2.status,'passed');assert.equal(result.wordingSource.url,f.url);assert.equal(result.wordingSource.resolvedSourceUrl,f.url);assert.equal(result.stages.S5.status,'unresolved');
  assert.equal(selection.receipt().proofs[0].unobservedRedirectClaimed,false);
});

test('a retained report with the wrong native cover cannot supply list wording',async t=>{
  const f=await fixture(t,'report-list',({body})=>{const marker=Buffer.from('A10-0001/2026'),offset=body.indexOf(marker);assert(offset>=0);Buffer.from('A10-0002/2026').copy(body,offset);});
  await assert.rejects(f.create(),/native report cover\/main range mismatch/);
});

for(const [label,change,reason] of [
  ['wrong forward parent',f=>f.list.foresees_change_of='eli/dl/doc/B-10-2026-9999',/forward parent mismatch/],
  ['wrong list type',f=>f.list.work_type='def/ep-document-types/REPORT_PLENARY',/list type/],
  ['wrong range',f=>f.list.itemNumberEnd='2',/published list range/],
])test('selection rejects '+label,async t=>{const f=await fixture(t,'declared-list',change);await assert.rejects(f.create(),reason);});

test('the sealed source and parent observations cannot be substituted',async t=>{
  const f=await fixture(t);f.config.bindings[0].parent.sha256='0'.repeat(64);await assert.rejects(f.create(),/parent observation mismatch/);
  const g=await fixture(t);g.config.bindings[0].source.sha256='0'.repeat(64);await assert.rejects(g.create(),/source hash\/status mismatch/);
});

test('a supplementary observation cannot replace an older response for the same request',async t=>{
  const f=await fixture(t),entry={...f.manifest.find(x=>x.request),fetchedAt:'2026-10-28T12:00:00.000Z'};
  const key=digest(JSON.stringify([entry.url,entry.request])),extra=f.config.supplement.directory;
  await writeFile(path.join(extra,key+'.json'),JSON.stringify(entry));
  await writeFile(path.join(extra,key+'.body'),await readFile(path.join(f.directory,'base',key+'.body')));
  f.config.supplement.manifest.push(entry);f.config.supplement.manifest.sort((a,b)=>a.url.localeCompare(b.url,'en'));
  await assert.rejects(f.create(),/conflicting captured observation/);
});

test('source selection never replaces indexed wording or silently drops a binding outside the sample',async t=>{
  const f=await fixture(t),selection=await f.create();
  assert.throws(()=>selection.apply([{...f.row,variants:[{language:'en',listId:'published',wordingSource:{url:f.url}}]}],f.sample,contextUrl),/cannot override indexed wording/);
  assert.throws(()=>selection.apply([{...f.row,decisions:[]}],f.sample,contextUrl),/outside exact catalogue\/sample/);
  assert.throws(()=>selection.receipt(),/not every binding/);
});

test('an unrelated absent input stays fatal even if a downstream reader catches it',async t=>{
  const f=await fixture(t),selection=await f.create();
  await assert.rejects(selection.cache.get('https://publications.europa.eu/resource/celex/unknown'),/input not captured/);
  assert.throws(()=>selection.cache.assertHealthy(),/input not captured/);
  await assert.rejects(selection.comparison(f.plainUrl+'&other=1'),/input not captured/);
});

test('source selection is explicit, offline and incompatible with acquisition or other sample modes',()=>{
  assert.equal(options(['--source-selection','/tmp/selection.json','--request-cap','0']).sourceSelection,'/tmp/selection.json');
  for(const args of [[],['--fetch'],['--acquire-only'],['--placement-only'],['--language-variants'],['--diagnose-sources'],['--languages']]) {
    const request=args.length?['--request-cap','0',...args]:[];
    assert.throws(()=>options(['--source-selection','/tmp/selection.json',...request]),/requires offline/);
  }
});

test('baseline comparison refuses a different processing selector even on identical HTTP inputs',()=>{
  const row={key:'one',id:'one',documentType:'B/RC-resolution',language:'en',outcome:'correct',reason:'oracle-verified',voteIds:[],patterns:[]};
  const report={sample:{},snapshotId:'same',inputs:[],projectionMode:'cached-source-replay',rows:[row],metrics:metrics([row]),sourceSelection:{id:'first'}};
  assert.throws(()=>compareSelection({...report,sourceSelection:{id:'second'}},report),/selection identity differs/);
});

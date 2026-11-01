import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {RetainedInputs} from './amendment-benchmark-retained.mjs';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {options,evaluateReport,main} from './amendment-benchmark.mjs';
const url='https://publications.europa.eu/resource/cellar/efd95e89-a29d-11ef-85f0-01aa75ed71a1.0001.01/DOC_1';
const accept='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'retained-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const name of ['index','corpus','cache/commission-proposals-v1'])await mkdir(path.join(root,name),{recursive:true});
 for(const name of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite'])execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE meta (key TEXT, value TEXT)');c.commit();c.close()",path.join(root,name)]);
 const body=Buffer.from('exact retained bytes'),language='http://publications.europa.eu/resource/authority/language/ENG',celex='52026PC0001',itemId=url.replace('https:','http:'),identity=JSON.stringify([celex,language,itemId,'docx']),key=digest(identity);
 const source={schemaVersion:1,key,identity,celex,language,itemId,url,resolvedSourceUrl:url,format:'DOCX',accept,contentType:accept,sha256:digest(body),fetchedAt:'2026-10-30T12:00:00Z',checkedAt:'2026-10-30T12:00:00Z'};
 const file=path.join(root,'cache/commission-proposals-v1',key+'.json');
 await writeFile(file,JSON.stringify(source));await writeFile(path.join(path.dirname(file),source.sha256+'.blob'),body);
 return {root,body,source,file};
}
test('explicit mode preserves defaults and rejects acquisition combinations',()=>{
 assert.equal(options([]).productionDataDir,undefined);
 assert.equal(options(['--production-data-dir','/explicit/path']).productionDataDir,'/explicit/path');
 for(const flags of [['--fetch'],['--languages'],['--source-negotiation-cache','/tmp/other'],['--api-base','https://data.europarl.europa.eu']])assert.throws(()=>options(['--production-data-dir','/explicit/path',...flags]));
});
test('copies exact attested bytes and gaps into an independently sealed offline cache; transport only sees explorer API',async t=>{
 const f=await fixture(t),reader=await RetainedInputs.open(f.root),before=await readFile(f.file);
 const directory=await mkdtemp(path.join(os.tmpdir(),'retained-inputs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let calls=0;
 const cache=new InputCache(directory,{retained:reader,apiBase:'https://explorer.test',fetchMissing:true,delay:0,fetcher:async input=>{calls++;assert.equal(new URL(input).origin,'https://explorer.test');return new Response('{}');}});
 const input=await cache.get(url,{accept,language:'eng'});assert.deepEqual(input.body,f.body);assert.equal(input.fetchedAt,f.source.fetchedAt);assert.equal(calls,0);
 const missing=await cache.get('https://data.europarl.europa.eu/distribution/missing.docx');assert.equal(missing.status,null);assert.equal(missing.error,'acquisition-unavailable');assert.equal(missing.fetchedAt,null);
 await cache.get('https://explorer.test/api/amendments');assert.equal(calls,1);
 const manifest=cache.manifest();await cache.seal(manifest);
 const offline=new InputCache(directory,{apiBase:'https://explorer.test',fetcher:()=>assert.fail('offline network')});await offline.seal(manifest);
 assert.deepEqual((await offline.get(url,{accept,language:'eng'})).body,f.body);assert.equal((await offline.get(missing.url)).status,null);
 assert.deepEqual(await readFile(f.file),before);assert.deepEqual((await readdir(path.join(f.root,'index'))),['activities-v1.sqlite']);assert.deepEqual((await readdir(path.join(f.root,'corpus'))),['corpus-v1.sqlite']);
 assert.equal((await reader.get(url,{accept,language:'fra'})).acquisitionUnavailable,true);
 await assert.rejects(()=>reader.assertSeparate(path.join(f.root,'new-output')),/separate/);
 await symlink(f.root,path.join(directory,'alias'));await assert.rejects(()=>reader.assertSeparate(path.join(directory,'alias/output')),/separate/);
});
test('attestation and byte mismatches fail closed',async t=>{
 for(const mutate of [s=>s.identity+='x',s=>s.sha256='0'.repeat(64),s=>s.resolvedSourceUrl+='x',s=>s.format='XHTML',s=>s.fetchedAt='invalid',s=>s.key='wrong']){
  const f=await fixture(t);mutate(f.source);await writeFile(f.file,JSON.stringify(f.source));
  const reader=await RetainedInputs.open(f.root);
  if(f.source.sha256==='0'.repeat(64))assert.equal((await reader.get(url,{accept,language:'eng'})).acquisitionUnavailable,true);
  else await assert.rejects(()=>reader.get(url,{accept,language:'eng'}),/mismatch/);
 }
 const f=await fixture(t);await writeFile(path.join(path.dirname(f.file),f.source.sha256+'.blob'),'changed');const reader=await RetainedInputs.open(f.root);await assert.rejects(()=>reader.get(url,{accept,language:'eng'}),/hash mismatch/);
});
test('retained MIME checks accept application-supported parameters and preserve the original header',async t=>{
 for(const contentType of [accept+'; charset=utf-8',accept.toUpperCase()+'; Charset=UTF-8']) {
  const f=await fixture(t);f.source.contentType=contentType;await writeFile(f.file,JSON.stringify(f.source));
  const reader=await RetainedInputs.open(f.root),input=await reader.get(url,{accept,language:'eng'});
  assert.deepEqual(input.body,f.body);assert.equal(input.headers['content-type'],contentType);
 }
 for(const contentType of ['application/zip; type=akn4eu','Application/Zip; TYPE=AKN4EU; charset=utf-8']) {
  const f=await fixture(t);f.source.accept='application/zip;type=akn4eu';f.source.contentType=contentType;await writeFile(f.file,JSON.stringify(f.source));
  const reader=await RetainedInputs.open(f.root),input=await reader.get(url,{accept:f.source.accept,language:'eng'});
  assert.equal(input.acquisitionUnavailable,true);assert.equal(input.status,null,'missing negotiation bytes cannot manufacture HTTP evidence');
 }
 for(const contentType of ['application/pdf','application/zip; type=other','application/zip; type=akn4eu; type=other']) {
  const f=await fixture(t);f.source.accept='application/zip;type=akn4eu';f.source.contentType=contentType;await writeFile(f.file,JSON.stringify(f.source));
  const reader=await RetainedInputs.open(f.root);await assert.rejects(()=>reader.get(url,{accept:f.source.accept,language:'eng'}),/attestation mismatch/);
 }
});
test('sidecars reject an uncheckpointed copy without opening SQLite',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'index/activities-v1.sqlite-wal'),'live');await assert.rejects(()=>RetainedInputs.open(f.root),/sidecars/);
});
test('missing wording observations retain rows as acquisition unavailable',async()=>{
 const id='B-10-2026-0001-AM-1',row={id,targetDocumentId:'B-10-2026-0001',number:1,language:'en',listId:'list',wordingSource:{url:'https://data.europarl.europa.eu/distribution/missing.docx'},decisions:[{id:'vote',date:'2026-10-30',sittingId:'MTG-PL-2026-10-30',amendmentIds:[id],source:{url:'https://public.test',fetchedAt:'2026-10-30'}}]};
 const cache={apiBase:'https://explorer.test',get:async()=>({ok:false,status:null,error:'acquisition-unavailable',acquisitionUnavailable:true}),json:async()=>({input:{ok:true},value:{documentId:row.targetDocumentId}})};
 const result=await evaluateReport([row],{mode:'documents',asOf:'2026-11-01'},cache);assert.equal(result.length,1);assert.equal(result[0].outcome,'acquisition-unavailable');
});

test('CLI seals a directory acquisition and replays missing observations without transport or row drops',async t=>{
 const f=await fixture(t),directory=await mkdtemp(path.join(os.tmpdir(),'retained-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const document='B-10-2026-0001',id=document+'-AM-1',row={id,targetDocumentId:document,number:1,language:'en',listId:document+'-AM-001-001',wordingSource:{url:'https://data.europarl.europa.eu/distribution/missing.docx'},decisions:[{id:'vote',date:'2026-10-30',sittingId:'MTG-PL-2026-10-30',amendmentIds:[id],source:{url:'https://public.test',fetchedAt:'2026-10-30'}}]};
 const original=globalThis.fetch;let calls=0;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async input=>{calls++;const u=new URL(input);assert.equal(u.origin,'https://explorer.test');assert.match(u.pathname,/^\/api\/(amendments|document-context\/)/);return new Response(JSON.stringify(u.pathname==='/api/amendments'?{items:[row],total:1,limit:50,offset:0,coverage:{servingGeneration:1}}:{documentId:document}));};
 const args=['--api-base','https://explorer.test','--cache-dir',directory,'--document',document,'--as-of','2026-11-01'];
 await main([...args,'--production-data-dir',f.root,'--acquire-only']);assert.equal(calls,3);
 const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));assert.ok(snapshot.snapshotId);assert.equal(snapshot.manifest.filter(m=>m.acquisitionUnavailable).length,2);
 globalThis.fetch=()=>assert.fail('offline transport');await main(args);
 const files=await readdir(path.join(directory,'output'));const result=JSON.parse(await readFile(path.join(directory,'output',files.find(file=>file.endsWith('.json'))),'utf8'));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].outcome,'acquisition-unavailable');assert.equal(result.metrics.falsePlacements,0);
 await assert.rejects(()=>main([...args,'--production-data-dir',f.root,'--acquire-only']),/new empty/);
});

const epUrl='https://data.europarl.europa.eu/distribution/reds_iPlRp/A-10-2026-0001/A-10-2026-0001_en.docx';
async function v2Fixture(t,{mutate=()=>{},missingBlob=false}={}) {
 const f=await fixture(t),body=Buffer.from('native retained report bytes');
 const row={url:epUrl,language:'en',byte_size:body.length,issued:'2026-10-29T00:00:00Z',sha256:digest(body),size:body.length,retrieved_at:'2026-10-30T12:00:00Z',list_id:'A-10-2026-0001-AM-001-002'};mutate(row);
 execFileSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
c.execute('CREATE TABLE amendment_sources(url TEXT, language TEXT, byte_size INTEGER, issued TEXT, sha256 TEXT, size INTEGER, retrieved_at TEXT, list_id TEXT)')
c.execute('INSERT INTO amendment_sources VALUES (?,?,?,?,?,?,?,?)',list(json.loads(sys.argv[2]).values()))
c.commit();c.close()`,path.join(f.root,'index/activities-v1.sqlite'),JSON.stringify(row)]);
 await mkdir(path.join(f.root,'index/amendment-docx-v2'));
 const blob=path.join(f.root,'index/amendment-docx-v2',row.sha256+'.docx');
 if(!missingBlob)await writeFile(blob,body);
 return {...f,row,blob,native:body};
}
test('v2 report fallback bytes work without cache and preserve the entire supplied tree',async t=>{
 const f=await v2Fixture(t);await rm(path.join(f.root,'cache'),{recursive:true});
 const db=path.join(f.root,'index/activities-v1.sqlite'),before=await readFile(db),blobBefore=await readFile(f.blob);
 const reader=await RetainedInputs.open(f.root),input=await reader.get(epUrl);
 assert.deepEqual(input.body,f.native);assert.equal(input.sha256,f.row.sha256);assert.equal(input.fetchedAt,f.row.retrieved_at);
 assert.equal(input.retainedSource.descriptor.language,'en');assert.equal(input.retainedSource.listId,f.row.list_id);
 const gap=await reader.get(url,{accept,language:'eng'});assert.equal(gap.acquisitionUnavailableReason,'retained-cache-missing');assert.equal(gap.status,null);
 assert.deepEqual(await readFile(db),before);assert.deepEqual(await readFile(f.blob),blobBefore);
 assert.deepEqual((await readdir(f.root)).sort(),['corpus','index']);assert.deepEqual((await readdir(path.dirname(db))).sort(),['activities-v1.sqlite','amendment-docx-v2']);
 assert.equal((await reader.get(epUrl,{accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',language:'fr'})).acquisitionUnavailableReason,'amendment-source-request-mismatch');
});
test('v2 missing table, attestation and blob are explicit gaps',async t=>{
 const f=await fixture(t);assert.equal((await (await RetainedInputs.open(f.root)).get(epUrl)).acquisitionUnavailableReason,'amendment-sources-table-missing');
 const v=await v2Fixture(t,{missingBlob:true}),reader=await RetainedInputs.open(v.root);
 assert.equal((await reader.get(epUrl)).acquisitionUnavailableReason,'amendment-source-blob-missing');
 assert.equal((await reader.get(epUrl.replace('_en','_fr'))).acquisitionUnavailableReason,'amendment-source-attestation-missing');
});
test('v2 malformed descriptors, stale retrievals, wrong hash and sizes fail closed without repair',async t=>{
 for(const mutate of [r=>r.sha256='0'.repeat(64),r=>r.size++,r=>r.byte_size++,r=>r.language='',r=>r.issued='invalid',r=>r.retrieved_at='2026-01-01',r=>r.list_id='unrelated']) {
  const f=await v2Fixture(t,{mutate}),db=path.join(f.root,'index/activities-v1.sqlite'),before=await readFile(db),blob=await readFile(f.blob);
  await assert.rejects(()=>(RetainedInputs.open(f.root)).then(reader=>reader.get(epUrl)),/mismatch/);
  assert.deepEqual(await readFile(db),before);assert.deepEqual(await readFile(f.blob),blob);
 }
});
test('v2 URL ambiguity and symlink escapes never choose another source',async t=>{
 const f=await v2Fixture(t);
 execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(\"INSERT INTO amendment_sources SELECT url,'fr',byte_size,issued,sha256,size,retrieved_at,list_id FROM amendment_sources\");c.commit();c.close()",path.join(f.root,'index/activities-v1.sqlite')]);
 await assert.rejects(()=>(RetainedInputs.open(f.root)).then(reader=>reader.get(epUrl)),/Ambiguous/);
 const v=await v2Fixture(t),outside=await mkdtemp(path.join(os.tmpdir(),'retained-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 await writeFile(path.join(outside,'bytes'),v.native);await rm(v.blob);await symlink(path.join(outside,'bytes'),v.blob);
 await assert.rejects(()=>(RetainedInputs.open(v.root)).then(reader=>reader.get(epUrl)),/escapes/);
});
test('v2 acquisition seals bytes and unavailable Cellar metadata for offline replay without upstream transport',async t=>{
 const f=await v2Fixture(t);await rm(path.join(f.root,'cache'),{recursive:true});
 const directory=await mkdtemp(path.join(os.tmpdir(),'retained-v2-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=new InputCache(directory,{retained:await RetainedInputs.open(f.root),apiBase:'https://explorer.test',fetchMissing:true,fetcher:()=>assert.fail('upstream transport')});
 assert.deepEqual((await cache.get(epUrl)).body,f.native);assert.equal((await cache.get(url,{accept,language:'eng'})).acquisitionUnavailableReason,'retained-cache-missing');
 const manifest=cache.manifest();await cache.seal(manifest);
 const offline=new InputCache(directory,{apiBase:'https://explorer.test',fetcher:()=>assert.fail('offline transport')});await offline.seal(manifest);
 assert.deepEqual((await offline.get(epUrl)).body,f.native);assert.equal((await offline.get(url,{accept,language:'eng'})).status,null);
});
test('CLI acquire-only seals v2 bytes without cache or upstream requests',async t=>{
 const f=await v2Fixture(t);await rm(path.join(f.root,'cache'),{recursive:true});
 const directory=await mkdtemp(path.join(os.tmpdir(),'retained-v2-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const document='A-10-2026-0001',id=document+'-AM-1',row={id,targetDocumentId:document,number:1,language:'en',listId:f.row.list_id,wordingSource:{url:epUrl,reportId:document},decisions:[{id:'vote',date:'2026-10-30',sittingId:'MTG-PL-2026-10-30',amendmentIds:[id],source:{url:'https://public.test',fetchedAt:'2026-10-30'}}]};
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async input=>{const u=new URL(input);assert.equal(u.origin,'https://explorer.test');return new Response(JSON.stringify(u.pathname==='/api/amendments'?{items:[row],total:1,limit:50,offset:0,coverage:{servingGeneration:1}}:{documentId:document}));};
 await main(['--api-base','https://explorer.test','--cache-dir',directory,'--document',document,'--as-of','2026-11-01','--production-data-dir',f.root,'--acquire-only']);
 const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));
 assert.equal(snapshot.manifest.find(m=>m.url===epUrl).sha256,f.row.sha256);
 const offline=new InputCache(path.join(directory,'inputs'),{apiBase:'https://explorer.test',fetcher:()=>assert.fail('offline upstream')});await offline.seal(snapshot.manifest);assert.deepEqual((await offline.get(epUrl)).body,f.native);
 assert.deepEqual((await readdir(f.root)).sort(),['corpus','index']);
});

async function tree(root){const result={};for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);result[entry.name]=entry.isDirectory()?await tree(file):(await readFile(file)).toString('base64');}return result;}

test('base bytes and selection decisions are read without changing the retained tree',async t=>{
 const {BaseSourceStore,retainBaseSelection}=await import('../server/base-source-store.mjs');
 const f=await fixture(t),directory=path.join(f.root,'cache'),store=new BaseSourceStore(path.join(directory,'base-sources-v1'));
 const baseUrl='https://data.europarl.europa.eu/distribution/base_en.docx',body=Buffer.from('native base');
 const source={url:baseUrl,status:200,request:{accept:'*/*',language:'en'},headers:{'content-type':'application/octet-stream'},fetchedAt:'2026-11-01T12:00:00Z',descriptor:{url:baseUrl,format:'DOCX',language:'en',byteSize:body.length,issued:'2026-10-30T00:00:00Z'}};
 await store.save(source,body);
 await retainBaseSelection('proposal',{reportId:'A-10-2026-0001',language:'en'},{status:'unresolved',gaps:['ambiguous-com-candidates'],evidence:[{kind:'com-candidates',rows:[{workId:'exact-id'}]}],items:[{buffer:body,title:'omit',score:0.9}]},{directory});
 const before=await tree(f.root),reader=await RetainedInputs.open(f.root);
 assert.deepEqual((await reader.get(baseUrl,{accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',language:'en'})).body,body);
 assert.equal((await reader.get(baseUrl,{accept:'*/*',language:'fr'})).acquisitionUnavailable,true);
 const inputs=await mkdtemp(path.join(os.tmpdir(),'base-repeat-'));t.after(()=>rm(inputs,{recursive:true,force:true}));
 const cache=new InputCache(inputs,{retained:reader,apiBase:'https://explorer.test',fetchMissing:true,delay:0,fetcher:()=>assert.fail('no upstream')});
 for(const options of [{},{accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',language:'en'}]) {
   const first=await cache.get(baseUrl,options),again=await cache.get(baseUrl,options);
   assert.deepEqual(first.body,body);assert.deepEqual(again.body,body);
   assert.deepEqual(first.request??null,options.accept?options:null);
   assert.deepEqual(first.retainedSource.observedRequest,source.request);
 }
 const offline=new InputCache(inputs,{apiBase:'https://explorer.test',fetcher:()=>assert.fail('no replay upstream')});
 assert.deepEqual((await offline.get(baseUrl)).body,body);
 assert.deepEqual((await offline.get(baseUrl,{accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',language:'en'})).body,body);
 const selections=await reader.selections('proposal');assert.equal(selections.length,1);assert.deepEqual(selections[0].decision.items,[{}]);assert.equal(selections[0].decision.gaps[0],'ambiguous-com-candidates');
 assert.deepEqual(await tree(f.root),before);
 const name=(await readdir(store.directory)).find(n=>n.endsWith('.blob')&&n.startsWith(digest(body)));
 await writeFile(path.join(store.directory,name),Buffer.alloc(body.length));
 await assert.rejects(()=>reader.get(baseUrl),/hash mismatch/);
});

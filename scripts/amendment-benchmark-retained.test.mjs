import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {amendmentsPage,amendmentReadVersion} from '../server/amendments-store.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from '../server/amendment-documents.mjs';
import {AMENDMENT_LINKS_VERSION} from '../server/activity-index-model.mjs';
import {RetainedInputs,retainedSummary} from './amendment-benchmark-retained.mjs';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {options,evaluateReport,main} from './amendment-benchmark.mjs';
const url='https://publications.europa.eu/resource/cellar/efd95e89-a29d-11ef-85f0-01aa75ed71a1.0001.01/DOC_1';
const accept='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'retained-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const name of ['index','corpus','cache/commission-proposals-v1'])await mkdir(path.join(root,name),{recursive:true});
 for(const name of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite'])execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE meta (key TEXT, value TEXT)');c.commit();c.close()",path.join(root,name)]);
 execFileSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for key,value in {'active':21,'working':{'generation':22},'refreshPolicyGeneration':21,'amendmentSnapshotGeneration':22,'amendmentReadVersion':sys.argv[2]}.items(): c.execute('INSERT INTO meta VALUES (?,?)',(key,json.dumps(value)))
for sql in [
 'CREATE VIRTUAL TABLE question_title_search USING fts5(body)',
 'CREATE TABLE amendments(generation INTEGER,target TEXT,id TEXT,date TEXT,outcome TEXT,body TEXT)',
 'CREATE TABLE amendment_targets(generation INTEGER,id TEXT,body TEXT)',
 'CREATE TABLE amendment_read_flags(generation INTEGER,target TEXT,wording INTEGER,proposer INTEGER,splits INTEGER,freshness INTEGER)',
 'CREATE TABLE refresh_gaps(generation INTEGER,key TEXT,kind TEXT,error TEXT)',
 'CREATE TABLE amendment_jobs(generation INTEGER,done INTEGER)',
 'CREATE TABLE sources(generation INTEGER,key TEXT,kind TEXT,body TEXT,fetched_at TEXT)',
 'CREATE TABLE tasks(generation INTEGER,kind TEXT,done INTEGER)',
 'CREATE TABLE amendment_split_failures(body TEXT)']: c.execute(sql)
# VACUUM copies place FTS shadow tables before their virtual-table entry.
c.commit();c.execute('VACUUM');c.close()`,path.join(root,'index/activities-v1.sqlite'),'93a347b84b2a87bb3c9d3964bb35d892af0094c30be64db77d546d5fc47ca6e2']);
 const body=Buffer.from('exact retained bytes'),language='http://publications.europa.eu/resource/authority/language/ENG',celex='52026PC0001',itemId=url.replace('https:','http:'),identity=JSON.stringify([celex,language,itemId,'docx']),key=digest(identity);
 const source={schemaVersion:1,key,identity,celex,language,itemId,url,resolvedSourceUrl:url,format:'DOCX',accept,contentType:accept,sha256:digest(body),fetchedAt:'2026-10-30T12:00:00Z',checkedAt:'2026-10-30T12:00:00Z'};
 const file=path.join(root,'cache/commission-proposals-v1',key+'.json');
 await writeFile(file,JSON.stringify(source));await writeFile(path.join(path.dirname(file),source.sha256+'.blob'),body);
 return {root,body,source,file};
}
async function seed(f,rows){
 execFileSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for generation in [21,22]:
 for row in json.loads(sys.argv[2]):
  row={**row,'titles':{'en':'Generation '+str(generation)}}
  c.execute('INSERT INTO amendments VALUES (?,?,?,?,?,?)',(generation,row['targetDocumentId'],row['id'],'2026-10-30','unavailable',json.dumps(row)))
  c.execute('INSERT INTO amendment_targets VALUES (?,?,?)',(generation,row['targetDocumentId'],json.dumps({'id':row['targetDocumentId'],'complete':False})))
c.commit();c.close()`,path.join(f.root,'index/activities-v1.sqlite'),JSON.stringify(rows)]);
}
test('explicit mode preserves defaults and rejects acquisition combinations',()=>{
 assert.equal(options([]).productionDataDir,undefined);
 assert.equal(options(['--production-data-dir','/explicit/path']).productionDataDir,'/explicit/path');
 for(const flags of [['--fetch'],['--languages'],['--source-negotiation-cache','/tmp/other'],['--api-base','https://data.europarl.europa.eu']])assert.throws(()=>options(['--production-data-dir','/explicit/path',...flags]));
});
test('copies exact attested bytes and gaps into an independently sealed offline cache; retained mode denies all transport',async t=>{
 const f=await fixture(t),reader=await RetainedInputs.open(f.root),before=await readFile(f.file);
 const directory=await mkdtemp(path.join(os.tmpdir(),'retained-inputs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let calls=0;
 const cache=new InputCache(directory,{retained:reader,apiBase:'https://explorer.test',fetchMissing:true,delay:0,fetcher:async input=>{calls++;assert.equal(new URL(input).origin,'https://explorer.test');return new Response('{}');}});
 const input=await cache.get(url,{accept,language:'eng'});assert.deepEqual(input.body,f.body);assert.equal(input.fetchedAt,f.source.fetchedAt);assert.equal(calls,0);
 const missing=await cache.get('https://data.europarl.europa.eu/distribution/missing.docx');assert.equal(missing.status,null);assert.equal(missing.error,'acquisition-unavailable');assert.equal(missing.fetchedAt,null);
 await cache.get('https://explorer.test/api/amendments');assert.equal(calls,0);
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
  else assert.equal((await reader.get(url,{accept,language:'eng'})).acquisitionUnavailableReason,'retained-source-attestation-invalid');
 }
 const f=await fixture(t);await writeFile(path.join(path.dirname(f.file),f.source.sha256+'.blob'),'changed');const reader=await RetainedInputs.open(f.root);assert.equal((await reader.get(url,{accept,language:'eng'})).acquisitionUnavailableReason,'retained-source-hash-mismatch');
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
  const reader=await RetainedInputs.open(f.root);assert.equal((await reader.get(url,{accept:f.source.accept,language:'eng'})).acquisitionUnavailableReason,'retained-source-attestation-invalid');
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
 globalThis.fetch=()=>{calls++;assert.fail('retained transport');};
 const args=['--api-base','https://explorer.test','--cache-dir',directory,'--document',document,'--as-of','2026-11-01'];
 await seed(f,[row]);const before=await tree(f.root);
 await main([...args,'--production-data-dir',f.root,'--acquire-only']);assert.equal(calls,0);assert.deepEqual(await tree(f.root),before);
 const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));assert.ok(snapshot.snapshotId);assert.equal(snapshot.sample.indexGeneration,21);assert.ok(snapshot.manifest.some(m=>m.acquisitionUnavailable));
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
 for(const mutate of [r=>r.sha256='0'.repeat(64),r=>r.size++,r=>r.language='',r=>r.issued='invalid',r=>r.retrieved_at='2026-01-01',r=>r.list_id='unrelated']) {
  const f=await v2Fixture(t,{mutate}),db=path.join(f.root,'index/activities-v1.sqlite'),before=await readFile(db),blob=await readFile(f.blob);
  const input=await (await RetainedInputs.open(f.root)).get(epUrl);assert.equal(input.acquisitionUnavailable,true);assert.equal(input.status,null);assert.equal(input.fetchedAt,null);assert.equal(input.body.length,0);
  assert.deepEqual(await readFile(db),before);assert.deepEqual(await readFile(f.blob),blob);
 }
});
test('v2 URL ambiguity and symlink escapes never choose another source',async t=>{
 const f=await v2Fixture(t);
 execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(\"INSERT INTO amendment_sources SELECT url,'fr',byte_size,issued,sha256,size,retrieved_at,list_id FROM amendment_sources\");c.commit();c.close()",path.join(f.root,'index/activities-v1.sqlite')]);
 assert.equal((await (await RetainedInputs.open(f.root)).get(epUrl)).acquisitionUnavailableReason,'retained-source-attestation-ambiguous');
 const v=await v2Fixture(t),outside=await mkdtemp(path.join(os.tmpdir(),'retained-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 await writeFile(path.join(outside,'bytes'),v.native);await rm(v.blob);await symlink(path.join(outside,'bytes'),v.blob);
 assert.equal((await (await RetainedInputs.open(v.root)).get(epUrl)).acquisitionUnavailableReason,'retained-source-path-invalid');
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
 globalThis.fetch=()=>assert.fail('retained transport');
 await seed(f,[row]);
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
 const {startSourceWriters}=await import('../server/source-writers.mjs');
 const {Worker}=await import('node:worker_threads');
 let worker;
 const stop=startSourceWriters({enabled:true,workerUrl:new URL('../server/test-support/base-retention-writer.mjs',import.meta.url),
   createWorker:(url,options)=>worker=new Worker(url,{...options,env:{...process.env,ACTIVITY_INDEX_ENABLED:'false',CORPUS_ENABLED:'false'}})});
 t.after(stop);
 await new Promise((resolve,reject)=>{
   const ready=message=>{if(message.type==='ready'){worker.off('message',ready);resolve();}};
   worker.on('message',ready);worker.once('error',reject);
 });
 await retainBaseSelection('proposal',{reportId:'A-10-2026-0001',language:'en'},{status:'unresolved',gaps:['ambiguous-com-candidates'],evidence:[{kind:'com-candidates',rows:[{workId:'exact-id'}]}],items:[{buffer:body,title:'omit',score:0.9}]},{directory});
 await stop();
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
 assert.equal((await reader.get(baseUrl)).acquisitionUnavailableReason,'retained-source-hash-mismatch');
});

test('every page and plain/selected context projects published 21, never building or extension 22',async t=>{
 const f=await fixture(t),document='B-10-2026-0001';
 const rows=Array.from({length:51},(_,i)=>({id:document+'-AM-'+(i+1),targetDocumentId:document,number:i+1,language:'en',listId:document+'-AM-001-051',titles:{en:'Published'},decisions:[]}));
 await seed(f,rows);
 execFileSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for generation in [21,22]:
 work={'id':'eli/dl/doc/'+sys.argv[2],'identifier':sys.argv[2],'work_type':'def/ep-document-types/RESOLUTION_MOTION','parliamentary_term':'org/ep-10','title_dcterms':{'en':'Generation '+str(generation)},'is_realized_by':[],'inverse_foresees_change_of':[]}
 c.execute('INSERT INTO sources VALUES (?,?,?,?,?)',(generation,'/plenary-documents/'+sys.argv[2],'document',json.dumps(work),'2026-10-30T00:00:00Z'))
c.commit();c.close()`,path.join(f.root,'index/activities-v1.sqlite'),document]);
 const before=await tree(f.root),directory=await mkdtemp(path.join(os.tmpdir(),'retained-pages-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=new InputCache(directory,{retained:await RetainedInputs.open(f.root),apiBase:'https://explorer.test',cap:0,fetcher:()=>assert.fail('retained transport')});
 for(const offset of [0,50]){
  const {input,value}=await cache.json('https://explorer.test/api/amendments?'+new URLSearchParams({limit:'50',offset:String(offset),lang:'en'}));
  assert.equal(value.coverage.servingGeneration,21);assert.equal(value.total,51);assert.equal(value.items.length,offset?1:50);assert.ok(value.items.every(row=>row.title==='Generation 21'));assert.equal(input.status,null);assert.equal(input.fetchedAt,null);assert.equal(input.localProjection.generation,21);
 }
 for(const suffix of ['?lang=en','?lang=en&amendment='+rows[0].id+'&list='+rows[0].listId+'&wording-lang=en']){
  const {input,value}=await cache.json('https://explorer.test/api/document-context/'+document+suffix);
  assert.equal(value.documentId,document);assert.equal(input.localProjection.generation,21);assert.ok(JSON.stringify(value).includes('Generation 21'));assert.ok(!JSON.stringify(value).includes('Generation 22'));
 }
 const metadata=await cache.get('https://data.europarl.europa.eu/api/v2/plenary-documents/'+document+'?format=application%2Fld%2Bjson',{accept:'application/ld+json'});
 assert.equal(metadata.status,null);assert.equal(metadata.fetchedAt,null);assert.equal(metadata.localProjection.sourceFetchedAt,'2026-10-30T00:00:00Z');
 const manifest=cache.manifest();await cache.seal(manifest);assert.deepEqual(await tree(f.root),before);
});


test('stale published proof flags are derived with current guards without touching the copy',async t=>{
 const f=await fixture(t),document='B-10-2026-0001';
 const rows=Array.from({length:51},(_,i)=>({id:document+'-AM-'+(i+1),targetDocumentId:document,number:i+1,language:'en',decisions:[]}));
 Object.assign(rows[50],{listId:document+'-AM-001-051',textParserVersion:AMENDMENT_EXTRACTION_VERSION-1,originalText:'Old wording',proposedText:'Old proposal',authors:[{name:'Unverified',status:'resolved',personId:'1'}],decisions:[{id:'split',partId:'part-1'}],sourceFreshness:{version:0,status:'fresh'}});
 await seed(f,rows);
 execFileSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
c.execute('UPDATE amendment_targets SET body=?',(json.dumps({'id':sys.argv[2],'complete':True,'listProjectionVersion':int(sys.argv[3])}),))
for generation in [21,22]:
 for i in range(51): c.execute('INSERT INTO amendment_read_flags VALUES (?,?,?,?,?,?)',(generation,sys.argv[2],0 if generation==21 else 1,0,0,0))
c.execute("UPDATE amendments SET body=json_remove(body,'$.listId','$.textParserVersion','$.originalText','$.proposedText','$.authors','$.decisions','$.sourceFreshness') WHERE generation=22")
c.commit();c.close()`,path.join(f.root,'index/activities-v1.sqlite'),document,String(AMENDMENT_LINKS_VERSION)]);
 const before=await tree(f.root),reader=await RetainedInputs.open(f.root);t.after(()=>reader.close());
 const directory=await mkdtemp(path.join(os.tmpdir(),'retained-stale-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=new InputCache(directory,{retained:reader,apiBase:'https://explorer.test',cap:0,fetcher:()=>assert.fail('network denied')});
 for(const offset of [0,50]) {
  const {value}=await cache.json('https://explorer.test/api/amendments?'+new URLSearchParams({document,limit:'50',offset:String(offset)}));
  assert.equal(value.total,51);assert.equal(value.items.length,offset?1:50);assert.equal(value.coverage.servingGeneration,21);
  assert.equal(value.coverage.observationComplete,false);assert.ok(value.items.every(row=>row.title==='Generation 21'));
  for(const pattern of [/current document parser/,/proposer date/,/split/i,/wording source distributions/])assert.ok(value.coverage.gaps.some(gap=>pattern.test(gap)),String(pattern));
  if(offset) {assert.equal(value.items[0].originalText,null);assert.equal(value.items[0].authors[0].personId,null);assert.equal(value.items[0].sourceFreshness.status,'unverified');}
 }
 const flags=reader.projections.db.prepare('SELECT generation,id,wording,proposer,splits,freshness FROM amendment_read_flags ORDER BY id').all();
 assert.equal(flags.length,51);assert.ok(flags.every(row=>row.generation===21));
 const bad=flags.find(row=>row.id===rows[50].id);assert.deepEqual([bad.wording,bad.proposer,bad.splits,bad.freshness],[1,1,1,1]);
 assert.ok(flags.filter(row=>row!==bad).every(row=>!row.wording&&!row.proposer&&!row.splits&&!row.freshness));
 assert.equal(reader.projections.get('amendmentReadVersion'),amendmentReadVersion);
 assert.throws(()=>reader.projections.db.prepare('UPDATE amendments SET body=body'),/SELECT-only/);
 assert.throws(()=>reader.projections.db.prepare('PRAGMA query_only=OFF'),/SELECT-only/);
 assert.throws(()=>amendmentsPage({get:()=> 'stale'}),/preparing its local query indexes/);
 assert.deepEqual(await tree(f.root),before);
});

test('publisher declared size remains metadata when actual size and hash verify',async t=>{
 const f=await v2Fixture(t,{mutate:r=>r.byte_size+=4479}),before=await tree(f.root),reader=await RetainedInputs.open(f.root),input=await reader.get(epUrl);
 assert.deepEqual(input.body,f.native);assert.equal(input.sha256,digest(f.native));assert.equal(input.bytes,f.native.length);assert.equal(input.retainedSource.descriptor.byteSize,f.native.length+4479);
 assert.deepEqual(input.retainedSource.observations,[{kind:'declared-byte-size-mismatch',declaredByteSize:f.native.length+4479,actualByteSize:f.native.length}]);
 assert.equal(retainedSummary([input]).declaredSizeMismatches,1);assert.deepEqual(await tree(f.root),before);
});
test('bad sources remain named sealed gaps while another source succeeds',async t=>{
 for(const kind of ['hash','missing','unreadable','malformed']) {
  const f=await v2Fixture(t),blob=path.join(path.dirname(f.file),f.source.sha256+'.blob');
  if(kind==='hash')await writeFile(blob,'different bytes');
  if(kind==='missing')await rm(blob);
  if(kind==='unreadable'){await rm(blob);await mkdir(blob);}
  if(kind==='malformed')await writeFile(f.file,'{invalid json');
  const before=await tree(f.root),reader=await RetainedInputs.open(f.root),directory=await mkdtemp(path.join(os.tmpdir(),'retained-gaps-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const cache=new InputCache(directory,{retained:reader,apiBase:'https://explorer.test',fetcher:()=>assert.fail('no upstream')});
  const gap=await cache.get(url,{accept,language:'eng'});assert.equal(gap.acquisitionUnavailable,true);assert.equal(gap.status,null);assert.equal(gap.fetchedAt,null);assert.equal(gap.body.length,0);
  assert.equal(gap.acquisitionUnavailableReason,{hash:'retained-source-hash-mismatch',missing:'retained-source-blob-missing',unreadable:'retained-source-unreadable',malformed:'retained-attestation-missing'}[kind]);
  assert.deepEqual((await cache.get(epUrl)).body,f.native);const manifest=cache.manifest();await cache.seal(manifest);
  const summary=retainedSummary(manifest,reader.inventoryGaps);assert.deepEqual(summary.unavailableInputsByReason,{[gap.acquisitionUnavailableReason]:1});if(kind==='malformed')assert.deepEqual(summary.inventoryGapsByReason,{'retained-source-attestation-invalid':1});
  const replay=new InputCache(directory,{apiBase:'https://explorer.test',fetcher:()=>assert.fail('offline network')});await replay.seal(manifest);assert.equal((await replay.get(url,{accept,language:'eng'})).acquisitionUnavailableReason,gap.acquisitionUnavailableReason);assert.deepEqual((await replay.get(epUrl)).body,f.native);
  assert.deepEqual(await tree(f.root),before);
 }
});
test('an oversized retained source becomes a gap before cache sealing',async t=>{
 const f=await v2Fixture(t),directory=path.join(f.root,'cache/base-sources-v1');await mkdir(directory);
 const largeUrl='https://data.europarl.europa.eu/distribution/large_en.docx',body=Buffer.alloc(9*1024*1024),request={accept:'*/*',language:'en'},key=digest(JSON.stringify([largeUrl,request.accept,request.language])),sha256=digest(body);
 await writeFile(path.join(directory,sha256+'.blob'),body);await writeFile(path.join(directory,key+'.json'),JSON.stringify({schemaVersion:1,key,url:largeUrl,request,status:200,bytes:body.length,sha256,headers:{},fetchedAt:'2026-10-30T00:00:00Z'}));
 const inputs=await mkdtemp(path.join(os.tmpdir(),'retained-size-gap-'));t.after(()=>rm(inputs,{recursive:true,force:true}));
 const cache=new InputCache(inputs,{retained:await RetainedInputs.open(f.root),apiBase:'https://explorer.test',fetcher:()=>assert.fail('no upstream')});
 const gap=await cache.get(largeUrl);assert.equal(gap.acquisitionUnavailableReason,'retained-source-size-limit');assert.equal(gap.body.length,0);assert.deepEqual((await cache.get(epUrl)).body,f.native);await cache.seal(cache.manifest());
});

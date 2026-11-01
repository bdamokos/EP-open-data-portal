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

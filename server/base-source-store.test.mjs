import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setRetentionForwarder} from './base-source-rpc.mjs';
import {BaseSourceStore} from './base-source-store.mjs';
async function fixture(t,maxBytes=2000){const dir=await mkdtemp(path.join(os.tmpdir(),'base-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,store:new BaseSourceStore(dir,{maxBytes})};}
const obs=(url='https://example.test/a')=>({url,status:200,fetchedAt:'2026-11-01T12:00:00.000Z',request:{accept:'application/xhtml+xml'},descriptor:{url,language:'en',byteSize:null,issued:null}});
test('budget preserves current bindings and refuses excess admission',async t=>{
 const {dir,store}=await fixture(t,650);
 assert.equal(await store.save(obs(),Buffer.alloc(100)),true);
 const before=await readdir(dir);
 assert.equal(await store.save(obs('https://example.test/b'),Buffer.alloc(500)),false);
 assert.deepEqual(await readdir(dir),before);
});
test('superseded bindings evict only unreferenced blobs, including shared bytes',async t=>{
 const {dir,store}=await fixture(t,4000);
 await store.save(obs(),Buffer.from('old'));await store.save(obs('https://example.test/b'),Buffer.from('old'));
 await store.save(obs(),Buffer.from('new'));
 assert.equal((await readdir(dir)).filter(n=>n.endsWith('.blob')).length,2);
 await store.save(obs('https://example.test/b'),Buffer.from('new'));
 assert.equal((await readdir(dir)).filter(n=>n.endsWith('.blob')).length,1);
 const records=await Promise.all((await readdir(dir)).filter(n=>n.endsWith('.json')).map(n=>readFile(path.join(dir,n),'utf8')));
 assert.equal(new Set(records.map(r=>JSON.parse(r).sha256)).size,1);
});
test('read-only store creates nothing and does not prune orphan bytes',async t=>{
 const {dir}=await fixture(t);await writeFile(path.join(dir,'0'.repeat(64)+'.blob'),'orphan');
 assert.equal(await new BaseSourceStore(dir,{readOnly:true}).save(obs(),Buffer.from('no')),false);
 assert.deepEqual(await readdir(dir),['0'.repeat(64)+'.blob']);
});
test('Cellar retains the existing response without making another upstream request',async t=>{
 const {CellarDocuments}=await import('./cellar-documents.mjs');
 const {dir}=await fixture(t),url='https://publications.europa.eu/resource/celex/52026PC0001',body='<rdf>observed</rdf>';let calls=0;
 const store=new BaseSourceStore(path.join(dir,'base-sources-v1'));
 setRetentionForwarder(({observation,body})=>store.save(observation,body));t.after(()=>setRetentionForwarder(null));
 const documents=new CellarDocuments({directory:path.join(dir,'commission-proposals-v1'),sources:{schedule:fn=>fn()},fetchSource:async input=>{calls++;assert.equal(input,url);return new Response(body,{headers:{'content-type':'application/rdf+xml;notice=tree'}});}});
 const result=await documents.request(url,{accept:'application/rdf+xml;notice=tree'});
 assert.equal(result.buffer.toString(),body);assert.equal(calls,1);
 const folder=path.join(dir,'base-sources-v1'),files=await readdir(folder),descriptor=JSON.parse(await readFile(path.join(folder,files.find(n=>n.endsWith('.json'))),'utf8'));
 assert.equal(descriptor.url,url);assert.equal(descriptor.request.accept,'application/rdf+xml;notice=tree');assert.equal((await readFile(path.join(folder,descriptor.sha256+'.blob'))).toString(),body);
});

test('startup reconciles once; running totals and references match disk across restart',async t=>{
 const {dir,store}=await fixture(t,4000);
 const scans={readdir:0,stat:0,readFile:0};
 for(const name of Object.keys(scans)){const original=store.io[name];store.io={...store.io,[name]:async(...args)=>{scans[name]++;return original(...args);}};}
 await store.save(obs(),Buffer.from('shared'));
 const first={...scans};
 for(let i=0;i<5;i++)await store.save(obs('https://example.test/'+i),Buffer.from('shared'));
 await store.save(obs(),Buffer.from('different'));
 assert.deepEqual(scans,first);assert.equal(scans.readdir,1);
 const disk=async()=>{let size=0;for(const name of await readdir(dir))size+=(await (await import('node:fs/promises')).stat(path.join(dir,name))).size;return size;};
 assert.equal(store.totalBytes,await disk());
 const restarted=new BaseSourceStore(dir,{maxBytes:4000});await restarted.save(obs(),Buffer.from('different'));
 assert.equal(restarted.totalBytes,await disk());assert.equal(restarted.records.size,6);
 assert.equal([...restarted.blobs.values()].find(b=>b.refs===5).bytes,6);
});
test('failed descriptor publication preserves old binding and charges failed orphan cleanup',async t=>{
 const {dir,store}=await fixture(t,4000);await store.save(obs(),Buffer.from('old'));
 const original=store.write;store.write=async(file,...args)=>{if(file.endsWith('.json'))throw new Error('fixture failure');return original(file,...args);};
 const remove=store.io.unlink;store.io={...store.io,unlink:async()=>{throw new Error('fixture busy');}};
 await assert.rejects(store.save(obs(),Buffer.from('replacement')),/fixture failure/);
 assert.equal([...store.records.values()][0].record.bytes,3);
 assert.equal(store.blobs.size,2);assert.equal([...store.blobs.values()].filter(b=>b.refs===0).length,1);
 const before=store.totalBytes;store.io={...store.io,unlink:remove};store.write=original;
 const restarted=new BaseSourceStore(dir,{maxBytes:4000});await restarted.save(obs(),Buffer.from('old'));
 assert.equal(restarted.totalBytes,before-11);assert.equal(restarted.blobs.size,1);
});
test('known interrupted temporary bytes remain charged without repeated scans',async t=>{
 const {dir,store}=await fixture(t,700);await writeFile(path.join(dir,'interrupted.tmp'),Buffer.alloc(500));
 assert.equal(await store.save(obs(),Buffer.from('small')),false);assert.equal(store.totalBytes,500);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
 const documents=new CellarDocuments({directory:path.join(dir,'commission-proposals-v1'),sources:{schedule:fn=>fn()},fetchSource:async input=>{calls++;assert.equal(input,url);return new Response(body,{headers:{'content-type':'application/rdf+xml;notice=tree'}});}});
 const result=await documents.request(url,{accept:'application/rdf+xml;notice=tree'});
 assert.equal(result.buffer.toString(),body);assert.equal(calls,1);
 const folder=path.join(dir,'base-sources-v1'),files=await readdir(folder),descriptor=JSON.parse(await readFile(path.join(folder,files.find(n=>n.endsWith('.json'))),'utf8'));
 assert.equal(descriptor.url,url);assert.equal(descriptor.request.accept,'application/rdf+xml;notice=tree');assert.equal((await readFile(path.join(folder,descriptor.sha256+'.blob'))).toString(),body);
});

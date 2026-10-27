import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,writeFileSync,readFileSync,existsSync,utimesSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {amendmentSourceStore,AMENDMENT_SOURCE_LIMITS} from './amendment-source-store.mjs';

const retrievedAt='2026-10-17T08:00:00.000Z',url='https://data.europarl.europa.eu/distribution/test/list_en.docx';
const descriptor={url,language:'en',byteSize:30,issued:'2026-10-16T17:04:06+02:00'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,{maxBytes}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-source-'));
  let now=Date.parse(retrievedAt)+86400000;
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,directory,sources:amendmentSourceStore(store,{maxBytes}),blobs:path.join(directory,'amendment-docx-v2'),advance:ms=>{now+=ms;assert(store.acquire());},buffer:Buffer.from('PK retained official source bytes')};
}
const rows=store=>store.db.prepare('SELECT url,language,byte_size,issued,sha256,size,retrieved_at,list_id FROM amendment_sources ORDER BY retrieved_at,url').all();
const listSource=(store,generation,listId,descriptors)=>store.putSource(generation,'amendment:list:'+listId,'amendment-list',{distributionEvidence:{version:2,state:'available',descriptors}},retrievedAt);

test('retained raw bytes serve the exact current descriptor at any age and keep their retrieval time',async t=>{
  const {store,sources,blobs,advance,buffer}=fixture(t);
  assert.equal(await sources.save(descriptor,buffer,retrievedAt,{listId:'A-10-2026-0001-AM-001-001'}),true);
  assert.deepEqual(readdirSync(blobs),[sha(buffer)+'.docx']);
  assert.deepEqual(readFileSync(path.join(blobs,sha(buffer)+'.docx')),buffer,'Bytes are stored raw, not as base64 JSON.');
  advance(2*365*86400000);
  assert.deepEqual(await sources.read(descriptor),{buffer,fetchedAt:retrievedAt,sha256:sha(buffer)});
  // Same instant in another notation, and a descriptor without an issue time.
  assert(await sources.read({...descriptor,issued:'2026-10-16T15:04:06Z'}));
  const {issued:_issued,...unrecorded}=descriptor;assert(await sources.read(unrecorded));
  for(const changed of [{url:url+'x'},{language:'fr'},{byteSize:31},{byteSize:null},{issued:'2026-10-20T09:00:00+02:00'}])
    assert.equal(await sources.read({...descriptor,...changed}),null,JSON.stringify(changed));
  assert.equal(sources.has(descriptor),true);assert.equal(sources.has({...descriptor,byteSize:31}),false);
  assert.equal(rows(store).length,1);
});

test('an unissued row cannot bridge known issue changes, while matching issued bytes remain reusable',async t=>{
  const {sources,buffer}=fixture(t),{issued:_issued,...legacy}=descriptor;
  await sources.save(legacy,buffer,retrievedAt);
  assert(await sources.read(descriptor),'First use remains compatible with legacy bytes.');
  const next={...descriptor,issued:'2026-10-20T09:00:00+02:00'};
  assert.equal(await sources.read(next,{previousDescriptor:descriptor}),null);
  assert(await sources.read({...descriptor,issued:'2026-10-16T15:04:06Z'},{previousDescriptor:descriptor}),'Equivalent instants do not change publication.');
  await sources.save(next,buffer,retrievedAt);
  assert(await sources.read(next,{previousDescriptor:descriptor}),'An already retained matching publication needs no new download.');
});

test('damaged or missing bytes are forgotten so the caller downloads again',async t=>{
  const {store,sources,blobs,buffer}=fixture(t);
  await sources.save(descriptor,buffer,retrievedAt);
  writeFileSync(path.join(blobs,sha(buffer)+'.docx'),Buffer.from('PK different bytes of the same len'.slice(0,buffer.length)));
  assert.equal(await sources.read(descriptor),null);assert.deepEqual(rows(store),[]);assert.deepEqual(readdirSync(blobs),[]);
  await sources.save(descriptor,buffer,retrievedAt);rmSync(path.join(blobs,sha(buffer)+'.docx'));
  assert.equal(await sources.read(descriptor),null);assert.deepEqual(rows(store),[]);
});

test('identical bytes share one file; a new retrieval replaces the same descriptor and supersedes other versions',async t=>{
  const {store,sources,blobs,buffer}=fixture(t);
  const french={...descriptor,url:url.replace('_en','_fr'),language:'fr'};
  await sources.save(descriptor,buffer,retrievedAt);await sources.save(french,buffer,retrievedAt);
  assert.equal(readdirSync(blobs).length,1);assert.equal(rows(store).length,2);
  // Re-downloading identical bytes records the later retrieval.
  const later='2026-10-18T08:00:00.000Z';await sources.save(descriptor,buffer,later);
  assert.equal((await sources.read(descriptor)).fetchedAt,later);
  // A different publication of the same URL is kept beside the earlier one.
  const revised=Buffer.from('PK revised official source bytes!!'),next={...descriptor,byteSize:revised.length,issued:'2026-10-20T09:00:00+02:00'};
  await sources.save(next,revised,'2026-10-21T08:00:00.000Z');
  assert.equal(rows(store).length,3);assert.equal(readdirSync(blobs).length,2);
  assert.deepEqual((await sources.read(next)).buffer,revised);assert.deepEqual((await sources.read(descriptor)).buffer,buffer);
  // Same descriptor, different bytes: the old file goes once nothing refers to it.
  await sources.save(french,revised,'2026-10-22T08:00:00.000Z');await sources.save(descriptor,revised,'2026-10-22T08:00:00.000Z');
  assert.deepEqual(readdirSync(blobs),[sha(revised)+'.docx']);
});

test('the disk budget evicts superseded, then unreferenced versions, and never current sources',async t=>{
  const {store,sources,blobs}=fixture(t,{maxBytes:100});
  const {generation}=store.beginCycle();
  const file=(name,fill)=>Buffer.alloc(30,fill),at=day=>`2026-10-${String(day).padStart(2,'0')}T08:00:00.000Z`;
  const current={url:url.replace('list','current'),language:'en',byteSize:30},old={...current,byteSize:29},orphan={url:url.replace('list','orphan'),language:'en',byteSize:30};
  listSource(store,generation,'L1',[current]);
  assert(await sources.save(old,file('o','1'),at(1),{listId:'L1'}));
  assert(await sources.save(orphan,file('x','2'),at(2),{listId:'L2'}));
  assert(await sources.save(current,file('c','3'),at(3),{listId:'L1'}));
  assert.equal(rows(store).length,3);
  // A fourth file needs space: the superseded version of L1 goes first.
  const fresh={url:url.replace('list','fresh'),language:'en',byteSize:30};listSource(store,generation,'L3',[fresh]);
  assert(await sources.save(fresh,file('f','4'),at(4),{listId:'L3'}));
  assert.deepEqual(rows(store).map(row=>row.url),[orphan.url,current.url,fresh.url]);
  // Then the version no retained generation publishes.
  const another={url:url.replace('list','another'),language:'en',byteSize:30};listSource(store,generation,'L4',[another]);
  assert(await sources.save(another,file('a','5'),at(5),{listId:'L4'}));
  assert.deepEqual(rows(store).map(row=>row.url),[current.url,fresh.url,another.url]);
  // Current sources fill the budget: new bytes are not retained and nothing is evicted.
  const extra={url:url.replace('list','extra'),language:'en',byteSize:30};
  assert.equal(await sources.save(extra,file('e','6'),at(6),{listId:'L5'}),false);
  assert.equal(rows(store).length,3);assert.equal(readdirSync(blobs).length,3);
  assert.equal(await sources.save(extra,Buffer.alloc(AMENDMENT_SOURCE_LIMITS.maxFileBytes+1),at(6)),false);
});

test('superseded versions published by active, previous or working generations remain protected',async t=>{
  const {store,sources,blobs}=fixture(t,{maxBytes:120});
  store.set('previous',1);store.set('active',2);store.set('working',{generation:3});
  const versions=[27,28,29,30].map(byteSize=>({...descriptor,byteSize}));
  for(const [index,file] of versions.entries()) {
    if(index)listSource(store,index,'L1',[file]);
    assert(await sources.save(file,Buffer.alloc(30,index),`2026-10-${10+index}T08:00:00.000Z`,{listId:'L1'}));
  }
  const extra={...descriptor,url:url+'extra'};
  listSource(store,3,'L2',[extra]);
  assert(await sources.save(extra,Buffer.alloc(30,4),retrievedAt,{listId:'L2'}));
  assert.equal(sources.has(versions[0]),false,'Only the unreferenced superseded version is eligible.');
  for(const file of versions.slice(1))assert(await sources.read(file));
  assert.equal(await sources.save({...extra,url:url+'overflow'},Buffer.alloc(30,5),retrievedAt),false);
  assert.equal(readdirSync(blobs).length,4);
});

function legacyRecord(directory,buffer,{name='a',descriptor:file=descriptor}={}) {
  const legacy=path.join(directory,'amendment-docx-v1');mkdirSync(legacy,{recursive:true});
  const filename=path.join(legacy,name.repeat(64)+'.json');
  writeFileSync(filename,JSON.stringify({version:1,descriptor:file,fetchedAt:retrievedAt,sha256:sha(buffer),bytes:buffer.toString('base64')}));
  return filename;
}

test('a destination write failure preserves valid legacy input for a restarted writer',async t=>{
  const {store,sources,directory,blobs,buffer}=fixture(t);
  const file=legacyRecord(directory,buffer);
  // A directory at the destination makes the atomic publication fail.
  const destination=path.join(blobs,sha(buffer)+'.docx');mkdirSync(destination,{recursive:true});
  await assert.rejects(sources.initialize(),error=>['EISDIR','ENOTDIR','EEXIST'].includes(error.code));
  assert(existsSync(file));assert.deepEqual(rows(store),[]);
  rmSync(destination,{recursive:true});store.release();
  const successor=new ActivityStore(directory,{clock:()=>store.clock()});
  try {
    assert(successor.acquire());
    assert.deepEqual((await amendmentSourceStore(successor).read(descriptor)).buffer,buffer);
    assert.equal(existsSync(file),false);
  }finally{successor.close();}
});

test('migration retains valid inputs refused by the budget and discards invalid records separately',async t=>{
  const {store,sources,directory,buffer}=fixture(t,{maxBytes:1});
  const file=legacyRecord(directory,buffer),invalid=path.join(path.dirname(file),'b'.repeat(64)+'.json');
  writeFileSync(invalid,'{invalid');
  await sources.initialize();assert(existsSync(file));assert.equal(existsSync(invalid),false);assert.deepEqual(rows(store),[]);
  sources.maxBytes=100;await sources.migrateLegacy();
  assert.equal(existsSync(file),false);assert.deepEqual((await sources.read(descriptor)).buffer,buffer);
});

test('a restarted migration removes only inputs with verified equivalent retained bytes',async t=>{
  const {sources,directory,blobs,buffer}=fixture(t);
  await sources.save(descriptor,buffer,retrievedAt);
  const equivalent=legacyRecord(directory,buffer),different=legacyRecord(directory,Buffer.from('different valid source'),{name:'b'});
  await sources.migrateLegacy();
  assert.equal(existsSync(equivalent),false);assert(existsSync(different));
  const missing=legacyRecord(directory,buffer);rmSync(path.join(blobs,sha(buffer)+'.docx'));
  await sources.migrateLegacy();assert(existsSync(missing),'An index row alone does not prove retained bytes.');
});

test('the former base64 JSON cache is imported once into raw files and removed',async t=>{
  const {store,directory,buffer}=fixture(t);
  const legacy=path.join(directory,'amendment-docx-v1');mkdirSync(legacy);
  const record=(bytes,extra={})=>JSON.stringify({version:1,descriptor:{url,language:'en',byteSize:30},fetchedAt:retrievedAt,sha256:sha(bytes),bytes:bytes.toString('base64'),...extra});
  writeFileSync(path.join(legacy,'a'.repeat(64)+'.json'),record(buffer));
  writeFileSync(path.join(legacy,'b'.repeat(64)+'.json'),record(buffer,{sha256:'0'.repeat(64)}));
  writeFileSync(path.join(legacy,'c'.repeat(64)+'.json'),'{not json');
  const sources=amendmentSourceStore(store);
  assert.deepEqual(await sources.read({url,language:'en',byteSize:30,issued:'2026-10-16T17:04:06+02:00'}),{buffer,fetchedAt:retrievedAt,sha256:sha(buffer)});
  assert.equal(existsSync(legacy),false);
  assert.deepEqual(rows(store).map(row=>[row.issued,row.retrieved_at,row.list_id]),[['',retrievedAt,null]]);
});

test('writes need the writer lease; an interrupted publication is cleaned up and a successor reads retained bytes',async t=>{
  const {store,directory,sources,blobs,buffer,advance}=fixture(t);
  await sources.save(descriptor,buffer,retrievedAt,{listId:'L1'});
  // Another writer takes over after the lease expires.
  advance(0);store.release();
  const other=new ActivityStore(directory,{clock:()=>store.clock()});t.after(()=>other.close());assert(other.acquire());
  const revised=Buffer.from('PK revised official source bytes!!');
  await assert.rejects(sources.save({...descriptor,byteSize:revised.length},revised,retrievedAt),/writer lease was lost/);
  assert.equal(rows(other).length,1);
  // A crash between writing a file and indexing it leaves an orphan file.
  const orphan=path.join(blobs,sha(revised)+'.docx');writeFileSync(orphan,revised);
  const stale=new Date(store.clock()-11*60_000);utimesSync(orphan,stale,stale);
  const successor=amendmentSourceStore(other);
  assert.deepEqual((await successor.read(descriptor)).buffer,buffer);
  assert.equal(existsSync(orphan),false);assert.deepEqual(readdirSync(blobs),[sha(buffer)+'.docx']);
});

test('cancelled retention publishes no file or row',async t=>{
  const {store,sources,blobs,buffer}=fixture(t),controller=new AbortController();
  await sources.initialize();controller.abort();
  await assert.rejects(sources.save(descriptor,buffer,retrievedAt,{signal:controller.signal}),error=>error===controller.signal.reason);
  assert.equal(existsSync(blobs)&&readdirSync(blobs).length,existsSync(blobs)?0:false);assert.deepEqual(rows(store),[]);
});

test('recent orphan files are swept on a later writer access after the grace period',async t=>{
  const {sources,blobs,buffer,store,advance}=fixture(t);
  mkdirSync(blobs);
  const orphan=path.join(blobs,sha(buffer)+'.docx');writeFileSync(orphan,buffer);
  const created=new Date(store.clock());utimesSync(orphan,created,created);
  await sources.initialize();assert(existsSync(orphan));
  advance(11*60_000);await sources.read(descriptor);
  assert.equal(existsSync(orphan),false);assert.equal(sources.usedBytes(),0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {retainAmendmentSource,retainedAmendmentSource} from './amendment-source-cache.mjs';

const fetchedAt='2026-10-17T08:00:00.000Z',descriptor={url:'https://data.europarl.europa.eu/distribution/test/list_en.docx',language:'en',byteSize:30};
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-source-')),store={filename:path.join(directory,'activities.sqlite'),clock:()=>Date.parse(fetchedAt)+86400000};
  t.after(()=>rmSync(directory,{recursive:true,force:true}));return {store,directory,buffer:Buffer.from('PK retained official source bytes')};
}
test('retained bytes require exact distribution identity, retrieval age and content hash',async t=>{
  const {store,directory,buffer}=fixture(t);await retainAmendmentSource(store,descriptor,buffer,fetchedAt);
  assert.deepEqual(await retainedAmendmentSource(store,descriptor),{buffer,fetchedAt});
  for(const changed of [{url:descriptor.url+'x'},{language:'fr'},{byteSize:31}])assert.equal(await retainedAmendmentSource(store,{...descriptor,...changed}),null);
  const file=path.join(directory,'amendment-docx-v1',readdirSync(path.join(directory,'amendment-docx-v1'))[0]),record=JSON.parse(readFileSync(file));
  writeFileSync(file,JSON.stringify({...record,bytes:Buffer.from('Different bytes').toString('base64')}));assert.equal(await retainedAmendmentSource(store,descriptor),null);
  writeFileSync(file,JSON.stringify(record));store.clock=()=>Date.parse(fetchedAt)+7*86400000;assert.equal(await retainedAmendmentSource(store,descriptor),null);
  store.clock=()=>Date.parse(fetchedAt)-1;assert.equal(await retainedAmendmentSource(store,descriptor),null);
});
test('cancelled retention and oversized source bytes publish no cache entry',async t=>{
  const {store,directory,buffer}=fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(retainAmendmentSource(store,descriptor,buffer,fetchedAt,{signal:controller.signal}),error=>error===controller.signal.reason);
  await retainAmendmentSource(store,descriptor,Buffer.alloc(8*1024*1024+1),fetchedAt);
  assert.deepEqual(readdirSync(directory),[]);assert.equal(await retainedAmendmentSource(store,descriptor),null);
});

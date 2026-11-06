import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {zstdCompressSync} from 'node:zlib';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusReader} from './corpus-reader.mjs';
test('weekly metadata ranges read once, preserve parents, type and people, and run read-only in the dedicated worker',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'week-facts-'));let store;
 try {
  store=new CorpusStore(directory);store.acquire();const put=store.db.prepare('INSERT INTO speech_metadata VALUES (?,?,?,?)');
  for(const date of ['2026-10-19','2026-10-20','2026-09-14']) {
   const id='MTG-PL-'+date+'-OTH-1';
   put.run(id,zstdCompressSync(Buffer.from(JSON.stringify({summary:{id,date,intervention:{type:'blue-card-reaction',parentIds:['one','two']}},speakers:[{id:'123'}]}))),'https://www.europarl.europa.eu/doceo/','2026-11-04');
  }
  const result=store.weekSpeechFacts({dates:['2026-10-19','2026-10-19','2026-10-20']});assert.equal(result.rows,2);assert(result.compressedBytes>0);assert.deepEqual(result.records[0].parentIds,['one','two']);assert.equal(result.records[0].type,'blue-card-reaction');
  store.release();store.close();store=null;
  const reader=new CorpusReader(directory,{timeoutMs:8000}),fromWorker=await reader.query('speech-week-facts',{dates:['2026-10-19']});
  assert.equal(fromWorker.rows,1);assert.deepEqual(fromWorker.records[0].people,['123']);
  // Reader termination is asynchronous for speech operations; wait for its owned slot.
  while(reader.busy)await new Promise(resolve=>setTimeout(resolve,5));
 }finally {store?.close();rmSync(directory,{recursive:true,force:true});}
});

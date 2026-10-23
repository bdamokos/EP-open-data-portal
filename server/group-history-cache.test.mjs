import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('raw profile reader uses only fresh exact cache keys and never acquires upstream',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'group-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const old=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=directory;t.after(()=>{if(old===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=old;});
 const {readCachedMepRecord}=await import('./odp.mjs'),now=Date.now();
 const key=id=>`https://data.europarl.europa.eu/api/v2/meps/${id}?format=application%2Fld%2Bjson`;
 const put=async(id,record)=>writeFile(path.join(directory,createHash('sha256').update(key(id)).digest('hex')+'.json'),JSON.stringify(record));
 t.mock.method(globalThis,'fetch',()=>assert.fail('cache-only lookup must not fetch'));
 await put('42',{url:key('42'),fetchedAt:now,payload:{data:[{identifier:'42',hasMembership:[]}]}});
 assert.equal((await readCachedMepRecord('42',{now})).payload.data[0].identifier,'42');
 await put('43',{url:key('43'),fetchedAt:now-7*86_400_000,payload:{data:[]}});assert.equal(await readCachedMepRecord('43',{now}),null);
 await put('44',{url:key('45'),fetchedAt:now,payload:{data:[]}});assert.equal(await readCachedMepRecord('44',{now}),null);
 await put('46',{url:key('46'),fetchedAt:now+1,payload:{data:[]}});assert.equal(await readCachedMepRecord('46',{now}),null);
 assert.equal(await readCachedMepRecord('47',{now}),null);
 await assert.rejects(readCachedMepRecord('../42'),/Invalid MEP/);
 const controller=new AbortController();controller.abort();await assert.rejects(readCachedMepRecord('42',{signal:controller.signal}));
});

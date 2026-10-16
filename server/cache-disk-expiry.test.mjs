import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {InsightViewCache} from './insights-view-cache.mjs';
import {PortraitCache} from './portrait-cache.mjs';
import {runWithRequestSignal,cancelledRequest} from './request-budget.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('an aborted view disk read cannot overwrite a newer saved view',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'view-disk-expiry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cache=new InsightViewCache({directory}),key=cache.key(['disk-race']),old={key,at:Date.now(),value:{items:['old']}};
  const file=path.join(directory,key+'.json');await fs.writeFile(file,JSON.stringify(old));
  let finish,reachedRead;const started=new Promise(resolve=>reachedRead=resolve),realRead=fs.readFile;
  const mock=t.mock.method(fs,'readFile',(name,...args)=>String(name)===file?new Promise(resolve=>{finish=()=>resolve(JSON.stringify(old));reachedRead();}):realRead(name,...args));
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const a=new AbortController(),reason=cancelledRequest();
  const first=runWithRequestSignal(a.signal,()=>assert.rejects(cache.get(['disk-race'],()=>assert.fail('no upstream load')),e=>e===reason));
  await started;assert(finish);
  a.abort(reason);await cache.save(key,{items:['replacement']});finish();await first;
  assert.deepEqual((await cache.get(['disk-race'],()=>assert.fail('keep replacement'))).items,['replacement']);
});

test('an un-aborted view disk reader keeps the newer publication from another reader',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'view-disk-publication-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const now=Date.now(),value=['un-aborted-disk-race'],cache=new InsightViewCache({directory,freshMs:100,clock:()=>now}),key=cache.key(value),old={key,at:now-1000,value:{items:['old']}};
  const file=path.join(directory,key+'.json');await fs.writeFile(file,JSON.stringify(old));
  const realRead=fs.readFile;let finish,reached,blocked=false,loads=0;
  const started=new Promise(resolve=>reached=resolve);
  const mock=t.mock.method(fs,'readFile',async(name,...args)=>{
    const data=await realRead(name,...args);
    if(String(name)!==file||blocked)return data;blocked=true;
    return new Promise(resolve=>{finish=()=>resolve(data);reached();});
  });syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const load=async()=>{loads++;return {items:['replacement']};};
  const first=cache.get(value,load);await started;
  assert.deepEqual((await cache.get(value,load)).items,['old']);
  await cache.refresh(key,load);finish();
  assert.deepEqual((await first).items,['replacement']);
  assert.deepEqual(cache.cache.get(key).value.items,['replacement']);
  assert.deepEqual(JSON.parse(await realRead(file,'utf8')).value.items,['replacement']);assert.equal(loads,1);assert.equal(cache.diskReads.size,0);
});

test('a delayed disk read cannot republish a superseded value after memory eviction',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'view-disk-eviction-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cache=new InsightViewCache({directory,maxEntries:1}),key=cache.key(['evicted-disk-race']),old={key,at:Date.now(),value:{items:['old']}};
  const file=path.join(directory,key+'.json');await fs.writeFile(file,JSON.stringify(old));
  const realRead=fs.readFile;let finish,reached,blocked=false;
  const started=new Promise(resolve=>reached=resolve);
  const mock=t.mock.method(fs,'readFile',async(name,...args)=>{
    const data=await realRead(name,...args);
    if(String(name)!==file||blocked)return data;blocked=true;
    return new Promise(resolve=>{finish=()=>resolve(data);reached();});
  });syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const first=cache.stored(key);await started;await cache.save(key,{items:['replacement']});
  cache.remember(cache.key(['other']),{at:Date.now(),value:{items:['other']}});
  assert.equal(cache.cache.has(key),false);finish();assert.equal(await first,null);
  assert.equal(cache.cache.has(key),false);assert.deepEqual((await cache.stored(key)).value.items,['replacement']);assert.equal(cache.diskReads.size,0);
});

test('an expired portrait disk reader cannot overwrite a newer portrait',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'portrait-disk-expiry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+180_000});
  const cache=new PortraitCache({directory}),id=96826;
  const image=label=>({memberId:id,sourceUrl:'https://www.europarl.europa.eu/mepphoto/96826.jpg',fetchedAt:Date.now(),contentType:'image/jpeg',body:Buffer.from(label)});
  await cache.save(id,image('old'));let finish,blocked=false,reachedRead;const started=new Promise(resolve=>reachedRead=resolve),realOpen=fs.open;
  const mock=t.mock.method(fs,'open',async(name,...args)=>{
    const file=await realOpen(name,...args);if(String(name)!==path.join(directory,id+'.portrait')||blocked)return file;blocked=true;
    return {stat:()=>file.stat(),readFile:async()=>{const old=await file.readFile();return new Promise(resolve=>{finish=()=>resolve(old);reachedRead();});},close:()=>file.close()};
  });syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const first=assert.rejects(cache.get(id,()=>assert.fail('no download')),e=>e.code==='request_timeout');
  await started;assert(finish);
  t.mock.timers.tick(50_000);await first;
  await cache.save(id,image('replacement'));assert.equal((await cache.get(id,()=>assert.fail('saved replacement'))).body.toString(),'replacement');
  finish();await turn();await turn();
  assert.equal((await cache.get(id,()=>assert.fail('retain replacement'))).body.toString(),'replacement');
});

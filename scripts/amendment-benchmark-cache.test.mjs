import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {InputCache,digest,observeFrozenInputs,withFrozenInputGaps} from './amendment-benchmark-cache.mjs';

const apiBase='https://explorer.example',url='https://publications.europa.eu/resource/celex/52026PC0001';
const request={accept:'application/rdf+xml;notice=tree',language:'eng'};
async function tree(directory){return Promise.all((await readdir(directory,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(async f=>[path.relative(directory,path.join(f.parentPath,f.name)),digest(await readFile(path.join(f.parentPath,f.name)))])).then(rows=>rows.sort(([a],[b])=>a.localeCompare(b)));}
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'frozen-input-policy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const body=Buffer.from('<rdf/>'),meta={url,request,status:200,ok:true,fetchedAt:'2026-10-27T00:00:00Z',bytes:body.length,sha256:digest(body),error:null,headers:{'content-type':'application/rdf+xml'}};
  const key=digest(JSON.stringify([url,request])),metadata=path.join(directory,key+'.json'),bytes=path.join(directory,key+'.body');
  await writeFile(metadata,JSON.stringify(meta));await writeFile(bytes,body);
  const sample={mode:'documents',documents:['A-10-2026-0001']},manifest=[meta],snapshotId=digest(JSON.stringify({apiBase,sample,manifest}));
  const snapshot={apiBase,sample,manifest,snapshotId};await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot));
  const forbidden={network:0,retained:0};
  const cache=new InputCache(directory,{apiBase,cap:0,fetchMissing:true,fetcher:()=>{forbidden.network++;assert.fail('network forbidden');},retained:{get:()=>{forbidden.retained++;assert.fail('sealed inputs cannot be reacquired');}}});
  return {directory,metadata,bytes,cache,snapshot,body,forbidden};
}
test('absent frozen requests retain exact request/snapshot evidence without touching the seal or cache',async t=>{
  const f=await fixture(t),before=await tree(f.directory),snapshotBefore=JSON.stringify(f.snapshot);
  await f.cache.seal(f.snapshot.manifest,{snapshotId:f.snapshot.snapshotId});
  const missing=url.replace('0001','0002'),other={accept:'application/rdf+xml;notice=object',language:'fra'};
  for(const [u,r] of [[missing,request],[url,other]]){
    const {value:gap,gaps}=await observeFrozenInputs(f.cache,()=>f.cache.get(u,r));
    const expected={reason:'frozen-input-absent',url:u,...r,snapshotId:f.snapshot.snapshotId};
    assert.deepEqual(gap.frozenInputGap,expected);assert.deepEqual(gaps,[expected]);assert.equal(gap.acquisitionUnavailable,true);assert.equal(gap.acquisitionUnavailableReason,'frozen-input-absent');
    assert.equal(gap.ok,false);assert.equal(gap.status,null);assert.equal(gap.fetchedAt,null);assert.equal(gap.sha256,null);assert.equal(gap.body.length,0);
  }
  assert.equal((await f.cache.get(missing)).frozenInputGap.accept,'application/json','implicit Accept matches the acquisition transport');
  assert.deepEqual((await f.cache.get(url,request)).body,f.body);f.cache.assertHealthy();assert.equal(f.cache.requests,0);
  assert.deepEqual(f.cache.manifest(),f.snapshot.manifest);assert.equal(JSON.stringify(f.snapshot),snapshotBefore);assert.deepEqual(await tree(f.directory),before);assert.deepEqual(f.forbidden,{network:0,retained:0});
});
for(const phase of ['sealing','replay'])for(const failure of ['body hash','missing body','missing metadata','malformed metadata','unreadable metadata','invalid observation time','invalid status','invalid headers'])test(phase+' keeps '+failure+' fatal for a listed input',async t=>{
  const f=await fixture(t);
  if(phase==='replay')await f.cache.seal(f.snapshot.manifest,{snapshotId:f.snapshot.snapshotId});
  if(failure==='body hash')await writeFile(f.bytes,'changed');
  if(failure==='missing body')await rm(f.bytes);
  if(failure==='missing metadata')await rm(f.metadata);
  if(failure==='malformed metadata')await writeFile(f.metadata,'{broken');
  if(failure==='unreadable metadata'){await rm(f.metadata);await mkdir(f.metadata);}
  if(failure.startsWith('invalid ')){const meta=JSON.parse(await readFile(f.metadata,'utf8'));if(failure==='invalid observation time')meta.fetchedAt='unknown';if(failure==='invalid status')meta.status='200';if(failure==='invalid headers')meta.headers=[];await writeFile(f.metadata,JSON.stringify(meta));}
  const before=await tree(f.directory);
  if(phase==='replay')await f.cache.get(url.replace('0001','0002'),request);
  await assert.rejects(()=>phase==='sealing'?f.cache.seal(f.snapshot.manifest,{snapshotId:f.snapshot.snapshotId}):f.cache.get(url,request));
  assert.throws(()=>f.cache.assertHealthy());assert.equal(f.cache.requests,0);assert.deepEqual(await tree(f.directory),before);assert.deepEqual(f.forbidden,{network:0,retained:0});
});
test('nested and concurrent observation scopes preserve their own request dependencies',async t=>{
  const f=await fixture(t);await f.cache.seal(f.snapshot.manifest,{snapshotId:f.snapshot.snapshotId});
  const first=url.replace('0001','0002'),second=url.replace('0001','0003');
  const [a,b]=await Promise.all([
    observeFrozenInputs(f.cache,()=>observeFrozenInputs(f.cache,()=>f.cache.get(first,request))),
    observeFrozenInputs(f.cache,()=>f.cache.get(second,request)),
  ]);
  assert.deepEqual(a.gaps.map(g=>g.url),[first]);assert.deepEqual(a.value.gaps,a.gaps);assert.deepEqual(b.gaps.map(g=>g.url),[second]);
  const caught=await observeFrozenInputs(f.cache,async()=>{await assert.rejects(observeFrozenInputs(f.cache,async()=>{await f.cache.get(first,request);throw Error('kept error');}),/kept error/);});
  assert.deepEqual(caught.gaps.map(g=>g.url),[first]);
});
test('derived gaps cannot hide a false placement or change oracle assertions',()=>{
  const verification={status:'failed',reason:'wrong-boundary'},row={outcome:'false-placement',reason:'wrong-boundary',verification};
  const gaps=[{reason:'frozen-input-absent',url,accept:request.accept,snapshotId:'fixture'}];
  assert.equal(withFrozenInputGaps(row,gaps).outcome,'false-placement');assert.equal(withFrozenInputGaps(row,gaps).verification,verification);
  assert.equal(withFrozenInputGaps(row,[]),row);
});

import {test,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Writable} from 'node:stream';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {cancelCollection,collectionPending} from './memory-release.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'request-slow-'));
after(()=>rm(directory,{recursive:true,force:true}));
await writeFile(path.join(directory,'index.html'),'<p>explorer</p>');
const previousDirectory=process.env.EXPLORER_DIST_DIR;
process.env.EXPLORER_DIST_DIR=directory;
const {handleRequest}=await import('./index.mjs');
if(previousDirectory===undefined)delete process.env.EXPLORER_DIST_DIR;
else process.env.EXPLORER_DIST_DIR=previousDirectory;

// Each header the handler sets moves the mocked clock on by `step`, so a request takes time without waiting.
async function send(target,step) {
  let now=0;const warnings=[];
  const clock=mock.method(performance,'now',()=>now);
  const warn=mock.method(console,'warn',(...line)=>{warnings.push(line);});
  try {
    const response=new Writable({write(chunk,encoding,done){response.headersSent=true;done();}});
    response.setHeader=()=>{now+=step;};
    response.removeHeader=()=>{};
    const finished=once(response,'finish');
    await handleRequest({url:target,method:'GET',headers:{}},response);
    await finished;
    return {status:response.statusCode,slow:warnings.filter(line=>line[0]==='[request-slow]')};
  } finally {warn.mock.restore();clock.mock.restore();}
}

test('a slow API request logs one line with its route, status, time, main-thread CPU and memory change',async()=>{
  const {status,slow}=await send('/api/healthz',1000);
  assert.equal(status,200);
  assert.equal(slow.length,1);
  const line=JSON.parse(slow[0][1]);
  assert.deepEqual(Object.keys(line),['route','status','elapsedMs','mainCpuMs','rssDeltaMiB','heapDeltaMiB']);
  assert.equal(line.route,'/api/healthz');
  assert.equal(line.status,200);
  assert.ok(line.elapsedMs>=1000);
  for(const field of ['mainCpuMs','rssDeltaMiB','heapDeltaMiB'])assert.ok(Number.isFinite(line[field]),field);
  assert.ok(line.mainCpuMs>=0);
});

test('the root /healthz alias is logged like the API route',async()=>{
  const {slow}=await send('/healthz',1000);
  assert.equal(slow.length,1);
  assert.equal(JSON.parse(slow[0][1]).route,'/healthz');
});

test('the query string never appears in the log line',async()=>{
  const {slow}=await send('/api/not-an-endpoint?member=PRIVATE-QUERY&q=1',1000);
  assert.equal(slow.length,1);
  assert.equal(JSON.parse(slow[0][1]).route,'/api/not-an-endpoint');
  assert.equal(JSON.stringify(slow).includes('PRIVATE-QUERY'),false);
  assert.equal(JSON.stringify(slow).includes('member='),false);
});

test('a slow failing API request logs the error status',async()=>{
  const {slow}=await send('/api/not-an-endpoint',1000);
  assert.equal(slow.length,1);
  assert.equal(JSON.parse(slow[0][1]).status,404);
});

test('fast API requests and slow static requests log nothing',async()=>{
  assert.equal((await send('/api/healthz',0)).slow.length,0);
  assert.equal((await send('/',1000)).slow.length,0);
});

test('a slow request that grew the heap schedules one collection, and a flat one does not',async()=>{
  const heap=mock.method(process,'memoryUsage',(()=>{let calls=0;return ()=>({rss:0,heapTotal:0,heapUsed:calls++===0?0:200*1024*1024,external:0,arrayBuffers:0});})());
  try {
    cancelCollection();
    await send('/api/healthz',1000);
    assert.equal(collectionPending(),true);
  } finally {heap.mock.restore();cancelCollection();}
  await send('/api/healthz',1000);
  assert.equal(collectionPending(),false);
});

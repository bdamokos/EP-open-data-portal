import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {MEMORY_RELEASE,cancelCollection,collectAfterBurst,scheduleCollection} from './memory-release.mjs';

afterEach(cancelCollection);
const MIB=1024*1024;

test('one collection runs after the last burst, however many were scheduled',async()=>{
  let runs=0;
  const collect=()=>{runs++;};
  scheduleCollection({delayMs:30,collect});await sleep(10);
  scheduleCollection({delayMs:30,collect});scheduleCollection({delayMs:30,collect});
  assert.equal(runs,0);
  await sleep(120);
  assert.equal(runs,1);
});

test('only a burst of heap or resident growth schedules a collection',async()=>{
  let runs=0;
  const options={delayMs:10,collect:()=>{runs++;}};
  collectAfterBurst({heapGrowth:MEMORY_RELEASE.heapBytes-1,rssGrowth:MEMORY_RELEASE.rssBytes-1},options);
  collectAfterBurst({heapGrowth:-100*MIB,rssGrowth:-100*MIB},options);
  await sleep(60);
  assert.equal(runs,0);
  collectAfterBurst({heapGrowth:MEMORY_RELEASE.heapBytes,rssGrowth:0},options);
  await sleep(60);
  assert.equal(runs,1);
  collectAfterBurst({heapGrowth:0,rssGrowth:MEMORY_RELEASE.rssBytes},options);
  await sleep(60);
  assert.equal(runs,2);
});

test('a collector that throws does not raise',async()=>{
  scheduleCollection({delayMs:5,collect(){throw new Error('no gc');}});
  await sleep(40);
});

test('the default collector frees unreachable memory without a process flag',async()=>{
  let ran=false;
  const probe=new FinalizationRegistry(()=>{ran=true;});
  (()=>{probe.register({},'x');})();
  scheduleCollection({delayMs:5});
  for(let waited=0;!ran&&waited<3000;waited+=25)await sleep(25);
  assert.equal(ran,true);
});

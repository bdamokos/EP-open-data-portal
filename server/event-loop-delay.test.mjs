import test from 'node:test';
import assert from 'node:assert/strict';
import {measureEventLoopDelay} from './event-loop-delay.mjs';

test('delay windows warn at either threshold, reset, and dispose without keeping the process alive',()=>{
  let tick,enabled=0,resets=0,disabled=0,unrefs=0,cancelled;
  const logs=[];
  let p99=20,max=30;
  const histogram={enable(){enabled++;},disable(){disabled++;},reset(){resets++;},percentile(n){assert.equal(n,99);return p99*1e6;},get max(){return max*1e6;}};
  const timer={unref(){unrefs++;}};
  const monitor=measureEventLoopDelay({histogram,warn:line=>logs.push(line),schedule(fn,ms){tick=fn;assert.equal(ms,30000);return timer;},cancel(value){cancelled=value;}});
  tick();assert.equal(logs.length,0);
  p99=100;tick();assert.match(logs[0],/"p99Ms":100/);
  p99=20;max=250;tick();assert.match(logs[1],/"maxMs":250/);
  assert.deepEqual(monitor.snapshot(),{p99Ms:20,maxMs:250});
  assert.equal(resets,3);assert.equal(enabled,1);assert.equal(unrefs,1);
  monitor.stop();assert.equal(disabled,1);assert.equal(cancelled,timer);
});

test('native histogram records a local event-loop stall',async()=>{
  const monitor=measureEventLoopDelay();
  try {
    await new Promise(resolve=>setTimeout(resolve,40));
    const until=performance.now()+80;while(performance.now()<until) { /* bounded local fake index work */ }
    await new Promise(resolve=>setTimeout(resolve,40));
    assert(monitor.snapshot().maxMs>=60);
  } finally {monitor.stop();}
});

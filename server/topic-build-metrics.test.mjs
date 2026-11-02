import test from 'node:test';import assert from 'node:assert/strict';import {topicBuildMetrics} from './topic-build-metrics.mjs';
for(const outcome of ['complete','failed','cancelled'])test('one '+outcome+' build log records elapsed time and sampled process RSS, then stops sampling',t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=100,rss=100*1048576,reads=0;const logs=[],finish=topicBuildMetrics({operation:'topics',generation:20},{now:()=>now,rss:()=>{reads++;return rss;},usage:()=>({maxRSS:200*1024}),log:(...args)=>logs.push(args)});
 rss=150*1048576;t.mock.timers.tick(250);rss=110*1048576;now=1700;finish(outcome);finish(outcome);const ended=reads;t.mock.timers.tick(1000);assert.equal(reads,ended);assert.equal(logs.length,1);assert.equal(logs[0][0],'[topics-build]');assert.deepEqual(JSON.parse(logs[0][1]),{operation:'topics',generation:20,outcome,durationMs:1600,peakRssMiB:150,processLifetimePeakRssMiB:200,rssScope:'process',rssSampleMs:250});
});
test('unavailable telemetry is null and a failed log sink cannot fail a build',()=>{
 const logs=[],finish=topicBuildMetrics({operation:'stories',generation:1},{rss:()=>{throw Error('unavailable');},usage:()=>{throw Error('unavailable');},log:(...args)=>logs.push(args)});finish('failed');assert.equal(JSON.parse(logs[0][1]).peakRssMiB,null);assert.equal(JSON.parse(logs[0][1]).processLifetimePeakRssMiB,null);
 const failedSink=topicBuildMetrics({}, {log:()=>{throw Error('sink unavailable');}});assert.doesNotThrow(()=>failedSink('complete'));
});

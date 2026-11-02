import test from 'node:test';import assert from 'node:assert/strict';import {topicBuildWindowOpen,topicBuildWindowRemaining} from './topic-build-window.mjs';
test('full rebuild window uses Brussels time, exclusive end and DST',()=>{
 for(const date of ['2026-11-02T02:00Z','2026-11-02T03:59Z','2026-07-02T01:00Z'])assert(topicBuildWindowOpen(Date.parse(date)));
 for(const date of ['2026-11-02T01:59Z','2026-11-02T04:00Z','2026-07-02T03:00Z'])assert.equal(topicBuildWindowOpen(Date.parse(date)),false);
 assert(topicBuildWindowOpen(Date.parse('2026-11-02T22:30Z'),'23:00-01:00'));assert(topicBuildWindowOpen(Date.parse('2026-11-02T15:00Z'),'00:00-24:00'));assert.throws(()=>topicBuildWindowOpen(Date.now(),'24:30-25:00'));assert.throws(()=>topicBuildWindowOpen(Date.now(),'invalid'));
});

test('window deadlines include the partial minute and keep full-day overrides unbounded',()=>{assert.equal(topicBuildWindowRemaining(Date.parse('2026-11-02T03:59:30Z')),30000);assert.equal(topicBuildWindowRemaining(Date.parse('2026-11-02T04:00:00Z')),0);assert.equal(topicBuildWindowRemaining(Date.now(),'00:00-24:00'),Infinity);});

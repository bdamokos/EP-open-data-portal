import test from 'node:test';
import assert from 'node:assert/strict';
import {brusselsDay} from './analysis-period.mjs';

test('Brussels dates follow winter, summer and leap-day boundaries across repeated calls',()=>{
  const cases=[
    ['2026-01-01T22:59:59Z','2026-01-01'],['2026-01-01T23:00:00Z','2026-01-02'],
    ['2026-07-01T21:59:59Z','2026-07-01'],['2026-07-01T22:00:00Z','2026-07-02'],
    ['2026-03-28T23:00:00Z','2026-03-29'],['2026-03-29T22:00:00Z','2026-03-30'],
    ['2026-10-24T22:00:00Z','2026-10-25'],['2026-10-25T22:00:00Z','2026-10-25'],
    ['2028-02-28T23:00:00Z','2028-02-29'],['2028-02-29T23:00:00Z','2028-03-01'],
  ];
  for(const [instant,expected] of [...cases,...cases.toReversed()])assert.equal(brusselsDay(Date.parse(instant)),expected,instant);
});

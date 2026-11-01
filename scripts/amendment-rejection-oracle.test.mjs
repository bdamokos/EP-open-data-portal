import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRejection} from './amendment-rejection-oracle.mjs';
test('rejection oracle refuses unrelated sources and uncalibrated document operations',()=>{
  assert.equal(verifyRejection({id:'A-10-2025-0158-AM-422',language:'en',buffer:Buffer.from('unrelated')} ).status,'failed');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'document-operation'}}).status,'unverified');
  assert.equal(verifyRejection({id:'unknown',language:'en',placement:{status:'unresolved'}}),null);
});

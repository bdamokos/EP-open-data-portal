import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {assertLocalRecitalBoundary} from './amendment-local-recital-oracle.mjs';
// Missing native bytes or an incomplete identity never borrows producer evidence.
test('local recital oracle requires native source, amendment and exact new label',()=>{
 for(const wording of [{},{language:'en',baseline:'commission-proposal',targetLabel:'Recital 1a (new)',originalText:'',proposedText:'(1a) Added.'}])assert.equal(assertLocalRecitalBoundary({proposal:{},wording,placement:{operation:'insert',insertBefore:2},nativeQuoted:null}).status,'unverified');
});

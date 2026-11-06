import test from 'node:test';import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {resolutionBoundaryNative} from './fixtures/resolution-boundary-native.mjs';
test('the former numeric-point boundary cannot be verified',()=>{
 const input=resolutionBoundaryNative({point:true});
 assert.notEqual(verifyPlacement(input).status,'verified');
});
test('all other held addresses must agree and the boundary follows their existing point',()=>{
 const input=resolutionBoundaryNative({point:true,change:xml=>xml.replace('b)','l)')});
 input.wording.addressEditions=[{language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point l a (new)'},{language:'bg',baseline:'motion-resolution',targetLabel:'Параграф 1 – буква л а (нова)'}];
 assert.equal(verifyPlacement(input).status,'failed');
 const correct={...input,placement:{...input.placement,insertAfter:4,insertBefore:5}};
 assert.equal(verifyPlacement(correct).status,'verified');
 input.wording.addressEditions[1].targetLabel='Параграф 1 – буква м а (нова)';
 assert.notEqual(verifyPlacement(correct).status,'verified');
});

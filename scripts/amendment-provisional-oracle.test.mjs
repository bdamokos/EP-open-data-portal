import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionalFixture} from '../server/test-support/provisionalFixture.mjs';
import {verifyProvisional} from './amendment-provisional-oracle.mjs';
test('native provisional oracle independently binds complete agreement identity and document scope',()=>{
 const input=provisionalFixture();
 assert.equal(verifyProvisional(input).status,'verified');
 const placement={status:'document-operation',operation:'replace',scope:'whole-document'};
 assert.equal(verifyProvisional({...input,placement}).status,'verified');
 for(const field of ['span','splice','insertAfter','insertBefore','itemIndex'])assert.equal(verifyProvisional({...input,placement:{...placement,[field]:0}}).status,'failed');
 for(const changed of [{report:'A10-0002/2026'},{number:4},{label:'Article 1'},{body:''}])assert.equal(verifyProvisional(provisionalFixture(changed)).status,'unverified');
 for(const changed of [{id:'A-10-2026-0002-AM-3'},{listId:'A-10-2026-0001-AM-002-004'},{decisions:[]},{buffer:Buffer.from('missing')}])assert.equal(verifyProvisional({...input,...changed}).status,'unverified');
});

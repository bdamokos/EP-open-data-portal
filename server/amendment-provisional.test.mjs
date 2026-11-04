import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentProvisional} from './amendment-provisional.mjs';
import {provisionalFixture} from './test-support/provisionalFixture.mjs';

test('provisional agreement replaces only the exact native whole document',()=>{
 const input=provisionalFixture();
 const result=amendmentProvisional(input);
 assert.equal(result.status,'document-operation');assert.equal(result.operation,'replace');assert.equal(result.scope,'whole-document');
 assert.equal(result.evidence[0].sourceUrl,input.source.url);
 for(const field of ['span','splice','insertAfter','insertBefore','itemIndex'])assert.equal(Object.hasOwn(result,field),false);
 for(const changed of [{report:'A10-0002/2026'},{number:4},{label:'Article 1'},{body:''}])assert.equal(amendmentProvisional(provisionalFixture(changed)),null);
 for(const changed of [{amendmentId:'A-10-2026-0002-AM-3'},{listId:'A-10-2026-0001-AM-002-004'},{decisions:[]},{buffer:Buffer.from('missing')},{source:{...input.source,url:input.source.url.replace('_en.docx','_fr.docx')}},{source:{...input.source,fetchedAt:null}}])assert.equal(amendmentProvisional({...input,...changed}),null);
 const detached={...input.decisions[0],amendmentIds:['A-10-2026-0001-AM-4']};assert.equal(amendmentProvisional({...input,decisions:[detached]}),null);
});

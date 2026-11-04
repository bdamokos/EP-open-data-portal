import test from 'node:test';import assert from 'node:assert/strict';import {proposalInsertionNote} from './proposalInsertionNote.mjs';
const placement={status:'placed',outerOperation:'insert'};
test('an inner-law comparison retains the new outer instruction number',()=>{
 for(const [base,child] of [['6','a'],['10','a'],['10','b'],['29','c']])assert.deepEqual(proposalInsertionNote({baseline:'present-text',language:'pl',targetLabel:`Artykuł 1 – akapit 1 – punkt ${base} a – litera ${child} (nowa)`},placement),{point:base+'a',base});
 assert.equal(proposalInsertionNote({baseline:'present-text',language:'pl',targetLabel:'Artykuł 1 – akapit 1 – punkt 6 a – litera a'},placement),null);
 assert.equal(proposalInsertionNote({baseline:'present-text',language:'pl',targetLabel:'Artykuł 1 – akapit 1 – punkt 6 a – litera a (nowa)'},{status:'unresolved'}),null);
});

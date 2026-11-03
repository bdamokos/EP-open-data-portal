import test from 'node:test';import assert from 'node:assert/strict';import {printedActTarget} from './amendment-printed-target-oracle.mjs';
const rows=['Amendment\t77','Proposal for a regulation','Article 1 – paragraph 1 – point 20','Regulation (EU) 2023/956','Article 30 – paragraph 6 – subparagraph 2 – point b – point ii a (new)'].map(text=>({kind:'paragraph',text,hidden:false,unsafe:false}));
test('native printed inner address needs one complete header before the comparison table',()=>{
 assert.equal(printedActTarget([...rows,{kind:'other'}],77)?.act,'Regulation (EU) 2023/956');
 assert.equal(printedActTarget([...rows,{kind:'paragraph',text:'Extra text'},{kind:'other'}],77),null);
 assert.equal(printedActTarget([...rows,{kind:'other'}],78),null);
 assert.equal(printedActTarget(rows,77),null);
});

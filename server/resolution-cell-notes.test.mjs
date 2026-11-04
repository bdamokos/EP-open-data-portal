import test from 'node:test';import assert from 'node:assert/strict';
import {resolutionFootnoteMatch} from './resolution-footnotes.mjs';
const text={paragraphs:['S. Alpha beta.'],notesStatus:'extracted',noteAnchors:[{paragraph:0,offset:8,note:'n'}],notes:[{id:'n',text:'Source citation.'}]};
test('direct cell note paragraphs allow terminal label dots and require exact payload and offset',()=>{
 const original='S. Alpha16 beta.\n16. Source citation.',formatting=[{kind:'superscript',start:8,end:10}];assert.equal(resolutionFootnoteMatch(text,0,0,original,formatting),true);assert.equal(resolutionFootnoteMatch(text,0,0,original.replace('Source citation.','Other citation.'),formatting),false);assert.equal(resolutionFootnoteMatch({...text,noteAnchors:[{paragraph:0,offset:10,note:'n'}]},0,0,original,formatting),false);
});

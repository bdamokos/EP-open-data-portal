import test from 'node:test';import assert from 'node:assert/strict';
import {resolutionFootnoteMatch} from './resolution-footnotes.mjs';
const text={paragraphs:['U. whereas the published source is available;'],notesStatus:'extracted',noteAnchors:[{paragraph:0,offset:31,note:'n1'}],notes:[{id:'n1',text:'https://example.org/source.'}]};
const original='U. whereas the published source17 is available;\n17. https://example.org/source.',formatting=[{kind:'superscript',start:31,end:33}];
test('an unruled dotted payload requires every native body, note and anchor to agree',()=>{
 assert(resolutionFootnoteMatch(text,0,0,original,formatting));
 for(const changed of [original.replace('17. ','18. '),original.replace('source.','other.'),original.replace('available','missing')])assert.equal(resolutionFootnoteMatch(text,0,0,changed,formatting),false);
 assert.equal(resolutionFootnoteMatch({...text,noteAnchors:[{paragraph:0,offset:1,note:'n1'}]},0,0,original,formatting),false);
 assert.equal(resolutionFootnoteMatch({...text,notesStatus:'unavailable'},0,0,original,formatting),false);
});

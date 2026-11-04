import test from 'node:test';import assert from 'node:assert/strict';
import {identicalNativeEditionText} from './amendment-edition-oracle.mjs';
const xml=t=>'<w:document><w:body><w:p><w:r><w:t>'+t+'</w:t></w:r></w:p></w:body></w:document>';
const parts=(body,note='Note')=>new Map([['word/document.xml',xml(body)],['word/footnotes.xml',xml(note)]]);
test('native edition equality includes body and notes but ignores run formatting',()=>{
 const a=parts('Article 1'),b=parts('Article 1');b.set('word/document.xml',xml('Article 1').replace('<w:r>','<w:r><w:rPr><w:b/></w:rPr>'));
 assert(identicalNativeEditionText([a,b]));
 for(const other of [parts('Article 2'),parts('Article 1','Different'),new Map(),parts('')])assert.equal(identicalNativeEditionText([a,other]),false);
 assert.equal(identicalNativeEditionText([a]),false);
});

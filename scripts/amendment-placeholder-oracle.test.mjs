import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertPlaceholderDeletion} from './amendment-placeholder-oracle.mjs';
const f=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-placeholder-amounts.json',import.meta.url)));
const text=()=>({paragraphs:[...f.paragraphs],paragraphFormats:structuredClone(f.paragraphFormats),textLanguage:'en',structureStatus:'extracted',paragraphSources:f.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))});
test('independently verifies native addressed budget placeholders and complete child extent',()=>{
 for(const c of f.cases){const p={status:'placed',operation:'delete',span:c.span};assert.equal(assertPlaceholderDeletion({text:text(),wording:c.wording,placement:p}).status,'verified',c.id);
 for(const change of [a=>a.placement.span={start:c.span.start,end:c.span.end+1},a=>a.wording.originalText=a.wording.originalText.replace('XXX','YYY'),a=>a.wording.originalText=a.wording.originalText.replace(/(?:11|12|13)/u,'99'),a=>a.text.paragraphSources[c.span.start].complete=false]){const a={text:text(),wording:structuredClone(c.wording),placement:structuredClone(p)};change(a);assert.notEqual(assertPlaceholderDeletion(a).status,'verified',c.id);}}
});
test('an explicit amount remains literal even beside another placeholder',()=>{
 const c=f.cases[1],w={...c.wording,originalText:c.wording.originalText.replace('XXX','123')};
 assert.notEqual(assertPlaceholderDeletion({text:text(),wording:w,placement:{status:'placed',operation:'delete',span:c.span}}).status,'verified');
});

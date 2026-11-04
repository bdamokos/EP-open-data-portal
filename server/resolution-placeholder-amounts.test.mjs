import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/resolution-placeholder-amounts.json',import.meta.url)));
const text=()=>({paragraphs:[...f.paragraphs],paragraphFormats:structuredClone(f.paragraphFormats),textLanguage:'en',structureStatus:'extracted',paragraphSources:f.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))});
test('deletes each uniquely addressed native budget point with explicit amount placeholders',()=>{
 for(const c of f.cases){const p=resolveAmendmentPlacement(text(),c.wording);assert.equal(p.status,'placed',c.id);assert.deepEqual(p.span,c.span,c.id);
 for(const change of [a=>a.wording.originalText=a.wording.originalText.replaceAll('XXX','YYY'),a=>a.wording.originalText=a.wording.originalText.replace(/(?:11|12|13)/u,'99'),a=>a.text.paragraphSources[c.span.start].complete=false]){const a={text:text(),wording:structuredClone(c.wording)};change(a);assert.notEqual(resolveAmendmentPlacement(a.text,a.wording).status,'placed',c.id);}}
});
test('a placeholder never erases a different explicitly stated amount',()=>{
 const c=f.cases[1],w={...c.wording,originalText:c.wording.originalText.replace('XXX','123')};
 assert.notEqual(resolveAmendmentPlacement(text(),w).status,'placed');
});

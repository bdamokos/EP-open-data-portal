import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResolutionSimilarity} from './amendment-similarity-oracle.mjs';
const original='Calls on the Commission and the Member States to develop a common definition to recognise and address discrimination across the Union;';
const row=text=>({start:3,end:3,text});
test('resolution oracle accepts small damage and a unique shared opening',()=>{
 for(const text of [original.replace('Commission','Commissio'),original.slice(0,100)+' a different ending;'])assert(assertResolutionSimilarity([row(text)],original,{start:3,end:3}));
});
test('resolution oracle rejects competing passages and changed coordinates',()=>{
 const candidates=[row(original),{...row(original),start:4,end:4}];
 assert(!assertResolutionSimilarity(candidates,original,{start:3,end:3}));
 assert(!assertResolutionSimilarity([row(original)],original,{start:2,end:2}));
 assert(!assertResolutionSimilarity([row('Unrelated wording;')],original,{start:3,end:3}));
});

test('resolution oracle retains a nonadjacent incomplete labelled competitor',async()=>{
 const {verifyPlacement}=await import('./amendment-benchmark-model.mjs');
 const {readFileSync}=await import('node:fs');
 const example=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-near-matches.json',import.meta.url)))[0];
 const original=example.originalText.replace(/^7\.\s*/u,'');
 const paragraphs=['The European Parliament,','1. '+example.source[1].replace(/^7\.\s*/u,''),'2. Unrelated provision;','3. '+original.replace('Stresses','stresses'),'4. Closing provision;'];
 const text={paragraphs,structureStatus:'extracted',textLanguage:'en',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:ordinal!==3})),paragraphProperties:paragraphs.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))};
 const wording={originalText:original,proposedText:'Changed;',targetLabel:'Paragraph 1',language:'en',baseline:'motion-resolution'};
 assert.equal(verifyPlacement({placement:{status:'placed',operation:'replace',span:{start:1,end:1}},wording,text}).status,'failed');
});

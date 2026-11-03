import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const original='Calls on the Commission and the Member States to develop a common definition to recognise and address discrimination across the Union;';
const source=paras=>({paragraphs:paras,structureStatus:'extracted',textLanguage:'en',paragraphSources:paras.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paras.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))});
const wording={originalText:original,proposedText:'Changed;',targetLabel:'Paragraph 1',language:'en',baseline:'motion-resolution'};
test('resolution accepts unique small damage and replaced endings with independent verification',()=>{
 for(const value of [original.replace('Commission','Commissio'),original.slice(0,100)+' a different ending;']) {
  const text=source(['The European Parliament,','1. '+value,'2. An unrelated provision;']);
  const result=resolveAmendmentPlacement(text,wording);
  assert.equal(result.status,'placed',result.reason);assert.deepEqual(result.span,{start:1,end:1});
  assert.equal(verifyPlacement({placement:result,wording,text}).status,'verified');
 }
});
test('resolution near matches preserve completeness and competing-match guards',()=>{
 const text=source(['The European Parliament,','1. '+original.replace('Commission','Commissio'),'2. '+original]);
 assert.equal(resolveAmendmentPlacement(text,wording).status,'unresolved');
 text.paragraphs[2]='2. Unrelated;';text.paragraphSources[1].complete=false;
 assert.equal(resolveAmendmentPlacement(text,wording).status,'unresolved');
});

test('new recitals beyond the last append before the operative body',()=>{
 for(const targetLabel of ['Recital C (new)','Recital Z a (new)']) {
  const text=source(['The European Parliament,','A. First recital;','B. Last recital;','1. First operative paragraph;','2. Last paragraph;']);
  const amendment={...wording,targetLabel,originalText:''};
  const result=resolveAmendmentPlacement(text,amendment);
  assert.equal(result.status,'placed',result.reason);assert.equal(result.insertBefore,3);
  assert.equal(verifyPlacement({placement:result,wording:amendment,text}).status,'verified');
  text.paragraphSources[2].complete=false;
  assert.equal(resolveAmendmentPlacement(text,amendment).status,'unresolved');
 }
});
test('a recital in a recital-free resolution precedes the operative body',()=>{
 const text=source(['The European Parliament,','– having regard to the Treaty,','1. First operative paragraph;','2. Last paragraph;']);
 const amendment={...wording,targetLabel:'Recital -A (new)',originalText:''};
 const result=resolveAmendmentPlacement(text,amendment);
 assert.equal(result.status,'placed',result.reason);assert.equal(result.insertBefore,2);
 assert.equal(verifyPlacement({placement:result,wording:amendment,text}).status,'verified');
});

for(const example of JSON.parse(readFileSync(new URL('./fixtures/resolution-near-matches.json',import.meta.url))))test(`replaced ending in native source excerpt: ${example.id}`,()=>{
 const text=source([example.language==='nl'?'Het Europees Parlement,':'The European Parliament,',...example.source]);text.textLanguage=example.language;
 const amendment={...wording,...example,baseline:'motion-resolution'};
 const placement=resolveAmendmentPlacement(text,amendment);
 assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:2,end:2});
 assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified');
});

test('existing recital anchors survive Greek lookalikes in later source labels',()=>{
 const text=source(['The European Parliament,','A. First recital;','B. Second recital;','Ν. Greek lookalike in a later label;','1. First operative paragraph;','2. Last paragraph;']);
 const amendment={...wording,targetLabel:'Recital A a (new)',originalText:''};
 const placement=resolveAmendmentPlacement(text,amendment);
 assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.insertAfter,1);
 assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified');
});

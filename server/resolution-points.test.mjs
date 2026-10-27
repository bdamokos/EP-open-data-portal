import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/resolution-nested-points.json',import.meta.url)));
const place=(text,targetLabel,originalText='',language=text.language)=>resolveAmendmentPlacement(text,{targetLabel,originalText,proposedText:'Replacement.',language,baseline:'motion-resolution'});

test('recommendation points retain their paragraph across verified topic headings',()=>{
 const text=fixtures[0];
 for(const [label,index] of [['a',4],['d',7],['i',12],['j',14]]){
  const result=place(text,`Paragraphe 1 – point ${label}`,text.paragraphs[index]);
  assert.equal(result.status,'placed',label+': '+result.reason);assert.deepEqual(result.span,{start:index,end:index});
 }
 const insertion=place(text,'Paragraphe 1 – point i a (nouveau)');
 assert.equal(insertion.status,'placed');assert.equal(insertion.insertBefore,13,'before the next topic heading');
});

test('point within point uses exact indentation and its full parent chain',()=>{
 const text=fixtures[1],source=text.paragraphs[6];
 const result=place(text,'Paragraph 22 – point b – point i',source);
 assert.equal(result.status,'placed');assert.deepEqual(result.span,{start:6,end:6});
 assert.equal(place(text,'Paragraph 22 – point a – point i',source).reason,'conflicting_target_evidence');
 assert.equal(place(text,'Paragraph 21 – point b – point i',source).status,'unresolved');
 for(const indent of [undefined,text.paragraphFormats[5].indent]){
  const copy=structuredClone(text);copy.paragraphFormats[6].indent=indent;
  assert.equal(place(copy,'Paragraph 22 – point b – point i',source).status,'unresolved');
 }
});

test('headings do not establish a parent across missing rows or a restarted point sequence',()=>{
 const text=fixtures[0];
 for(const change of [copy=>copy.paragraphSources[13].complete=false,copy=>copy.paragraphSources[14].ordinal+=2,copy=>copy.paragraphs[14]=copy.paragraphs[14].replace(/^j\)/,'a)'),copy=>copy.paragraphFormats[13].marks=[]]){
  const copy=structuredClone(text);change(copy);
  assert.equal(place(copy,'Paragraphe 1 – point j',text.paragraphs[14]).status,'unresolved');
 }
});

test('insertion requires the published base and a verified sibling or heading boundary',()=>{
 const text=fixtures[0];
 assert.equal(place(text,'Paragraphe 1 – point d a (nouveau)').insertBefore,8);
 assert.equal(place(text,'Paragraphe 1 – point z a (nouveau)').status,'unresolved');
 const duplicate=structuredClone(text);duplicate.paragraphs[8]=duplicate.paragraphs[8].replace(/^e\)/,'d)');
 assert.equal(place(duplicate,'Paragraphe 1 – point d a (nouveau)').reason,'multiple_published_targets');
});

test('published French alphabetic points retain Latin insertion suffixes at the topic boundary',()=>{
 const text=fixtures[0];
 for(const suffix of ['bis','ter','quater','quinquies','sexies']){
  const result=place(text,`Paragraphe 1 – point i ${suffix} (nouveau)`);
  assert.equal(result.status,'placed',suffix+': '+result.reason);assert.equal(result.insertBefore,13);
  const wording={language:'fr',baseline:'motion-resolution',targetLabel:`Paragraphe 1 – point i ${suffix} (nouveau)`,originalText:'',proposedText:'Replacement.'};
  assert.equal(verifyPlacement({placement:result,wording,text}).status,'verified');
  assert.equal(verifyPlacement({placement:{...result,insertAfter:13,insertBefore:14},wording,text}).status,'failed');
 }
});

test('an incomplete duplicate point cannot establish an insertion anchor',()=>{
 const text=structuredClone(fixtures[0]);text.paragraphs[8]=text.paragraphs[8].replace(/^e\)/,'d)');text.paragraphSources[8].complete=false;
 assert.equal(place(text,'Paragraphe 1 – point d bis (nouveau)').status,'unresolved');
});

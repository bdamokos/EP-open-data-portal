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

const nearBody='Support public authorities in managing water resources across borders, improving affordable access to safe water and sanitation for residents, and encouraging sustainable farming and responsible investment in effective local infrastructure.';
function nearFixture(){const paragraphs=['The European Parliament,','1. Recommends the following:','(n) '+nearBody,'The implementing bodies shall publish the results each year.','(o) Supports a separate programme for industrial pollution.','2. Next provision.','3. Closing provision.'];return {structureStatus:'extracted',textLanguage:'en',language:'en',paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphFormats:paragraphs.map((_,i)=>({indent:[2,3,4].includes(i)?360:0}))};}
const nearWording={language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point n',originalText:'(n) '+nearBody.replace('safe water','clean water')+'\nThe implementing bodies shall publish the results each year.',proposedText:'(n) Revised wording.'};
const nearPlace=(text=nearFixture(),wording=nearWording)=>resolveAmendmentPlacement(text,wording);
test('point near-match keeps its exact parent identity and all native continuation rows',()=>{
 const text=nearFixture(),result=nearPlace(text);assert.equal(result.status,'placed',result.reason);assert.deepEqual(result.span,{start:2,end:3});assert.equal(verifyPlacement({text,wording:nearWording,placement:result}).status,'verified');
 for(const patch of [{targetLabel:'Paragraph 2 – point n'},{targetLabel:'Paragraph 1 – point m'},{targetLabel:'Paragraph 1'},{proposedText:'(m) Revised wording.'},{originalText:nearWording.originalText+'\n______\n1 Detached note.'},{originalFormatting:[{kind:'superscript',start:10,end:11}]},{referenceText:'Paragraph 1 – point m'}])assert.equal(nearPlace(text,{...nearWording,...patch}).status,'unresolved',JSON.stringify(patch));
 for(const change of [t=>t.paragraphSources[2].complete=false,t=>t.paragraphSources[4].complete=false,t=>t.paragraphSources[3].ordinal++,t=>t.paragraphFormats[2].indent=0,t=>t.anchors=[{paragraph:2,offset:50,note:'5'}]]){const t=nearFixture();change(t);assert.equal(nearPlace(t).status,'unresolved',String(change));}
});
test('similar points elsewhere, including incomplete candidates, cannot disappear from the margin',()=>{
 for(const incomplete of [false,true]){
  const t=nearFixture();t.paragraphs.splice(6,0,'(a) '+nearWording.originalText.slice(4));
  t.paragraphSources=t.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:!(incomplete&&ordinal===6)}));t.paragraphFormats.splice(6,0,{indent:360});
  assert.equal(nearPlace(t).status,'unresolved');
 }
 const repeated=nearFixture();repeated.paragraphs[4]='(o) '+nearWording.originalText.slice(4);assert.equal(nearPlace(repeated).status,'unresolved');
});

test('a damaged competing point retains matching continuations before an opaque tail',()=>{
 const t=nearFixture(),copy=nearWording.originalText.slice(4),split=copy.indexOf('resources');
 t.paragraphs.splice(6,0,'(a) '+copy.slice(0,split),copy.slice(split),'Additional unrelated surviving text '.repeat(10));t.paragraphFormats.splice(6,0,{indent:360},{indent:360},{indent:360});t.paragraphSources=t.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:ordinal!==6}));
 const placement=nearPlace(t);assert.equal(placement.status,'unresolved');
 const forced={status:'placed',operation:'replace',span:{start:2,end:3}};assert.notEqual(verifyPlacement({text:t,wording:nearWording,placement:forced}).status,'verified');
});

test('published decision comparisons use the same bounded exact point near-match',()=>{
 const text=nearFixture(),options={...nearWording,baseline:'unknown',resolutionDocument:true,documentReferences:[{field:'DocAmend',raw:'Proposal for a decision'}],baselineSource:{headings:[{left:{raw:'Proposal for a decision'},right:{raw:'Amendment'}}]}};
 assert.equal(nearPlace(text,options).status,'placed');
 for(const patch of [{resolutionDocument:false},{documentReferences:[]},{baselineSource:{headings:[]}},{baseline:'commission-proposal'}])assert.equal(nearPlace(text,{...options,...patch}).status,'unresolved');
});

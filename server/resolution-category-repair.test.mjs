import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';

const profiles={en:['The European Parliament,','having regard to','whereas','Citation C a (new)','Ca. whereas New protection;'],fr:['Le Parlement européen,','vu','considérant','Visa C bis (nouveau)','C bis. considérant la protection;'],cs:['Evropský parlament,','s ohledem na','vzhledem k tomu, že','Právní východisko C a (nové)','Ca. vzhledem k tomu, že ochrana;']};
function example(language='fr') {
 const [opening,citation,recital,targetLabel,proposedText]=profiles[language],paragraphs=[opening,'– '+citation+' the treaty,',...['A','B','C','D'].map(label=>label+'. '+recital+' Published condition;'),'1. Calls for action;','2. Next action;'];
 return {text:{textLanguage:language,structureStatus:'extracted',documentObjects:[],paragraphs,paragraphFormats:paragraphs.map(()=>({})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))},wording:{language,baseline:'motion-resolution',targetLabel,originalText:'',proposedText}};
}
test('explicit matching recital cues repair only a missing citation category candidate',()=>{
 for(const language of Object.keys(profiles)) {
  const input=example(language),placement=resolveAmendmentPlacement(input.text,input.wording);assert.equal(placement.status,'placed',language);assert.deepEqual([placement.insertAfter,placement.insertBefore],[4,5]);assert.equal(verifyPlacement({...input,placement}).status,'verified');
 }
});
test('citation category repair preserves all amendment and native preamble guards',()=>{
 const mutations=[
  x=>x.wording.targetLabel='Visa D bis (nouveau)',x=>x.wording.targetLabel+='\nArticle 1',x=>x.wording.proposedText='C bis. Nouvelle protection;',
  x=>x.wording.proposedText='D bis. considérant une protection;',x=>x.wording.originalText='Old wording',x=>x.wording.referenceText='After citation C',
  x=>x.wording.baseline='present-text',x=>x.wording.baselineSource={conflicted:true},x=>x.text.textLanguage='en',
  x=>x.text.paragraphs[1]='C. vu le traité,',x=>x.text.paragraphs[1]='– C. vu le traité,',x=>x.text.paragraphSources[1].complete=false,
  x=>x.text.paragraphSources[4].ordinal++,x=>x.text.paragraphs[3]='C. considérant une autre condition;',x=>x.text.paragraphs[4]='C. vu une condition,',
  x=>x.text.paragraphs[5]='E. considérant une condition;',x=>x.text.paragraphs[5]+='\uFFFC',x=>x.text.anchors=[{paragraph:4}],
  x=>x.text.paragraphs[7]='C. considérant une deuxième condition;',x=>x.text.paragraphs[7]='Cbis. considérant un ajout existant;',
 ];
 for(const mutate of mutations){const input=example();mutate(input);assert.notEqual(resolveAmendmentPlacement(input.text,input.wording).status,'placed',mutate.toString());}
});
test('a complete multiline recital fixes the entire insertion extent',()=>{
 const input=example();input.text.paragraphs.splice(5,0,'suite de la condition;');input.text.paragraphFormats.splice(5,0,{});input.text.paragraphSources=input.text.paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}));
 let placement=resolveAmendmentPlacement(input.text,input.wording);assert.deepEqual([placement.insertAfter,placement.insertBefore],[5,6]);assert.equal(verifyPlacement({...input,placement}).status,'verified');input.text.paragraphSources[5].complete=false;assert.notEqual(resolveAmendmentPlacement(input.text,input.wording).status,'placed');
});

test('citation footnotes stay outside the bounded recital insertion',()=>{const input=example();input.text.anchors=[{paragraph:1,offset:20}];const placement=resolveAmendmentPlacement(input.text,input.wording);assert.equal(placement.status,'placed');assert.equal(verifyPlacement({...input,placement}).status,'verified');});

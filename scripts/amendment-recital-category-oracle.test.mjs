import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRecitalCategoryRepair} from './amendment-recital-category-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

const profiles={en:['The European Parliament,','having regard to','whereas','Citation C a (new)','Ca. whereas New protection;'],fr:['Le Parlement européen,','vu','considérant','Visa C bis (nouveau)','C bis. considérant la protection;'],cs:['Evropský parlament,','s ohledem na','vzhledem k tomu, že','Právní východisko C a (nové)','Ca. vzhledem k tomu, že ochrana;']};
function example(language='fr') {
  const [opening,citation,recital,targetLabel,proposedText]=profiles[language],paragraphs=[opening,'– '+citation+' the treaty,',...['A','B','C','D'].map(label=>label+'. '+recital+' Published condition;'),'1. Calls for action;','2. Next action;'];
  const text={textLanguage:language,paragraphs,paragraphFormats:paragraphs.map(()=>({})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  Object.defineProperty(text,'units',{get(){throw Error('runtime tree forbidden');}});
  return {text,wording:{language,baseline:'motion-resolution',targetLabel,originalText:'',proposedText},placement:{status:'placed',operation:'insert',insertAfter:4,insertBefore:5}};
}
test('independent category repair verifies the matching explicit recital and exact gap',()=>{
  for(const language of Object.keys(profiles)) {
    const input=example(language);assert.equal(assertRecitalCategoryRepair(input).status,'verified');assert.equal(verifyPlacement(input).status,'verified');
    assert.equal(assertRecitalCategoryRepair({...input,placement:{...input.placement,insertAfter:5,insertBefore:6}}).status,'failed');
  }
});
test('each required tabled category, label, completeness and absence cue is binding',()=>{
  const mutations=[
    x=>x.wording.targetLabel='Considérant C bis (nouveau)',x=>x.wording.targetLabel='Visa D bis (nouveau)',x=>x.wording.targetLabel+='\nArticle 1',
    x=>x.wording.proposedText='C bis. Protection nouvelle;',x=>x.wording.proposedText='D bis. considérant la protection;',x=>x.wording.originalText='Old wording',
    x=>x.wording.referenceText='After citation C',x=>x.wording.baseline='present-text',x=>x.wording.baselineSource={conflicted:true},
    x=>x.text.paragraphSources[1].complete=false,x=>x.text.paragraphSources[4].ordinal++,x=>x.text.paragraphs[1]='C. vu le traité,',
    x=>x.text.paragraphs[1]='– C. vu le traité,',x=>x.text.paragraphs[3]='C. considérant une autre condition;',
    x=>x.text.paragraphs[4]='C. vu une condition,',x=>x.text.paragraphs[5]='E. considérant une autre condition;',
    x=>x.text.paragraphs[5]='D. Considération sans marqueur;',x=>x.text.paragraphs[5]+='\uFFFC',
    x=>x.text.anchors=[{paragraph:4}],x=>x.text.paragraphs[0]='Unknown opening',x=>x.text.paragraphs[7]='Le Parlement européen,',
  ];
  for(const mutate of mutations){const input=example();mutate(input);assert.notEqual(assertRecitalCategoryRepair(input).status,'verified',mutate.toString());}
});
test('all rows of a multi-row recital must be complete before its following successor',()=>{
 const input=example();input.text.paragraphs.splice(5,0,'suite de la condition;');input.text.paragraphFormats.splice(5,0,{});input.text.paragraphSources=input.text.paragraphs.map((_,ordinal)=>({path:'p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}));input.placement={...input.placement,insertAfter:5,insertBefore:6};
 assert.equal(assertRecitalCategoryRepair(input).status,'verified');input.text.paragraphSources[5].complete=false;assert.notEqual(assertRecitalCategoryRepair(input).status,'verified');
});

test('unrelated citation notes do not change the explicit recital category or bounds',()=>{const input=example();input.text.anchors=[{paragraph:1,offset:20}];assert.equal(assertRecitalCategoryRepair(input).status,'verified');});

import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMixedRecital} from './amendment-benchmark-resolution-oracle.mjs';
function input() {
 const labels=[...'ABCDEFGHIJKL','Μ','Ν'],paragraphs=['The European Parliament,',...labels.map(v=>v+'. whereas text;'),'1. Operative;','2. Next;'];
 const text={paragraphs,textLanguage:'en',paragraphFormats:paragraphs.map(()=>({})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:true}))};
 return {text,wording:{language:'en',baseline:'motion-resolution',targetLabel:'Recital M a (new)',originalText:'',proposedText:'Ma. whereas new text;'},placement:{operation:'insert',insertAfter:13,insertBefore:14}};
}
test('mixed source characters are certified by the full raw recital sequence',()=>{
 const a=input();assert.equal(assertMixedRecital(a).status,'verified');
 for(const change of [x=>x.text.paragraphs[12]='K. whereas duplicate;',x=>x.text.paragraphs[14]='P. whereas wrong;',x=>x.text.paragraphSources[13].complete=false,x=>x.placement.insertBefore=15,x=>x.wording.proposedText='Na. whereas wrong;']){const b=input();change(b);assert.notEqual(assertMixedRecital(b).status,'verified');}
 for(const label of ['M','Μ']) {
  const b=input();b.text.paragraphs.splice(1,0,label+'. whereas incomplete competitor;');b.text.paragraphFormats.splice(1,0,{});
  b.text.paragraphSources=b.text.paragraphs.map((_,ordinal)=>({path:'p'+ordinal,container:'body',containerPath:'body',ordinal,segment:0,complete:ordinal!==1}));
  b.placement.insertAfter++;b.placement.insertBefore++;
  assert.notEqual(assertMixedRecital(b).status,'verified',label);
 }
});

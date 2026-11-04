import test from 'node:test';
import assert from 'node:assert/strict';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
const make=()=>({sourceKind:'docx',paragraphs:['Article 16','First unnumbered paragraph.','Second unnumbered paragraph.','Article 17'].map((text,index)=>({index,text,complete:true,properties:{styleId:text.startsWith('Article')?'Titrearticle':'Normal'},source:{container:'body',containerPath:'body',complete:true,ordinal:index,segment:0}}))});
test('raw source independently addresses ordinal unnumbered article paragraphs',()=>{
 const proposal=make(),wording={language:'en',targetLabel:'Article 16 – paragraph 2',originalText:'Second unnumbered paragraph.'};
 const placement={operation:'replace',status:'placed',span:{start:2,end:2},splice:{start:{paragraph:2,offset:0},end:{paragraph:2,offset:28}}};
 assert.equal(rawProposalAssertion({proposal,wording,placement}).status,'verified');
 placement.span={start:1,end:1};placement.splice={start:{paragraph:1,offset:0},end:{paragraph:1,offset:27}};
 assert.equal(rawProposalAssertion({proposal,wording,placement}).status,'failed');
});

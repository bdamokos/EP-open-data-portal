import test from 'node:test';import assert from 'node:assert/strict';
import {assertBareAnnexInsertion} from './amendment-annex-oracle.mjs';
const wording={language:'en',targetLabel:'Annex I a (new)'};
const item=()=>({kind:'annex',proposal:{sourceKind:'docx',paragraphs:['ANNEX','Actions eligible for funding.'].map((text,index)=>({index,text,complete:true,properties:{styleId:index?'Normal':'Annexetitre'},source:{complete:true,container:'body',containerPath:'body',segment:0,ordinal:index}})),gaps:[]}});
const placement={operation:'insert',itemIndex:0,insertAfter:1,insertBefore:2};
test('bare annex end assertion reads only raw rows and verifies exact item coordinates',()=>{
 assert.equal(assertBareAnnexInsertion([item()],wording,placement).status,'verified');
 assert.equal(assertBareAnnexInsertion([item()],wording,{...placement,insertAfter:0,insertBefore:1}).status,'failed');
 assert.equal(assertBareAnnexInsertion([item(),item()],wording,placement),null);
 const broken=item();broken.proposal.paragraphs[1].source.complete=false;
 assert.equal(assertBareAnnexInsertion([broken],wording,placement).status,'unverified');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {unnumberedTableInsertion} from './proposal-unnumbered-table.mjs';
const wording={language:'en',baseline:'commission-proposal',originalText:'',targetLabel:'Annex – table – Cereals (new)',proposedText:'Cereals\nCode\tDescription'};
const proposal=()=>({sourceKind:'docx',language:'en',gaps:[],units:[{id:'annex',kind:'annex',scope:'proposal',label:{value:''},complete:true,extent:{start:0,end:2},children:[]}],paragraphs:[0,1].map(index=>({index,complete:true,source:{complete:true}}))});
test('new unnumbered tables use the complete sole annex end',()=>{
 const p=proposal(),items=[{kind:'annex',proposal:p}],result=unnumberedTableInsertion(items,wording);assert.equal(result.insertBefore,2);
 for(const targetLabel of ['Annex – table 2 – Cereals (new)','Annex – table – Cereals (new) after table 2'])assert.equal(unnumberedTableInsertion(items,{...wording,targetLabel}),null);
 assert.equal(unnumberedTableInsertion([...items,...items],wording),null);
 p.paragraphs[1].complete=false;assert.equal(unnumberedTableInsertion(items,wording),null);
});

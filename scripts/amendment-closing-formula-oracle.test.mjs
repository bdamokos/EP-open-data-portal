import test from 'node:test';
import assert from 'node:assert/strict';
import {assertClosingFormula} from './amendment-closing-formula-oracle.mjs';
const formula='This Regulation shall be binding in its entirety and directly applicable in all Member States.';
function check(texts,before=2){return assertClosingFormula({proposal:{paragraphs:texts.map((text,index)=>({text,index,complete:true,source:{complete:true,container:'body'},properties:{styleId:index===0?'Titrearticle':'Normal'}}))},wording:{language:'en',targetLabel:'Article 6 – paragraph 3 (new)'},placement:{operation:'insert',insertBefore:before,insertAfter:before-1}});}
test('independent formula oracle verifies only the final article boundary',()=>{
 assert.equal(check(['Article 6','This Regulation shall enter into force tomorrow.',formula]).status,'verified');
 assert.equal(check(['Article 6','This Regulation shall enter into force tomorrow.',formula],3).status,'failed');
 assert.equal(check(['Article 6','Unrecognized text.',formula]).status,'unverified');
 assert.equal(check(['Article 6','This Regulation shall enter into force tomorrow.','Different formula.']).status,'unverified');
});

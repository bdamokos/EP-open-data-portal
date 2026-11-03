import test from 'node:test';import assert from 'node:assert/strict';
import {assertWordingNumbering} from './amendment-numbering-oracle.mjs';
const text='Article 17(2) of Directive 2012/19/EU;';
const make=(extra=[])=>({paragraphs:['Article 1','Suspension','The following provisions are suspended:','(b)\t'+text,...extra,'Article 2'].map((text,index)=>({text,index,complete:true,source:{complete:true,container:'body'},properties:{styleId:/^Article \d$/u.test(text)?'Titrearticle':'Normal'}}))});
const check=(proposal,index=3)=>assertWordingNumbering({proposal,wording:{language:'en',targetLabel:'Article 1 – paragraph 1 – point c',originalText:'(c)\t'+text},placement:{operation:'delete',span:{start:index,end:index},splice:{start:{paragraph:index,offset:0},end:{paragraph:index,offset:proposal.paragraphs[index].text.length}}}});
test('independent numbering assertion requires unique wording and exact full row',()=>{
 assert.equal(check(make()).status,'verified');assert.equal(check(make([text])).status,'unverified');assert.equal(check(make(),2).status,'failed');
 const partial=make();partial.paragraphs[3].complete=false;assert.equal(check(partial).status,'unverified');
});

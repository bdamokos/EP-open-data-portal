import test from 'node:test';import assert from 'node:assert/strict';
import {councilDraftInstructionOwns} from './council-draft-instruction.mjs';
const target=value=>({segments:[{kind:'article',value},{kind:'paragraph',value:'1',number:1}]});
test('positive plural replacement binds every printed target without repairing numbers',()=>{
 for(const [language,raw] of [['en','4) Articles 11, 12 and 13 are replaced by the following:'],['cs','4) Články 11, 12 a 13 se nahrazují tímto:'],['es','4) Los artículos 11, 12 y 13 se sustituyen por el texto siguiente:'],['da','4) Artikel 11, 12 og 13 affattes således:']]){
  for(const value of ['11','12','13'])assert.equal(councilDraftInstructionOwns(raw,target(value),'',language),true);
  assert.equal(councilDraftInstructionOwns(raw,target('91'),'',language),false);
 }
});
test('a chapter insertion requires the same native opening chapter label',()=>{
 const raw='6) Vkládá se nová kapitola 2a, která zní:';
 assert.equal(councilDraftInstructionOwns(raw,target('13b'),'„KAPITOLA 2a Nový nadpis','cs'),true);
 for(const quote of ['„KAPITOLA 3 Nový nadpis','„Článek 13b Jiný obsah',''])assert.equal(councilDraftInstructionOwns(raw,target('13b'),quote,'cs'),false);
});
test('article and paragraph insertions cannot own another article or paragraph',()=>{
 const t=target('19');t.segments[1]={kind:'paragraph',number:3,value:'3a'};
 assert.equal(councilDraftInstructionOwns('10) V článku 19 se doplňuje nový odstavec 3, který zní:',t,'','cs'),true);
 t.segments[1].number=4;assert.equal(councilDraftInstructionOwns('10) V článku 19 se doplňuje nový odstavec 3, který zní:',t,'','cs'),false);
 assert.equal(councilDraftInstructionOwns('5) V kapitole 2 se vkládá nový článek 13a, který zní:',target('13b'),'','cs'),false);
});

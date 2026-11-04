import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptedTextFinalAct} from './provisional-final-act.mjs';

const statement=act=>`(As an agreement was reached between Parliament and Council, Parliament's position corresponds to the final legislative act, ${act}.)`;

test('a complete statement of the final act gives the exact EUR-Lex ELI',()=>{
  const {statesFinalAct,act}=adoptedTextFinalAct(['Position of the European Parliament adopted at first reading','Regulation (EU) 2026/… of the European Parliament and of the Council on dogs',statement('Regulation (EU) 2026/1818')]);
  assert.equal(statesFinalAct,true);
  assert.deepEqual(act,{label:'Regulation (EU) 2026/1818',type:'reg',year:2026,number:1818,url:'https://eur-lex.europa.eu/eli/reg/2026/1818/oj'});
  assert.equal(adoptedTextFinalAct([statement('Regulation (EU) 2026/1738').replace(/\.\)$/u,')')]).act.url,'https://eur-lex.europa.eu/eli/reg/2026/1738/oj');
  assert.equal(adoptedTextFinalAct([statement('Directive (EU) 2026/12')]).act.url,'https://eur-lex.europa.eu/eli/dir/2026/12/oj');
  assert.equal(adoptedTextFinalAct([statement('Decision (EU) 2026/301')]).act.url,'https://eur-lex.europa.eu/eli/dec/2026/301/oj');
});

test('a statement without an exact type, year and number links nothing',()=>{
  for(const act of ['Regulation (EU) 2026/…','Regulation (EU) 2026/','Regulation (EU) 2026/0123','Regulation (EC) No 1234/2008','Euratom Regulation (EU) 2026/12','the Regulation','Regulation (EU) 2026/123456','Regulation (EU) 2026/12/3']) {
    assert.deepEqual(adoptedTextFinalAct([statement(act)]),{statesFinalAct:true,act:null},act);
  }
  assert.deepEqual(adoptedTextFinalAct([statement('Regulation (EU) 2026/1818'),statement('Regulation (EU) 2026/1819')]),{statesFinalAct:true,act:null});
});

test('acts named elsewhere in the text, in titles or by similarity are never the final act',()=>{
  const text=['European Parliament legislative resolution on the proposal for a regulation repealing Regulation (EU) 2019/452','Regulation (EU) 2026/… of the European Parliament and of the Council on the screening of foreign investments','Article 1','This Regulation amends Regulation (EU) 2021/691.'];
  assert.deepEqual(adoptedTextFinalAct(text),{statesFinalAct:false,act:null});
  assert.deepEqual(adoptedTextFinalAct([]),{statesFinalAct:false,act:null});
  assert.deepEqual(adoptedTextFinalAct(null),{statesFinalAct:false,act:null});
});

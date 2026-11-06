import test from 'node:test';
import assert from 'node:assert/strict';
import {searchReference} from './search-reference.mjs';

test('report, motion and adopted-text references share one normal form',()=>{
  for(const form of ['A10-0257/2026','A-10-2026-0257',' a10-0257/2026 '])assert.deepEqual(searchReference(form),{kind:'document',id:'A-10-2026-0257',keys:['/plenary-documents/A-10-2026-0257']},form);
  assert.equal(searchReference('B10-0468/2026').id,'B-10-2026-0468');
  assert.equal(searchReference('RC10-0482/2026').id,'RC-10-2026-0482');
  assert.deepEqual(searchReference('T10-0257/2026').keys,['/adopted-texts/TA-10-2026-0257']);
  assert.deepEqual(searchReference('TA-10-2026-0257').keys,['/adopted-texts/TA-10-2026-0257']);
  assert.equal(searchReference('C10-0123/2026').id,'C-10-2026-0123');
});
test('dossier, Commission, committee and person references',()=>{
  assert.deepEqual(searchReference('2025/0222(COD)'),{kind:'dossier',process:'2025-0222',type:'COD'});
  assert.deepEqual(searchReference('2025-0222'),{kind:'dossier',process:'2025-0222',type:null});
  assert.deepEqual(searchReference('COM(2025) 549'),{kind:'commission',key:'com:2025/549',label:'COM(2025) 549'});
  assert.equal(searchReference('COM(2025)0549 final').key,'com:2025/549');
  assert.deepEqual(searchReference('CULT-AM-789899').keys,['/documents/CULT-AM-789899','/committee-documents/CULT-AM-789899','committee:association:CULT-AM-789899']);
  assert.deepEqual(searchReference('MEP 113523'),{kind:'member',id:'113523',explicit:true});
  assert.deepEqual(searchReference('113523'),{kind:'member',id:'113523',explicit:false});
});
test('ordinary words and partial references are not references',()=>{
  for(const text of ['Erasmus','Farreng','A10-0257','2025','12345','1234567','climate 2025/0222','"A10-0257/2026"'])assert.equal(searchReference(text),null,text);
});

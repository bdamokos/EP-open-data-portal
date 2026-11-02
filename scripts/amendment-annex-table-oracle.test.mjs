import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

// Rows: [text, path] with Word paths; table cells carry tbl/tr/tc/p indexes.
const body=(n)=>`/w:document[1]/w:body[1]/w:p[${n}]`,cellPath=(t,r,c,p=1)=>`/w:document[1]/w:body[1]/w:tbl[${t}]/w:tr[${r}]/w:tc[${c}]/w:p[${p}]`;
const proposal=rows=>({sourceKind:'docx',units:[],paragraphs:rows.map(([text,path],index)=>({index,text,complete:true,source:{path,container:path.includes('/w:tc[')?'table-cell':'body',complete:true}}))});
const annex=()=>proposal([['ANNEX III',body(1)],['The following Annex VIII is added:',body(2)],['Iron and steel',body(3)],['CN code',cellPath(1,1,1)],['Greenhouse gas',cellPath(1,1,2)],['ex 7204 Ferrous waste',cellPath(1,2,1)],['Carbon dioxide',cellPath(1,2,2)],['Aluminium',body(4)],['CN code',cellPath(2,1,1)],['Greenhouse gas',cellPath(2,1,2)],['ex 7602 Aluminium waste',cellPath(2,2,1)],['Carbon dioxide',cellPath(2,2,2)],['’',body(5)]]);
const replace=(start,end)=>({status:'placed',operation:'replace',itemIndex:0,span:{start,end}});
const wording=(targetLabel,originalText)=>({targetLabel,originalText,proposedText:'Changed',language:'en',baseline:'commission-proposal'});
const check=(w,placement,p=annex())=>verifyPlacement({placement,wording:w,items:[{proposal:p}]});

test('annex table rows verify cell for cell inside the named annex', () => {
  const original='Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide';
  assert.deepEqual(check(wording('Annex III – paragraph 1 – table',original),replace(7,11)),{status:'verified',reason:'oracle-annex-table-rows'});
  assert.equal(check(wording('Annex III – paragraph 1 – table',original),replace(2,6)).status,'failed');
  assert.equal(check(wording('Annex II – paragraph 1 – table',original),replace(7,11)).status,'unverified','another annex');
  assert.equal(check(wording('Annex III – paragraph 1 – table','Aluminium\nCN code\tGreenhouse gas\n7602 Aluminium waste\tCarbon dioxide'),replace(7,11)).status,'unverified','a cell that differs never matches');
  assert.equal(check(wording('Annex III – paragraph 1 – table','CN code\tGreenhouse gas'),replace(8,9)).status,'unverified','repeated rows are not unique');
});

test('a subordinate address other than the owning provision stays unverified', () => {
  const original='Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide';
  assert.equal(check(wording('Annex III – paragraph 2 – table',original),replace(7,11)).status,'unverified');
  assert.equal(check(wording('Annex III – point 1 – table',original),replace(7,11)).status,'unverified');
  assert.equal(check(wording('Annex III – paragraph 1 – point 1 – table',original),replace(7,11)).status,'unverified');
});

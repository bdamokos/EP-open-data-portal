import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {motionBodySelection} from './resolution-body.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/irish-resolution-openings.json',import.meta.url),'utf8'));
for(const doc of fixture.documents.filter(d=>d.id!=='A-10-2026-0050'))test(`${doc.id} selects the published Irish Tá opening after the cover`,()=>{
  const rows=doc.rows.flatMap(row=>[row.opening,...row.following]);
  assert.equal(motionBodySelection(rows,'ga').start,3);
  assert.equal(motionBodySelection([doc.rows[0].opening,...doc.rows[0].following],'ga').start,-1);
});
test('the three actual Irish discharge openings stay ambiguous without section identity',()=>{
  const doc=fixture.documents.find(d=>d.id==='A-10-2026-0050');
  assert.equal(doc.rows.filter(row=>row.opening==='Tá Parlaimint na hEorpa,').length,3);
  assert.equal(motionBodySelection(doc.rows.flatMap(row=>[row.opening,...row.following]),'ga').start,-1);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationBody} from './publication-body.mjs';
test('a matching English question starts at its body and retains the source header separately',()=>{
  const input=['Question for written answer E-002520/2026/rev.1','to the Commission','Rule 144','Actual author list','Subject: Actual subject','First body paragraph','Second body paragraph'];
  const result=publicationBody(input,'E-10-2026-002520','en');assert.deepEqual(result.paragraphs,input.slice(5));assert.deepEqual(result.header,input.slice(0,5));assert.equal(input.length,7);
});
test('a priority written question keeps its metadata in the header and its original body offsets',()=>{
  const input=['Priority question for written answer P-004146/2026','to the Commission','Rule 144','Helmut Brandstätter (Renew), Anna Stürgkh (Renew)','Subject:\tHungarian retail tax and freedom of establishment in the single market','In infringement proceedings INFR(2024)4022, the Commission called on Hungary to bring its retail tax into line with the freedom of establishment.','1.\tWhat is the Commission’s assessment?','Submitted: 13.10.2026'];
  const saved=[...input],result=publicationBody(input,'P-10-2026-004146','en');
  assert.deepEqual(result,{paragraphs:input.slice(5),header:input.slice(0,5),start:5,exact:true});
  assert.deepEqual(input,saved);
  // Readers use start + body index to place source note anchors and links.
  assert.equal(result.start+result.paragraphs.indexOf(input[6]),6);
  for(const [id,language] of [['P-10-2026-004145','en'],['P-10-2026-004146','de'],['P-10-2026-004146',null]]) {
    assert.deepEqual(publicationBody(input,id,language),{paragraphs:input,header:[],start:0,exact:true});
  }
  for(const source of [input.filter(p=>!p.startsWith('Subject:')),input.slice(0,5),['A priority question for written answer P-004146/2026 is discussed here.',...input.slice(1)]]) {
    assert.deepEqual(publicationBody(source,'P-10-2026-004146','en').paragraphs,source);
  }
});
test('committee documents show the body before cover and contents, without publishing-template tags',()=>{
  const source=['European Parliament','2024-2029','<Commission>Committee on Foreign Affairs</Commission>','CONTENTS','Page','DRAFT EUROPEAN PARLIAMENT RECOMMENDATION\t3','DRAFT EUROPEAN PARLIAMENT RECOMMENDATION','The European Parliament,','Rapporteur: <Depute>Hilde Vautmans</Depute>'];
  const result=publicationBody(source,'AFET-PR-775469','en');assert.equal(result.paragraphs[0],'DRAFT EUROPEAN PARLIAMENT RECOMMENDATION');assert.equal(result.paragraphs.at(-1),'Rapporteur: Hilde Vautmans');assert.deepEqual(result.header,source.slice(0,6));assert(source.at(-1).includes('<Depute>'));
  assert.deepEqual(publicationBody(source,'UNKNOWN','en').paragraphs,source);
});
test('only the matching English answer header moves; mismatched IDs, other languages and ordinary body references stay intact',()=>{
  const input=['EN E-002520/2026 Answer given by a Commissioner (5.10.2026)','Actual answer text'];
  assert.deepEqual(publicationBody(input,'E-10-2026-002520-ASW','en').paragraphs,input.slice(1));
  const separate=['EN','E-002520/2026','Answer given by Ms Albuquerque','on behalf of the European Commission','(5.10.2026)','Actual answer text'];
  assert.deepEqual(publicationBody(separate,'E-10-2026-002520-ASW','en').paragraphs,['Actual answer text']);
  for(const [id,language] of [['E-10-2026-003031-ASW','en'],['E-10-2026-002520-ASW','ga']])assert.deepEqual(publicationBody(input,id,language).paragraphs,input);
  const prose=['This paragraph discusses E-002520/2026','Actual answer text'];assert.deepEqual(publicationBody(prose,'E-10-2026-002520-ASW','en').paragraphs,prose);
});

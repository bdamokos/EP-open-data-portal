import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationBody} from './publication-body.mjs';
test('a matching English question starts at its body and retains the source header separately',()=>{
  const input=['Question for written answer E-002520/2026/rev.1','to the Commission','Rule 144','Actual author list','Subject: Actual subject','First body paragraph','Second body paragraph'];
  const result=publicationBody(input,'E-10-2026-002520','en');assert.deepEqual(result.paragraphs,input.slice(5));assert.deepEqual(result.header,input.slice(0,5));assert.equal(input.length,7);
});
test('an oral question keeps its header separately and preserves exact body positions',()=>{
  const input=['Question for oral answer O-000042/2026','to the Commission','Rule 142','Author one (S&D), Author two (Renew)','Subject:\tThe need for urgent EU action to tackle financial scam advertisements on online platforms','Online financial scams are spreading across the EU at scale.','1.\tHow does the Commission assess the evidence?','Submitted: 9.10.2026','Lapses: 10.1.2027'];
  const saved=[...input],result=publicationBody(input,'O-10-2026-000042','en');
  assert.deepEqual(result,{paragraphs:input.slice(5),header:input.slice(0,5),start:5,exact:true});
  assert.deepEqual(input,saved);
  assert.equal(result.start+result.paragraphs.indexOf(input[6]),6);
  for(const [id,language] of [['O-10-2026-000043','en'],['O-10-2026-000042','fr'],['O-10-2026-000042',null]]) {
    assert.deepEqual(publicationBody(input,id,language),{paragraphs:input,header:[],start:0,exact:true});
  }
  for(const source of [input.filter(p=>!p.startsWith('Subject:')),input.slice(0,5),['This discusses question O-000042/2026.',...input.slice(1)]]) {
    assert.deepEqual(publicationBody(source,'O-10-2026-000042','en'),{paragraphs:source,header:[],start:0,exact:true});
  }
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

const taId='TA-10-2026-0007';
const taParagraphs=['European Parliament','2024-2029','\uFFFC','TEXTS ADOPTED','P10_TA(2026)0007','Murder of Mehdi Kessaci – urgent need for ambitious European action against drug trafficking','European Parliament resolution of 20 January 2026 on the murder of Mehdi Kessaci: urgent need for ambitious European action against drug trafficking (2025/3020(RSP))','The European Parliament,','–\thaving regard to the Treaty on European Union (TEU),','1.\tCalls for action;'];
test('adopted texts retain the formal resolution heading and exact body offsets after the matched masthead',()=>{
  const source=[...taParagraphs],body=publicationBody(source,taId,'en');
  assert.deepEqual(body,{paragraphs:source.slice(6),header:source.slice(0,6),start:6,exact:true,coverLogoParagraph:2});
  assert.deepEqual(source,taParagraphs);
  for(const [id,title,lead,extra] of [
    ['TA-10-2026-0008','EU-Mercosur Partnership Agreement','European Parliament resolution of 21 January 2026 seeking an opinion from the Court of Justice on the compatibility with the Treaties (2026/2560(RSP))',[]],
    ['TA-10-2026-0250','Implementation and delivery of the Sustainable Development Goals','European Parliament resolution of 7 July 2026 on the implementation and delivery of the Sustainable Development Goals (2025/2248(INI))',[]],
    ['TA-10-2025-0001','EU/Republic of Serbia agreement','European Parliament legislative resolution of 21 January 2025 on the draft Council decision (2024/0074(NLE))',['(Consent)']],
  ]) {
    const reference=id.match(/^TA-10-(\d{4})-(\d{4})$/),input=[...source.slice(0,4),`P10_TA(${reference[1]})${reference[2]}`,title,lead,...extra,...source.slice(7)];
    const result=publicationBody(input,id,'en');assert.equal(result.start,6);assert.deepEqual(result.paragraphs,input.slice(6));
  }
  const noLogo=source.filter((_,i)=>i!==2);assert.equal(publicationBody(noLogo,taId,'en').start,5);
});
test('unknown or mismatched adopted covers and A/B/RC readers retain all original paragraphs',()=>{
  for(const [id,lang] of [[taId,'fr'],[taId,null],['TA-10-2026-0008','en'],['B-10-2026-0057','en'],['RC-10-2026-0007','en'],['A-10-2026-0237','en']])assert.equal(publicationBody(taParagraphs,id,lang).start,0);
  for(const mutate of [
    p=>p[0]='Another institution',p=>p[1]='2019-2024',p=>p[2]='Unknown figure \uFFFC',p=>p[3]='Other publication',
    p=>p[4]='P10_TA(2026)0008',p=>p[5]+='\uFFFC',p=>p[6]='Unrecognised opening',p=>p[8]='Unstructured text',
    p=>p.push('The European Parliament,','– another resolution'),
  ]){const p=[...taParagraphs];mutate(p);assert.equal(publicationBody(p,taId,'en').start,0);}
});

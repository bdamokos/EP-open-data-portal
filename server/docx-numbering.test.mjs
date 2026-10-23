import {test} from 'node:test';
import assert from 'node:assert/strict';
import {XMLParser} from 'fast-xml-parser';
import {numberingLabels} from './docx-numbering.mjs';

const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const level=(index,extra='',format='decimal',pattern='%'+(index+1))=>`<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${pattern}"/>${extra}</w:lvl>`;
const instance=(id,extra='',abstract='1')=>`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${extra}</w:num>`;
const override=(index,extra)=>`<w:lvlOverride w:ilvl="${index}">${extra}</w:lvlOverride>`;
function resolver(levels,instances,styles='',extraAbstract='') {
  const warnings=new Set();
  const label=numberingLabels(`<w:numbering><w:abstractNum w:abstractNumId="1">${levels}</w:abstractNum>${extraAbstract}${instances}</w:numbering>`,styles,warnings);
  return {warnings,raw:properties=>label(parser.parse(`<w:pPr>${properties}</w:pPr>`)[0]['w:pPr']),label:(id,index=0)=>label(parser.parse(`<w:pPr><w:numPr><w:numId w:val="${id}"/><w:ilvl w:val="${index}"/></w:numPr></w:pPr>`)[0]['w:pPr'])};
}

test('unoverridden numIds and style defaults continue their abstract list; distinct abstracts and documents remain independent',()=>{
  const styles='<w:styles><w:style w:type="paragraph" w:default="1" w:styleId="Default"><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Default"/></w:style></w:styles>';
  const make=()=>resolver(level(0),instance(1)+instance(2)+instance(3,'','2'),styles,`<w:abstractNum w:abstractNumId="2">${level(0)}</w:abstractNum>`);
  const r=make();
  assert.deepEqual([r.label(1),r.raw('<w:pStyle w:val="Child"/>'),r.label(3),r.raw(''),r.label(1)],['1','2','1','3','4']);
  assert.equal(make().label(1),'1');assert.deepEqual([...r.warnings],[]);
});

test('startOverride and overridden level start reset on first use only, and switching back continues the new value',()=>{
  const r=resolver(level(0),instance(1)+instance(2,override(0,'<w:startOverride w:val="7"/>'))+instance(3,override(0,level(0).replace('w:val="1"','w:val="4"')))+instance(4,override(0,'<w:startOverride w:val="0"/>'+level(0).replace('w:val="1"','w:val="9"'))));
  assert.deepEqual([1,1,2,2,1,3,1,3,4,1].map(id=>r.label(id)),['1','2','7','8','9','4','5','6','0','1']);
  assert.deepEqual([...r.warnings],[]);
});

test('nonzero lvlRestart uses a one-based threshold and includes higher levels',()=>{
  const r=resolver(level(0)+level(1)+level(2,'<w:lvlRestart w:val="1"/>'),instance(1));
  assert.deepEqual([0,1,2,1,2,0,2].map(index=>r.label(1,index)),['1','1','1','2','2','2','1']);
  const s=resolver(level(0)+level(1)+level(2)+level(3,'<w:lvlRestart w:val="2"/>'),instance(1));
  assert.deepEqual([0,1,3,2,3,1,3,0,3].map(index=>s.label(1,index)),['1','1','1','1','2','2','1','2','1']);
});

test('zero never restarts, omitted and invalid triggers use the previous level, and Word ignores override lvlRestart',()=>{
  for(const restart of ['', '<w:lvlRestart w:val="9"/>']) {
    const r=resolver(level(0)+level(1)+level(2,restart),instance(1));
    assert.deepEqual([2,2,0,2,1,2].map(index=>r.label(1,index)),['1','2','1','1','1','1']);
  }
  const never=resolver(level(0)+level(1,'<w:lvlRestart w:val="0"/>'),instance(1)+instance(2,override(1,level(1,'<w:lvlRestart w:val="1"/>').replace('w:start w:val="1"','w:start w:val="5"'))));
  assert.deepEqual([never.label(1,1),never.label(2,1),never.label(1),never.label(2,1)],['1','5','1','6']);
  const restart=resolver(level(0)+level(1),instance(1,override(1,level(1,'<w:lvlRestart w:val="0"/>'))));
  assert.deepEqual([1,0,1].map(index=>restart.label(1,index)),['1','1','1']);
});

test('a nested level retains its startOverride after its configured restart',()=>{
  const r=resolver(level(0)+level(1),instance(1,override(1,'<w:startOverride w:val="4"/>'))+instance(2));
  assert.deepEqual([r.label(1,1),r.label(2),r.label(1,1),r.label(1,1)],['4','1','4','5']);
});

test('literal paragraphs and unused numbering definitions consume no counters; numId zero disables inherited numbering',()=>{
  const unused=resolver(level(0),instance(1));
  assert.deepEqual([unused.raw(''),unused.raw('<w:pStyle w:val="Unused"/>'),unused.label(0)],['','','']);
  assert.equal(unused.label(1),'1');assert.deepEqual([...unused.warnings],[]);
  const inherited=resolver(level(0),instance(1),'<w:styles><w:style w:default="1" w:type="paragraph" w:styleId="Default"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>');
  assert.deepEqual([inherited.raw(''),inherited.label(0),inherited.raw('')],['1','','2']);
});

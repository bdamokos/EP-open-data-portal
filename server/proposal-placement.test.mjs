import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement,proposalMatchingOffsets} from './proposal-placement.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const source=(paragraphs,styles=[])=>({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:styles[i]??'Normal',numberingComplete:true,notesComplete:true}))});
const item=projection=>({kind:'act',index:1,proposal:parseProposal(projection)});
const resolve=(projection,targetLabel,originalText='',proposedText='New provision.')=>resolveProposalPlacement([item(projection)],{targetLabel,originalText,proposedText,language:'en'});
const cbamItems=['act','annex'].map(kind=>({kind,index:1,proposal:parseProposal(fixture(`52025PC0087-${kind}-excerpt.json`),{item:kind})}));

test('CBAM recorded amendments 4–8 place only the changed source extent',()=>{
  const amendments=fixture('proposal-placement-cbam.json').amendments;
  assert.deepEqual(amendments.map(amendment=>amendment.number),[4,5,6,7,8]);
  for(const amendment of amendments){
    const placed=resolveProposalPlacement(cbamItems,amendment);assert.equal(placed.status,'placed','AM'+amendment.number+': '+placed.reason);
    assert.equal(placed.itemIndex,amendment.number===8?1:0);assert.equal(placed.operation,amendment.number===7?'delete':'replace');
    assert(placed.originalText.includes(amendment.number===7?'the following paragraph 1a is inserted':'By 31 August')||amendment.number===6||amendment.number===8);
    if(amendment.number===7){
      const proposal=cbamItems[0].proposal,b=proposalCandidates(proposal,'Article 1 – paragraph 1 – point 21 – point b')[0];
      assert.equal(placed.span.end+1,b.extent.start);assert(placed.originalText.endsWith('declarant.’;'));assert(!placed.originalText.includes('paragraph 2'));
      assert.equal(placed.splice.start.offset,0);assert.equal(placed.span.end-placed.span.start,5);
    }
    if(amendment.number===4||amendment.number===6){assert.equal(placed.splice.start.offset,0,'the original quotation/number prefix stays in the diff');assert(placed.originalText.startsWith('‘'));}
  }
});

test('insertions follow full subtrees for Article 1a, recital 3a and nested point 4a',()=>{
  let projection=source(['Article 1','1. First paragraph.','(a) Last child.','Article 2','1. Next article.']);
  let placed=resolve(projection,'Article 1 a (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,2);assert.equal(placed.insertBefore,3);
  projection=source(['2025/0001 (COD)','(3) Existing recital.','(4) Next recital.','HAVE ADOPTED THIS REGULATION:','Article 1']);
  placed=resolve(projection,'Recital 3 a (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,1);
  projection=source(['Article 1','The act is amended as follows:','(4) Instruction:','(a) Nested child.','(5) Next instruction.'],['Titrearticle','','Point0','Point1','Point0']);
  placed=resolve(projection,'Article 1 – paragraph 1 – point 4 a (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,3);assert.equal(placed.insertBefore,4);
});

test('highest existing suffixed sibling wins, duplicates and absent parents withhold',()=>{
  const projection=source(['Article 1','1. One.','Article 1a','1. Intermediate.','Article 2','1. Two.']);
  assert.equal(resolve(projection,'Article 1 b (new)').insertBefore,4);
  assert.equal(resolve(projection,'Article 1 a (new)').reason,'duplicate_target_label');
  assert.equal(resolve(projection,'Article 99 – paragraph 1 a (new)').reason,'parent_target_not_found');
  assert.equal(resolve(projection,'Article 7 a (new)').reason,'relative_target_not_found');
});

test('partial sentence splices preserve exact source offsets and adjacent text',()=>{
  const paragraph='1. Keep this. A changed sentence. Keep that.';
  const placed=resolve(source(['Article 1',paragraph]),'Article 1 – paragraph 1','A changed sentence.','A better sentence.');
  assert.equal(placed.status,'placed');assert.equal(placed.originalText,'A changed sentence.');
  const start=placed.splice.start.offset,end=placed.splice.end.offset;
  assert.equal(paragraph.slice(0,start),'1. Keep this. ');assert.equal(paragraph.slice(end),' Keep that.');
  assert.equal(resolve(source(['Article 1','1. Repeat this. Repeat this.']),'Article 1 – paragraph 1','Repeat this.').reason,'conflicting_target_evidence');
  assert.equal(resolve(source(['Article 1','1. A longer word.']),'Article 1 – paragraph 1','word').status,'placed');
  assert.equal(resolve(source(['Article 1','1. A longer word.']),'Article 1 – paragraph 1','ord').status,'unresolved');
});

test('literal duplicate candidates require one whole normalized wording match under the same parent',()=>{
  const projection=source(['Article 1','The act is amended:','(1) First exact instruction.','(1) Second exact instruction.'],['Titrearticle','','Point0','Point0']);
  const placed=resolve(projection,'Article 1 – paragraph 1 – point 1','Second exact instruction.');
  assert.equal(placed.status,'placed');assert.equal(placed.span.start,3);assert(placed.evidence.some(e=>e.basis==='unique-duplicate-wording-match'));
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – point 1','exact instruction').status,'unresolved');
});

test('quoted provisions never become outer candidates; original and column equations withhold',()=>{
  const projection=source(['Article 1','The act is amended:','(1) Article 9 is replaced by the following:','‘Article 9','1. Quoted text.’;','Article 2'],['Titrearticle','','Point0','Titrearticle','','Titrearticle']);
  assert.equal(resolve(projection,'Article 9','Quoted text.').reason,'target_not_found');
  for(const [original,proposed] of [['A \uFFFC equation.','B equation.'],['A source sentence.','B \uFFFC equation.']])assert.equal(resolve(source(['Article 1','1. A \uFFFC equation.']),'Article 1 – paragraph 1',original,proposed).reason,'math_comparison_unavailable');
  assert.equal(resolve(source(['Article 1','1. A source sentence.','2. Unchanged \uFFFC equation.']),'Article 1 – paragraph 1','A source sentence.').status,'placed');
});

test('matching offsets retain NFC, typographic punctuation and soft hyphen provenance',()=>{
  for(const value of ['‘1.\tA café sentence.’;','1. A ca\u0066e\u0301 sentence.','(a)\tA soft\u00adhyphen phrase;\n(b)\tAnother.','“1. Text\u00a0with spaces.”;'])assert(proposalMatchingOffsets(value));
});


test('wording comparison never strips an unlabelled parenthesized word',()=>{
  const projection=source(['Article 1','1. The source sentence.']);
  assert.equal(resolve(projection,'Article 1 – paragraph 1','(not) The source sentence.').reason,'conflicting_target_evidence');
  assert.equal(proposalMatchingOffsets('(not) The source sentence.').normal,'(not) The source sentence');
  assert.equal(resolve(projection,'Article 1 – paragraph 1','1. The source sentence.').status,'placed');
});


test('a real Article 1a insertion never absorbs an unparsed compact Article2 heading',()=>{
  const recorded=fixture('proposal-placement-gas-storage.json'),proposal=parseProposal(recorded),items=[{kind:'act',index:1,proposal}];
  const placement=resolveProposalPlacement(items,recorded.amendment),article1=proposalCandidates(proposal,'Article 1')[0],article2=proposalCandidates(proposal,'Article 2')[0];
  assert(article1,'Article 1 must be parsed');assert(article2,'Compact Article2 must be parsed');
  assert.equal(placement.status,'placed');assert.equal(placement.operation,'insert');
  assert.equal(placement.insertBefore,article2.extent.start);
  assert.equal(placement.insertAfter,article2.extent.start-1);
  assert.equal(placement.insertAfter,article1.extent.end-1,'the insertion follows the complete Article 1 subtree');
  const descendants=unit=>unit.children.flatMap(child=>[child,...descendants(child)]);
  for(const child of descendants(article1))assert(child.extent.end-1<=placement.insertAfter,'all Article 1 children precede the insertion');
});


test('recorded COD Recital 3a is inserted after recital 3 and before recital 4',()=>{
  const recorded=fixture('proposal-placement-gas-storage.json'),proposal=parseProposal(recorded),items=[{kind:'act',index:1,proposal}];
  const placed=resolveProposalPlacement(items,recorded.recitalAmendment),three=proposalCandidates(proposal,'Recital 3')[0],four=proposalCandidates(proposal,'Recital 4')[0];
  assert.equal(placed.status,'placed');assert.equal(placed.operation,'insert');assert.equal(placed.insertAfter,three.extent.end-1);assert.equal(placed.insertBefore,four.extent.start);
});


test('first, middle and last sentence edits retain numbering; full extents retain source prefixes',()=>{
  const paragraph='1. First sentence. Middle sentence. Last sentence.';
  for(const original of ['First sentence.','Middle sentence.','Last sentence.','First sentence. Middle sentence. Last sentence.'])for(const proposed of ['Changed sentence.','']){
    const result=resolve(source(['Article 1',paragraph]),'Article 1 – paragraph 1',original,proposed);
    assert.equal(result.status,'placed');
    const whole=original.startsWith('First')&&original.endsWith('Last sentence.');
    assert.equal(result.splice.start.offset,whole?0:paragraph.indexOf(original));
    assert.equal(result.splice.end.offset,paragraph.indexOf(original)+original.length);
    assert.equal(result.originalText,whole?paragraph:original);
  }
  const quoted='‘1. Full paragraph.’;';
  for(const proposed of ['Changed paragraph.',''])assert.equal(resolve(source(['Article 1',quoted]),'Article 1 – paragraph 1','Full paragraph.',proposed).originalText,quoted);
});

test('suffix insertions require physically ordered siblings within the exact parent',()=>{
  for(const [paragraphs,label] of [
    [['Article 1','1. One.','Article 1c','1. C.','Article 1a','1. A.','Article 2'],'Article 1 b (new)'],
    [['Article 1b','1. B.','Article 1','1. One.','Article 2'],'Article 1 c (new)'],
  ])assert.equal(resolve(source(paragraphs),label).reason,'source_structure_unavailable');
  assert.equal(resolve(source(['Article 1','1. One.','(a) Child.','Article 1a','1. A.','Article 1c','1. C.','Article 2']),'Article 1 b (new)').insertBefore,5);
  const nested=source(['Article 1','The act is amended:','(4) A.','(4c) C.','(4b) B.','Article 2','The act is amended:','(4) Other.'],['Titrearticle','','Point0','Point0','Point0','Titrearticle','','Point0']);
  assert.equal(resolve(nested,'Article 2 – paragraph 1 – point 4 a (new)').status,'placed','other parent order does not affect the selected siblings');
});

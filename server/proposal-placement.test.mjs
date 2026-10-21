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
  for(const amendment of fixture('proposal-placement-cbam.json').amendments){
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

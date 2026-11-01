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

test('new paragraphs follow paragraph 1 before later numbered paragraphs after an unstyled article subtitle',()=>{
  // Published shapes of A-10-2026-0069 AM34/35 and A-10-2026-0188 AM13/14.
  for(const [article,title,count,suffixes] of [[3,'Suspension',2,['a','b']],[15,'Ownership of results',6,['a']],[17,'Committee Procedure',3,['a']]]){
    const projection=source([`Article ${article}`,title,'1. First paragraph.','(a) Its child.','Continuation of paragraph one.',...Array.from({length:count-1},(_,i)=>`${i+2}. Later paragraph.`),`Article ${article+1}`],['Titrearticle','Normal','ManualNumPar1','Point1','Normal',...Array(count-1).fill('ManualNumPar1'),'Titrearticle']);
    projection.paragraphFormats=projection.paragraphs.map((_,i)=>i===1?{align:'center',marks:[{kind:'bold',start:0,end:title.length}]}:{});
    for(const suffix of suffixes){const placed=resolve(projection,`Article ${article} – paragraph 1 ${suffix} (new)`);assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,4);assert.equal(placed.insertBefore,5);}
  }
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

test('published heading locates amendments when the list has no structured location',()=>{
  const projection=source(['Article 1','1. First paragraph text.','2. Second paragraph text.']);
  const placed=resolveProposalPlacement([item(projection)],{targetLabel:'Article 1 – paragraph 2',targetPath:{proposal:[],underlying:[]},originalText:'Second paragraph text.',proposedText:'Changed text.',language:'en'});
  assert.equal(placed.status,'placed');assert.equal(placed.span.start,2);
  const conflicting=resolveProposalPlacement([item(projection)],{targetLabel:'Article 1 – paragraph 2',targetPath:{proposal:[{raw:'Article 1 – paragraph 1'},{raw:'Article 1 – paragraph 2'}],underlying:[]},originalText:'Second paragraph text.',proposedText:'Changed text.',language:'en'});
  assert.equal(conflicting.reason,'target_reference_unavailable');
});

test('numbered subparagraphs place only within their own paragraphs',()=>{
  const projection=source(['Article 1','1. Lead subparagraph text.','Second subparagraph text.','2. Next paragraph.']);
  let placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 1','Lead subparagraph text.');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:1});assert.equal(placed.evidence.at(-1).basis,'subparagraph-wording-match');
  placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 2','Second subparagraph text.');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 1','Second subparagraph text.').reason,'conflicting_target_evidence');
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 3','Second subparagraph text.').reason,'target_not_found');
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 2 a (new)').status,'unresolved');
  const pointed=source(['Article 1','1. Intro:','(a) point;','Closing subparagraph.']);
  assert.equal(resolve(pointed,'Article 1 – paragraph 1 – subparagraph 2','Closing subparagraph.').reason,'source_structure_unavailable');
});

test('an underlying-act target without a proposal address never falls back to the heading',()=>{
  const projection=source(['Article 9','1. Shared wording.']);
  const placed=resolveProposalPlacement([item(projection)],{targetLabel:'Article 9 – paragraph 1',targetPath:{proposal:[],underlying:[{raw:'Article 9 – paragraph 1'}]},originalText:'Shared wording.',proposedText:'Changed.',language:'en'});
  assert.equal(placed.reason,'target_reference_unavailable');
});

test('implicit paragraphs number subparagraphs from their first child',()=>{
  const projection=source(['Article 1','First subparagraph.','Second subparagraph.']);
  let placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 1','First subparagraph.');assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:1});
  placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 2','Second subparagraph.');assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 2','First subparagraph.').reason,'conflicting_target_evidence');
  placed=resolve(projection,'Article 1 – subparagraph 2','Second subparagraph.');assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
  assert.equal(resolve(projection,'Article 1 – subparagraph 1','Second subparagraph.').reason,'conflicting_target_evidence');
  const titled=source(['Article 1','1. First subparagraph.','Second subparagraph.'],['Titrearticle','Titrearticle']);
  // A title-like first row can shift the apparent ordinal. Unique wording
  // in the wrong numbered subparagraph still cannot establish placement.
  assert.equal(resolve(titled,'Article 1 – paragraph 1 – subparagraph 2','Second subparagraph.').reason,'target_not_found');
  const withTitle=source(['Article 1','Programme objectives','First subparagraph.','Second subparagraph.'],['Titrearticle','Titrearticle']);
  assert.equal(resolve(withTitle,'Article 1 – subparagraph 1','Second subparagraph.').reason,'conflicting_target_evidence');
  assert.equal(resolve(withTitle,'Article 1 – subparagraph 2','Second subparagraph.').status,'placed');
  const numbered=source(['Article 1','1. Lead.','2. Next.']);
  assert.equal(resolve(numbered,'Article 1 – subparagraph 1','Lead.').reason,'source_structure_unavailable');
});

// Reduced structures from A-10-2026-0104 (quotation scope), -0267
// (shifted points), -0266 (unnumbered paragraphs) and -0257 AM142.
test('missing parser levels fall back to the deepest unique ancestor and whole source lines',()=>{
  const cases=[
    [source(['Article 1','The act is amended:','Verified source line.']),'Article 1 – paragraph 1 – point a','Verified source line.',2],
    [source(['Article 1','First unnumbered paragraph.','Second unnumbered paragraph.']),'Article 1 – paragraph 2','Second unnumbered paragraph.',2],
    [source(['Article 13','2. Intro:','(d) Verified point.']),'Article 13 – paragraph 2 – subparagraph 1 – point d','Verified point.',2],
    [source(['Article 1','The act is amended:','(1) Article 9 is replaced by the following:','‘Article 9','1. Early quotation.’;','(a) A unique later line.','(2) Other instruction.'],['Titrearticle','','Point0','Titrearticle','','Point1','Point0']),'Article 1 – paragraph 1 – point 1 – subparagraph 1 – point a','A unique later line.',5],
  ];
  for(const [projection,label,original,start] of cases){const placed=resolve(projection,label,original);assert.equal(placed.status,'placed',label);assert.equal(placed.span.start,start);assert.equal(placed.splice.start.offset,0);assert.equal(placed.evidence.at(-1).basis,placed.evidence.some(e=>e.basis==='first-subparagraph-points')?'normalised-original-match':'ancestor-unique-wording');}
  const projection=source(['Article 1','First source line.','Second source line.','Article 2','Second source line.']);
  assert.equal(resolve(projection,'Article 1 – paragraph 2','Second source line.').status,'unresolved','wording elsewhere in the document is not unique');
  assert.equal(resolve(projection,'Article 1 – paragraph 2','First source').status,'unresolved','a partial line cannot repair an address');
  const duplicateParent=source(['Article 1','First source line.','Article 1','Other source line.']);
  assert.equal(resolve(duplicateParent,'Article 1 – paragraph 2','First source line.').status,'unresolved','a duplicated ancestor cannot establish a path');
});

test('duplicate targets and single descendants inheriting conflict require document-wide unique wording',()=>{
  const projection=source(['Article 1','The act is amended:','(1) First instruction.','(a) Keep first. Unique sentence.','(1) Second instruction.','(b) Keep second. Other sentence.'],['Titrearticle','','Point0','Point1','Point0','Point1']);
  let placed=resolve(projection,'Article 1 – paragraph 1 – point 1','Unique sentence.');
  assert.equal(placed.status,'placed');assert.equal(placed.span.start,3);assert.equal(placed.evidence.at(-1).basis,'unique-duplicate-wording-match');
  placed=resolve(projection,'Article 1 – paragraph 1 – point 1 – point a','Unique sentence.');
  assert.equal(placed.status,'placed');assert.equal(placed.span.start,3);
  const repeated=source([...projection.paragraphs,'Article 2','1. Unique sentence.'],[...projection.paragraphProperties.map(p=>p.styleId),'Titrearticle']);
  assert.equal(resolve(repeated,'Article 1 – paragraph 1 – point 1','Unique sentence.').status,'unresolved');
  assert.equal(resolve(repeated,'Article 1 – paragraph 1 – point 1 – point a','Unique sentence.').reason,'multiple_published_targets');
});

test('an address without Annex excludes an annex item even when it lacks an annex container',()=>{
  const act=item(source(['Article 1','1. Existing.','Article 2','1. Next.']));
  const annex={kind:'annex',index:1,proposal:parseProposal(source(['Article 1a','1. Uncontained annex item.']),{item:'annex'})};
  const options={targetLabel:'Article 1 a (new)',originalText:'',proposedText:'Inserted.',language:'en'};
  const placed=resolveProposalPlacement([annex,act],options);
  assert.equal(placed.status,'placed');assert.equal(placed.itemIndex,1);assert.equal(placed.insertBefore,2);
  assert.equal(resolveProposalPlacement([annex],{...options,targetLabel:'Article 1a – paragraph 1',originalText:'Uncontained annex item.'}).status,'unresolved');
});

// A-10-2026-0257 AM97, 107, 112, 137 and A-10-2026-0104's
// instruction leads. Identical wording in other provisions is not a join.
test('introductory part matches only the own lead of a provision',()=>{
  const projection=source(['Article 3','3. The objectives are pursued through:','(a) First objective;','Closing continuation.','Article 6','The Programme shall support:','(a) Cooperation;','Article 7','The Programme shall support:','(a) Development;']);
  for(const article of [6,7]){
    const placed=resolve(projection,`Article ${article} – paragraph 1 – introductory part`,'The Programme shall support:');
    assert.equal(placed.status,'placed');assert.equal(placed.evidence.at(-1).basis,'introductory-wording-match');assert.equal(placed.span.start,article===6?5:8);
  }
  const placed=resolve(projection,'Article 3 – paragraph 3 – introductory part','The objectives are pursued through:');assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:1});
  for(const original of ['First objective;','Closing continuation.'])assert.equal(resolve(projection,'Article 3 – paragraph 3 – introductory part',original).status,'unresolved');
  const repeated=source(['Article 1','1. Repeat. Repeat.','(a) Point.']);
  assert.equal(resolve(repeated,'Article 1 – paragraph 1 – introductory part','Repeat.').status,'unresolved');
});

test('article title addresses its title child and never the article body or a chapter heading',()=>{
  const projection=source(['CHAPTER VI','PROGRAMMING','Article 4','Learning mobility and volunteering opportunities','1. A body paragraph.'],['Titrechapitre','','Titrearticle','Titrearticle']);
  const placed=resolve(projection,'Article 4 – title','Learning mobility and volunteering opportunities');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:3,end:3});
  assert.equal(resolve(projection,'Article 4 – title','A body paragraph.').status,'unresolved');
  assert.equal(resolve(projection,'Chapter VI – title','VI\tPROGRAMMING').status,'unresolved','A-10-2026-0257 AM146 does not identify an article title child');
  assert.equal(resolve(source(['Article 4','1. A body paragraph.']),'Article 4 – title','A body paragraph.').status,'unresolved');
});

// A-10-2026-0257 AM165/168 and -0104 AM55/76–79/95/117.
test('alphabetic and Roman suffix insertions follow the full existing predecessor subtree',()=>{
  const projection=source(['Article 5','1. Lead:','(a) First;','(b) Second:','(i) Nested first;','(ii) Nested second;','(c) Third.'],['Titrearticle','','Point1','Point1','Point2','Point2','Point1']);
  let placed=resolve(projection,'Article 5 – paragraph 1 – point b a (new)');
  assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,5);assert.equal(placed.insertBefore,6);
  placed=resolve(projection,'Article 5 – paragraph 1 – point b – point ii a (new)');
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,6);
  const suffixed=source(['Article 5','1. Lead:','(b) Original;','(ba) A;','(bc) C;','(c) Next.'],['Titrearticle','','Point1','Point1','Point1','Point1']);
  assert.equal(resolve(suffixed,'Article 5 – paragraph 1 – point b b (new)').insertBefore,4);
  assert.equal(resolve(suffixed,'Article 5 – paragraph 1 – point b a (new)').reason,'duplicate_target_label');
  const reversed=source(['Article 5','1. Lead:','(b) Original;','(bc) C;','(ba) A;'],['Titrearticle','','Point1','Point1','Point1']);
  assert.equal(resolve(reversed,'Article 5 – paragraph 1 – point b b (new)').reason,'source_structure_unavailable');
});

test('unsuffixed points need a predecessor; only the first Roman point can start below a childless point',()=>{
  const projection=source(['Article 4','4. Lead:','(a) First;','(b) Last.']);
  let placed=resolve(projection,'Article 4 – paragraph 4 – point c (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,4);
  assert.equal(resolve(projection,'Article 4 – paragraph 4 – point d (new)').reason,'relative_target_not_found');
  placed=resolve(projection,'Article 4 – paragraph 4 – point a – point i (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,3);assert.equal(placed.evidence.at(-1).basis,'childless-parent-end');
  assert.equal(resolve(projection,'Article 4 – paragraph 4 – point a – point ii (new)').status,'unresolved','AM115/116 cannot use an absent first Roman point as a baseline anchor');
  assert.equal(resolve(projection,'Article 4 – paragraph 9 – point a – point i (new)').reason,'parent_target_not_found');
});

test('negative new points require an exact parent and a complete first-sibling boundary',()=>{
  const projection=source(['Article 3','2. Lead:','(a) First;','(b) Second.']);
  const placed=resolve(projection,'Article 3 – paragraph 2 – point -a (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,1);assert.equal(placed.insertBefore,2);assert.equal(placed.evidence.at(-1).basis,'first-sibling-start');
  assert.equal(resolve(projection,'Article 3 – paragraph 2 – point -b (new)').status,'unresolved');
  assert.equal(resolve(projection,'Article 3 – paragraph 9 – point -a (new)').status,'unresolved');
  const incomplete=structuredClone(projection);incomplete.paragraphSources[1].complete=false;
  assert.equal(resolve(incomplete,'Article 3 – paragraph 2 – point -a (new)').status,'unresolved');
  const reversed=source(['Article 3','2. Lead:','(b) Second;','(a) First.']);
  assert.equal(resolve(reversed,'Article 3 – paragraph 2 – point -a (new)').status,'unresolved');
  const numbered=source(['Article 3','The act is amended:','(1) First;','(2) Second.'],['Titrearticle','','Point0','Point0']);
  assert.equal(resolve(numbered,'Article 3 – paragraph 1 – point -1 (new)').insertBefore,2);
});

test('an omitted heading parent cannot choose between suffix anchors in different chapters',()=>{
  const projection=source(['CHAPTER I','Article 1','1. First.','CHAPTER II','Article 1','1. Other.','Article 1a','1. Intermediate.'],['Titrechapitre','Titrearticle','','Titrechapitre','Titrearticle','','Titrearticle']);
  assert.equal(resolve(projection,'Article 1 b (new)').reason,'multiple_published_targets');
});

test('an introductory part below an explicit subparagraph keeps that ordinal boundary',()=>{
  const projection=source(['Article 8','5. Actions eligible for support include:','(a) Exchange of information.']);
  const placed=resolve(projection,'Article 8 – paragraph 5 – subparagraph 1 – introductory part','Actions eligible for support include:');
  assert.equal(placed.status,'placed');assert.equal(placed.span.start,1);
  assert.equal(resolve(projection,'Article 8 – paragraph 5 – subparagraph 2 – introductory part','Actions eligible for support include:').status,'unresolved');
});

test('a new unsuffixed point follows all published suffixes of its predecessor',()=>{
  const projection=source(['Article 4','4. Lead:','(a) First;','(b) Last original;','(ba) Last inserted predecessor.']);
  const placed=resolve(projection,'Article 4 – paragraph 4 – point c (new)');
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,5);
});

test('a resolved point with different wording never recovers through its ancestor',()=>{
  // A-10-2026-0267 AM15: shifted point numbering must be repaired before
  // the published address and independent placement oracle can agree.
  const projection=source(['Article 1','1. Lead:','(a) Text at the parsed address.','(b) Unique amendment quotation.']);
  const placed=resolve(projection,'Article 1 – paragraph 1 – point a','Unique amendment quotation.');
  assert.equal(placed.status,'unresolved');assert.equal(placed.reason,'conflicting_target_evidence');
});

test('COM(2025)531 quotation ownership contradicts a skipped point c but permits point d',()=>{
  const recorded=fixture('proposal-placement-contradictory-owner.json'),proposal=parseProposal(recorded),items=[{kind:'act',index:1,proposal}];
  assert.equal(recorded.paragraphs[249-recorded.sourceParagraphRange.start],'(d)\tin paragraph 9, the first sentence is replaced by the following:');
  const rejected=resolveProposalPlacement(items,recorded.amendment);
  assert.equal(rejected.status,'unresolved');assert.equal(rejected.reason,'conflicting_target_evidence');
  const agreeing=resolveProposalPlacement(items,{...recorded.amendment,targetLabel:'Article 3 – paragraph 1 – point 2 – point d'});
  assert.equal(agreeing.status,'placed');assert.equal(agreeing.evidence.at(-1).basis,'normalised-original-match');
  assert.deepEqual(agreeing.span,{start:250-recorded.sourceParagraphRange.start,end:250-recorded.sourceParagraphRange.start});
});

test('ancestor recovery uses explicit instruction references only when the owning label is silent',()=>{
  const projection=reference=>source(['Article 1','The act is amended:','(1) '+reference,'‘Unique replacement text.’;','(2) Next instruction.'],['Titrearticle','','Point0','','Point0']);
  const target='Article 1 – paragraph 1 – point 1 – point c',original='Unique replacement text.';
  for(const instruction of ['point (d) is replaced by the following:','point\u00a0(d)  is replaced by the following:'])assert.equal(resolve(projection(instruction),target,original).reason,'conflicting_target_evidence');
  for(const instruction of ['point (c) is replaced by the following:','the following text is replaced by the following:']){
    const placed=resolve(projection(instruction),target,original);assert.equal(placed.status,'placed',instruction);assert.equal(placed.evidence.at(-1).basis,'ancestor-unique-wording');
  }
  const labelled=source(['Article 1','The act is amended:','(1) Instructions:','(d) An explicit source point.','(2) Next instruction.'],['Titrearticle','','Point0','Point1','Point0']);
  assert.equal(resolve(labelled,'Article 1 – paragraph 1 – point 1 – subparagraph 1 – point c','An explicit source point.').reason,'conflicting_target_evidence');
  assert.equal(resolve(labelled,'Article 1 – paragraph 1 – point 1 – subparagraph 1 – point d','An explicit source point.').status,'placed');
});

test('real Commission structures place EP quotations and insertions at their official source paragraphs',()=>{
  const recorded=fixture('proposal-structure-real-excerpts.json');
  for(const amendment of recorded.amendments){
    const excerpt=recorded.examples.find(e=>e.name===amendment.example),proposal=parseProposal(excerpt,excerpt);
    const placed=resolveProposalPlacement([{kind:excerpt.item,index:1,proposal}],amendment);
    assert.equal(placed.status,amendment.expected.status,amendment.id);
    if(placed.status!=='placed'){assert.equal(placed.reason,amendment.expected.reason,amendment.id);continue;}
    const offset=excerpt.sourceParagraphRange.start;
    if(amendment.expected.span)assert.deepEqual(placed.span,{start:amendment.expected.span.start-offset,end:amendment.expected.span.end-offset},amendment.id);
    else {assert.equal(placed.insertAfter,amendment.expected.insertAfter-offset,amendment.id);assert.equal(placed.insertBefore,amendment.expected.insertBefore-offset,amendment.id);}
  }
  const excerpt=recorded.examples.find(e=>e.name==='continuation'),proposal=parseProposal(excerpt,excerpt),amendment=recorded.amendments.find(e=>e.id==='A-10-2026-0257-AM-143');
  assert.equal(resolveProposalPlacement([{kind:'act',index:1,proposal}],{...amendment,targetLabel:'Article 13 – paragraph 2 – subparagraph 1'}).status,'unresolved');
});

test('a dotted alphabetic annex point cannot consume its following published siblings',()=>{
  const excerpt=fixture('proposal-structure-real-excerpts.json').examples.find(e=>e.name==='dotted-alphabetic-annex'),proposal=parseProposal(excerpt,excerpt),items=[{kind:'annex',index:1,proposal}];
  // Structural probe on the real Commission list; the new amendment is constructed.
  const placed=resolveProposalPlacement(items,{language:'en',targetLabel:'Annex II – paragraph 1 – point 3 – point d a (new)',originalText:'',proposedText:'New point.'});
  assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,excerpt.sourceParagraphIndices.indexOf(68));assert.equal(placed.insertBefore,excerpt.sourceParagraphIndices.indexOf(69));
  const wrongSibling=resolveProposalPlacement(items,{language:'en',targetLabel:'Annex II – paragraph 1 – point 3 – point d',originalText:excerpt.paragraphs[excerpt.sourceParagraphIndices.indexOf(69)],proposedText:'Changed wording.'});
  assert.equal(wrongSibling.status,'unresolved');assert.equal(wrongSibling.reason,'conflicting_target_evidence');
});

test('a sibling insertion follows the complete instruction despite repeated quoted Roman labels',()=>{
  // A-10-2026-0073 AM81/82/121/132: instruction 31 contains two lists
  // numbered (i)/(ii), then instruction 32 supplies its outer boundary.
  const paragraphs=['Article 1','The Regulation is amended as follows:',
    '(31) Article 113 is amended as follows:', '(a) in the third paragraph, point (d) is added:',
    '‘(d) The following dates apply:', '(i) First date;', '(ii) Second date.',
    'In the absence of that decision:', '(i) Earlier date;', '(ii) Later date.’;',
    '(b) in the third paragraph, point (e) is added:', '‘3. Articles 102 to 110 shall apply from that date.’;',
    '(32) in Annex VIII, section B is deleted;', 'Article 2','Entry into force.'];
  const styles=['Titrearticle','Normal','Point1','Point1','Point2','Point2','Point2','Point2','Point2','Point2','Point1','Point2','Point1','Titrearticle','Normal'];
  const projection=source(paragraphs,styles),items=[item(projection)];
  const target={targetLabel:'Article 1 – paragraph 1 – point 31 a (new)',originalText:'',proposedText:'(31a) New instruction.',language:'en'};
  assert.equal(proposalCandidates(items[0].proposal,'Article 1 – paragraph 1 – point 31')[0].complete,false);
  const placed=resolveProposalPlacement(items,target);
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,12);assert.equal(placed.insertAfter,11);
  // Missing source rows still make the boundary unavailable.
  const incomplete=structuredClone(projection);incomplete.paragraphSources[8].complete=false;
  assert.equal(resolveProposalPlacement([item(incomplete)],target).status,'unresolved');
});

test('native footnotes require their payloads and anchor positions, including renumbering',()=>{
 const proposal=structuredClone(item(source(['2026/0001 (COD)','(1) Public body.','(2) Next recital.','HAVE ADOPTED THIS REGULATION:','Article 1'])).proposal);
 proposal.notes=[{id:'native',label:'40',text:'Public note.',complete:true}];
 proposal.anchors=[{paragraph:1,offset:10,note:'native',label:'40'}];
 const wording={language:'en',targetLabel:'Recital 1',originalText:'(1) Public6 body.\n______\n6 Public note.',originalFormatting:[{kind:'superscript',start:10,end:11}],proposedText:'Changed body.'};
 const items=[{kind:'act',proposal}];
 assert.equal(resolveProposalPlacement(items,wording).status,'placed');
 assert.equal(resolveProposalPlacement(items,{...wording,originalText:wording.originalText.replace('Public note.','Different note.')}).status,'unresolved');
 proposal.anchors[0].offset=12;
 assert.equal(resolveProposalPlacement(items,wording).status,'unresolved');
});

test('quoted sibling insertion follows the complete paragraph and preserves the terminator',()=>{
 const texts=['Article 1','Regulation (EU) 2024/123 is amended as follows:','(1) Article 9 is amended as follows:','(b) the following paragraph 4a is inserted:','‘4a. Public provision.','Continued text.’',';','(2) Next instruction.','Article 2'];
 const styles=['Titrearticle','Normal','Point0','Point1','Normal','Normal','Normal','Point0','Titrearticle'];
 const amendment={language:'en',targetLabel:'Article 1 – paragraph 1 – point 1 – point b',originalText:'',proposedText:'4aa. A new paragraph.'};
 const result=resolveProposalPlacement([item(source(texts,styles))],amendment);
 assert.equal(result.status,'placed',result.reason);assert.equal(result.insertBefore,6);
 texts[3]='(b) the second subparagraph is replaced by the following:';
 assert.equal(resolveProposalPlacement([item(source(texts,styles))],amendment).status,'unresolved');
});

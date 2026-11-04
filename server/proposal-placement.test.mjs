import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
import {makeAnnexIndentCase,fixtureZip} from '../scripts/fixtures/bare-annex-indent-native.mjs';
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

test('proposal title requires native proof and rejects unsupported field output',()=>{
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const values=['2025/580 (CNS)','Proposal for a','COUNCIL DIRECTIVE','on a subject (recast)','THE COUNCIL OF THE EUROPEAN UNION,'];
 const styles=['Rfrenceinterinstitutionnelle','Statut','Typedudocument','Titreobjet','Institutionquiagit'];
 const p=(style,body)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${body}</w:p>`;
 const body=values.map((v,i)=>p(styles[i],`<w:r><w:t>${v}</w:t></w:r>`));
 const styleXml=`<w:styles xmlns:w="${ns}"><w:style w:type="character" w:styleId="CRMarker"><w:name w:val="CR Marker"/></w:style><w:style w:type="character" w:styleId="deleted"><w:name w:val="CR Deleted"/><w:rPr><w:strike/></w:rPr></w:style></w:styles>`;
 const wording={language:'en',baseline:'commission-proposal',targetLabel:'Title 1',originalText:values.slice(1,4).join('\n'),proposedText:'Changed title'};
 const make=rows=>{const buffer=fixtureZip({'word/document.xml':`<w:document xmlns:w="${ns}"><w:body>${rows.join('')}</w:body></w:document>`,'word/styles.xml':styleXml});return {buffer,proposal:parseProposal(buffer,{item:'act'})};};
 const place=x=>resolveProposalPlacement([{kind:'act',proposal:x.proposal}],wording,{nativeProposalInputs:[x.buffer]});
 const good=make(body);assert.equal(place(good).status,'placed');
 assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:good.proposal}],wording).status,'placed');
 const fld=(instruction,result,style='')=>`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r>${style?`<w:rPr><w:rStyle w:val="${style}"/></w:rPr>`:''}<w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
 for(const replacement of [`<w:fldSimple w:instr="DOCPROPERTY Title"><w:r><w:t>${values[3]}</w:t></w:r></w:fldSimple>`,fld('DOCPROPERTY Title',values[3]),fld('QUOTE &quot;ð&quot;',values[3])]){
  const rows=[...body];rows[3]=p(styles[3],replacement);assert.notEqual(place(make(rows)).status,'placed');
 }
 const rows=[...body];rows[3]=p(styles[3],`<w:r><w:t>${values[3]}</w:t></w:r>`+fld('QUOTE &quot;ð&quot;','ð','CRMarker'));assert.equal(place(make(rows)).status,'placed');
});

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
  const projection=source(['Article 1','1. Lead subparagraph text.','Second subparagraph text.','2. Next paragraph.'],['Titrearticle','ManualNumPar1','Text1','ManualNumPar1']);
  let placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 1','Lead subparagraph text.');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:1});assert.equal(placed.evidence.at(-1).basis,'subparagraph-wording-match');
  placed=resolve(projection,'Article 1 – paragraph 1 – subparagraph 2','Second subparagraph text.');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 1','Second subparagraph text.').reason,'conflicting_target_evidence');
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 3','Second subparagraph text.').reason,'target_not_found');
  assert.equal(resolve(projection,'Article 1 – paragraph 1 – subparagraph 2 a (new)').insertBefore,3);
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

// A-10-2026-0069 AM40: Article 4ba (new) beside new Articles 4a-4d.
test('a two-letter suffix follows its base only when that base has no suffixed siblings',()=>{
  const projection=source(['Article 4','1. Committee.','Article 5','1. Origin.'],['Titrearticle','','Titrearticle','']);
  const placed=resolve(projection,'Article 4 ba (new)');
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,2);
  const suffixed=source(['Article 4','1. Committee.','Article 4a','1. Added.','Article 5','1. Origin.'],['Titrearticle','','Titrearticle','','Titrearticle','']);
  assert.equal(resolve(suffixed,'Article 4 ba (new)').reason,'insertion_reference_unavailable');
});

test('unsuffixed points need a predecessor; new Roman points start below a childless lettered point',()=>{
  const projection=source(['Article 4','4. Lead:','(a) First;','(b) Last.']);
  let placed=resolve(projection,'Article 4 – paragraph 4 – point c (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,4);
  assert.equal(resolve(projection,'Article 4 – paragraph 4 – point d (new)').reason,'relative_target_not_found');
  placed=resolve(projection,'Article 4 – paragraph 4 – point a – point i (new)');assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,3);assert.equal(placed.evidence.at(-1).basis,'childless-parent-end');
  // A-10-2026-0257 AM114-116: a childless point has one end boundary for every new Roman child.
  placed=resolve(projection,'Article 4 – paragraph 4 – point a – point ii (new)');assert.equal(placed.insertBefore,3);assert.equal(placed.evidence.at(-1).basis,'childless-parent-end');
  assert.equal(resolve(projection,'Article 4 – paragraph 4 – point a – point c (new)').status,'unresolved','a lettered child is no Roman list start');
  const nested=source(['Article 4','4. Lead:','(a) First:','(i) Nested;','(b) Last.'],['Titrearticle','','Point1','Point2','Point1']);
  assert.equal(resolve(nested,'Article 4 – paragraph 4 – point a – point iii (new)').status,'unresolved','an existing Roman list needs its predecessor');
  const flattened=source(['Article 4','4. Lead:','(a) First:','(i) Existing child;','(b) Last.'],['Titrearticle','','Point1','Point1','Point1']);
  assert.equal(resolve(flattened,'Article 4 – paragraph 4 – point a – point ii (new)').status,'unresolved','a flattened (i) breaks the a, b peer sequence');
  const afterH=source(['Article 4','4. Lead:',...'abcdefg'.split('').map(l=>`(${l}) Point;`),'(h) Last parent:','(i) Existing child;'],['Titrearticle','',...Array(9).fill('Point1')]);
  assert.equal(resolve(afterH,'Article 4 – paragraph 4 – point h – point ii (new)').status,'unresolved','a following (i) may be a flattened Roman child');
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
 const conflicting={...amendment,targetPath:{proposal:[{raw:amendment.targetLabel}],underlying:[{raw:'Article 4aa (new)',document:'Regulation (EU) 2024/123'}]}};
 assert.equal(resolveProposalPlacement([item(source(texts,styles))],conflicting).status,'unresolved');
 const addressed={...amendment,targetPath:{proposal:[{raw:amendment.targetLabel}],underlying:[{raw:'Article 9 – paragraph 4a – second subparagraph (new)',document:'Regulation (EU) 2024/123'}]}};
 assert.equal(resolveProposalPlacement([item(source(texts,styles))],addressed).status,'placed');
 texts[3]='(b) the second subparagraph is replaced by the following:';
 assert.equal(resolveProposalPlacement([item(source(texts,styles))],amendment).status,'unresolved');
});

test('points inserted inside a quoted replacement subparagraph follow the printed nested labels',()=>{
 const texts=['Article 1','Regulation (EU) 2023/956 is amended as follows:','(20)\tin Article 30(6), the second subparagraph is replaced by the following:','‘Before 2028 the Commission shall report on:','(a) an assessment of:','(i) leakage;','(ii) sectors;','(b) an assessment of:','(i) governance;','(ii) scope;','(iii) circumvention;','(iv) penalties;','(v) thresholds;','(c) results;','(d) information.;’','(21)\tAnnex I is amended.','Article 2'];
 const styles=['Titrearticle','Normal','Point0',...texts.slice(3,15).map(()=>'Normal'),'Point0','Titrearticle'];
 const place=(raw,proposedText)=>resolveProposalPlacement([item(source(texts,styles))],{language:'en',targetLabel:'Article 1 – paragraph 1 – point 20',originalText:'',proposedText,targetPath:{language:'en',proposal:[{raw:'Article 1 – paragraph 1 – point 20'}],underlying:[{document:'Regulation (EU) 2023/956',raw}]}});
 assert.equal(place('Article 30 – paragraph 6 – subparagraph 2 – point b – point iii a (new)','(iiia)\tNew.').insertBefore,11);
 for(const raw of ['Article 30 – paragraph 6 – second subparagraph – point b – point va (new)','Article 30 – paragraph 6 – subparagraph 2 – point (b)(va)'])assert.equal(place(raw,'(va)\tNew.').insertBefore,13,raw);
 assert.equal(place('Article 30 – paragraph 6 – subparagraph 2 – point (ba) new','(ba)\tNew.').insertBefore,13);
 assert.equal(place('Article 30 – paragraph 6 – third subparagraph (new)','A new subparagraph.').insertBefore,15);
 assert.equal(place('Article 30 – paragraph 6 – subparagraph 2 – point b – point iii a (new)','(iiib)\tNew.').status,'unresolved','the printed label must match the address');
 assert.equal(place('Article 31 – paragraph 6 – subparagraph 2 – point b – point iii a (new)','(iiia)\tNew.').status,'unresolved','another article');
 assert.equal(place('Article 30 – paragraph 6 – subparagraph 2 – point b – point ii a (new)','(iia)\tNew.').insertBefore,10);
 texts.splice(10,0,'(iia) acts;','(iib) values;');styles.splice(10,0,'Normal','Normal');
 for(const suffix of ['a','b','c','d']) {
  const result=place('Article 30 – paragraph 6 – subparagraph 2 – point b – point ii '+suffix+' (new)','(ii'+suffix+')\tNew.');
  assert.equal(result.insertBefore,10);assert(result.evidence.some(e=>e.basis==='colliding-new-point'));
 }
 assert.equal(place('Article 30 – paragraph 6 – subparagraph 2 – point b – point iii (new)','(iii)\tNew.').status,'unresolved','an existing printed label');
});

test('a sibling of paragraphs inserted into a named article follows the provision text, before its asterisk note',()=>{
 const texts=['Article 1','Directive 2003/87/EC is amended as follows:','(1)\tin Article 10a, the following paragraphs 2a and 2b are inserted after paragraph 2:','‘2a. First provision.','2b. Second provision under Regulation (EC) No 1893/2006*.','______','* Regulation (EC) No 1893/2006 of the European Parliament.’','Article 2'];
 const styles=['Titrearticle','Normal','Point0','Normal','Normal','Normal','Normal','Titrearticle'];
 const amendment={language:'en',targetLabel:'Article 1 – paragraph 1 – point 1',originalText:'',proposedText:'2ba.\tA new paragraph.'};
 const result=resolveProposalPlacement([item(source(texts,styles))],amendment);
 assert.equal(result.status,'placed',result.reason);assert.equal(result.insertBefore,5);
 texts[2]='(1)\tin Article 10a, the second subparagraph is replaced by the following:';
 assert.equal(resolveProposalPlacement([item(source(texts,styles))],amendment).status,'unresolved');
});

test('detached footnotes cannot enable a whole-article deletion without extent verification',()=>{
 const proposal=structuredClone(item(source(['Article 1','1. Public body.','Article 2'],['Titrearticle','Normal','Titrearticle'])).proposal);
 proposal.notes=[{id:'native',label:'6',text:'Public note.',complete:true}];proposal.anchors=[{paragraph:1,offset:14,note:'native',label:'6'}];
 const originalText='Article 1\n1. Public body6.\n______\n6 Public note.',at=originalText.indexOf('6');
 const result=resolveProposalPlacement([{kind:'act',proposal}],{language:'en',targetLabel:'Article 1',originalText,originalFormatting:[{kind:'superscript',start:at,end:at+1}],proposedText:'deleted'});
 assert.equal(result.status,'unresolved');
});

test('maintainer conventions place implicit paragraph one and negative instructions',()=>{
 const projection=source(['Article 1','The act is amended as follows:','(4) Article 4 is replaced by the following:','‘Article 4','Literacy','‘Providers shall arrange training.’;','(5) The next paragraph is deleted:','Article 2'],['Titrearticle','','Point0','Titrearticle','Normal','Normal','Point0','Titrearticle']);
 for(const label of ['(1a) New paragraph.','(1b) Another paragraph.'])assert.equal(resolve(projection,'Article 1 – paragraph 1 – point 4','',label).insertAfter,5);
 for(const label of ['-1. New instruction.','-1a. Another instruction.'])assert.equal(resolve(projection,'Article 1 – paragraph 1 – point 4','Existing law outside the proposal.',label).insertAfter,2);
});
test('instruction anchor ignores quoted existing law only after exact instruction comparison',()=>{
 const projection=source(['Article 1','The act is amended as follows:','(4) in Article 29, paragraph 2 is replaced by the following:','‘2. Published replacement.’','(5) The next paragraph is deleted:','Article 2'],['Titrearticle','','Point0','','Point0','Titrearticle']);
 const original='(4) in Article 29, paragraph 2 is replaced by the following:\n1. Existing law outside the proposal.';
 const placed=resolve(projection,'Article 1 – paragraph 1 – point 4 – introductory part',original,'(4) in Article 29, paragraphs 1 and 2 are replaced by the following:\nNew law.');
 assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
 assert.equal(resolve(projection,'Article 1 – paragraph 1 – point 4 – introductory part',original.replace('29','30'),'New law.').status,'unresolved');
});
test('similar wording records the score and refuses a nearby competing passage',()=>{
 const text='A provider shall document its assessment before the system is placed on the market.';
 const projection=source(['Article 1','The act is amended as follows:','(1) Paragraph 1 is replaced by the following:','‘'+text+'’','Article 2'],['Titrearticle','','Point0','','Titrearticle']);
 const placed=resolve(projection,'Article 1 – paragraph 1 – point 1',text.replace('system','systen'),'New text.');
 assert.equal(placed.status,'placed');assert.equal(placed.evidence.at(-1).matchKind,'similar');assert(placed.evidence.at(-1).similarity>=.95);
 const ambiguous=source(['Article 1','1. '+text,'1. '+text,'Article 2'],['Titrearticle','ManualNumPar1','','Titrearticle']);
 assert.equal(resolve(ambiguous,'Article 1 – paragraph 1','1. '+text.replace('system','systen'),'New text.').status,'unresolved');
});

test('similarity recovery withholds table-cell passages without independent table boundaries',()=>{
 const text='1. A provider shall document the assessment before placing the system on the market.';
 const projection=source(['Article 1','The act is amended as follows:','(1) Paragraph 1 is replaced by the following:',text,'Article 2'],['Titrearticle','','Point0','','Titrearticle']);
 const proposal=structuredClone(parseProposal(projection));
 proposal.paragraphs[3].source={...proposal.paragraphs[3].source,container:'table-cell',containerPath:'body/table/row/cell'};
 const placed=resolveProposalPlacement([{kind:'act',proposal}],{targetLabel:'Article 1 – paragraph 1 – point 1',originalText:text.replace('system','systen'),proposedText:'New text.',language:'en'});
 assert.equal(placed.status,'unresolved');
});

// A-10-2026-0257 AM1 and A-10-2026-0040 AM30.
test('preamble citations are addressed in order and Article -1 follows the enacting formula',()=>{
  const projection=source(['THE EUROPEAN PARLIAMENT AND THE COUNCIL OF THE EUROPEAN UNION,','Having regard to the Treaty,','Having regard to the proposal from the European Commission,','After transmission of the draft legislative act to the national parliaments,','Acting in accordance with the ordinary legislative procedure,','Whereas:','(1) A recital.','HAVE ADOPTED THIS REGULATION:','Article 1','1. Text.','Article 2','1. Entry into force.'],['Institutionquiagit','Normal','Normal','Normal','Normal','Normal','ManualConsidrant','Formuledadoption','Titrearticle','ManualNumPar1','Titrearticle','ManualNumPar1']);
  let placed=resolve(projection,'Citation 3 a (new)','','Having regard to the opinion of the Court of Auditors,');
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,4);
  placed=resolve(projection,'Citation 2','Having regard to the proposal from the European Commission,','Having regard to the amended proposal,');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
  assert.equal(resolve(projection,'Citation 2','Having regard to the Treaty,','Changed.').status,'unresolved','wording must match the ordinal citation');
  assert.equal(resolve(projection,'Citation 9 a (new)').reason,'target_not_found');
  assert.equal(resolve(projection,'Citation 4 a (new)','','The European Parliament rejects the Commission proposal.').reason,'conflicting_target_evidence','A-10-2026-0104 AM90');
  placed=resolve(projection,'Article -1','','Article -1\nIn Article 3 of Regulation (EU) 2021/1232, point (a) is replaced.');
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,8);
  const split=source(['THE EUROPEAN PARLIAMENT AND THE COUNCIL OF THE EUROPEAN UNION,','Having regard to the Treaty on the Functioning of the European Union,','and in particular Article 192(1) thereof,','Having regard to the proposal from the European Commission,','Whereas:'],['Institutionquiagit','Normal','Normal','Normal','Normal']);
  assert.equal(resolve(split,'Citation 1 a (new)','','Having regard to the opinion,').status,'unresolved','a continuation row would shift the ordinals');
  const later=source(['HAVE ADOPTED THIS REGULATION:','Article 2','1. Text.'],['Formuledadoption','Titrearticle','ManualNumPar1']);
  assert.equal(resolve(later,'Article -1','','Article -1\nNew article.').status,'unresolved');
});
test('new final-article paragraphs precede the unnumbered closing formula',()=>{
 const formula='This Regulation shall be binding in its entirety and directly applicable in all Member States.';
 const rows=['Article 6','This Regulation shall enter into force tomorrow.',formula,'Done at Brussels'];
 const projection=source(rows,['Titrearticle','Normal','Normal','Normal']);
 for(const n of [2,3]){const placed=resolve(projection,`Article 6 – paragraph ${n} (new)`);assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,2);}
 assert.equal(resolve(projection,'Article 6 – paragraph 1 (new)').status,'unresolved');
 const missing=source(rows.filter(r=>r!==formula),['Titrearticle']);
 assert.equal(resolve(missing,'Article 6 – paragraph 2 (new)').status,'unresolved');
});
test('amendment wording resolves shifted Commission point labels uniquely',()=>{
 // COM(2025)983 / A-10-2026-0267 AM15–17: the second passage is unnumbered.
 const passages=['Member States may provide alternative means for traceability and enforcement with regard to producers established in third countries;','Article 17(2) of Directive 2012/19/EU;','Article 8(7) of Directive (EU) 2019/904.'];
 const rows=['Article 1','Suspension','The following provisions are suspended:','(a) Article 22a(3) of Directive 2008/98/EC.',passages[0],'(b) '+passages[1],'(c) '+passages[2],'Article 2'];
 const projection=source(rows,['Titrearticle']);projection.paragraphProperties.at(-1).styleId='Titrearticle';
 for(const [i,label] of ['b','c','d'].entries()){
  const placed=resolve(projection,`Article 1 – paragraph 1 – point ${label}`,`(${label}) ${passages[i]}`,'deleted');
  assert.equal(placed.status,'placed',placed.reason);assert.equal(placed.span.start,i+4);assert.equal(placed.span.end,i+4);
 }
 const repeated=source([...rows.slice(0,-1),passages[1],'Article 2'],['Titrearticle']);repeated.paragraphProperties.at(-1).styleId='Titrearticle';
 assert.equal(resolve(repeated,'Article 1 – paragraph 1 – point d','(d) '+passages[1],'deleted').status,'unresolved');
});
// Extracted source tables: every cell, empty ones included (`widths` adds blank columns).
function sourceTables(rows,widths={}) {
  const tables=new Map();
  rows.forEach((r,index)=>{if(r[2]!=='cell')return;const t=tables.get(r[3])??new Map();tables.set(r[3],t);const row=t.get(r[4])??new Map();t.set(r[4],row);row.set(r[5],[...(row.get(r[5])??[]),index]);});
  return [...tables].map(([tbl,t])=>({sourcePath:`/w:document[1]/w:body[1]/w:tbl[${tbl}]`,paragraphs:[...t.values()].flatMap(r=>[...r.values()].flat()),complete:true,
    rows:[...t.values()].map(r=>{const width=Math.max(...r.keys(),widths[tbl]??0);return {cells:Array.from({length:width},(_,i)=>({paragraphs:r.get(i+1)??[],colSpan:1}))};})}));
}

test('an article table must cover all complete cells in its addressed paragraph',()=>{
 const rows=[['Article 20','Titrearticle','body'],['2. The following applies:','ManualNumPar1','body'],['(a)','Normal','cell',1,1,1],['Cigars','Normal','cell',1,1,2],['(b)','Normal','cell',1,2,1],['Other','Normal','cell',1,2,2],['3. Next paragraph.','ManualNumPar1','body'],['Article 21','Titrearticle','body']];
 const projection={paragraphs:rows.map(r=>r[0]),structureStatus:'extracted',paragraphSources:rows.map((r,ordinal)=>r[2]==='cell'?{path:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`,ordinal,container:'table-cell',containerPath:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]`,segment:ordinal,complete:true}:{path:`/w:document[1]/w:body[1]/w:p[${ordinal+1}]`,ordinal,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:ordinal,complete:true}),paragraphProperties:rows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(rows)};
 const proposal=parseProposal(projection),items=[{kind:'act',proposal}],w={language:'en',targetLabel:'Article 20 – paragraph 2 – table',originalText:'(a)\tCigars\n(b)\tOther',proposedText:'Changed'};
 const result=resolveProposalPlacement(items,w);assert.deepEqual(result.span,{start:2,end:5});assert.equal(result.originalText,w.originalText);
 assert.notEqual(resolveProposalPlacement(items,{...w,originalText:'(a)\tCigars'}).status,'placed');
 assert.notEqual(resolveProposalPlacement(items,{...w,targetLabel:'Article 20 – paragraph 1 – table'}).status,'placed');
 const flatten=units=>units.flatMap(u=>[u,...flatten(u.children??[])]);const find=units=>flatten(units).find(u=>u.table)?.table;
 for(const at of ['start','end']){const changed=structuredClone(proposal),table=find(changed.units),empty={cells:[{paragraphs:[],colSpan:1},{paragraphs:[],colSpan:1}]};if(at==='start')table.rows.unshift(empty);else table.rows.push(empty);assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:changed}],w).status,'placed');}
});

// A-10-2026-0201 AM107/AM112: cell-exact table rows inside the addressed annex provision.
test('annex table addresses replace a unique cell-exact run of rows',()=>{
  const rows=[['ANNEX III','Annexetitre','body'],['The following Annex VIII is added:','Normal','body'],['Iron and steel','Normal','body'],['CN code','Normal','cell',1,1,1],['Greenhouse gas','Normal','cell',1,1,2],['ex 7204 Ferrous waste','Normal','cell',1,2,1],['Carbon dioxide','Normal','cell',1,2,2],['Aluminium','Normal','body'],['CN code','Normal','cell',2,1,1],['Greenhouse gas','Normal','cell',2,1,2],['ex 7602 Aluminium waste','Normal','cell',2,2,1],['Carbon dioxide','Normal','cell',2,2,2],['’','Normal','body']];
  const projection={paragraphs:rows.map(r=>r[0]),structureStatus:'extracted',
    paragraphSources:rows.map((r,ordinal)=>r[2]==='cell'?{path:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`,ordinal,container:'table-cell',containerPath:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]`,segment:ordinal,complete:true}:{path:'/w:document[1]/w:body[1]/w:p['+ordinal+']',ordinal,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:ordinal,complete:true}),
    paragraphProperties:rows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(rows)};
  const items=[{kind:'annex',index:1,proposal:parseProposal(projection,{item:'annex'})}];
  const place=(targetLabel,originalText)=>resolveProposalPlacement(items,{targetLabel,originalText,proposedText:'Changed',language:'en'});
  const placed=place('Annex III – paragraph 1 – table','Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:7,end:11});
  assert.equal(place('Annex III – paragraph 1 – table on aluminium','Aluminium\nCN code\tGreenhouse gas\n7602 Aluminium waste\tCarbon dioxide').status,'placed','D6 permits one missing word on this uniquely addressed table');
  assert.equal(place('Annex III – paragraph 1 – table','CN code\tGreenhouse gas').status,'unresolved','repeated header rows are ambiguous');
  const label='Annex III – paragraph 1 – table on aluminium',original='Aluminium\nCN code\tGreenhouse gas\n7602 Aluminium waste\tCarbon dioxide';
  for(const changed of [original.replace('waste\tCarbon','waste Carbon\t'),original.replace('Aluminium\nCN code','Aluminium CN\ncode')]){
    assert.equal(place(label,changed).status,'unresolved','one word cannot cross a cell or row boundary');
    assert.notEqual(verifyPlacement({items,wording:{language:'en',targetLabel:label,originalText:changed,proposedText:'Changed'},placement:placed}).status,'verified','independent oracle preserves separators');
  }
  const quotedItems=structuredClone(items);quotedItems[0].proposal.paragraphs[10].text='ex 7602 “Aluminium” waste';
  const quotedOriginal=original.replace('7602 Aluminium waste','7602 "Aluminium" waste'),quotedWording={language:'en',targetLabel:label,originalText:quotedOriginal,proposedText:'Changed'};
  assert.equal(resolveProposalPlacement(quotedItems,quotedWording).status,'unresolved','one omitted word cannot conceal quote substitution');
  assert.notEqual(verifyPlacement({items:quotedItems,wording:quotedWording,placement:placed}).status,'verified');

  const gappedRows=[['ANNEX III','Annexetitre','body'],['Lead.','Normal','body'],['A','Normal','cell',1,1,1],['B','Normal','cell',1,1,3],['C','Normal','cell',1,2,1],['D','Normal','cell',1,2,2],['E','Normal','cell',1,2,3]];
  const trailingRows=[['ANNEX III','Annexetitre','body'],['Lead.','Normal','body'],['A','Normal','cell',1,1,1],['B','Normal','cell',1,1,2],['C','Normal','cell',1,2,1],['D','Normal','cell',1,2,2]];
  const trailing={paragraphs:trailingRows.map(r=>r[0]),structureStatus:'extracted',paragraphSources:trailingRows.map((r,ordinal)=>r[2]==='cell'?{path:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`,ordinal,container:'table-cell',containerPath:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]`,segment:ordinal,complete:true}:{path:'/w:document[1]/w:body[1]/w:p['+ordinal+']',ordinal,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:ordinal,complete:true}),paragraphProperties:trailingRows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(trailingRows,{1:3})};
  assert.equal(resolveProposalPlacement([{kind:'annex',index:1,proposal:parseProposal(trailing,{item:'annex'})}],{targetLabel:'Annex III – table',originalText:'A\tB',proposedText:'Changed',language:'en'}).status,'unresolved','a blank trailing column keeps rows from matching fewer cells');
  const gapped={paragraphs:gappedRows.map(r=>r[0]),structureStatus:'extracted',paragraphSources:gappedRows.map((r,ordinal)=>r[2]==='cell'?{path:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`,ordinal,container:'table-cell',containerPath:`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]`,segment:ordinal,complete:true}:{path:'/w:document[1]/w:body[1]/w:p['+ordinal+']',ordinal,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:ordinal,complete:true}),paragraphProperties:gappedRows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(gappedRows,{1:3})};
  assert.equal(resolveProposalPlacement([{kind:'annex',index:1,proposal:parseProposal(gapped,{item:'annex'})}],{targetLabel:'Annex III – table',originalText:'A\tB',proposedText:'Changed',language:'en'}).status,'unresolved','an empty middle cell must not collapse the columns');
});

test('new unnumbered subparagraphs follow their ordinal source subtree',()=>{
  const p=source(['Article 3','1. Lead:','(a) Point.','Second subparagraph.','Third subparagraph.','2. Next paragraph.','Article 4'],['Titrearticle','ManualNumPar1','Point2','Text1','Text1','ManualNumPar1','Titrearticle']);
  p.paragraphFormats=p.paragraphs.map((_,i)=>({indent:i===2?200:0}));
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 2 a (new)').insertBefore,4);
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 1 a (new)').insertBefore,3);
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 3 a (new)').insertBefore,5);
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 9 a (new)').status,'unresolved');
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 2 b (new)').status,'unresolved');
  p.paragraphSources[4].ordinal++;
  assert.equal(resolve(p,'Article 3 – paragraph 1 – subparagraph 2 a (new)').status,'unresolved');
});


test('new subparagraph placement withholds Point-style paragraph labels outside the raw oracle grammar',()=>{
 const p=source(['Article 16','Financial support','1. First paragraph.','2. Second paragraph.','Article 17'],['Titrearticle','Normal','Point0','Point0','Titrearticle']);
 assert.equal(resolve(p,'Article 16 – paragraph 1 – subparagraph 1 a (new)').status,'unresolved');
 const literal=structuredClone(p);literal.paragraphProperties[2].styleId='Normal';literal.paragraphProperties[3].styleId='Normal';
 assert.equal(resolve(literal,'Article 16 – paragraph 1 – subparagraph 1 a (new)').status,'unresolved');
});

test('two-row chapter titles preserve the CHAPTER prefix and source offsets',()=>{
  const p=source(['HAVE ADOPTED THIS REGULATION:','CHAPTER VI','PROGRAMMING','Article 15','Work programme','One.'],['Formuledadoption','ChapterTitle','ChapterTitle','Titrearticle','Titrearticle','Normal']);
  const placed=resolve(p,'Chapter VI – title','VI\tPROGRAMMING','VI\tPROGRAMMING AND MONITORING');
  assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:2});assert.deepEqual(placed.splice,{start:{paragraph:1,offset:8},end:{paragraph:2,offset:11}});
  assert.equal(resolve(p,'Chapter VI – title','VI\tWRONG','VI\tNEW').status,'unresolved');
  assert.equal(resolve(p,'Chapter VI – title','VI\tPROGRAMMING','VII\tNEW').status,'unresolved');
  const gap=structuredClone(p);gap.paragraphSources[2].ordinal++;
  assert.equal(resolve(gap,'Chapter VI – title','VI\tPROGRAMMING','VI\tNEW').status,'unresolved');
});

test('chapter C does not splice the first letter of CHAPTER',()=>{const p=source(['HAVE ADOPTED THIS REGULATION:','CHAPTER C','PROGRAMMING','Article 15','Work programme','One.'],['Formuledadoption','ChapterTitle','ChapterTitle','Titrearticle','Titrearticle','Normal']);assert.equal(resolve(p,'Chapter C – title','C\tPROGRAMMING','C\tCHANGED').splice.start.offset,8);});
test('whole-article note deletion requires consecutive native article boundaries and exact note parity',()=>{
 const texts=['HAVE ADOPTED THIS REGULATION:','Article 1','1. Public body.','Article 2'];
 const content={...source(texts,['Normal','Titrearticle','ManualNumPar1','Titrearticle']),sourceKind:'docx'};
 content.paragraphSources.forEach((s,i)=>s.path=`/w:document[1]/w:body[1]/w:p[${i+1}]`);
 const proposal=structuredClone(parseProposal(content));proposal.notes=[{id:'native',text:'Public note.',complete:true}];proposal.anchors=[{paragraph:2,offset:14,note:'native'}];
 const originalText='Article 1\n1. Public body6.\n______\n6 Public note.',at=originalText.indexOf('6'),w={language:'en',baseline:'commission-proposal',targetLabel:'Article 1',originalText,originalFormatting:[{kind:'superscript',start:at,end:at+1}],proposedText:'deleted'};
 const place=(p=proposal,wording=w)=>resolveProposalPlacement([{kind:'act',proposal:p}],wording);
 assert.equal(place().status,'placed');assert.deepEqual(place().span,{start:1,end:2});
 for(const mutate of [p=>p.sourceKind='text',p=>p.paragraphs[2].complete=false,p=>p.paragraphs[2].source.ordinal++,p=>p.paragraphs[3].source.ordinal++,p=>p.paragraphs[3].source.segment++,p=>p.paragraphs[3].properties.styleId='Normal',p=>p.paragraphs[2].properties.numberingLabel='1.',p=>p.notes[0].text='Other note.',p=>p.anchors[0].offset--,p=>p.paragraphs[0].text='Draft text:']){
  const p=structuredClone(proposal);mutate(p);assert.equal(place(p).status,'unresolved',String(mutate));
 }
 assert.equal(place(proposal,{...w,language:'fr'}).status,'unresolved');
 assert.equal(place(proposal,{...w,baseline:'present-text'}).status,'unresolved');
 assert.equal(place(proposal,{...w,proposedText:'New text.'}).status,'unresolved');
 assert.equal(place(proposal,{...w,originalText:w.originalText.replace('Public body','Other body')}).status,'unresolved');
});
test('a printed first-paragraph label matches only the sole complete implicit article paragraph',()=>{
 const content={...source(['Article [1]','Subject matter','A legal body.','Article [2]'],['Titrearticle','Titrearticle','Normal','Titrearticle']),sourceKind:'docx'},w={baseline:'commission-proposal',language:'en',targetLabel:'Article 1 – paragraph 1',originalText:'1. A legal body.',proposedText:'1. A revised legal body.'};
 const proposal=structuredClone(parseProposal(content)),place=(p=proposal,a=w)=>resolveProposalPlacement([{kind:'act',proposal:p}],a);
 assert.equal(place().status,'placed');assert.deepEqual(place().splice,{start:{paragraph:2,offset:0},end:{paragraph:2,offset:13}});
 for(const mutate of [p=>p.anchors=[{paragraph:2,note:'1',offset:5}],p=>p.paragraphs[2].objects=[{complete:true}],p=>p.sourceKind='text',p=>p.paragraphs[2].complete=false,p=>p.paragraphs[3].source.ordinal++,p=>p.paragraphs[2].properties.numberingLabel='1.']){const p=structuredClone(proposal);mutate(p);assert.equal(place(p).status,'unresolved',String(mutate));}
 for(const patch of [{baseline:'present-text'},{language:'fr'},{originalText:'2. A legal body.'},{proposedText:'2. A revised legal body.'},{originalText:'1. Another legal body.'}])assert.equal(place(proposal,{...w,...patch}).status,'unresolved',JSON.stringify(patch));
 const two={...content,paragraphs:['Article [1]','Subject matter','A legal body.','Another paragraph.','Article [2]']};
 Object.assign(two,source(two.paragraphs,['Titrearticle','Titrearticle','Normal','Normal','Titrearticle']));two.sourceKind='docx';assert.equal(place(parseProposal(two)).status,'unresolved');
});
test('a sole bare annex supplies only a bounded interior indent alias with native inline proof',()=>{
 const raw=makeAnnexIndentCase(),items=raw.items.map((i,index)=>({kind:i.kind,proposal:structuredClone(parseProposal(raw.nativeQuoted.proposalBuffers[index],{item:i.kind}))})),w=raw.wording;
 const place=(input=items,a=w,nativeProposalInputs=raw.nativeQuoted.proposalBuffers)=>resolveProposalPlacement(input,a,{nativeProposalInputs});
 assert.equal(place().status,'placed');assert.equal(place().insertBefore,13);assert.equal(place().insertAfter,12);
 const chosen={...w,targetLabelLanguage:'en',baselineSource:{category:'commission-proposal',conflicted:false}};assert.equal(documentContextPlacement({chosen,items,nativeProposalInputs:raw.nativeQuoted.proposalBuffers}).status,'placed','public placement selection forwards request-local bytes');
 assert.equal(resolveProposalPlacement(items,w).status,'unresolved','native proof is mandatory');
 for(const mutate of [a=>a.push(a[1]),a=>a[1].proposal.sourceKind='text',a=>a[0].proposal.paragraphs[0].text='See Annex II.',a=>a[1].proposal.paragraphs[12].complete=false,a=>a[1].proposal.paragraphs[13].source.ordinal++,a=>a[1].proposal.paragraphs[12].properties.numbering.format='decimal',a=>a[1].proposal.paragraphs[12].properties.numberingLabel='-',a=>a[1].proposal.gaps.push({code:'unknown'}),a=>a[1].proposal.anchors.push({paragraph:12,offset:3,note:'x'})]){const a=structuredClone(items);mutate(a);assert.equal(place(a).status,'unresolved',String(mutate));}
 for(const patch of [{language:'fr'},{baseline:'present-text'},{targetLabel:'Annex II – point 3 – indent 6 a (new)'},{targetLabel:'Annex I – point 3 – indent 6 b (new)'},{targetLabel:'Annex I – point 3 – indent 7 a (new)'},{targetLabel:'Annex I – point 4 – indent 6 a (new)'},{originalText:'Existing wording.'}])assert.equal(place(items,{...w,...patch}).status,'unresolved',JSON.stringify(patch));
});

test('the scoped native guard rejects simple fields and unknown inline elements after normal parsing',()=>{
 for(const change of [xml=>xml.replace('<w:r><w:t>Native bullet 4.</w:t></w:r>','<w:fldSimple w:instr="INCLUDETEXT &quot;unavailable.docx&quot;"><w:r><w:t>Native bullet 4.</w:t></w:r></w:fldSimple>'),xml=>xml.replace('Native bullet 4.','<w:unknown/>Native bullet 4.'),xml=>xml.replace('</w:body>','<w:p><w:fldSimple/></w:p></w:body>')]){
  const raw=makeAnnexIndentCase();raw.parts['word/document.xml']=change(raw.parts['word/document.xml']);raw.nativeQuoted.proposalBuffers[1]=fixtureZip(raw.parts);
  const items=raw.items.map((i,index)=>({kind:i.kind,proposal:parseProposal(raw.nativeQuoted.proposalBuffers[index],{item:i.kind})}));
  assert.equal(resolveProposalPlacement(items,raw.wording,{nativeProposalInputs:raw.nativeQuoted.proposalBuffers}).status,'unresolved');
 }
});
// Caption-only repair: source path, underlying act and every cell remain exact.
test('annex caption decoration repair requires both native annex frames and exact cells',()=>{
  const rows=[['ANNEX III','Annexetitre','body'],['The following Annex VIII is added:','Normal','body'],['‘ANNEX VIII','Normal','body'],['Iron and steel','Normal','body'],['CN code','Normal','cell',1,1,1],['Greenhouse gas','Normal','cell',1,1,2],['ex 7204 Ferrous waste','Normal','cell',1,2,1],['Carbon dioxide','Normal','cell',1,2,2],['’','Normal','body']];
  const make=(data=rows)=>parseProposal({paragraphs:data.map(r=>r[0]),structureStatus:'extracted',paragraphSources:data.map((r,index)=>({path:r[2]==='cell'?`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`:`/w:document[1]/w:body[1]/w:p[${index+1}]`,ordinal:index,segment:index,container:r[2]==='cell'?'table-cell':'body',complete:true})),paragraphProperties:data.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(data)},{item:'annex'});
  const act={paragraphs:[{text:'Regulation (EU) 2023/956 is amended as follows:',complete:true,source:{complete:true,container:'body'}}]},p=make(),w={language:'en',baseline:'commission-proposal',targetLabel:'Annex III – paragraph 1 – table on iron and steel\nRegulation (EU) 2023/956\nAnnex VIII – table Iron and Steel',originalText:'‘[Iron and steel\nCN code\tGreenhouse gas\nex 7204 Ferrous waste\tCarbon dioxide',proposedText:'deleted'};
  const run=(wording=w,proposal=p,source=act)=>resolveProposalPlacement([{kind:'act',proposal:source},{kind:'annex',proposal}],wording);
  assert.equal(run().status,'placed');assert.deepEqual(run().span,{start:3,end:7});assert.equal(run().evidence[0].basis,'annex-table-caption-decoration');
  for(const originalText of [w.originalText.replace('ex 7204','7204'),w.originalText.replace('Ferrous waste','Other waste'),w.originalText.replace('Carbon dioxide','Methane'),w.originalText.replace('‘[','['),w.originalText.replace('steel','steel]')])assert.equal(run({...w,originalText}).status,'unresolved');
  for(const targetLabel of [w.targetLabel.replace('Annex VIII','Annex VII'),w.targetLabel.replace('2023/956','2023/957'),w.targetLabel.replace('table Iron and Steel','table Aluminium')])assert.equal(run({...w,targetLabel}).status,'unresolved');
  for(const change of [{language:'fr'},{baseline:'present-text'},{targetPath:{proposal:[{raw:'Annex II – paragraph 1 – table'}]}},{targetPath:{underlying:[{raw:'Annex VII'}]}}])assert.notEqual(run({...w,...change}).status,'placed');
  const duplicate=make(rows.concat(rows.slice(3,8).map(r=>r[2]==='cell'?[r[0],r[1],r[2],2,r[4],r[5]]:r)));assert.equal(run(w,duplicate).status,'unresolved');
  const incomplete=structuredClone(p);incomplete.paragraphs[2].complete=false;assert.equal(run(w,incomplete).status,'unresolved');
  const duplicateAct=structuredClone(act);duplicateAct.paragraphs.push({...act.paragraphs[0],complete:false});assert.equal(run(w,p,duplicateAct).status,'unresolved');
  for(const competing of [[['The following Annex VII is added:','Normal','body'],['‘ANNEX VII','Normal','body']],[['The following Annex VII is added:','Normal','body']],[['‘ANNEX VII','Normal','body']]])assert.equal(run(w,make([...rows.slice(0,3),...competing,...rows.slice(3)])).status,'unresolved');
  const exactRows=rows.map((r,index)=>index===3?['‘[Iron and steel',...r.slice(1)]:r),exact=structuredClone(make(exactRows));assert.equal(run(w,exact).status,'placed');
  const walk=units=>units.flatMap(u=>[u,...walk(u.children)]);walk(exact.units).find(u=>u.table).table.rows[0].cells[0].colSpan=2;assert.equal(run(w,exact).status,'unresolved','an exact caption match cannot bypass malformed geometry');

});

test('a matrix comparison can replace exact table rows inside its named annex point',()=>{
 const rows=[['ANNEX I','Annexetitre','body'],['The annex is amended:','Normal','body'],['(1) Earlier instruction.','Point0','body'],['(2) The table is replaced:','Point0','body'],['CN code','Normal','cell',1,1,1],['Greenhouse gas','Normal','cell',1,1,2],['7314 Metal products','Normal','cell',1,2,1],['Carbon dioxide','Normal','cell',1,2,2],['ANNEX II','Annexetitre','body']];
 const projection={paragraphs:rows.map(r=>r[0]),structureStatus:'extracted',paragraphSources:rows.map((r,ordinal)=>({path:r[2]==='cell'?`/w:document[1]/w:body[1]/w:tbl[${r[3]}]/w:tr[${r[4]}]/w:tc[${r[5]}]/w:p[1]`:`/w:document[1]/w:body[1]/w:p[${ordinal+1}]`,ordinal,segment:ordinal,container:r[2]==='cell'?'table-cell':'body',complete:true})),paragraphProperties:rows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true})),tables:sourceTables(rows)};
 const items=[{kind:'annex',proposal:parseProposal(projection,{item:'annex'})}],w={baseline:'commission-proposal',language:'en',targetLabel:'Annex I – point 2',originalText:'CN code\tGreenhouse gas\n7314 Metal products\tCarbon dioxide',proposedText:'CN code\tGreenhouse gas\n7314 Changed metal products\tCarbon dioxide'};
 const placed=resolveProposalPlacement(items,w);assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:4,end:7});
 assert.equal(resolveProposalPlacement(items,{...w,targetLabel:'Annex I – point 1'}).status,'unresolved');
 assert.equal(resolveProposalPlacement(items,{...w,originalText:w.originalText.replace('7314','7315')}).status,'unresolved');
});

test('ordinal paragraphs in a wholly unnumbered DOCX article require exact whole-row wording',()=>{
 const projection={...source(['Article 16','First unnumbered paragraph.','Second unnumbered paragraph.','Article 17','Next article.'],['Titrearticle','Normal','Normal','Titrearticle','Normal']),sourceKind:'docx'};
 const opts={language:'en',targetLabel:'Article 16 – paragraph 2',originalText:'Second unnumbered paragraph.',proposedText:'Revised second paragraph.'};
 const placed=resolveProposalPlacement([item(projection)],opts);
 assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:2,end:2});
 assert(!resolveProposalPlacement([item(projection)],{...opts,targetLabel:'Article 16 – paragraph 3'}).evidence.some(e=>e.basis==='ordinal-unnumbered-paragraph'));
 assert.equal(resolveProposalPlacement([item(projection)],{...opts,originalText:'Unrelated wording.'}).status,'unresolved');
 projection.paragraphSources[2].complete=false;
 assert.equal(resolveProposalPlacement([item(projection)],opts).status,'unresolved');
});

test('a complete adjacent recital pair survives unrelated later recast numbering damage',()=>{
 const make=()=>({...source(['2025/0001 (COD)','Whereas:','(1) First recital.','(2) Second recital.','(11) Old label.','(11) New label.','HAVE ADOPTED THIS DIRECTIVE:','Article 1']),sourceKind:'docx'});
 const content=make(),placed=resolve(content,'Recital 1 a (new)','','(1a) New recital.');
 assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,3);assert(placed.evidence.some(e=>e.basis==='native-adjacent-recital-boundary'));
 for(const mutate of [p=>p.sourceKind='text',p=>p.paragraphs[3]='(4) Other recital.',p=>p.paragraphs[5]='(1) Duplicate anchor.',p=>p.paragraphSources[3].ordinal++,p=>p.paragraphSources[2].complete=false]){const p=make();mutate(p);assert.equal(resolve(p,'Recital 1 a (new)','','(1a) New recital.').status,'unresolved',String(mutate));}
});

test('preamble citation wording proves comparison notes before matching its legal body',()=>{
 const projection=source(['THE COUNCIL OF THE EUROPEAN UNION,','Having regard to the opinion of the Committee of the Regions,','Whereas:','(1) A recital.'],['Institutionquiagit','Normal','Normal','ManualConsidrant']);
 const proposal=structuredClone(parseProposal(projection)),text=proposal.paragraphs[1].text,at=text.length-1;
 proposal.anchors=[{paragraph:1,offset:at,note:'8',label:'2'}];proposal.notes=[{id:'8',text:'OJ C , , p. .',complete:true}];
 const wording={language:'en',baseline:'commission-proposal',targetLabel:'Citation 1',originalText:text.slice(0,at)+'2 '+text.slice(at)+'\n_________________\n2 OJ C , , p. .',proposedText:'After consulting the Committee of the Regions,\n_________________',originalFormatting:[{kind:'superscript',start:at,end:at+1}]};
 const place=p=>resolveProposalPlacement([{kind:'act',proposal:p}],wording);
 const placed=place(proposal);assert.equal(placed.status,'placed');assert.deepEqual(placed.span,{start:1,end:1});assert.equal(verifyPlacement({items:[{proposal}],wording,placement:placed}).status,'verified');
 for(const change of [a=>a.notes[0].text='Different note.',a=>a.anchors[0].offset--,a=>a.notes[0].complete=false]){const a=structuredClone(proposal);change(a);assert.equal(place(a).status,'unresolved');}
 const changed={...wording,originalFormatting:[]};assert.equal(resolveProposalPlacement([{kind:'act',proposal}],changed).status,'unresolved');
});

test('new quoted subparagraph suffixes use their parent paragraph ordinal',()=>{
 const f=fixture('proposal-quoted-ordinal.json'),wrap=x=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${x}</w:body></w:document>`,buffer=fixtureZip({'word/document.xml':wrap(f.bodyXml)}),proposal=parseProposal(buffer,{language:'en'}),items=[{kind:'act',proposal}];
 for(const suffix of ['a','b']){
  const wording={language:'en',baseline:'commission-proposal',originalText:'',proposedText:'Additional free allocation shall be provided.',targetLabel:'Article 1 – paragraph 1 – point 1',targetPath:{language:'en',proposal:[{raw:'Article 1 – paragraph 1 – point 1'}],underlying:[{document:'Directive 2003/87/EC',raw:'Article 10 a – paragraph 2 a – subparagraph 2 '+suffix+' (new)'}]}},placement=resolveProposalPlacement(items,wording),next=proposal.paragraphs.find(row=>row.text.startsWith('2b.')).index;
  assert.equal(placement.status,'placed');assert.equal(placement.insertBefore,next);assert.equal(placement.insertAfter,next-1);assert.equal(verifyPlacement({items,wording,placement,nativeQuoted:{proposalBuffer:buffer}}).status,'verified');
  for(const modify of [w=>w.targetPath.underlying[0].document='Directive 2000/1/EC',w=>w.targetPath.underlying[0].raw=w.targetPath.underlying[0].raw.replace('subparagraph 2','subparagraph 3')]){const changed=structuredClone(wording);modify(changed);assert.equal(resolveProposalPlacement(items,changed).status,'unresolved');}
 }
});

test('Finnish empty-original printed siblings remain within the exact quoted replacement',()=>{
 const f=fixture('proposal-finnish-sibling.json'),wrap=x=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${x}</w:body></w:document>`,buffer=fixtureZip({'word/document.xml':wrap(f.bodyXml)}),proposal=parseProposal(buffer,{language:'fi'}),items=[{kind:'act',proposal}],inner='20 artikla – 1 a kohta';
 const wording={language:'fi',baseline:'commission-proposal',originalText:'',proposedText:'1 a. Liikenteenharjoittajat voivat täyttää velvoitteensa.',targetLabel:'4 artikla – 1 kohta – 2 alakohta – a alakohta',targetPath:{language:'fi',proposal:[{raw:'4 artikla – 1 kohta – 2 alakohta – a alakohta'}],underlying:[{document:inner,raw:inner}]}};
 const placement=resolveProposalPlacement(items,wording),next=proposal.paragraphs.find(row=>row.text.startsWith('(b)')&&row.text.includes('korvataan 4')).index;
 assert.equal(placement.status,'placed');assert.equal(placement.insertBefore,next);assert.equal(placement.insertAfter,next-1);assert.equal(verifyPlacement({items,wording,placement,nativeQuoted:{proposalBuffer:buffer}}).status,'verified');
 for(const mutate of [a=>a.targetPath.underlying[0].raw='21 artikla – 1 a kohta',a=>a.targetPath.underlying[0].document='Regulation (EU) 999/999',a=>a.proposedText='2 a. Uusi kohta.']){const w=structuredClone(wording);mutate(w);assert.equal(resolveProposalPlacement(items,w).status,'unresolved');}
});

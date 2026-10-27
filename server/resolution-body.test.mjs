import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {motionBodySelection,resolutionSectionHeading} from './resolution-body.mjs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {COMPARISON_HEADINGS} from './amendment-baseline.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/resolution-section-headings.json',import.meta.url)));
const text=paragraphs=>({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:`p[${ordinal}]`,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))});

test('all 24 public discharge headings select only the resolution between decision sections',()=>{
  assert.equal(fixtures.length,24);
  for(const row of fixtures) {
    const {language,decisionHeading,resolutionHeading,decisionOpening,opening,citation}=row;
    const decision=[decisionHeading,decisionOpening,citation,'1. Decision wording;'];
    const resolution=[resolutionHeading,opening,citation,'1. Resolution wording;','2. Final provision;'];
    const contents=[resolutionHeading+'\t7',resolutionHeading,'on discharge\t7'];
    const paragraphs=[...contents,...decision,...resolution,decisionHeading,decisionOpening,citation,'9. Unrelated decision wording;'];
    const expected=contents.length+decision.length+1;
    assert.equal(motionBodySelection(paragraphs,language).start,expected,language);
    assert(resolutionSectionHeading(decisionHeading,language),language);
    assert(!resolutionSectionHeading(decisionHeading+'\t3',language),language);
    const options={language,baseline:'motion-resolution',baselineSource:{conflicted:false,headings:[{left:{raw:COMPARISON_HEADINGS[language]['motion-resolution']}}]},originalText:'1. Resolution wording;',proposedText:'Changed wording;'};
    const placed=resolveAmendmentPlacement(text(paragraphs),options);
    assert.equal(placed.status,'placed',language+': '+placed.reason);
    assert.deepEqual(placed.span,{start:expected+2,end:expected+2},language);
    assert.equal(resolveAmendmentPlacement(text(paragraphs),{...options,originalText:'1. Decision wording;'}).status,'unresolved',language);
    assert.equal(resolveAmendmentPlacement(text(paragraphs),{...options,documentReferences:[{field:'DocAmend',raw:'Proposal for a decision'}]}).status,'unresolved',language);
    assert.equal(motionBodySelection([...decision,...resolution,...resolution],language).start,-1,language);
  }
});

for(const example of JSON.parse(readFileSync(new URL('./fixtures/resolution-language-insertions.json',import.meta.url)))) {
  test(`same public amendment 3 inserts before the next heading in ${example.language}`,()=>{
    const placed=resolveAmendmentPlacement(example.text,example.options);
    assert.equal(placed.status,'placed',placed.reason);
    assert.equal(placed.insertAfter,example.expectedInsertAfter);
    assert.equal(placed.insertBefore,example.expectedInsertAfter+1);
    assert.match(example.text.paragraphs[placed.insertAfter],/^68[.)]\s/u);
    assert(!example.text.paragraphs[placed.insertBefore].startsWith('68'));
  });
}

test('published citation and relative subheading labels use their localized grammar',async()=>{
  const {placementReference}=await import('./document-context-model.mjs');
  const rows=JSON.parse(readFileSync(new URL('./fixtures/resolution-special-labels.json',import.meta.url)));
  for(const row of rows) {
    const citation=row.examples.find(a=>a.number===1),heading=row.examples.find(a=>a.number===6);
    const ref=placementReference(citation.targetLabel,row.language,citation.proposedText);
    assert.equal(ref?.kind,'citation',row.language+': '+citation.targetLabel);
    assert.equal(ref.base,'21',row.language);assert.equal(ref.isNew,true,row.language);
    const after=placementReference(heading.targetLabel,row.language,heading.proposedText);
    if(row.language==='ga')assert.equal(after,null,'the published Irish subparagraph label is a separate source discrepancy');
    else {assert.equal(after?.after,true,row.language+': '+heading.targetLabel);assert.equal(after.base,'25',row.language);}
  }
});

test('published Hungarian and Romanian comparison-heading variants identify resolution text',async()=>{
  const {comparisonHeading}=await import('./amendment-baseline.mjs');
  const rows=JSON.parse(readFileSync(new URL('./fixtures/resolution-comparison-variants.json',import.meta.url)));
  for(const row of rows)for(const label of [row.heading,row.reference])assert.equal(comparisonHeading(label,row.language).category,'motion-resolution',label);
});

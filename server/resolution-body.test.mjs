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
    const options={language,targetLabel:'§ 1',baseline:'motion-resolution',baselineSource:{conflicted:false,headings:[{left:{raw:COMPARISON_HEADINGS[language]['motion-resolution']}}]},originalText:'Resolution wording;',proposedText:'Changed wording;'};
    const placed=resolveAmendmentPlacement(text(paragraphs),options);
    assert.equal(placed.status,'placed',language+': '+placed.reason);
    assert.deepEqual(placed.span,{start:expected+2,end:expected+2},language);
    assert.equal(resolveAmendmentPlacement(text(paragraphs),{...options,originalText:'Decision wording;'}).status,'unresolved',language);
    assert.equal(resolveAmendmentPlacement(text(paragraphs),{...options,documentReferences:[{field:'DocAmend',raw:'Proposal for a decision'}]}).status,'unresolved',language);
    assert.equal(motionBodySelection([...decision,...resolution,...resolution],language).start,-1,language);
  }
});

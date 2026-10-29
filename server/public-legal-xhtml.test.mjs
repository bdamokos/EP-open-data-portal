import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/council-placement-excerpts.json',import.meta.url),'utf8'));
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
const normal=text=>text.replace(/\s+/gu,' ').trim();
const parse=(edition,xhtml=edition.xhtml)=>parsePublicLegalXhtml(xhtml,{language:edition.language,sourceUrl:edition.sourceUrl,coverage:fixture.coverage});
const place=(edition,proposal,amendment)=>documentContextPlacement({chosen:{...amendment,language:edition.language,targetLabelLanguage:edition.language,baseline:'council-position',baselineSource:{category:'council-position',conflicted:false}},items:[{kind:'act',index:1,proposal}]});

for(const edition of fixture.editions)test(`native ${edition.language} Council lists retain complete insertion predecessors and following boundaries`,()=>{
  const proposal=parse(edition);
  assert.equal(proposal.contentComplete,true);
  for(const amendment of edition.amendments){
    const placement=place(edition,proposal,amendment);
    assert.equal(placement.status,'placed',amendment.targetLabel);
    assert.equal(placement.operation,'insert');
    const anchor=flat(proposal.units).find(unit=>unit.id===placement.evidence.at(-1).anchor);
    assert(anchor.complete);
    assert.equal(placement.insertBefore,anchor.extent.end);
    assert.equal(placement.insertAfter,anchor.extent.end-1);
    assert.deepEqual(proposal.paragraphs.slice(anchor.extent.start,anchor.extent.end).map(row=>normal(row.text)),amendment.predecessorRows.map(normal));
    assert.deepEqual(proposal.paragraphs.slice(placement.insertBefore,placement.insertBefore+amendment.followingRows.length).map(row=>normal(row.text)),amendment.followingRows.map(normal));
    if(amendment.number===6||amendment.number===7)assert.deepEqual(anchor.children.map(child=>child.label.value),['i','ii']);
    if(amendment.number===8)assert(placement.evidence.some(row=>row.basis==='xhtml-subparagraph-points'));
  }
});

test('a later XHTML list requires its own complete colon introduction and subparagraph ordinal',()=>{
  const edition=fixture.editions.find(row=>row.language==='en'),amendment=edition.amendments.find(row=>row.number===8);
  const intro='The database shall contain the following information:';
  for(const xhtml of [edition.xhtml.replace(intro,intro.slice(0,-1)+'.'),edition.xhtml.replace(intro,intro+'<img src="unresolved.tif"/>')]){
    assert.equal(place(edition,parse(edition,xhtml),amendment).reason,'source_structure_unavailable');
  }
  for(const ordinal of [1,3,4])assert.equal(place(edition,parse(edition),{...amendment,targetLabel:amendment.targetLabel.replace('subparagraph 2','subparagraph '+ordinal)}).reason,'source_structure_unavailable');
  const proposal=parse(edition);
  proposal.sourceKind='docx';
  assert.equal(place(edition,proposal,amendment).reason,'source_structure_unavailable');
});

test('unsupported objects in the complete predecessor subtree still withhold insertion',()=>{
  const edition=fixture.editions.find(row=>row.language==='hu'),amendment=edition.amendments.find(row=>row.number===6);
  const wording='az NGT növény megfelel';
  assert(edition.xhtml.includes(wording));
  const proposal=parse(edition,edition.xhtml.replaceAll(wording,wording+'<img src="unresolved.tif"/>'));
  assert.equal(place(edition,proposal,amendment).reason,'source_passage_incomplete');
});

test('two-column grids and prose labels remain unsupported tables',()=>{
  for(const label of ['a) explanatory text','(a','a']){
    const xhtml=`<html><body><div id="art_1"><table><tr><td><p>${label}</p></td><td><p>Body</p></td></tr></table></div></body></html>`;
    const proposal=parsePublicLegalXhtml(xhtml);
    assert(proposal.gaps.some(gap=>gap.code==='unsupported-xhtml-table'));
    assert.equal(flat(proposal.units).some(unit=>unit.kind==='point'),false);
  }
  const proposal=parsePublicLegalXhtml('<html><body><div id="art_1"><table><tr><td><p>a)</p></td><td><p>Body</p></td></tr><tr><td><p>b)</p></td><td><p>Body</p></td></tr></table></div></body></html>');
  assert(proposal.gaps.some(gap=>gap.code==='unsupported-xhtml-table'));
});

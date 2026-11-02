import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal,parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/proposal-quoted-interior.json',import.meta.url)));
const amendment=fixture.amendments.find(value=>value.number===18);
const items=projection=>[{kind:'act',index:1,proposal:parseProposal(projection,{language:'en',sourceUrl:fixture.proposal.source.url})}];
const resolve=(projection=fixture.proposal,chosen=amendment)=>resolveProposalPlacement(items(projection),chosen);

test('ETS AM18 preserves the published spaced target and compact proposed label',()=>{
  const raw=amendment.targetPath.underlying[0].raw;
  assert.equal(raw,'Article 10a – paragraph 2a a (new)');
  assert(amendment.proposedText.startsWith('2aa.\tBy way of derogation'));
  const parsed=parseTargetLabel(raw,'en');
  assert.equal(parsed.complete,true);
  assert.deepEqual(parsed.segments.map(({kind,value,suffix})=>({kind,value,suffix})),[
    {kind:'article',value:'10a',suffix:'a'},
    {kind:'paragraph',value:'2aa',suffix:'aa'},
  ]);
  const placed=resolve();
  assert.equal(placed.evidence.find(value=>value.basis==='quoted-target-path').label,raw);
  assert.equal(amendment.targetPath.underlying[0].raw,raw);
});

test('ETS AM18 inserts after both native paragraphs of 2a and before existing 2b',()=>{
  const [item]=items(fixture.proposal),placed=resolveProposalPlacement([item],amendment);
  assert.equal(placed.status,'placed');assert.equal(placed.operation,'insert');
  assert.equal(placed.itemIndex,0);assert.equal(placed.insertAfter,5);assert.equal(placed.insertBefore,6);
  assert.equal(item.proposal.paragraphs[5].source.path,fixture.nativeBoundary.predecessor[1]);
  assert.equal(item.proposal.paragraphs[6].source.path,fixture.nativeBoundary.following);
  assert.equal(item.proposal.paragraphs[8].source.path,fixture.nativeBoundary.quoteEnd);
  const outer=proposalCandidates(item.proposal,amendment.targetPath.proposal[0].raw)[0];
  const quote=outer.children.find(unit=>unit.kind==='quotation');
  const [before,after]=quote.children;
  assert.deepEqual(before.extent,{start:4,end:6});
  assert.equal(before.children[0].extent.start,5);
  assert.equal(after.label.value,'2b');assert.equal(after.extent.start,6);
  assert.equal(quote.complete,true);assert(placed.insertBefore<quote.extent.end);
  const boundary=placed.evidence.find(value=>value.basis==='quoted-interior-sibling-boundary');
  assert.equal(boundary.owner,outer.id);assert.equal(boundary.anchor,before.id);assert.equal(boundary.following,after.id);
  assert.equal(placed.evidence.find(value=>value.basis==='quoted-act-owner').label,'Directive 2003/87/EC');
  assert.equal(proposalCandidates(item.proposal,'Article 10a – paragraph 2a').length,0);
});

test('ETS AM14 and AM15 follow the whole quoted 2b, before its asterisk note',()=>{
  // The quote closes after 2b's own note (rule, then '*' row). A new sibling
  // follows the provision text; AM14 (2bb) anchors on 2b, not on AM15's 2ba.
  for(const chosen of fixture.amendments.filter(value=>value.number!==18)){
    const placed=resolve(fixture.proposal,chosen);
    assert.equal(placed.status,'placed','AM'+chosen.number);
    assert.equal(placed.insertAfter,6);assert.equal(placed.insertBefore,7);
    assert(placed.evidence.some(value=>value.basis==='whole-quoted-sibling'));
  }
  assert(fixture.amendments.find(value=>value.number===14).proposedText.startsWith('2bb.'));
  assert(fixture.amendments.find(value=>value.number===15).proposedText.startsWith('2ba.'));
  assert(fixture.proposal.paragraphs[7].startsWith('______'));
  assert(fixture.proposal.paragraphs[8].endsWith('’'));
});

test('the native 2a continuation and complete quote remain mandatory',()=>{
  for(const index of [5,8]){
    const projection=structuredClone(fixture.proposal);
    projection.paragraphSources[index].complete=false;
    assert.equal(resolve(projection).reason,'source_passage_incomplete');
  }
  const projection=structuredClone(fixture.proposal);
  // Omit native p73 while preserving the surviving source ordinals.
  for(const field of ['paragraphs','paragraphSources','paragraphProperties','paragraphFormats'])projection[field].splice(5,1);
  assert.equal(resolve(projection).reason,'source_structure_unavailable');
});

test('without the inner address only the printed whole-sibling rule applies, at the same boundary',()=>{
  // The instruction names 2a and 2b; the printed 2aa follows the whole of 2a.
  for(const change of [chosen=>{delete chosen.targetPath.underlying;},chosen=>{chosen.targetPath.language='fr';}]){
    const chosen=structuredClone(amendment);change(chosen);
    const placed=resolve(fixture.proposal,chosen);
    assert.equal(placed.insertBefore,6);
    assert(!placed.evidence.some(value=>value.basis==='quoted-interior-sibling-boundary'));
    assert(placed.evidence.some(value=>value.basis==='whole-quoted-sibling'));
  }
});

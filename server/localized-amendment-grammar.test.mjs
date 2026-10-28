import{test}from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{parseTargetLabel,unitLabel}from'./proposal-labels.mjs';
import{placementReference}from'./document-context-model.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));

test('the same published title/introductory selectors parse in all 24 languages',()=>{
  const rows=fixture('proposal-selector-labels.json');assert.equal(rows.length,24);
  for(const row of rows)for(const amendment of row.amendments){
    const label=amendment.targetLabel.split('\n').at(-1),target=parseTargetLabel(label,row.language);
    assert(target.complete,`${row.language}: ${label}: ${target.unparsed}`);
    assert.equal(target.segments.at(-1).kind,amendment.number===15?'title':'introductory-part',`${row.language}: ${label}`);
    if(amendment.number===12)assert.equal(target.segments.at(-2).kind,row.language==='fi'?'point':'subparagraph');
    assert.equal(target.raw,label);
  }
});
test('published citation and relative subheading selectors retain their list-language roles',()=>{
  for(const row of fixture('resolution-special-labels.json')){
    const citation=row.examples.find(a=>a.number===1),heading=row.examples.find(a=>a.number===6);
    const ref=placementReference(citation.targetLabel,row.language,citation.proposedText);
    assert.equal(ref?.kind,'citation',row.language+': '+citation.targetLabel);assert.equal(ref.base,'21');assert.equal(ref.isNew,true);
    const after=placementReference(heading.targetLabel,row.language,heading.proposedText);
    if(row.language==='ga')assert.equal(after,null,'the actual Irish address names a new first subparagraph, not a relative heading');
    else{assert.equal(after?.after,true,row.language+': '+heading.targetLabel);assert.equal(after.base,'25');}
  }
});
test('published bare-annex targets are distinct from numbered annexes in all 24 languages',()=>{
  const rows=fixture('unnumbered-annex-targets.json');assert.equal(rows.length,24);
  for(const row of rows){const target=parseTargetLabel(row.targetLabel,row.language);assert(target.complete,row.language+': '+target.unparsed);assert.equal(target.segments[0].kind,'annex');assert.equal(target.segments[0].value,'');assert.equal(target.segments.at(-1).kind,'point');assert.equal(target.segments.at(-1).value,'1');}
});
test('negative Hungarian and Latvian values retain terminal-dot round trips within their parent address',()=>{
  for(const language of['hu','lv']){const label=unitLabel({kind:'point',value:'-1',negative:true,isNew:true},language),annex=language==='hu'?'Melléklet':'Pielikums',target=parseTargetLabel(annex+' – '+label,language);assert(target.complete);assert.equal(target.segments.at(-1).value,'-1');assert.equal(target.segments.at(-1).negative,true);}
});

test('the real Greek recital 3 alpha insertion follows complete source recital 3',async()=>{
  const {parseProposal}=await import('./proposal-structure.mjs'),{resolveProposalPlacement}=await import('./proposal-placement.mjs'),row=fixture('greek-proposal-insertion.json');
  const proposal=parseProposal(row.input,{language:'el',item:'act',sourceUrl:row.source.url});
  const result=resolveProposalPlacement([{kind:'act',index:1,proposal}],row.amendment);
  assert.equal(result.status,'placed',result.reason);assert.equal(result.insertBefore,2);assert.match(proposal.paragraphs[1].text,/^\(3\)/);assert.match(proposal.paragraphs[2].text,/^\(4\)/);
});
test('Greek published Latin B aliases only the verified second Greek ordinal',async()=>{
  const {resolveAmendmentPlacement}=await import('./document-context-model.mjs'),row=fixture('greek-resolution-ordinal-alias.json');
  for(const amendment of row.amendments){
    assert.equal(placementReference(amendment.targetLabel,'el',amendment.proposedText).base,'B','source-independent parsing preserves the published Latin letter');
    const placed=resolveAmendmentPlacement(row.text,{...amendment,resolutionDocument:true});assert.equal(placed.status,'placed',placed.reason);assert.equal(placed.insertAfter,row.expectedInsertAfter);
    assert(placed.evidence.some(x=>x.basis==='published-ordinal-alias'&&x.publishedLabel.startsWith('B')&&x.sourceLabel.startsWith('Β')&&x.ordinal===2));
    const differentConvention={...row.text,paragraphs:row.text.paragraphs.map((x,i)=>i===2?x.replace(/^Α/,'A'):x)};
    assert.equal(resolveAmendmentPlacement(differentConvention,{...amendment,resolutionDocument:true}).status,'unresolved');
  }
});


test('published letter-base Latin suffixes and Portuguese hyphen suffixes retain recital parents',()=>{
  for(const row of fixture('resolution-special-labels.json').filter(x=>['fr','es','it','nl','pt'].includes(x.language)))for(const n of[2,3]){
    const example=row.examples.find(x=>x.number===n),ref=placementReference(example.targetLabel,row.language,example.proposedText);
    assert.equal(ref?.kind,'recital',row.language+': '+example.targetLabel);assert.equal(ref.base,'B');assert(ref.suffix);assert.equal(ref.isNew,true);
  }
});

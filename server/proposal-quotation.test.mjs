import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal} from './proposal-structure.mjs';
import {instructionOperation} from './proposal-instructions.mjs';
const {examples}=JSON.parse(readFileSync(new URL('./fixtures/proposal-quotation-excerpts.json',import.meta.url)));
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
for(const example of examples)test(`COM(2024)183 ${example.language}: ${example.name}`,()=>{
  const proposal=parseProposal(example,example),units=flat(proposal.units);
  assert.deepEqual(units.filter(u=>u.kind==='point'&&u.scope==='proposal'&&u.path.length===3).map(u=>u.label.value),example.outerPoints);
  assert.deepEqual(units.filter(u=>u.kind==='article'&&u.scope==='proposal').map(u=>u.label.value),example.name==='final-missing-delimiter'?['1','2']:['1']);
  assert(!proposal.gaps.some(g=>g.code==='unclosed-quotation'));
  const quotes=units.filter(u=>u.kind==='quotation');assert(quotes.length);
  for(const quote of quotes){assert(quote.instructionPath.length);assert(flat(quote.children).every(u=>u.scope==='quoted'));}
  if(example.name==='article-insertion'){
    const quote=quotes[0],owner=units.find(u=>u.id===quote.id.slice(0,quote.id.lastIndexOf('/')));
    assert.deepEqual(quote.instructionPath.map(s=>s.value),['1','1','3']);
    assert.equal(quote.extent.end,example.paragraphs.length-1);
    assert(units.some(u=>u.kind==='article'&&u.scope==='quoted'));
    assert.equal(owner?.label.value,'3');
  }
  if(example.name==='swedish-heading-reference'){
    const articles=units.filter(u=>u.kind==='article'&&u.scope==='quoted');
    assert.deepEqual(articles.map(u=>u.label.value),['75a','75b','75c','75d','75e','75f','75g']);
    assert(articles.every(u=>u.instructionPath.at(-1).value==='37'));
  }
  if(example.name==='premature-delimiter'){
    const article=units.find(u=>u.kind==='article'&&u.scope==='quoted');
    assert.equal(article.extent.end,example.sourceParagraphIndices.indexOf(684));
    assert(units.filter(u=>u.extent.start>=example.sourceParagraphIndices.indexOf(680)&&u.extent.start<example.sourceParagraphIndices.indexOf(684)).every(u=>u.scope==='quoted'));
  }
});

const boundaries=JSON.parse(readFileSync(new URL('./fixtures/proposal-instruction-boundaries.json',import.meta.url)));
for(const example of boundaries.examples)test(`COM(2024)183 ${example.language}: recover instruction ${example.recoveredInstruction} after an omitted closer`,()=>{
  const proposal=parseProposal(example,example),units=flat(proposal.units);
  const points=units.filter(u=>u.kind==='point'&&u.scope==='proposal'&&u.path.length===3);
  assert.deepEqual(points.map(u=>u.label.value),example.outerPoints);
  const recovered=points.find(u=>u.label.value===example.recoveredInstruction);
  const start=example.sourceParagraphIndices.indexOf(example.recoveredSourceOrdinal);
  const end=example.sourceParagraphIndices.indexOf(example.followingSourceOrdinal);
  assert.equal(instructionOperation(example.paragraphs[start],example.language),example.recoveredOperation);
  assert.equal(recovered.instruction.operation,example.recoveredOperation);
  assert.deepEqual(recovered.extent,{start,end});
  const prior=points[0],quotes=flat(prior.children).filter(u=>u.kind==='quotation');
  const lastQuote=quotes.at(-1);
  assert.equal(lastQuote.extent.end,start);
  assert.equal(lastQuote.closingBoundaryBasis,'instruction-sequence');
  assert(!units.some(u=>u.scope==='quoted'&&u.extent.start<start&&u.extent.end>start));
  assert(units.filter(u=>u.kind==='quotation'&&u.extent.start>=start&&u.extent.start<end)
    .every(u=>u.instructionPath[2].value===example.recoveredInstruction));
  assert.deepEqual(units.filter(u=>u.kind==='article'&&u.scope==='proposal').map(u=>u.label.value),['1']);
  assert(!proposal.gaps.some(g=>g.code==='unclosed-quotation'));
});

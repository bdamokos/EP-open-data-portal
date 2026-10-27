import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal} from './proposal-structure.mjs';
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/proposal-same-style-instructions.json',import.meta.url)));
const parse=input=>parseProposal(input,{language:fixture.language,sourceUrl:fixture.sourceUrl});
const proposal=parse(fixture),items=[{kind:'act',proposal}];
const point=value=>proposalCandidates(proposal,`Article 1 – paragraph 1 – point ${value}`)[0];
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);

test('COM(2025)836 retains all five same-style instructions inside outer point 17',()=>{
  const owner=point('17'),next=point('18');
  const children=owner.children.filter(unit=>unit.kind==='point');
  assert.deepEqual(children.map(unit=>unit.label.value),['a','b','c','d','e']);
  assert.equal(owner.extent.end,next.extent.start);
  assert.equal(proposal.paragraphs[children[0].extent.start].source.path,'/w:document[1]/w:body[1]/w:p[217]');
  assert.equal(proposal.paragraphs[children.at(-1).extent.end-1].source.path,'/w:document[1]/w:body[1]/w:p[226]');
  for(const [index,child] of children.entries()){
    assert.equal(child.scope,'proposal');assert.equal(child.pathConflict,false);
    assert.equal(child.label.hierarchyBasis,'amending-instruction');
    assert.equal(child.extent.end,children[index+1]?.extent.start??next.extent.start);
    assert.match(proposal.paragraphs[child.extent.end-1].text,/’;/u);
    for(const unit of flat(child.children).filter(unit=>unit.scope==='quoted'))assert.deepEqual(unit.instructionPath,child.path);
  }
});

test('the repeated numeric owners keep distinct complete lettered instruction groups',()=>{
  for(const [value,labels] of [['7',['a','b','c']],['17',['a','b','c','d','e']],['19',['a','b']],['22',['a','b']],['25',['a','b','c']],['26',['a','b','c']],['29',['a','b']],['30',['a','b']],['31',['a','b']]]){
    const owner=point(value),children=owner.children.filter(unit=>unit.kind==='point');
    assert.deepEqual(children.map(unit=>unit.label.value),labels,`outer ${value}`);
    assert(children.every(unit=>unit.path.slice(0,-1).every((segment,index)=>segment.value===owner.path[index].value)));
    assert.equal(owner.extent.end,point(String(Number(value)+1)).extent.start,`outer ${value} ends at its numeric sibling`);
  }
  const quoted=flat(point('18').children).filter(unit=>unit.kind==='point');
  assert(quoted.length);assert(quoted.every(unit=>unit.scope==='quoted'&&JSON.stringify(unit.instructionPath)===JSON.stringify(point('18').path)));
});

for(const amendment of fixture.amendments)test(`native original and owning instruction: ${amendment.id}`,()=>{
  const result=resolveProposalPlacement(items,amendment);
  assert.equal(result.status,'placed',result.reason);assert.equal(result.operation,amendment.expectedOperation);
  assert.deepEqual(proposal.paragraphs.slice(result.span.start,result.span.end+1).map(p=>p.source.path),amendment.expectedSourcePaths);
});

for(const amendment of fixture.negatives)test(`published drafting instruction: ${amendment.id}`,()=>{
  const result=resolveProposalPlacement(items,amendment);
  const owner=proposalCandidates(proposal,amendment.targetLabel.split('\n')[0])[0];
  assert.equal(result.status,'placed',result.reason);
  if(/^[-−]1\./u.test(amendment.proposedText)){
    assert.equal(result.operation,'insert');assert.equal(result.insertAfter,owner.extent.start);assert.equal(result.insertBefore,owner.extent.start+1);
  }else{
    assert.equal(result.operation,'delete');assert.deepEqual(result.span,{start:owner.extent.start,end:owner.extent.end-1});
    assert.equal(result.splice.start.offset,0);assert.equal(result.splice.end.offset,proposal.paragraphs[owner.extent.end-1].text.length);
    if(!amendment.originalText.includes('[...]'))assert.equal(result.evidence.at(-1).matchKind,'similar');
  }
});

test('same-style recovery leaves explicit Word list levels authoritative',()=>{
  const input=structuredClone(fixture),index=input.paragraphSources.findIndex(p=>p.path==='/w:document[1]/w:body[1]/w:p[217]');
  input.paragraphProperties[index].numbering={level:1,format:'lowerLetter'};
  const numbered=parse(input),owner=proposalCandidates(numbered,'Article 1 – paragraph 1 – point 17')[0];
  assert(!owner.children.some(unit=>unit.kind==='point'&&unit.label.value==='a'));
});

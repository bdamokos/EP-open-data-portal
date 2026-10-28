import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/proposal-implicit-article-paragraph.json',import.meta.url)));
const proposal=parseProposal(fixture.proposal,{language:'it'});
const resolve=(amendment,parsed=proposal)=>resolveProposalPlacement([{kind:'act',proposal:parsed}],amendment);

test('published Italian instruction addresses traverse the single unnumbered article paragraph',()=>{
  for(const amendment of fixture.amendments){
    const placed=resolve(amendment);
    assert.equal(placed.status,'placed',`AM${amendment.number}: ${placed.reason}`);
    assert(placed.evidence.some(e=>e.basis==='implicit-paragraph'));
    if(amendment.number===17||amendment.number===19){
      const preceding=amendment.number===17?'2':'3';
      const anchor=proposalCandidates(proposal,`Articolo 1 – paragrafo 1 – punto ${preceding}`)[0];
      assert.equal(placed.operation,'insert');
      assert.equal(placed.insertBefore,anchor.extent.end);
      assert.equal(placed.insertAfter,anchor.extent.end-1);
    }else{
      assert.equal(placed.operation,'replace');
      assert(placed.span.start>=2&&placed.span.end<fixture.proposal.paragraphs.length-1);
      const explicit={...amendment,targetLabel:amendment.targetLabel.replace('Articolo 1 – ','Articolo 1 – paragrafo 1 – ')};
      const control=resolve(explicit);
      assert.deepEqual(placed.splice,control.splice);
      assert.equal(placed.originalText,control.originalText);
    }
  }
});

test('omitted implicit levels retain exact wording, source labels and unique article ownership',()=>{
  const amendment=fixture.amendments.find(a=>a.number===16);
  assert.notEqual(resolve({...amendment,originalText:amendment.originalText+' Additional words.'}).status,'placed');
  assert.notEqual(resolve({...amendment,targetLabel:'Articolo 1 – punto 99',originalText:amendment.originalText}).status,'placed');
  const duplicate=structuredClone(proposal);duplicate.units.push(structuredClone(duplicate.units.find(u=>u.kind==='body')));
  assert.notEqual(resolve(amendment,duplicate).status,'placed');
  const article=proposalCandidates(proposal,'Articolo 1')[0];
  const explicit=structuredClone(proposal);
  const explicitArticle=proposalCandidates(explicit,'Articolo 1')[0];
  explicitArticle.children.find(u=>u.kind==='paragraph').implicit=false;
  assert(!resolve(amendment,explicit).evidence.some(e=>e.basis==='implicit-paragraph'));
  assert.notEqual(resolve({...amendment,targetLabel:'Articolo 1 – paragrafo 2 – punto 2 bis (nuovo)',originalText:''}).status,'placed');
  assert(article.children.some(u=>u.kind==='paragraph'&&u.implicit));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
import {verifyLanguagePlacement} from './amendment-language-oracle.mjs';

const {examples}=JSON.parse(readFileSync(new URL('./fixtures/amendment-oracle-parity-excerpts.json',import.meta.url)));
for(const example of examples)test(`published ${example.language} parity oracle: ${example.targetLabel}`,()=>{
  const rows=example.paragraphs.map((row,index)=>({index,text:row.text,source:{path:row.path,container:row.body?'body':'table',complete:true},properties:{styleId:row.style},complete:true}));
  // Neither production ownership nor the placer's anchor evidence is available.
  const proposal={sourceKind:'docx',paragraphs:rows,get units(){throw Error('Production tree read');}};
  const wording={...example,sectionKind:'commission-proposal',operation:'replace',proposedText:'Changed wording.'};
  const at=example.selected;
  const placement={status:'placed',operation:'replace',itemIndex:0,span:{start:at,end:at},splice:{start:{paragraph:at,offset:0},end:{paragraph:at,offset:rows[at].text.length}}};
  assert.equal(rawProposalAssertion({proposal,wording,placement}).status,'verified');
  if(example.language==='ga'){
    assert.equal(rawProposalAssertion({proposal,wording,placement:{...placement,span:{start:3,end:3}}}).status,'failed','a quoted numbered instruction cannot become the annex introduction');
    assert.equal(rawProposalAssertion({proposal,wording:{...wording,targetLabel:'Iarscríbhinn – pointe 2'},placement}).status,'failed');
  }else{
    const text={paragraphs:rows.map(row=>row.text),paragraphSources:rows.map(row=>row.source)};
    const raw={paragraphs:example.paragraphs};
    const result=verifyLanguagePlacement({expected:wording,placement,text,items:[{proposal}],rawItems:[raw]});
    assert.equal(result.status,'verified',result.reason);
    assert.equal(verifyLanguagePlacement({expected:{...wording,originalText:wording.originalText+' Other words.'},placement,text,items:[{proposal}],rawItems:[raw]}).status,'failed');
  }
});

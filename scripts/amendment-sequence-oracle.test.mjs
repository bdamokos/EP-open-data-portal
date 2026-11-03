import test from 'node:test';
import assert from 'node:assert/strict';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

const proposal=rows=>({sourceKind:'docx',units:[{poison:'The oracle must not inspect the placer tree'}],paragraphs:rows.map(([text,styleId],index)=>({index,text,properties:{styleId},source:{container:'body',complete:true},complete:true}))});
const insert=before=>({status:'placed',operation:'insert',insertAfter:before-1,insertBefore:before});
const amendment=targetLabel=>({targetLabel,originalText:'',proposedText:'New wording.',language:'en',baseline:'commission-proposal'});

test('new Roman points under a childless lettered point end that point', () => {
  const p=proposal([['Article 7','Titrearticle'],['The Programme shall support:','Normal'],['(a) Experimentation;','Point2'],['(b) Implementation;','Point2'],['(c) Dissemination.','Point2'],['Article 8','Titrearticle']]);
  for(const label of ['i','ii','iii'])assert.equal(rawProposalAssertion({proposal:p,wording:amendment(`Article 7 – paragraph 1 – point a – point ${label} (new)`),placement:insert(3)}).status,'verified',label);
  assert.equal(rawProposalAssertion({proposal:p,wording:amendment('Article 7 – paragraph 1 – point a – point ii (new)'),placement:insert(4)}).status,'failed');
  const flattened=proposal([['Article 4','Titrearticle'],['4. Lead:','ManualNumPar1'],['(a) First:','Point1'],['(i) Existing child;','Point1'],['(b) Last.','Point1'],['Article 5','Titrearticle']]);
  assert.notEqual(rawProposalAssertion({proposal:flattened,wording:amendment('Article 4 – paragraph 4 – point a – point ii (new)'),placement:insert(3)}).status,'verified');
  const afterH=proposal([['Article 4','Titrearticle'],['4. Lead:','ManualNumPar1'],...'abcdefg'.split('').map(l=>[`(${l}) Point;`,'Point1']),['(h) Last parent:','Point1'],['(i) Existing child;','Point1'],['Article 5','Titrearticle']]);
  assert.notEqual(rawProposalAssertion({proposal:afterH,wording:amendment('Article 4 – paragraph 4 – point h – point ii (new)'),placement:insert(10)}).status,'verified');
});

const resolution=paragraphs=>({paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0})),paragraphFormats:paragraphs.map(()=>({}))});
const recital=(proposedText,placement,rows=['The European Parliament,','–\thaving regard to Rule 136(2),','A.\twhereas one;','B.\twhereas two;','1.\tWelcomes;','2.\tInstructs.'])=>
  verifyPlacement({text:resolution(rows),wording:{targetLabel:'Recital C (new)',originalText:'',proposedText,language:'en',baseline:'motion-resolution'},placement});

test('a new recital continuing the raw sequence follows the last recital', () => {
  assert.deepEqual(recital('C.\twhereas three;',insert(4)),{status:'verified',reason:'oracle-recital-body-boundary'});
  assert.equal(recital('C.\twhereas three;',insert(3)).status,'failed');
  assert.equal(recital('D.\twhereas three;',insert(4)).status,'verified');
  assert.equal(recital('C.\twhereas three;',insert(4),['The European Parliament,','A.\twhereas one;','1.\tWelcomes;','2.\tInstructs.']).status,'failed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

const resolution=paragraphs=>({paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0})),paragraphFormats:paragraphs.map(()=>({}))});
const insert=before=>({status:'placed',operation:'insert',insertAfter:before-1,insertBefore:before});
const wording=(targetLabel,proposedText,language='en')=>({targetLabel,originalText:'',proposedText,language,baseline:'motion-resolution'});
const motion=['The European Parliament,','–\thaving regard to its earlier resolution,','A.\twhereas one;','B.\twhereas two;','General considerations','1.\tStresses one;','(a)\tfirst point;','(b)\tsecond point;','2.\tStresses two;','3.\tInstructs its President.'];

test('a negative first paragraph goes immediately before paragraph 1, after any opening heading', () => {
  const text=resolution(motion);
  for(const [label,printed] of [['Paragraph -1 (new)','-1.\tNew text;'],['Paragraph −1 a (new)','−1a.\tNew text;'],['Paragraph -1','–\t1. New text;']])
    assert.deepEqual(verifyPlacement({text,wording:wording(label,printed),placement:insert(5)}),{status:'verified',reason:'oracle-negative-first-boundary'},label);
  assert.equal(verifyPlacement({text,wording:wording('Paragraph -1 (new)','-1.\tNew text;'),placement:insert(4)}).status,'failed');
  assert.equal(verifyPlacement({text,wording:wording('Paragraph -1 (new)','1.\tNew text;'),placement:insert(5)}).status,'unverified');
});

test('negative first recitals and points use the first sibling of their kind', () => {
  const text=resolution(motion);
  assert.equal(verifyPlacement({text,wording:wording('Recital -A (new)','-A.\twhereas new;'),placement:insert(2)}).status,'verified');
  assert.equal(verifyPlacement({text,wording:wording('Paragraph 1 – point ‑a (new)','(-a)\tnew point;'),placement:insert(6)}).status,'verified');
  assert.equal(verifyPlacement({text,wording:wording('Paragraph 1 – point ‑a (new)','(-a)\tnew point;'),placement:insert(5)}).status,'failed');
  assert.equal(verifyPlacement({text,wording:wording('Paragraph 2 – point ‑a (new)','(-a)\tnew point;'),placement:insert(9)}).status,'unverified');
});

test('a recital A after the operative paragraphs never anchors a negative recital', () => {
  const text=resolution(['The European Parliament,','–\thaving regard to its rules,','Section III – Commission','1.\tRecalls one;','2.\tRecalls two;','OPINION','A.\twhereas the opinion;']);
  assert.equal(verifyPlacement({text,wording:wording('Recital -A (new)','-A.\twhereas new;'),placement:insert(6)}).status,'unverified');
});

test('an incomplete earlier first label withholds verification', () => {
  const text=resolution(['The European Parliament,','A.\twhereas one;','1.\tEarlier first \uFFFC;','Heading','1.\tComplete first;','2.\tSecond.']);
  text.paragraphSources[2].complete=false;
  assert.notEqual(verifyPlacement({text,wording:wording('Paragraph -1 (new)','-1.\tNew;'),placement:insert(4)}).status,'verified');
});

test('an incomplete earlier parent paragraph withholds a negative point', () => {
  const text=resolution(['The European Parliament,','A.\twhereas one;','1.\tEarlier first \uFFFC;','Heading','1.\tComplete first:','(a)\tfirst point;','(b)\tsecond point;','2.\tSecond.']);
  text.paragraphSources[2].complete=false;
  assert.notEqual(verifyPlacement({text,wording:wording('Paragraph 1 – point ‑a (new)','(-a)\tnew point;'),placement:insert(5)}).status,'verified');
});


test('negative first boundaries inspect incomplete owners before the first recognised unit', () => {
  for(const point of [false,true]) {
    const rows=['The European Parliament,','1.\tEarlier first \uFFFC;','Heading','1.\tComplete first:','(a)\tfirst point;','(b)\tsecond point;','2.\tSecond.'];
    const text=resolution(rows);text.paragraphSources[1].complete=false;
    const label=point?'Paragraph 1 – point ‑a (new)':'Paragraph -1 (new)';
    const proposed=point?'(-a)\tnew point;':'-1.\tNew;';
    assert.equal(verifyPlacement({text,wording:wording(label,proposed),placement:insert(point?4:3)}).status,'unverified');
  }
});

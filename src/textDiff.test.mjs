import test from 'node:test';
import assert from 'node:assert/strict';
import {textDiff,TEXT_DIFF_LIMITS} from './textDiff.mjs';

function lossless(original,proposed,language) {
  const result=textDiff(original,proposed,language);
  assert.equal(result.status,'ok');
  assert.equal(result.segments.filter(segment=>segment.type!=='insert').map(segment=>segment.text).join(''),original);
  assert.equal(result.segments.filter(segment=>segment.type!=='delete').map(segment=>segment.text).join(''),proposed);
  assert(result.similarity>=0&&result.similarity<=1);
  for(let i=0;i<result.segments.length;i++) {
    assert(result.segments[i].text.length>0);
    assert.notEqual(result.segments[i].type,result.segments[i-1]?.type);
  }
  return result;
}
test('word replacements, insertions, deletions, punctuation and identical text are lossless',()=>{
  assert.deepEqual(lossless('The old rule.','The new rule.','en').segments,[{type:'equal',text:'The '},{type:'delete',text:'old'},{type:'insert',text:'new'},{type:'equal',text:' rule.'}]);
  assert.deepEqual(lossless('','New wording').segments,[{type:'insert',text:'New wording'}]);
  assert.deepEqual(lossless('Deleted wording','').segments,[{type:'delete',text:'Deleted wording'}]);
  const punctuation=lossless('Hello, world!','Hello; world?');
  assert.deepEqual(punctuation.segments.filter(segment=>segment.type==='insert').map(segment=>segment.text),[';','?']);
  assert.equal(lossless('Identical\ttext.\n','Identical\ttext.\n').similarity,1);
  assert.deepEqual(lossless('','').segments,[]);
  assert.equal(lossless('old','new').similarity,0);
});
test('whitespace-only equal runs between changes are highlighted without losing either side',()=>{
  const result=lossless('old\t phrase\nend','new\t words\nend');
  assert(!result.segments.some(segment=>segment.type==='equal'&&/^\s+$/.test(segment.text)));
  assert(result.segments.some(segment=>segment.type==='delete'&&segment.text.includes('\t')));
  assert(result.segments.some(segment=>segment.type==='insert'&&segment.text.includes('\t')));
});
test('Greek, Bulgarian, combining marks, emoji, CRLF and non-breaking spaces retain exact source text',()=>{
  lossless('Η παλιά πολιτική.','Η νέα πολιτική!','el');
  lossless('Обща стара политика.','Обща нова политика.','bg');
  lossless('Cafe\u0301\r\n\u00a0👩‍💻 «a»','Café\r\n \t👩‍💻 «b»','fr');
});
test('regex fallback works with an unavailable Segmenter and invalid source language',t=>{
  t.mock.method(Intl,'Segmenter',undefined);
  lossless('Стар текст\n','Нов текст\t','bg');
  lossless('a  b!','a b?','not_a_language');
});
test('character, token and edit-distance budgets return an explicit fallback',()=>{
  const {characters,tokens,editDistance}=TEXT_DIFF_LIMITS;
  assert.deepEqual(textDiff('x'.repeat(characters+1),'x'),{status:'too-large'});
  assert.deepEqual(textDiff('x','x'.repeat(characters+1)),{status:'too-large'});
  assert.deepEqual(textDiff('.'.repeat(tokens+1),'.'),{status:'too-large'});
  assert.deepEqual(textDiff('.','.'.repeat(tokens+1)),{status:'too-large'});
  assert.deepEqual(textDiff('a '.repeat(editDistance),'b '.repeat(editDistance)),{status:'too-large'});
  lossless('x'.repeat(characters),'x'.repeat(characters));
  lossless('.'.repeat(tokens),'.'.repeat(tokens));
});
test('seeded property cases reconstruct arbitrary Unicode and whitespace on both sides',()=>{
  let seed=0x12ab34cd;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const alphabet=['alpha','βήτα','дума','e\u0301','😀','👩‍💻','\ud800',' ','  ','\t','\r\n','\u00a0','.',',','—','\u200b'];
  const make=()=>Array.from({length:random(35)},()=>alphabet[random(alphabet.length)]).join('');
  for(let i=0;i<600;i++)lossless(make(),make(),['en','el','bg',null,'unknown_locale'][random(5)]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSnippetParts,searchRangeParts,textReadKey,parseTextReadKey,findTextOffsets} from './pocTextSearchModel.mjs';

test('FTS markers remain escaped text segments, including source markup',()=>{
  const text='<img src=x onerror=alert(1)> \u0002énergie\u0003 & security';
  assert.deepEqual(searchSnippetParts(text),[{text:'<img src=x onerror=alert(1)> ',match:false},{text:'énergie',match:true},{text:' & security',match:false}]);
  assert.equal(searchSnippetParts(text).map(p=>p.text).join(''),text.replace(/[\u0002\u0003]/g,''));
});
test('large stored texts render exact UTF-16 ranges without losing or interpreting source text',()=>{
  const text='😀 énergie <script>literal</script>';
  const parts=searchRangeParts(text,[{start:3,end:10},{start:7,end:8},{start:11,end:999}]);
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.deepEqual(parts.filter(p=>p.match),[{text:'énergie',match:true}]);
});
test('stored reader identities preserve exact source and language-fragment keys',()=>{
  const hit={sourceId:'MTG-PL-2026-10-07-OTH-123',sourceKey:'mul'};
  assert.deepEqual(parseTextReadKey(textReadKey(hit)),hit);
  for(const bad of ['null','[1,2]','["id"]','["","en"]','{"sourceId":"x"}'])assert.equal(parseTextReadKey(bad),null);
});
test('literal local find preserves original Unicode offsets and handles punctuation',()=>{
  const text='Énergie, e\u0301nergie and ﬁshing. C++ is literal.';
  assert.deepEqual(findTextOffsets(text,'energie').map(h=>text.slice(h.start,h.end)),['Énergie','e\u0301nergie']);
  assert.deepEqual(findTextOffsets(text,'fishing').map(h=>text.slice(h.start,h.end)),['ﬁshing']);
  assert.deepEqual(findTextOffsets(text,'C++').map(h=>text.slice(h.start,h.end)),['C++']);
  assert.deepEqual(findTextOffsets(text,'   '),[]);
  assert.equal(findTextOffsets('a a a a','a',2).length,2);
});

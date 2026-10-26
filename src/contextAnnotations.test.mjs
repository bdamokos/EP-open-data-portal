import test from 'node:test';
import assert from 'node:assert/strict';
import {mapContextAnnotations,mapWordingFormatting} from './contextAnnotations.mjs';

test('annotation mapping retains exact UTF-16 wording offsets through whitespace and paragraph joins',()=>{
  const paragraphs=['19. Main 😀 link;', 'continued text;'],original='  19.  Main 😀 link;\n continued text;  ';
  const start=paragraphs[0].indexOf('Main'),end=paragraphs[0].indexOf(';');
  const mapped=mapContextAnnotations(paragraphs,{start:0,end:1},original,[{paragraph:0,offset:end,note:'1',label:'1'}],[{paragraph:0,start,end,url:'https://example.org'}]);
  assert.equal(original.slice(mapped.links[0].start,mapped.links[0].end),'Main 😀 link');
  assert.equal(mapped.anchors[0].offset,original.indexOf(';'));
});
test('annotation mapping rejects changed wording and invalid offsets',()=>{
  assert.equal(mapContextAnnotations(['Source'],{start:0,end:0},'Different'),null);
  assert.equal(mapContextAnnotations(['Source'],{start:0,end:0},'Source',[{paragraph:0,offset:7,note:'1',label:'1'}]),null);
});


test('placed formatting follows exact whitespace and an explicit provision prefix only',()=>{
  const marks=[{start:2,end:3,kind:'subscript'},{start:9,end:10,kind:'superscript'}];
  const target='1. CO2  mg/m3';
  const mapped=mapWordingFormatting('CO2 mg/m3',target,[{start:2,end:3,kind:'subscript'},{start:8,end:9,kind:'superscript'}]);
  assert.deepEqual(mapped,[{start:5,end:6,kind:'subscript'},{start:12,end:13,kind:'superscript'}]);
  assert.deepEqual(mapWordingFormatting('Different',target,marks),[]);
});

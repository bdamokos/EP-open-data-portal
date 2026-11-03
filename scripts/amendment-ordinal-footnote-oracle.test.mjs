import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertFootnoteComparison} from './amendment-footnote-oracle.mjs';
const example=JSON.parse(readFileSync(new URL('../server/fixtures/proposal-ordinal-footnote.json',import.meta.url))),{proposal,wording}=example;
const placement={operation:'replace',span:{start:0,end:0},splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:proposal.paragraphs[0].text.length}}};
test('native ordinal letters survive a merged superscript footnote marker',()=>{
 assert.equal(wording.originalText.slice(637,641),'th22');
 assert.equal(assertFootnoteComparison(proposal,wording,placement).status,'verified');
});
test('ordinal footnote proof rejects changed body, payload, formatting and anchor position',()=>{
 for(const changed of [
  {...wording,originalText:wording.originalText.replace('28th22','28st22')},
  {...wording,originalText:wording.originalText.replace('COM(2025) 30','COM(2025) 31')},
  {...wording,originalFormatting:wording.originalFormatting.map((m,i)=>i?m:{...m,end:m.end-1})},
 ])assert.equal(assertFootnoteComparison(proposal,changed,placement).status,'failed');
 assert.equal(assertFootnoteComparison({...proposal,anchors:proposal.anchors.map(a=>({...a,offset:a.offset+2}))},wording,placement).status,'failed');
});

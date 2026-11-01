import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFootnoteComparison} from './amendment-footnote-oracle.mjs';
const proposal={paragraphs:[{index:0,text:'A legal body.',complete:true,source:{complete:true}}],anchors:[{paragraph:0,offset:7,note:'native'}],notes:[{id:'native',text:'A public note.',complete:true}]};
const wording={originalText:'A legal6 body.\n______\n6 A public note.',originalFormatting:[{kind:'superscript',start:7,end:8}]};
const placement={splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:13}}};
test('oracle verifies renumbered native footnote with its exact position',()=>assert.equal(assertFootnoteComparison(proposal,wording,placement).status,'verified'));
test('oracle rejects moved anchors and changed payloads',()=>{
 assert.equal(assertFootnoteComparison({...proposal,anchors:[{paragraph:0,offset:9,note:'native'}]},wording,placement).status,'failed');
 assert.equal(assertFootnoteComparison(proposal,{...wording,originalText:wording.originalText.replace('public','private')},placement).status,'failed');
});
test('notes printed in the body keep the complete literal wording comparison',()=>{
 const text='A legal body*.\n______\n* A public note.';
 const inline={paragraphs:[{index:0,text}],anchors:[],notes:[]};
 assert.equal(assertFootnoteComparison(inline,{originalText:text,originalFormatting:[]},{span:{start:0,end:0}}),null);
});

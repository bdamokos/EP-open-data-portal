import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFootnoteComparison,assertResolutionFootnotes} from './amendment-footnote-oracle.mjs';
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

const resolution={paragraphs:['26.\tStresses the Crisis Regulation;'],paragraphSources:[{complete:true}],notesStatus:'extracted',noteAnchors:[{paragraph:0,offset:34,note:'25'}],notes:[{id:'25',label:'25',text:'Regulation (EU) 2024/1359.'}]};
const resolutionWording={originalText:'26.\tStresses the Crisis Regulation25 ;\n_________________\n25 Regulation (EU) 2024/1359.',originalFormatting:[{kind:'superscript',start:34,end:36}]};
test('oracle verifies a resolution paragraph footnote by body, position and note text',()=>{
 assert.equal(assertResolutionFootnotes(resolution,resolutionWording,{span:{start:0,end:0}}).status,'verified');
 const repeated={...resolutionWording,originalText:resolutionWording.originalText.replace('\n25 Regulation','\n25 25 Regulation')};
 assert.equal(assertResolutionFootnotes(resolution,repeated,{span:{start:0,end:0}}).status,'verified');
});
test('oracle rejects resolution footnotes with a moved anchor, changed note or changed body',()=>{
 assert.equal(assertResolutionFootnotes({...resolution,noteAnchors:[{paragraph:0,offset:18,note:'25'}]},resolutionWording,{span:{start:0,end:0}}).status,'failed');
 assert.equal(assertResolutionFootnotes(resolution,{...resolutionWording,originalText:resolutionWording.originalText.replace('2024/1359','2024/1360')},{span:{start:0,end:0}}).status,'failed');
 assert.equal(assertResolutionFootnotes(resolution,{...resolutionWording,originalText:resolutionWording.originalText.replace('Stresses','Notes')},{span:{start:0,end:0}}).status,'failed');
 assert.equal(assertResolutionFootnotes({...resolution,notesStatus:'not-extracted'},resolutionWording,{span:{start:0,end:0}}).status,'failed');
});
test('resolution originals without a detached note payload are not footnote comparisons',()=>assert.equal(assertResolutionFootnotes(resolution,{originalText:'26.\tStresses.',originalFormatting:[]},{span:{start:0,end:0}}),null));

test('unruled numbered note payloads still require exact native body, payload and position',()=>{
 const wording={...resolutionWording,originalText:resolutionWording.originalText.replace('\n_________________\n25 ','\n25. ')};
 assert.equal(assertResolutionFootnotes(resolution,wording,{span:{start:0,end:0}}).status,'verified');
 for(const originalText of [wording.originalText.replace('2024/1359','2024/1360'),wording.originalText.replace('25. ','26. ')])assert.equal(assertResolutionFootnotes(resolution,{...wording,originalText},{span:{start:0,end:0}}).status,'failed');
 assert.equal(assertResolutionFootnotes({...resolution,noteAnchors:[{paragraph:0,offset:1,note:'25'}]},wording,{span:{start:0,end:0}}).status,'failed');
});

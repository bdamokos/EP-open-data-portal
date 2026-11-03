import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';import {verifyPlacement} from './amendment-benchmark-model.mjs';
const example=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-new-label-context.json',import.meta.url))),{wording}=example;
const paragraphs=['The European Parliament,',...example.sourceExcerpt],text={paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({path:'fixture/p'+ordinal,ordinal,container:'body',containerPath:'fixture',segment:0,complete:true})),paragraphFormats:paragraphs.map(()=>({}))};
const placement={status:'placed',operation:'insert',insertAfter:2,insertBefore:3};
test('a new resolution paragraph label makes quoted original text predecessor context',()=>{
 assert.equal(expectedOperation(wording),'insert');
 assert.equal(verifyPlacement({placement,wording,text}).status,'verified');
 assert.equal(verifyPlacement({placement:{...placement,insertAfter:1,insertBefore:2},wording,text}).status,'failed');
});
test('quoted predecessor must independently match the base paragraph of the new label',()=>{
 for(const changed of [{...wording,originalText:wording.originalText.replace('Cuba','another country')},{...wording,targetLabel:'Paragraph 9 a (new)',targetPath:undefined}])assert.notEqual(verifyPlacement({placement,wording:changed,text}).status,'verified');
});
test('legislative originals and deletion instructions keep their operation',()=>{
 assert.equal(expectedOperation({...wording,baseline:'commission-proposal',documentReferences:[{field:'DocAmend',raw:'Proposal for a regulation'}]}),'replace');
 assert.equal(expectedOperation({...wording,proposedText:'deleted'}),'delete');
 assert.equal(expectedOperation({...wording,targetLabel:'Paragraph 8'}),'replace');
});

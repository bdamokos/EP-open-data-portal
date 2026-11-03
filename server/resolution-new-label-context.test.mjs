import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {documentContextPlacement} from './document-context-placement.mjs';import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-new-label-context.json',import.meta.url))),wording={...example.wording,targetLabelLanguage:'en'};
const make=(rows=example.sourceExcerpt)=>{const paragraphs=['The European Parliament,',...rows];return {status:'available',textLanguage:'en',structureStatus:'extracted',paragraphs,paragraphFormats:paragraphs.map(()=>({})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'fixture/p'+ordinal,ordinal,container:'body',containerPath:'fixture',segment:0,complete:true}))};};
const place=(chosen=wording,text=make())=>documentContextPlacement({chosen,text,referenceTexts:['§ 8'],resolutionDocument:true});
test('RC0394 AM8 inserts after its quoted paragraph8 rather than replacing it',()=>{
 const text=make(),placement=place(wording,text);assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.operation,'insert');assert.equal(placement.span,undefined);assert.equal(placement.insertAfter,2);assert.equal(placement.insertBefore,3);assert.equal(verifyPlacement({placement,wording,text}).status,'verified');
});
test('context insertion rejects changed quoted predecessors and existing new labels',()=>{
 assert.equal(place({...wording,originalText:wording.originalText.replace('Cuba','another country')}).status,'unresolved');
 assert.equal(place({...wording,targetLabel:'Paragraph 9 a (new)',targetPath:undefined}).status,'unresolved');
 assert.equal(place(wording,make([example.sourceExcerpt[0],example.sourceExcerpt[1],'8a. Existing provision;',example.sourceExcerpt[2]])).status,'unresolved');
 const text=make();text.paragraphSources[2].complete=false;assert.equal(place(wording,text).status,'unresolved');
});
test('new-label context policy leaves legislative wording and deletion operations unchanged',()=>{
 const legislative={...wording,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},targetPath:{language:'en'},documentReferences:[{field:'DocAmend',raw:'Proposal for a regulation'}]};
 assert.equal(place(legislative).operation,'replace');assert.equal(place(legislative).status,'unresolved');
 assert.equal(place({...wording,proposedText:'deleted'}).operation,'delete');
});

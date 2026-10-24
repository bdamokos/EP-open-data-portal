import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from '../../server/document-context-model.mjs';

export function contextOverlayResponse(documentId,amendmentId,listId) {
  const paragraphs=['The European Parliament,','– having regard to public sources,','19. Main provision:','(a) last point;','20. Following provision;'];
  const selectedText={status:'available',paragraphs,textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en'],notesStatus:'extracted',notes:[],noteAnchors:[],documentLinks:[],structureStatus:'extracted',
    paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
  const variant={listId,language:'en',targetLabel:'Paragraph 19 a (new)',targetLabelLanguage:'en',wordingStatus:'available',originalText:'',proposedText:'19a. New proposed provision;',authors:[],source:null,gaps:[]};
  return {version:1,documentId,requestedLanguage:'en',requestedWordingLanguage:'en',document:{id:documentId,titles:{en:'Resolution context'},files:[],selectedDocumentId:documentId,selectedText},
    related:{status:'not-requested',items:[],gaps:[]},amendment:{id:amendmentId,status:'available',variants:[variant],gaps:[]},
    target:{status:'found',paragraphs:[2],evidence:{amendmentId,listId,wordingLanguage:'en',referenceDecisions:[]}},
    placement:resolveAmendmentPlacement(selectedText,{...variant,language:'en'}),sources:[]};
}
export function assertContextOverlay(container) {
  const block=container.querySelector('[data-amendment-block]');assert(block,'in-place amendment block');
  assert.equal(block.previousElementSibling.textContent,'(a) last point;');
  assert.equal(block.nextElementSibling.textContent,'20. Following provision;');
  assert(block.querySelector('.wording-diff ins'));assert.equal(block.dataset.contextTarget,'true');
}

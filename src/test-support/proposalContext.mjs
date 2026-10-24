import {readFileSync} from 'node:fs';
import {parseProposal} from '../../server/proposal-structure.mjs';
import {resolveProposalPlacement} from '../../server/proposal-placement.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('../../server/fixtures/'+name,import.meta.url)));
export function proposalContextResponse(documentId,amendmentId,listId,number=7){
  const variant={...fixture('proposal-placement-cbam.json').amendments.find(a=>a.number===number),listId,wordingStatus:'available',authors:[],source:null,gaps:[]};
  const items=['act','annex'].map(kind=>({kind,index:1,proposal:parseProposal(fixture(`52025PC0087-${kind}-excerpt.json`),{item:kind})}));
  return {version:4,documentId,requestedLanguage:'en',requestedWordingLanguage:'en',document:{id:documentId,titles:{en:'CBAM report'},files:[],selectedDocumentId:documentId,selectedText:{status:'available',paragraphs:['Report body must not replace the proposal.'],textLanguage:'en'}},
    related:{status:'not-requested',items:[],gaps:[]},amendment:{id:amendmentId,status:'available',variants:[variant],gaps:[]},
    baseline:{kind:'commission-proposal',celex:'52025PC0087',workId:'exact-work',language:'en',status:'available',items:items.map(item=>({kind:item.kind,index:item.index,source:{url:item.proposal.sourceUrl,fetchedAt:'2026-10-21T12:00:00Z',sha256:item.proposal.sourceHash,stale:false,refreshError:null}})),gaps:[],attribution:'Legal text © European Union.'},
    proposal:{items},placement:resolveProposalPlacement(items,variant),target:{status:'found',paragraphs:[],evidence:{amendmentId,listId,wordingLanguage:'en',referenceDecisions:[]}},sources:[]};
}

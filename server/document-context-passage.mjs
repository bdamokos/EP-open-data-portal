import {proposalPassageRows,paragraphPassageRows} from '../src/proposalPassage.mjs';
import {DOCUMENT_CONTEXT_VERSION,documentContextQuery} from './document-context.mjs';
import {HttpError} from './http-utils.mjs';

export const wantsDocumentPassage=params=>params.get('body')==='passage';
/** `body=passage` asks for the same placement as the reader's read, without the document's body. */
export function documentPassageQuery(id,params) {
  if(params.getAll('body').length!==1||!params.get('amendment')||params.has('adopted')||params.has('final-text'))throw new HttpError(400,'invalid_query','body=passage requires an exact amendment.');
  const rest=new URLSearchParams(params);rest.delete('body');
  return documentContextQuery(id,rest);
}
// The reader's own read runs unchanged, so this placement can't differ from the one it shows.
export function documentPassageReply(context) {
  const {finalPlacementCheck:_check,...placement}=context.placement||{};
  const item=context.proposal?.items?.[placement.itemIndex??0]?.proposal,text=context.document?.selectedText;
  const placed=placement.status==='placed';
  const passage=!placed?null:item?proposalPassageRows(item,placement):text?.paragraphs?.length?paragraphPassageRows(placement,{paragraphs:text.paragraphs,tables:text.tables}):null;
  return {version:DOCUMENT_CONTEXT_VERSION,documentId:context.documentId,requestedLanguage:context.requestedLanguage,baseline:context.baseline?{kind:context.baseline.kind,language:context.baseline.language}:null,placement:context.placement?placement:null,passage};
}

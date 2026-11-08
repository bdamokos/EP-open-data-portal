import {proposalPassageRows,paragraphPassageRows} from '../src/proposalPassage.mjs';
import {motionProvisionText} from './document-context-model.mjs';
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

const provisionForms=/^(?:paragraph:[1-9]\d{0,4}[a-z]{0,3}|point:[1-9]\d{0,4}[a-z]{0,3}:[a-z]{1,4}|recital:[A-Z]{1,3}[a-z]{0,3}|citation:[1-9]\d{0,4})$/u;
export const wantsDocumentProvision=params=>params.has('provision');
/** `provision=` asks for one provision's wording from a report or motion, by its exact number or letter.
 * The body read is the reader's own; the record comes from what the index holds when it holds it. */
export function documentProvisionQuery(id,params) {
  const provision=params.get('provision');
  if(params.getAll('provision').length!==1||!provisionForms.test(provision||'')||!/^(?:A|B|RC)-\d+-\d{4}-\d{4,6}$/u.test(id)||[...params.keys()].some(key=>!['provision','lang'].includes(key)))throw new HttpError(400,'invalid_query','provision requires one exact provision of a report or motion.');
  const rest=new URLSearchParams(params);rest.delete('provision');
  return {...documentContextQuery(id,rest),heldMetadata:true,provision};
}
export function documentProvisionReply(context,provision) {
  const text=context.document?.selectedText,language=text?.textLanguage||null;
  const wording=language?motionProvisionText(text,language,provision):null;
  return {version:DOCUMENT_CONTEXT_VERSION,documentId:context.documentId,requestedLanguage:context.requestedLanguage,provision,text:wording,language:wording?language:null};
}

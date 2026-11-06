import {committeeAmendmentIdentity} from './amendmentModel.mjs';
import {readMemberVotesJourney} from './memberVotesJourney.mjs';

const committeeRoot=/^[A-Z][A-Z0-9]{2,5}-(?:PR|PA|AM)-\d{4,9}(?:-\d{1,4})*$/;
// The same document identifiers `document-context` accepts.
export const readableDocument=id=>typeof id==='string'&&(/^(?:A|B|RC|TA)-(?:[1-9]|10)-\d{4}-\d{4,6}(?:-AM-\d{1,5}-\d{1,5})?$/.test(id)||committeeRoot.test(id));
const plenaryRoot=id=>/^(?:A|B|RC)-/.test(id);
const amendmentOf=(documentId,id)=>typeof id==='string'&&(plenaryRoot(documentId)?id.startsWith(documentId+'-AM-')&&/^\d+(?:-\d+)?$/.test(id.slice(documentId.length+4)):Boolean(committeeAmendmentIdentity(id)));
const validList=(documentId,amendmentId,list)=>typeof list==='string'&&(plenaryRoot(documentId)?new RegExp('^'+documentId+'-AM-\\d{1,5}-\\d{1,5}$').test(list):committeeAmendmentIdentity(amendmentId)?.listId===list);
const validLanguage=value=>typeof value==='string'&&/^[a-z]{2}$/.test(value);

export function readHref({documentId,amendmentId,listId,wordingLanguage,language}) {
  const query=new URLSearchParams({view:'legislation','pl-mode':'read','read-doc':documentId});
  if(amendmentId)query.set('read-amendment',amendmentId);
  if(amendmentId&&listId)query.set('read-list',listId);
  if(wordingLanguage!==undefined)query.set('read-lang',wordingLanguage??'unknown');
  if(language)query.set('lang',language);
  return '?'+query;
}

// A malformed amendment or list reads as a stale link: the document still opens.
export function readRoute(query) {
  const documentId=query.get('read-doc');
  if(!readableDocument(documentId))return null;
  const requested=query.get('read-amendment'),language=query.get('read-lang');
  if(!requested||!amendmentOf(documentId,requested))return {documentId,staleAmendment:Boolean(requested),...(validLanguage(language)?{textLanguage:language}:{})};
  const list=query.get('read-list'),listId=validList(documentId,requested,list)?list:undefined;
  return {documentId,amendmentId:requested,staleAmendment:false,...(listId?{listId,...(language==='unknown'?{wordingLanguage:null}:validLanguage(language)?{wordingLanguage:language}:{})}:{})};
}

const legacyContextKeys=['mv-document','mv-view','mv-amendment','mv-list','mv-wording-lang','mv-adopted'];
// An exact amendment opened from a member's Votes tab now has its own page. The
// origin keeps the votes state, with any saved snapshot, for Back.
export function legacyReaderRedirect(search) {
  const query=new URLSearchParams(search),member=query.get('member');
  if(query.has('view')||query.get('mv-view')!=='document'||!query.get('mv-amendment')||!/^[1-9]\d{0,12}$/.test(member||''))return null;
  const journey=readMemberVotesJourney(query,Number(member)),context=journey.state.context;
  if(journey.invalid||!context?.amendmentId)return null;
  for(const key of legacyContextKeys)query.delete(key);
  return {origin:'?'+query,read:readHref({...context,language:query.get('lang')})};
}

const dashed=/^(A|B|RC|TA)-(\d{1,2})-(\d{4})-(\d{4,6})$/;
export function documentReferenceLabel(id) {
  const match=dashed.exec(id);
  return match?`${match[1]==='TA'?'T':match[1]}${match[2]}-${match[4]}/${match[3]}`:id;
}
export const amendmentNumber=id=>id?.match(/(?:-AM-|:)(\d+(?:-\d+)?[a-z]*)$/i)?.[1].replace(/^0+(?=\d)/,'')||null;
// The header names the provision; the amendment's own label stays in its source form.
export const provisionLabel=label=>typeof label==='string'?label.split(/\s[–—-]\s/u)[0].trim()||null:null;

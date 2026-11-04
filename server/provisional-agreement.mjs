import {documentContext,documentContextQuery} from './document-context.mjs';
import {provisionalDecisions} from './amendment-provisional.mjs';
import {adoptedPlacementRecord,placementAdoptedListing} from './amendment-placement-check.mjs';
import {adoptedTextFinalAct} from './provisional-final-act.mjs';
import {commissionReferences} from './commission-proposal-identity.mjs';
import {validateAdoptedText} from './adopted-text-index.mjs';
import {canonicalEPReference} from './amendments.mjs';
import * as amendmentStore from './amendments-store.mjs';
import {proposalBaseline} from './proposal-baseline.mjs';
import {documentText} from './document-text.mjs';
import {HttpError} from './http-utils.mjs';
import {odp,ODP_BASE} from './odp.mjs';
import {array} from './activity-index-model.mjs';
import {requestSignal,isLocalRequestFailure} from './request-budget.mjs';

export const PROVISIONAL_AGREEMENT_VERSION=1;

// The same exact amendment, list and wording language the reader already opened.
export function provisionalAgreementQuery(id,params) {
  for(const key of params.keys())if(!['lang','amendment','list','wording-lang'].includes(key))throw new HttpError(400,'invalid_query','Unsupported document query parameter.');
  const query=documentContextQuery(id,params);
  if(!/^A-10-\d{4}-\d{4,6}$/u.test(id)||!query.amendmentId||!query.listId||typeof query.wordingLanguage!=='string')throw new HttpError(400,'invalid_query','Choose an exact report, amendment, list and wording language.');
  return query;
}

const source=(url,record)=>({url:record.url||url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null});
const reportPlacement=(context,query)=>{
  const placement=context?.placement,evidence=placement?.evidence?.find(item=>item.basis==='exact-provisional-agreement'&&item.reference===query.amendmentId);
  return placement?.status==='document-operation'&&placement.operation==='replace'&&placement.scope==='whole-document'&&placement.reason==='provisional_agreement'&&evidence
    &&context.documentId===query.id&&context.amendment?.id===query.amendmentId&&context.target?.evidence?.listId===query.listId&&evidence.language===query.wordingLanguage
    &&/^https:\/\/data\.europarl\.europa\.eu\/distribution\/reds_iPlRp_Amd\/[^/?#]+\/[^/?#]+\.docx$/u.test(evidence.sourceUrl||'')?evidence:null;
};

// Links around a verified provisional agreement. Every one is bound by an
// exact identifier: the list, the adopted text that adopts this report on the
// vote date, the act number the adopted text states, and the COM number the
// agreement file cites. Nothing is joined by title or wording similarity.
export class ProvisionalAgreement {
  constructor({context=documentContext,request=odp,readText=documentText,readProposal=proposalBaseline,listing=placementAdoptedListing,findAmendment=(store,query)=>amendmentStore.amendmentById?.(store,query)||null}={}) {
    Object.assign(this,{context,request,readText,readProposal,listing,findAmendment});
  }
  async query(query,{store=null}={}) {
    requestSignal()?.throwIfAborted();
    const base={version:PROVISIONAL_AGREEMENT_VERSION,documentId:query.id,amendmentId:query.amendmentId,listId:query.listId,requestedLanguage:query.language};
    const context=await this.context.query(query,{store}),evidence=reportPlacement(context,query);
    if(!evidence)return {...base,status:'unavailable',agreement:null,adoptedText:null,text:null,finalAct:null,proposal:null,sources:[]};
    const sources=[],agreement={listId:query.listId,language:evidence.language,url:evidence.sourceUrl};
    const variant=context.amendment.variants.find(item=>item.listId===query.listId&&item.language===query.wordingLanguage);
    const indexed=this.findAmendment(store,{document:query.id,id:query.amendmentId,language:query.language});
    const decisions=indexed?.id===query.amendmentId&&indexed.targetDocumentId===query.id?provisionalDecisions(indexed.decisions,query.amendmentId):[];
    const adoptedText=await this.adoptedText(query,[...new Set(decisions.map(decision=>decision.date))],sources);
    return {...base,status:'verified',agreement,adoptedText:adoptedText&&{id:adoptedText.id,url:adoptedText.url},
      // The adopted text only when it holds the position; otherwise the agreement file.
      text:adoptedText?.holdsText?{documentId:adoptedText.id,kind:'adopted-text'}:{documentId:query.listId,kind:'agreement'},
      finalAct:adoptedText?.act??null,proposal:await this.proposal(query,variant,sources),sources};
  }
  async adoptedText(query,dates,sources) {
    try {
      if(dates.length!==1||!/^\d{4}-\d{2}-\d{2}$/u.test(dates[0]||''))return null;
      const listing=await this.listing(this.request,Number(dates[0].slice(0,4))),records=listing?.payload?.data;
      if(!Array.isArray(records)||records.length>=500)return null;
      const match=adoptedPlacementRecord(records,{documentId:query.id,dates});
      if(!match)return null;
      sources.push(source(ODP_BASE+'/adopted-texts',listing));
      const endpoint='/adopted-texts/'+match.identifier,exact=await this.request(endpoint,{},{staleWhileRevalidate:true});
      const works=array(exact.payload?.data).filter(work=>canonicalEPReference(work?.id)==='eli/dl/doc/'+match.identifier);
      if(works.length!==1||!array(works[0].adopts).some(value=>canonicalEPReference(value)==='eli/dl/doc/'+query.id))return null;
      const work=validateAdoptedText(endpoint,works[0]);
      sources.push(source(ODP_BASE+endpoint,exact));
      // The statement is read from the English text, which every adopted text has;
      // the identity of the act does not depend on the reader's language.
      const text=await this.readText(work,'en',{enqueue:false}),read=text?.status==='available'&&text.textLanguage==='en';
      const statement=read?adoptedTextFinalAct(text.paragraphs):null;
      return {id:match.identifier,url:`https://www.europarl.europa.eu/doceo/document/${match.identifier}_${query.language.toUpperCase()}.html`,holdsText:Boolean(statement&&!statement.statesFinalAct),act:statement?.act??null};
    }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;return null;}
  }
  async proposal(query,variant,sources) {
    const references=array(variant?.documentReferences).filter(item=>item.field==='DocRef').flatMap(item=>commissionReferences(item.raw));
    const celexes=[...new Set(references.map(item=>item.celex))];
    if(celexes.length!==1)return null;
    // The COM number is shown as written. It links only once the proposal's identity passes.
    const year=String(references[0].year),number=String(references[0].number).padStart(4,'0'),reference=`COM(${year})${number}`;
    try {
      const identity=await this.readProposal({reportId:query.id,language:'en',documentReferences:variant.documentReferences,identityOnly:true});
      if(identity?.status==='identified'&&identity.celex===celexes[0]){
        for(const item of array(identity.evidence))if(item.url&&item.fetchedAt)sources.push({url:item.url,fetchedAt:item.fetchedAt,stale:Boolean(item.stale),refreshInProgress:false,refreshError:item.refreshError||null});
        return {reference,year,number,url:`https://eur-lex.europa.eu/legal-content/${query.language.toUpperCase()}/TXT/?uri=CELEX:${identity.celex}`};
      }
    }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;}
    return {reference,year,number,url:null};
  }
}
export const provisionalAgreement=new ProvisionalAgreement();

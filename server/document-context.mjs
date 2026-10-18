import {createHash} from 'node:crypto';
import {odp,ODP_BASE,odpLanguage,boundedUpstream} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {documentSummary} from './activities.mjs';
import {array,tail,documentFiles} from './activity-index-model.mjs';
import {documentText,downloadDocxBuffer,allowedDownload} from './document-text.mjs';
import {extractAmendments,AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {amendmentReference,amendmentTextLosses,canonicalEPReference} from './amendments.mjs';
import * as amendmentStore from './amendments-store.mjs';
import {sharedRequest,waitForRequest,isLocalRequestFailure,requestSignal} from './request-budget.mjs';
import {resolveDocumentTarget} from './document-context-model.mjs';

export const DOCUMENT_CONTEXT_LIMITS=Object.freeze({procedures:4,adoptedCandidates:8,lists:64,matchingLists:4,metadataBytes:16*1024*1024,entries:12,bytes:12*1024*1024,entryBytes:2*1024*1024,ttl:60_000});
const documentId=id=>typeof id==='string'&&/^(?:A|B|RC|TA)-10-\d{4}-\d{4,6}$/.test(id);
const ref=value=>canonicalEPReference(value);
const refs=value=>array(value).map(ref).filter(Boolean);
const procedureIds=work=>[...new Set(array(work.inverse_created_a_realization_of).flatMap(value=>{const id=String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');return /^eli\/dl\/proc\/\d{4}-\d{4}[A-Z]?$/.test(id)?[tail(id)]:[];}))];
const workId=node=>node?.identifier||tail(node?.id);
const unavailableTarget=reason=>({status:'unavailable',paragraphs:[],basis:null,relation:null,quoteMatches:null,reason});

export function documentContextQuery(id,params) {
  if(!documentId(id))throw new HttpError(400,'invalid_document','Choose a plenary document or adopted resolution.');
  for(const key of params.keys())if(!['lang','amendment','list','adopted'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated document query parameter.');
  const amendmentId=params.get('amendment'),listId=params.get('list'),adopted=params.get('adopted');
  if(amendmentId!==null&&amendmentReference('eli/dl/doc/'+amendmentId)?.targetDocumentId!==id)throw new HttpError(400,'invalid_amendment','Choose an amendment to this exact document.');
  if(listId!==null&&(!amendmentId||!new RegExp('^'+id+'-AM-[0-9]{1,5}-[0-9]{1,5}$').test(listId)))throw new HttpError(400,'invalid_list','Choose a published amendment list for this document.');
  if(adopted!==null&&adopted!=='1')throw new HttpError(400,'invalid_query','adopted must be 1.');
  if(adopted!==null&&(amendmentId||listId||id.startsWith('TA-')))throw new HttpError(400,'invalid_query','Find adopted texts from the original report or motion.');
  return {id,language:odpLanguage(params.get('lang')||'en'),amendmentId,listId,adopted:adopted==='1'};
}

// This reader discovers only exact linked records for the document being opened.
// It never enqueues indexing or turns missing indexed wording into an empty list.
export class DocumentContext {
  constructor({request=odp,readText=documentText,download=url=>boundedUpstream(()=>downloadDocxBuffer(url)),findAmendment=(store,query)=>amendmentStore.amendmentById?.(store,query)||null,clock=Date.now,limits={}}={}) {
    Object.assign(this,{request,readText,download,findAmendment,clock});this.limits={...DOCUMENT_CONTEXT_LIMITS,...limits};this.pending=new Map();this.cache=new Map();this.bytes=0;
  }
  async query(query,{store=null}={}) {
    requestSignal()?.throwIfAborted();
    // Indexed variants are checked on every read, outside the shared source key.
    const candidate=query.amendmentId&&store?this.findAmendment(store,{document:query.id,id:query.amendmentId,language:query.language}):null;
    const exactIdentity=candidate?.id===query.amendmentId||array(candidate?.officialIds).some(value=>ref(value)==='eli/dl/doc/'+query.amendmentId);
    const indexed=exactIdentity&&candidate?.targetDocumentId===query.id?candidate:null;
    const key=JSON.stringify([query,indexed]);const cached=this.cache.get(key);
    if(cached&&cached.until>this.clock())return cached.value;
    if(cached){this.bytes-=cached.bytes;this.cache.delete(key);}
    let job=this.pending.get(key);
    if(!job) {
      job=sharedRequest(async signal=>{
        const value=await this.collect(query,indexed);signal.throwIfAborted();
        const bytes=Buffer.byteLength(JSON.stringify(value));
        // Retained stale/error sources are readable, but never acquire a new TTL.
        if(bytes<=this.limits.entryBytes&&!value.sources.some(source=>source.stale||source.refreshInProgress||source.refreshError)&&!value.document?.selectedText?.stale&&!value.document?.selectedText?.refreshInProgress&&!value.document?.selectedText?.refreshError&&value.document?.selectedText?.status!=='error'&&!value.amendment?.gaps.length&&!value.related.gaps.length) {
          while(this.cache.size&&(this.cache.size>=this.limits.entries||this.bytes+bytes>this.limits.bytes)){const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}
          signal.throwIfAborted();this.cache.set(key,{value,bytes,until:this.clock()+this.limits.ttl});this.bytes+=bytes;
        }
        return value;
      }).finally(()=>this.pending.delete(key));this.pending.set(key,job);
    }
    return waitForRequest(job);
  }
  async collect(query,indexed) {
    const sources=[],records=new Map();let metadataBytes=0;
    const read=async(endpoint,id,{procedure=false}={})=>{
      if(records.has(endpoint))return records.get(endpoint);
      const record=await this.request(endpoint,{}, {staleWhileRevalidate:true});
      const serialized=JSON.stringify(record.payload);metadataBytes+=Buffer.byteLength(serialized);
      if(metadataBytes>this.limits.metadataBytes)throw new HttpError(502,'document_source_budget','The linked document records are too large to read together.');
      const nodes=array(record.payload?.data).filter(node=>procedure?String(node?.id||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')==='eli/dl/proc/'+id:ref(node?.id)==='eli/dl/doc/'+id&&workId(node)===id);
      if(nodes.length!==1)throw new HttpError(502,'invalid_document_source','Parliament did not return the requested document.');
      const source={url:record.url||ODP_BASE+endpoint,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null,contentHash:createHash('sha256').update(serialized).digest('hex')};
      sources.push(source);const result={work:nodes[0],record,source};records.set(endpoint,result);return result;
    };
    const endpoint=(query.id.startsWith('TA-')?'/adopted-texts/':'/plenary-documents/')+query.id;
    const {work,record}=await read(endpoint,query.id);
    if(query.id.startsWith('TA-')&&tail(work.work_type)!=='TEXT_ADOPTED')throw new HttpError(502,'invalid_document_source','Parliament did not return the requested adopted text.');
    const related={status:'not-requested',items:[],gaps:[]};
    if(query.adopted) {
      related.status='available';const procedures=procedureIds(work),candidates=new Set();
      if(!procedures.length){related.status='unavailable';related.gaps.push('procedure-link-unavailable');}
      else if(procedures.length>this.limits.procedures){related.status='unavailable';related.gaps.push('procedure-budget');}
      else {
        for(const id of procedures)try {
          const {work:procedure}=await read('/procedures/'+id,id,{procedure:true});
          if(!Object.hasOwn(procedure,'created_a_realization_of'))related.gaps.push('adopted-relationships-unavailable');
          for(const value of array(procedure.created_a_realization_of)){const valueId=typeof value==='string'?value:value?.id;const normalized=String(valueId||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');if(/^eli\/dl\/doc\/TA-10-\d{4}-\d{4,6}$/.test(normalized))candidates.add(tail(normalized));}
        }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;related.gaps.push('procedure-unavailable');}
        if(candidates.size>this.limits.adoptedCandidates){related.gaps.push('adopted-candidate-budget');}
        else for(const id of candidates)try {
          const {work:adopted,source}=await read('/adopted-texts/'+id,id);
          if(!Object.hasOwn(adopted,'adopts'))related.gaps.push('adopted-reciprocal-relationship-unavailable');
          if(tail(adopted.work_type)!=='TEXT_ADOPTED')related.gaps.push('adopted-record-type-unverified');
          else if(refs(adopted.adopts).includes('eli/dl/doc/'+query.id))related.items.push({...documentSummary(adopted,null),relationship:{from:id,field:'adopts',to:query.id},source});
        }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;related.gaps.push('adopted-text-unavailable');}
        if(related.gaps.length)related.status=related.items.length?'partial':'unavailable';
      }
    }
    let document=null;
    if(!query.adopted)document={...documentSummary(work,null),selectedDocumentId:query.id,selectedDocumentDate:work.document_date||null,selectedText:await this.readText(work,query.language),requestedLanguage:query.language,fetchedAt:new Date(record.fetchedAt).toISOString(),sourceCache:{stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null}};
    const amendment=query.amendmentId?await this.amendment(query,indexed,work,sources,read):null;
    const chosen=amendment?.variants.length===1?amendment.variants[0]:null;
    const referenceDecisions=array(indexed?.decisions).filter(decision=>array(decision.amendmentIds).some(id=>id===query.amendmentId||id===indexed.id)&&typeof decision.reference==='string'&&decision.source?.url&&decision.source?.fetchedAt);
    const references=[...new Set(referenceDecisions.map(decision=>decision.reference))];
    const target=!query.amendmentId?{...unavailableTarget(null),status:'not-requested'}:!chosen?unavailableTarget(amendment?.variants.length?'choose-source-version':'amendment-wording-unavailable'):chosen.language!==document?.selectedText?.textLanguage?unavailableTarget('different-text-languages'):resolveDocumentTarget(document?.selectedText,{originalText:chosen.originalText,targetLabel:chosen.targetLabel,referenceText:references.length===1?references[0]:undefined,language:chosen.language});
    return {version:1,documentId:query.id,requestedLanguage:query.language,document,related,amendment,target:{...target,evidence:chosen?{amendmentId:query.amendmentId,listId:chosen.listId,wordingSource:chosen.source,referenceDecisions:referenceDecisions.map(decision=>({id:decision.id,reference:decision.reference,language:'en',source:decision.source}))}:null},sources};
  }
  async amendment(query,indexed,work,sources,read) {
    const base={id:query.amendmentId,status:'unavailable',basis:null,variants:[],gaps:[]};
    const variants=indexed?.variants?.length?indexed.variants:indexed?[indexed]:[];
    const accepted=variants.filter(row=>(!query.listId||row.listId===query.listId)&&row.textIntegrity==='complete'&&typeof row.originalText==='string'&&typeof row.proposedText==='string'&&!row.conflicted);
    if(accepted.length)return {...base,status:'available',basis:'index',variants:accepted.map(row=>({listId:row.listId,language:row.language,targetLabel:row.targetLabel,originalText:row.originalText,proposedText:row.proposedText,authors:row.authors||[],source:row.wordingSource||null,sourceFreshness:row.sourceFreshness||null,gaps:row.gaps||[]}))};
    // A single opened amendment may use its exact published list. This is not a
    // corpus read or an index write; source range labels select candidates only.
    const number=amendmentReference('eli/dl/doc/'+query.amendmentId).number;
    if(query.amendmentId!==query.id+'-AM-'+number)return {...base,gaps:['amendment-identity-unverified']};
    const lists=array(work.inverse_foresees_change_of);
    if(!Array.isArray(work.inverse_foresees_change_of))base.gaps.push('amendment-list-relationships-unavailable');
    if(lists.length>this.limits.lists)return {...base,gaps:['amendment-list-budget']};
    const candidates=lists.filter(list=>{const canonical=ref(list);if(!canonical?.startsWith('eli/dl/doc/'+query.id+'-AM-'))return false;const id=tail(canonical);if(query.listId)return id===query.listId;const range=id.match(/-AM-(\d+)-(\d+)$/);return range&&Number(range[1])<=number&&number<=Number(range[2]);});
    if(candidates.length>this.limits.matchingLists)return {...base,gaps:['matching-list-budget']};
    const observed=new Map();
    for(const candidate of candidates) {
      const listId=tail(ref(candidate)),fingerprint=JSON.stringify(candidate);
      if(observed.has(listId)){if(observed.get(listId)!==fingerprint)base.gaps.push('conflicting-list-metadata');continue;}observed.set(listId,fingerprint);
      let list=candidate;
      if(typeof candidate==='string'||!Object.hasOwn(candidate,'is_realized_by'))try {list=(await read('/plenary-documents/'+listId,listId)).work;}catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;base.gaps.push('amendment-list-unavailable');continue;}
      if(workId(list)!==listId||tail(list.work_type)!=='AMENDMENT_LIST'||!refs(list.foresees_change_of).includes('eli/dl/doc/'+query.id)){base.gaps.push('amendment-list-target-unverified');continue;}
      const files=documentFiles(list).filter(file=>file.format==='DOCX'&&file.language&&allowedDownload(file.url));
      const languages=[...new Set(files.map(file=>file.language))],language=languages.includes(query.language)?query.language:languages.includes('en')?'en':languages[0];
      const selected=files.filter(file=>file.language===language);
      if(selected.length!==1){base.gaps.push('amendment-file-unavailable-or-ambiguous');continue;}
      const file=selected[0];
      try {
        const {buffer,resolvedSourceUrl}=await this.download(file.url);
        requestSignal()?.throwIfAborted();
        const source={url:file.url,resolvedSourceUrl,fetchedAt:new Date(this.clock()).toISOString(),language,contentHash:createHash('sha256').update(buffer).digest('hex'),stale:false,refreshInProgress:false,refreshError:null};sources.push(source);
        const extraction=extractAmendments(buffer,{listId,targetDocumentId:query.id,language,sourceUrl:file.url,fetchedAt:source.fetchedAt});
        const rows=extraction.amendments.filter(row=>row.number===number);
        if(rows.length!==1){base.gaps.push('amendment-not-in-published-list');continue;}
        const row=rows[0],losses=amendmentTextLosses(extraction,row);
        if(losses.length||typeof row.originalText!=='string'||typeof row.proposedText!=='string'){base.gaps.push('amendment-wording-incomplete');continue;}
        base.variants.push({listId,language,targetLabel:row.targetLabel,originalText:row.originalText,proposedText:row.proposedText,authors:row.authors.map(name=>({name,personId:null,status:'published-name'})),source,parserVersion:AMENDMENT_EXTRACTION_VERSION,gaps:array(row.gaps)});
      }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;base.gaps.push('amendment-source-unavailable');}
    }
    if(base.gaps.includes('conflicting-list-metadata'))base.variants=[];
    return {...base,status:base.variants.length?'available':'unavailable',basis:base.variants.length?'published-list':null,gaps:[...new Set(base.gaps)]};
  }
}
export const documentContext=new DocumentContext();

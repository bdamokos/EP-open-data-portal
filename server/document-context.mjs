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
import {resolveAmendmentPlacement,resolveDocumentTarget} from './document-context-model.mjs';
import {languageCode} from './ep-links.mjs';
import {proposalBaseline} from './proposal-baseline.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {commissionReferences} from './commission-proposal-identity.mjs';

export const DOCUMENT_CONTEXT_VERSION=3;
export const DOCUMENT_CONTEXT_LIMITS=Object.freeze({procedures:4,adoptedCandidates:8,lists:64,matchingLists:4,metadataBytes:16*1024*1024,entries:12,bytes:12*1024*1024,entryBytes:2*1024*1024,ttl:60_000,extractionEntries:4,extractionBytes:8*1024*1024,extractionTtl:300_000});
const documentId=id=>typeof id==='string'&&/^(?:A|B|RC|TA)-10-\d{4}-\d{4,6}$/.test(id);
const ref=value=>canonicalEPReference(value);
const refs=value=>array(value).map(ref).filter(Boolean);
const canonicalType=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const expectedType=id=>'def/ep-document-types/'+(id.startsWith('TA-')?'TEXT_ADOPTED':id.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':id.startsWith('B-')?'RESOLUTION_MOTION':'REPORT_PLENARY');
const knownDocumentRelationships=(node,field)=>node[field]!=null&&array(node[field]).every(value=>ref(value)?.startsWith('eli/dl/doc/'));
const procedureIds=work=>[...new Set(array(work.inverse_created_a_realization_of).flatMap(value=>{const id=String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');return /^eli\/dl\/proc\/\d{4}-\d{4}[A-Z]?$/.test(id)?[tail(id)]:[];}))];
const workId=node=>node?.identifier||tail(node?.id);
const unavailableTarget=reason=>({status:'unavailable',paragraphs:[],basis:null,relation:null,quoteMatches:null,reason});
const manifestationVersion=descriptor=>{
  const rawSize=descriptor?.byteSize;
  return {byteSize:(typeof rawSize==='number'||typeof rawSize==='string'&&/^\d+$/.test(rawSize))&&Number.isSafeInteger(Number(rawSize))&&Number(rawSize)>=0?Number(rawSize):null,issued:typeof descriptor?.issued==='string'?descriptor.issued:null};
};
const distributionVersion=(list,url)=>{
  const manifestations=array(list.is_realized_by).flatMap(expression=>array(expression.is_embodied_by)).filter(manifestation=>{try{return new URL(manifestation.is_exemplified_by,'https://data.europarl.europa.eu/').href===url;}catch{return false;}});
  return manifestationVersion(manifestations.length===1?manifestations[0]:null);
};
// Declaration identity is independent of whether its download URL is supported.
const declaredDocxFiles=list=>array(list.is_realized_by).flatMap(expression=>array(expression?.is_embodied_by).filter(manifestation=>tail(manifestation?.format)==='DOCX').map(manifestation=>({url:typeof manifestation.is_exemplified_by==='string'?manifestation.is_exemplified_by:null,language:languageCode(expression?.language),sourceVersion:manifestationVersion(manifestation)})));

export function documentContextQuery(id,params) {
  if(!documentId(id))throw new HttpError(400,'invalid_document','Choose a plenary document or adopted resolution.');
  for(const key of params.keys())if(!['lang','amendment','list','wording-lang','adopted','body'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated document query parameter.');
  const amendmentId=params.get('amendment'),listId=params.get('list'),adopted=params.get('adopted');
  if(amendmentId!==null&&amendmentReference('eli/dl/doc/'+amendmentId)?.targetDocumentId!==id)throw new HttpError(400,'invalid_amendment','Choose an amendment to this exact document.');
  if(listId!==null&&(!amendmentId||!new RegExp('^'+id+'-AM-[0-9]{1,5}-[0-9]{1,5}$').test(listId)))throw new HttpError(400,'invalid_list','Choose a published amendment list for this document.');
  const wordingLanguage=params.get('wording-lang');
  if(wordingLanguage!==null&&(!amendmentId||!listId||wordingLanguage!=='unknown'&&!/^[a-z]{2}$/.test(wordingLanguage)))throw new HttpError(400,'invalid_query','wording-lang requires an exact amendment, list and source language.');
  if(adopted!==null&&adopted!=='1')throw new HttpError(400,'invalid_query','adopted must be 1.');
  if(adopted!==null&&(amendmentId||listId||id.startsWith('TA-')))throw new HttpError(400,'invalid_query','Find adopted texts from the original report or motion.');
  if(params.has('body')&&(params.get('body')!=='0'||!amendmentId||adopted!==null))throw new HttpError(400,'invalid_query','body=0 requires an exact amendment.');
  return {id,language:odpLanguage(params.get('lang')||'en'),amendmentId,listId,...(wordingLanguage!==null?{wordingLanguage:wordingLanguage==='unknown'?null:wordingLanguage}:{}),adopted:adopted==='1',includeBody:params.get('body')!=='0'};
}

// This reader discovers only exact linked records for the document being opened.
// It never enqueues indexing or turns missing indexed wording into an empty list.
export class DocumentContext {
  constructor({request=odp,readText=documentText,readProposal=proposalBaseline,download=url=>boundedUpstream(()=>downloadDocxBuffer(url),{source:'documents'}),findAmendment=(store,query)=>amendmentStore.amendmentById?.(store,query)||null,clock=Date.now,limits={}}={}) {
    Object.assign(this,{request,readText,readProposal,download,findAmendment,clock});this.limits={...DOCUMENT_CONTEXT_LIMITS,...limits};this.pending=new Map();this.cache=new Map();this.bytes=0;this.extractions=new Map();this.extractionPending=new Map();this.extractionBytes=0;
  }
  async query(query,{store=null}={}) {
    requestSignal()?.throwIfAborted();
    // Indexed variants are checked on every read, outside the shared source key.
    const candidate=query.amendmentId&&store?this.findAmendment(store,{document:query.id,id:query.amendmentId,language:query.language}):null;
    const exactIdentity=candidate?.id===query.amendmentId||array(candidate?.officialIds).some(value=>ref(value)==='eli/dl/doc/'+query.amendmentId);
    const indexed=exactIdentity&&candidate?.targetDocumentId===query.id?candidate:null;
    const key=createHash('sha256').update(JSON.stringify([query,indexed])).digest('hex');const cached=this.cache.get(key);
    if(cached&&cached.until>this.clock())return cached.value;
    if(cached){this.bytes-=cached.bytes;this.cache.delete(key);}
    let job=this.pending.get(key);
    if(!job) {
      job=sharedRequest(async signal=>{
        const value=await this.collect(query,indexed);signal.throwIfAborted();
        const bytes=Buffer.byteLength(JSON.stringify(value));
        // Retained stale/error sources are readable, but never acquire a new TTL.
        const proposalUnverified=value.baseline&&value.baseline.status!=='available';
        const indexedUnverified=value.amendment?.basis==='index'&&value.amendment.variants.some(variant=>variant.sourceFreshness?.status!=='fresh'||variant.gaps.length||variant.wordingRetained||variant.proposerRetained||variant.recordRetained);
        if(bytes<=this.limits.entryBytes&&!proposalUnverified&&!indexedUnverified&&!value.sources.some(source=>source.stale||source.refreshInProgress||source.refreshError)&&!value.document?.selectedText?.stale&&!value.document?.selectedText?.refreshInProgress&&!value.document?.selectedText?.refreshError&&value.document?.selectedText?.status!=='error'&&!value.amendment?.gaps.length&&!value.related.gaps.length) {
          while(this.cache.size&&(this.cache.size>=this.limits.entries||this.bytes+bytes>this.limits.bytes)){const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}
          signal.throwIfAborted();this.cache.set(key,{value,bytes,until:this.clock()+this.limits.ttl});this.bytes+=bytes;
        }
        return value;
      }).finally(()=>this.pending.delete(key));this.pending.set(key,job);
    }
    return waitForRequest(job);
  }
  async readList(list,file,targetDocumentId) {
    const listId=workId(list),key=createHash('sha256').update(JSON.stringify([AMENDMENT_EXTRACTION_VERSION,list,targetDocumentId,file])).digest('hex'),saved=this.extractions.get(key);
    if(saved&&saved.until>this.clock())return saved.value;
    if(saved){this.extractionBytes-=saved.bytes;this.extractions.delete(key);}
    let job=this.extractionPending.get(key);
    if(!job) {
      job=sharedRequest(async signal=>{
        const {buffer,resolvedSourceUrl}=await this.download(file.url);signal.throwIfAborted();
        const source={url:file.url,resolvedSourceUrl,fetchedAt:new Date(this.clock()).toISOString(),language:file.language,contentHash:createHash('sha256').update(buffer).digest('hex'),retrievedByteSize:buffer.byteLength,sourceVersion:distributionVersion(list,file.url),stale:false,refreshInProgress:false,refreshError:null};
        const extraction=extractAmendments(buffer,{listId,targetDocumentId,language:file.language,sourceUrl:file.url,fetchedAt:source.fetchedAt}),value={extraction,source},bytes=Buffer.byteLength(JSON.stringify(value));
        signal.throwIfAborted();
        if(bytes<=this.limits.extractionBytes) {
          while(this.extractions.size&&(this.extractions.size>=this.limits.extractionEntries||this.extractionBytes+bytes>this.limits.extractionBytes)){const oldest=this.extractions.keys().next().value;this.extractionBytes-=this.extractions.get(oldest).bytes;this.extractions.delete(oldest);}
          this.extractions.set(key,{value,bytes,until:this.clock()+this.limits.extractionTtl});this.extractionBytes+=bytes;
        }
        return value;
      }).finally(()=>this.extractionPending.delete(key));this.extractionPending.set(key,job);
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
    if(canonicalType(work.work_type)!==expectedType(query.id))throw new HttpError(502,'invalid_document_source','Parliament did not return the requested document type.');
    const related={status:'not-requested',items:[],gaps:[]};
    if(query.adopted) {
      related.status='available';const procedures=procedureIds(work),candidates=new Set();
      if(!procedures.length){related.status='unavailable';related.gaps.push('procedure-link-unavailable');}
      else if(procedures.length>this.limits.procedures){related.status='unavailable';related.gaps.push('procedure-budget');}
      else {
        for(const id of procedures)try {
          const {work:procedure}=await read('/procedures/'+id,id,{procedure:true});
          if(!knownDocumentRelationships(procedure,'created_a_realization_of'))related.gaps.push('adopted-relationships-unavailable');
          for(const value of array(procedure.created_a_realization_of)){const valueId=typeof value==='string'?value:value?.id;const normalized=String(valueId||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');if(/^eli\/dl\/doc\/TA-10-\d{4}-\d{4,6}$/.test(normalized))candidates.add(tail(normalized));}
        }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error)||error?.code==='document_source_budget')throw error;related.gaps.push('procedure-unavailable');}
        if(candidates.size>this.limits.adoptedCandidates){related.gaps.push('adopted-candidate-budget');}
        else for(const id of candidates)try {
          const {work:adopted,source}=await read('/adopted-texts/'+id,id);
          if(!knownDocumentRelationships(adopted,'adopts'))related.gaps.push('adopted-reciprocal-relationship-unavailable');
          if(canonicalType(adopted.work_type)!=='def/ep-document-types/TEXT_ADOPTED')related.gaps.push('adopted-record-type-unverified');
          else if(refs(adopted.adopts).includes('eli/dl/doc/'+query.id))related.items.push({...documentSummary(adopted,null),relationship:{from:id,field:'adopts',to:query.id},source});
        }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error)||error?.code==='document_source_budget')throw error;related.gaps.push('adopted-text-unavailable');}
        if(related.gaps.length)related.status=related.items.length?'partial':'unavailable';
      }
    }
    let document=null;
    if(!query.adopted&&query.includeBody!==false)document={...documentSummary(work,null),selectedDocumentId:query.id,selectedDocumentDate:work.document_date||null,selectedText:await this.readText(work,query.language),requestedLanguage:query.language,fetchedAt:new Date(record.fetchedAt).toISOString(),sourceCache:{stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null}};
    const amendment=query.amendmentId?await this.amendment(query,indexed,work,sources,read):null;
    const wordingSelected=Object.hasOwn(query,'wordingLanguage');
    const candidates=amendment?.variants.filter(variant=>!wordingSelected||variant.listId===query.listId&&variant.language===query.wordingLanguage)||[];
    const chosen=candidates.length===1&&candidates[0].wordingStatus==='available'&&(query.listId||!amendment.gaps.length)?candidates[0]:null;
    const differentLanguage=chosen&&(wordingSelected&&chosen.language===null||chosen.language!==document?.selectedText?.textLanguage);
    const referenceDecisions=array(indexed?.decisions).filter(decision=>array(decision.amendmentIds).some(id=>id===query.amendmentId||id===indexed.id)&&typeof decision.reference==='string'&&decision.source?.url&&decision.source?.fetchedAt);
    const references=[...new Set(referenceDecisions.map(decision=>decision.reference))];
    const target=!query.amendmentId||query.includeBody===false?{...unavailableTarget(null),status:'not-requested'}:!chosen?unavailableTarget(amendment?.variants.length?'choose-source-version':'amendment-wording-unavailable'):references.length>1?{...unavailableTarget('conflicting-reference-decisions'),status:'ambiguous'}:differentLanguage?unavailableTarget('different-text-languages'):resolveDocumentTarget(document?.selectedText,{originalText:chosen.originalText,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined,referenceText:references[0],language:chosen.language});
    let placement=chosen&&query.includeBody!==false?resolveAmendmentPlacement(document?.selectedText,{originalText:chosen.originalText,proposedText:chosen.proposedText,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined,referenceText:references[0],language:chosen.language,baseline:['commission-proposal','present-text','council-position','unknown'].includes(chosen.baseline)?'other':chosen.baseline}):query.amendmentId&&query.includeBody!==false?{operation:null,status:'unresolved',reason:'amendment_wording_unavailable',evidence:[]}:null;
    let baseline=null,proposal=null;
    const proposalKind=chosen?.baseline==='commission-proposal';
    if(chosen&&query.includeBody!==false&&proposalKind) {
      const documentReferences=chosen.documentReferences||[];
      const explicit=[...new Set(documentReferences.filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)).flatMap(r=>commissionReferences(r.raw).map(r=>r.celex)))];
      const eligible=typeof chosen.language==='string'&&(query.id.startsWith('A-')||explicit.length===1);
      const source=eligible?await this.readProposal({...(query.id.startsWith('A-')?{reportId:query.id}:{celex:explicit[0]}),language:chosen.language,documentReferences}):null;
      baseline={kind:'commission-proposal',celex:source?.celex??null,workId:source?.workId??null,language:chosen.language,status:source?.status??'unresolved',items:[],gaps:source?.gaps??['proposal-identity-unavailable'],evidence:source?.evidence??[],attribution:'Legal text © European Union. Changes highlighted by this explorer are not an official consolidated text.'};
      const items=[];
      try {
        for(const item of source?.items||[]) {
          requestSignal()?.throwIfAborted();
          const parsed=parseProposal(item.buffer,{language:chosen.language,item:item.kind,sourceUrl:item.source.url,identity:{work:source.workId,expression:item.expressionId,item:item.itemId}});
          items.push({kind:item.kind,index:item.index,proposal:parsed});
          baseline.items.push({kind:item.kind,index:item.index,source:item.source});
        }
        // Bound the public projection as well as the binary and parser caches.
        if(Buffer.byteLength(JSON.stringify(items))>3*1024*1024)throw new RangeError('proposal-response-budget');
        if(items.length)proposal={items};
        placement=proposal&&chosen.language&&(chosen.targetPath?.language??chosen.targetLabelLanguage)===chosen.language?resolveProposalPlacement(items,chosen):{operation:amendmentOperation(chosen),status:'unresolved',reason:proposal?'different_text_languages':'proposal_baseline_unavailable',evidence:[]};
      }catch(error) {
        requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;
        proposal=null;baseline.status='unavailable';baseline.items=[];baseline.gaps.push('proposal-projection-unavailable');
        placement={operation:amendmentOperation(chosen),status:'unresolved',reason:'proposal_baseline_unavailable',evidence:[]};
      }
    } else if(placement&&['present-text','council-position','unknown'].includes(chosen?.baseline)) {
      placement={operation:amendmentOperation(chosen),status:'unresolved',reason:chosen.baseline==='present-text'?'amends_existing_law':chosen.baseline==='council-position'?'council_position_unavailable':'baseline_unknown',evidence:[]};
    }
    if(placement&&!proposalKind&&references.length>1){placement.status='unresolved';placement.reason='conflicting_target_evidence';delete placement.span;delete placement.insertAfter;delete placement.insertBefore;}
    if(proposal&&document)document={...document,selectedText:undefined};
    return {version:DOCUMENT_CONTEXT_VERSION,baseline,proposal,documentId:query.id,requestedLanguage:query.language,...(wordingSelected?{requestedWordingLanguage:query.wordingLanguage}:{}),document,related,amendment,placement,target:{...target,evidence:chosen?{amendmentId:query.amendmentId,listId:chosen.listId,wordingLanguage:chosen.language,wordingSource:chosen.source,targetLabelLanguage:chosen.targetLabelLanguage,targetLabelSource:chosen.targetLabelSource,fieldSources:chosen.fieldSources,referenceDecisions:referenceDecisions.map(decision=>({id:decision.id,reference:decision.reference,language:'en',source:decision.source}))}:null},sources};
  }
  async amendment(query,indexed,work,sources,read) {
    const base={id:query.amendmentId,status:'unavailable',basis:null,variants:[],gaps:[]};
    const variants=indexed?.variants?.length?indexed.variants:indexed?[indexed]:[];
    const selectedVariants=variants.filter(row=>(!query.listId||row.listId===query.listId)&&typeof row.listId==='string');
    const available=row=>row.textIntegrity==='complete'&&typeof row.originalText==='string'&&typeof row.proposedText==='string'&&!row.conflicted;
    if(selectedVariants.length)return {...base,status:selectedVariants.some(available)?'available':'unavailable',basis:'index',gaps:selectedVariants.some(row=>!available(row))?['source-versions-incomplete']:[],variants:selectedVariants.map(row=>({...Object.fromEntries(['baseline','baselineSource','documentReferences','targetPath','targetLabelLanguage','targetLabelSource','fieldSources','textParserVersion','wordingRetained','proposerRetained','recordRetained','listRelationship','metadataSource','proposerSource'].map(key=>[key,row[key]??null])),listId:row.listId,language:row.language,targetLabel:row.targetLabel,wordingStatus:available(row)?'available':'unavailable',originalText:available(row)?row.originalText:null,proposedText:available(row)?row.proposedText:null,authors:row.authors||[],source:row.wordingSource||null,sourceFreshness:row.sourceFreshness||null,gaps:row.gaps||[]}))};
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
      let list=candidate,metadataSource=sources[0];
      if(typeof candidate==='string'||!Object.hasOwn(candidate,'is_realized_by'))try {const result=await read('/plenary-documents/'+listId,listId);list=result.work;metadataSource=result.source;}catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error)||error?.code==='document_source_budget')throw error;base.gaps.push('amendment-list-unavailable');continue;}
      if(workId(list)!==listId||canonicalType(list.work_type)!=='def/ep-document-types/AMENDMENT_LIST'||!refs(list.foresees_change_of).includes('eli/dl/doc/'+query.id)){base.gaps.push('amendment-list-target-unverified');continue;}
      const wordingSelected=Object.hasOwn(query,'wordingLanguage');
      const files=wordingSelected?declaredDocxFiles(list):documentFiles(list).filter(file=>file.format==='DOCX'&&file.language&&allowedDownload(file.url));
      const languages=[...new Set(files.map(file=>file.language))],language=wordingSelected?query.wordingLanguage:languages.includes(query.language)?query.language:languages.includes('en')?'en':languages[0];
      const selected=files.filter(file=>file.language===language);
      // Preserve declared alternatives without downloading unrequested wording.
      // Every same-language file competes, including one we cannot parse.
      const alternatives=wordingSelected?files.map(file=>({listId,language:file.language,targetLabel:null,targetLabelLanguage:null,wordingStatus:'unavailable',originalText:null,proposedText:null,authors:[],source:{...(file.url!==null?{url:file.url}:{}),language:file.language,sourceVersion:file.sourceVersion},metadataSource,gaps:[file.language===language?'amendment-wording-unavailable':'wording-not-requested']})):[];
      base.variants.push(...alternatives);
      if(selected.length!==1){base.gaps.push('amendment-file-unavailable-or-ambiguous');continue;}
      let file=selected[0];
      if(wordingSelected) {
        let url=null;try{if(file.url!==null)url=new URL(file.url,'https://data.europarl.europa.eu/').href;}catch{/* Keep malformed declarations unavailable. */}
        file=documentFiles(list).find(candidate=>candidate.format==='DOCX'&&candidate.language===language&&candidate.url===url&&allowedDownload(candidate.url));
        if(!file){base.gaps.push('amendment-file-unavailable-or-ambiguous');continue;}
      }
      try {
        const {extraction,source}=await this.readList(list,file,query.id);sources.push(source);
        const rows=extraction.amendments.filter(row=>row.number===number);
        if(rows.length!==1){base.gaps.push('amendment-not-in-published-list');continue;}
        const row=rows[0],losses=amendmentTextLosses(extraction,row);
        if(losses.length||typeof row.originalText!=='string'||typeof row.proposedText!=='string'){base.gaps.push('amendment-wording-incomplete');continue;}
        const variant={listId,language,baseline:row.baseline ?? 'unknown',baselineSource:row.baselineSource??null,documentReferences:row.documentReferences??[],targetPath:row.targetPath??null,targetLabel:row.targetLabel,targetLabelLanguage:language,targetLabelSource:source,fieldSources:{wording:source,targetLabel:source},wordingStatus:'available',originalText:row.originalText,proposedText:row.proposedText,authors:row.authors.map(name=>({name,personId:null,status:'published-name'})),source,parserVersion:AMENDMENT_EXTRACTION_VERSION,gaps:array(row.gaps)};
        if(wordingSelected)Object.assign(alternatives[files.indexOf(selected[0])],variant);else base.variants.push(variant);
      }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;base.gaps.push('amendment-source-unavailable');}
    }
    if(base.gaps.includes('conflicting-list-metadata'))base.variants=[];
    return {...base,status:base.variants.some(variant=>variant.wordingStatus==='available')?'available':'unavailable',basis:base.variants.length?'published-list':null,gaps:[...new Set(base.gaps)]};
  }
}
export const documentContext=new DocumentContext();

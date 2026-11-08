import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setImmediate as turn} from 'node:timers/promises';
import {runBaseBackfill} from './base-source-backfill-context.mjs';
import {baseSourceKey} from './base-source-descriptor.mjs';
import {amendmentsPage,amendmentGeneration} from './amendments-store.mjs';
import {amendmentReference} from './amendments.mjs';
import {displayableAmendmentVersion} from './amendment-display-version.mjs';
import {DocumentContext,DOCUMENT_CONTEXT_VERSION} from './document-context.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {DOCX_EXTRACTION_VERSION} from './docx-source-structure.mjs';
import {documentContextPlacement,proposalInstructionTarget} from './document-context-placement.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {amendmentProvisional,provisionalDecision} from './amendment-provisional.mjs';
import {hasCouncilQuotation,reportCouncilQuotation} from './report-council-quotation.mjs';
import {commissionReferences,commissionProcedures} from './commission-proposal-identity.mjs';
import {COMMITTEE_DOCUMENT_TYPES,committeeDocumentEndpoint,committeeDraftId,committeeListId} from './committee-amendments.mjs';
import {createProposalBaseline} from './proposal-baseline.mjs';
import {createCouncilPositionBaseline} from './council-position-baseline.mjs';
import {createExistingLawBaseline} from './existing-law-baseline.mjs';
import {CellarDocuments,CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME,cellarTransportUrl} from './cellar-documents.mjs';
import {OfficialContextSources,officialSourceUrl} from './official-context.mjs';
import {documentText,docxContent,allowedDownload} from './document-text.mjs';
import {parsePublicLegalXhtml,PUBLIC_LEGAL_XHTML_VERSION} from './public-legal-xhtml.mjs';
import {parseProposal,PROPOSAL_PARSER_VERSION} from './proposal-structure.mjs';
import {array} from './activity-index-model.mjs';
import {amendmentLanguagePreference} from './language-order.mjs';
import {publishDocumentImages} from './document-image-store.mjs';
import {ODP_BASE,odp} from './odp.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';

export const SOURCE_NOT_HELD='source-not-held';
const notHeld=()=>Object.assign(new Error('The source is not held.'),{code:SOURCE_NOT_HELD});
const sha256=value=>createHash('sha256').update(value).digest('hex');
const STRUCTURED_RESPONSE_BYTES=3*1024*1024;
// When any of these changes, a failure may have been fixed. The placement rules
// carry no version of their own, so their files count too, and so does this
// evaluator: a fix to it retries lists that could not be evaluated.
const PLACEMENT_RULES=['document-context.mjs','document-context-model.mjs','document-context-placement.mjs','proposal-placement.mjs','existing-law-placement.mjs','amendment-provisional.mjs','placement-log-evaluate.mjs'];
const rulesDigest=()=>{const hash=createHash('sha256');for(const file of PLACEMENT_RULES)hash.update(readFileSync(new URL('./'+file,import.meta.url)));return hash.digest('hex');};
export const placementEvaluator=()=>JSON.stringify({rules:rulesDigest(),documentContext:DOCUMENT_CONTEXT_VERSION,extraction:AMENDMENT_EXTRACTION_VERSION,docx:DOCX_EXTRACTION_VERSION,proposal:PROPOSAL_PARSER_VERSION,legal:PUBLIC_LEGAL_XHTML_VERSION});

// The vocabulary and order of scripts/amendment-benchmark-model.mjs classify(),
// without its oracle stages: this log reports what the reader would show, so
// "placed" is not "correct". A test keeps the two tables in step.
export const PLACEMENT_LOG_OUTCOMES=Object.freeze(['placed','not-applicable','withheld-pipeline','withheld-source','acquisition-unavailable']);
export const FIXABLE_OUTCOME='withheld-pipeline';
const stageOutcome=reason=>reason?.startsWith('acquisition-')?'acquisition-unavailable':['source-document-unavailable','source-wording-empty'].includes(reason)?'withheld-source':FIXABLE_OUTCOME;
export function placementOutcome({wording,source,placement}) {
  if(placement?.status==='report-quotation')return {outcome:FIXABLE_OUTCOME,reason:'council-text-as-quoted-in-report'};
  if(wording?.status!=='passed')return {outcome:stageOutcome(wording?.reason),reason:wording?.reason};
  if(placement?.status==='not-applicable')return {outcome:'not-applicable',reason:placement.reason};
  if(['placed','document-operation'].includes(placement?.status))return {outcome:'placed',reason:placement.status};
  if(source?.status!=='passed')return {outcome:stageOutcome(source?.reason),reason:source?.reason};
  return {outcome:FIXABLE_OUTCOME,reason:placement?.reason||'placement-not-evaluated'};
}

// Direct descriptor reads: the store's inventory scan is a full directory read
// and belongs to the backfill. A DOCX can be held under its negotiated type.
export function heldBaseSources(directory,{onMiss=()=>{}}={}) {
  const folder=directory&&path.join(directory,'base-sources-v1');
  const readRecord=async(url,request)=>{
    if(!folder)return null;
    let record;try{record=JSON.parse(await readFile(path.join(folder,baseSourceKey(url,request)+'.json'),'utf8'));}catch{return null;}
    if(record.status!==200||!/^[a-f0-9]{64}$/.test(record.sha256||''))return null;
    let buffer;try{buffer=await readFile(path.join(folder,record.sha256+'.blob'));}catch{return null;}
    return buffer.length===record.bytes&&sha256(buffer)===record.sha256?{record,buffer}:null;
  };
  return async({url,accept,language})=>{
    const accepts=accept===CELLAR_DOCX_MIME?[CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME]:[accept??'*/*'];
    // An EP document names its language in the file name, not in the reader's request.
    const named=/_([a-z]{2})\.docx$/u.exec(url)?.[1];
    for(const candidate of accepts)for(const requested of language?[language]:[...new Set([undefined,named,'en'])]){
      const held=await readRecord(url,{accept:candidate,...(requested?{language:requested}:{})});
      if(held)return held;
    }
    onMiss();return null;
  };
}

// Every reader below takes its clients as arguments, as the benchmark replay
// does: no placement or source module changes, and no network path. A read that
// misses is counted, so "not held" stays distinct from a failed identity check.
export function heldSourceClients({store,generation,directory=process.env.ODP_CACHE_DIR,clock=Date.now}) {
  let misses=0;
  const miss=()=>{misses++;};
  const held=heldBaseSources(directory,{onMiss:miss});
  const refuse=()=>{miss();throw notHeld();};
  const sources=new OfficialContextSources({directory:directory?path.join(directory,'official-context-v1'):null,clock,fetchSource:refuse,run:operation=>operation()});
  const documents=new CellarDocuments({sources,fetchSource:refuse,clock,directory:directory?path.join(directory,'commission-proposals-v1'):null});
  // Holding is the backfill's work; this reader never stores anything. It also
  // skips the origin queues, whose spacing only protects a real request.
  documents.retainResponse=async()=>{};
  documents.save=async(key,record)=>{documents.remember(key,record);return record;};
  documents.request=async(input,{accept,language}={})=>{
    const found=await held({url:cellarTransportUrl(input),accept,language});
    if(!found)refuse();
    return {status:200,url:found.record.resolvedSourceUrl||found.record.url,accept:found.record.request?.accept||accept,contentType:found.record.headers?.['content-type'],buffer:found.buffer};
  };
  // Saved records only, served here: the source's own read would try to retain
  // what it serves, which this reader must not do.
  sources.get=async(input,options={})=>{
    const url=officialSourceUrl(input).href,key=['official-context-v1',url,...(options.cacheScope?[options.cacheScope]:[])];
    const found=url.includes('/webapi/')?await held({url,accept:'application/sparql-results+json'}):null;
    const record=found?{url,fetchedAt:found.record.fetchedAt,data:JSON.parse(found.buffer)}:(await sources.cache.stored(sources.cache.key(key)))?.value;
    if(!record)refuse();
    options.validate?.(record);
    return record;
  };
  const request=async(endpoint,params={},options={})=>{
    // The index projection drops alternative titles, which carry a report's
    // proposal reference: prefer the saved response and fall back to the index.
    try {return await odp(endpoint,params,{...options,staleWhileRevalidate:false,cachedOnly:true,priority:'background'});}
    catch(error){if(error.code!=='odp_cache_miss')throw error;}
    const saved=store.sourceMetadata(generation,endpoint);
    if(saved?.work)return {payload:{data:[saved.work]},url:ODP_BASE+endpoint+'?format=application%2Fld%2Bjson',fetchedAt:Date.parse(saved.fetchedAt),stale:false,refreshInProgress:false,refreshError:null};
    miss();throw Object.assign(new Error('The source is not held.'),{code:'odp_cache_miss'});
  };
  // Direct reads again: the list store's own read also tidies its folder and repairs
  // its rows, which are the writer's job.
  const heldList=async url=>{
    if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='amendment_sources'").get())return null;
    const row=store.db.prepare('SELECT sha256,size,retrieved_at FROM amendment_sources WHERE url=? ORDER BY retrieved_at DESC LIMIT 1').get(url);
    if(!row)return null;
    let buffer;try{buffer=await readFile(path.join(path.dirname(store.filename),'amendment-docx-v2',row.sha256+'.docx'));}catch{return null;}
    return buffer.length===row.size&&sha256(buffer)===row.sha256?{buffer,fetchedAt:row.retrieved_at}:null;
  };
  const download=async url=>{
    if(!allowedDownload(url))throw notHeld();
    const heldSource=await held({url,accept:'*/*'});
    if(heldSource)return {buffer:heldSource.buffer,fetchedAt:heldSource.record.fetchedAt,resolvedSourceUrl:heldSource.record.resolvedSourceUrl||url,freshnessAssessed:false};
    const saved=await heldList(url);
    if(saved)return {...saved,resolvedSourceUrl:url,freshnessAssessed:false};
    return refuse();
  };
  const readText=(work,language)=>documentText(work,language,{directory,enqueue:false,clock,download:async url=>{
    const {buffer,resolvedSourceUrl}=await download(url);
    return {...docxContent(buffer,{includeNoteObjects:true}),resolvedSourceUrl};
  }});
  return {
    request,download,readText,documents,held,
    misses:()=>misses,
    readProposal:createProposalBaseline({documents,request}),
    readCouncil:createCouncilPositionBaseline({documents,request}),
    readExistingLaw:createExistingLawBaseline({documents}),
    run:operation=>runBaseBackfill({held,hit(){},full:false},operation),
  };
}

// Whether JSON.stringify(value) would pass the limit, stopping as soon as it does:
// the largest proposals are many times over it, and the string is never built.
export function jsonBytesOver(value,limit) {
  let bytes=0;
  const walk=node=>{
    if(bytes>limit)return;
    if(typeof node==='string'){bytes+=Buffer.byteLength(JSON.stringify(node));return;}
    if(node===null||typeof node!=='object'){bytes+=String(JSON.stringify(node)).length;return;}
    if(Array.isArray(node)){bytes+=2+Math.max(0,node.length-1);for(const item of node)if(item===undefined||typeof item==='function')bytes+=4;else walk(item);return;}
    const entries=Object.entries(node).filter(([,item])=>item!==undefined&&typeof item!=='function');
    bytes+=2+Math.max(0,entries.length-1);
    for(const [key,item] of entries){bytes+=Buffer.byteLength(JSON.stringify(key))+1;walk(item);}
  };
  walk(value);
  return bytes>limit;
}
// The reader's own response budget, which leaves the same amendment unplaced. It
// measures the main baseline with image descriptors and the frame with sources.
const parseItems=async(source,options,{legal,frame=false})=>{
  const items=[];
  for(const item of source?.items||[]) {
    const proposal=(item.format==='PDF'||!legal?parseProposal:parsePublicLegalXhtml)(item.projection??item.buffer,{...options,item:item.kind,sourceUrl:item.source.url,identity:{work:source.workId,expression:item.expressionId,item:item.itemId,...(legal?{celex:source.celex}:{})}});
    items.push({kind:item.kind,index:item.index,source:item.source,proposal:frame?proposal:{...proposal,imageAssets:await publishDocumentImages(proposal)}});
  }
  if(jsonBytesOver(frame?items:items.map(({source:_,...item})=>item),STRUCTURED_RESPONSE_BYTES))throw new RangeError('proposal-response-budget');
  return items;
};

// The same selection and fallbacks as DocumentContext.collect(), which is the
// source of truth for a reader. It parses the baseline again on every call, so a
// list cannot go through it; parsed baselines are shared per list here instead.
// The tests run both over the same rows and compare status and reason.
export async function evaluateAmendment({id,listId,documentId,indexed,work,rootSource,clients,context,memo}) {
  const fail=reason=>placementOutcome({wording:{status:'blocked',reason}});
  const query={id:documentId,amendmentId:id,listId,language:null};
  const selected=(indexed.variants?.length?indexed.variants:[indexed]).filter(row=>row.listId===listId);
  if(!selected.length)return {language:null,...fail('acquisition-wording-not-held')};
  // The edition a reader opens by default: English first, then the list's others.
  const edition=amendmentLanguagePreference(selected.map(row=>row.language).filter(Boolean),'en')[0]??null;
  query.language=edition??'en';query.wordingLanguage=edition;
  const reads=new Map();
  const read=async endpoint=>{
    if(reads.has(endpoint))return reads.get(endpoint);
    const record=await clients.request(endpoint,{}, {});
    const node=record.payload?.data?.[0];
    const source={url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:false,refreshInProgress:false,refreshError:null,contentHash:sha256(JSON.stringify(record.payload))};
    const result={work:node,record,source};reads.set(endpoint,result);return result;
  };
  const amendment=await context.amendment(query,indexed,work,[],read,rootSource,new Map());
  let candidates=amendment.variants.filter(variant=>variant.listId===listId&&variant.language===query.wordingLanguage);
  const language=candidates[0]?.language??edition;
  const outcome=value=>({language,...value});
  if(candidates.length!==1)return outcome(fail('acquisition-wording-not-held'));
  let chosen=candidates[0];
  // A provisional agreement places the whole document from the exact source,
  // with or without comparison columns, as the reader does.
  const provisional=async()=>{
    const url=candidates[0].source?.url;
    if(!provisionalDecision(indexed.decisions,id)||!allowedDownload(url))return null;
    try {
      const downloaded=await clients.download(url);
      return amendmentProvisional({amendmentId:id,documentId,listId:candidates[0].listId,decisions:indexed.decisions,buffer:downloaded.buffer,source:{url,language:candidates[0].language,fetchedAt:downloaded.fetchedAt}});
    }catch{return null;/* A reader falls back to the existing result too. */}
  };
  const whole=async reason=>{const operation=await provisional();return outcome(operation?placementOutcome({wording:{status:'passed'},placement:operation}):fail(reason));};
  if(chosen.wordingStatus!=='available') {
    const row=selected.find(variant=>variant.language===edition)||selected[0];
    // Text the parser lost is ours; a row with no wording yet is not.
    if(row.conflicted)return whole('wording-conflicted');
    // Withheld until the parser upgrade reaches this list; the next pass decides.
    if(!displayableAmendmentVersion(row.textParserVersion))return whole('acquisition-wording-awaiting-reparse');
    if(row.textIntegrity==='incomplete')return whole('wording-incomplete');
    return whole('acquisition-wording-not-held');
  }
  if(!chosen.originalText.trim()&&!chosen.proposedText.trim())return whole('source-wording-empty');
  const wording={status:'passed'};
  const textKey=JSON.stringify(['text',language]);
  if(!memo.has(textKey))memo.set(textKey,await clients.readText(work,language));
  let text=memo.get(textKey);
  const textLanguages=text?.availableTextLanguages||[];
  const structuredBaseline=['commission-proposal','council-position','present-text'].includes(chosen.baseline);
  let translated=null;
  // Only a missing publication language permits a translation of this exact list.
  if(language&&textLanguages.length&&!textLanguages.includes(language)&&!structuredBaseline) {
    const key=JSON.stringify(['translation',listId,id]);
    const fallback=await context.amendment({...query,wordingLanguage:undefined,matchingTextLanguages:textLanguages},null,work,[],read,rootSource).catch(()=>null);
    const readable=fallback?.variants?.filter(variant=>variant.wordingStatus==='available')||[];
    if(readable.length===1) {
      chosen=readable[0];translated=key;
      const translatedKey=JSON.stringify(['text',chosen.language]);
      if(!memo.has(translatedKey))memo.set(translatedKey,await clients.readText(work,chosen.language));
      text=memo.get(translatedKey);
    }
  }
  const differentLanguage=text?.paragraphs?.length&&(chosen.language!==text.textLanguage);
  const referenceDecisions=array(indexed.decisions).filter(decision=>array(decision.amendmentIds).some(value=>value===id||value===indexed.id)&&typeof decision.reference==='string'&&decision.source?.url&&decision.source?.fetchedAt);
  const references=[...new Set(referenceDecisions.map(decision=>decision.reference))];
  const unaffected=amendmentLanguageScope(chosen),mixedScope=amendmentMixedLanguageScope(chosen);
  const amendmentNumber=amendmentReference('eli/dl/doc/'+id)?.number;
  const workType=String(work.work_type?.id||work.work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'');
  const resolutionDocument=['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT',...Object.keys(COMMITTEE_DOCUMENT_TYPES)].some(type=>workType==='def/ep-document-types/'+type);
  const options={chosen:{...chosen,addressEditions:amendment.variants.filter(variant=>variant.listId===chosen.listId&&variant.wordingStatus==='available')},amendmentNumber,text,referenceTexts:references,resolutionDocument,includeBody:true,amendmentRequested:true};
  let placement=documentContextPlacement(options);
  let baseline=null,structured=null;
  const proposalKind=chosen.baseline==='commission-proposal'&&chosen.baselineSource?.category==='commission-proposal'&&chosen.baselineSource.conflicted===false;
  const councilKind=chosen.baseline==='council-position'&&chosen.baselineSource?.category==='council-position'&&chosen.baselineSource.conflicted===false||hasCouncilQuotation(chosen);
  const existingKind=chosen.baseline==='present-text'&&chosen.baselineSource?.category==='present-text'&&chosen.baselineSource.conflicted===false;
  const isNle=refs=>[...array(work.is_realized_by).flatMap(expression=>Object.values(expression.title_alternative||{}).flat()),...refs.map(reference=>reference.raw)].some(raw=>commissionProcedures(raw).some(procedure=>procedure.endsWith('(NLE)')));
  let missedRead=false;
  if(!unaffected&&(proposalKind||councilKind||existingKind)) {
    const documentReferences=chosen.documentReferences||[];
    const explicit=[...new Set(documentReferences.filter(reference=>reference.field==='DocRef'||/^DocAmend\d?$/.test(reference.field)).flatMap(reference=>commissionReferences(reference.raw).map(value=>value.celex)))];
    const reportBaseline=documentId.startsWith('A-')||committeeDraftId(documentId);
    const eligible=typeof chosen.language==='string'&&(reportBaseline||explicit.length===1);
    const nle=proposalKind&&isNle(documentReferences);
    const key=JSON.stringify([existingKind?'law':councilKind?'council':'proposal',chosen.language,documentReferences,existingKind?chosen.targetPath:null,existingKind?(chosen.documentDate||chosen.date||chosen.listDocumentDate):null,nle?id:null]);
    if(!memo.has(key)) {
      const before=clients.misses();
      const nativeReferencePair=nle&&eligible?await context.readNleReferences(query,chosen,work,read,[],new Map(),rootSource):undefined;
      const source=existingKind?await clients.readExistingLaw(chosen):councilKind?(typeof chosen.language==='string'&&reportBaseline?await clients.readCouncil({reportId:documentId,language:chosen.language,documentReferences}):null):eligible?await clients.readProposal({...(reportBaseline?{reportId:documentId}:{celex:explicit[0]}),language:chosen.language,documentReferences,...(nle?{nativeReferencePair}:{})}):null;
      const saved={source,before:clients.misses()-before};
      try {saved.items=await parseItems(source,{language:chosen.language},{legal:councilKind||existingKind});}
      catch{saved.unavailable=true;}
      memo.set(key,saved);
    }
    const saved=memo.get(key),source=saved.source;
    // A refusal can also come back from a client's own short failure memory.
    missedRead=saved.before>0||array(source?.gaps).some(gap=>[SOURCE_NOT_HELD,'odp_cache_miss'].includes(gap?.code??gap));
    baseline={actLabel:existingKind?chosen.targetPath?.underlying?.[0]?.document??null:null,productionWorkId:source?.productionWorkId??null,productionVersion:source?.productionVersion??null,productionExpressionId:source?.productionExpressionId??null,baseCelex:source?.baseCelex??null,consolidationDate:source?.date??null,amendmentDate:source?.amendmentDate??null,selectionBasis:source?.selectionBasis??null,kind:existingKind?'existing-act':councilKind?'council-position':'commission-proposal',celex:source?.celex??null,workId:source?.workId??null,language:chosen.language,status:source?.status??'unresolved',items:[],gaps:source?.gaps??['proposal-identity-unavailable'],evidence:source?.evidence??[]};
    if(saved.unavailable) {
      baseline.status='unavailable';baseline.gaps=[...baseline.gaps,'proposal-projection-unavailable'];
      if(!mixedScope)placement={operation:amendmentOperation(chosen),status:'unresolved',reason:existingKind?'existing-law-baseline-unavailable':councilKind?'council_position_unavailable':'proposal_baseline_unavailable',evidence:[]};
    } else {
      structured=saved.items;
      placement=documentContextPlacement({...options,...(councilKind?{chosen:{...options.chosen,baseline:'council-position',baselineSource:{...chosen.baselineSource,category:'council-position'}}}:{}),baseline,items:structured.length?structured:null,nativeProposalInputs:source?.items?.map(item=>item.buffer)});
    }
    // The amendment-instruction frame, located in the report's proposal.
    if(existingKind&&placement?.status!=='placed'&&!mixedScope&&documentId.startsWith('A-')&&!isNle(documentReferences)&&proposalInstructionTarget(chosen)) {
      const frameKey=JSON.stringify(['frame',chosen.language,documentReferences]);
      if(!memo.has(frameKey)) {
        const frame=await clients.readProposal({reportId:documentId,language:chosen.language,documentReferences}).catch(()=>null);
        let frameItems=null;try{frameItems=await parseItems(frame,{language:chosen.language},{legal:false,frame:true});}catch{/* The reader also leaves the first placement in place. */}
        memo.set(frameKey,{frame,frameItems});
      }
      const {frame,frameItems}=memo.get(frameKey);
      if(frame?.language===chosen.language&&frameItems?.length) {
        const framed=documentContextPlacement({...options,baseline,items:structured?.length?structured:null,proposalItems:frameItems});
        if(framed?.frame==='commission-proposal'){placement=framed;structured=frameItems;baseline={...baseline,status:frame.status??'unresolved',language:chosen.language};}
      }
    }
  }
  if(placement?.status==='unresolved'&&hasCouncilQuotation(chosen)&&text?.textLanguage===chosen.language&&allowedDownload(text.sourceUrl)) {
    try {
      const downloaded=await clients.download(text.sourceUrl);
      placement=reportCouncilQuotation(downloaded.buffer,{...chosen,number:Number(id.match(/-AM-(\d+)$/u)?.[1])},{operation:amendmentOperation(chosen),reportId:documentId,sourceUrl:text.sourceUrl,fetchedAt:downloaded.fetchedAt})??placement;
    }catch{/* A reader falls back to the existing result too. */}
  }
  const operation=await provisional();
  if(operation)placement=operation;
  const matching=language&&(existingKind||proposalKind||councilKind?baseline?.language===chosen.language&&Boolean(structured?.length):!differentLanguage&&text?.textLanguage===chosen.language&&Boolean(text?.paragraphs?.length));
  let sourceReason;
  if(!matching) {
    if(missedRead)sourceReason='acquisition-source-not-held';
    else if(!language||!(existingKind||proposalKind||councilKind)&&differentLanguage)sourceReason='acquisition-matching-language-unavailable';
    else if(existingKind||proposalKind||councilKind)sourceReason=baseline?.gaps?.includes('proposal-projection-unavailable')?'proposal-projection-unavailable':existingKind?String(baseline?.gaps?.[0]?.code??baseline?.gaps?.[0]??'existing-law-baseline-unavailable'):councilKind?'council_position_unavailable':'acquisition-proposal-source-unavailable';
    else sourceReason='acquisition-source-not-held';
  }
  return {language,translated:Boolean(translated),...placementOutcome({wording,source:matching?{status:'passed'}:{status:'blocked',reason:sourceReason},placement})};
}

// All placement work runs on the caller's thread, never the HTTP or writer's.
// The reader's checked rows, one target read per list. Its per-amendment read scans
// the target for every call, which over a whole list reached 3 GiB on the largest.
const PAGE=500;
export function readAmendments(store,{documentId,listId,committee}) {
  return store.readSnapshot(()=>{
    const rows=[];
    for(let offset=0;;offset+=PAGE) {
      const {items}=amendmentsPage(store,committee?{scope:'committee',list:listId,limit:PAGE,offset}:{document:documentId,limit:PAGE,offset});
      rows.push(...items.filter(row=>(row.variants?.length?row.variants:[row]).some(variant=>variant.listId===listId)));
      if(items.length<PAGE)return rows.sort((a,b)=>Number(a.number)-Number(b.number)||(a.id<b.id?-1:1));
    }
  });
}
export async function evaluateList({store,listId,directory=process.env.ODP_CACHE_DIR,signal,clock=Date.now,readAmendments:read=readAmendments}) {
  const generation=amendmentGeneration(store);
  const committee=committeeListId(listId);
  const saved=store.db.prepare("SELECT json_extract(body,'$.targetDocumentId') target,json_extract(body,'$.scopeKey') scope_key,json_extract(body,'$.itemNumberBegin') first_item,json_extract(body,'$.itemNumberEnd') last_item FROM sources WHERE generation=? AND key=? AND kind='amendment-list'").get(generation,'amendment:list:'+listId);
  if(!saved)return {listId,generation,documentId:null,scope:committee?'committee':'plenary',amendments:[],unavailable:'indexed-list-unavailable'};
  // A committee amendment reads against its draft, as the reader opens it.
  const documentId=saved.target||listId,rowsTarget=committee?saved.scope_key:saved.target;
  const rows=read(store,{documentId,listId,committee});
  const clients=heldSourceClients({store,generation,directory,clock});
  const context=new DocumentContext({request:clients.request,readText:clients.readText,readProposal:clients.readProposal,readCouncil:clients.readCouncil,readExistingLaw:clients.readExistingLaw,download:clients.download,clock});
  const endpoint=committeeDocumentEndpoint(documentId)||'/plenary-documents/'+documentId;
  return clients.run(async()=>{
    let root=null;try{root=await clients.request(endpoint,{}, {});}catch{/* Each row records the missing root below. */}
    const work=root?.payload?.data?.[0]??null;
    const rootSource=root?{url:root.url,fetchedAt:new Date(root.fetchedAt).toISOString(),stale:false,refreshInProgress:false,refreshError:null,contentHash:sha256(JSON.stringify(root.payload))}:null;
    const memo=new Map(),amendments=[];
    for(const indexed of rows) {
      signal?.throwIfAborted();
      const id=indexed.id;
      let result;
      if(!work)result={language:null,...placementOutcome({wording:{status:'blocked',reason:'acquisition-source-not-held'}})};
      else {
        try {result=await evaluateAmendment({id,listId,documentId,indexed,work,rootSource,clients,context,memo});}
        catch(error) {
          if(signal?.aborted)throw error;
          result={language:null,...placementOutcome({wording:{status:'blocked',reason:[SOURCE_NOT_HELD,'odp_cache_miss'].includes(error?.code)?'acquisition-source-not-held':'evaluation-error'}})};
        }
      }
      const row={id,listId,documentId,language:result.language,outcome:result.outcome,reason:result.reason};
      amendments.push(row);
      await turn();
    }
    const declared=Number.isSafeInteger(saved.first_item)&&Number.isSafeInteger(saved.last_item)?saved.last_item-saved.first_item+1:null;
    return {listId,generation,documentId,scope:committee?'committee':'plenary',declared,amendments,sourceMisses:clients.misses()};
  });
}

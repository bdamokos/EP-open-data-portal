import {createHash} from 'node:crypto';
import {documentContext} from './document-context.mjs';
import {odp,ODP_BASE} from './odp.mjs';
import {documentText,allowedDownload} from './document-text.mjs';
import {parseProposal,parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
import {languageCode} from './ep-links.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {createRequestBudget,requestSignal,runWithRequestSignal,waitForRequest} from './request-budget.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {createFinalActReader,finalActCorrespondence} from './final-act-identity.mjs';
import {amendmentById} from './amendments-store.mjs';
import {amendmentRowOutcome} from './amendments.mjs';

export const AMENDMENT_FINAL_TEXT_VERSION=1;
export const FINAL_TEXT_LIMITS=Object.freeze({deadlineMs:28_000,concurrency:2,metadataReads:16,metadataBytes:4*1024*1024,contextBytes:6*1024*1024,bodyBytes:2*1024*1024,candidates:8,units:6000,passageCharacters:64*1024});
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const unique=values=>[...new Set(values)];
const sha=value=>createHash('sha256').update(value).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
const ep=value=>String(value?.id??value??'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'');
const docId=value=>ep(value).match(/^eli\/dl\/doc\/([A-Z0-9-]+)$/u)?.[1]??null;
const type=work=>ep(work?.work_type).replace('def/ep-document-types/','');
const relationships=(work,field)=>work[field]==null?null:array(work[field]).every(value=>docId(value))?unique(array(work[field]).map(docId)):null;
const procedures=work=>work.inverse_created_a_realization_of==null?null:array(work.inverse_created_a_realization_of).every(value=>/^eli\/dl\/proc\/\d{4}-\d{4}$/u.test(ep(value)))?unique(array(work.inverse_created_a_realization_of).map(value=>ep(value).split('/').at(-1))):null;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const unavailable=gap=>({status:'unavailable',wholeProvision:null,operation:null,mapping:null,passages:null,components:[],gaps:[gap]});

/** Presentation normalization only: punctuation, case, numbers and cross-
 * references remain substantive. This is intentionally stricter than placement. */
export const normalizeFinalWording=value=>String(value).normalize('NFC').replace(/\u00ad/gu,'').replace(/[\u00a0\u202f]/gu,' ').replace(/\s+/gu,' ').trim();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children||[])]);
const address=path=>path.filter(({kind})=>['article','paragraph','point','recital','annex'].includes(kind)).map(({kind,value})=>kind==='paragraph'?`(${value})`:kind==='point'?`(${value})`:`${kind[0].toUpperCase()+kind.slice(1)} ${value}`).join(' ').replace(/\s+\(/gu,'(');
const stripLabel=(text,unit)=>{
  const label=unit?.label;
  if(!label||!['paragraph','point','recital'].includes(unit.kind))return text;
  return text.replace(new RegExp('^\\s*(?:\\('+escape(label.value)+'\\)|'+escape(label.value)+'[.)])\\s*','u'),'');
};
const passage=(proposal,unit)=>({text:proposal.paragraphs.slice(unit.extent.start,unit.extent.end).map(row=>row.text).join('\n'),address:address(unit.path),path:unit.path.map(({kind,value})=>({kind,value})),unitId:unit.id,extent:unit.extent,sourceHash:proposal.sourceHash,sourceUrl:proposal.sourceUrl,complete:true});
function completeUnit(proposal,unit) {
  return unit.complete===true&&!unit.pathConflict&&unit.scope==='proposal'&&unit.normative!==false&&unit.extent.end>unit.extent.start&&proposal.paragraphs.slice(unit.extent.start,unit.extent.end).every(row=>row.complete===true&&row.source?.complete!==false&&!row.text.includes('\uFFFC'))&&!proposal.gaps?.some(gap=>Number.isInteger(gap.paragraph)&&gap.paragraph>=unit.extent.start&&gap.paragraph<unit.extent.end);
}
const normalizedPassage=(proposal,unit)=>normalizeFinalWording(stripLabel(passage(proposal,unit).text,unit));
const occurrences=(text,part)=>{if(!part)return 0;let count=0,at=text.indexOf(part);while(at>=0){count++;at=text.indexOf(part,at+1);}return count;};

// Two disjoint unchanged anchors must identify exactly one complete provision.
// An absent match in the whole document never produces a negative result.
function anchorMapping(original,proposed,baseline,candidates,signal) {
  const words=original.split(' '),anchors=[];
  for(let i=0;i+5<=words.length&&anchors.length<80;i++) {
    const text=words.slice(i,i+5).join(' ');
    if(text.length>=24&&occurrences(original,text)===1&&occurrences(proposed,text)===1&&occurrences(baseline,text)===1)anchors.push(text);
  }
  const matches=[];
  for(const candidate of candidates) {
    signal?.throwIfAborted();const present=anchors.filter(anchor=>occurrences(candidate.normal,anchor)===1);
    let pair=null;
    for(let i=0;i<present.length&&!pair;i++)for(let j=i+1;j<present.length;j++) {
      const left=present[i],right=present[j];
      if(original.indexOf(left)+left.length<=original.indexOf(right)&&candidate.normal.indexOf(left)+left.length<=candidate.normal.indexOf(right)){pair={left,right};break;}
    }
    if(pair)matches.push({...candidate,anchors:pair});
  }
  return matches.length===1?matches[0]:null;
}

// One bounded edit can survive a rewritten remainder. The interval includes all
// inserted/substituted text between unchanged anchors; substring presence cannot
// retain a conditionally qualified insertion or a changed quantity/negation.
function retainedComponent(original,proposed,destination) {
  let start=0;while(start<original.length&&start<proposed.length&&original[start]===proposed[start])start++;
  let end=0;while(end<original.length-start&&end<proposed.length-start&&original.at(-end-1)===proposed.at(-end-1))end++;
  const before=original.slice(0,start),after=end?original.slice(-end):'';
  const left=before.trim().split(' ').slice(-5).join(' '),right=after.trim().split(' ').slice(0,5).join(' ');
  if(left.trim().length<24||right.trim().length<24||occurrences(original,left)!==1||occurrences(original,right)!==1||occurrences(proposed,left)!==1||occurrences(proposed,right)!==1||occurrences(destination,left)!==1||occurrences(destination,right)!==1)return null;
  const from=destination.indexOf(left)+left.length,to=destination.indexOf(right);
  if(to<from)return null;
  const proposedPart=proposed.slice(proposed.indexOf(left)+left.length,proposed.indexOf(right)),originalPart=original.slice(original.indexOf(left)+left.length,original.indexOf(right));
  if(destination.slice(from,to)!==proposedPart||proposedPart===originalPart)return null;
  return {status:'retained',operation:originalPart.trim()===''?'insert':proposedPart.trim()===''?'delete':'replace',original:originalPart,proposed:proposedPart,destination:destination.slice(from,to),anchors:{left,right},destinationRange:{start:from,end:to,coordinateSpace:'presentation-normalized-wording'}};
}

/** Pure comparison of already verified, same-dossier source projections. The
 * service below supplies dossier identity and a separately grounded baseline. */
export function compareFinalWording({variant,baseline,destination,signal,limits={}}) {
  const cap={...FINAL_TEXT_LIMITS,...limits};signal?.throwIfAborted();
  if(amendmentLanguageScope(variant)||amendmentMixedLanguageScope(variant))return unavailable('language-scope-unavailable');
  const operation=amendmentOperation(variant);
  if(!operation||typeof variant.originalText!=='string'||typeof variant.proposedText!=='string')return unavailable('amendment-wording-unavailable');
  if([variant.originalText,variant.proposedText].some(text=>text.length>cap.passageCharacters))return unavailable('comparison-passage-budget');
  if(baseline?.language!==variant.language||destination?.language!==variant.language)return unavailable('different-text-languages');
  if(destination.structureComplete===false||destination.contentComplete===false||destination.gaps?.some(gap=>gap.code==='excerpted-source'))return unavailable('destination-extraction-incomplete');
  let target;try{target=parseTargetLabel(variant.targetPath?.proposal?.length===1?variant.targetPath.proposal[0].raw:variant.targetLabel,variant.language);}catch{return unavailable('baseline-address-unavailable');}
  if(!target.complete||!target.segments.length||target.segments.some(segment=>segment.isNew))return unavailable('baseline-address-unavailable');
  const bases=proposalCandidates(baseline,target).filter(unit=>completeUnit(baseline,unit));
  if(bases.length!==1)return unavailable('baseline-provision-unavailable');
  const base=bases[0],original=normalizeFinalWording(stripLabel(variant.originalText,base)),proposed=normalizeFinalWording(stripLabel(variant.proposedText,base)),baseText=normalizedPassage(baseline,base);
  if(!original)return unavailable('insertion-baseline-boundaries-unavailable');
  // A short quoted sentence can be grounded inside a complete provision, but
  // only with exact wording and sentence boundaries on both sides.
  const originalAt=baseText.indexOf(original),whole=baseText===original;
  const bounded=occurrences(baseText,original)===1&&(originalAt===0||/[.!?]\s$/u.test(baseText.slice(0,originalAt)))&&(originalAt+original.length===baseText.length||/^[.!?]?\s/u.test(baseText.slice(originalAt+original.length)));
  if(!whole&&!bounded)return unavailable('original-baseline-mismatch');
  if(!proposed||operation==='delete')return unavailable('deletion-boundaries-unavailable');
  if(original===proposed)return unavailable('no-change-wording');
  const all=flat(destination.units);
  if(all.length>cap.units)return unavailable('comparison-unit-budget');
  const candidates=all.filter(unit=>unit.kind===base.kind&&completeUnit(destination,unit)).map(unit=>({unit,normal:normalizedPassage(destination,unit)}));
  if(candidates.some(row=>row.normal.length>cap.passageCharacters))return unavailable('comparison-passage-budget');
  const exact=candidates.filter(row=>row.normal===proposed);
  if(exact.length>1)return unavailable('competing-destination-provisions');
  let mapped=exact[0],basis=whole?'unique-complete-wording':'unique-complete-quoted-wording';
  if(!mapped){mapped=anchorMapping(original,proposed,baseText,candidates,signal);basis='unique-unchanged-anchors';}
  if(!mapped)return unavailable('corresponding-provision-unavailable');
  const component=retainedComponent(original,proposed,mapped.normal);
  const status=exact.length&&whole?'same-wording':component?'change-retained':'different-wording';
  return {status,wholeProvision:exact.length&&whole?'same':'different',operation,mapping:{basis,from:address(base.path),to:address(mapped.unit.path),fromPath:base.path,toPath:mapped.unit.path,...(mapped.anchors?{anchors:mapped.anchors}:{}),officialLineage:false},passages:{original:variant.originalText,proposed:variant.proposedText,baseline:passage(baseline,base),destination:passage(destination,mapped.unit)},components:component?[component]:[],gaps:[]};
}

export class AmendmentFinalText {
  constructor({context=documentContext,request=odp,readText=(work,language)=>documentText(work,language,{directory:null}),readFinalAct,findAmendment=amendmentById,limits={}}={}) {
    this.context=context;this.request=request;this.readText=readText;this.readFinalAct=readFinalAct;this.findAmendment=findAmendment;this.limits={...FINAL_TEXT_LIMITS,...limits};this.queue=new UpstreamQueue({maximum:this.limits.concurrency});
  }
  async query(query,options={}) {
    const budget=createRequestBudget(this.limits.deadlineMs),owner=options.signal||requestSignal(),signal=owner?AbortSignal.any([owner,budget.signal]):budget.signal;
    try{return await runWithRequestSignal(signal,()=>waitForRequest(this.queue.run(()=>this.collect(query,options,signal),{signal}),signal));}
    finally{budget.dispose();}
  }
  async collect(query,{store=null},signal) {
    const selectedLanguage=query.wordingLanguage??null;
    const selection={documentId:query.id,amendmentId:query.amendmentId??null,listId:query.listId??null,language:query.language,wordingLanguage:selectedLanguage,source:null,parserVersion:null};
    const vote={status:'unavailable',stage:query.amendmentId?.startsWith('committee:')?'committee':'plenary',scope:'individual-amendment',outcome:null,decisions:[]};
    const result={version:AMENDMENT_FINAL_TEXT_VERSION,comparisonVersion:AMENDMENT_FINAL_TEXT_VERSION,selection,vote,wording:unavailable('final-text-unavailable'),destination:null,stages:[],lineage:{status:'unavailable',relationships:[],gaps:[]},provenance:[],gaps:[]};
    const stop=gap=>({...result,wording:unavailable(gap),gaps:unique([...result.gaps,gap])});
    if(!query.id||!query.listId||!query.amendmentId||!selectedLanguage)return stop('exact-selection-required');
    try {
      const context=await waitForRequest(this.context.query({...query,adopted:false,includeBody:true},{store}),signal);signal.throwIfAborted();
      if(Buffer.byteLength(JSON.stringify(context))>this.limits.contextBytes)return stop('context-budget');
      const saved=store?this.findAmendment(store,{document:query.id,id:query.amendmentId,language:query.language}):null;
      if(saved?.id===query.amendmentId&&saved.targetDocumentId===query.id) {
        const decisions=array(saved.decisions),bound=decisions.filter(decision=>array(decision.amendmentIds).includes(saved.id)&&decision.source?.url&&decision.source?.fetchedAt);
        const outcome=bound.length===decisions.length?amendmentRowOutcome(saved):'unavailable';
        result.vote={...vote,status:bound.length&&outcome!=='unavailable'?'available':'unavailable',outcome:outcome==='unavailable'?null:outcome,decisions:bound};
      }
      const variants=context.amendment?.id===query.amendmentId?context.amendment.variants.filter(row=>row.listId===query.listId&&row.language===selectedLanguage):[];
      if(context.documentId!==query.id||variants.length!==1||variants[0].wordingStatus!=='available')return stop('selected-wording-unavailable');
      const variant=variants[0];
      if(!hashPattern.test(variant.source?.contentHash||variant.source?.sha256||'')||variant.source.stale||variant.source.refreshError||variant.sourceFreshness?.status==='stale')return stop('selected-wording-source-unverified');
      selection.source=variant.source;selection.parserVersion=variant.textParserVersion||variant.parserVersion||null;
      selection.targetPath=variant.targetPath??null;selection.baseline=variant.baseline??null;
      const identity=/^committee:([A-Z0-9-]+):([1-9]\d*)$/u.exec(query.amendmentId);
      if(identity&&(identity[1]!==query.listId||!/^\w+-AM-\d{4,}$/u.test(query.listId)))return stop('amendment-identity-unverified');
      if(identity){selection.number=Number(identity[2]);selection.scope='committee';}
      const rootEndpoint=/^[A-Z0-9]+-(?:PR|PA)-\d{4,}$/u.test(query.id)?'/committee-documents/':query.id.startsWith('TA-')?'/adopted-texts/':'/plenary-documents/';
      let reads=0,bytes=0;const records=new Map();
      const read=async(endpoint,id,procedure=false)=>{
        signal.throwIfAborted();if(records.has(endpoint))return records.get(endpoint);
        if(++reads>this.limits.metadataReads)fail('final-text-read-budget');
        const record=await waitForRequest(this.request(endpoint,{}, {staleWhileRevalidate:false}),signal);signal.throwIfAborted();
        const serialized=JSON.stringify(record.payload);bytes+=Buffer.byteLength(serialized);if(bytes>this.limits.metadataBytes)fail('final-text-metadata-budget');
        const rows=array(record.payload?.data).filter(row=>ep(row.id)===(procedure?'eli/dl/proc/':'eli/dl/doc/')+id&&(procedure||row.identifier===id));
        if(rows.length!==1||record.stale||record.refreshError)fail('final-text-metadata-unverified');
        const source={url:record.url||ODP_BASE+endpoint,fetchedAt:new Date(record.fetchedAt).toISOString(),contentHash:sha(serialized),stale:false};result.provenance.push(source);records.set(endpoint,rows[0]);return rows[0];
      };
      const root=await read(rootEndpoint+query.id,query.id),list=await read('/documents/'+query.listId,query.listId);
      if(!['REPORT_PARLIAMENTARY_COMMITTEE_DRAFT','OPINION_PARLIAMENTARY_COMMITTEE_DRAFT','REPORT_PLENARY'].includes(type(root)))return stop('root-document-type-unverified');
      const targetIds=relationships(list,'foresees_change_of');
      if(type(list)!=='AMENDMENT_LIST'||targetIds?.length!==1||targetIds[0]!==query.id)return stop(targetIds===null?'list-target-relationship-unavailable':'list-target-relationship-conflict');
      const listed=relationships(root,'inverse_foresees_change_of');
      if(!listed?.includes(query.listId))return stop(listed===null?'root-list-relationships-unavailable':'list-not-linked-to-root');
      const declared=array(list.is_realized_by).filter(expression=>languageCode(expression.language)===selectedLanguage).flatMap(expression=>array(expression.is_embodied_by).filter(file=>String(file.format).endsWith('/DOCX')).map(file=>{try{return new URL(file.is_exemplified_by,'https://data.europarl.europa.eu/').href;}catch{return null;}}));
      if(declared.length!==1||declared[0]!==variant.source.url)return stop('selected-list-publication-conflict');
      const descriptor=array(list.is_realized_by).filter(expression=>languageCode(expression.language)===selectedLanguage).flatMap(expression=>array(expression.is_embodied_by).filter(file=>String(file.format).endsWith('/DOCX')))[0];
      if(['issued','byteSize'].some(key=>variant.source.sourceVersion?.[key]!=null&&descriptor[key]!=null&&String(variant.source.sourceVersion[key])!==String(descriptor[key])))return stop('selected-list-version-conflict');
      const expression=array(list.is_realized_by).find(expression=>languageCode(expression.language)===selectedLanguage&&array(expression.is_embodied_by).includes(descriptor));
      selection.publication={workId:list.id,expressionId:expression?.id??null,manifestationId:descriptor.id??null,declaredLanguage:expression?.language??null,date:list.document_date??null,sourceHash:variant.source.contentHash||variant.source.sha256,sourceVersion:variant.source.sourceVersion??null};
      const procIds=procedures(root);
      if(procIds?.length!==1)return stop(procIds===null?'procedure-relationships-unavailable':'procedure-relationship-conflict');
      const procedureId=procIds[0],procedure=await read('/procedures/'+procedureId,procedureId,true),documents=relationships(procedure,'created_a_realization_of');
      if(!documents?.includes(query.id))return stop(documents===null?'procedure-documents-unavailable':'procedure-root-conflict');
      const procedureType=ep(procedure.process_type).match(/^def\/ep-procedure-types\/([A-Z]{2,8})$/u)?.[1];
      if(!procedureType)return stop('procedure-type-unavailable');
      const procedureReference=procedureId.replace('-','/')+'('+procedureType+')';selection.procedureIds=[procedureId];
      result.lineage={status:'available',relationships:[{from:query.listId,field:'foresees_change_of',to:query.id},{from:procedureId,field:'created_a_realization_of',to:query.id}],gaps:[]};
      const baselineItems=context.proposal?.items||[],placement=context.placement;
      if(placement?.status!=='placed'||baselineItems.length!==1||context.baseline?.status!=='available')return stop('verified-baseline-unavailable');
      const baseline=baselineItems[placement.itemIndex??0]?.proposal;
      if(!baseline||baseline.language!==selectedLanguage||!hashPattern.test(baseline.sourceHash||''))return stop('verified-baseline-unavailable');
      const baselineIdentity=array(context.baseline.evidence).filter(item=>item.kind==='cellar-identity'&&item.celex===context.baseline.celex&&item.workId===context.baseline.workId);
      if(context.baseline.kind!=='commission-proposal'||baselineIdentity.length!==1||baselineIdentity[0].procedures?.join()!==procedureReference)return stop('baseline-dossier-unverified');
      const baselineSource=context.baseline.items?.[placement.itemIndex??0]?.source;
      if(baselineSource?.sha256!==baseline.sourceHash||baselineSource.stale||baselineSource.refreshError)return stop('baseline-source-unverified');
      result.provenance.push(...array(context.baseline.items).map(item=>item.source).filter(Boolean));
      const candidates=documents.filter(id=>/^TA-\d{1,2}-\d{4}-\d{4,6}$/u.test(id));
      if(candidates.length>this.limits.candidates)return stop('adopted-candidate-budget');
      const adopted=[];
      for(const id of candidates) {
        const work=await read('/adopted-texts/'+id,id),adopts=relationships(work,'adopts');
        if(adopts===null){result.gaps.push('adopted-relationships-unavailable');continue;}
        if(type(work)!=='TEXT_ADOPTED'||procedures(work)?.join()!==procedureId){result.gaps.push('adopted-identity-conflict');continue;}
        for(const parentId of adopts.filter(id=>documents.includes(id)&&/^A-\d{1,2}-\d{4}-\d{4,6}$/u.test(id))) {
          const report=await read('/plenary-documents/'+parentId,parentId);
          if(type(report)!=='REPORT_PLENARY'||procedures(report)?.join()!==procedureId)continue;
          const reportTargets=relationships(report,'adopts');
          if(reportTargets===null){result.gaps.push('report-adopts-unavailable');continue;}
          if(type(root)==='REPORT_PARLIAMENTARY_COMMITTEE_DRAFT'&&!reportTargets.includes(query.id))continue;
          adopted.push(work);result.lineage.relationships.push({from:id,field:'adopts',to:parentId},{from:procedureId,field:'created_a_realization_of',to:id},...reportTargets.map(to=>({from:parentId,field:'adopts',to})));
        }
      }
      const targets=unique(adopted.map(work=>work.identifier));
      if(targets.length!==1||result.gaps.length)return stop(targets.length>1?'competing-adopted-publications':result.gaps[0]||'adopted-text-unavailable');
      const work=adopted.find(work=>work.identifier===targets[0]);
      const files=array(work.is_realized_by).filter(expression=>languageCode(expression.language)===selectedLanguage).flatMap(expression=>array(expression.is_embodied_by).filter(file=>String(file.format).endsWith('/DOCX')));
      if(files.length!==1)return stop(files.length?'competing-adopted-language-publications':'adopted-language-unavailable');
      let url;try{url=new URL(files[0].is_exemplified_by,'https://data.europarl.europa.eu/').href;}catch{return stop('adopted-file-unavailable');}
      if(!allowedDownload(url)||Number(files[0].byteSize)>this.limits.bodyBytes)return stop('adopted-body-budget');
      const text=await waitForRequest(this.readText(work,selectedLanguage),signal);signal.throwIfAborted();
      if(Buffer.byteLength(JSON.stringify(text))>this.limits.bodyBytes)return stop('adopted-body-budget');
      if(text.status!=='available'||text.textLanguage!==selectedLanguage||text.sourceUrl!==url||text.stale||text.refreshError)return stop('adopted-text-unverified');
      const source={url,textLanguage:selectedLanguage,fetchedAt:text.fetchedAt,contentHash:sha(JSON.stringify([text.paragraphs,text.paragraphSources,text.documentObjects,text.extractionVersion,text.sourceVersion])),sourceVersion:text.sourceVersion,parserVersion:text.extractionVersion};result.provenance.push(source);
      const destination={kind:'parliament-adopted-text',id:work.identifier,date:work.document_date??null,language:selectedLanguage,sourceUrls:[url],source,procedure:procedureReference};
      const proposal=parseProposal({...text,sourceKind:'docx'},{language:selectedLanguage,sourceUrl:url,identity:{work:work.identifier}});
      const legislativeBody=flat(proposal.units).some(unit=>unit.kind==='article'&&unit.normative!==false);
      const parliament={destination,wording:legislativeBody?compareFinalWording({variant,baseline,destination:proposal,signal,limits:this.limits}):unavailable('adopted-legislative-body-unavailable')};
      result.stages.push(parliament);result.destination=destination;result.wording=parliament.wording;
      const correspondence=finalActCorrespondence(text,{language:selectedLanguage,source,documentId:work.identifier});
      if(correspondence.status==='available') {
        this.readFinalAct??=createFinalActReader({metadataBytes:this.limits.metadataBytes,bodyBytes:this.limits.bodyBytes});
        const act=await waitForRequest(this.readFinalAct({correspondence,procedure:procedureReference,language:selectedLanguage,signal}),signal).catch(error=>{signal.throwIfAborted();return {status:'unavailable',evidence:[],gaps:[error.code||'final-act-source-unavailable']};});signal.throwIfAborted();
        result.provenance.push(...array(act.evidence));
        if(act.status==='available'&&act.celex===correspondence.celex&&act.procedure===procedureReference&&act.language===selectedLanguage&&act.items?.length===1) {
          const item=act.items[0],finalDestination={kind:'final-eu-act',id:act.celex,date:act.date,ojDate:act.ojDate,language:selectedLanguage,procedure:act.procedure,sourceUrls:[`https://eur-lex.europa.eu/legal-content/${selectedLanguage.toUpperCase()}/TXT/?uri=CELEX:${act.celex}`,item.source.url],source:item.source,identity:{work:act.workId,expression:item.expressionId,manifestation:item.manifestationId,item:item.itemId}};
          const final={destination:finalDestination,wording:compareFinalWording({variant,baseline,destination:item.proposal,signal,limits:this.limits})};result.stages.push(final);
          // A reference-only TA is never relabelled as the Parliament body.
          if(!legislativeBody){result.destination=finalDestination;result.wording=final.wording;}
        } else result.gaps.push(...(act.gaps||['final-act-identity-conflict']));
      } else if(!legislativeBody)result.gaps.push(...correspondence.gaps);
      if(query.includeBody===false)for(const stage of result.stages)if(stage.wording.passages)stage.wording={...stage.wording,passages:null};
      if(query.includeBody===false&&result.wording.passages)result.wording={...result.wording,passages:null};
      result.gaps=unique([...result.gaps,...result.wording.gaps]);return result;
    } catch(error) {
      signal.throwIfAborted();return stop(error.code||'final-text-source-unavailable');
    }
  }
}

export const amendmentFinalText=new AmendmentFinalText();
export default amendmentFinalText;

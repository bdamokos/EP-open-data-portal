import {confirmSourceRejection,SOURCE_RECHECK_MS} from './source-retry.mjs';
import {committeeDiscoveryTask,rebuildCommitteeList} from './committee-amendments-worker.mjs';
import {sittingConfirmationDay,sittingOutcomesComplete,sittingSnapshotConfirmed} from './refresh-policy.mjs';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { array, tail, documentFiles, projectDocument, AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { downloadDocxBuffer } from './document-text.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { createAmendmentAuthorResolver, votingAliases } from './amendment-authors.mjs';
import {AMENDMENT_AUTHOR_NAMES_VERSION,memberNameFields,alternateAuthorDescriptor,authorNameVariants,resolveParallelAuthors,listAuthorResolver,hasNonLatinAuthors} from './amendment-author-names.mjs';
import { parseSplitRequest, SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_OUTCOME_PROOF_VERSION, AMENDMENT_DISTRIBUTION_PROOF_VERSION, AMENDMENT_EMPTY_OBSERVATION_VERSION, AMENDMENT_LIMITS, canonicalEPReference, amendmentTarget, amendmentReference, amendmentSittings, amendmentDecision, amendmentTextLosses, validAmendmentFormatting, amendmentProposerDate, validAmendmentDate, hasDecisionReferenceSet, targetMetadata, normalizedDocxDescriptor, sameDocxDescriptor, docxRetrievedAfterIssue, distributionEvidenceFor, currentDocxDescriptor, listWordingFreshness, checkedAggregateAttribution } from './amendments.mjs';
import { amendmentDependenciesReady, recordSplitResults, saveAmendmentRows, enqueueAmendment, amendmentParserUpgradeKey as parserUpgradeKey, amendmentParserSourceRevisionKey } from './amendments-store.mjs';
import {reconcileAmendmentDocumentGap} from './document-route-recovery.mjs';
import {sanitizeFreshDocument} from './document-detail-routing.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';
import { runAmendmentWorkSlice } from './amendment-work-slices.mjs';
import {amendmentSourceStore} from './amendment-source-store.mjs';
import {amendmentListSettled,amendmentMetadataCheckDays} from './amendment-refresh-policy.mjs';
import {extractAmendmentsOffThread,extractionTurn,endExtractionTurn} from './amendment-extraction-thread.mjs';
import {performance} from 'node:perf_hooks';
import { userAgent } from './user-agent.mjs';
import {upstreamResponseError} from './odp.mjs';
const DAY=86400000;
const sourceKey=id=>'amendment:list:'+id;
const samePublishedDescriptor=(left,right)=>sameDocxDescriptor(left,right)&&Boolean(left?.issued)===Boolean(right?.issued);
const distributionFingerprint=evidence=>createHash('sha256').update(JSON.stringify(evidence || null)).digest('hex');
const rosterKey=date=>'amendment:roster:'+date;
const memberDirectoryRevision=work=>createHash('sha256').update(JSON.stringify([work.nameVersion,
  [...work.members].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(({id,givenName,familyName})=>[id,givenName,familyName]),
])).digest('hex');
const targetKey=id=>'/plenary-documents/'+id;
const idOf=work=>work.identifier || tail(work.id);
const utcDay=worker=>new Date(worker.clock()).toISOString().slice(0,10);
const text=value=>typeof value==='string'?value.slice(0,AMENDMENT_LIMITS.text):null;
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const sourceEvidence=(node,sources,collection)=>{
  if(node.provenance==='unavailable')return {source:null,sourceUrl:null,fetchedAt:null,sourceCandidates:node.sourceCandidates || [],provenance:'unavailable'};
  const candidates=(sources || []).filter(source=>source.url?.includes('/'+collection+'?'));
  const source=node.source?.url?node.source:candidates.length===1?candidates[0]:null;
  return {source,sourceUrl:source?.url ?? null,fetchedAt:source?.fetchedAt ?? null,sourceCandidates:source?[]:candidates,provenance:source?node.provenance==='single-page'?'single-page':node.source?.url?'exact':'single-page':'unavailable'};
};
const amendmentSitting=work=>work?.amendmentEvidence || work;
const requestKey=(request,index)=>request.id || request.requestId || request.observationKey || '__legacy_request__:'+index;
function mergeAmendmentEvidence(priorWork,fresh) {
  const prior=amendmentSitting(priorWork),incoming=new Map((fresh.decisions || []).map(node=>[node.id,node]));
  let retained=false;
  const retainedDecisions=[],currentDecisions=[];
  for(const node of prior?.decisions || []){
    const current=incoming.get(node.id);incoming.delete(node.id);
    if(current&&hasDecisionReferenceSet(current)){currentDecisions.push(current);continue;}
    retained=true;
    (current?currentDecisions:retainedDecisions).push({...node,...sourceEvidence(node,prior.sources,'decisions'),amendmentEvidenceRetained:true,...(current?{latestObservation:current,relationshipRetained:true}:{})});
  }
  const decisions=[...retainedDecisions,...currentDecisions,...incoming.values()];
  const priorParsed=new Map((prior?.parsedSplits || []).map((node,index)=>[requestKey(node,index),node]));
  const requests=new Map((prior?.splitRequests || []).map((node,index)=>{
    const key=requestKey(node,index),parsed=priorParsed.get(key);
    const version=Object.hasOwn(node,'amendmentProjectionVersion')?node.amendmentProjectionVersion:parsed&&Object.hasOwn(parsed,'sourceProjectionVersion')?parsed.sourceProjectionVersion:prior.amendmentProjectionVersion ?? null;
    return [key,{...node,amendmentProjectionVersion:version,...sourceEvidence(node,prior.sources,'vote-results')}];
  }));
  const freshKeys=new Set();
  for(const [index,node] of (fresh.splitRequests || []).entries()){const key=requestKey(node,index);freshKeys.add(key);requests.delete(key);requests.set(key,node);}
  if([...requests.keys()].some(key=>!freshKeys.has(key)))retained=true;
  const parsed=new Map([...priorParsed].map(([key,node])=>[key,{...node,sourceProjectionVersion:Object.hasOwn(node,'sourceProjectionVersion')?node.sourceProjectionVersion:prior.amendmentProjectionVersion ?? null}]));
  for(const [index,node] of (fresh.parsedSplits || []).entries())parsed.set(requestKey(node,index),node);
  const keptRequests=[...requests.entries()].slice(-5000),keptKeys=new Set(keptRequests.map(([key])=>key));
  const capped=decisions.length>5000||requests.size>5000;
  const {results:_results,resultsUrl:_resultsUrl,resultsFetchedAt:_resultsFetchedAt,...evidence}=fresh;
  return {...evidence,decisions:decisions.slice(-5000),splitRequests:keptRequests.map(([,node])=>node),parsedSplits:[...parsed].filter(([key])=>keptKeys.has(key)).map(([,node])=>node),retainedEvidence:retained||capped,splitProjectionTruncated:Boolean(fresh.splitProjectionTruncated||capped)};
}
const extractionSource=extraction=>extraction?.sourceUrl?{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language,...(extraction.reportId?{reportId:extraction.reportId}:{})}:null;
function publicationEvidence(descriptor,buffer) {
  return {sourceDescriptor:normalizedDocxDescriptor(descriptor),sourceHash:createHash('sha256').update(buffer).digest('hex')};
}
const linkedListKey=(target,listId)=>'amendment:discover:'+target+':'+listId;
function verifiedList(work,target,listId) {
  const type=String(work?.work_type || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
  return canonicalEPReference(work?.id)==='eli/dl/doc/'+listId&&idOf(work)===listId&&type==='def/ep-document-types/AMENDMENT_LIST'&&array(work.foresees_change_of).some(ref=>canonicalEPReference(ref)==='eli/dl/doc/'+target);
}
function linkedListCandidates(work) {
  const target=idOf(work),candidates=new Map();let unavailable=0;
  for(const value of array(work.inverse_foresees_change_of)) {
    if(typeof value!=='string'&&(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string')){unavailable++;continue;}
    const reference=canonicalEPReference(value);
    if(!reference?.startsWith('eli/dl/doc/')||tail(reference).length>100){unavailable++;continue;}
    const id=tail(reference),prior=candidates.get(id),expanded=value&&typeof value==='object'?value:null;
    if(!prior)candidates.set(id,{id,reference,observations:[],expanded:null,unverifiedExpanded:false});
    const candidate=candidates.get(id);
    if(expanded){
      // Metadata comes from the existing 12 MiB bounded API response; only its
      // fixed-size digest is retained, including all published DOCX descriptors.
      const distribution=distributionEvidenceFor(expanded,null);
      candidate.observations.push({id:reference,identifier:expanded.identifier ?? null,type:expanded.work_type ?? null,documentDate:expanded.document_date ?? null,
        distributionState:distribution.state,files:distribution.descriptors,
        targets:Object.hasOwn(expanded,'foresees_change_of')?array(expanded.foresees_change_of).map(ref=>canonicalEPReference(ref) || ref):null});
      if(verifiedList(expanded,target,id))candidate.expanded=expanded;else candidate.unverifiedExpanded=true;
    }
  }
  for(const candidate of candidates.values())candidate.fingerprint=createHash('sha256').update(JSON.stringify({target,reference:candidate.reference,observations:candidate.observations})).digest('hex');
  return {candidates:[...candidates.values()],unavailable};
}
function reportWordingEvidence(worker,generation,target,list,distributionEvidence) {
  if(!target.startsWith('A-')||Number(list.itemNumberBegin)!==1||distributionEvidence.state==='available'||!verifiedList(list,target,idOf(list)))return null;
  const report=worker.store.source(generation,targetKey(target));
  // The published list remains the number identity. A report distribution is
  // only a candidate source; extraction must verify its cover and main block.
  return tail(report?.work.work_type)==='REPORT_PLENARY'&&canonicalEPReference(report.work.id)==='eli/dl/doc/'+target?
    {reportId:target,distributionEvidence:distributionEvidenceFor(report.work,{url:'https://data.europarl.europa.eu/api/v2'+targetKey(target)+'?format=application%2Fld%2Bjson',fetchedAt:report.fetchedAt,language:null})}:null;
}
function saveVerifiedList(worker,generation,target,candidate,list,evidence,{parserUpgrade=false}={}) {
  list=sanitizeFreshDocument(list);
  const prior=worker.store.source(generation,sourceKey(candidate.id)),files=documentFiles(list);
  const distributionEvidence=distributionEvidenceFor(list,{url:evidence.url,fetchedAt:evidence.fetchedAt,language:null});
  const reportWording=reportWordingEvidence(worker,generation,target,list,distributionEvidence);
  const descriptor=currentDocxDescriptor({distributionEvidence,targetDocumentId:target,reportWording});
  const unchanged=descriptor&&samePublishedDescriptor(descriptor,currentDocxDescriptor(prior?.work));
  const confirmedAt=reportWording?reportWording.distributionEvidence.source?.fetchedAt:evidence.fetchedAt;
  const lastConfirmedAt=unchanged&&Date.parse(confirmedAt)>(Date.parse(prior?.work.lastConfirmedAt) || -Infinity)?confirmedAt:prior?.work.lastConfirmedAt ?? null;
  // Pin a per-list detail observation independently of parent feed refreshes.
  // Expanded parent metadata must not postpone the occasional exact check.
  const metadataCheckedAt=evidence.basis==='list-detail'?evidence.fetchedAt:prior?.work.metadataCheckedAt || prior?.work.relationshipEvidence?.fetchedAt || evidence.fetchedAt;
  const parserMetadataObservation=parserUpgrade&&distributionEvidence.state!=='available'?{parserVersion:AMENDMENT_EXTRACTION_VERSION,fingerprint:distributionFingerprint(distributionEvidence),retryAt:distributionEvidence.state==='unavailable'?worker.clock()+DAY:null}:null;
  const projected={...projectDocument(list),targetDocumentId:target,files,distributionEvidence,...(reportWording?{reportWording}:{}),lastConfirmedAt,metadataCheckedAt,...(prior?.work.sourceRetentionRetryAt?{sourceRetentionRetryAt:prior.work.sourceRetentionRetryAt}:{}),...(parserMetadataObservation?{parserMetadataObservation}:{}),relationshipEvidence:{...evidence,targetReference:'eli/dl/doc/'+target,listReference:candidate.reference,fingerprint:candidate.fingerprint},...(prior?.work.authorNames?{authorNames:prior.work.authorNames}:{}),...(prior?.work.extraction?{extraction:proposerDatedExtraction(worker.store,generation,prior.work)}:{}),...(prior?.work.wordingRefreshFailure?{wordingRefreshFailure:prior.work.wordingRefreshFailure}:{})};
  const retainedAt=prior?.fetchedAt || evidence.fetchedAt;
  worker.store.putSource(generation,sourceKey(candidate.id),'amendment-list',projected,retainedAt);
  reconcileAmendmentDocumentGap(worker,generation,candidate.id,{work:projected,fetchedAt:retainedAt});
}
function prepareLinkedLists(worker,generation,work,fetchedAt,{discover=true,sittingIds=[],enqueue=enqueueAmendment}={}) {
  const id=idOf(work),linked=linkedListCandidates(work),verified=new Set(),unresolved=[];
  for(const candidate of linked.candidates.slice(0,AMENDMENT_LIMITS.listsPerTarget)) {
    let prior=worker.store.source(generation,sourceKey(candidate.id));
    const expandedVerified=candidate.expanded&&!candidate.unverifiedExpanded&&candidate.expanded.amendmentDistributionDeclared===true;
    const proof=prior?.work.relationshipEvidence;
    const detailTtl=prior?.work.distributionEvidence?.state==='unavailable'?DAY:(amendmentListSettled(prior?.work,{now:worker.clock(),sittingIds})?amendmentMetadataCheckDays():7)*DAY;
    const detailVerified=proof?.basis==='list-detail'&&proof.targetReference==='eli/dl/doc/'+id&&proof.fingerprint===candidate.fingerprint&&worker.clock()-Date.parse(prior?.work.metadataCheckedAt || proof.fetchedAt)<detailTtl&&verifiedList(prior.work,id,candidate.id)&&prior.work.distributionEvidence?.version===AMENDMENT_DISTRIBUTION_PROOF_VERSION;
    const expandedObserved=candidate.expanded&&!candidate.unverifiedExpanded&&typeof candidate.expanded.amendmentDistributionDeclared==='boolean';
    if(discover&&expandedObserved&&!detailVerified&&(prior?.work.targetDocumentId!==id || !proof || Date.parse(proof.fetchedAt)<=Date.parse(fetchedAt))) {
      saveVerifiedList(worker,generation,id,candidate,candidate.expanded,{basis:'expanded-target',url:'https://data.europarl.europa.eu/api/v2'+targetKey(id)+'?format=application%2Fld%2Bjson',fetchedAt});
      prior=worker.store.source(generation,sourceKey(candidate.id));
    }
    const settled=amendmentListSettled(prior?.work,{now:worker.clock(),sittingIds});
    const metadataTtl=(settled?amendmentMetadataCheckDays():7)*DAY;
    const metadataDue=settled&&worker.clock()-Date.parse(prior?.work.metadataCheckedAt || prior?.work.relationshipEvidence?.fetchedAt || prior?.fetchedAt)>=metadataTtl;
    if(discover&&expandedVerified&&metadataDue)enqueue(worker.store,generation,linkedListKey(id,candidate.id),'amendment-list-detail',{listId:candidate.id,targetDocumentId:id},115,true);
    if(discover&&detailVerified) {
      // The list's unchanged relationship proof does not freeze its parent
      // report's independently observed distribution metadata.
      const reportWording=reportWordingEvidence(worker,generation,id,prior.work,prior.work.distributionEvidence);
      if(JSON.stringify(reportWording)!==JSON.stringify(prior.work.reportWording || null)) {
        const next={...prior.work};delete next.reportWording;
        if(reportWording) {
          next.reportWording=reportWording;
          const confirmedAt=reportWording.distributionEvidence.source?.fetchedAt;
          if(samePublishedDescriptor(currentDocxDescriptor(next),currentDocxDescriptor(prior.work))&&Date.parse(confirmedAt)>(Date.parse(next.lastConfirmedAt) || -Infinity))next.lastConfirmedAt=confirmedAt;
        }
        worker.store.putSource(generation,sourceKey(candidate.id),'amendment-list',next,prior.fetchedAt);
        prior=worker.store.source(generation,sourceKey(candidate.id));
      }
    }
    if(!expandedVerified&&!detailVerified) {
      unresolved.push(candidate.id);
      if(discover)enqueue(worker.store,generation,linkedListKey(id,candidate.id),'amendment-list-detail',{listId:candidate.id,targetDocumentId:id},115,true);
      continue;
    }
    verified.add(candidate.id);
    const freshness=listWordingFreshness(prior?.work,{parserVersion:AMENDMENT_EXTRACTION_VERSION,now:worker.clock()});
    const failure=prior?.work.wordingRefreshFailure;
    const failedDescriptorMatches=failure&&(failure.parserVersion==null||failure.parserVersion===AMENDMENT_EXTRACTION_VERSION)&&(failure.descriptor==null&&freshness.descriptor==null||sameDocxDescriptor(failure.descriptor,freshness.descriptor));
    const retryDeferred=failedDescriptorMatches&&Date.parse(failure.retryAfter)>worker.clock();
    const sources=settled?amendmentSourceStore(worker.store):null;
    const alternate=alternateAuthorDescriptor(prior?.work,prior?.work.extraction);
    const retentionDeferred=Date.parse(prior?.work.sourceRetentionRetryAt)>worker.clock();
    const bytesPresent=!settled||retentionDeferred||sources.has(freshness.descriptor)&&(!alternate||sources.has(alternate));
    const alternateFailureDeferred=retentionDeferred&&Boolean(prior?.work.authorNames?.error);
    const alternateUnchanged=!alternate||samePublishedDescriptor(alternate,prior?.work.authorNames?.descriptor)&&(alternateFailureDeferred||!alternate.issued||docxRetrievedAfterIssue(prior?.work.authorNames?.source?.fetchedAt,alternate.issued));
    const unchanged=freshness.status==='fresh'&&bytesPresent&&alternateUnchanged&&(settled||worker.clock()-Date.parse(prior?.work.extraction?.fetchedAt || prior?.fetchedAt)<7*DAY);
    if(discover&&currentDocxDescriptor(prior?.work)&&(!unchanged||alternateAuthorDescriptor(prior?.work,prior?.work.extraction)&&prior?.work.extraction?.authorNamesVersion!==AMENDMENT_AUTHOR_NAMES_VERSION)&&!retryDeferred)enqueue(worker.store,generation,'amendment:extract:'+candidate.id,'amendment-extract',{listId:candidate.id,targetDocumentId:id},112,true);
    const date=prior?.work.document_date;
    if(discover&&validAmendmentDate(date)&&(!worker.store.source(generation,rosterKey(date))||hasNonLatinAuthors(prior?.work.extraction)&&worker.store.source(generation,rosterKey(date))?.work.nameVersion!==AMENDMENT_AUTHOR_NAMES_VERSION))enqueue(worker.store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114,true);
  }
  return {...linked,verified,unresolved};
}
function proposerDatedExtraction(store,generation,list) {
  const extraction=list?.extraction;if(!extraction)return extraction;
  return {...extraction,amendments:(extraction.amendments || []).map(amendment=>{
    const documentary=amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:null});
    const record=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,list.scope==='committee'?list.scopeKey+':'+amendment.number:list.targetDocumentId+'-AM-'+amendment.number);
    const row=record?JSON.parse(record.body):null;
    const accepted=row?.listId===idOf(list)?row:row?.variants?.find(variant=>variant.listId===idOf(list));
    const proposerSource=amendment.proposerSource || amendment.metadataSource || extractionSource(extraction),acceptedSource=accepted?.proposerSource || accepted?.metadataSource;
    const sameSource=proposerSource?.url&&acceptedSource?.url===proposerSource.url&&acceptedSource.fetchedAt===proposerSource.fetchedAt;
    const evidence=documentary || (sameSource?amendmentProposerDate(accepted):null) || amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:list.document_date});
    return {...amendment,proposerDate:evidence?.date || null,proposerDateBasis:evidence?.basis || null};
  })};
}
function verifiedWording(extraction,amendment) {
  return Boolean(validAmendmentFormatting(amendment)&&extraction?.parserVersion===AMENDMENT_EXTRACTION_VERSION&&(amendment?.wordingParserVersion==null||amendment.wordingParserVersion===AMENDMENT_EXTRACTION_VERSION)&&typeof amendment?.originalText==='string'&&typeof amendment.proposedText==='string'&&amendment.originalText.length<=AMENDMENT_LIMITS.text&&amendment.proposedText.length<=AMENDMENT_LIMITS.text&&(amendment.wordingSource?.url || extraction.sourceUrl)&&(
    amendment.wordingRetained&&amendment.wordingParserVersion===AMENDMENT_EXTRACTION_VERSION&&amendment.wordingSource?.url || !amendmentTextLosses(extraction,amendment).length));
}
function mergeExtractionRefresh(old,extraction,source,fallbackDate) {
  const compatible=old?.parserVersion===AMENDMENT_EXTRACTION_VERSION,oldSource=extractionSource(old);
  const metadataPrior=new Map((old?.amendments || []).map(amendment=>[String(amendment.number),amendment]));
  const prior=compatible?metadataPrior:new Map();
  const allLosses=extraction.amendments.flatMap(amendment=>amendmentTextLosses(extraction,amendment).map(gap=>({code:gap.code,number:amendment.number,message:gap.message})));
  const seen=new Set();
  const amendments=extraction.amendments.map(amendment=>{
    const accepted=metadataPrior.get(String(amendment.number));seen.add(String(amendment.number));
    const proposerDate=amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:fallbackDate});
    const row={...amendment,targetLabelLanguage:amendment.targetLabel?source.language ?? null:null,targetLabelSource:amendment.targetLabel?source:null,wordingSource:source,metadataSource:source,proposerSource:source,proposerDate:proposerDate?.date || null,proposerDateBasis:proposerDate?.basis || null,wordingRetained:false,proposerRetained:false,wordingParserVersion:AMENDMENT_EXTRACTION_VERSION,gaps:[...(amendment.gaps || [])]};
    if(!row.targetLabel&&accepted?.targetLabel) {
      row.targetLabel=accepted.targetLabel;
      row.targetLabelLanguage=Object.hasOwn(accepted,'targetLabelLanguage')?accepted.targetLabelLanguage:compatible?accepted.metadataSource?.language ?? old?.language ?? null:null;
      row.targetLabelSource=Object.hasOwn(accepted,'targetLabelSource')?accepted.targetLabelSource:compatible?accepted.metadataSource || oldSource:null;
      row.gaps.push({code:'target-retained',number:row.number,message:'Previously accepted target location is retained because the fresh source has no target location.'});
    }
    const damaged=amendmentTextLosses(extraction,amendment).length||typeof amendment.originalText!=='string'||typeof amendment.proposedText!=='string';
    if(damaged&&verifiedWording(old,accepted)) {
      row.originalText=accepted.originalText;row.proposedText=accepted.proposedText;
      row.originalFormatting=accepted.originalFormatting || [];row.proposedFormatting=accepted.proposedFormatting || [];
      row.wordingSource=accepted.wordingSource || oldSource;row.wordingRetained=true;
      row.baseline=accepted.baseline??'unknown';row.baselineSource=accepted.baselineSource??null;
      row.documentReferences=accepted.documentReferences??[];row.targetPath=accepted.targetPath??null;
      row.language=row.wordingSource?.language || accepted.language || old.language;
      row.gaps.push({code:'wording-retained',number:row.number,message:'Previously accepted amendment wording is retained after text extraction failed.'});
    }
    if(!row.authors?.length&&!row.committeeProposer&&accepted&&(accepted.authors?.length||accepted.committeeProposer)) {
      row.authors=accepted.authors || [];row.committeeProposer=accepted.committeeProposer || null;row.onBehalfOf=accepted.onBehalfOf || null;
      row.proposerSource=accepted.proposerSource || accepted.metadataSource || oldSource;row.proposerRetained=true;row.proposerDate=accepted.proposerDate || null;row.proposerDateBasis=accepted.proposerDateBasis || null;
      row.gaps.push({code:'proposer-retained',number:row.number,message:'Previously accepted proposer evidence is retained because the fresh source has no proposer evidence.'});
    }
    row.sources=[...new Map([...(amendment.sources || []),source,row.wordingSource,row.proposerSource,row.targetLabelSource].filter(item=>item?.url).map(item=>[item.url+':'+item.fetchedAt,item])).values()];
    return row;
  });
  const missing=[];let retentionLimited=false;
  for(const [number,accepted] of prior)if(!seen.has(number)) {
    missing.push(number);
    if(amendments.length>=AMENDMENT_LIMITS.amendmentsPerList){retentionLimited=true;continue;}
    const complete=verifiedWording(old,accepted);
    amendments.push({...accepted,originalText:complete?accepted.originalText:null,proposedText:complete?accepted.proposedText:null,originalFormatting:complete?accepted.originalFormatting || []:[],proposedFormatting:complete?accepted.proposedFormatting || []:[],wordingSource:accepted.wordingSource || oldSource,metadataSource:accepted.metadataSource || oldSource,proposerSource:accepted.proposerSource || accepted.metadataSource || oldSource,wordingRetained:complete,proposerRetained:true,recordRetained:true,wordingParserVersion:AMENDMENT_EXTRACTION_VERSION,latestRefreshSource:source,sources:[...(accepted.sources || []),source],gaps:[...(accepted.gaps || []),{code:'amendment-retained',number:accepted.number,message:'This amendment was absent from the latest extraction; previously indexed evidence is retained.'}]});
  }
  return {...extraction,amendments,gaps:[...(extraction.gaps || []),...(retentionLimited?[{code:'retention-limit',message:'The extraction retention limit was reached; separately indexed prior records remain labelled retained evidence.'}]:[])],parserVersion:AMENDMENT_EXTRACTION_VERSION,...(old&&!compatible?{previousParserVersion:old.parserVersion || 'unknown'}:{}),sourceUrl:source.url,fetchedAt:source.fetchedAt,language:source.language,...(missing.length||allLosses.length?{lastRefreshFailure:{attemptedAt:source.fetchedAt,missingAmendmentNumbers:missing,textLosses:allLosses,sourceUrl:source.url}}:{})};
}

export function scheduleSittingOutcomes(worker,generation,sittingId,{priority=113}={}) {
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sittingId))return false;
  const today=localDay(worker.clock()),sittingDate=sittingId.slice(7);
  if(!Number.isFinite(Date.parse(sittingDate))||sittingDate>today)return false;
  const key=motionSourceKey(sittingId),saved=worker.store.source(generation,key),work=saved?.work,evidence=amendmentSitting(work);
  const confirmationDay=sittingConfirmationDay(sittingId);
  const ttl=today<confirmationDay?6*60*60_000:7*DAY;
  const complete=sittingOutcomesComplete(work);
  // A complete snapshot fetched after the correction deadline is the confirmation.
  // Stored source times survive restart and generation copying. Failures,
  // truncation and projection upgrades always invalidate finality.
  if(sittingSnapshotConfirmed(work,sittingId,saved?.fetchedAt))return false;
  if(complete && today<confirmationDay && worker.clock()-Date.parse(saved.fetchedAt)<ttl)return false;
  if(worker.store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND sitting_id=? LIMIT 1').get(generation,sittingId))return false;
  // Reuse any pending sitting task, including older key formats, without
  // resetting its page cursor, retry time or accumulated response graph.
  const pending=worker.store.db.prepare("SELECT key FROM tasks WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND (done IS NULL OR done<>1) UNION ALL SELECT key FROM amendment_jobs WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done<>1 LIMIT 1").get(generation,sittingId,generation,sittingId);
  if(pending)return false;
  if(worker.store.db.prepare("SELECT 1 FROM continuation_sittings WHERE generation=? AND sitting_id=? AND bucket IN ('tasks','discovery') LIMIT 1").get(generation,sittingId))return false;
  const upgrade=work&&evidence.amendmentProjectionVersion!==AMENDMENT_SITTING_PROJECTION_VERSION;
  const correctionAttempt=Boolean(work&&today<confirmationDay);
  const taskKey=key+':'+today+(upgrade?':amendments-v'+AMENDMENT_SITTING_PROJECTION_VERSION:correctionAttempt?':refresh:'+Math.floor(worker.clock()/(6*60*60_000)):'');
  const exactAttempt=upgrade||complete||correctionAttempt?1:0;
  if(worker.store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done=1 AND (key=? OR (?=0 AND key LIKE ?)) UNION ALL SELECT 1 FROM amendment_jobs WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done=1 AND (key=? OR (?=0 AND key LIKE ?)) LIMIT 1").get(generation,sittingId,taskKey,exactAttempt,'%:'+today+'%',generation,sittingId,taskKey,exactAttempt,'%:'+today+'%'))return false;
  if(worker.store.db.prepare("SELECT 1 FROM continuation_sittings WHERE generation=? AND sitting_id=? AND bucket='completed' AND (key=? OR (?=0 AND key LIKE ?)) LIMIT 1").get(generation,sittingId,taskKey,exactAttempt,'%:'+today+'%'))return false;
  worker.store.enqueue(generation,taskKey,'motion-outcomes',{sittingId,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},priority);
  return true;
}

export function scheduleAmendments(worker,generation,work,fetchedAt,endpoint,{enqueue=enqueueAmendment}={}) {
  const id=idOf(work);if(!amendmentTarget(id))return;
  rebuildAmendmentTarget(worker,generation,id,{enqueue});
  const priorTarget=worker.store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const discovered=priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[];
  for(const sittingId of new Set([...amendmentSittings(work),...discovered])) {
    scheduleSittingOutcomes(worker,generation,sittingId);
    const aliasKey='amendment:aliases:'+sittingId;
    if(!worker.store.source(generation,aliasKey))enqueue(worker.store,generation,aliasKey,'amendment-aliases',{sittingId},108);
  }
}
const preparationMarkers=worker=>({amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:utcDay(worker),splitParserVersion:SPLIT_PARSER_VERSION,amendmentDocumentParserVersion:AMENDMENT_EXTRACTION_VERSION,amendmentDocumentLinksVersion:AMENDMENT_LINKS_VERSION,amendmentSittingProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,amendmentDistributionProofVersion:AMENDMENT_DISTRIBUTION_PROOF_VERSION,amendmentAuthorNamesVersion:AMENDMENT_AUTHOR_NAMES_VERSION});
const preparationKinds={documents:'document',gaps:'amendment-gap',splits:'motion-outcomes'};
export function amendmentParserUpgradeDue(store,generation) {
  const marker=store.source(generation,parserUpgradeKey)?.work;
  if(marker?.parserVersion===AMENDMENT_EXTRACTION_VERSION&&(marker.sourceRevision || 0)===(store.get(amendmentParserSourceRevisionKey) || 0)&&(!marker.retryAt||marker.retryAt>store.clock()))return false;
  return Boolean(marker||store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND kind='amendment-list' LIMIT 1").get(generation));
}
export function prepareAmendmentParserUpgrade(worker,generation) {
  if(!amendmentParserUpgradeDue(worker.store,generation))return;
  const outdated=worker.store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND kind='amendment-list' AND json_type(body,'$.extraction')='object' AND COALESCE(json_extract(body,'$.extraction.parserVersion'),'')<>? LIMIT 1").get(generation,AMENDMENT_EXTRACTION_VERSION);
  if(!outdated) {
    worker.store.putSource(generation,parserUpgradeKey,'amendment-parser-upgrade',{parserVersion:AMENDMENT_EXTRACTION_VERSION,sourceRevision:worker.store.get(amendmentParserSourceRevisionKey) || 0},new Date(worker.clock()).toISOString());
    return;
  }
  const throughKey=worker.store.db.prepare("SELECT MAX(key) AS key FROM sources WHERE generation=? AND kind='amendment-list'").get(generation)?.key || '';
  enqueueAmendment(worker.store,generation,parserUpgradeKey+':'+AMENDMENT_EXTRACTION_VERSION,'amendment-parser-upgrade',{afterKey:'',throughKey,sourceRevision:worker.store.get(amendmentParserSourceRevisionKey) || 0},110,true,{deferOnCapacity:true});
}
// Cold parser-upgrade downloads are paced across worker runs, restarts and
// writer handoffs by a bounded history kept beside the index generations. A
// worker measures its own entries on its monotonic clock; other entries use wall
// time, and a timestamp ahead of the clock is clamped to now. A deferred job
// waits only for the next free slot.
export const AMENDMENT_PARSER_DOWNLOAD_PACE=Object.freeze({downloads:4,windowMs:3*60_000});
export const amendmentParserDownloadsKey='amendmentParserDownloads';
const parserDownloadWorker=worker=>worker.amendmentParserDownloadWorker ||= randomUUID();
function parserDownloadHistory(worker) {
  const {store}=worker,now=worker.clock(),monotonic=worker.monotonic(),self=parserDownloadWorker(worker),saved=store.get(amendmentParserDownloadsKey);
  let clamped=false;
  const entries=(Array.isArray(saved)?saved:[]).flatMap(entry=>{
    let at=Number(entry?.at);if(!Number.isFinite(at))return [];
    if(at>now){at=now;clamped=true;}
    const own=entry.worker===self&&Number.isFinite(entry.monotonic)&&entry.monotonic<=monotonic;
    const elapsed=own?monotonic-entry.monotonic:now-at;
    return elapsed<AMENDMENT_PARSER_DOWNLOAD_PACE.windowMs?[{...(typeof entry.worker==='string'&&Number.isFinite(entry.monotonic)?{worker:entry.worker,monotonic:entry.monotonic}:{}),at,elapsed}]:[];
  }).sort((a,b)=>b.elapsed-a.elapsed);
  if(clamped){store.assertWriter();store.set(amendmentParserDownloadsKey,entries.map(({elapsed:_elapsed,...entry})=>entry));}
  return entries;
}
function parserDownloadWait(worker) {
  const entries=parserDownloadHistory(worker),{downloads,windowMs}=AMENDMENT_PARSER_DOWNLOAD_PACE;
  return entries.length<downloads?0:windowMs-entries[entries.length-downloads].elapsed;
}
function recordParserDownload(worker) {
  worker.store.assertWriter();
  const entries=parserDownloadHistory(worker).map(({elapsed:_elapsed,...entry})=>entry);
  entries.push({at:worker.clock(),worker:parserDownloadWorker(worker),monotonic:worker.monotonic()});
  worker.store.set(amendmentParserDownloadsKey,entries.slice(-AMENDMENT_PARSER_DOWNLOAD_PACE.downloads));
}
function admitAmendmentList(store,generation,key,kind,body,priority,replacing=null) {
  const checkpoint=store.source(generation,'amendment:continuations')?.work;
  const reserved=[...(checkpoint?.tasks || []),...(checkpoint?.discovery || [])];
  const existing=store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND done=0').get(generation,key)||reserved.some(task=>task.key===key);
  if(!existing) {
    const kinds=new Set(['amendment-extract','amendment-list-detail']);
    const pending=store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND done=0 AND kind IN ('amendment-extract','amendment-list-detail')").get(generation).n+reserved.filter(task=>kinds.has(task.kind)&&task.done!==1).length;
    const replaces=replacing&&store.db.prepare("SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND done=0 AND kind='amendment-list-detail'").get(generation,replacing);
    if(pending-Number(Boolean(replaces))>=8)return false;
  }
  return enqueueAmendment(store,generation,key,kind,body,priority,true,{deferOnCapacity:true});
}
async function runParserUpgradeSlice(worker,task) {
  const {store}=worker,{generation}=task;
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>store.db.prepare("SELECT key,body,COALESCE(json_extract(body,'$.document_date'),'') AS date FROM sources WHERE generation=? AND kind='amendment-list' AND key<=? AND (COALESCE(json_extract(body,'$.document_date'),'')<? OR (COALESCE(json_extract(body,'$.document_date'),'')=? AND key<?)) ORDER BY date DESC,key DESC LIMIT 1").get(generation,body.throughKey,body.afterDate ?? '\uffff',body.afterDate ?? '\uffff',body.afterKey || '\uffff'),
    action:(source,body)=>{
      const list=JSON.parse(source.body),listId=idOf(list),targetDocumentId=list.scopeKey||list.targetDocumentId;
      if(!list.extraction||list.extraction.parserVersion===AMENDMENT_EXTRACTION_VERSION||!amendmentTarget(targetDocumentId)&&!targetDocumentId?.startsWith('committee:'))return;
      const freshness=listWordingFreshness(list,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
      if(freshness.status==='failed'&&(list.wordingRefreshFailure?.parserVersion==null||list.wordingRefreshFailure.parserVersion===AMENDMENT_EXTRACTION_VERSION)&&Date.parse(freshness.retryAfter)>worker.clock()) {
        store.taskProgress(task,{...body,retryAt:Math.min(body.retryAt || Infinity,Date.parse(freshness.retryAfter))});
        return;
      }
      const observation=list.parserMetadataObservation;
      if(!freshness.descriptor&&observation?.parserVersion===AMENDMENT_EXTRACTION_VERSION&&observation.fingerprint===distributionFingerprint(list.distributionEvidence)) {
        if(observation.retryAt===null)return;
        if(Number.isFinite(observation.retryAt)&&observation.retryAt>worker.clock()) {
          store.taskProgress(task,{...body,retryAt:Math.min(body.retryAt || Infinity,observation.retryAt)});
          return;
        }
      }
      // This pass uses retained list identities directly. Report-link upgrades,
      // their daily cap and unavailable target endpoints cannot block it.
      const extract=Boolean(currentDocxDescriptor(list));
      if(list.scope==='committee'&&!extract){
        const endpoint='/documents/'+listId;return enqueueAmendment(store,generation,endpoint,'document',{endpoint},103,true,{deferOnCapacity:true});
      }
      const admitted=admitAmendmentList(store,generation,extract?'amendment:extract:'+listId:linkedListKey(targetDocumentId,listId),extract?'amendment-extract':'amendment-list-detail',{listId,targetDocumentId,parserUpgrade:true},extract?112:115);
      if(!admitted)store.db.prepare('UPDATE amendment_jobs SET retry_at=? WHERE generation=? AND key=?').run(worker.clock()+60_000,generation,task.key);
      return admitted;
    },
    advance:source=>({afterKey:source.key,afterDate:source.date}),
  });
  if(complete) {
    store.putSource(generation,parserUpgradeKey,'amendment-parser-upgrade',{parserVersion:AMENDMENT_EXTRACTION_VERSION,sourceRevision:task.body.sourceRevision || 0,...(task.body.retryAt?{retryAt:task.body.retryAt}:{})},new Date(worker.clock()).toISOString());
    store.finishTask(task);
  }
}
const preparationDocumentFilter=" AND (json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT')";
const needsLinkObservation=work=>work.amendmentLinksVersion!==AMENDMENT_LINKS_VERSION||work.inverse_foresees_change_of==null;
const linkUpgradeCursor='amendmentLinkUpgradeAfterKey';
function preparationThrough(store,generation,stage) {
  return store.db.prepare('SELECT MAX(key) AS key FROM sources WHERE generation=? AND kind=?'+(stage==='documents'?preparationDocumentFilter:'')).get(generation,preparationKinds[stage])?.key || '';
}
const samePreparationMarkers=(left,right)=>Object.entries(right).every(([key,value])=>left?.[key]===value);
function coalescePreparation(store,generation,markers,settled) {
  const checkpointKey='amendment:continuations',saved=store.source(generation,checkpointKey)?.work || {};
  const pending=(saved.tasks || []).filter(task=>task.kind==='amendment-prepare'&&task.done!==1).map(task=>({...task,location:'reserve'}));
  for(const table of ['tasks','amendment_jobs'])for(const task of store.db.prepare(`SELECT * FROM ${table} WHERE generation=? AND kind='amendment-prepare' AND (done IN (-1,0) OR done IS NULL)`).all(generation))pending.push({...task,location:table});
  const rank=task=>({documents:0,gaps:1,splits:2,done:3})[JSON.parse(task.body).stage] ?? -1;
  const descending=(left,right)=>left>right?-1:left<right?1:0;
  const candidates=pending.sort((a,b)=>rank(b)-rank(a)||descending(JSON.parse(a.body).afterKey || '',JSON.parse(b.body).afterKey || '')||descending(a.key,b.key));
  const chosen=settled?null:candidates[0];
  let body=chosen?.body;
  if(chosen) {
    const prior=JSON.parse(body);
    if(!samePreparationMarkers(prior.requestedMarkers || prior.markers,markers))body=JSON.stringify({...prior,requestedMarkers:markers});
  }
  // Preparation is derived work. Keep the furthest saved cursor and fold newer
  // requests into it; duplicate scans contain no unique source observations.
  for(const table of ['tasks','amendment_jobs']) {
    store.db.prepare(`UPDATE ${table} SET done=1 WHERE generation=? AND kind='amendment-prepare' AND (done IN (-1,0) OR done IS NULL)`+(chosen?.location===table?' AND key<>?':'')).run(generation,...(chosen?.location===table?[chosen.key]:[]));
    if(chosen?.location===table&&body!==chosen.body)store.db.prepare(`UPDATE ${table} SET body=? WHERE generation=? AND key=?`).run(body,generation,chosen.key);
  }
  let kept=false;
  const tasks=(saved.tasks || []).flatMap(task=>{
    if(task.kind!=='amendment-prepare'||task.done===1)return [task];
    if(chosen?.location==='reserve'&&task.key===chosen.key&&!kept){kept=true;return [{...task,body}];}
    return [];
  });
  if(JSON.stringify(tasks)!==JSON.stringify(saved.tasks || []))store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,checkpointKey,'amendment-continuations',JSON.stringify({...saved,tasks}),new Date(store.clock()).toISOString());
  return chosen&&chosen.location!=='reserve'?{...chosen,body:JSON.parse(body),amendmentJob:chosen.location==='amendment_jobs'}:null;
}
export async function prepareAmendments(worker,cycle) {
  const {generation}=cycle,store=worker.store,markers=preparationMarkers(worker);
  for(const pilot of ['A-10-2026-0254','B-10-2026-0424'])if(!store.source(generation,targetKey(pilot)))store.enqueue(generation,targetKey(pilot),'document',{endpoint:targetKey(pilot)},109);
  const settled=samePreparationMarkers(cycle,markers);
  let task=store.transaction(()=>{store.assertWriter();return coalescePreparation(store,generation,markers,settled);});
  if(settled)return true;
  if(!task&&!store.source(generation,'amendment:continuations')?.work.tasks?.some(task=>task.kind==='amendment-prepare'&&task.done!==1)) {
    const key='amendment:prepare';
    if(!enqueueAmendment(store,generation,key,'amendment-prepare',{markers,stage:'documents',afterKey:'',throughKey:preparationThrough(store,generation,'documents'),upgrades:0,upgradeAfterKey:store.get(linkUpgradeCursor)||''},113,true,{deferOnCapacity:true}))return false;
    const row=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=? AND done=0').get(generation,key);
    if(row)task={...row,body:JSON.parse(row.body),amendmentJob:true};
  }
  return task&&task.retry_at<=worker.clock()?runPreparationSlice(worker,task):false;
}
function deferPreparation(worker,task) {
  worker.store.assertWriter();
  worker.store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET retry_at=MAX(retry_at,?) WHERE generation=? AND key=?`).run(worker.clock()+60_000,task.generation,task.key);
}
function preparationQueueBusy(store,generation) {
  const reserved=store.source(generation,'amendment:continuations')?.work.tasks || [];
  const pendingLists=store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND done=0 AND kind IN ('amendment-extract','amendment-list-detail')").get(generation).n+reserved.filter(task=>task.done!==1&&['amendment-extract','amendment-list-detail'].includes(task.kind)).length;
  return pendingLists>=8||store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND done=0').get(generation).n>=200;
}
async function runPreparationSlice(worker,task) {
  const {generation}=task,store=worker.store;
  let refused=false;
  const enqueue=(store,generation,key,kind,body,priority=105,refreshCompleted=false)=>{
    const admitted=['amendment-extract','amendment-list-detail'].includes(kind)?admitAmendmentList(store,generation,key,kind,body,priority):enqueueAmendment(store,generation,key,kind,body,priority,refreshCompleted,{deferOnCapacity:true});
    if(!admitted)refused=true;
    return admitted;
  };
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>{
      if(body.stage==='done')return null;
      const source=store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=? AND key>? AND key<=?'+(body.stage==='documents'?preparationDocumentFilter:'')+' ORDER BY key LIMIT 1').get(generation,preparationKinds[body.stage],body.afterKey,body.throughKey);
      return source?{source,stage:body.stage}:{end:body.stage};
    },
    action:(item,body)=>{
      if(item.end) {
        if(item.end==='documents'&&body.upgrades<AMENDMENT_LIMITS.upgradeTargets)store.set(linkUpgradeCursor,'');
        const stage=item.end==='documents'?'gaps':item.end==='gaps'?'splits':'done';
        store.taskProgress(task,{...body,stage,afterKey:'',throughKey:stage==='done'?'':preparationThrough(store,generation,stage)});return;
      }
      const {source,stage}=item,work=JSON.parse(source.body);
      if(preparationQueueBusy(store,generation)){deferPreparation(worker,task);return false;}
      if(stage==='documents') {
        if(!amendmentTarget(idOf(work)))return;
        if(needsLinkObservation(work)) {
          if(body.upgradePendingKey===source.key||source.key>(body.upgradeAfterKey||'')&&body.upgrades<AMENDMENT_LIMITS.upgradeTargets){
            if(body.upgradePendingKey!==source.key) {
              store.enqueue(generation,source.key,'document',{endpoint:source.key},106,true);
              // Overflow can invalidate earlier records again before the next
              // daily pass. Rotate the bounded refresh window instead of always
              // spending it on the first hundred A reports.
              store.set(linkUpgradeCursor,source.key);
              store.taskProgress(task,{...body,upgrades:body.upgrades+1,upgradePendingKey:source.key});
            }
            rebuildAmendmentTarget(worker,generation,idOf(work),{enqueue});
          }
        } else scheduleAmendments(worker,generation,work,source.fetched_at,source.key,{enqueue});
      } else if(stage==='gaps') {
        const list=work.taskKind==='amendment-extract'?store.source(generation,sourceKey(work.taskBody.listId))?.work:null;
        const freshness=list&&listWordingFreshness(list,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
        if(work.taskKind==='amendment-extract'&&(!currentDocxDescriptor(list)||freshness?.status==='failed'&&(list.wordingRefreshFailure?.parserVersion==null||list.wordingRefreshFailure.parserVersion===AMENDMENT_EXTRACTION_VERSION)&&Date.parse(freshness.retryAfter)>worker.clock()))return;
        enqueue(store,generation,work.taskKey,work.taskKind,work.taskBody,work.priority || 105,true);
      } else {
        const evidence=amendmentSitting(work);
        if((evidence.splitParserVersion!==SPLIT_PARSER_VERSION||evidence.amendmentVersion!==AMENDMENTS_VERSION)&&evidence.splitRequests)enqueue(store,generation,'amendment:reparse:'+source.key,'amendment-reparse',{sourceKey:source.key},111,true);
      }
      if(refused){deferPreparation(worker,task);return false;}
    },
    advance:item=>item.source?{afterKey:item.source.key,upgradePendingKey:null}:{},
  });
  if(complete) {
    const requested=task.body.requestedMarkers || task.body.markers;
    if(!samePreparationMarkers(task.body.markers,requested)) {
      store.taskProgress(task,{markers:requested,stage:'documents',afterKey:'',throughKey:preparationThrough(store,generation,'documents'),upgrades:0,upgradeAfterKey:store.get(linkUpgradeCursor)||''});
      return false;
    }
    if(store.get('working')?.generation===generation&&samePreparationMarkers(task.body.markers,preparationMarkers(worker)))store.updateCycle(task.body.markers);
    store.finishTask(task);
  }
  return complete;
}
export function parseSavedSplits(worker,work,{priorWork=null}={}) {
  const parsedSplits=(work.splitRequests || []).map(request=>{
    const evidence=sourceEvidence(request,work.sources,'vote-results');
    const parsed=parseSplitRequest(request,{sourceUrl:evidence.sourceUrl,fetchedAt:evidence.fetchedAt,language:'en'});
    const observation=part=>{
      const raw=part.componentIndex!=null?array(request.created_a_realization_of)[part.componentIndex]:array(request.created_a_realization_of).find(raw=>raw?.id===(part.id ?? part.partId));
      return raw&&Object.hasOwn(raw,'sourceComponentObservation')?{sourceComponentObservation:raw.sourceComponentObservation}:{};
    };
    const result={...parsed,...evidence,sourceProjectionVersion:Object.hasOwn(request,'amendmentProjectionVersion')?request.amendmentProjectionVersion:work.amendmentProjectionVersion ?? null,observationKey:request.observationKey || null,parts:parsed.parts.map(part=>({...part,...observation(part),...evidence})),failures:parsed.failures.map(failure=>({...failure,...observation(failure),...evidence}))};
    recordSplitResults(worker.store,result);return result;
  });
  const fresh={...work,parsedSplits,...(Array.isArray(work.splitRequests)&&array(work.decisions).every(decision=>Object.hasOwn(decision,'decided_on_a_realization_of'))?{amendmentVersion:AMENDMENTS_VERSION}:{}),splitParserVersion:SPLIT_PARSER_VERSION};
  if(!priorWork)return fresh;
  const prior=amendmentSitting(priorWork);
  if(prior.splitParserVersion!==SPLIT_PARSER_VERSION) {
    const currentKeys=new Set((fresh.splitRequests || []).map(requestKey));
    const retained=(prior.splitRequests || []).filter((request,index)=>!currentKeys.has(requestKey(request,index)));
    const reparsed=parseSavedSplits(worker,{...prior,splitRequests:retained});
    priorWork=priorWork.amendmentEvidence?{...priorWork,amendmentEvidence:{...prior,parsedSplits:reparsed.parsedSplits,splitParserVersion:SPLIT_PARSER_VERSION}}:{...priorWork,parsedSplits:reparsed.parsedSplits,splitParserVersion:SPLIT_PARSER_VERSION};
  }
  const evidence=mergeAmendmentEvidence(priorWork,fresh);
  return evidence.retainedEvidence||fresh.truncated?{...fresh,amendmentEvidence:evidence}:fresh;
}
function sittingRebuildContext(worker,generation,sittingId) {
  const work=amendmentSitting(worker.store.source(generation,motionSourceKey(sittingId))?.work || {});
  const directTargets=new Set((work.decisions || []).flatMap(decision=>array(decision.decided_on_a_realization_of).map(amendmentReference).filter(Boolean).map(ref=>ref.targetDocumentId)));
  return {work,directTargets,observedDecisionIds:work.amendmentVersion===AMENDMENTS_VERSION?(work.decisions || []).filter(hasDecisionReferenceSet).map(decision=>tail(decision.id)):[]};
}
function rebuildQuery(generation,scope,context) {
  if(scope.kind==='member-changes')return {sql:'SELECT target AS id FROM amendment_member_current WHERE generation=?',args:[generation]};
  if(scope.kind==='members')return {sql:'SELECT id FROM amendment_targets WHERE generation=?',args:[generation]};
  if(scope.kind==='roster')return {sql:"SELECT DISTINCT COALESCE(json_extract(source.body,'$.scopeKey'),json_extract(source.body,'$.targetDocumentId')) AS id FROM sources AS source WHERE generation=? AND kind='amendment-list' AND (json_extract(source.body,'$.document_date')=? OR EXISTS(SELECT 1 FROM json_each(source.body,'$.extraction.amendments') AS amendment WHERE json_extract(amendment.value,'$.date')=? OR json_extract(amendment.value,'$.documentDate')=? OR json_extract(amendment.value,'$.proposerDate')=?) OR json_extract(source.body,'$.scope')='committee' AND EXISTS(SELECT 1 FROM json_each(source.body,'$.procedureEvidence') AS proof WHERE json_extract(proof.value,'$.activityType')='COMMITTEE_TABLING_AMENDMENT' AND json_extract(proof.value,'$.date')=?))",args:[generation,scope.date,scope.date,scope.date,scope.date,scope.date]};
  return {sql:`SELECT value AS id FROM json_each(?) UNION SELECT id FROM amendment_targets AS target WHERE generation=? AND EXISTS(SELECT 1 FROM json_each(target.body,'$.sittingIds') AS sitting WHERE sitting.value=?)
    UNION SELECT DISTINCT amendment.target AS id FROM amendments AS amendment JOIN amendment_targets AS target ON target.generation=amendment.generation AND target.id=amendment.target WHERE amendment.generation=? AND json_type(target.body,'$.sittingIds') IS NULL AND EXISTS(SELECT 1 FROM json_each(amendment.body,'$.decisions') AS decision WHERE json_extract(decision.value,'$.sittingId')=?)`,args:[JSON.stringify([...context.directTargets]),generation,scope.sittingId,generation,scope.sittingId]};
}
function newRebuildScope(worker,generation,scope) {
  if(scope.kind==='profile')return {...scope,offset:0};
  if(scope.kind==='member-changes'&&!worker.store.db.prepare('SELECT 1 FROM amendment_member_current WHERE generation=? LIMIT 1').get(generation)) {
    const capture=()=>{
    worker.store.db.prepare('INSERT OR IGNORE INTO amendment_member_current SELECT * FROM amendment_member_pending WHERE generation=?').run(generation);
    worker.store.db.prepare('DELETE FROM amendment_member_pending WHERE generation=?').run(generation);
    };if(worker.store.db.isTransaction)capture();else worker.store.transaction(capture);
  }
  const context=scope.kind==='sitting'?sittingRebuildContext(worker,generation,scope.sittingId):null,query=rebuildQuery(generation,scope,context);
  const throughTarget=worker.store.db.prepare('SELECT MAX(id) AS id FROM ('+query.sql+')').get(...query.args)?.id || '';
  return {...scope,...(scope.kind==='member-changes'?{passId:randomUUID()}:{}),afterTarget:'',throughTarget};
}
async function runRebuildSlice(worker,task) {
  const {generation}=task,store=worker.store,scope=task.body.rebuild;
  const context=scope.kind==='sitting'?sittingRebuildContext(worker,generation,scope.sittingId):null;
  const query=scope.kind==='profile'?null:rebuildQuery(generation,scope,context);
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>body.rebuild.kind==='profile'?(body.targets?.[body.rebuild.offset]!=null?{id:body.targets[body.rebuild.offset]}:null):store.db.prepare('SELECT id FROM ('+query.sql+') WHERE id>? AND id<=? ORDER BY id LIMIT 1').get(...query.args,body.rebuild.afterTarget,body.rebuild.throughTarget),
    action:({id})=>{
      if(id?.startsWith('committee:')||amendmentTarget(id)&&store.source(generation,targetKey(id)))rebuildAmendmentTarget(worker,generation,id,context?{observedDecisionIds:context.observedDecisionIds,discoveredSittingIds:context.directTargets.has(id)?[scope.sittingId]:[]}:{discover:scope.kind!=='member-changes'});
      if(scope.kind==='member-changes')store.db.prepare('DELETE FROM amendment_member_current WHERE generation=? AND target=?').run(generation,id);
    },
    advance:({id},body)=>({rebuild:{...body.rebuild,...(body.rebuild.kind==='profile'?{offset:body.rebuild.offset+1}:{afterTarget:id})}}),
  });
  if(complete&&scope.kind==='member-changes'&&store.db.prepare('SELECT 1 FROM amendment_member_pending WHERE generation=? LIMIT 1').get(generation)) {
    store.transaction(()=>{
      store.finishTask(task);
      enqueueAmendment(store,generation,task.key,'amendment-rebuild',{rebuild:newRebuildScope(worker,generation,{kind:'member-changes'})},task.priority,true);
    });
    return false;
  }
  if(complete&&scope.kind==='sitting'&&task.body.rebuild.requestedRevision!==task.body.rebuild.revision) {
    const latest=task.body.rebuild;
    store.taskProgress(task,{...task.body,rebuild:newRebuildScope(worker,generation,{kind:latest.kind,sittingId:latest.sittingId,revision:latest.requestedRevision,requestedRevision:latest.requestedRevision})});
    return false;
  }
  return complete;
}
async function beginRebuild(worker,task,scope) {
  task.body={...task.body,rebuild:newRebuildScope(worker,task.generation,scope)};
  worker.store.taskProgress(task,task.body);
  return runRebuildSlice(worker,task);
}
export async function refreshSittingTargets(worker,generation,sittingId,work) {
  const store=worker.store,key='amendment:rebuild-sitting:'+sittingId;
  const revision=createHash('sha256').update(JSON.stringify([amendmentSitting(work),store.source(generation,'amendment:aliases:'+sittingId)?.work || null])).digest('hex');
  const request=body=>({...body,rebuild:{...body.rebuild,requestedRevision:revision}});
  const existing=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
  if(existing&&existing.done===0)store.taskProgress({...existing,amendmentJob:true},request(JSON.parse(existing.body)));
  else if(existing&&existing.done===1&&JSON.parse(existing.body).rebuild?.revision===revision)return true;
  else {
    const saved=store.source(generation,'amendment:continuations')?.work;
    const pending=saved?.tasks?.find(task=>task.key===key);
    if(pending) {
      const tasks=saved.tasks.map(task=>task.key===key?{...task,body:JSON.stringify(request(JSON.parse(task.body)))}:task);
      store.putSource(generation,'amendment:continuations','amendment-continuations',{...saved,tasks},new Date(worker.clock()).toISOString());
    } else if(!enqueueAmendment(store,generation,key,'amendment-rebuild',{rebuild:newRebuildScope(worker,generation,{kind:'sitting',sittingId,revision,requestedRevision:revision})},110,true))return false;
  }
  const row=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=? AND done=0').get(generation,key);
  if(row) {
    const task={...row,body:JSON.parse(row.body),amendmentJob:true};
    if(await runRebuildSlice(worker,task))store.finishTask(task);
  }
  return true;
}
const normalizedName=value=>String(value || '').normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('und');
function scheduleProfileDependency(worker,generation,id,targetId,enqueue=enqueueAmendment) {
  const store=worker.store,key='amendment:member:'+id,checkpointKey='amendment:continuations';
  const merge=()=>{
    store.assertWriter();
    const existing=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
    const saved=store.source(generation,checkpointKey)?.work || {},deferred=(saved.tasks || []).filter(task=>task.key===key&&task.done!==1);
    const pending=existing?[existing,...deferred]:deferred;
    const dependencies=[...new Set([...pending.flatMap(task=>array(JSON.parse(task.body).targets)),targetId])];
    const extend=body=>{
      const targets=[...array(body.targets)];
      for(const target of dependencies)if(!targets.includes(target)) {
        if(targets.length<100)targets.push(target);
      }
      return {...body,targets};
    };
    let next=saved;
    if(deferred.length)next={...next,tasks:(saved.tasks || []).map(task=>task.key===key&&task.done!==1?{...task,body:JSON.stringify(extend(JSON.parse(task.body)))}:task)};
    if(existing?.done===0) {
      store.db.prepare('UPDATE amendment_jobs SET body=? WHERE generation=? AND key=?').run(JSON.stringify(extend(JSON.parse(existing.body))),generation,key);
    } else if(!deferred.length) {
      const body=extend(existing?JSON.parse(existing.body):{id,targets:[]});
      if(existing?.done===1){delete body.rebuild;delete body.profileStored;}
      enqueue(store,generation,key,'amendment-member',body,107,existing?.done===1);
    }
    if(next!==saved) {
      // Admission can also append a full snapshot or capacity gap. Preserve
      // those writes when recording the merged dependency bodies.
      const admitted=store.source(generation,checkpointKey)?.work || saved;
      store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,checkpointKey,'amendment-continuations',JSON.stringify({...admitted,...next,tasks:next.tasks || admitted.tasks}),new Date(worker.clock()).toISOString());
    }
  };
  return store.db.isTransaction?merge():store.transaction(merge);
}
function scheduleMandateProfiles(worker,generation,targetId,lists,aliases,enqueue=enqueueAmendment) {
  const store=worker.store;
  const needsNames=lists.some(({work})=>hasNonLatinAuthors(work.extraction));
  const directory=store.source(generation,'amendment:members:10');
  if(store.get('amendmentMandateFallback')&&(!directory||needsNames&&directory.work.nameVersion!==AMENDMENT_AUTHOR_NAMES_VERSION)){enqueue(store,generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108,true);return;}
  const members=[...(directory?.work.members || []),...store.memberProfiles(generation).map(source=>source.work)],names=new Set(lists.flatMap(({work})=>(work.extraction?.amendments || []).flatMap(amendment=>amendment.authors || [])).map(normalizedName));
  const authorTarget=store.db.prepare('INSERT OR IGNORE INTO amendment_author_targets VALUES (?,?,?)');
  for(const name of names)if(name)authorTarget.run(generation,name,targetId);
  const ids=new Set(members.filter(member=>[['givenName','familyName'],['officialGivenName','officialFamilyName']].some(([g,f])=>member[g]&&member[f]&&(names.has(normalizedName(member[g]+' '+member[f]))||names.has(normalizedName(member[f]+' '+member[g]))))).map(member=>member.id));
  for(const alias of aliases)if(names.has(normalizedName(alias.alias)))ids.add(String(alias.personId));
  const latestDate=lists.flatMap(({work})=>(work.extraction?.amendments || []).map(amendment=>amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:work.document_date})?.date)).filter(Boolean).sort().at(-1);
  const dependency=store.db.prepare('INSERT OR IGNORE INTO amendment_member_dependencies VALUES (?,?,?)');
  for(const id of ids)dependency.run(generation,String(id).replace(/^person\//,''),targetId);
  if(!store.get('amendmentMandateFallback'))return;
  for(const id of ids) {
    const profile=store.source(generation,'amendment:member:'+id);
    if(profile&&(!needsNames||profile.work.nameVersion===AMENDMENT_AUTHOR_NAMES_VERSION) && (!latestDate || profile.fetchedAt.slice(0,10)>=latestDate))continue;
    scheduleProfileDependency(worker,generation,id,targetId,enqueue);
  }
}
function rosterMembers(worker,generation,date,profiles) {
  if(!validAmendmentDate(date))return {members:[],source:[]};
  const saved=worker.store.source(generation,rosterKey(date));
  // These intervals describe one observed mandate day, not a whole mandate.
  return {members:[...(saved?.work.members || []).map(member=>({...member,mandates:[{start:date,end:date}]})),...(profiles || worker.store.memberProfiles(generation)).filter(source=>source.fetchedAt.slice(0,10)>=date).map(source=>source.work)],source:saved?.work.sources || []};
}
function cachedDirectSittings(store,generation,targetId) {
  const reference='eli/dl/doc/'+targetId+'-AM-%';
  const candidates=store.db.prepare(`SELECT source.key,source.body FROM (
    SELECT DISTINCT source_key FROM amendment_sitting_references WHERE generation=? AND version=? AND reference LIKE ?
    ORDER BY source_key DESC LIMIT ?) matched CROSS JOIN sources source ON source.generation=? AND source.key=matched.source_key
    ORDER BY source.key DESC`).all(generation,AMENDMENTS_VERSION,reference,AMENDMENT_LIMITS.sittingsPerTarget+1,generation);
  return {limited:candidates.length>AMENDMENT_LIMITS.sittingsPerTarget,sittingIds:candidates.slice(0,AMENDMENT_LIMITS.sittingsPerTarget).filter(source=>array(amendmentSitting(JSON.parse(source.body)).decisions).some(decision=>array(decision.decided_on_a_realization_of).some(value=>amendmentReference(value)?.targetDocumentId===targetId))).map(source=>source.key.replace(/^motion-outcomes:/,'')).filter(id=>/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(id))};
}
export function rebuildAmendmentTarget(worker,generation,id,{listLimit=false,observedDecisionIds=[],discoveredSittingIds=[],discover=true,enqueue=enqueueAmendment}={}) {
  if(id?.startsWith('committee:'))return rebuildCommitteeList(worker,generation,id,{rosterMembers,scheduleMandateProfiles,verifiedWording,discover});
  const store=worker.store,saved=store.source(generation,targetKey(id));if(!saved)return;
  const priorTarget=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const cachedDirect=cachedDirectSittings(store,generation,id);
  const discovered=[...new Set([...(priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[]),...cachedDirect.sittingIds,...discoveredSittingIds])];
  const target=targetMetadata(saved.work,saved.fetchedAt,targetKey(id)),rows=new Map(),gaps=[],observed=new Set(observedDecisionIds);
  target.listProjectionVersion=saved.work.amendmentLinksVersion ?? null;
  target.discoveredSittingIds=discovered;
  const relationshipsKnown=Object.hasOwn(saved.work,'inverse_foresees_change_of')&&saved.work.inverse_foresees_change_of!=null&&saved.work.amendmentLinksVersion===AMENDMENT_LINKS_VERSION;
  // Parser recovery has its own bounded list walk. Rebuild accepted rows from
  // saved evidence without starting a second report-wide discovery fan-out.
  const linked=prepareLinkedLists(worker,generation,saved.work,saved.fetchedAt,{discover,enqueue,sittingIds:[...amendmentSittings(saved.work),...discovered]});
  const currentListIds=linked.candidates.map(candidate=>candidate.id);
  const currentLists=new Set(currentListIds);
  target.linkedListCount=currentListIds.length;target.linkedListObservationCount=currentListIds.length+linked.unavailable;target.unresolvedListObservationCount=linked.unavailable;target.unresolvedListIds=linked.unresolved;
  // Persist this narrow source observation separately from legacy completeness,
  // which also requires amendment wording/decisions and at least one row.
  target.emptyObservation=relationshipsKnown&&Array.isArray(saved.work.inverse_foresees_change_of)&&saved.work.inverse_foresees_change_of.length===0?
    {version:AMENDMENT_EMPTY_OBSERVATION_VERSION,documentId:id,relationship:'inverse_foresees_change_of',scope:'published-amendment-list-relationships',listCount:0,source:target.sources[0]}:null;
  const lists=store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=?").all(generation,id).map(row=>{const work=JSON.parse(row.body);return {work,fetchedAt:row.fetched_at,current:currentLists.has(idOf(work))};}).sort((a,b)=>Number(b.current)-Number(a.current));
  const sittingSources=[...new Set([...amendmentSittings(saved.work),...discovered])].map(sittingId=>{const record=store.cachedSource(generation,motionSourceKey(sittingId));return {sittingId,record:record?{...record,work:amendmentSitting(record.work)}:null};});
  target.sittingIds=sittingSources.map(source=>source.sittingId);
  const aliases=sittingSources.flatMap(({sittingId})=>store.cachedSource(generation,'amendment:aliases:'+sittingId)?.work.aliases || []);
  // Reuse only this rebuild's immutable source context; never cache identities
  // across a roster, alias or profile refresh.
  const profiles=store.memberProfiles(generation),authorContexts=new Map();
  const authorContext=date=>{
    if(!authorContexts.has(date)) {
      const roster=rosterMembers(worker,generation,date,profiles),activeIds=new Set(roster.members.map(member=>String(member.id)));
      const datedAliases=aliases.filter(alias=>activeIds.has(String(alias.personId).replace(/^person\//,'')));
      authorContexts.set(date,{roster,resolve:createAmendmentAuthorResolver({members:roster.members,aliases:datedAliases,date,relatedSittingDates:sittingSources.map(({sittingId})=>sittingId.slice(7))})});
    }
    return authorContexts.get(date);
  };
  if(discover)scheduleMandateProfiles(worker,generation,id,lists,aliases,enqueue);
  const base=(amendmentId,number)=>({id:amendmentId,number,scope:'plenary',contributionKind:'tabled-amendment',listId:null,targetDocumentId:id,title:target.titles.en || id,titles:target.titles,date:null,documentDate:null,listDocumentDate:null,dateBasis:null,proposerDate:null,proposerDateBasis:null,targetDocumentDate:target.date,procedureIds:target.procedureIds,targetLabel:null,targetLabelLanguage:null,targetLabelSource:null,originalText:null,proposedText:null,language:null,authors:[],decisions:[],splitParts:[],topics:target.topics,sources:[...target.sources],gaps:[],identifierBasis:'derived-from-exact-target-and-number',officialIds:[]});
  if(cachedDirect.limited)gaps.push('This target exceeds the cached direct-decision sitting discovery limit.');
  if(!relationshipsKnown)gaps.push('Current amendment-list relationships are unavailable; previously indexed list evidence is unverified and retained.');
  if(listLimit || target.linkedListObservationCount>AMENDMENT_LIMITS.listsPerTarget)gaps.push('This target exceeds the amendment-list processing limit.');
  if(linked.unavailable)gaps.push('Some linked amendment-list records have no usable exact EP document reference.');
  for(const listId of linked.unresolved)gaps.push('Linked amendment list '+listId+' is awaiting exact document-detail verification.');
  if(!lists.length)gaps.push('No published amendment list is indexed for this target.');
  const invalidatedTextListIds=lists.filter(({work:list})=>list.extraction?.previousParserVersion&&list.extraction.previousParserVersion!==AMENDMENT_EXTRACTION_VERSION).map(({work})=>idOf(work));
  for(const {work:list,current} of lists) {
    const listNameContexts=new Map();
    const extraction=list.extraction,date=list.document_date || null,sourceFreshness=listWordingFreshness(list,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
    if(!current&&relationshipsKnown)gaps.push('A previously indexed amendment list is absent from the current target relationships; its evidence is retained.');
    if(!extraction){
      gaps.push(sourceFreshness.status==='failed'?'Initial amendment text extraction failed; its source error and retry time are retained.':!sourceFreshness.descriptor?'Current amendment DOCX distribution metadata is unavailable or empty; no current text source can be retrieved.':'Amendment text extraction is pending.');
      continue;
    }
    gaps.push(...(extraction.gaps || []).map(gap=>typeof gap==='string'?gap:gap.message || gap.reason || gap.code || 'Document extraction is incomplete.'));
    if(extraction.lastRefreshFailure)gaps.push('An amendment-list refresh has incomplete text or amendment coverage; retained evidence is labelled on its record.');
    for(const amendment of extraction.amendments || []) {
      const number=Number(amendment.number);if(!Number.isInteger(number)||number<1||number>99999)continue;
      const amendmentId=id+'-AM-'+number,row=base(amendmentId,number);
      const proposerDate=amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:list.document_date});
      const authorDate=proposerDate?.date || null,{roster,resolve}=authorContext(authorDate);
      const textLosses=amendmentTextLosses(extraction,amendment);
      const acceptedWording=verifiedWording(extraction,amendment),incompatible=extraction.parserVersion!==AMENDMENT_EXTRACTION_VERSION || (amendment.wordingParserVersion!=null&&amendment.wordingParserVersion!==AMENDMENT_EXTRACTION_VERSION),withhold=incompatible || Boolean(textLosses.length&&!acceptedWording);
      Object.assign(row,{listId:idOf(list),listRelationship:current?linked.verified.has(idOf(list))?'current':'unverified':relationshipsKnown?'absent-current-relationship':'unverified',date:amendment.date || date,baseline:amendment.baseline ?? 'unknown',baselineSource:amendment.baselineSource??null,documentReferences:amendment.documentReferences??[],targetPath:amendment.targetPath??null,targetLabel:text(amendment.targetLabel),originalText:withhold?null:typeof amendment.originalText==='string'?amendment.originalText:null,proposedText:withhold?null:typeof amendment.proposedText==='string'?amendment.proposedText:null,originalFormatting:withhold?[]:amendment.originalFormatting || [],proposedFormatting:withhold?[]:amendment.proposedFormatting || [],textIntegrity:acceptedWording?'complete':withhold?'incomplete':'unavailable',textParserVersion:amendment.wordingParserVersion || extraction.parserVersion,wordingSource:Object.hasOwn(amendment,'wordingSource')?amendment.wordingSource:extractionSource(extraction),metadataSource:Object.hasOwn(amendment,'metadataSource')?amendment.metadataSource:extractionSource(extraction),proposerSource:Object.hasOwn(amendment,'proposerSource')?amendment.proposerSource:extractionSource(extraction),wordingRetained:Boolean(amendment.wordingRetained),proposerRetained:Boolean(amendment.proposerRetained),proposerDate:authorDate,proposerDateBasis:proposerDate?.basis || null,recordRetained:Boolean(amendment.recordRetained),language:amendment.language || extraction.language,onBehalfOf:amendment.onBehalfOf || null,committeeProposer:amendment.committeeProposer || null,documentDate:amendment.documentDate || amendment.date || null,listDocumentDate:list.document_date || null,dateBasis:amendment.dateBasis || (amendment.date?'individual-amendment-document':null),justification:text(amendment.justification)});
      row.sourceFreshness=sourceFreshness;
      row.targetLabelLanguage=row.targetLabel?(Object.hasOwn(amendment,'targetLabelLanguage')?amendment.targetLabelLanguage:extraction.parserVersion===AMENDMENT_EXTRACTION_VERSION?amendment.metadataSource?.language ?? extraction.language ?? null:null):null;
      row.targetLabelSource=row.targetLabel?(Object.hasOwn(amendment,'targetLabelSource')?amendment.targetLabelSource:extraction.parserVersion===AMENDMENT_EXTRACTION_VERSION?amendment.metadataSource || extractionSource(extraction):null):null;
      if(sourceFreshness.status!=='fresh') {
        row.wordingRetained=Boolean(acceptedWording&&!withhold);
        row.gaps.push('Amendment wording source distribution is '+sourceFreshness.status+'; current retrieval has not been verified.');
        gaps.push('Some amendment wording source distributions are pending, unverified or failed; retained wording is labelled.');
      }
      const nameProof=list.authorNames?.version===AMENDMENT_AUTHOR_NAMES_VERSION&&list.authorNames.parserVersion===AMENDMENT_EXTRACTION_VERSION&&sameDocxDescriptor(list.authorNames.primaryDescriptor,extraction.sourceDescriptor)&&list.distributionEvidence?.descriptors?.some(file=>sameDocxDescriptor(file,list.authorNames.descriptor))?list.authorNames:null;
      if(!listNameContexts.has(authorDate))listNameContexts.set(authorDate,listAuthorResolver({extraction,alternate:nameProof,resolve,date:authorDate,source:nameProof?.source}));
      const listResolve=listNameContexts.get(authorDate);
      const sourceAuthors=listResolve(amendment.authors || []).map(author=>({...author,nameVariants:[...(author.nameVariants || []),...authorNameVariants(author,row.proposerSource)]}));
      const alternate=nameProof?.amendments.filter(other=>Number(other.number)===number)||[];
      row.authors=resolveParallelAuthors({authors:sourceAuthors,amendment:{...amendment,listId:idOf(list),targetDocumentId:id},alternate:alternate.length===1?alternate[0]:null,resolve,source:list.authorNames?.source}).map(author=>({...author,...(!authorDate?{personId:null,status:'missing_proposer_date',method:null}:{}),personId:authorDate&&author.personId!=null?String(author.personId).replace(/^person\//,''):null,evidence:[...(author.evidence || []),...(roster.source.length?[{type:'dated_roster',sources:roster.source,mandateObservedOn:authorDate}]:[])]}));
      row.sources.push(...(amendment.sources || []),{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language});
      if(row.targetLabelSource?.url)row.sources.push(row.targetLabelSource);
      if(list.relationshipEvidence?.url)row.sources.push({url:list.relationshipEvidence.url,fetchedAt:list.relationshipEvidence.fetchedAt,language:null});
      row.gaps.push(...(amendment.gaps || []).map(gap=>typeof gap==='string'?gap:gap.message || gap.code || 'Amendment extraction is incomplete.'));
      row.gaps.push(...textLosses.map(gap=>gap.message || gap.code));
      if(incompatible)row.gaps.push('Amendment wording is unverified until the current document parser refreshes its source.');
      if(row.authors.length&&!authorDate)row.gaps.push('The amendment proposer date is unavailable; author identities cannot be checked against a mandate.');
      if(!current&&!relationshipsKnown)row.gaps.push('The current amendment-list relationship is unavailable; this list evidence is unverified and retained.');
      if(!current&&relationshipsKnown)row.gaps.push('This amendment list is absent from the current target relationships; its earlier evidence is retained.');
      if(current&&!linked.verified.has(idOf(list)))row.gaps.push('The current amendment-list relationship awaits exact document-detail verification; previously accepted evidence is retained.');
      if(!row.authors.length)row.gaps.push('Individual amendment authors are not recorded in the extracted source.');
      if(row.authors.some(author=>!author.personId))row.gaps.push('Some author identities are unresolved.');
      if(row.language!=='en')row.gaps.push('English amendment text is unavailable; the published source language is retained.');
      const previous=rows.get(amendmentId);
      if(previous){
        const variant=value=>({listId:value.listId,listRelationship:value.listRelationship,date:value.date,language:value.language,baseline:value.baseline ?? 'unknown',baselineSource:value.baselineSource??null,documentReferences:value.documentReferences??[],targetPath:value.targetPath??null,targetLabel:value.targetLabel,targetLabelLanguage:value.targetLabelLanguage,targetLabelSource:value.targetLabelSource,originalText:value.originalText,proposedText:value.proposedText,originalFormatting:value.originalFormatting || [],proposedFormatting:value.proposedFormatting || [],textIntegrity:value.textIntegrity,textParserVersion:value.textParserVersion,sourceFreshness:value.sourceFreshness,wordingSource:value.wordingSource,metadataSource:value.metadataSource,proposerSource:value.proposerSource,wordingRetained:value.wordingRetained,proposerRetained:value.proposerRetained,proposerDate:value.proposerDate,proposerDateBasis:value.proposerDateBasis,authors:value.authors,onBehalfOf:value.onBehalfOf,committeeProposer:value.committeeProposer,documentDate:value.documentDate,listDocumentDate:value.listDocumentDate,dateBasis:value.dateBasis,justification:value.justification,sources:[...value.sources],gaps:[...value.gaps]});
        row.variants=[...(previous.variants || [variant(previous)]),variant(row)];
        row.conflicted=true;row.baseline='unknown';row.baselineSource=null;row.documentReferences=[];row.targetPath=null;row.listRelationship='conflicting-variants';row.listId=null;row.originalText=null;row.proposedText=null;row.originalFormatting=[];row.proposedFormatting=[];row.authors=[];row.language=null;row.targetLabel=null;row.targetLabelLanguage=null;row.targetLabelSource=null;row.onBehalfOf=null;row.justification=null;
        Object.assign(row,checkedAggregateAttribution(row));
        row.gaps.push(...previous.gaps);
        row.gaps.push('Multiple amendment lists contain this number; wording and authorship are withheld because no revision precedence is established.');
        gaps.push('Conflicting amendment-list variants are retained; displayed wording and authorship are withheld.');
        row.sources.push(...previous.sources);
      }
      rows.set(amendmentId,row);
    }
  }
  const freshSplitParts=new Map();
  for(const {sittingId,record} of sittingSources) {
    if(!record){gaps.push('Linked sitting decisions are pending.');continue;}
    if(record.work.truncated || record.work.lastRefreshFailure)gaps.push('A linked sitting has incomplete or failed decision coverage.');
    if(record.work.retainedEvidence)gaps.push('A linked sitting retains accepted amendment evidence absent or unresolved in its latest source graph.');
    if(record.work.splitProjectionTruncated)gaps.push('A linked sitting reached the split-request pagination limit; request coverage is incomplete.');
    if(record.work.amendmentVersion!==AMENDMENTS_VERSION){gaps.push('Linked sitting amendment relationships are pending.');continue;}
    if(record.work.amendmentProjectionVersion!==AMENDMENT_SITTING_PROJECTION_VERSION)gaps.push('Linked sitting split-request projection is unverified until its source graph is refreshed.');
    const parts=new Map((record.work.parsedSplits || []).flatMap(request=>{
      const componentIds=[...new Set((request.parts || []).map(part=>canonicalEPReference(part.id)).filter(Boolean))];
      const requestCoverage={version:AMENDMENT_OUTCOME_PROOF_VERSION,requestId:request.requestId || null,registryRequestKey:request.requestId || request.observationKey || null,componentCount:(request.parts || []).length,componentIds,
        sourceComplete:Boolean(request.requestId&&componentIds.length===(request.parts || []).length&&!record.work.splitProjectionTruncated&&record.work.amendmentProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION&&request.sourceProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION&&!(request.failures || []).some(failure=>failure.scope==='request'))};
      return (request.parts || []).flatMap(part=>{
        const reference=canonicalEPReference(part.id);
        return reference?[[reference,{...part,id:reference,requestId:request.requestId,requestCoverage,grounding:'not_attempted',parserVersion:record.work.splitParserVersion}]]:[];
      });
    }));
    for(const [reference,part] of parts)freshSplitParts.set(reference,part);
    for(const decision of record.work.decisions || []) {
      if(hasDecisionReferenceSet(decision))observed.add(tail(decision.id));
      const references=array(decision.decided_on_a_realization_of),amendments=references.map(amendmentReference).filter(ref=>ref?.targetDocumentId===id);
      const splitRefs=references.filter(ref=>/-SPLIT-\d+-\d+$/.test(tail(ref)));
      for(const ref of amendments) {
        const normalized=id+'-AM-'+ref.number,row=rows.get(normalized) || base(ref.id,ref.number);
        if(!rows.has(normalized)){row.gaps.push('Amendment wording and authorship are unavailable.');rows.set(normalized,row);}
        row.identifierBasis='official-decision-reference';
        row.officialIds=[...new Set([...(row.officialIds || []),'eli/dl/doc/'+ref.id])];
        const evidence=sourceEvidence(decision,record.work.sources,'decisions');
        const vote={...amendmentDecision(decision,sittingId,evidence.source),sourceCandidates:evidence.sourceCandidates,provenance:evidence.provenance};
        if(decision.amendmentEvidenceRetained)row.gaps.push(decision.relationshipRetained?'A refreshed decision has unavailable amendment references; its accepted binding is retained.':'An amendment decision is retained because it was absent from the latest source graph.');
        if(!evidence.source)row.gaps.push('An amendment decision has no exact recorded source page; candidate page provenance is retained.');
        if(splitRefs.length&&vote.collective) {
          const componentReferences=[...new Set(splitRefs.map(ref=>canonicalEPReference(ref)||String(ref?.id || ref)))];
          row.decisions.push({...vote,partId:null,partNumber:null,componentBinding:'unresolved-collective',componentReferences,requestCoverages:componentReferences.map(reference=>parts.get(reference)?.requestCoverage).filter(Boolean)});
        } else if(splitRefs.length)for(const partRef of splitRefs) {
          const reference=canonicalEPReference(partRef),part=reference?parts.get(reference):null;
          row.decisions.push({...vote,partId:reference || String(partRef?.id || partRef),partNumber:part?.number || Number(tail(partRef).split('-').at(-1)),componentBinding:'single-amendment',componentReferences:[reference || String(partRef?.id || partRef)],requestCoverages:part?.requestCoverage?[part.requestCoverage]:[]});
          if(part && !row.splitParts.some(existing=>existing.id===part.id))row.splitParts.push(part);
          if(!part)row.gaps.push('A split component has no indexed description.');
          else if(part.status==='unresolved')row.gaps.push('A split description could not be parsed; the failure is retained for a future parser update.');
          else row.gaps.push('Split descriptions are parsed as selection plans; exact wording spans have not been validated.');
          if(part&&!part.source?.url)row.gaps.push('The split description has no exact recorded source page; candidate page provenance is retained.');
        } else row.decisions.push(vote);
        if(!row.targetLabel&&decision.referenceText?.en){row.targetLabel=decision.referenceText.en;row.targetLabelLanguage='en';row.targetLabelSource=evidence.source?{...evidence.source,language:'en'}:null;}
        row.sources.push(...(record.work.sources || []));
      }
    }
  }
  for(const row of rows.values()) {
    if(row.targetLabel)row.topics=[...row.topics,{id:'target:'+row.targetLabel,label:row.targetLabel,basis:'target',language:row.targetLabelLanguage,source:row.targetLabelSource}];
    if(!row.decisions.length)row.gaps.push('No explicit amendment outcome is indexed.');
    row.gaps=[...new Set(row.gaps)];
    row.decisions=[...new Map(row.decisions.map(vote=>[vote.id+':'+(vote.partId || ''),vote])).values()];
    row.sources=[...new Map(row.sources.filter(source=>source?.url).map(source=>[source.url+':'+(source.language || ''),source])).values()];
  }
  if([...rows.values()].some(row=>row.gaps.some(gap=>gap!=='Split descriptions are parsed as selection plans; exact wording spans have not been validated.')))gaps.push('Some amendment records have incomplete text, authorship, identity or outcome evidence.');
  const uniqueGaps=[...new Set(gaps)];
  saveAmendmentRows(store,generation,target,[...rows.values()],{complete:!uniqueGaps.length&&rows.size>0,gaps:uniqueGaps,lastUpdated:new Date(worker.clock()).toISOString(),parserVersion:SPLIT_PARSER_VERSION},{observedDecisionIds:[...observed],freshSplitParts:[...freshSplitParts.values()],invalidatedTextListIds,textParserVersion:AMENDMENT_EXTRACTION_VERSION,currentListIds,listRelationshipsKnown:relationshipsKnown});
}
async function downloadVotingXml(url,{signal}={}) {
  signal?.throwIfAborted();
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='data.europarl.europa.eu'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/distribution\/.+\.xml$/.test(parsed.pathname))throw new Error('Unapproved official voting XML URL.');
  const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'application/xml,application/octet-stream','User-Agent':userAgent('voting aliases')},signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])])},resolve).on('error',reject));
  const limited=upstreamResponseError(response,{source:'documents'});
  if(limited){response.resume();throw limited;}
  if(response.statusCode!==200){response.resume();throw new Error(`Official voting XML unavailable (${response.statusCode}).`);}
  if(!/(?:xml|octet-stream)/i.test(response.headers['content-type'] || '')){response.destroy();throw new Error('Unexpected official voting XML format.');}
  const chunks=[];let bytes=0;
  for await(const chunk of response){bytes+=chunk.length;if(bytes>20*1024*1024){response.destroy();throw new Error('Official voting XML exceeds 20 MiB.');}chunks.push(chunk);}
  signal?.throwIfAborted();
  return Buffer.concat(chunks).toString('utf8');
}
export async function amendmentTask(worker,task) {
  const {generation,body}=task,store=worker.store,signal=worker.controller.signal;
  signal.throwIfAborted();
  if(task.kind.startsWith('amendment-committee-')){await committeeDiscoveryTask(worker,task,{rebuild:rebuildAmendmentTarget});return;}
  if(task.kind==='amendment-prepare'){await runPreparationSlice(worker,task);return;}
  if(task.kind==='amendment-parser-upgrade'){await runParserUpgradeSlice(worker,task);return;}
  if(body.rebuild) {
    if(!await runRebuildSlice(worker,task))return;
  } else if(task.kind==='amendment-reparse') {
    const source=store.source(generation,body.sourceKey);if(!source)throw new Error('Saved split request source is unavailable.');
    const evidence=parseSavedSplits(worker,amendmentSitting(source.work));
    const updated=source.work.amendmentEvidence?{...source.work,amendmentEvidence:evidence}:evidence;
    store.putSource(generation,body.sourceKey,'motion-outcomes',updated,source.fetchedAt);
    if(!await beginRebuild(worker,task,{kind:'sitting',sittingId:body.sourceKey.replace(/^motion-outcomes:/,'')}))return;
  } else if(task.kind==='amendment-list-detail') {
    const target=store.source(generation,targetKey(body.targetDocumentId));
    const retained=body.parserUpgrade&&store.source(generation,sourceKey(body.listId))?.work;
    const candidate=target&&linkedListCandidates(target.work).candidates.slice(0,AMENDMENT_LIMITS.listsPerTarget).find(candidate=>candidate.id===body.listId) ||
      (retained&&retained.targetDocumentId===body.targetDocumentId&&canonicalEPReference(retained.id)==='eli/dl/doc/'+body.listId?{id:body.listId,reference:'eli/dl/doc/'+body.listId,fingerprint:null}:null);
    if(candidate) {
      const proofReady=body.parserUpgrade&&verifiedList(retained,body.targetDocumentId,body.listId)&&Boolean(currentDocxDescriptor(retained));
      if(!proofReady) {
        const record=await worker.request('/documents/'+candidate.id);signal.throwIfAborted();
        const list=record.payload.data.find(work=>canonicalEPReference(work.id)===candidate.reference);
        if(!verifiedList(list,body.targetDocumentId,candidate.id))throw new Error('Linked amendment-list detail does not verify its exact document identity, type and forward target.');
        saveVerifiedList(worker,generation,body.targetDocumentId,candidate,list,{basis:'list-detail',url:record.url,fetchedAt:record.fetchedAt},{parserUpgrade:Boolean(body.parserUpgrade)});
      }
      if(body.parserUpgrade&&currentDocxDescriptor(store.source(generation,sourceKey(body.listId))?.work)&&!admitAmendmentList(store,generation,'amendment:extract:'+body.listId,'amendment-extract',{...body},112,task.key)) {
        store.db.prepare('UPDATE amendment_jobs SET retry_at=? WHERE generation=? AND key=?').run(worker.clock()+60_000,generation,task.key);
        return;
      }
      rebuildAmendmentTarget(worker,generation,body.targetDocumentId,{discover:!body.parserUpgrade});
    }
  } else if(task.kind==='amendment-extract') {
    const saved=store.source(generation,sourceKey(body.listId));if(!saved)throw new Error('Amendment-list metadata is unavailable.');
    const parserUpgrade=Boolean(body.parserUpgrade||saved.work.extraction&&saved.work.extraction.parserVersion!==AMENDMENT_EXTRACTION_VERSION);
    const file=currentDocxDescriptor(saved.work);
    if(!file) {
      // A queued job can outlive the metadata that admitted it. Absence is an
      // observation to expose, not permission to download a historical URL.
      store.finishTask(task);
      rebuildAmendmentTarget(worker,generation,body.targetDocumentId,{discover:!parserUpgrade});
      return;
    }
    const sources=amendmentSourceStore(store);
    const target=store.source(generation,targetKey(body.targetDocumentId))?.work;
    const targetRow=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,body.targetDocumentId);
    const settled=amendmentListSettled(saved.work,{now:worker.clock(),sittingIds:[...amendmentSittings(target),...(targetRow?JSON.parse(targetRow.body).sittingIds || []:[])]});
    // Settled lists, parser-only work and retries after this job's download read the
    // retained bytes of a still-current descriptor at any age. Their original
    // retrieval time remains the wording's retrieval time.
    const retrieve=async descriptor=>{
      const retained=settled||parserUpgrade||body.sourceDownloaded?await sources.read(descriptor,{listId:body.listId,signal}):null;
      if(retained)return retained;
      const defer=wait=>{
        store.assertWriter();
        store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET retry_at=? WHERE generation=? AND key=?`).run(worker.clock()+wait,generation,task.key);
        return null;
      };
      const wait=worker.requests>=worker.budget?30*60_000:parserUpgrade?parserDownloadWait(worker):0;
      if(wait>0)return defer(wait);
      // The source queue can hold an operation through a cooldown. Pace and
      // count the download when it actually starts, not when it is queued.
      let paced=0,downloaded;
      try {
        downloaded=await worker.runUpstream(admittedSignal=>{
          if(parserUpgrade){paced=parserDownloadWait(worker);if(paced>0)return null;recordParserDownload(worker);}
          worker.requests++;const cycle=store.get('working');if(cycle)store.updateCycle({requests:(cycle.requests || 0)+1});
          return worker.downloadAmendmentDocx(descriptor.url,{signal:admittedSignal});
        },{source:'documents',priority:'background',signal});
      }
      catch(error){signal.throwIfAborted();throw error;}
      signal.throwIfAborted();
      if(paced>0)return defer(paced);
      return {...downloaded,fetchedAt:new Date(worker.clock()).toISOString()};
    };
    const parseSource=async (descriptor,downloaded)=>{
      const fetchedAt=downloaded.fetchedAt;
      const reportId=saved.work.reportWording&&sameDocxDescriptor(descriptor,currentDocxDescriptor({...saved.work,distributionEvidence:saved.work.reportWording.distributionEvidence}))?saved.work.reportWording.reportId:null;
      const extraction=await worker.extractAmendmentList(downloaded.buffer,{listId:body.listId,targetDocumentId:saved.work.scope==='committee'?saved.work.targetDocumentId:body.targetDocumentId,language:descriptor.language,sourceUrl:descriptor.url,fetchedAt,...(saved.work.scope==='committee'?{scope:'committee',sourceKind:'amendment-list'}:{}),...(reportId?{reportId}:{})},{signal});
      signal.throwIfAborted();
      if(!Array.isArray(extraction.amendments)||extraction.amendments.length>AMENDMENT_LIMITS.amendmentsPerList)throw new Error('Amendment extraction exceeded its record budget.');
      await sources.save(descriptor,downloaded.buffer,fetchedAt,{listId:body.listId,signal});
      return {extraction,downloaded,publication:publicationEvidence(descriptor,downloaded.buffer)};
    };
    const downloaded=await retrieve(file);
    if(!downloaded)return;
    signal.throwIfAborted();
    // Extraction is CPU work: parse off the main thread and run each list's
    // merge and target rebuild as one paced slice between request bursts.
    const pace=worker.amendmentExtractionPace ||= {};
    await extractionTurn(pace,{signal});
    const sliceStarted=performance.now();
    try {
      const primary=await parseSource(file,downloaded);
      const {extraction,publication}=primary,fetchedAt=primary.downloaded.fetchedAt;
      if(!parserUpgrade)for(const date of [...new Set(extraction.amendments.map(amendment=>amendment.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date || '')))].slice(0,20))if(!store.source(generation,rosterKey(date)))enqueueAmendment(store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114);
      signal.throwIfAborted();
      let authorNames=null;
      const alternate=alternateAuthorDescriptor(saved.work,extraction);
      if(alternate){
        if(!body.sourceDownloaded)store.taskProgress(task,{...body,sourceDownloaded:true});
        try {
          const other=await retrieve(alternate);
          if(!other)return;
          signal.throwIfAborted();
          const result=await parseSource(alternate,other);
          const parsed=result.extraction,otherPublication=result.publication,retrievedAt=result.downloaded.fetchedAt;
          const source={url:alternate.url,fetchedAt:retrievedAt,language:alternate.language,contentHash:otherPublication.sourceHash};
          authorNames={version:AMENDMENT_AUTHOR_NAMES_VERSION,parserVersion:AMENDMENT_EXTRACTION_VERSION,primaryDescriptor:publication.sourceDescriptor,descriptor:otherPublication.sourceDescriptor,source,amendments:parsed.amendments.map(({listId,targetDocumentId,number,authors,date,documentDate,dateBasis})=>({listId,targetDocumentId,number,authors,date,documentDate,dateBasis}))};
        }catch(error){signal.throwIfAborted();authorNames={version:AMENDMENT_AUTHOR_NAMES_VERSION,descriptor:alternate,error:String(error.message).slice(0,350),source:{url:alternate.url,language:alternate.language},attemptedAt:new Date(worker.clock()).toISOString(),amendments:[]};}
      }
      const next={...saved.work,sourceRetentionRetryAt:!authorNames?.error&&sources.has(file)&&(!alternate||sources.has(alternate))?null:new Date(worker.clock()+7*DAY).toISOString(),authorNames,extraction:{authorNamesVersion:AMENDMENT_AUTHOR_NAMES_VERSION,...mergeExtractionRefresh(proposerDatedExtraction(store,generation,saved.work),extraction,{url:file.url,fetchedAt,language:file.language,...(extraction.reportId?{reportId:extraction.reportId}:{})},extraction.reportId?null:saved.work.document_date),...publication}};
      delete next.wordingRefreshFailure;
      store.putSource(generation,sourceKey(body.listId),'amendment-list',next,next.extraction.fetchedAt);
      rebuildAmendmentTarget(worker,generation,body.targetDocumentId,{discover:!parserUpgrade});
    } finally {endExtractionTurn(pace,sliceStarted);}
    // A capacity-deferred parser walk can admit the next list now.
    if(parserUpgrade)store.db.prepare("UPDATE amendment_jobs SET retry_at=MIN(retry_at,?) WHERE generation=? AND kind='amendment-parser-upgrade' AND done=0").run(worker.clock(),generation);
  } else if(task.kind==='amendment-roster') {
    const params={'mandate-date':body.date,limit:1000,offset:body.offset};
    const record=await worker.request('/meps/show-current',params);
    const members=record.payload.data.map(person=>({id:String(person.identifier || tail(person.id)),...memberNameFields(person),name:person.label || ''}));
    const identities=new Set(body.members.map(member=>member.id));
    for(const member of members){if(!/^[1-9]\d*$/.test(member.id)||!Number.isSafeInteger(Number(member.id))||identities.has(member.id))throw new Error('Dated amendment roster contains invalid or repeated identities.');identities.add(member.id);}
    const sources=[...body.sources,{url:record.url,fetchedAt:record.fetchedAt}];
    if(members.length){store.taskProgress(task,{...body,members:[...body.members,...members],offset:body.offset+members.length,sources});return;}
    if(!body.members.length)throw new Error('Dated amendment roster is unavailable.');
    store.putSource(generation,rosterKey(body.date),'amendment-roster',{nameVersion:AMENDMENT_AUTHOR_NAMES_VERSION,date:body.date,members:body.members,sources},record.fetchedAt);
    if(!await beginRebuild(worker,task,{kind:'roster',date:body.date}))return;
  } else if(task.kind==='amendment-members') {
    const record=await worker.request('/meps',{'parliamentary-term':10,limit:1000,offset:body.offset});
    const members=record.payload.data.map(person=>({id:String(person.identifier || tail(person.id)),givenName:person.givenName || '',familyName:person.familyName || ''}));
    const identities=new Set(body.members.map(member=>member.id));
    for(const member of members){if(!/^[1-9]\d*$/.test(member.id)||!Number.isSafeInteger(Number(member.id))||identities.has(member.id))throw new Error('Term MEP roster contains invalid or repeated identities.');identities.add(member.id);}
    if(members.length){store.taskProgress(task,{...body,members:[...body.members,...members],offset:body.offset+members.length});return;}
    if(!body.members.length)throw new Error('Term MEP roster is unavailable.');
    const work={nameVersion:AMENDMENT_AUTHOR_NAMES_VERSION,members:body.members,source:{url:record.url,fetchedAt:record.fetchedAt}},revision=memberDirectoryRevision(work);
    const complete=store.source(generation,'amendment:members:10')?.work.rebuildRevision===revision;
    store.putSource(generation,'amendment:members:10','amendment-members',{...work,...(complete?{rebuildRevision:revision}:{})},record.fetchedAt);
    if(!complete&&!await beginRebuild(worker,task,{kind:'members',revision}))return;
  } else if(task.kind==='amendment-member') {
    if(!/^[1-9]\d*$/.test(body.id))throw new Error('Invalid amendment author person ID.');
    if(!body.profileStored) {
      const record=await worker.request('/meps/'+body.id),person=record.payload.data.find(person=>String(person.identifier || tail(person.id))===body.id);
      if(!person)throw new Error('Amendment author profile is unavailable.');
      const member={id:body.id,nameVersion:AMENDMENT_AUTHOR_NAMES_VERSION,...memberNameFields(person),hasMembership:array(person.hasMembership).filter(membership=>tail(membership.role)==='MEMBER_PARLIAMENT'),sourceUrl:record.url,fetchedAt:record.fetchedAt};
      store.putSource(generation,'amendment:member:'+body.id,'amendment-member',member,record.fetchedAt);
      store.taskProgress(task,{...body,profileStored:true});
    }
    const member=store.source(generation,'amendment:member:'+body.id)?.work;
    if(!member)throw new Error('Saved amendment author profile is unavailable.');
    // Until the retained dependency snapshot is ready, preserve the full walk.
    if(!amendmentDependenciesReady(store,generation)) {
      if(!await beginRebuild(worker,task,{kind:'members'}))return;
      store.finishTask(task);return;
    }
    // Arrivals accumulate separately from the current captured pass.
    const admitted=store.transaction(()=>{
      store.db.prepare('INSERT OR IGNORE INTO amendment_member_pending SELECT generation,target FROM amendment_member_dependencies WHERE generation=? AND person_id=?').run(generation,body.id);
      // New official names may resolve an author which had no prior member ID.
      const byName=store.db.prepare('INSERT OR IGNORE INTO amendment_member_pending SELECT generation,target FROM amendment_author_targets WHERE generation=? AND name=?');
      for(const [g,f] of [['givenName','familyName'],['officialGivenName','officialFamilyName']])if(member[g]&&member[f]) {
        byName.run(generation,normalizedName(member[g]+' '+member[f]));
        byName.run(generation,normalizedName(member[f]+' '+member[g]));
      }
      const put=store.db.prepare('INSERT OR IGNORE INTO amendment_member_pending VALUES (?,?)');
      for(const target of body.targets || [])put.run(generation,target);
      if(store.db.prepare("SELECT 1 FROM amendment_jobs WHERE generation=? AND key='amendment:member-changes' AND done=0").get(generation))return true;
      return enqueueAmendment(store,generation,'amendment:member-changes','amendment-rebuild',{rebuild:newRebuildScope(worker,generation,{kind:'member-changes'})},107,true,{deferOnCapacity:true});
    });
    if(!admitted){deferPreparation(worker,task);return;}
  } else if(task.kind==='amendment-aliases') {
    if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(body.sittingId))throw new Error('Invalid voting-alias sitting identifier.');
    const date=body.sittingId.slice(7);
    if(!body.file) {
      const record=await worker.request('/plenary-session-documents/PV-10-'+date+'-RCV');
      const work=record.payload.data.find(node=>node.identifier==='PV-10-'+date+'-RCV');if(!work)throw new Error('Official RCV document is unavailable.');
      const file=documentFiles(work).find(file=>file.format==='XML'&&file.language==='en') || documentFiles(work).find(file=>file.format==='XML');
      if(!file)throw new Error('Official RCV XML distribution is unavailable.');
      store.taskProgress(task,{...body,file,documentSource:{url:record.url,fetchedAt:record.fetchedAt}});return;
    }
    const file=body.file;
    worker.requests++;const cycle=store.get('working');if(cycle)store.updateCycle({requests:(cycle.requests || 0)+1});
    const xml=await worker.runUpstream(admittedSignal=>worker.downloadVotingXml(file.url,{signal:admittedSignal}),{source:'documents',priority:'background',signal});
    signal.throwIfAborted();
    const fetchedAt=new Date(worker.clock()).toISOString(),aliases=votingAliases(xml,{sourceUrl:file.url,fetchedAt,sittingDate:date});
    store.putSource(generation,'amendment:aliases:'+body.sittingId,'amendment-aliases',{aliases,sources:[body.documentSource,{url:file.url,fetchedAt}]},fetchedAt);
    const sitting=store.source(generation,motionSourceKey(body.sittingId));if(sitting&&!await beginRebuild(worker,task,{kind:'sitting',sittingId:body.sittingId}))return;
  } else throw new Error('Unknown amendment task.');
  if(task.kind==='amendment-members'&&task.body.rebuild) {
    const saved=store.source(generation,'amendment:members:10');
    if(saved) {
      const revision=memberDirectoryRevision(saved.work);
      // Legacy cursors have no revision; completing them also establishes the
      // marker. Source retrieval dates alone must never request another pass.
      if(task.body.rebuild.revision==null||task.body.rebuild.revision===revision)store.putSource(generation,'amendment:members:10','amendment-members',{...saved.work,rebuildRevision:revision},saved.fetchedAt);
    }
  }
  store.finishTask(task);
  if(task.kind==='amendment-list-detail')reconcileAmendmentDocumentGap(worker,generation,body.listId);
  store.db.prepare("DELETE FROM sources WHERE generation=? AND key=? AND kind='amendment-gap'").run(generation,'amendment:gap:'+task.key);
}
export function failAmendmentTask(worker,task,error) {
  if(task.kind.startsWith('amendment-committee-')||!task.kind.startsWith('amendment-')||task.kind==='amendment-prepare'||task.kind==='amendment-parser-upgrade'||task.kind==='amendment-rebuild'||task.body.rebuild)return false;
  if(worker.stopped || worker.controller?.signal.aborted)return false;
  if(task.kind==='amendment-roster') {
    worker.store.set('amendmentMandateFallback',true);
    const directory=worker.store.source(task.generation,'amendment:members:10');
    if(!directory||directory.work.nameVersion!==AMENDMENT_AUTHOR_NAMES_VERSION)enqueueAmendment(worker.store,task.generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108);
  }
  let evidence={rejection:null,confirmed:false};
  if(task.kind==='amendment-extract') {
    const row=worker.store.db.prepare('SELECT body FROM amendment_jobs WHERE generation=? AND key=?').get(task.generation,task.key);
    if(row)task.body=JSON.parse(row.body);
    const saved=worker.store.source(task.generation,sourceKey(task.body.listId));
    const previous=Object.hasOwn(task.body,'amendmentRejectedSource')?task.body.amendmentRejectedSource:saved?.work.wordingRefreshFailure?.rejectedSource;
    const descriptor=JSON.stringify(normalizedDocxDescriptor(currentDocxDescriptor(saved?.work)));
    evidence=confirmSourceRejection(previous,error,{descriptor,parserVersion:AMENDMENT_EXTRACTION_VERSION,now:worker.clock()});
    task.body={...task.body,amendmentRejectedSource:evidence.rejection};
    worker.store.db.prepare('UPDATE amendment_jobs SET body=? WHERE generation=? AND key=?').run(JSON.stringify(task.body),task.generation,task.key);
  }
  if(task.attempts<2)return false;
  const at=new Date(worker.clock()).toISOString();
  let confirmed=false;
  let failedList=null;
  if(task.kind==='amendment-extract') {
    const saved=worker.store.source(task.generation,sourceKey(task.body.listId));
    if(saved) {
      const file=currentDocxDescriptor(saved.work);
      confirmed=evidence.confirmed;
      const wordingRefreshFailure={rejectedSource:evidence.rejection,descriptor:normalizedDocxDescriptor(file),failedAt:at,retryAfter:new Date(worker.clock()+Math.max(confirmed?SOURCE_RECHECK_MS:DAY,Number(error.retryAfter||0)*1000)).toISOString(),state:confirmed?'permanent-source-issue':'transient',parserVersion:AMENDMENT_EXTRACTION_VERSION,contentHash:error.sourceHash??null,error:String(error.message).slice(0,350)};
      worker.store.putSource(task.generation,sourceKey(task.body.listId),'amendment-list',{...saved.work,wordingRefreshFailure},saved.fetchedAt);
      failedList=task.body.targetDocumentId;
    }
  }
  worker.store.putSource(task.generation,'amendment:gap:'+task.key,'amendment-gap',{taskKey:task.key,taskKind:task.kind,taskBody:task.body,priority:task.priority,state:confirmed?'permanent-source-issue':'transient',parserVersion:AMENDMENT_EXTRACTION_VERSION,contentHash:error.sourceHash??null,error:String(error.message).slice(0,350),failedAt:at},at);
  worker.store.finishTask(task);
  if(failedList) {
    const list=worker.store.source(task.generation,sourceKey(task.body.listId))?.work;
    const parserUpgrade=Boolean(task.body.parserUpgrade||list?.extraction&&list.extraction.parserVersion!==AMENDMENT_EXTRACTION_VERSION);
    rebuildAmendmentTarget(worker,task.generation,failedList,{discover:!parserUpgrade});
  }
  return true;
}
export const amendmentDownloads={downloadDocxBuffer,downloadVotingXml,extractAmendmentList:extractAmendmentsOffThread};

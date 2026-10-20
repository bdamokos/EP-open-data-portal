import {sittingConfirmationDay,sittingOutcomesComplete,sittingSnapshotConfirmed} from './refresh-policy.mjs';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { array, tail, documentFiles, projectDocument, AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { downloadDocxBuffer } from './document-text.mjs';
import { extractAmendments, AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { createAmendmentAuthorResolver, votingAliases } from './amendment-authors.mjs';
import { parseSplitRequest, SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_OUTCOME_PROOF_VERSION, AMENDMENT_DISTRIBUTION_PROOF_VERSION, AMENDMENT_EMPTY_OBSERVATION_VERSION, AMENDMENT_LIMITS, canonicalEPReference, amendmentTarget, amendmentReference, amendmentSittings, amendmentDecision, amendmentTextLosses, amendmentProposerDate, validAmendmentDate, hasDecisionReferenceSet, targetMetadata, normalizedDocxDescriptor, sameDocxDescriptor, distributionEvidenceFor, currentDocxDescriptor, listWordingFreshness, checkedAggregateAttribution } from './amendments.mjs';
import { recordSplitResults, saveAmendmentRows, enqueueAmendment } from './amendments-store.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';
import { runAmendmentWorkSlice } from './amendment-work-slices.mjs';
import { userAgent } from './user-agent.mjs';
import {upstreamResponseError} from './odp.mjs';
const DAY=86400000;
const sourceKey=id=>'amendment:list:'+id;
const rosterKey=date=>'amendment:roster:'+date;
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
const extractionSource=extraction=>extraction?.sourceUrl?{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language}:null;
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
      candidate.observations.push({id:reference,identifier:expanded.identifier ?? null,type:expanded.work_type ?? null,documentDate:expanded.document_date ?? null,
        distributionState:distributionEvidenceFor(expanded,null).state,files:documentFiles(expanded).filter(file=>file.format==='DOCX').map(({url,language,byteSize})=>({url,language,byteSize})),
        targets:Object.hasOwn(expanded,'foresees_change_of')?array(expanded.foresees_change_of).map(ref=>canonicalEPReference(ref) || ref):null});
      if(verifiedList(expanded,target,id))candidate.expanded=expanded;else candidate.unverifiedExpanded=true;
    }
  }
  for(const candidate of candidates.values())candidate.fingerprint=createHash('sha256').update(JSON.stringify({target,reference:candidate.reference,observations:candidate.observations})).digest('hex');
  return {candidates:[...candidates.values()],unavailable};
}
function saveVerifiedList(worker,generation,target,candidate,list,evidence) {
  const prior=worker.store.source(generation,sourceKey(candidate.id)),files=documentFiles(list);
  const distributionEvidence=distributionEvidenceFor(list,{url:evidence.url,fetchedAt:evidence.fetchedAt,language:null});
  worker.store.putSource(generation,sourceKey(candidate.id),'amendment-list',{...projectDocument(list),targetDocumentId:target,files,distributionEvidence,relationshipEvidence:{...evidence,targetReference:'eli/dl/doc/'+target,listReference:candidate.reference,fingerprint:candidate.fingerprint},...(prior?.work.extraction?{extraction:proposerDatedExtraction(worker.store,generation,prior.work)}:{}),...(prior?.work.wordingRefreshFailure?{wordingRefreshFailure:prior.work.wordingRefreshFailure}:{})},prior?.fetchedAt || evidence.fetchedAt);
}
function prepareLinkedLists(worker,generation,work,fetchedAt) {
  const id=idOf(work),linked=linkedListCandidates(work),verified=new Set(),unresolved=[];
  for(const candidate of linked.candidates.slice(0,AMENDMENT_LIMITS.listsPerTarget)) {
    let prior=worker.store.source(generation,sourceKey(candidate.id));
    const expandedVerified=candidate.expanded&&!candidate.unverifiedExpanded&&typeof candidate.expanded.amendmentDistributionDeclared==='boolean';
    if(expandedVerified&&(prior?.work.targetDocumentId!==id || !prior?.work.relationshipEvidence || Date.parse(prior.work.relationshipEvidence.fetchedAt)<=Date.parse(fetchedAt))) {
      saveVerifiedList(worker,generation,id,candidate,candidate.expanded,{basis:'expanded-target',url:'https://data.europarl.europa.eu/api/v2'+targetKey(id)+'?format=application%2Fld%2Bjson',fetchedAt});
      prior=worker.store.source(generation,sourceKey(candidate.id));
    }
    const proof=prior?.work.relationshipEvidence;
    const detailVerified=proof?.basis==='list-detail'&&proof.targetReference==='eli/dl/doc/'+id&&proof.fingerprint===candidate.fingerprint&&worker.clock()-Date.parse(proof.fetchedAt)<7*DAY&&verifiedList(prior.work,id,candidate.id)&&prior.work.distributionEvidence?.version===AMENDMENT_DISTRIBUTION_PROOF_VERSION;
    if(!expandedVerified&&!detailVerified) {
      unresolved.push(candidate.id);
      enqueueAmendment(worker.store,generation,linkedListKey(id,candidate.id),'amendment-list-detail',{listId:candidate.id,targetDocumentId:id},115,true);
      continue;
    }
    verified.add(candidate.id);
    const freshness=listWordingFreshness(prior?.work,{parserVersion:AMENDMENT_EXTRACTION_VERSION,now:worker.clock()});
    const failure=prior?.work.wordingRefreshFailure;
    const failedDescriptorMatches=failure&&(failure.descriptor==null&&freshness.descriptor==null||sameDocxDescriptor(failure.descriptor,freshness.descriptor));
    const retryDeferred=failedDescriptorMatches&&Date.parse(failure.retryAfter)>worker.clock();
    const unchanged=freshness.status==='fresh'&&worker.clock()-Date.parse(prior?.work.extraction?.fetchedAt || prior?.fetchedAt)<7*DAY;
    if(currentDocxDescriptor(prior?.work)&&!unchanged&&!retryDeferred)enqueueAmendment(worker.store,generation,'amendment:extract:'+candidate.id,'amendment-extract',{listId:candidate.id,targetDocumentId:id},112,true);
    const date=prior?.work.document_date;
    if(validAmendmentDate(date)&&!worker.store.source(generation,rosterKey(date)))enqueueAmendment(worker.store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114);
  }
  return {...linked,verified,unresolved};
}
function proposerDatedExtraction(store,generation,list) {
  const extraction=list?.extraction;if(!extraction)return extraction;
  return {...extraction,amendments:(extraction.amendments || []).map(amendment=>{
    const documentary=amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:null});
    const record=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,list.targetDocumentId+'-AM-'+amendment.number);
    const row=record?JSON.parse(record.body):null;
    const accepted=row?.listId===idOf(list)?row:row?.variants?.find(variant=>variant.listId===idOf(list));
    const proposerSource=amendment.proposerSource || amendment.metadataSource || extractionSource(extraction),acceptedSource=accepted?.proposerSource || accepted?.metadataSource;
    const sameSource=proposerSource?.url&&acceptedSource?.url===proposerSource.url&&acceptedSource.fetchedAt===proposerSource.fetchedAt;
    const evidence=documentary || (sameSource?amendmentProposerDate(accepted):null) || amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:list.document_date});
    return {...amendment,proposerDate:evidence?.date || null,proposerDateBasis:evidence?.basis || null};
  })};
}
function verifiedWording(extraction,amendment) {
  return Boolean(extraction?.parserVersion===AMENDMENT_EXTRACTION_VERSION&&(amendment?.wordingParserVersion==null||amendment.wordingParserVersion===AMENDMENT_EXTRACTION_VERSION)&&typeof amendment?.originalText==='string'&&typeof amendment.proposedText==='string'&&amendment.originalText.length<=AMENDMENT_LIMITS.text&&amendment.proposedText.length<=AMENDMENT_LIMITS.text&&(amendment.wordingSource?.url || extraction.sourceUrl)&&(
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
      row.wordingSource=accepted.wordingSource || oldSource;row.wordingRetained=true;
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
    amendments.push({...accepted,originalText:complete?accepted.originalText:null,proposedText:complete?accepted.proposedText:null,wordingSource:accepted.wordingSource || oldSource,metadataSource:accepted.metadataSource || oldSource,proposerSource:accepted.proposerSource || accepted.metadataSource || oldSource,wordingRetained:complete,proposerRetained:true,recordRetained:true,wordingParserVersion:AMENDMENT_EXTRACTION_VERSION,latestRefreshSource:source,sources:[...(accepted.sources || []),source],gaps:[...(accepted.gaps || []),{code:'amendment-retained',number:accepted.number,message:'This amendment was absent from the latest extraction; previously indexed evidence is retained.'}]});
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
  const taskKey=key+':'+today+(upgrade?':amendments-v'+AMENDMENT_SITTING_PROJECTION_VERSION:complete&&today<confirmationDay?':refresh:'+Math.floor(worker.clock()/(6*60*60_000)):'');
  const exactAttempt=upgrade||complete?1:0;
  if(worker.store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done=1 AND (key=? OR (?=0 AND key LIKE ?)) UNION ALL SELECT 1 FROM amendment_jobs WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done=1 AND (key=? OR (?=0 AND key LIKE ?)) LIMIT 1").get(generation,sittingId,taskKey,exactAttempt,'%:'+today+'%',generation,sittingId,taskKey,exactAttempt,'%:'+today+'%'))return false;
  if(worker.store.db.prepare("SELECT 1 FROM continuation_sittings WHERE generation=? AND sitting_id=? AND bucket='completed' AND (key=? OR (?=0 AND key LIKE ?)) LIMIT 1").get(generation,sittingId,taskKey,exactAttempt,'%:'+today+'%'))return false;
  worker.store.enqueue(generation,taskKey,'motion-outcomes',{sittingId,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},priority);
  return true;
}

export function scheduleAmendments(worker,generation,work,fetchedAt,endpoint) {
  const id=idOf(work);if(!amendmentTarget(id))return;
  rebuildAmendmentTarget(worker,generation,id);
  const priorTarget=worker.store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const discovered=priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[];
  for(const sittingId of new Set([...amendmentSittings(work),...discovered])) {
    scheduleSittingOutcomes(worker,generation,sittingId);
    const aliasKey='amendment:aliases:'+sittingId;
    if(!worker.store.source(generation,aliasKey))enqueueAmendment(worker.store,generation,aliasKey,'amendment-aliases',{sittingId},108);
  }
}
const preparationMarkers=worker=>({amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:utcDay(worker),splitParserVersion:SPLIT_PARSER_VERSION,amendmentDocumentParserVersion:AMENDMENT_EXTRACTION_VERSION,amendmentDocumentLinksVersion:AMENDMENT_LINKS_VERSION,amendmentSittingProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,amendmentDistributionProofVersion:AMENDMENT_DISTRIBUTION_PROOF_VERSION});
const preparationKinds={documents:'document',gaps:'amendment-gap',splits:'motion-outcomes'};
const preparationDocumentFilter=" AND (json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT')";
function preparationThrough(store,generation,stage) {
  return store.db.prepare('SELECT MAX(key) AS key FROM sources WHERE generation=? AND kind=?'+(stage==='documents'?preparationDocumentFilter:'')).get(generation,preparationKinds[stage])?.key || '';
}
export async function prepareAmendments(worker,cycle) {
  const {generation}=cycle,store=worker.store,markers=preparationMarkers(worker);
  for(const pilot of ['A-10-2026-0254','B-10-2026-0424'])if(!store.source(generation,targetKey(pilot)))store.enqueue(generation,targetKey(pilot),'document',{endpoint:targetKey(pilot)},109);
  if(Object.entries(markers).every(([key,value])=>cycle[key]===value))return true;
  const signature=createHash('sha256').update(JSON.stringify(markers)).digest('hex').slice(0,16),key='amendment:prepare:'+markers.amendmentsPreparedDay+':'+signature;
  if(!enqueueAmendment(store,generation,key,'amendment-prepare',{markers,stage:'documents',afterKey:'',throughKey:preparationThrough(store,generation,'documents'),upgrades:0},113,true))return false;
  const row=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=? AND done=0').get(generation,key);
  // Admission may be deferred in the existing bounded continuation snapshot.
  return row?runPreparationSlice(worker,{...row,body:JSON.parse(row.body),amendmentJob:true}):false;
}
async function runPreparationSlice(worker,task) {
  const {generation}=task,store=worker.store;
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>{
      if(body.stage==='done')return null;
      const source=store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=? AND key>? AND key<=?'+(body.stage==='documents'?preparationDocumentFilter:'')+' ORDER BY key LIMIT 1').get(generation,preparationKinds[body.stage],body.afterKey,body.throughKey);
      return source?{source,stage:body.stage}:{end:body.stage};
    },
    action:(item,body)=>{
      if(item.end) {
        const stage=item.end==='documents'?'gaps':item.end==='gaps'?'splits':'done';
        store.taskProgress(task,{...body,stage,afterKey:'',throughKey:stage==='done'?'':preparationThrough(store,generation,stage)});return;
      }
      const {source,stage}=item,work=JSON.parse(source.body);
      if(stage==='documents') {
        if(!amendmentTarget(idOf(work)))return;
        if(work.amendmentLinksVersion!==AMENDMENT_LINKS_VERSION) {
          if(body.upgrades<AMENDMENT_LIMITS.upgradeTargets){store.enqueue(generation,source.key,'document',{endpoint:source.key},106,true);rebuildAmendmentTarget(worker,generation,idOf(work));}
        } else scheduleAmendments(worker,generation,work,source.fetched_at,source.key);
      } else if(stage==='gaps') {
        const list=work.taskKind==='amendment-extract'?store.source(generation,sourceKey(work.taskBody.listId))?.work:null;
        const freshness=list&&listWordingFreshness(list,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
        if(work.taskKind==='amendment-extract'&&(!currentDocxDescriptor(list)||freshness?.status==='failed'&&Date.parse(freshness.retryAfter)>worker.clock()))return;
        enqueueAmendment(store,generation,work.taskKey,work.taskKind,work.taskBody,work.priority || 105,true);
      } else {
        const evidence=amendmentSitting(work);
        if(evidence.splitParserVersion!==SPLIT_PARSER_VERSION&&evidence.splitRequests)enqueueAmendment(store,generation,'amendment:reparse:'+source.key,'amendment-reparse',{sourceKey:source.key},111,true);
      }
    },
    advance:(item,body)=>item.source?{afterKey:item.source.key,upgrades:body.upgrades+Number(item.stage==='documents'&&amendmentTarget(idOf(JSON.parse(item.source.body)))&&JSON.parse(item.source.body).amendmentLinksVersion!==AMENDMENT_LINKS_VERSION)}:{},
  });
  if(complete) {
    if(store.get('working')?.generation===generation)store.updateCycle(task.body.markers);
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
  if(scope.kind==='members')return {sql:'SELECT id FROM amendment_targets WHERE generation=?',args:[generation]};
  if(scope.kind==='roster')return {sql:"SELECT DISTINCT json_extract(source.body,'$.targetDocumentId') AS id FROM sources AS source WHERE generation=? AND kind='amendment-list' AND (json_extract(source.body,'$.document_date')=? OR EXISTS(SELECT 1 FROM json_each(source.body,'$.extraction.amendments') AS amendment WHERE json_extract(amendment.value,'$.date')=? OR json_extract(amendment.value,'$.proposerDate')=?))",args:[generation,scope.date,scope.date,scope.date]};
  return {sql:`SELECT value AS id FROM json_each(?) UNION SELECT id FROM amendment_targets AS target WHERE generation=? AND EXISTS(SELECT 1 FROM json_each(target.body,'$.sittingIds') AS sitting WHERE sitting.value=?)
    UNION SELECT DISTINCT amendment.target AS id FROM amendments AS amendment JOIN amendment_targets AS target ON target.generation=amendment.generation AND target.id=amendment.target WHERE amendment.generation=? AND json_type(target.body,'$.sittingIds') IS NULL AND EXISTS(SELECT 1 FROM json_each(amendment.body,'$.decisions') AS decision WHERE json_extract(decision.value,'$.sittingId')=?)`,args:[JSON.stringify([...context.directTargets]),generation,scope.sittingId,generation,scope.sittingId]};
}
function newRebuildScope(worker,generation,scope) {
  if(scope.kind==='profile')return {...scope,offset:0};
  const context=scope.kind==='sitting'?sittingRebuildContext(worker,generation,scope.sittingId):null,query=rebuildQuery(generation,scope,context);
  const throughTarget=worker.store.db.prepare('SELECT MAX(id) AS id FROM ('+query.sql+')').get(...query.args)?.id || '';
  return {...scope,afterTarget:'',throughTarget};
}
async function runRebuildSlice(worker,task) {
  const {generation}=task,store=worker.store,scope=task.body.rebuild;
  const context=scope.kind==='sitting'?sittingRebuildContext(worker,generation,scope.sittingId):null;
  const query=scope.kind==='profile'?null:rebuildQuery(generation,scope,context);
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>body.rebuild.kind==='profile'?(body.targets?.[body.rebuild.offset]!=null?{id:body.targets[body.rebuild.offset]}:null):store.db.prepare('SELECT id FROM ('+query.sql+') WHERE id>? AND id<=? ORDER BY id LIMIT 1').get(...query.args,body.rebuild.afterTarget,body.rebuild.throughTarget),
    action:({id})=>{
      if(amendmentTarget(id)&&store.source(generation,targetKey(id)))rebuildAmendmentTarget(worker,generation,id,context?{observedDecisionIds:context.observedDecisionIds,discoveredSittingIds:context.directTargets.has(id)?[scope.sittingId]:[]}:{});
    },
    advance:({id},body)=>({rebuild:{...body.rebuild,...(body.rebuild.kind==='profile'?{offset:body.rebuild.offset+1}:{afterTarget:id})}}),
  });
  if(complete&&task.body.rebuild.requestedRevision!==task.body.rebuild.revision) {
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
function scheduleProfileDependency(worker,generation,id,targetId) {
  const store=worker.store,key='amendment:member:'+id,checkpointKey='amendment:continuations';
  const merge=()=>{
    store.assertWriter();
    const existing=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
    const saved=store.source(generation,checkpointKey)?.work || {},deferred=(saved.tasks || []).filter(task=>task.key===key&&task.done!==1);
    const pending=existing?[existing,...deferred]:deferred;
    const dependencies=[...new Set([...pending.flatMap(task=>array(JSON.parse(task.body).targets)),targetId])],overflow=new Set();
    const extend=body=>{
      const targets=[...array(body.targets)];
      for(const target of dependencies)if(!targets.includes(target)) {
        if(targets.length<100)targets.push(target);else overflow.add(target);
      }
      return {...body,targets};
    };
    let next=saved;
    if(deferred.length)next={...next,tasks:(saved.tasks || []).map(task=>task.key===key&&task.done!==1?{...task,body:JSON.stringify(extend(JSON.parse(task.body)))}:task)};
    if(existing?.done===0) {
      store.db.prepare('UPDATE amendment_jobs SET body=? WHERE generation=? AND key=?').run(JSON.stringify(extend(JSON.parse(existing.body))),generation,key);
    } else if(!deferred.length) {
      const body=extend(existing?JSON.parse(existing.body):{id,targets:[]});
      if(existing?.done===1)delete body.rebuild;
      enqueueAmendment(store,generation,key,'amendment-member',body,107,existing?.done===1);
    }
    if(overflow.size) {
      const message='Some amendment author-profile dependencies exceed the 100-target processing limit; author coverage remains incomplete.';
      const prior=next.capacityGap || {};
      next={...next,capacityGap:{...prior,count:Math.max(1,prior.count || 0),message:prior.message?prior.message.includes(message)?prior.message:prior.message+' '+message:message}};
      for(const target of overflow)if(amendmentTarget(target))store.db.prepare("UPDATE sources SET body=json_remove(body,'$.amendmentLinksVersion') WHERE generation=? AND key=? AND kind='document'").run(generation,targetKey(target));
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
function scheduleMandateProfiles(worker,generation,targetId,lists,aliases) {
  const store=worker.store;if(!store.get('amendmentMandateFallback'))return;
  const directory=store.source(generation,'amendment:members:10');
  if(!directory){enqueueAmendment(store,generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108);return;}
  const members=directory.work.members || [],names=new Set(lists.flatMap(({work})=>(work.extraction?.amendments || []).flatMap(amendment=>amendment.authors || [])).map(normalizedName));
  const ids=new Set(members.filter(member=>names.has(normalizedName(member.givenName+' '+member.familyName))||names.has(normalizedName(member.familyName+' '+member.givenName))).map(member=>member.id));
  for(const alias of aliases)if(names.has(normalizedName(alias.alias)))ids.add(String(alias.personId));
  const latestDate=lists.flatMap(({work})=>(work.extraction?.amendments || []).map(amendment=>amendmentProposerDate(amendment,{documentDate:amendment.documentDate || amendment.date,listDate:work.document_date})?.date)).filter(Boolean).sort().at(-1);
  for(const id of ids) {
    const profile=store.source(generation,'amendment:member:'+id);
    if(profile && (!latestDate || profile.fetchedAt.slice(0,10)>=latestDate))continue;
    scheduleProfileDependency(worker,generation,id,targetId);
  }
}
function rosterMembers(worker,generation,date,profiles) {
  if(!validAmendmentDate(date))return {members:[],source:[]};
  const saved=worker.store.source(generation,rosterKey(date));
  // These intervals describe one observed mandate day, not a whole mandate.
  return {members:[...(saved?.work.members || []).map(member=>({...member,mandates:[{start:date,end:date}]})),...(profiles || worker.store.sources(generation,'amendment-member')).filter(source=>source.fetchedAt.slice(0,10)>=date).map(source=>source.work)],source:saved?.work.sources || []};
}
function cachedDirectSittings(store,generation,targetId) {
  const reference='eli/dl/doc/'+targetId+'-AM-%';
  const candidates=store.db.prepare(`SELECT source.key,source.body FROM (
    SELECT DISTINCT source_key FROM amendment_sitting_references WHERE generation=? AND version=? AND reference LIKE ?
    ORDER BY source_key DESC LIMIT ?) matched CROSS JOIN sources source ON source.generation=? AND source.key=matched.source_key
    ORDER BY source.key DESC`).all(generation,AMENDMENTS_VERSION,reference,AMENDMENT_LIMITS.sittingsPerTarget+1,generation);
  return {limited:candidates.length>AMENDMENT_LIMITS.sittingsPerTarget,sittingIds:candidates.slice(0,AMENDMENT_LIMITS.sittingsPerTarget).filter(source=>array(amendmentSitting(JSON.parse(source.body)).decisions).some(decision=>array(decision.decided_on_a_realization_of).some(value=>amendmentReference(value)?.targetDocumentId===targetId))).map(source=>source.key.replace(/^motion-outcomes:/,'')).filter(id=>/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(id))};
}
export function rebuildAmendmentTarget(worker,generation,id,{listLimit=false,observedDecisionIds=[],discoveredSittingIds=[]}={}) {
  const store=worker.store,saved=store.source(generation,targetKey(id));if(!saved)return;
  const priorTarget=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const cachedDirect=cachedDirectSittings(store,generation,id);
  const discovered=[...new Set([...(priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[]),...cachedDirect.sittingIds,...discoveredSittingIds])];
  const target=targetMetadata(saved.work,saved.fetchedAt,targetKey(id)),rows=new Map(),gaps=[],observed=new Set(observedDecisionIds);
  target.listProjectionVersion=saved.work.amendmentLinksVersion ?? null;
  target.discoveredSittingIds=discovered;
  const relationshipsKnown=Object.hasOwn(saved.work,'inverse_foresees_change_of')&&saved.work.inverse_foresees_change_of!=null&&saved.work.amendmentLinksVersion===AMENDMENT_LINKS_VERSION;
  const linked=prepareLinkedLists(worker,generation,saved.work,saved.fetchedAt);
  const currentListIds=linked.candidates.map(candidate=>candidate.id);
  const currentLists=new Set(currentListIds);
  target.linkedListCount=currentListIds.length;target.linkedListObservationCount=currentListIds.length+linked.unavailable;target.unresolvedListObservationCount=linked.unavailable;target.unresolvedListIds=linked.unresolved;
  // Persist this narrow source observation separately from legacy completeness,
  // which also requires amendment wording/decisions and at least one row.
  target.emptyObservation=relationshipsKnown&&Array.isArray(saved.work.inverse_foresees_change_of)&&saved.work.inverse_foresees_change_of.length===0?
    {version:AMENDMENT_EMPTY_OBSERVATION_VERSION,documentId:id,relationship:'inverse_foresees_change_of',scope:'published-amendment-list-relationships',listCount:0,source:target.sources[0]}:null;
  const lists=store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=?").all(generation,id).map(row=>{const work=JSON.parse(row.body);return {work,fetchedAt:row.fetched_at,current:currentLists.has(idOf(work))};}).sort((a,b)=>Number(b.current)-Number(a.current));
  const sittingSources=[...new Set([...amendmentSittings(saved.work),...discovered])].map(sittingId=>{const record=store.source(generation,motionSourceKey(sittingId));return {sittingId,record:record?{...record,work:amendmentSitting(record.work)}:null};});
  target.sittingIds=sittingSources.map(source=>source.sittingId);
  const aliases=sittingSources.flatMap(({sittingId})=>store.source(generation,'amendment:aliases:'+sittingId)?.work.aliases || []);
  // Reuse only this rebuild's immutable source context; never cache identities
  // across a roster, alias or profile refresh.
  const profiles=store.sources(generation,'amendment-member'),authorContexts=new Map();
  const authorContext=date=>{
    if(!authorContexts.has(date)) {
      const roster=rosterMembers(worker,generation,date,profiles),activeIds=new Set(roster.members.map(member=>String(member.id)));
      const datedAliases=aliases.filter(alias=>activeIds.has(String(alias.personId).replace(/^person\//,'')));
      authorContexts.set(date,{roster,resolve:createAmendmentAuthorResolver({members:roster.members,aliases:datedAliases,date,relatedSittingDates:sittingSources.map(({sittingId})=>sittingId.slice(7))})});
    }
    return authorContexts.get(date);
  };
  scheduleMandateProfiles(worker,generation,id,lists,aliases);
  const base=(amendmentId,number)=>({id:amendmentId,number,listId:null,targetDocumentId:id,title:target.titles.en || id,titles:target.titles,date:null,documentDate:null,listDocumentDate:null,dateBasis:null,proposerDate:null,proposerDateBasis:null,targetDocumentDate:target.date,procedureIds:target.procedureIds,targetLabel:null,targetLabelLanguage:null,targetLabelSource:null,originalText:null,proposedText:null,language:null,authors:[],decisions:[],splitParts:[],topics:target.topics,sources:[...target.sources],gaps:[],identifierBasis:'derived-from-exact-target-and-number',officialIds:[]});
  if(cachedDirect.limited)gaps.push('This target exceeds the cached direct-decision sitting discovery limit.');
  if(!relationshipsKnown)gaps.push('Current amendment-list relationships are unavailable; previously indexed list evidence is unverified and retained.');
  if(listLimit || target.linkedListObservationCount>AMENDMENT_LIMITS.listsPerTarget)gaps.push('This target exceeds the amendment-list processing limit.');
  if(linked.unavailable)gaps.push('Some linked amendment-list records have no usable exact EP document reference.');
  for(const listId of linked.unresolved)gaps.push('Linked amendment list '+listId+' is awaiting exact document-detail verification.');
  if(!lists.length)gaps.push('No published amendment list is indexed for this target.');
  const invalidatedTextListIds=lists.filter(({work:list})=>list.extraction?.previousParserVersion&&list.extraction.previousParserVersion!==AMENDMENT_EXTRACTION_VERSION).map(({work})=>idOf(work));
  for(const {work:list,current} of lists) {
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
      Object.assign(row,{listId:idOf(list),listRelationship:current?linked.verified.has(idOf(list))?'current':'unverified':relationshipsKnown?'absent-current-relationship':'unverified',date:amendment.date || date,targetLabel:text(amendment.targetLabel),originalText:withhold?null:typeof amendment.originalText==='string'?amendment.originalText:null,proposedText:withhold?null:typeof amendment.proposedText==='string'?amendment.proposedText:null,textIntegrity:acceptedWording?'complete':withhold?'incomplete':'unavailable',textParserVersion:amendment.wordingParserVersion || extraction.parserVersion,wordingSource:Object.hasOwn(amendment,'wordingSource')?amendment.wordingSource:extractionSource(extraction),metadataSource:Object.hasOwn(amendment,'metadataSource')?amendment.metadataSource:extractionSource(extraction),proposerSource:Object.hasOwn(amendment,'proposerSource')?amendment.proposerSource:extractionSource(extraction),wordingRetained:Boolean(amendment.wordingRetained),proposerRetained:Boolean(amendment.proposerRetained),proposerDate:authorDate,proposerDateBasis:proposerDate?.basis || null,recordRetained:Boolean(amendment.recordRetained),language:amendment.language || extraction.language,onBehalfOf:amendment.onBehalfOf || null,committeeProposer:amendment.committeeProposer || null,documentDate:amendment.documentDate || amendment.date || null,listDocumentDate:list.document_date || null,dateBasis:amendment.dateBasis || (amendment.date?'individual-amendment-document':null),justification:text(amendment.justification)});
      row.sourceFreshness=sourceFreshness;
      row.targetLabelLanguage=row.targetLabel?(Object.hasOwn(amendment,'targetLabelLanguage')?amendment.targetLabelLanguage:extraction.parserVersion===AMENDMENT_EXTRACTION_VERSION?amendment.metadataSource?.language ?? extraction.language ?? null:null):null;
      row.targetLabelSource=row.targetLabel?(Object.hasOwn(amendment,'targetLabelSource')?amendment.targetLabelSource:extraction.parserVersion===AMENDMENT_EXTRACTION_VERSION?amendment.metadataSource || extractionSource(extraction):null):null;
      if(sourceFreshness.status!=='fresh') {
        row.wordingRetained=Boolean(acceptedWording&&!withhold);
        row.gaps.push('Amendment wording source distribution is '+sourceFreshness.status+'; current retrieval has not been verified.');
        gaps.push('Some amendment wording source distributions are pending, unverified or failed; retained wording is labelled.');
      }
      row.authors=resolve(amendment.authors || []).map(author=>({...author,...(!authorDate?{personId:null,status:'missing_proposer_date',method:null}:{}),personId:authorDate&&author.personId!=null?String(author.personId).replace(/^person\//,''):null,evidence:[...(author.evidence || []),...(roster.source.length?[{type:'dated_roster',sources:roster.source,mandateObservedOn:authorDate}]:[])]}));
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
        const variant=value=>({listId:value.listId,listRelationship:value.listRelationship,date:value.date,language:value.language,targetLabel:value.targetLabel,targetLabelLanguage:value.targetLabelLanguage,targetLabelSource:value.targetLabelSource,originalText:value.originalText,proposedText:value.proposedText,textIntegrity:value.textIntegrity,textParserVersion:value.textParserVersion,sourceFreshness:value.sourceFreshness,wordingSource:value.wordingSource,metadataSource:value.metadataSource,proposerSource:value.proposerSource,wordingRetained:value.wordingRetained,proposerRetained:value.proposerRetained,proposerDate:value.proposerDate,proposerDateBasis:value.proposerDateBasis,authors:value.authors,onBehalfOf:value.onBehalfOf,committeeProposer:value.committeeProposer,documentDate:value.documentDate,listDocumentDate:value.listDocumentDate,dateBasis:value.dateBasis,justification:value.justification,sources:[...value.sources],gaps:[...value.gaps]});
        row.variants=[...(previous.variants || [variant(previous)]),variant(row)];
        row.conflicted=true;row.listRelationship='conflicting-variants';row.listId=null;row.originalText=null;row.proposedText=null;row.authors=[];row.language=null;row.targetLabel=null;row.targetLabelLanguage=null;row.targetLabelSource=null;row.onBehalfOf=null;row.justification=null;
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
  if(task.kind==='amendment-prepare'){await runPreparationSlice(worker,task);return;}
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
    const candidate=target&&linkedListCandidates(target.work).candidates.slice(0,AMENDMENT_LIMITS.listsPerTarget).find(candidate=>candidate.id===body.listId);
    if(candidate) {
      const record=await worker.request('/documents/'+candidate.id);signal.throwIfAborted();
      const list=record.payload.data.find(work=>canonicalEPReference(work.id)===candidate.reference);
      if(!verifiedList(list,body.targetDocumentId,candidate.id))throw new Error('Linked amendment-list detail does not verify its exact document identity, type and forward target.');
      saveVerifiedList(worker,generation,body.targetDocumentId,candidate,list,{basis:'list-detail',url:record.url,fetchedAt:record.fetchedAt});
      rebuildAmendmentTarget(worker,generation,body.targetDocumentId);
    }
  } else if(task.kind==='amendment-extract') {
    const saved=store.source(generation,sourceKey(body.listId));if(!saved)throw new Error('Amendment-list metadata is unavailable.');
    const file=currentDocxDescriptor(saved.work);
    if(!file) {
      // A queued job can outlive the metadata that admitted it. Absence is an
      // observation to expose, not permission to download a historical URL.
      store.finishTask(task);
      rebuildAmendmentTarget(worker,generation,body.targetDocumentId);
      return;
    }
    worker.requests++;const cycle=store.get('working');if(cycle)store.updateCycle({requests:(cycle.requests || 0)+1});
    let downloaded;
    try {downloaded=await worker.runUpstream(admittedSignal=>worker.downloadAmendmentDocx(file.url,{signal:admittedSignal}),{source:'documents',priority:'background',signal});}
    catch(error){signal.throwIfAborted();throw error;}
    signal.throwIfAborted();
    const fetchedAt=new Date(worker.clock()).toISOString(),extraction=extractAmendments(downloaded.buffer,{listId:body.listId,targetDocumentId:body.targetDocumentId,language:file.language,sourceUrl:file.url,fetchedAt});
    if(!Array.isArray(extraction.amendments)||extraction.amendments.length>AMENDMENT_LIMITS.amendmentsPerList)throw new Error('Amendment extraction exceeded its record budget.');
    for(const date of [...new Set(extraction.amendments.map(amendment=>amendment.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date || '')))].slice(0,20))if(!store.source(generation,rosterKey(date)))enqueueAmendment(store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114);
    signal.throwIfAborted();
    const next={...saved.work,extraction:{...mergeExtractionRefresh(proposerDatedExtraction(store,generation,saved.work),extraction,{url:file.url,fetchedAt,language:file.language},saved.work.document_date),sourceDescriptor:normalizedDocxDescriptor(file)}};
    delete next.wordingRefreshFailure;
    store.putSource(generation,sourceKey(body.listId),'amendment-list',next,next.extraction.fetchedAt);
    rebuildAmendmentTarget(worker,generation,body.targetDocumentId);
  } else if(task.kind==='amendment-roster') {
    const params={'mandate-date':body.date,limit:1000,offset:body.offset};
    const record=await worker.request('/meps/show-current',params);
    const members=record.payload.data.map(person=>({id:String(person.identifier || tail(person.id)),givenName:person.givenName || '',familyName:person.familyName || '',name:person.label || ''}));
    const identities=new Set(body.members.map(member=>member.id));
    for(const member of members){if(!/^[1-9]\d*$/.test(member.id)||!Number.isSafeInteger(Number(member.id))||identities.has(member.id))throw new Error('Dated amendment roster contains invalid or repeated identities.');identities.add(member.id);}
    const sources=[...body.sources,{url:record.url,fetchedAt:record.fetchedAt}];
    if(members.length){store.taskProgress(task,{...body,members:[...body.members,...members],offset:body.offset+members.length,sources});return;}
    if(!body.members.length)throw new Error('Dated amendment roster is unavailable.');
    store.putSource(generation,rosterKey(body.date),'amendment-roster',{date:body.date,members:body.members,sources},record.fetchedAt);
    if(!await beginRebuild(worker,task,{kind:'roster',date:body.date}))return;
  } else if(task.kind==='amendment-members') {
    const record=await worker.request('/meps',{'parliamentary-term':10,limit:1000,offset:body.offset});
    const members=record.payload.data.map(person=>({id:String(person.identifier || tail(person.id)),givenName:person.givenName || '',familyName:person.familyName || ''}));
    const identities=new Set(body.members.map(member=>member.id));
    for(const member of members){if(!/^[1-9]\d*$/.test(member.id)||!Number.isSafeInteger(Number(member.id))||identities.has(member.id))throw new Error('Term MEP roster contains invalid or repeated identities.');identities.add(member.id);}
    if(members.length){store.taskProgress(task,{...body,members:[...body.members,...members],offset:body.offset+members.length});return;}
    if(!body.members.length)throw new Error('Term MEP roster is unavailable.');
    store.putSource(generation,'amendment:members:10','amendment-members',{members:body.members,source:{url:record.url,fetchedAt:record.fetchedAt}},record.fetchedAt);
    if(!await beginRebuild(worker,task,{kind:'members'}))return;
  } else if(task.kind==='amendment-member') {
    if(!/^[1-9]\d*$/.test(body.id))throw new Error('Invalid amendment author person ID.');
    const record=await worker.request('/meps/'+body.id),person=record.payload.data.find(person=>String(person.identifier || tail(person.id))===body.id);
    if(!person)throw new Error('Amendment author profile is unavailable.');
    const member={id:body.id,givenName:person.givenName || '',familyName:person.familyName || '',hasMembership:array(person.hasMembership).filter(membership=>tail(membership.role)==='MEMBER_PARLIAMENT'),sourceUrl:record.url,fetchedAt:record.fetchedAt};
    store.putSource(generation,'amendment:member:'+body.id,'amendment-member',member,record.fetchedAt);
    if(!await beginRebuild(worker,task,{kind:'profile'}))return;
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
  store.finishTask(task);
  store.db.prepare("DELETE FROM sources WHERE generation=? AND key=? AND kind='amendment-gap'").run(generation,'amendment:gap:'+task.key);
}
export function failAmendmentTask(worker,task,error) {
  if(!task.kind.startsWith('amendment-')||task.kind==='amendment-prepare'||task.kind==='amendment-rebuild'||task.body.rebuild)return false;
  if(worker.stopped || worker.controller?.signal.aborted)return false;
  if(task.kind==='amendment-roster'){worker.store.set('amendmentMandateFallback',true);enqueueAmendment(worker.store,task.generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108);}
  if(task.attempts<2)return false;
  const at=new Date(worker.clock()).toISOString();
  let failedList=null;
  if(task.kind==='amendment-extract') {
    const saved=worker.store.source(task.generation,sourceKey(task.body.listId));
    if(saved) {
      const file=currentDocxDescriptor(saved.work);
      const wordingRefreshFailure={descriptor:normalizedDocxDescriptor(file),failedAt:at,retryAfter:new Date(worker.clock()+DAY).toISOString(),error:String(error.message).slice(0,350)};
      worker.store.putSource(task.generation,sourceKey(task.body.listId),'amendment-list',{...saved.work,wordingRefreshFailure},saved.fetchedAt);
      failedList=task.body.targetDocumentId;
    }
  }
  worker.store.putSource(task.generation,'amendment:gap:'+task.key,'amendment-gap',{taskKey:task.key,taskKind:task.kind,taskBody:task.body,priority:task.priority,error:String(error.message).slice(0,350),failedAt:at},at);
  worker.store.finishTask(task);
  if(failedList)rebuildAmendmentTarget(worker,task.generation,failedList);
  return true;
}
export const amendmentDownloads={downloadDocxBuffer,downloadVotingXml};

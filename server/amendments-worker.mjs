import https from 'node:https';
import { array, tail, documentFiles, projectDocument, AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { boundedUpstream } from './odp.mjs';
import { downloadDocxBuffer } from './document-text.mjs';
import { extractAmendments, AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { resolveAmendmentAuthors, votingAliases } from './amendment-authors.mjs';
import { parseSplitRequest, SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_LIMITS, canonicalEPReference, amendmentTarget, amendmentLists, amendmentReference, amendmentSittings, amendmentDecision, amendmentTextLosses, hasDecisionReferenceSet, targetMetadata } from './amendments.mjs';
import { recordSplitResults, saveAmendmentRows, enqueueAmendment } from './amendments-store.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';
const DAY=86400000;
const sourceKey=id=>'amendment:list:'+id;
const rosterKey=date=>'amendment:roster:'+date;
const targetKey=id=>'/plenary-documents/'+id;
const idOf=work=>work.identifier || tail(work.id);
const utcDay=worker=>new Date(worker.clock()).toISOString().slice(0,10);
const text=value=>typeof value==='string'?value.slice(0,AMENDMENT_LIMITS.text):null;
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const sourceEvidence=(node,sources,collection)=>{
  const candidates=(sources || []).filter(source=>source.url?.includes('/'+collection+'?'));
  const source=node.source?.url?node.source:candidates.length===1?candidates[0]:null;
  return {source,sourceUrl:source?.url ?? null,fetchedAt:source?.fetchedAt ?? null,sourceCandidates:source?[]:candidates,provenance:node.source?.url?'exact':source?'single-page':'unavailable'};
};
const extractionSource=extraction=>extraction?.sourceUrl?{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language}:null;
function verifiedWording(extraction,amendment) {
  return Boolean(extraction?.parserVersion===AMENDMENT_EXTRACTION_VERSION&&typeof amendment?.originalText==='string'&&typeof amendment.proposedText==='string'&&amendment.originalText.length<=AMENDMENT_LIMITS.text&&amendment.proposedText.length<=AMENDMENT_LIMITS.text&&(amendment.wordingSource?.url || extraction.sourceUrl)&&(
    amendment.wordingRetained&&amendment.wordingParserVersion===AMENDMENT_EXTRACTION_VERSION&&amendment.wordingSource?.url || !amendmentTextLosses(extraction,amendment).length));
}
function mergeExtractionRefresh(old,extraction,source) {
  const compatible=old?.parserVersion===AMENDMENT_EXTRACTION_VERSION,oldSource=extractionSource(old);
  const metadataPrior=new Map((old?.amendments || []).map(amendment=>[String(amendment.number),amendment]));
  const prior=compatible?metadataPrior:new Map();
  const allLosses=extraction.amendments.flatMap(amendment=>amendmentTextLosses(extraction,amendment).map(gap=>({code:gap.code,number:amendment.number,message:gap.message})));
  const seen=new Set();
  const amendments=extraction.amendments.map(amendment=>{
    const accepted=metadataPrior.get(String(amendment.number));seen.add(String(amendment.number));
    const row={...amendment,wordingSource:source,metadataSource:source,proposerSource:source,wordingRetained:false,proposerRetained:false,wordingParserVersion:AMENDMENT_EXTRACTION_VERSION,gaps:[...(amendment.gaps || [])]};
    const damaged=amendmentTextLosses(extraction,amendment).length||typeof amendment.originalText!=='string'||typeof amendment.proposedText!=='string';
    if(damaged&&verifiedWording(old,accepted)) {
      row.originalText=accepted.originalText;row.proposedText=accepted.proposedText;
      row.wordingSource=accepted.wordingSource || oldSource;row.wordingRetained=true;
      row.language=row.wordingSource?.language || accepted.language || old.language;
      row.gaps.push({code:'wording-retained',number:row.number,message:'Previously accepted amendment wording is retained after text extraction failed.'});
    }
    if(!row.authors?.length&&!row.committeeProposer&&accepted&&(accepted.authors?.length||accepted.committeeProposer)) {
      row.authors=accepted.authors || [];row.committeeProposer=accepted.committeeProposer || null;row.onBehalfOf=accepted.onBehalfOf || null;
      row.proposerSource=accepted.proposerSource || accepted.metadataSource || oldSource;row.proposerRetained=true;row.proposerDate=accepted.proposerDate || accepted.date || null;
      row.gaps.push({code:'proposer-retained',number:row.number,message:'Previously accepted proposer evidence is retained because the fresh source has no proposer evidence.'});
    }
    row.sources=[...new Map([...(amendment.sources || []),source,row.wordingSource,row.proposerSource].filter(item=>item?.url).map(item=>[item.url+':'+item.fetchedAt,item])).values()];
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
  const key=motionSourceKey(sittingId),saved=worker.store.source(generation,key),work=saved?.work;
  const ttl=worker.clock()-Date.parse(sittingDate)<14*DAY?6*60*60_000:7*DAY;
  const complete=work && !work.truncated && !work.splitProjectionTruncated && !work.lastRefreshFailure &&
    Array.isArray(work.results)&&work.results.length>0 && Array.isArray(work.decisions)&&work.decisions.length>0 &&
    Array.isArray(work.coverage?.missingResultIds) && Array.isArray(work.coverage?.missingDecisionIds) &&
    !array(work.coverage?.missingResultIds).length && !array(work.coverage?.missingDecisionIds).length &&
    work.amendmentVersion===AMENDMENTS_VERSION && work.amendmentProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION && Array.isArray(work.splitRequests);
  if(complete && worker.clock()-Date.parse(saved.fetchedAt)<ttl)return false;
  // Reuse any pending sitting task, including older key formats, without
  // resetting its page cursor, retry time or accumulated response graph.
  const pending=worker.store.db.prepare("SELECT key FROM tasks WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND (done IS NULL OR done<>1) LIMIT 1").get(generation,sittingId);
  if(pending)return false;
  const upgrade=work&&work.amendmentProjectionVersion!==AMENDMENT_SITTING_PROJECTION_VERSION;
  const taskKey=key+':'+today+(upgrade?':amendments-v'+AMENDMENT_SITTING_PROJECTION_VERSION:'');
  if(worker.store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='motion-outcomes' AND json_extract(body,'$.sittingId')=? AND done=1 AND (key=? OR (?=0 AND key LIKE ?)) LIMIT 1").get(generation,sittingId,taskKey,upgrade?1:0,'%:'+today+'%'))return false;
  worker.store.enqueue(generation,taskKey,'motion-outcomes',{sittingId,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},priority);
  return true;
}

export function scheduleAmendments(worker,generation,work,fetchedAt,endpoint) {
  const id=idOf(work);if(!amendmentTarget(id))return;
  const lists=amendmentLists(work), limited=lists.slice(0,AMENDMENT_LIMITS.listsPerTarget);
  for(const list of limited) {
    const listId=idOf(list);if(!/^[A-Z0-9-]{1,100}$/.test(listId))continue;
    const prior=worker.store.source(generation,sourceKey(listId));
    const files=documentFiles(list),chosen=files.find(file=>file.format==='DOCX'&&file.language==='en') || files.find(file=>file.format==='DOCX');
    const metadata={...projectDocument(list),targetDocumentId:id,files};
    const unchanged=prior?.work.extraction?.sourceUrl===chosen?.url && prior?.work.extraction?.parserVersion===AMENDMENT_EXTRACTION_VERSION && worker.clock()-Date.parse(prior.fetchedAt)<7*DAY;
    worker.store.putSource(generation,sourceKey(listId),'amendment-list',{...metadata,...(prior?.work.extraction?{extraction:prior.work.extraction}:{})},prior?.fetchedAt || fetchedAt);
    if(!unchanged)enqueueAmendment(worker.store,generation,'amendment:extract:'+listId,'amendment-extract',{listId,targetDocumentId:id},112,true);
    const date=list.document_date;
    if(/^\d{4}-\d{2}-\d{2}$/.test(date || '')&&!worker.store.source(generation,rosterKey(date)))enqueueAmendment(worker.store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114);
  }
  rebuildAmendmentTarget(worker,generation,id,{listLimit:lists.length>limited.length});
  const priorTarget=worker.store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const discovered=priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[];
  for(const sittingId of new Set([...amendmentSittings(work),...discovered])) {
    scheduleSittingOutcomes(worker,generation,sittingId);
    const aliasKey='amendment:aliases:'+sittingId;
    if(!worker.store.source(generation,aliasKey))enqueueAmendment(worker.store,generation,aliasKey,'amendment-aliases',{sittingId},108);
  }
}
export function prepareAmendments(worker,cycle) {
  const {generation}=cycle,store=worker.store;
  // One selected public pilot ensures the new view becomes useful during a
  // pre-existing long-running activity backfill. No request is made by readers.
  for(const pilot of ['A-10-2026-0254','B-10-2026-0424'])if(!store.source(generation,targetKey(pilot)))store.enqueue(generation,targetKey(pilot),'document',{endpoint:targetKey(pilot)},109);
  if(cycle.amendmentsPreparedVersion===AMENDMENTS_VERSION && cycle.amendmentsPreparedDay===utcDay(worker) && cycle.splitParserVersion===SPLIT_PARSER_VERSION && cycle.amendmentDocumentParserVersion===AMENDMENT_EXTRACTION_VERSION && cycle.amendmentDocumentLinksVersion===AMENDMENT_LINKS_VERSION && cycle.amendmentSittingProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION)return;
  const sources=store.db.prepare("SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind='document' AND (json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT') ORDER BY json_extract(body,'$.document_date') DESC,key DESC").all(generation);
  let upgrades=0;
  for(const source of sources) {
    const work=JSON.parse(source.body);if(!amendmentTarget(idOf(work)))continue;
    if(work.amendmentLinksVersion!==AMENDMENT_LINKS_VERSION) {
      if(upgrades++<AMENDMENT_LIMITS.upgradeTargets){store.enqueue(generation,source.key,'document',{endpoint:source.key},106,true);rebuildAmendmentTarget(worker,generation,idOf(work));}
    } else scheduleAmendments(worker,generation,work,source.fetched_at,source.key);
  }
  for(const source of store.iterateSources(generation,'amendment-gap'))enqueueAmendment(store,generation,source.work.taskKey,source.work.taskKind,source.work.taskBody,source.work.priority || 105,true);
  // Saved literal split requests are reparsed when the grammar changes. Failure
  // records are updated under this same lease, never during a read request.
  for(const source of store.iterateSources(generation,'motion-outcomes')) {
    if(source.work.splitParserVersion===SPLIT_PARSER_VERSION || !source.work.splitRequests)continue;
    enqueueAmendment(store,generation,'amendment:reparse:'+source.key,'amendment-reparse',{sourceKey:source.key},111,true);
  }
  store.updateCycle({amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:utcDay(worker),splitParserVersion:SPLIT_PARSER_VERSION,amendmentDocumentParserVersion:AMENDMENT_EXTRACTION_VERSION,amendmentDocumentLinksVersion:AMENDMENT_LINKS_VERSION,amendmentSittingProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION});
}
export function parseSavedSplits(worker,work) {
  const parsedSplits=(work.splitRequests || []).map(request=>{
    const evidence=sourceEvidence(request,work.sources,'vote-results');
    const parsed=parseSplitRequest(request,{sourceUrl:evidence.sourceUrl,fetchedAt:evidence.fetchedAt,language:'en'});
    const result={...parsed,...evidence,observationKey:request.observationKey || null,parts:parsed.parts.map(part=>({...part,...evidence})),failures:parsed.failures.map(failure=>({...failure,...evidence}))};
    recordSplitResults(worker.store,result);return result;
  });
  return {...work,parsedSplits,...(Array.isArray(work.splitRequests)&&array(work.decisions).every(decision=>Object.hasOwn(decision,'decided_on_a_realization_of'))?{amendmentVersion:AMENDMENTS_VERSION}:{}),splitParserVersion:SPLIT_PARSER_VERSION};
}
export function refreshSittingTargets(worker,generation,sittingId,work) {
  const directTargets=new Set((work.decisions || []).flatMap(decision=>array(decision.decided_on_a_realization_of).map(amendmentReference).filter(Boolean).map(ref=>ref.targetDocumentId)));
  const targets=new Set(directTargets);
  const linked=worker.store.db.prepare("SELECT id FROM amendment_targets AS target WHERE generation=? AND EXISTS(SELECT 1 FROM json_each(target.body,'$.sittingIds') AS sitting WHERE sitting.value=?)").all(generation,sittingId);
  for(const {id} of linked)targets.add(id);
  // Older snapshots do not yet carry compact sitting links. Their accepted
  // decisions identify the affected targets until the next local rebuild.
  const legacy=worker.store.db.prepare("SELECT DISTINCT amendment.target AS id FROM amendments AS amendment JOIN amendment_targets AS target ON target.generation=amendment.generation AND target.id=amendment.target WHERE amendment.generation=? AND json_type(target.body,'$.sittingIds') IS NULL AND EXISTS(SELECT 1 FROM json_each(amendment.body,'$.decisions') AS decision WHERE json_extract(decision.value,'$.sittingId')=?)").all(generation,sittingId);
  for(const {id} of legacy)targets.add(id);
  const observedDecisionIds=work.amendmentVersion===AMENDMENTS_VERSION?(work.decisions || []).filter(hasDecisionReferenceSet).map(decision=>tail(decision.id)):[];
  for(const id of targets)if(worker.store.source(generation,targetKey(id)))rebuildAmendmentTarget(worker,generation,id,{observedDecisionIds,discoveredSittingIds:directTargets.has(id)?[sittingId]:[]});
}
const normalizedName=value=>String(value || '').normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('und');
function scheduleMandateProfiles(worker,generation,targetId,lists,aliases) {
  const store=worker.store;if(!store.get('amendmentMandateFallback'))return;
  const directory=store.source(generation,'amendment:members:10');
  if(!directory){enqueueAmendment(store,generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108);return;}
  const members=directory.work.members || [],names=new Set(lists.flatMap(({work})=>(work.extraction?.amendments || []).flatMap(amendment=>amendment.authors || [])).map(normalizedName));
  const ids=new Set(members.filter(member=>names.has(normalizedName(member.givenName+' '+member.familyName))||names.has(normalizedName(member.familyName+' '+member.givenName))).map(member=>member.id));
  for(const alias of aliases)if(names.has(normalizedName(alias.alias)))ids.add(String(alias.personId));
  const latestDate=lists.flatMap(({work})=>(work.extraction?.amendments || []).map(amendment=>amendment.date || work.document_date)).filter(Boolean).sort().at(-1);
  for(const id of ids) {
    const profile=store.source(generation,'amendment:member:'+id);
    if(profile && (!latestDate || profile.fetchedAt.slice(0,10)>=latestDate))continue;
    const key='amendment:member:'+id,existing=store.db.prepare('SELECT body,done FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
    if(existing){const body=JSON.parse(existing.body),next={...body,targets:body.targets.includes(targetId)||body.targets.length>=100?body.targets:[...body.targets,targetId]};if(existing.done===1)enqueueAmendment(store,generation,key,'amendment-member',next,107,true);else store.db.prepare('UPDATE amendment_jobs SET body=? WHERE generation=? AND key=?').run(JSON.stringify(next),generation,key);}
    else enqueueAmendment(store,generation,key,'amendment-member',{id,targets:[targetId]},107);
  }
}
function rosterMembers(worker,generation,date) {
  const saved=worker.store.source(generation,rosterKey(date));
  // These intervals describe one observed mandate day, not a whole mandate.
  return {members:[...(saved?.work.members || []).map(member=>({...member,mandates:[{start:date,end:date}]})),...worker.store.sources(generation,'amendment-member').filter(source=>source.fetchedAt.slice(0,10)>=date).map(source=>source.work)],source:saved?.work.sources || []};
}
function cachedDirectSittings(store,generation,targetId) {
  const reference='eli/dl/doc/'+targetId+'-AM-%';
  const candidates=store.db.prepare(`SELECT key,body FROM sources AS source WHERE generation=? AND kind='motion-outcomes'
    AND json_extract(source.body,'$.amendmentVersion')=? AND EXISTS(
      SELECT 1 FROM json_each(source.body,'$.decisions') AS decision,
        json_each(decision.value,'$.decided_on_a_realization_of') AS reference
      WHERE reference.type='text' AND (reference.value LIKE ? OR reference.value LIKE ? OR reference.value LIKE ?))
    ORDER BY key DESC LIMIT ?`).all(generation,AMENDMENTS_VERSION,reference,'https://data.europarl.europa.eu/'+reference,'http://data.europarl.europa.eu/'+reference,AMENDMENT_LIMITS.sittingsPerTarget+1);
  return {limited:candidates.length>AMENDMENT_LIMITS.sittingsPerTarget,sittingIds:candidates.slice(0,AMENDMENT_LIMITS.sittingsPerTarget).filter(source=>array(JSON.parse(source.body).decisions).some(decision=>array(decision.decided_on_a_realization_of).some(value=>amendmentReference(value)?.targetDocumentId===targetId))).map(source=>source.key.replace(/^motion-outcomes:/,'')).filter(id=>/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(id))};
}
export function rebuildAmendmentTarget(worker,generation,id,{listLimit=false,observedDecisionIds=[],discoveredSittingIds=[]}={}) {
  const store=worker.store,saved=store.source(generation,targetKey(id));if(!saved)return;
  const priorTarget=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,id);
  const cachedDirect=cachedDirectSittings(store,generation,id);
  const discovered=[...new Set([...(priorTarget?JSON.parse(priorTarget.body).discoveredSittingIds || []:[]),...cachedDirect.sittingIds,...discoveredSittingIds])];
  const target=targetMetadata(saved.work,saved.fetchedAt,targetKey(id)),rows=new Map(),gaps=[],observed=new Set(observedDecisionIds);
  target.discoveredSittingIds=discovered;
  const relationshipsKnown=Object.hasOwn(saved.work,'inverse_foresees_change_of')&&saved.work.inverse_foresees_change_of!=null&&saved.work.amendmentLinksVersion===AMENDMENT_LINKS_VERSION;
  const currentListIds=[...new Set([...amendmentLists(saved.work).map(idOf),...array(saved.work.inverse_foresees_change_of).map(canonicalEPReference).filter(ref=>ref?.startsWith('eli/dl/doc/')).map(tail)])];
  const currentLists=new Set(currentListIds);
  const lists=store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=?").all(generation,id).map(row=>{const work=JSON.parse(row.body);return {work,fetchedAt:row.fetched_at,current:currentLists.has(idOf(work))};}).sort((a,b)=>Number(b.current)-Number(a.current));
  const sittingSources=[...new Set([...amendmentSittings(saved.work),...discovered])].map(sittingId=>({sittingId,record:store.source(generation,motionSourceKey(sittingId))}));
  target.sittingIds=sittingSources.map(source=>source.sittingId);
  const aliases=sittingSources.flatMap(({sittingId})=>store.source(generation,'amendment:aliases:'+sittingId)?.work.aliases || []);
  scheduleMandateProfiles(worker,generation,id,lists,aliases);
  const base=(amendmentId,number)=>({id:amendmentId,number,listId:null,targetDocumentId:id,title:target.titles.en || id,titles:target.titles,date:target.date,procedureIds:target.procedureIds,targetLabel:null,originalText:null,proposedText:null,language:null,authors:[],decisions:[],splitParts:[],topics:target.topics,sources:[...target.sources],gaps:[],identifierBasis:'derived-from-exact-target-and-number',officialIds:[]});
  if(cachedDirect.limited)gaps.push('This target exceeds the cached direct-decision sitting discovery limit.');
  if(!relationshipsKnown)gaps.push('Current amendment-list relationships are unavailable; previously indexed list evidence is unverified and retained.');
  if(listLimit || amendmentLists(saved.work).length>AMENDMENT_LIMITS.listsPerTarget)gaps.push('This target exceeds the amendment-list processing limit.');
  if(!lists.length)gaps.push('No published amendment list is indexed for this target.');
  const invalidatedTextListIds=lists.filter(({work:list})=>list.extraction?.previousParserVersion&&list.extraction.previousParserVersion!==AMENDMENT_EXTRACTION_VERSION).map(({work})=>idOf(work));
  for(const {work:list,current} of lists) {
    const extraction=list.extraction,date=list.document_date || target.date;
    if(!current&&relationshipsKnown)gaps.push('A previously indexed amendment list is absent from the current target relationships; its evidence is retained.');
    if(!extraction){gaps.push('Amendment text extraction is pending.');continue;}
    gaps.push(...(extraction.gaps || []).map(gap=>typeof gap==='string'?gap:gap.message || gap.reason || gap.code || 'Document extraction is incomplete.'));
    if(extraction.lastRefreshFailure)gaps.push('An amendment-list refresh has incomplete text or amendment coverage; retained evidence is labelled on its record.');
    for(const amendment of extraction.amendments || []) {
      const number=Number(amendment.number);if(!Number.isInteger(number)||number<1||number>99999)continue;
      const amendmentId=id+'-AM-'+number,row=base(amendmentId,number);
      const authorDate=amendment.proposerDate || amendment.date || date,roster=rosterMembers(worker,generation,authorDate);
      const activeIds=new Set(roster.members.map(member=>String(member.id)));
      const datedAliases=aliases.filter(alias=>activeIds.has(String(alias.personId).replace(/^person\//,'')));
      const textLosses=amendmentTextLosses(extraction,amendment);
      const acceptedWording=verifiedWording(extraction,amendment),withhold=textLosses.length&&!acceptedWording;
      Object.assign(row,{listId:idOf(list),listRelationship:current?'current':relationshipsKnown?'absent-current-relationship':'unverified',date:amendment.date || date,targetLabel:text(amendment.targetLabel),originalText:withhold?null:typeof amendment.originalText==='string'?amendment.originalText:null,proposedText:withhold?null:typeof amendment.proposedText==='string'?amendment.proposedText:null,textIntegrity:acceptedWording?'complete':textLosses.length?'incomplete':'unavailable',textParserVersion:amendment.wordingParserVersion || extraction.parserVersion,wordingSource:Object.hasOwn(amendment,'wordingSource')?amendment.wordingSource:extractionSource(extraction),metadataSource:Object.hasOwn(amendment,'metadataSource')?amendment.metadataSource:extractionSource(extraction),proposerSource:Object.hasOwn(amendment,'proposerSource')?amendment.proposerSource:extractionSource(extraction),wordingRetained:Boolean(amendment.wordingRetained),proposerRetained:Boolean(amendment.proposerRetained),proposerDate:amendment.proposerDate || amendment.date || date,recordRetained:Boolean(amendment.recordRetained),language:amendment.language || extraction.language,onBehalfOf:amendment.onBehalfOf || null,committeeProposer:amendment.committeeProposer || null,documentDate:amendment.documentDate || amendment.date || null,listDocumentDate:list.document_date || null,dateBasis:amendment.dateBasis || (amendment.date?'individual-amendment-document':'amendment-list-document'),justification:text(amendment.justification)});
      row.authors=resolveAmendmentAuthors(amendment.authors || [],{members:roster.members,aliases:datedAliases,date:authorDate,relatedSittingDates:sittingSources.map(({sittingId})=>sittingId.slice(7))}).map(author=>({...author,personId:author.personId==null?null:String(author.personId).replace(/^person\//,''),evidence:[...(author.evidence || []),...(roster.source.length?[{type:'dated_roster',sources:roster.source,mandateObservedOn:authorDate}]:[])]}));
      row.sources.push(...(amendment.sources || []),{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language});
      row.gaps.push(...(amendment.gaps || []).map(gap=>typeof gap==='string'?gap:gap.message || gap.code || 'Amendment extraction is incomplete.'));
      row.gaps.push(...textLosses.map(gap=>gap.message || gap.code));
      if(!current&&!relationshipsKnown)row.gaps.push('The current amendment-list relationship is unavailable; this list evidence is unverified and retained.');
      if(!current&&relationshipsKnown)row.gaps.push('This amendment list is absent from the current target relationships; its earlier evidence is retained.');
      if(!row.authors.length)row.gaps.push('Individual amendment authors are not recorded in the extracted source.');
      if(row.authors.some(author=>!author.personId))row.gaps.push('Some author identities are unresolved.');
      if(row.language!=='en')row.gaps.push('English amendment text is unavailable; the published source language is retained.');
      const previous=rows.get(amendmentId);
      if(previous){
        const variant=value=>({listId:value.listId,listRelationship:value.listRelationship,date:value.date,language:value.language,targetLabel:value.targetLabel,originalText:value.originalText,proposedText:value.proposedText,textIntegrity:value.textIntegrity,textParserVersion:value.textParserVersion,wordingSource:value.wordingSource,metadataSource:value.metadataSource,proposerSource:value.proposerSource,wordingRetained:value.wordingRetained,proposerRetained:value.proposerRetained,proposerDate:value.proposerDate,authors:value.authors,onBehalfOf:value.onBehalfOf,committeeProposer:value.committeeProposer,documentDate:value.documentDate,listDocumentDate:value.listDocumentDate,dateBasis:value.dateBasis,justification:value.justification,sources:[...value.sources],gaps:[...value.gaps]});
        row.variants=[...(previous.variants || [variant(previous)]),variant(row)];
        row.conflicted=true;row.listRelationship='conflicting-variants';row.listId=null;row.originalText=null;row.proposedText=null;row.authors=[];row.language=null;row.targetLabel=null;row.onBehalfOf=null;row.justification=null;
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
    if(record.work.splitProjectionTruncated)gaps.push('A linked sitting reached the split-request pagination limit; request coverage is incomplete.');
    if(record.work.amendmentVersion!==AMENDMENTS_VERSION){gaps.push('Linked sitting amendment relationships are pending.');continue;}
    if(record.work.amendmentProjectionVersion!==AMENDMENT_SITTING_PROJECTION_VERSION)gaps.push('Linked sitting split-request projection is unverified until its source graph is refreshed.');
    const parts=new Map((record.work.parsedSplits || []).flatMap(request=>request.parts.flatMap(part=>{
      const reference=canonicalEPReference(part.id);
      return reference?[[reference,{...part,id:reference,requestId:request.requestId,grounding:'not_attempted',parserVersion:record.work.splitParserVersion}]]:[];
    })));
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
        if(!evidence.source)row.gaps.push('An amendment decision has no exact recorded source page; candidate page provenance is retained.');
        if(splitRefs.length)for(const partRef of splitRefs) {
          const reference=canonicalEPReference(partRef),part=reference?parts.get(reference):null;
          row.decisions.push({...vote,partId:reference || String(partRef?.id || partRef),partNumber:part?.number || Number(tail(partRef).split('-').at(-1))});
          if(part && !row.splitParts.some(existing=>existing.id===part.id))row.splitParts.push(part);
          if(!part)row.gaps.push('A split component has no indexed description.');
          else if(part.status==='unresolved')row.gaps.push('A split description could not be parsed; the failure is retained for a future parser update.');
          else row.gaps.push('Split descriptions are parsed as selection plans; exact wording spans have not been validated.');
          if(part&&!part.source?.url)row.gaps.push('The split description has no exact recorded source page; candidate page provenance is retained.');
        } else row.decisions.push(vote);
        if(!row.targetLabel)row.targetLabel=decision.referenceText?.en || null;
        row.sources.push(...(record.work.sources || []));
      }
    }
  }
  for(const row of rows.values()) {
    if(row.targetLabel)row.topics=[...row.topics,{id:'target:'+row.targetLabel,label:row.targetLabel,basis:'target'}];
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
  const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'application/xml,application/octet-stream','User-Agent':'Parliament-Explorer/0.1 (public voting aliases)'},signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])])},resolve).on('error',reject));
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
  if(task.kind==='amendment-reparse') {
    const source=store.source(generation,body.sourceKey);if(!source)throw new Error('Saved split request source is unavailable.');
    const updated=parseSavedSplits(worker,source.work);
    store.putSource(generation,body.sourceKey,'motion-outcomes',updated,source.fetchedAt);
    refreshSittingTargets(worker,generation,body.sourceKey.replace(/^motion-outcomes:/,''),updated);
  } else if(task.kind==='amendment-extract') {
    const saved=store.source(generation,sourceKey(body.listId));if(!saved)throw new Error('Amendment-list metadata is unavailable.');
    const files=saved.work.files || documentFiles(saved.work),file=files.find(file=>file.format==='DOCX'&&file.language==='en') || files.find(file=>file.format==='DOCX');
    if(!file)throw new Error('No published DOCX is available for this amendment list.');
    worker.requests++;const cycle=store.get('working');if(cycle)store.updateCycle({requests:(cycle.requests || 0)+1});
    const downloaded=await boundedUpstream(admittedSignal=>worker.downloadAmendmentDocx(file.url,{signal:admittedSignal}),{priority:'background',signal});
    signal.throwIfAborted();
    const fetchedAt=new Date(worker.clock()).toISOString(),extraction=extractAmendments(downloaded.buffer,{listId:body.listId,targetDocumentId:body.targetDocumentId,language:file.language,sourceUrl:file.url,fetchedAt});
    if(!Array.isArray(extraction.amendments)||extraction.amendments.length>AMENDMENT_LIMITS.amendmentsPerList)throw new Error('Amendment extraction exceeded its record budget.');
    for(const date of [...new Set(extraction.amendments.map(amendment=>amendment.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date || '')))].slice(0,20))if(!store.source(generation,rosterKey(date)))enqueueAmendment(store,generation,rosterKey(date),'amendment-roster',{date,offset:0,members:[],sources:[]},114);
    const next={...saved.work,extraction:mergeExtractionRefresh(saved.work.extraction,extraction,{url:file.url,fetchedAt,language:file.language})};
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
    const targets=store.db.prepare("SELECT DISTINCT json_extract(source.body,'$.targetDocumentId') AS id FROM sources AS source WHERE generation=? AND kind='amendment-list' AND (json_extract(source.body,'$.document_date')=? OR EXISTS(SELECT 1 FROM json_each(source.body,'$.extraction.amendments') AS amendment WHERE json_extract(amendment.value,'$.date')=?))").all(generation,body.date,body.date);
    for(const {id} of targets)rebuildAmendmentTarget(worker,generation,id);
  } else if(task.kind==='amendment-members') {
    const record=await worker.request('/meps',{'parliamentary-term':10,limit:1000,offset:body.offset});
    const members=record.payload.data.map(person=>({id:String(person.identifier || tail(person.id)),givenName:person.givenName || '',familyName:person.familyName || ''}));
    const identities=new Set(body.members.map(member=>member.id));
    for(const member of members){if(!/^[1-9]\d*$/.test(member.id)||!Number.isSafeInteger(Number(member.id))||identities.has(member.id))throw new Error('Term MEP roster contains invalid or repeated identities.');identities.add(member.id);}
    if(members.length){store.taskProgress(task,{...body,members:[...body.members,...members],offset:body.offset+members.length});return;}
    if(!body.members.length)throw new Error('Term MEP roster is unavailable.');
    store.putSource(generation,'amendment:members:10','amendment-members',{members:body.members,source:{url:record.url,fetchedAt:record.fetchedAt}},record.fetchedAt);
    for(const row of store.db.prepare('SELECT id FROM amendment_targets WHERE generation=?').all(generation))rebuildAmendmentTarget(worker,generation,row.id);
  } else if(task.kind==='amendment-member') {
    if(!/^[1-9]\d*$/.test(body.id))throw new Error('Invalid amendment author person ID.');
    const record=await worker.request('/meps/'+body.id),person=record.payload.data.find(person=>String(person.identifier || tail(person.id))===body.id);
    if(!person)throw new Error('Amendment author profile is unavailable.');
    const member={id:body.id,givenName:person.givenName || '',familyName:person.familyName || '',hasMembership:array(person.hasMembership).filter(membership=>tail(membership.role)==='MEMBER_PARLIAMENT'),sourceUrl:record.url,fetchedAt:record.fetchedAt};
    store.putSource(generation,'amendment:member:'+body.id,'amendment-member',member,record.fetchedAt);
    for(const id of body.targets)rebuildAmendmentTarget(worker,generation,id);
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
    const xml=await boundedUpstream(admittedSignal=>worker.downloadVotingXml(file.url,{signal:admittedSignal}),{priority:'background',signal});
    signal.throwIfAborted();
    const fetchedAt=new Date(worker.clock()).toISOString(),aliases=votingAliases(xml,{sourceUrl:file.url,fetchedAt,sittingDate:date});
    store.putSource(generation,'amendment:aliases:'+body.sittingId,'amendment-aliases',{aliases,sources:[body.documentSource,{url:file.url,fetchedAt}]},fetchedAt);
    const sitting=store.source(generation,motionSourceKey(body.sittingId));if(sitting)refreshSittingTargets(worker,generation,body.sittingId,sitting.work);
  } else throw new Error('Unknown amendment task.');
  store.finishTask(task);
  store.db.prepare("DELETE FROM sources WHERE generation=? AND key=? AND kind='amendment-gap'").run(generation,'amendment:gap:'+task.key);
}
export function failAmendmentTask(worker,task,error) {
  if(!task.kind.startsWith('amendment-'))return false;
  if(task.kind==='amendment-roster'){worker.store.set('amendmentMandateFallback',true);enqueueAmendment(worker.store,task.generation,'amendment:members:10','amendment-members',{offset:0,members:[]},108);}
  if(task.attempts<2)return false;
  const at=new Date(worker.clock()).toISOString();
  worker.store.putSource(task.generation,'amendment:gap:'+task.key,'amendment-gap',{taskKey:task.key,taskKind:task.kind,taskBody:task.body,priority:task.priority,error:String(error.message).slice(0,350),failedAt:at},at);
  worker.store.finishTask(task);return true;
}
export const amendmentDownloads={downloadDocxBuffer,downloadVotingXml};

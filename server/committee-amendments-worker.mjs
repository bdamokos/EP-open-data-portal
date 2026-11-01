import {createHash} from 'node:crypto';
import {array,tail,projectDocument} from './activity-index-model.mjs';
import {COMMITTEE_AMENDMENTS_VERSION,validCommitteeWork,committeeListId,committeeDraftId,committeeScopeKey,committeeDocumentEndpoint,committeeDiscoveryReferences,committeeTargetRelationship,committeeDocumentKind,sourceCommittees,committeeRevisionLists,committeeProcedureIds as procedureIds} from './committee-amendments.mjs';
import {enqueueAmendment,saveAmendmentRows} from './amendments-store.mjs';
import {distributionEvidenceFor,currentDocxDescriptor,listWordingFreshness,amendmentProposerDate,amendmentTextLosses,validAmendmentDate,sameDocxDescriptor,resolvedAmendmentAuthorId} from './amendments.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENT_AUTHOR_NAMES_VERSION,listAuthorResolver,resolveParallelAuthors,authorNameVariants} from './amendment-author-names.mjs';
import {createAmendmentAuthorResolver} from './amendment-authors.mjs';
import {runAmendmentWorkSlice} from './amendment-work-slices.mjs';
import {documentRouteOwned,documentRouteDeferredOwners} from './document-detail-routing.mjs';

const DAY=86400000;
const listKey=id=>'amendment:list:'+id;
const associationKey=id=>'committee:association:'+id;
const source=(key,fetchedAt)=>({url:'https://data.europarl.europa.eu/api/v2'+key+'?format=application%2Fld%2Bjson',fetchedAt,language:null});
const unique=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
function enqueueDocument(worker,generation,endpoint,kind='document') {
  const store=worker.store;
  // Core retry owners and the extension queue share one source lane. A
  // relationship must not reset an older request's attempts or backoff.
  for(const table of ['tasks','amendment_jobs'])if(store.db.prepare(`SELECT 1 FROM ${table} WHERE generation=? AND key=? AND (done IS NULL OR done<>1)`).get(generation,endpoint))return true;
  if(store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,endpoint))return true;
  if(documentRouteOwned(store,generation,endpoint,documentRouteDeferredOwners(store,generation)))return true;
  return enqueueAmendment(store,generation,endpoint,kind,{endpoint},103,true,{deferOnCapacity:true});
}

function associate(store,generation,id,incoming) {
  const key=associationKey(id),old=store.source(generation,key)?.work||{};
  const evidence=unique([...(old.evidence||[]),...(incoming.evidence||[])]);
  const work={procedureIds:[...new Set([...(old.procedureIds||[]),...(incoming.procedureIds||[])])].sort(),draftIds:[...new Set([...(old.draftIds||[]),...(incoming.draftIds||[])])].sort(),
    evidence:evidence.slice(-256),truncated:Boolean(old.truncated||evidence.length>256)};
  if(JSON.stringify(old)!==JSON.stringify(work))store.putSource(generation,key,'committee-association',work,new Date(store.clock()).toISOString());
  return work;
}

export function scheduleCommitteeDiscovery(worker,generation,work,fetchedAt,endpoint) {
  if(!endpoint.startsWith('/procedures/')&&!validCommitteeWork(work))return true;
  if(endpoint.startsWith('/procedures/')&&String(work.id||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')!=='eli/dl/proc/'+tail(endpoint))throw new Error('Committee discovery requires an exact procedure identity.');
  const references=committeeDiscoveryReferences(work);
  if(!references.length)return true;
  // The task retains the source snapshot signature. A changed source starts a
  // new bounded walk without replacing a running cursor or its retry state.
  const linkedProcedures=endpoint.startsWith('/procedures/')?[tail(endpoint)]:[...new Set([...procedureIds(work),...(worker.store.source(generation,associationKey(work.identifier))?.work.procedureIds||[])])];
  const signature=createHash('sha256').update(JSON.stringify([work,fetchedAt,linkedProcedures])).digest('hex').slice(0,16);
  const admitted=enqueueAmendment(worker.store,generation,'amendment:committee-discover:'+endpoint+':'+signature,'amendment-committee-discover',{endpoint,references,offset:0,procedureIds:linkedProcedures,source:source(endpoint,fetchedAt)},105,false,{deferOnCapacity:true});
  if(!admitted)worker.store.set('committeeDiscoveryPending',(worker.store.get('committeeDiscoveryPending')||0)+1);
  return admitted;
}

export function committeePreparationDue(store,generation) {
  if(!generation)return false;
  if(!store.get('committeeDiscoveryPending')&&!store.db.prepare(`SELECT 1 FROM sources WHERE generation=? AND kind IN ('procedure','document') AND
    (kind='procedure' OR json_extract(body,'$.work_type') IN ('def/ep-document-types/AMENDMENT_LIST','def/ep-document-types/REPORT_PARLIAMENTARY_COMMITTEE_DRAFT','def/ep-document-types/OPINION_PARLIAMENTARY_COMMITTEE_DRAFT')
    OR json_array_length(json_extract(body,'$.inverse_created_a_realization_of'))>0) LIMIT 1`).get(generation))return false;
  const marker=store.source(generation,'committee:preparation')?.work;
  return marker?.version!==COMMITTEE_AMENDMENTS_VERSION||marker.day!==new Date(store.clock()).toISOString().slice(0,10)||Boolean(store.get('committeeDiscoveryPending'));
}
export function prepareCommitteeAmendments(worker,generation) {
  if(!committeePreparationDue(worker.store,generation))return;
  const day=new Date(worker.clock()).toISOString().slice(0,10);
  enqueueAmendment(worker.store,generation,'amendment:committee-prepare:'+COMMITTEE_AMENDMENTS_VERSION+':'+day,'amendment-committee-prepare',{afterKey:'',throughKey:worker.store.db.prepare("SELECT MAX(key) key FROM sources WHERE generation=? AND kind IN ('procedure','document')").get(generation)?.key||'',day,pendingRevision:worker.store.get('committeeDiscoveryPending')||0},104,true,{deferOnCapacity:true});
}

export async function committeeDiscoveryTask(worker,task,{rebuild}={}) {
  const {store}=worker,{generation}=task;
  const yieldOnCapacity=action=>(...args)=>{
    const admitted=action(...args);
    if(admitted===false) {
      // Let lower-priority dependencies drain before retrying this cursor.
      store.assertWriter();
      store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET retry_at=MAX(COALESCE(retry_at,0),?) WHERE generation=? AND key=?`).run(worker.clock()+60_000,generation,task.key);
    }
    return admitted;
  };
  if(task.kind==='amendment-committee-prepare') {
    const complete=await runAmendmentWorkSlice(worker,task,{
      select:body=>store.db.prepare("SELECT key,body,fetched_at FROM sources INDEXED BY committee_preparation WHERE generation=? AND kind IN ('procedure','document') AND key>? AND key<=? ORDER BY key LIMIT 1").get(generation,body.afterKey,body.throughKey),
      action:yieldOnCapacity(row=>{
        const work=JSON.parse(row.body);
        if(row.key.startsWith('/procedures/')) {
          if(work.committeeProjectionVersion!==COMMITTEE_AMENDMENTS_VERSION)return enqueueDocument(worker,generation,row.key,'procedure');
          return scheduleCommitteeDiscovery(worker,generation,work,row.fetched_at,row.key);
        } else if(validCommitteeWork(work)) {
          if(work.committeeProjectionVersion!==COMMITTEE_AMENDMENTS_VERSION)return enqueueDocument(worker,generation,committeeDocumentEndpoint(work.identifier));
          if(scheduleCommitteeDiscovery(worker,generation,work,row.fetched_at,row.key)===false)return false;
          if(committeeListId(work.identifier))prepareCommitteeList(worker,generation,work,row.fetched_at,row.key,{rebuild});
        } else if(/^(?:A|B|RC)-10-/.test(work.identifier||'')) {
          for(const id of procedureIds(work))if(!store.source(generation,'/procedures/'+id)&&!enqueueDocument(worker,generation,'/procedures/'+id,'procedure'))return false;
        }
      }),advance:row=>({afterKey:row.key}),
    });
    if(complete){
      store.putSource(generation,'committee:preparation','committee-preparation',{version:COMMITTEE_AMENDMENTS_VERSION,day:task.body.day},new Date(worker.clock()).toISOString());
      if((store.get('committeeDiscoveryPending')||0)===(task.body.pendingRevision||0))store.set('committeeDiscoveryPending',0);
      store.finishTask(task);
    }return;
  }
  const complete=await runAmendmentWorkSlice(worker,task,{
    select:body=>body.references[body.offset],
    action:yieldOnCapacity((reference,body)=>{
      const endpoint=committeeDocumentEndpoint(reference.id),old=store.source(generation,endpoint);
      if(!endpoint)return;
      const parentDraft=committeeDraftId(tail(body.endpoint))?tail(body.endpoint):null;
      const association=associate(store,generation,reference.id,{procedureIds:body.procedureIds,draftIds:parentDraft?[parentDraft]:[],evidence:[{...reference,source:body.source,procedureIds:body.procedureIds}]});
      if(old&&validCommitteeWork(old.work)) {
        if(committeeListId(reference.id))prepareCommitteeList(worker,generation,old.work,old.fetchedAt,endpoint,{rebuild});
        // Propagate a newly proven dossier through an already saved draft.
        if(committeeDraftId(reference.id)&&association.procedureIds.length&&scheduleCommitteeDiscovery(worker,generation,old.work,old.fetchedAt,endpoint)===false)return false;
      }
      if(old?.work.committeeProjectionVersion===COMMITTEE_AMENDMENTS_VERSION&&worker.clock()-Date.parse(old.fetchedAt)<7*DAY)return;
      return enqueueDocument(worker,generation,endpoint);
    }),advance:(_,body)=>({offset:body.offset+1}),
  });
  if(complete)store.finishTask(task);
}

export function prepareCommitteeList(worker,generation,work,fetchedAt,endpoint,{rebuild}={}) {
  if(!validCommitteeWork(work)||!committeeListId(work.identifier))return;
  const store=worker.store,id=work.identifier,prior=store.source(generation,listKey(id));
  const association=store.source(generation,associationKey(id))?.work||{};
  const targetRelationship=committeeTargetRelationship(work,association.draftIds||[]),targetDocumentId=targetRelationship.targetDocumentId;
  const target=targetDocumentId&&store.source(generation,committeeDocumentEndpoint(targetDocumentId));
  const procedures=[...new Set([...procedureIds(work),...(association.procedureIds||[]),...procedureIds(target?.work||{})])].sort();
  const metadataSource=source(endpoint,fetchedAt),distributionEvidence=distributionEvidenceFor(work,metadataSource);
  const next={...projectDocument(work),committeeProjectionVersion:COMMITTEE_AMENDMENTS_VERSION,scope:'committee',scopeKey:committeeScopeKey(id),targetDocumentId,targetRelationship,procedureIds:procedures,procedureEvidence:association.evidence||[],committees:sourceCommittees(work),committeeDocumentKind:committeeDocumentKind(target?.work),distributionEvidence,metadataSource,
    ...(prior?.work.extraction?{extraction:prior.work.extraction}:{}),...(prior?.work.authorNames?{authorNames:prior.work.authorNames}:{}),...(prior?.work.wordingRefreshFailure?{wordingRefreshFailure:prior.work.wordingRefreshFailure}:{})};
  store.putSource(generation,listKey(id),'amendment-list',next,fetchedAt);
  if(rebuild)rebuild(worker,generation,next.scopeKey);
  const freshness=listWordingFreshness(next,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
  if(currentDocxDescriptor(next)&&freshness.status!=='fresh'&&!(freshness.status==='failed'&&Date.parse(freshness.retryAfter)>worker.clock()))
    enqueueAmendment(store,generation,'amendment:extract:'+id,'amendment-extract',{listId:id,targetDocumentId:next.scopeKey},112,true);
  const dates=[...new Set([work.document_date,...(association.evidence||[]).map(proof=>proof.date)])].filter(validAmendmentDate);
  for(const date of dates)if(!store.source(generation,'amendment:roster:'+date))enqueueAmendment(store,generation,'amendment:roster:'+date,'amendment-roster',{date,offset:0,members:[],sources:[]},114,true);
}

export function rebuildCommitteeList(worker,generation,key,{rosterMembers,scheduleMandateProfiles,verifiedWording,discover=true}={}) {
  const store=worker.store,id=key.slice('committee:'.length),saved=store.source(generation,listKey(id)),list=saved?.work;
  if(!committeeListId(id)||!list||!validCommitteeWork(list)||list.scopeKey!==key)return;
  const extraction=list.extraction,rows=[],gaps=[],contexts=new Map(),profiles=store.memberProfiles(generation);
  const freshness=listWordingFreshness(list,{parserVersion:AMENDMENT_EXTRACTION_VERSION});
  const revisionLists=committeeRevisionLists(list),countConflict=revisionLists.length>0;
  const descriptors=list.distributionEvidence?.descriptors||[],selectedLanguage=descriptors.some(file=>file.language==='en')?'en':descriptors[0]?.language;
  const sourceAmbiguous=descriptors.filter(file=>file.language===selectedLanguage).length>1;
  const tablingDates=[...new Set((list.procedureEvidence||[]).filter(proof=>proof.activityType==='COMMITTEE_TABLING_AMENDMENT').map(proof=>proof.date))].filter(validAmendmentDate);
  const context=date=>{
    if(!contexts.has(date)){const roster=rosterMembers(worker,generation,date,profiles);contexts.set(date,{roster,resolve:createAmendmentAuthorResolver({members:roster.members,date})});}return contexts.get(date);
  };
  if(discover&&extraction)scheduleMandateProfiles(worker,generation,key,[{work:list}],[]);
  if(countConflict)gaps.push('Linked list revisions require distinct-amendment reconciliation.');
  if(sourceAmbiguous)gaps.push('Current same-language DOCX declarations compete.');
  if(!list.procedureIds.length)gaps.push('The exact dossier association is unavailable.');
  if(list.targetRelationship.status==='conflicting')gaps.push('Draft target relationships conflict.');
  if(!extraction)gaps.push('Committee amendment wording is unavailable.');
  if(freshness.status!=='fresh')gaps.push('Current committee amendment wording is '+freshness.status+'.');
  for(const amendment of extraction?.amendments||[]) {
    const number=Number(amendment.number);if(!Number.isInteger(number)||number<1||number>99999)continue;
    const dateProof=amendmentProposerDate(amendment,{documentDate:amendment.documentDate||amendment.date,listDate:list.document_date}),authorDate=dateProof?.date||null;
    const {roster,resolve}=context(authorDate);
    const nameProof=list.authorNames?.version===AMENDMENT_AUTHOR_NAMES_VERSION&&list.authorNames.parserVersion===AMENDMENT_EXTRACTION_VERSION&&sameDocxDescriptor(list.authorNames.primaryDescriptor,extraction.sourceDescriptor)&&list.distributionEvidence.descriptors.some(file=>sameDocxDescriptor(file,list.authorNames.descriptor))?list.authorNames:null;
    const resolveNames=listAuthorResolver({extraction,alternate:nameProof,resolve,date:authorDate,source:nameProof?.source});
    const alternate=nameProof?.amendments.filter(other=>Number(other.number)===number)||[];
    const proposerSource=amendment.proposerSource||{url:extraction.sourceUrl,fetchedAt:extraction.fetchedAt,language:extraction.language};
    let authors=resolveParallelAuthors({authors:resolveNames(amendment.authors||[]),amendment:{...amendment,listId:id,targetDocumentId:list.targetDocumentId},alternate:alternate.length===1?alternate[0]:null,resolve,source:nameProof?.source})
      .map(author=>({...author,personId:resolvedAmendmentAuthorId(author),nameVariants:[...(author.nameVariants||[]),...authorNameVariants(author,proposerSource)],evidence:[...(author.evidence||[]),...(roster.source.length?[{type:'dated_roster',sources:roster.source,mandateObservedOn:authorDate}]:[])]}));
    // A second, conflicting tabling date requires a checked mandate on both
    // days. No plenary alias or nearby sitting participates in this resolution.
    const dateConflict=tablingDates.length>1;
    authors=authors.map(author=>{
      const evidence=[...author.evidence];
      const checked=author.personId&&!dateConflict&&tablingDates.every(date=>{
        if(date===authorDate)return true;
        const {roster,resolve}=context(date),match=resolve([author.displayName||author.name]).find(other=>resolvedAmendmentAuthorId(other)===author.personId);
        if(!match)return false;
        evidence.push(...match.evidence,...(roster.source.length?[{type:'dated_roster',sources:roster.source,mandateObservedOn:date}]:[]));
        return true;
      });
      return checked?{...author,evidence}:{...author,personId:null,method:null,status:dateConflict?'conflicting_tabling_dates':!authorDate?'missing_proposer_date':author.personId?'unverified_tabling_mandate':author.status};
    });
    const identityConflict=Boolean(extraction.gaps?.some(gap=>['duplicate-amendment','number-conflict','number-outside-list'].includes(gap.code)&&Number(gap.number)===number));
    if(identityConflict||sourceAmbiguous)authors=authors.map(author=>({...author,personId:null,method:null,status:identityConflict?'conflicting_identity':'ambiguous_distribution'}));
    const losses=amendmentTextLosses(extraction,amendment),readable=!identityConflict&&!sourceAmbiguous&&verifiedWording(extraction,amendment),withhold=!readable;
    const rowGaps=[...(amendment.gaps||[]).map(gap=>typeof gap==='string'?gap:gap.message||gap.code),...losses.map(gap=>gap.message||gap.code)];
    if(authors.some(author=>!author.personId))rowGaps.push('Some proposer identities are unavailable.');
    if(dateConflict)rowGaps.push('Recorded tabling dates conflict.');
    rows.push({...amendment,id:key+':'+number,number,numberPublished:amendment.numberPublished||String(amendment.number),scope:'committee',contributionKind:'tabled-amendment',identityConflict,sourceAmbiguous,countConflict,revisionListIds:revisionLists,listId:id,officialIds:[],identifierBasis:'derived-from-exact-list-and-number',targetDocumentId:list.targetDocumentId,targetRelationship:list.targetRelationship,committeeDocumentKind:list.committeeDocumentKind,committees:list.committees,procedureIds:list.procedureIds,procedureEvidence:list.procedureEvidence,
      titles:list.title_dcterms||{},date:amendment.date||list.document_date||null,documentDate:amendment.documentDate||amendment.date||null,listDocumentDate:list.document_date||null,proposerDate:authorDate,proposerDateBasis:dateProof?.basis||null,authors,
      tabling:{status:dateConflict?'conflicting':tablingDates.length?'recorded':'unavailable',date:tablingDates.length===1?tablingDates[0]:null},
      sourceVersion:{epNumber:list.epNumber||null,epNumberVersion:list.epNumberVersion||null,sourceDescriptor:extraction.sourceDescriptor||null,sourceHash:extraction.sourceHash||null,notesComplete:!array(amendment.gaps).some(gap=>gap?.code==='notes-unavailable'),revisionRelationships:Object.fromEntries(['isVersionOf','hasVersion','is_replaced_by','replaces'].filter(key=>list[key]!==undefined).map(key=>[key,list[key]]))},
      originalText:withhold?null:amendment.originalText,proposedText:withhold?null:amendment.proposedText,originalFormatting:withhold?[]:amendment.originalFormatting||[],proposedFormatting:withhold?[]:amendment.proposedFormatting||[],textParserVersion:extraction.parserVersion,textIntegrity:readable?'complete':'incomplete',language:amendment.language||extraction.language,
      targetLabelLanguage:extraction.language,targetLabelSource:amendment.metadataSource||proposerSource,wordingSource:amendment.wordingSource||proposerSource,metadataSource:amendment.metadataSource||proposerSource,proposerSource,sourceFreshness:freshness,decisions:[],splitParts:[],sources:unique([...(amendment.sources||[]),proposerSource,list.metadataSource]),gaps:rowGaps});
  }
  const wordingComplete=Boolean(rows.length&&rows.every(row=>row.textIntegrity==='complete')&&!extraction?.gaps?.some(gap=>['list-coverage','duplicate-amendment','number-conflict','number-outside-list','list-range-unavailable'].includes(gap.code))&&freshness.status==='fresh');
  const proposerComplete=Boolean(rows.length&&rows.every(row=>row.authors.length&&row.authors.every(author=>author.personId)));
  saveAmendmentRows(store,generation,{id:key,scope:'committee',listId:id,targetDocumentId:list.targetDocumentId,targetRelationship:list.targetRelationship,committeeDocumentKind:list.committeeDocumentKind,committees:list.committees,procedureIds:list.procedureIds,committeeProjectionVersion:COMMITTEE_AMENDMENTS_VERSION,sources:[list.metadataSource],date:list.document_date||null},rows,
    {complete:false,wordingComplete,proposerComplete,outcomeCoverage:'unavailable',gaps,lastUpdated:saved.fetchedAt},{currentListIds:[id],textParserVersion:AMENDMENT_EXTRACTION_VERSION});
}

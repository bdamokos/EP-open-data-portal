import {validCommitteeWork,committeeDraftId} from './committee-amendments.mjs';
import {prepareCommitteeList,scheduleCommitteeDiscovery,prepareCommitteeAmendments,committeePreparationDue} from './committee-amendments-worker.mjs';
import {retainDemographicRecord,retainDemographicAttempt,retainRosterAttempt,demographicPerson} from './demographic-metadata.mjs';
import {cataloguePage,acquisitionMode,observeSource,finishAvailabilityWrite} from './availability-history.mjs';
import {groupHistoryTask,scheduleGroupHistory} from './group-history.mjs';
import {groupHistoryRepairDue,scheduleGroupHistoryRepair} from './group-history-repair.mjs';
import {runHistoryReadiness,publishMissingHistory} from './history-readiness.mjs';
import {membershipTask,scheduleMembership} from './following-membership.mjs';
import { booleanFromEnvironment, integerFromEnvironment, absolutePathFromEnvironment } from './config.mjs';
import {groupVoiceProjection,groupVoiceJobKey,recordGroupVoice,groupVoiceWorkDue,groupVoicesCopy,initializeGroupVoices,nextGroupVoiceTask,enqueueGroupVoice} from './group-voices-store.mjs';
import {personNameVariants} from './speaker-identity.mjs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ODP_BASE, boundedUpstream, backoffUpstream, observedOdpFetch } from './odp.mjs';
import { amendmentTask, rebuildAmendmentTarget, scheduleAmendments, scheduleSittingOutcomes, prepareAmendments, amendmentParserUpgradeDue, prepareAmendmentParserUpgrade, parseSavedSplits, refreshSittingTargets, failAmendmentTask, amendmentDownloads } from './amendments-worker.mjs';
import { projectAmendmentDecisions, projectAmendmentSplits, AMENDMENT_SITTING_PROJECTION_VERSION } from './amendments.mjs';
import { amendmentReadVersion, nextAmendmentTask, amendmentGeneration, amendmentsCopy, amendmentCompletionMarker, invalidateAmendmentLinks } from './amendments-store.mjs';
import {spId,validateTA,validateReply,projectFollowup,projectFollowupReferences} from './commission-followups-model.mjs';
import {mutableRecoveryDue} from './mutable-document-recovery.mjs';
import {amendmentListDocumentId,documentDetailEndpoint,documentRouteOwned,documentRouteBlocker,documentRouteDeferredOwners,sanitizeFreshDocument,validateAmendmentListMetadata} from './document-detail-routing.mjs';
import {reconcileAmendmentDocumentGaps,amendmentDocumentRouteRepairPending,amendmentDocumentRouteVerificationPending,scheduleAmendmentDocumentRouteVerification} from './document-route-recovery.mjs';
import {retryAfterSeconds} from './upstream-queue.mjs';
import { ActivityStore } from './activity-index-store.mjs';
import {declaredDebateRecoveryDue,scheduleDeclaredDebateRecovery,declaredDebateTask,declaredSpeechDetail} from './declared-debate-recovery.mjs';
import {activityGenerationTask} from './activity-generation-task.mjs';
import { array, tail, projectDocument, projectProcedure, documentRows, procedureIds, speechRows, CATEGORIES } from './activity-index-model.mjs';
import { HttpError } from './http-utils.mjs';
import {outsideSpeech,outsideAgenda} from './outside-model.mjs';
import {procedureClassification} from './procedure-types.mjs';
import {recordOutside,outsideAgendaUpgradeDue,initializeOutsideAgendaUpgrade} from './outside-store.mjs';

import { isMotion, motionSittings, motionSourceKey, projectMotionResults, projectMotionDecisions, motionVoteCoverage } from './motion-outcomes.mjs';
import { userAgent } from './user-agent.mjs';
import {loopTimer} from './sqlite-observability.mjs';
import {PressFollower,PressStore,leaseFencedWrite} from './press-releases.mjs';
import {scheduleMutable,scheduleGapRecovery,gapRecoveryDue,recordTaskGap,coverageGap,sittingConfirmationDay,sittingSnapshotConfirmed,documentRefreshState,feedStart,nextBackfillTask,nextRefreshTask} from './refresh-policy.mjs';
import {adoptedTextDiscoveryDue,scheduleAdoptedTexts,adoptedTextRecord,adoptedTextProjectionVersion,adoptedTextRepairDue,scheduleAdoptedTextRepairs,adoptedTextDeferredKeys,adoptedTextOwnedElsewhere,scheduleAdoptedFollowups,followupAdmissionRepairDue,scheduleFollowupAdmissionRepairs,markFollowupAdmissionRepair} from './adopted-text-index.mjs';

const DAY = 24*60*60_000;
const CONTINUATIONS_KEY='amendment:continuations',CONTINUATION_LIMIT=200;
const customFeeds=new Set(['/procedures','/adopted-texts']);
const day = t => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const hour = t => Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'}).format(new Date(t)));
const safeId = id => /^[A-Z0-9-]{1,100}$/.test(id);
function exactProcedure(record,id) {
  const identity=value=>typeof value==='string'?value.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null,expected='eli/dl/proc/'+id;
  const matches=record.payload.data.filter(work=>['id','@id'].some(key=>identity(work?.[key])===expected));
  const work=matches[0];
  if(matches.length!==1||identity(work.id)!==expected||Object.hasOwn(work,'@id')&&identity(work['@id'])!==expected||work.process_id!=null&&work.process_id!==''&&work.process_id!==id)throw new Error('Invalid or conflicting exact procedure metadata.');
  return matches[0];
}
export function speechWindows(until) {
  const windows=[];
  for(let year=2024,month=6;year*12+month<=Number(until.slice(0,4))*12+Number(until.slice(5,7))-1;month++) {
    if(month===12){year++;month=0;}
    const start=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
    if(start>until)break;
    const end=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
    windows.push({start,end:end>until?until:end});
  }
  return windows;
}
const collections = year => [
  ...Array.from({length:year-2024+1},(_,i)=>year-i).flatMap(y => [
    ...['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'].map(type=>({endpoint:'/plenary-documents',params:{year:y,'work-type':type}})),
    ...['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL'].map(type=>({endpoint:'/parliamentary-questions',params:{year:y,'work-type':type}})),
  ]),
  ...['OPINION_PARLIAMENTARY_COMMITTEE','OPINION_LETTER_PARLIAMENTARY_COMMITTEE'].map(type=>({endpoint:'/committee-documents',params:{'parliamentary-term':10,'work-type':type}})),
];
export function feedDocuments(xml,endpoint) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true) throw new Error('Invalid document update feed XML.');
  const root=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false}).parse(xml);
  if (!Object.hasOwn(root,'feed')) throw new Error('Expected an Atom update feed.');
  if(array(root.feed.link).some(link=>link['@_rel']==='next'))throw new Error('Update feed advertises another page; complete feed coverage is unavailable.');
  const entries=array(root.feed.entry);
  const result=entries.flatMap(e=> {
    const url=String(e.id || '');
    const match=endpoint==='/procedures' ? url.match(/^https:\/\/data\.europarl\.europa\.eu\/eli\/dl\/proc\/(\d{4}-\d{4}[A-Z]?)$/) : url.match(/^https:\/\/data\.europarl\.europa\.eu\/eli\/dl\/doc\/([A-Z0-9-]{1,100})$/);
    return match ? [{id:match[1],updated:e.updated || null}] : [];
  });
  if(entries.length && !result.length)throw new Error('Update feed entries contain no recognised API identifiers.');
  return result;
}
export async function apiFetch(endpoint,params={}, {xml=false,signal}={}) {
  const url=new URL(ODP_BASE+endpoint);
  for (const [key,value] of Object.entries({...params,...(!xml?{format:'application/ld+json'}:{})})) url.searchParams.set(key,String(value));
  return boundedUpstream(async()=> {
    const response=await observedOdpFetch(url,{headers:{Accept:xml?'application/atom+xml':'application/ld+json','User-Agent':userAgent('activity index')},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(45_000),...(signal?[signal]:[])])});
    if (response.status===204) return xml ? {xml:'<feed/>',fetchedAt:new Date().toISOString()} : {payload:{data:[]},fetchedAt:new Date().toISOString()};
    if (!response.ok) { await response.body?.cancel();const e=new Error(`EP API returned ${response.status} at ${endpoint}.`);e.status=response.status;const hint=response.headers.get('retry-after');e.retryAfter=hint?retryAfterSeconds(hint):0;if(response.status===429||response.status===503){e.retryAfter=retryAfterSeconds(hint);backoffUpstream(e.retryAfter);}throw e; }
    const contentType=response.headers.get('content-type') || '';
    if (!(xml?/xml/.test(contentType):/json/.test(contentType))) {await response.body?.cancel();throw new Error(`EP API returned unexpected ${contentType || 'missing content type'} at ${endpoint}.`);}
    const chunks=[];let bytes=0;
    for await (const chunk of response.body) {bytes+=chunk.length;if(bytes>12*1024*1024){await response.body.cancel().catch(()=>{});throw new Error('EP API response exceeded 12 MiB.');}chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');
    if (xml) return {xml:text,fetchedAt:new Date().toISOString()};
    const payload=JSON.parse(text);if(!Array.isArray(payload.data))throw new Error('EP API returned an invalid data array.');
    return {payload,fetchedAt:new Date().toISOString()};
  },{priority:'background',signal});
}
export class ActivityWorker {
  constructor(store,{runUpstream=boundedUpstream,fetchRecord=apiFetch,clock=Date.now,monotonic=()=>performance.now(),budget=1000,maxDuration=90*60_000,diskLimit=8192*1024*1024,downloadAmendmentDocx=amendmentDownloads.downloadDocxBuffer,downloadVotingXml=amendmentDownloads.downloadVotingXml,extractAmendmentList=amendmentDownloads.extractAmendmentList,press=null,recoveryMode='normal'}={}) {
    this.store=store;this.press=press;this.runUpstream=runUpstream;this.fetchRecord=fetchRecord;this.clock=clock;this.monotonic=monotonic;this.budget=budget;this.maxDuration=maxDuration;this.diskLimit=diskLimit;
    this.downloadAmendmentDocx=downloadAmendmentDocx;this.downloadVotingXml=downloadVotingXml;this.extractAmendmentList=extractAmendmentList;
    this.running=false;this.stopped=false;this.controller=new AbortController();this.requests=0;this.generationExecutor=null;
    if(!['normal','backfill'].includes(recoveryMode))throw new Error('Invalid ACTIVITY_INDEX_RECOVERY_MODE.');
    this.recoveryMode=recoveryMode;this.followupStartupRepair=true;this.amendmentRouteStartupRepair=true;
  }
  coreDue() { return Boolean(this.store.get('working') || !this.store.get('active') || this.store.motionClassificationPending(this.store.get('active')) || this.repairOnStartup&&(groupHistoryRepairDue(this.store)||adoptedTextDiscoveryDue(this.store,this.clock())||adoptedTextRepairDue(this.store,this.store.get('active'))) || day(Date.parse(this.store.get('lastSuccess')))!==day(this.clock()) && hour(this.clock())>=3); }
  due() {
    const active=this.store.get('active') || 0;
    const cycle=this.store.get('working'),generation=cycle?.generation || active;
    if(this.store.get('recoveryScheduleVersion')!==1||this.store.get('resourceIndexes')!==1||this.store.get('amendmentReadVersion')!==amendmentReadVersion)return true;
    if(!cycle&&this.coreDue())return true;
    if(cycle&&amendmentDocumentRouteRepairPending(this.store,generation))return true;
    if(declaredDebateRecoveryDue(this.store,generation))return true;
    if((gapRecoveryDue(this.store,generation,this.clock())||mutableRecoveryDue(this.store,generation,this.clock())||this.recoveryMode==='backfill'&&amendmentDocumentRouteVerificationPending(this.store,generation)))return true;
    if(followupAdmissionRepairDue(this.store,generation,{restart:this.followupStartupRepair}))return true;
    if(amendmentParserUpgradeDue(this.store,generation)||committeePreparationDue(this.store,generation))return true;
    if(cycle&&(!cycle.initialized||!cycle.reportJoinsReady||!cycle.procedureTitlesQueued||!cycle.procedureTypesQueued||
      cycle.motionOutcomesDay!==day(this.clock())||day(Date.parse(cycle.startedAt))!==day(this.clock())&&cycle.catchupDay!==day(this.clock())||
      !this.store.db.prepare('SELECT 1 FROM tasks INDEXED BY task_pending_due WHERE generation=? AND (done IN (-1,0) OR done IS NULL) LIMIT 1').get(generation)))return true;
    const checkpoint=this.store.source(generation,CONTINUATIONS_KEY)?.work;
    return Boolean(this.store.db.prepare('SELECT 1 FROM sitting_refresh WHERE generation=? AND next_check<=? LIMIT 1').get(generation,this.clock())) || outsideAgendaUpgradeDue(this.store,generation) || this.store.hasDueTask(generation) || Boolean(nextAmendmentTask(this.store,amendmentGeneration(this.store)) || groupVoiceWorkDue(this.store,generation) || checkpoint?.discovery?.length || checkpoint?.tasks?.some(task=>task.retry_at<=this.clock()));
  }
  checkpointContinuations(generation,{includeCore=true}={}) {
    this.store.transaction(()=>{
      this.store.assertWriter();
      // Legacy generations do not copy pending core tasks. Keep dependencies
      // created after publication with the optional jobs and their cursors.
      const saved=this.store.source(generation,CONTINUATIONS_KEY)?.work || {},today=day(this.clock());
      const progressed=task=>{
        const body=JSON.parse(task.body);
        return Boolean(task.attempts>0 || task.retry_at>0 || Number(body.offset)>0 || body.stage && body.stage!=='results' || ['results','decisions','splits','sources'].some(key=>body[key]?.length) || !['document','procedure','motion-outcomes'].includes(task.kind));
      };
      const pending=new Map([...(saved.tasks || []),...(saved.discovery || []).map(task=>({...task,body:JSON.stringify(task.kind==='motion-outcomes'?{sittingId:task.sittingId,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]}:{endpoint:task.endpoint,...(task.adoptedId!==undefined?{adoptedId:task.adoptedId}:{})}),attempts:0,retry_at:0,error:null}))].map(task=>[task.key,{...task,generation,done:0}]));
      for(const {key} of this.store.db.prepare('SELECT gap.key FROM refresh_gaps gap LEFT JOIN refresh_gap_admissions admitted ON admitted.generation=gap.generation AND admitted.key=gap.key WHERE gap.generation=? AND admitted.key IS NULL').all(generation))pending.delete(key);
      // Agenda verification stays in the durable canonical queue so its pending
      // coverage and recovery survive the bounded amendment continuation log.
      const incoming=includeCore?this.store.db.prepare(`SELECT * FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND key NOT LIKE 'outside:agenda-membership:%'
        ORDER BY (attempts>0 OR retry_at>0 OR COALESCE(json_extract(body,'$.offset'),0)>0 OR COALESCE(json_extract(body,'$.stage'),'results')<>'results' OR COALESCE(json_array_length(body,'$.results'),0)>0 OR COALESCE(json_array_length(body,'$.decisions'),0)>0 OR COALESCE(json_array_length(body,'$.splits'),0)>0 OR COALESCE(json_array_length(body,'$.sources'),0)>0 OR kind NOT IN ('document','procedure','motion-outcomes')) DESC,priority DESC,key
        LIMIT ?`).all(generation,2*CONTINUATION_LIMIT+1):[];
      const incomingTotal=includeCore?this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND key NOT LIKE 'outside:agenda-membership:%'").get(generation).n:0;
      const queued=new Map(this.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation).map(task=>[task.key,task]));
      const completed=new Map((saved.completed || []).filter(task=>task.key.includes(':'+today)).map(task=>[task.key,task]));
      for(const task of incoming)if(!pending.has(task.key))pending.set(task.key,{...task,done:0});
      for(const [key] of pending)if(queued.get(key)?.done===0)pending.delete(key);
      const reclaimable=task=>{
        const marker=amendmentCompletionMarker(task,today);return task.done===1&&(!marker||completed.has(marker.key)||completed.size<CONTINUATION_LIMIT);
      };
      const forget=task=>{
        const marker=amendmentCompletionMarker(task,today);if(marker)completed.set(marker.key,marker);
        this.store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,task.key);queued.delete(task.key);
      };
      const admit=this.store.db.prepare('INSERT OR REPLACE INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)');
      for(const task of [...pending.values()].sort((a,b)=>(a.retry_at>this.clock())-(b.retry_at>this.clock()) || b.priority-a.priority)) {
        if(queued.get(task.key)?.done===1){if(!reclaimable(queued.get(task.key)))continue;forget(queued.get(task.key));}
        if(queued.size>=200) {
          const reserve=[...pending.values()].filter(progressed).length-Number(progressed(task));
          const reclaim=[...queued.values()].find(reclaimable) || (task.retry_at<=this.clock() && reserve<CONTINUATION_LIMIT?[...queued.values()].find(row=>row.done===0&&row.retry_at>this.clock()):null);
          if(reclaim){if(reclaim.done===0)pending.set(reclaim.key,reclaim);forget(reclaim);}
        }
        if(queued.size>=200)continue;
        admit.run(generation,task.key,task.kind,task.body,task.priority,0,task.attempts,task.retry_at,task.error);
        queued.set(task.key,task);pending.delete(task.key);
      }
      const deferred=[...pending.values()].sort((a,b)=>Number(progressed(b))-Number(progressed(a)) || b.priority-a.priority);
      const snapshots=deferred.filter(progressed),untouched=deferred.filter(task=>!progressed(task));
      // Publication leaves no pending core tasks. After publication only
      // admitted optional jobs advance; newly created dependencies remain
      // untouched until this checkpoint admits them. The reserve above keeps
      // every displaced cursor within these 200 full snapshot slots.
      snapshots.push(...untouched.splice(0,CONTINUATION_LIMIT-snapshots.length));
      const discovery=untouched.splice(0,CONTINUATION_LIMIT).map(({key,kind,body,priority})=>({key,kind,...(kind==='motion-outcomes'?{sittingId:JSON.parse(body).sittingId}:{endpoint:JSON.parse(body).endpoint,...(JSON.parse(body).adoptedId!==undefined?{adoptedId:JSON.parse(body).adoptedId}:{})}),priority})),overflow=untouched;
      const deferredCount=overflow.length+incomingTotal-incoming.length;
      const capacityGap=deferredCount?{count:(saved.capacityGap?.count || 0)+deferredCount,message:'Additional untouched amendment discovery exceeded the bounded checkpoint and is deferred to normal catalogue refresh.'}:saved.capacityGap || null;
      if(deferredCount)invalidateAmendmentLinks(this.store,generation);
      if(includeCore&&deferredCount&&this.store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND key GLOB '/external-documents/SP-*' AND (done IN (-1,0) OR done IS NULL) LIMIT 1").get(generation))markFollowupAdmissionRepair(this.store,generation);
      if(snapshots.length || discovery.length || completed.size || capacityGap)this.store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,CONTINUATIONS_KEY,'amendment-continuations',JSON.stringify({tasks:snapshots,discovery,completed:[...completed.values()].slice(-CONTINUATION_LIMIT),...(capacityGap?{capacityGap}:{})}),new Date(this.clock()).toISOString());
      else this.store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(generation,CONTINUATIONS_KEY);
      if(includeCore)this.store.db.prepare("DELETE FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND key NOT LIKE 'outside:agenda-membership:%'").run(generation);
    });
  }
  async request(endpoint,params={},opts={}) {
    this.store.assertWriter();this.requests++;
    const cycle=this.store.get('working');if(cycle)this.store.updateCycle({requests:(cycle.requests||0)+1});
    const demographicId=endpoint.match(/^\/meps\/([1-9]\d*)$/)?.[1];
    const generation=cycle?.generation||this.store.get('active');
    const currentRoster=endpoint==='/meps/show-current'&&!params['mandate-date'];
    const url=new URL(ODP_BASE+endpoint);
    for(const [key,value]of Object.entries({...params,...(!opts.xml?{format:'application/ld+json'}:{})}))url.searchParams.set(key,String(value));
    let record;
    try {record=await this.fetchRecord(endpoint,params,{...opts,signal:this.controller.signal});}
    catch(error) {
      if(generation&&!this.controller.signal.aborted) {
        if(demographicId)retainDemographicAttempt(this.store,generation,demographicId,{url:url.href});
        if(currentRoster)retainRosterAttempt(this.store,generation,{url:url.href,status:'fetch_failed'});
      }
      throw error;
    }
    const observed={...record,url:url.href};
    if(generation&&demographicId) {
      try {retainDemographicRecord(this.store,generation,demographicId,observed);}
      catch(error) {retainDemographicAttempt(this.store,generation,demographicId);throw error;}
    }
    if(generation&&currentRoster)retainRosterAttempt(this.store,generation,{url:url.href,status:'success',at:typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt});
    if(generation&&currentRoster)for(const person of record.payload?.data||[]) {
      const id=String(person.identifier||String(person.id||'').split('/').at(-1));
      if(demographicPerson(person,id))retainDemographicRecord(this.store,generation,id,{...observed,payload:{data:[person]}},{kind:'roster'});
    }
    return observed;
  }
  async initialize(cycle) {
    const {generation}=cycle;
    const last=this.store.get('lastSuccess');
    // Initial discovery and a missed fixed monthly feed window need catalogue
    // IDs only. Existing detail records are never blanket-refreshed.
    if(cycle.initial)for (const collection of collections(new Date(this.clock()).getUTCFullYear())) this.store.enqueue(generation,'catalog:'+collection.endpoint+':'+JSON.stringify(collection.params),'catalog',{...collection,offset:0,deltaOnly:true},100);
    const base={'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','sort-by':'sitting-date:desc,numbering:desc'};
    const windows=cycle.initial?speechWindows(day(this.clock())):[{start:day(Date.parse(last)-2*DAY),end:day(this.clock())}];
    for(const range of windows)this.store.enqueue(generation,'catalog:/speeches:'+range.start+':'+range.end,'speeches',{endpoint:'/speeches',params:{...base,'sitting-date':range.start,'sitting-date-end':range.end},offset:0},100);
    scheduleMembership(this.store,generation);
    this.store.enqueue(generation,'roster','roster',{offset:0,nodes:[]},110);
    if(!cycle.initial)this.enqueueFeeds(generation,'feed:',last);
    this.store.updateCycle({initialized:true,fullRefresh:false});
  }
  enqueueFeeds(generation,prefix,since) {
    const start=day(Date.parse(since)-2*DAY);
    for(const endpoint of ['/plenary-documents','/committee-documents','/parliamentary-questions','/procedures','/adopted-texts']) {
      // A partially published cycle advances lastSuccess, not a failed feed's
      // coverage cursor. Its saved task owns that interval until recovery.
      const saved=this.store.db.prepare("SELECT body FROM refresh_gaps WHERE generation=? AND kind='feed' AND json_extract(body,'$.endpoint')=? LIMIT 1").get(generation,endpoint) ||
        this.store.db.prepare("SELECT body FROM tasks WHERE generation=? AND kind='feed' AND json_extract(body,'$.endpoint')=? AND (done IN (-1,0) OR done IS NULL) LIMIT 1").get(generation,endpoint);
      const earliest=saved?JSON.parse(saved.body).start || feedStart(this.store,this.clock()):start;
      // Catalogue discovery is independent of feed availability and retry due
      // dates. A failed feed must not hide IDs after its window has expired.
      if(!customFeeds.has(endpoint) && Date.parse(earliest)<this.clock()-28*DAY)this.recoverFeedWindow(generation,endpoint,earliest);
      if(saved)continue;
      this.store.enqueue(generation,prefix+endpoint,'feed',{endpoint,start},105);
    }
  }
  recoverFeedWindow(generation,endpoint,start) {
    const end=day(this.clock()-28*DAY);
    coverageGap(this.store,generation,'feed-window:'+endpoint,{endpoint,start,end},'The fixed monthly feed cannot establish updates across this earlier interval; retained records are checked by the bounded mutable-record queue.',this.clock());
    // The public window gap remains unresolved even after ID discovery. Track
    // scheduled catalogue recovery separately so a later outage gets its own
    // durable cursors while repeated reads of one interval remain coalesced.
    const prior=this.store.db.prepare('SELECT end FROM feed_catalog_recovery WHERE generation=? AND endpoint=? AND start=?').get(generation,endpoint,start);
    if(prior?.end>=end)return;
    for(const collection of collections(new Date(this.clock()).getUTCFullYear()).filter(collection=>collection.endpoint===endpoint))this.store.enqueue(generation,'gap-catalog:'+endpoint+':'+start+':'+end+':'+JSON.stringify(collection.params),'catalog',{...collection,offset:0,deltaOnly:true,feedRecovery:{start,end}},100);
    this.store.db.prepare('INSERT INTO feed_catalog_recovery VALUES (?,?,?,?) ON CONFLICT(generation,endpoint,start) DO UPDATE SET end=excluded.end').run(generation,endpoint,start,end);
  }
  async task(task) {
    const {generation,body}=task;
    if(task.kind==='debate-links'||task.kind==='declared-event') {
      await declaredDebateTask(this,task);
    } else if(task.kind.startsWith('group-history-')) {
      await groupHistoryTask(this,task);
    } else if(task.kind==='membership') {
      await membershipTask(this,task);
    } else if(task.kind.startsWith('amendment-')) {
      await amendmentTask(this,task);
    } else if(task.kind.startsWith('outside-')) {
      await this.outsideTask(task);
    } else if(task.kind==='roster') {
      const r=await this.request('/meps/show-current',{limit:1000,offset:body.offset});
      const nodes=r.payload.data.flatMap(p=>{const id=String(p.identifier || tail(p.id));return /^[1-9]\d*$/.test(id)?[{id,name:p.label || [p.givenName,p.familyName].filter(Boolean).join(' '),nameVariants:personNameVariants(p)}]:[];});
      if(nodes.length) {
        const prior=new Set(body.nodes.map(n=>n.id));if(nodes.some(n=>prior.has(n.id)))throw new Error('EP roster pagination repeated a member.');
        this.store.taskProgress(task,{nodes:[...body.nodes,...nodes],offset:body.offset+r.payload.data.length});
      } else {if(!body.nodes.length)throw new Error('Current MEP roster was empty.');this.store.setMembers(body.nodes);this.store.finishTask(task);}
    } else if(task.kind==='catalog') {
      const r=await this.request(body.endpoint,{...body.params,limit:250,offset:body.offset});
      const nodes=r.payload.data;
      const availabilityCheck=cataloguePage(body,r,{sourceKey:body.endpoint,endpoint:body.endpoint,params:{...body.params,limit:250,offset:body.offset},acquisition:acquisitionMode(this.store,task),complete:!nodes.length});
      if(!nodes.length){this.store.finishTask({...task,body:{...body,availabilityCheck}});return;}
      const signatures=nodes.map(w=>w.identifier || tail(w.id)).join('|');
      if(signatures===body.lastPage)throw new Error('EP document pagination repeated a page.');
      const adoptedDeferred=body.endpoint==='/adopted-texts'?adoptedTextDeferredKeys(this.store,generation):null;let documentDeferred;
      for(const w of nodes){const id=w.identifier || tail(w.id);if(!safeId(id))throw new Error('EP document identifier was invalid.');
        if(body.endpoint!='/committee-documents' && !/^[A-Z]+-10-/.test(id))continue;
        const endpoint=documentDetailEndpoint(body.endpoint+'/'+id), old=this.store.source(generation,endpoint);
        if(amendmentListDocumentId(endpoint)&&documentRouteOwned(this.store,generation,endpoint,documentDeferred??=documentRouteDeferredOwners(this.store,generation)))continue;
        this.store.markSeen(generation,endpoint);
        // Existing adopted records use the bounded repair path, never catalogue
        // fan-out. New IDs can also already have an optional/deferred owner.
        if(!old&&!(adoptedDeferred&&adoptedTextOwnedElsewhere(this.store,generation,endpoint,adoptedDeferred)))this.store.enqueue(generation,endpoint,'document',{endpoint},101,Boolean(adoptedDeferred));
      }
      this.store.taskProgress(task,{...body,offset:body.offset+nodes.length,lastPage:signatures,availabilityCheck});
    } else if(task.kind==='speeches' && body.recoveryId) {
      if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(body.recoveryId))throw new Error('Invalid speech recovery identifier.');
      const r=await this.request('/speeches/'+body.recoveryId);
      this.controller.signal.throwIfAborted();this.store.assertWriter();
      const activity=body.declaredParent!==undefined?declaredSpeechDetail(r,body.recoveryId,body.declaredParent,this.clock()):r.payload.data.find(node=>node.activity_id===body.recoveryId);
      if(!activity)throw new Error(`Published speech ${body.recoveryId} has no matching detail record.`);
      this.saveSpeech(generation,activity,r.fetchedAt,body.outsideOnly,r.url,task.groupVoiceJob,{acquisition:acquisitionMode(this.store,task),declaredParent:body.declaredParent});
      this.store.finishTask(task);
    } else if(task.kind==='speeches') {
      const r=await this.request('/speeches',{...body.params,limit:250,offset:body.offset});
      this.controller.signal.throwIfAborted();this.store.assertWriter();
      // The search total saturates at 10,000. Partition the date window before
      // paging so a full term cannot be mistaken for a truncated search result.
      if(body.offset===0 && Number(r.payload.meta?.total)>=10000) {
        const start=Date.parse(body.params['sitting-date']),end=Date.parse(body.params['sitting-date-end']);
        if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('Speech search exceeds its result window in a single sitting day.');
        const middle=start+Math.floor((end-start)/DAY/2)*DAY;
        for(const [a,b] of [[start,middle],[middle+DAY,end]]) {
          const params={...body.params,'sitting-date':new Date(a).toISOString().slice(0,10),'sitting-date-end':new Date(b).toISOString().slice(0,10)};
          if(task.groupVoiceJob)enqueueGroupVoice(this.store,generation,groupVoiceJobKey('catalog',params['sitting-date']+':'+params['sitting-date-end']),{endpoint:'/speeches',params,offset:0});
          else this.store.enqueue(generation,(body.outsideOnly?'outside:catalog:':'catalog:/speeches:')+params['sitting-date']+':'+params['sitting-date-end'],'speeches',{endpoint:'/speeches',params,offset:0,outsideOnly:body.outsideOnly || false},100);
        }
        this.store.finishTask(task);return;
      }
      const hits=r.payload.searchResults?.hits;
      const graph=new Map(r.payload.data.map(node=>[node.id,node]));
      const matched=hits ? hits.map(hit=>({hit,node:graph.get(hit.id)})) : r.payload.data.filter(node=>node.activity_id).map(node=>({hit:{id:node.id},node}));
      const missing=matched.filter(({node})=>!node?.activity_id);
      // EP can return 250 search references but only 249 graph nodes. Preserve
      // every missing reference as a durable detail retry; never drop it or
      // block the 249 available records behind the same failing list page.
      for(const {hit} of missing) {
        const id=tail(hit.id);
        if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(id))throw new Error('Speech search hit has an invalid recovery identifier.');
        const sitting=id.slice(7,17);
        const recovery={
          recoveryId:id,outsideOnly:body.outsideOnly || false,detectedAt:r.fetchedAt,searchHit:hit.id,searchWindow:{start:body.params['sitting-date'],end:body.params['sitting-date-end'],offset:body.offset},
          // Keep the existing task kind and a valid day window for safe old-image
          // rollback: old code continues strict list validation, never marks an
          // unavailable reference as a completed document.
          params:{...body.params,'sitting-date':sitting,'sitting-date-end':sitting},offset:0,
        };
        if(task.groupVoiceJob)enqueueGroupVoice(this.store,generation,groupVoiceJobKey('recovery',id),recovery,21);
        else this.store.enqueue(generation,'recovery:/speeches/'+id,'speeches',recovery,103);
      }
      const nodes=matched.filter(({node})=>node?.activity_id).map(({node})=>node);
      const hitCount=hits?.length ?? nodes.length;
      const availabilityCheck=cataloguePage(body,r,{sourceKey:'speech-metadata',endpoint:'/speeches',params:{...body.params,limit:250,offset:body.offset},start:body.params['sitting-date'],end:body.params['sitting-date-end'],acquisition:acquisitionMode(this.store,task),complete:!hitCount});
      if(!hitCount){this.store.finishTask({...task,body:{...body,availabilityCheck}});return;}
      const signatures=(hits ? hits.map(hit=>hit.id) : nodes.map(a=>a.activity_id)).sort().join('|');
      if(signatures===body.lastPage)throw new Error('EP speech pagination repeated a page.');
      for(const activity of nodes){if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(activity.activity_id))throw new Error('EP speech identifier was invalid.');
        this.saveSpeech(generation,activity,r.fetchedAt,body.outsideOnly,r.url,task.groupVoiceJob,{acquisition:acquisitionMode(this.store,task)});}
      this.store.taskProgress(task,{...body,offset:body.offset+hitCount,lastPage:signatures,availabilityCheck});
    } else if(task.kind==='feed') {
      if(!body.start) {
        body.start=feedStart(this.store,this.clock());
        this.store.taskProgress(task,body);
      }
      const start=body.start;
      // Recovery must survive HTTP failures and malformed feed responses too.
      if(!customFeeds.has(body.endpoint) && Date.parse(start)<this.clock()-28*DAY)this.recoverFeedWindow(generation,body.endpoint,start);
      const r=await this.request(body.endpoint+'/feed',customFeeds.has(body.endpoint)?{timeframe:'custom','start-date':start}:{},{xml:true});
      const entries=feedDocuments(r.xml,body.endpoint);
      const adoptedDeferred=body.endpoint==='/adopted-texts'?adoptedTextDeferredKeys(this.store,generation):null;let documentDeferred;
      for(const e of entries){
        if(e.updated && Date.parse(e.updated)<Date.parse(start))continue;
        const endpoint=body.endpoint+'/'+e.id;
        if(body.endpoint==='/procedures') {
          const prior=this.store.source(generation,endpoint);
          if(prior && !(e.updated && Date.parse(prior.fetchedAt)>=Date.parse(e.updated)))this.store.enqueue(generation,endpoint,'procedure',{endpoint},103,true);
        } else if (body.endpoint==='/committee-documents' || /^[A-Z]+-10-/.test(e.id)) {
          // Answer feed IDs resolve through their parent question, never a guessed standalone answer endpoint.
          const resolved=documentDetailEndpoint(endpoint.replace(/-ASW$/,''));
          if(amendmentListDocumentId(resolved)&&documentRouteOwned(this.store,generation,resolved,documentDeferred??=documentRouteDeferredOwners(this.store,generation)))continue;
          if(adoptedDeferred&&adoptedTextOwnedElsewhere(this.store,generation,resolved,adoptedDeferred))continue;
          const prior=this.store.source(generation,resolved);
          const gap=this.store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,resolved);
          if(!gap && (!prior || (body.endpoint==='/adopted-texts'||amendmentListDocumentId(resolved)||documentRefreshState(prior.work).mutable) && !(e.updated && Date.parse(prior.fetchedAt)>=Date.parse(e.updated))))this.store.enqueue(generation,resolved,'document',{endpoint:resolved,feedDiscovery:!prior},85,true);
        }
      }
      this.store.finishTask(task);
    } else if(task.kind==='document'&&body.endpoint.startsWith('/external-documents/')) {
      const id=body.endpoint.slice('/external-documents/'.length),prior=this.store.source(generation,body.endpoint);
      const adoptedId=body.adoptedId||prior?.work.followupOf;
      if(spId('eli/dl/doc/'+id)!==id||!/^TA-10-\d{4}-\d{4,6}$/.test(adoptedId||''))throw new Error('Invalid follow-up task identity.');
      const r=await this.request(body.endpoint);let work;
      try{work=validateReply(r.payload,id,adoptedId);}catch(error){throw Object.assign(new Error('Invalid exact Commission follow-up identity, target or creator.'),{code:error.code,cause:error});}
      this.store.putSource(generation,body.endpoint,'document',projectFollowup(work,adoptedId),r.fetchedAt,[],{acquisition:acquisitionMode(this.store,task),sourceUrl:r.url});
      this.store.finishTask(task);
    } else if(task.kind==='document') {
      if(body.stage==='followups'&&body.endpoint.startsWith('/adopted-texts/')) {
        const saved=this.store.source(generation,body.endpoint);
        if(saved?.work.adoptionProjectionVersion===adoptedTextProjectionVersion) {
          adoptedTextRecord(body.endpoint,[saved.work]);validateTA({data:[saved.work]},saved.work.identifier);
          const next=scheduleAdoptedFollowups(this,task,saved.work);
          if(next)this.store.taskProgress(task,next);else this.store.finishTask(task);
          return;
        }
      }
      const endpoint=documentDetailEndpoint(body.endpoint),listId=amendmentListDocumentId(endpoint);
      if(listId&&body.endpoint!==endpoint) {
        const blocker=documentRouteBlocker(this.store,generation,endpoint,undefined,{ignoreGapKey:task.key,executingTask:task,allowDueGaps:true,now:this.clock()});
        if(blocker) {
          this.store.assertWriter();
          this.store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET retry_at=MAX(retry_at,?) WHERE generation=? AND key=?`).run(Math.max(this.clock()+30_000,blocker.retryAt||0),generation,task.key);
          return;
        }
      }
      const requestedAt=this.clock(),r=await this.request(endpoint),adopted=endpoint.startsWith('/adopted-texts/');
      const work=adopted?adoptedTextRecord(endpoint,r.payload.data):listId?validateAmendmentListMetadata(r.payload,listId):r.payload.data.find(w=>w.type==='Work') || r.payload.data[0];
      if(!work)throw new Error('EP document detail was empty.');
      if(committeeDraftId(tail(endpoint))&&(!validCommitteeWork(work)||work.identifier!==tail(endpoint)))throw new Error('Invalid or conflicting exact committee draft metadata.');
      if(body.amendmentRouteVerification) {
        const proof=body.amendmentRouteVerification,at=Date.parse(r.fetchedAt),failed=Date.parse(proof.previousFailure?.failedAt);
        if(!listId||proof.version!==1||proof.endpoint!==endpoint||proof.previousFailure?.endpoint!==task.key||body.endpoint!==task.key||proof.previousFailure.status!==404||r.stale||!Number.isFinite(at)||!Number.isFinite(failed)||at<requestedAt||at<=failed||at>this.clock())throw new Error('Corrected amendment route did not return fresh exact metadata.');
      }
      if(body.feedDiscovery && !['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT','QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL','OPINION_PARLIAMENTARY_COMMITTEE','OPINION_LETTER_PARLIAMENTARY_COMMITTEE','REPORT_PARLIAMENTARY_COMMITTEE_DRAFT','OPINION_PARLIAMENTARY_COMMITTEE_DRAFT','TEXT_ADOPTED',...(listId?['AMENDMENT_LIST']:[])].includes(tail(work.work_type))){this.store.finishTask(task);return;}
      const projected=projectDocument(sanitizeFreshDocument(work)), proc=new Map();
      if(validCommitteeWork(projected))projected.committeeProjectionVersion=1;
      if(adopted){
        validateTA({data:[work]},work.identifier);projected.adoptionProjectionVersion=adoptedTextProjectionVersion;
        if(Object.hasOwn(work,'inverse_answers_to'))projected.followupRelationships=projectFollowupReferences(work.inverse_answers_to);
        // TA replies are SP references, not embedded written-question answers.
        projected.inverse_answers_to=[];
      }
      if(listId)projected.inverse_answers_to=[];
      for(const id of procedureIds(work)) {
        const endpoint='/procedures/'+id, existing=this.store.source(generation,endpoint);
        if(existing)proc.set(id,existing);
        if(tail(work.work_type)==='REPORT_PLENARY')this.store.enqueue(generation,endpoint,'procedure',{endpoint},103,true);
      }
      const {rows}=documentRows(projected,endpoint,r.fetchedAt,proc);
      this.store.putSource(generation,endpoint,'document',projected,r.fetchedAt,rows,{acquisition:acquisitionMode(this.store,task),sourceUrl:r.url});
      const followups=adopted?scheduleAdoptedFollowups(this,task,projected):null;
      if(followups)this.store.taskProgress(task,followups);else this.store.finishTask(task);
      if(isMotion(projected))this.scheduleMotionOutcomes(generation,projected);
      scheduleAmendments(this,generation,projected,r.fetchedAt,endpoint);
      scheduleCommitteeDiscovery(this,generation,projected,r.fetchedAt,endpoint);
      prepareCommitteeList(this,generation,projected,r.fetchedAt,endpoint,{rebuild:rebuildAmendmentTarget});
    } else if(task.kind==='motion-outcomes') {
      await this.loadMotionOutcomes(task);
    } else if(task.kind==='procedure') {
      const r=await this.request(body.endpoint);this.controller.signal.throwIfAborted();
      const work=exactProcedure(r,tail(body.endpoint));
      const projected=projectProcedure(work);
      this.store.putSource(generation,body.endpoint,'procedure',projected,r.fetchedAt);
      const id=tail(body.endpoint);
      if(this.store.source(generation,'outside:procedure:'+id))this.saveOutsideProcedure(generation,id,work,r.fetchedAt);
      scheduleCommitteeDiscovery(this,generation,projected,r.fetchedAt,body.endpoint);
      if(this.store.get('working')?.generation===generation)this.store.enqueue(generation,'debate-links:'+body.endpoint,'debate-links',{endpoint:body.endpoint,offset:0},102,true);
      // Make verified report roles usable during the initial partial load; an
      // unrelated missing speech must not postpone an already supported join.
      this.refreshReportJoins(generation,tail(body.endpoint));
      this.store.finishTask(task);
    }
  }
  saveSpeech(generation,activity,fetchedAt,outsideOnly=false,queryUrl=null,groupVoiceOnly=false,{acquisition='unknown',declaredParent=null}={}) {
    const key='/speeches/'+activity.activity_id;
    const retained=this.store.source(generation,key)?.work;
    // The declaration comes from the separately observed debate. An ordinary
    // catalogue refresh does not erase it or invent an omitted reverse edge.
    declaredParent=declaredParent??retained?.declaredParent??null;
    let outside=outsideSpeech(activity,fetchedAt,queryUrl);
    const previous=retained?.outside;
    if(outside && previous) {
      outside={...outside,titles:{...previous.titles,...outside.titles},...(outside.headerChecked?{source:previous.source}:{} )};
    }
    // A metadata-only weekly refresh must retain a previously checked header.
    if(outside && previous?.headerChecked && (!outside.headerChecked || previous.headers.some(header=>header.name)&&!outside.headers.some(header=>header.name))) outside={...outside,headers:previous.headers,headerChecked:true,headerSource:previous.headerSource || previous.source};
    if(outside?.headerChecked && !outside.headerSource)outside.headerSource={url:queryUrl || ODP_BASE+key+'?format=application%2Fld%2Bjson',fetchedAt};
    if(groupVoiceOnly){this.store.transaction(()=>{
      this.store.assertWriter();
      const existed=Boolean(this.store.db.prepare('SELECT 1 FROM group_voice_observations WHERE generation=? AND speech=?').get(generation,activity.activity_id));
      recordGroupVoice(this.store,generation,groupVoiceProjection(activity,{fetchedAt,url:queryUrl}),outside,activity.activity_id);
      observeSource(this.store,{sourceId:activity.activity_id,family:'speeches',subtype:tail(activity.had_activity_type),date:activity.activity_date,fetchedAt,url:queryUrl,acquisition,existed});
      finishAvailabilityWrite(this.store);
    });return;}
    this.store.putSource(generation,key,outsideOnly?'outside-speech':'speech',{id:activity.activity_id,date:activity.activity_date,kind:tail(activity.had_activity_type),...(declaredParent?{declaredParent}:{}),...(activity.inverse_consists_of!==undefined?{inverse_consists_of:activity.inverse_consists_of}:{}),...(outside?{outside}:{}),groupVoices:groupVoiceProjection(activity,{fetchedAt,url:queryUrl})},fetchedAt,outsideOnly?[]:speechRows(activity,fetchedAt),{acquisition,sourceUrl:queryUrl});
    recordOutside(this.store,generation,outside);
    if(outsideOnly && outside && this.store.source(generation,'outside:roster:'+outside.date) && !this.store.db.prepare('SELECT 1 FROM outside_contributions WHERE generation=? AND speech=? LIMIT 1').get(generation,outside.id))this.store.db.prepare("DELETE FROM sources WHERE generation=? AND key=? AND kind='outside-speech'").run(generation,key);
  }
  initializeOutside(cycle) {
    const {generation}=cycle;
    for(const source of this.store.iterateSources(generation,'outside-gap')) {
      const gap=source.work;
      this.store.enqueue(generation,gap.taskKey,gap.taskKind,gap.taskBody,gap.priority || 50);
    }
    if(this.store.source(generation,'outside:state'))return;
    const upgrade=Boolean(this.store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND kind='speech' AND json_extract(body,'$.outside') IS NULL LIMIT 1").get(generation));
    // Re-read compact speech metadata once when upgrading an older index. The
    // normal current-term catalog is shared, never a second source writer.
    for(const range of speechWindows(day(this.clock()))) {
      const key=(upgrade?'outside:upgrade:':'catalog:/speeches:')+range.start+':'+range.end;
      const params={'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','sort-by':'sitting-date:desc,numbering:desc','sitting-date':range.start,'sitting-date-end':range.end};
      this.store.enqueue(generation,key,'speeches',{endpoint:'/speeches',params,offset:0},100);
    }
    for(let year=2019,month=6;year<2024 || year===2024&&month<=6;month++) {
      if(month===12){year++;month=0;}
      const start=year===2019&&month===6?'2019-07-02':new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
      const end=year===2024&&month===6?'2024-07-15':new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
      const params={'parliamentary-term':9,'activity-type':'PLENARY_DEBATE_SPEECH','sort-by':'sitting-date:desc,numbering:desc','sitting-date':start,'sitting-date-end':end};
      this.store.enqueue(generation,'outside:catalog:'+start+':'+end,'speeches',{endpoint:'/speeches',params,offset:0,outsideOnly:true},50);
    }
    this.store.putSource(generation,'outside:state','outside-state',{version:1,terms:[9,10]},new Date(this.clock()).toISOString());
  }
  saveOutsideProcedure(generation,id,work,fetchedAt) {
    this.controller.signal.throwIfAborted();
    const classification=procedureClassification(work);
    const typeDeclarations=Object.fromEntries(['process_type','procedure_type','had_procedure_type'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]]));
    this.store.putSource(generation,'outside:procedure:'+id,'outside-procedure',{
      id,type:classification.code,typeStatus:classification.status,typeDeclarations,label:work.label??null,
      source:{url:ODP_BASE+'/procedures/'+id+'?format=application%2Fld%2Bjson',fetchedAt},
    },fetchedAt);
  }
  async outsideTask(task) {
    const {generation,body}=task;
    if(task.kind==='outside-roster') {
      const params={'mandate-date':body.date,limit:1000,offset:body.offset};
      const r=await this.request('/meps/show-current',params);
      const ids=r.payload.data.map(person=>String(person.identifier || tail(person.id))).filter(id=>/^[1-9]\d*$/.test(id));
      if(ids.some(id=>body.ids.includes(id)))throw new Error('Dated MEP roster repeated a member.');
      const url=new URL(ODP_BASE+'/meps/show-current');for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
      const sources=[...body.sources,{url:url.href,fetchedAt:r.fetchedAt}];
      if(r.payload.data.length) {
        if(ids.length!==r.payload.data.length)throw new Error('Dated MEP roster contains an invalid identity.');
        this.store.taskProgress(task,{...body,ids:[...body.ids,...ids],sources,offset:body.offset+r.payload.data.length});
        return;
      }
      if(!body.ids.length)throw new Error('Dated MEP roster is unavailable.');
      this.store.putSource(generation,'outside:roster:'+body.date,'outside-roster',{date:body.date,ids:body.ids,sources},r.fetchedAt);
      for(const source of this.store.db.prepare("SELECT key,kind,body FROM sources WHERE generation=? AND kind IN ('speech','outside-speech') AND json_extract(body,'$.outside.date')=?").all(generation,body.date)) {
        const speech=JSON.parse(source.body).outside;recordOutside(this.store,generation,speech);
        if(source.kind==='outside-speech' && !this.store.db.prepare('SELECT 1 FROM outside_contributions WHERE generation=? AND speech=? LIMIT 1').get(generation,speech.id))this.store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(generation,source.key);
      }
    } else if(task.kind==='outside-detail') {
      const endpoint='/speeches/'+body.id;
      const params={'include-output':'xml_fragment',language:body.language || 'mul'};
      const r=await this.request(endpoint,params);
      const activity=r.payload.data.find(node=>node.activity_id===body.id);
      if(!activity)throw new Error('Outside speech detail has no matching record.');
      const url=new URL(ODP_BASE+endpoint);for(const [key,value]of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
      const existing=this.store.source(generation,endpoint);
      this.saveSpeech(generation,activity,r.fetchedAt,existing?.work.outside?.term===9,url.href,false,{acquisition:acquisitionMode(this.store,task)});
      const unnamed=this.store.db.prepare("SELECT person FROM outside_contributions WHERE generation=? AND speech=? AND json_extract(body,'$.header.name') IS NULL").all(generation,body.id).map(row=>row.person);
      if(unnamed.length) {
        if(!body.language)this.store.enqueue(generation,'outside:english:'+body.id,'outside-detail',{id:body.id,language:'en'},102);
        else throw new Error('Outside speech header has no usable name for '+unnamed.map(id=>'person/'+id).join(', ')+'.');
      }
    } else if(task.kind==='outside-agenda') {
      const endpoint='/events/'+body.id;
      const r=await this.request(endpoint);
      const activity=r.payload.data.find(node=>node.activity_id===body.id);
      const agenda=outsideAgenda(activity,r.fetchedAt,ODP_BASE+endpoint+'?format=application%2Fld%2Bjson');
      if(!agenda)throw new Error('Outside speech parent has no matching activity.');
      this.store.putSource(generation,'outside:agenda:'+body.id,'outside-agenda',agenda,r.fetchedAt);
      for(const id of agenda.procedureIds)if(!this.store.source(generation,'outside:procedure:'+id))this.store.enqueue(generation,'outside:procedure:'+id,'outside-procedure',{id},101);
    } else if(task.kind==='outside-procedure') {
      const endpoint='/procedures/'+body.id;
      const r=await this.request(endpoint);
      this.controller.signal.throwIfAborted();
      const work=exactProcedure(r,body.id);
      this.saveOutsideProcedure(generation,body.id,work,r.fetchedAt);
    } else throw new Error('Unknown outside-speaker task.');
    this.store.finishTask(task);
  }
  finishOutsideGap(task) {
    this.store.transaction(()=>{
      this.store.assertWriter();
      const removed=this.store.db.prepare("DELETE FROM sources WHERE generation=? AND key=? AND kind='outside-gap'").run(task.generation,'outside:gap:'+task.key).changes;
      if(removed)finishAvailabilityWrite(this.store);
    });
  }
  failOutside(task,error) {
    const optional=task.kind.startsWith('outside-') || task.body.outsideOnly || task.key.startsWith('outside:upgrade:');
    if(!optional || task.attempts<2)return false;
    // Optional historical/header context cannot permanently hold back publication
    // of ordinary MEP activity updates. Keep the gap and retry next generation.
    this.store.putSource(task.generation,'outside:gap:'+task.key,'outside-gap',{
      taskKey:task.key,taskKind:task.kind,taskBody:task.body,priority:task.priority,
      error:String(error.message).slice(0,350),attempts:task.attempts+1,failedAt:new Date(this.clock()).toISOString(),
    },new Date(this.clock()).toISOString());
    this.store.finishTask(task);
    if(task.kind==='outside-detail'&&!task.body.language)this.store.enqueue(task.generation,'outside:english:'+task.body.id,'outside-detail',{id:task.body.id,language:'en'},102);
    return true;
  }

  scheduleMotionOutcomes(generation,work) {
    for(const sittingId of motionSittings(work))scheduleSittingOutcomes(this,generation,sittingId,{priority:102});
  }
  prepareMotionOutcomes(generation) {
    for(const source of this.store.motionDocuments(generation)) {
      // Older projections omitted the exact vote and joint-motion relationships.
      // Upgrade retained motions through the same writer and durable request queue.
      const recentUnlinked=!motionSittings(source.work).length && this.clock()-Date.parse(source.work.document_date)<45*DAY && this.clock()-Date.parse(source.fetchedAt)>=DAY;
      if(source.work.motionLinksVersion!==1 || recentUnlinked)this.store.enqueue(generation,source.key,'document',{endpoint:source.key},101,true);
      else this.scheduleMotionOutcomes(generation,source.work);
    }
  }
  deferMotionRebuild(task,body) {
    this.store.assertWriter();
    // A full amendment queue must run before this higher-priority dependency
    // retries admission. Keep its graph and retry history without recording an
    // upstream failure or expanding either queue's capacity.
    this.store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET body=?,retry_at=MAX(retry_at,?) WHERE generation=? AND key=?`).run(JSON.stringify({...body,amendmentRebuildPending:true}),this.clock()+30_000,task.generation,task.key);
  }
  async loadMotionOutcomes(task) {
    const {generation,body}=task;
    if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(body.sittingId))throw new Error('Invalid motion sitting identifier.');
    if(body.amendmentRebuildPending) {
      const saved=this.store.source(generation,motionSourceKey(body.sittingId));
      if(!saved)throw new Error('Saved vote results are unavailable for amendment rebuilding.');
      if(await refreshSittingTargets(this,generation,body.sittingId,saved.work))this.store.finishTask(task);
      else this.deferMotionRebuild(task,body);
      return;
    }
    const collection=body.stage==='results'?'vote-results':'decisions';
    const endpoint='/meetings/'+body.sittingId+'/'+collection;
    // Include show-of-hands and electronic votes, and retain outcomes without tallies.
    const params={limit:50,offset:body.offset,...(body.stage==='decisions'?{'filter-output':'voters'}:{})};
    const record=await this.request(endpoint,params);
    const url=new URL(ODP_BASE+endpoint);
    for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
    const sources=[...body.sources,{url:url.href,fetchedAt:record.fetchedAt,language:body.stage==='decisions'?'en':null}];
    const project=body.stage==='results'?projectMotionResults:projectMotionDecisions;
    const amendmentNodes=body.stage==='decisions'?new Map(projectAmendmentDecisions(record.payload.data,body.sittingId).map(node=>[node.id,node])):null;
    const pageSource={url:url.href,fetchedAt:record.fetchedAt};
    const nodes=project(record.payload.data,body.sittingId).map(node=>amendmentNodes?{...node,...amendmentNodes.get(node.id),source:pageSource}:node);
    const priorSplits=(body.splits || []).map((node,index)=>node.id||node.observationKey?node:{...node,observationKey:'__legacy_request__:'+createHash('sha256').update(JSON.stringify([index,node])).digest('hex')});
    const pageSplits=body.stage==='results'?projectAmendmentSplits(record.payload.data,body.sittingId).map(node=>({...node,...(!node.id?{observationKey:'__unidentified_request__:'+createHash('sha256').update(JSON.stringify([url.href,node.observationIndex,node])).digest('hex')}:{ }),source:pageSource})):[];
    const splits=[...new Map([...priorSplits,...pageSplits].map(node=>[node.id || node.observationKey,node])).values()];
    if(splits.length>5000)throw new Error('Split request source exceeded its record budget.');
    const field=body.stage==='results'?'results':'decisions';
    const merged=[...new Map([...body[field],...nodes].map(node=>[node.id,node])).values()];
    const projectionKnown=body.amendmentProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION||body.stage==='results'&&body.offset===0&&!body.results.length&&!(body.splits || []).length;
    const next={...body,[field]:merged,sources,splits,...(projectionKnown?{amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION}:{})};
    const coverage=motionVoteCoverage(next.results,next.decisions);
    const missing=body.stage==='results'?coverage.missingResultIds:coverage.missingDecisionIds;
    const grew=merged.length>body[field].length || body.stage==='results'&&splits.length>(body.splits || []).length;
    const rawPageLength=record.payload.data.length;
    const capped=merged.length>5000 || body.offset>=950;
    if(merged.length>5000)throw new Error('Motion vote source exceeded its record budget.');
    // Results pages also contain request types excluded from both projections.
    // Their raw length still advances the source cursor, even without new votes.
    const continueResults=body.stage==='results'&&(rawPageLength>=50 || grew&&missing.length);
    // The decisions API currently ignores limit and returns the whole sitting.
    // Compare exact declared children, never graph length or the requested limit.
    const continueDecisions=body.stage==='decisions'&&grew&&missing.length;
    if(!capped && (continueResults || continueDecisions)) {
      const offset=body.stage==='results'?Math.min(950,body.offset+Math.max(50,rawPageLength)):body.offset+Math.max(50,nodes.length);
      this.store.taskProgress(task,{...next,offset});return;
    }
    if(body.stage==='results') {
      this.store.taskProgress(task,{...next,stage:'decisions',offset:0,splitProjectionTruncated:Boolean(capped&&rawPageLength>=50),resultsUrl:sources[0].url,resultsFetchedAt:record.fetchedAt});return;
    }
    const firstDecisionSource=sources.find(source=>source.url.includes('/decisions?'));
    const key=motionSourceKey(body.sittingId), saved=this.store.source(generation,key);
    // An empty or reduced result graph must not erase a previously complete sitting.
    const resultIds=new Set(next.results.map(result=>result.id));
    coverage.missingResultIds=[...new Set([...coverage.missingResultIds,...(saved?.work.results || []).map(result=>result.id).filter(id=>!resultIds.has(id))])];
    const truncated=Boolean(coverage.missingResultIds.length || coverage.missingDecisionIds.length);
    const lastRefreshFailure=truncated?{attemptedAt:record.fetchedAt,coverage,sources}:null;
    const fresh=parseSavedSplits(this,{
      results:next.results,decisions:next.decisions,splitRequests:next.splits,sources,splitProjectionTruncated:Boolean(next.splitProjectionTruncated),...(projectionKnown?{amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION}:{}),
      resultsUrl:body.resultsUrl,resultsFetchedAt:body.resultsFetchedAt,decisionsUrl:firstDecisionSource.url,decisionsFetchedAt:record.fetchedAt,
      coverage,truncated,lastRefreshFailure,
    },{priorWork:saved?.work || null});
    const confirmationDay=sittingConfirmationDay(body.sittingId);
    if(sittingSnapshotConfirmed(fresh,body.sittingId,record.fetchedAt))fresh.finality={confirmationDay,confirmedAt:record.fetchedAt};
    const replacement=truncated && saved && !saved.work.truncated ? {...saved.work,lastRefreshFailure,amendmentEvidence:fresh.amendmentEvidence || fresh} : fresh;
    this.store.putSource(generation,key,'motion-outcomes',replacement,truncated && saved && !saved.work.truncated?saved.fetchedAt:record.fetchedAt,[],{acquisition:acquisitionMode(this.store,task),sourceUrl:record.url});
    if(!await refreshSittingTargets(this,generation,body.sittingId,replacement)) {
      this.deferMotionRebuild(task,next);return;
    }
    this.store.finishTask(task);
  }
  refreshReportJoins(generation,procedureId) {
    for(const report of this.store.reportsForProcedure(generation,procedureId)) {
      const procedures=new Map(procedureIds(report.work).flatMap(id=>{const record=this.store.source(generation,'/procedures/'+id);return record?[[id,record]]:[];}));
      const {rows}=documentRows(report.work,report.key,report.fetchedAt,procedures);
      this.store.transaction(()=>{this.store.assertWriter();this.store.replaceRows(generation,report.key,rows);});
    }
  }
  catchUp(cycle) {
    const today=day(this.clock());
    if(day(Date.parse(cycle.startedAt))===today || cycle.catchupDay===today)return false;
    if(cycle.initial)for(const collection of collections(new Date(this.clock()).getUTCFullYear())) this.store.enqueue(cycle.generation,'catchup:'+today+':'+collection.endpoint+':'+JSON.stringify(collection.params),'catalog',{...collection,offset:0,deltaOnly:true},100);
    this.enqueueFeeds(cycle.generation,'catchup:'+today+':feed:',cycle.startedAt);
    scheduleMembership(this.store,cycle.generation,'catchup:'+today+':');
    scheduleGroupHistory(this.store,cycle.generation,'catchup:'+today+':');
    this.store.enqueue(cycle.generation,'catchup:'+today+':roster','roster',{offset:0,nodes:[]},110);
    const start=day(Date.parse(cycle.startedAt)-2*DAY);
    this.store.enqueue(cycle.generation,'catchup:'+today+':speeches','speeches',{endpoint:'/speeches',params:{'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT','sort-by':'sitting-date:desc,numbering:desc','sitting-date':start,'sitting-date-end':today},offset:0},100);
    this.store.updateCycle({catchupDay:today});return true;
  }
  finalize(generation) {
    return this.generationExecutor?this.generationExecutor('publish',{generation,signal:this.controller.signal}):this.store.finalize(generation);
  }
  async run() {
    if(this.stopped || this.running)return;
    const iteration=loopTimer('activity');
    try {await this.runIteration();}finally {iteration({requests:this.requests||0});}
  }
  // Press following shares the writer lease, request budget and deadline but none
  // of the index work. While index work is also due, press takes a tenth of the
  // budget; below ten requests it takes one every other iteration, so both progress.
  async followPress(indexDue) {
    let cap=indexDue?Math.floor(this.budget/10):this.budget,used=0;
    if(!cap){this.pressTurn=!this.pressTurn;cap=this.pressTurn?1:0;}
    if(!cap)return;
    const admit=()=>{if(this.stopped||used>=cap||this.requests>=this.budget||this.monotonic()>=this.runDeadline)return false;used++;this.requests++;return true;};
    try {await this.press.run({signal:this.controller.signal,admit});}
    catch(error) {if(!this.stopped)console.error('[press-releases]',error.message);}
  }
  async runIteration() {
    if(this.stopped)return;
    const pressDue=Boolean(this.press?.due()),due=this.due();
    if(!due&&!pressDue || !this.store.acquire())return;
    // Lease loss cancels one iteration. Only stop() shuts down the service;
    // a later tick must acquire ownership again before it can resume work.
    this.controller=new AbortController();
    this.running=true;this.requests=0;const started=this.clock();
    this.runDeadline=this.monotonic()+this.maxDuration;
    const heartbeat=setInterval(()=>{if(!this.store.generationTaskActive&&!this.store.renew())this.controller.abort(new Error('Activity-index writer lease was lost.'));},20_000);heartbeat.unref();
    try {
      if(pressDue)await this.followPress(due);
      if(!due || this.stopped)return;
      this.controller.signal.throwIfAborted();
      const active=this.store.get('active') || 0,existing=this.store.get('working');
      if(!existing && active) {
        // A rollback may have advanced the core generation while leaving the
        // additive amendment snapshot behind. Adopt it before reading sources.
        this.store.transaction(()=>{this.store.assertWriter();amendmentsCopy(this.store.db,active,active);groupVoicesCopy(this.store.db,active,active);});
        this.checkpointContinuations(active);
      }
      // Core recovery changes items and their frozen Following summaries. It
      // must publish through a working generation, even between daily cycles.
      const recover=(gapRecoveryDue(this.store,active,this.clock())||mutableRecoveryDue(this.store,active,this.clock())||this.recoveryMode==='backfill'&&amendmentDocumentRouteVerificationPending(this.store,active)||declaredDebateRecoveryDue(this.store,active));
      const cycle=this.coreDue()||recover?await (this.generationExecutor?this.generationExecutor('begin',{signal:this.controller.signal}):this.store.beginCycle()):null,generation=cycle?.generation || active;
      if(this.stopped)return;
      this.controller.signal.throwIfAborted();
      this.store.assertWriter();
      if(cycle&&this.store.reclassifyMotions(generation))return;
      if(cycle){
        scheduleDeclaredDebateRecovery(this,generation);
        reconcileAmendmentDocumentGaps(this,generation,{restart:this.amendmentRouteStartupRepair});this.amendmentRouteStartupRepair=false;
        scheduleAdoptedTexts(this,cycle);scheduleAdoptedTextRepairs(this,cycle);
      }
      if(this.followupStartupRepair){markFollowupAdmissionRepair(this.store,generation);this.followupStartupRepair=false;}
      scheduleFollowupAdmissionRepairs(this,generation);
      scheduleGapRecovery(this,generation);
      if(cycle)scheduleGroupHistoryRepair(this.store,generation);
      prepareAmendmentParserUpgrade(this,generation);
      prepareCommitteeAmendments(this,generation);
      for(const row of this.store.db.prepare('SELECT sitting_id FROM sitting_refresh WHERE generation=? AND next_check<=? ORDER BY next_check,sitting_id LIMIT 100').all(generation,this.clock())) {
        const delay=this.clock()<Date.parse(sittingConfirmationDay(row.sitting_id))?6*60*60_000:7*DAY;
        const gap=this.store.db.prepare("SELECT * FROM refresh_gaps WHERE generation=? AND sitting_id=? AND kind='motion-outcomes' ORDER BY retry_at LIMIT 1").get(generation,row.sitting_id);
        if(gap) {
          if(day(this.clock())>=sittingConfirmationDay(row.sitting_id)) {
            // Historical failures share the bounded recovery admission queue.
            // An unadmitted gap must not cause idle lease churn every 30 seconds.
            this.store.db.prepare('UPDATE sitting_refresh SET next_check=? WHERE generation=? AND sitting_id=?').run(Math.max(gap.retry_at,this.clock()+DAY),generation,row.sitting_id);
            continue;
          }
          if(gap.retry_at<=this.clock()) {
            const pending=this.store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=? AND (done IS NULL OR done<>1) UNION ALL SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND done<>1 LIMIT 1').get(generation,gap.key,generation,gap.key);
            if(!pending&&this.store.enqueue(generation,gap.key,gap.kind,{},gap.priority,true,{retryGap:true}))this.store.db.prepare('UPDATE refresh_gaps SET retry_at=? WHERE generation=? AND key=?').run(this.clock()+delay,generation,gap.key);
          }
        } else scheduleSittingOutcomes(this,generation,row.sitting_id);
        this.store.db.prepare('UPDATE sitting_refresh SET next_check=? WHERE generation=? AND sitting_id=?').run(this.clock()+delay,generation,row.sitting_id);
      }
      // Only a newly initialized empty load projects every historical page.
      // An older partial initial generation still needs the metadata upgrade.
      const freshSpeechLoad=Boolean(cycle?.initial&&!cycle.initialized);
      if(cycle) {
        if(!cycle.initialized)await this.initialize(cycle);
        if(!this.store.get('working').membershipScheduled) {
          scheduleMembership(this.store,cycle.generation);this.store.updateCycle({membershipScheduled:true});
        }
        if(!this.store.get('working').groupHistoryScheduled) {
          scheduleGroupHistory(this.store,cycle.generation);this.store.updateCycle({groupHistoryScheduled:true});
        }
        await runHistoryReadiness(this,cycle.generation);
        if(!this.store.get('working').mutableScheduled||this.recoveryMode==='backfill') {
          scheduleMutable(this,cycle.generation);this.store.updateCycle({mutableScheduled:true});
        }
        // Upgrade a saved, endlessly retrying generation without issuing one
        // more request for every exhausted cursor.
        for(const row of this.store.db.prepare('SELECT * FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND attempts>=5 AND error IS NOT NULL').all(generation))recordTaskGap(this,{...row,body:JSON.parse(row.body)},new Error(row.error));
        this.initializeOutside(cycle);
        await prepareAmendments(this,cycle);
        // An unavailable historical detail must not stop next-day catalogue/feed
        // catch-up while its durable retry keeps the generation incomplete.
        this.catchUp(this.store.get('working'));
        const motionDay=day(this.clock());
        if(this.store.get('working').motionOutcomesDay!==motionDay) {
          this.prepareMotionOutcomes(cycle.generation);
          this.store.updateCycle({motionOutcomesDay:motionDay});
        }
        if(!this.store.get('working').reportJoinsReady) {
          // Upgrade an existing partial generation from its retained real records,
          // without refetching sources or resetting any durable page cursor.
          for(const procedure of this.store.iterateSources(cycle.generation,'procedure'))this.refreshReportJoins(cycle.generation,tail(procedure.key));
          this.store.updateCycle({reportJoinsReady:true});
        }
        if(!this.store.get('working').procedureTitlesQueued||!this.store.get('working').procedureTypesQueued) {
          // Upgrade saved procedures within the existing worker/request budget, ahead of bulk catalogues.
          // Explicit null records an unavailable title/type; only omitted projection fields need this one-time upgrade.
          const untitled=this.store.db.prepare("SELECT key FROM sources WHERE generation=? AND kind='procedure' AND (json_type(body,'$.process_title') IS NULL OR json_type(body,'$.process_type') IS NULL)").all(cycle.generation);
          for(const {key} of untitled)this.store.enqueue(cycle.generation,key,'procedure',{endpoint:key},104,true);
          this.store.updateCycle({procedureTitlesQueued:true,procedureTypesQueued:true});
        }
        this.store.updateCycle({phase:cycle.initial?'backfilling':'refreshing'});
        // Existing optional continuations may become admissible while a core
        // refresh is still working. Leave its catalogue and recovery tasks in
        // the canonical queue with their existing cursors.
        if(this.store.source(generation,CONTINUATIONS_KEY))this.checkpointContinuations(generation,{includeCore:false});
      }
      initializeOutsideAgendaUpgrade(this.store,generation,new Date(this.clock()).toISOString());
      initializeGroupVoices(this,generation,freshSpeechLoad?[]:speechWindows(day(this.clock())));
      while(!this.stopped && !this.controller.signal.aborted && this.requests<this.budget && this.clock()-started<this.maxDuration && this.monotonic()<this.runDeadline) {
        const taskIteration=loopTimer('activity-task',{threshold:5000});
        try {
          const size=(await Promise.all(['','-wal','-shm'].map(suffix=>stat(this.store.filename+suffix).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0);
          if(size>this.diskLimit){if(this.store.get('working'))this.store.updateCycle({phase:'paused',error:'Activity index reached its configured disk limit.'});break;}
          // An iteration may spend 90 minutes on source jobs. Advance one
          // bounded local batch per dispatch rather than waiting for its end.
          if(cycle&&amendmentDocumentRouteRepairPending(this.store,generation))reconcileAmendmentDocumentGaps(this,generation);
          if(cycle&&this.store.get('working')){scheduleMutable(this,generation);scheduleDeclaredDebateRecovery(this,generation);}
          if(cycle&&this.recoveryMode==='backfill'&&amendmentDocumentRouteVerificationPending(this.store,generation))scheduleAmendmentDocumentRouteVerification(this,generation);
          const ordinaryTask=this.store.nextTask(generation),amendmentJob=nextAmendmentTask(this.store,generation);
          const preferredTask=amendmentJob&&(!ordinaryTask||amendmentJob.priority>ordinaryTask.priority)?amendmentJob:ordinaryTask;
          const voiceTask=nextGroupVoiceTask(this.store,generation,preferredTask);
          // Advance core shares only when a core task will actually dispatch.
          const sharedTask=voiceTask?.groupVoiceJob?preferredTask:this.recoveryMode==='backfill'?nextBackfillTask(this.store,generation,preferredTask):preferredTask;
          const coreTask=voiceTask?.groupVoiceJob?sharedTask:nextRefreshTask(this.store,generation,sharedTask);
          // Future jobs need no request; keep scanning across the async disk
          // checkpoint until the cursor completes or this run reaches a bound.
          if(!coreTask&&cycle&&(amendmentDocumentRouteRepairPending(this.store,generation)||(this.recoveryMode==='backfill'&&amendmentDocumentRouteVerificationPending(this.store,generation)||declaredDebateRecoveryDue(this.store,generation))))continue;
          // Publish a finished core generation before spending budget on optional metadata.
          if(!coreTask&&cycle&&this.store.get('working')){
            const counts=this.store.taskCounts(generation);
            if(counts.total===counts.completed){
              // Keep this snapshot open for the next bounded admission batch;
              // don't copy the entire index again for every 25 recovered gaps.
              if(this.recoveryMode==='backfill'&&(gapRecoveryDue(this.store,generation,this.clock())||mutableRecoveryDue(this.store,generation,this.clock())))break;
              if(adoptedTextRepairDue(this.store,generation))break;
              if(this.catchUp(this.store.get('working')))continue;await this.finalize(generation);
            }
          }
          const task=voiceTask?.groupVoiceJob?voiceTask:coreTask;
          if(!task)break;
          try {await this.task(task);this.controller.signal.throwIfAborted();this.finishOutsideGap(task);}catch(error){if(this.stopped||this.controller.signal.aborted)break;if(!task.groupVoiceJob&&(this.failOutside(task,error)||failAmendmentTask(this,task,error)||recordTaskGap(this,task,error)))continue;this.store.failTask(task,error);if(error.retryAfter)this.store.db.prepare(`UPDATE ${task.groupVoiceJob?'group_voice_jobs':task.amendmentJob?'amendment_jobs':'tasks'} SET retry_at=MAX(retry_at,?) WHERE generation=? AND key=?`).run(this.clock()+error.retryAfter*1000,task.generation,task.key);}
          finally {if(!task.groupVoiceJob&&(!cycle || this.store.source(generation,CONTINUATIONS_KEY)) && this.store.db.prepare('SELECT 1 FROM lease WHERE id=1 AND owner=? AND expires>?').get(this.store.owner,this.clock()))this.checkpointContinuations(generation,{includeCore:!cycle});}
        } finally {taskIteration();}
      }
      if(!this.stopped)this.controller.signal.throwIfAborted();
      if(!this.stopped&&cycle&&this.store.get('working'))publishMissingHistory(this.store,generation);
    } finally {clearInterval(heartbeat);this.store.release();this.running=false;delete this.runDeadline;}
  }
  stop(){this.stopped=true;this.controller.abort();if(!this.running)this.store.release();}
}
let service;
export function activityIndex() {
  if(!booleanFromEnvironment('ACTIVITY_INDEX_ENABLED'))throw new HttpError(503,'activity_index_disabled','The joined activity index is not enabled.');
  if(service)return service;
  const directory=absolutePathFromEnvironment('ACTIVITY_INDEX_DIR');
  if(!directory)throw new HttpError(503,'activity_index_configuration','A dedicated index directory is required.');
  const options={
    recoveryMode:process.env.ACTIVITY_INDEX_RECOVERY_MODE||'normal',
    budget:integerFromEnvironment('ACTIVITY_INDEX_JOB_REQUEST_BUDGET',1000,1,2000),
    maxDuration:integerFromEnvironment('ACTIVITY_INDEX_JOB_MAX_MINUTES',90,1,120)*60_000,
    diskLimit:integerFromEnvironment('ACTIVITY_INDEX_MAX_DISK_MIB',8192,64,131072)*1024*1024,
  };
  const store=new ActivityStore(directory),press=new PressStore(directory);
  const worker=new ActivityWorker(store,{...options,press:new PressFollower(press,{write:leaseFencedWrite(store,press)})});
  worker.generationExecutor=(operation,options)=>activityGenerationTask(store,operation,options);
  service={store,worker,press};return service;
}
export function activityIndexStatus(){return activityIndex().store.status();}
export function latestActivities(id,params) {
  const store=activityIndex().store;
  if(!store.status().currentMeps)throw new HttpError(503,'activity_index_loading','The current MEP roster is being loaded.');
  const result=store.page(id,params);if(!result)throw new HttpError(404,'mep_not_current','This ID is not in the current MEP roster.');return result;
}
export function startActivityIndex() {
  if(!booleanFromEnvironment('ACTIVITY_INDEX_ENABLED'))return ()=>{};
  const {worker}=activityIndex();
  worker.repairOnStartup=true;
  const run=()=>worker.run().catch(e=>console.error('[activity-index]',e.message));
  const timer=setInterval(run,30_000);timer.unref();void run();
  return ()=>{clearInterval(timer);worker.stop();};
}

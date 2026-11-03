import {ballotVotingLists} from './ballot-source-adapter.mjs';
import {retainSittingBallotBindings} from './your-vote-ballot.mjs';
import {agendaFreshMs,agendaSettledAfter} from './plenary-cache-policy.mjs';
import {odp} from './odp.mjs';
import {array,tail} from './activity-index-model.mjs';
import {SittingSnapshotReader} from './sitting-snapshot-store.mjs';
import {statSync} from 'node:fs';
import {MemberVotes,MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {MemberAttendance,MEMBER_ATTENDANCE_VERSION} from './member-attendance.mjs';
import {MeetingsReader,MEETINGS_SOURCE_MAX_BYTES} from './meetings-reader.mjs';
import {calendarYears,currentTermSittings,isPlenarySitting,identifiedPlenarySitting} from './plenary-calendar.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {sittingConfirmationDay,DAY} from './refresh-policy.mjs';
import {missingSourceDelay,sourceMissing,transientSourceDelay,confirmSourceRejection,SOURCE_RECHECK_MS,sourceObservationHash} from './source-retry.mjs';
import {requestTimeout,runWithRequestSignal} from './request-budget.mjs';
import {collectVoteChairs} from './vote-chairs.mjs';
import {SittingSnapshotWriter,sittingSnapshotHints,SITTING_CALENDAR_VERSION,SITTING_SNAPSHOT_SCHEMA,SNAPSHOT_MAX_BYTES} from './sitting-snapshot-store.mjs';

const SIX_HOURS=6*60*60_000;
const agendaEndpoint=id=>'/meetings/'+id.slice(0,17)+'/foreseen-activities';
const settledLinks=(id,now)=>agendaFreshMs(agendaEndpoint(id),now)===Infinity;
const readerVersions={votes:MEMBER_VOTE_SNAPSHOT_VERSION,attendance:MEMBER_ATTENDANCE_VERSION,calendar:SITTING_CALENDAR_VERSION};
const discoveryKey=now=>[3,brusselsDay(now).slice(0,4),...Object.values(readerVersions)].join(':');
const agendaCursorKey='agenda:cursor',agendaDispatchPages=8;
// These jobs retain PVCRE agenda items, including procedural items and votes.
// The queue name does not imply that every item is a PLENARY_DEBATE.
const debateParserVersion=3;
const eventIdentity=value=>typeof value==='string'?value.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
const validDebate=(record,id)=>{
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+(?:-\d+)*$/.test(id))return false;
  const nodes=record?.payload?.data?.filter(node=>eventIdentity(node?.id)==='eli/dl/event/'+id||node?.activity_id===id);
  if(nodes?.length!==1)return false;
  const node=nodes[0],links=node.consists_of;
  return eventIdentity(node.id)==='eli/dl/event/'+id&&(node.activity_id===undefined||node.activity_id===id)&&
    ['PLENARY_DEBATE','PLENARY_ACTIVITY','PLENARY_VOTE','PLENARY_VOTE_EXPLANATIONS'].some(type=>eventIdentity(node.had_activity_type)==='def/ep-activities/'+type)&&
    node.activity_date===id.slice(7,17)&&
    (links===undefined||links!==null&&array(links).every(link=>{
      const ref=eventIdentity(typeof link==='object'?link?.id:link);
      return ref!==null&&(new RegExp('^eli/dl/event/'+id+'-\\d+(?:-\\d+)*$').test(ref)||new RegExp('^eli/dl/event/'+id.slice(0,17)+'-[A-Z0-9]+(?:-[A-Z0-9]+)*$').test(ref)&&ref!=='eli/dl/event/'+id);
    }));
};
const observationTime=record=>typeof record?.fetchedAt==='number'?record.fetchedAt:Date.parse(record?.fetchedAt);
const fresh=source=>source&&!source.stale&&!source.refreshInProgress&&!source.refreshError;
// One finality boundary for cache adoption, staged pages and retained calendars.
const calendarBoundary=id=>Date.parse((Number(id)+1)+'-01-01T00:00Z');
const collectionBoundary=(job,now)=>job.kind==='calendar'
  ?now>=calendarBoundary(job.id)?calendarBoundary(job.id):-Infinity
  :['agenda','debate'].includes(job.kind)?agendaSettledAfter(agendaEndpoint(job.id),now):-Infinity;
const observedAfterBoundary=(record,job,now)=>Number.isFinite(observationTime(record))&&observationTime(record)<=now&&observationTime(record)>=collectionBoundary(job,now);
const calendarConfirmed=(value,id,now)=>now>=calendarBoundary(id)&&value?.coverage?.state==='complete'&&value.coverage.sources?.length>0&&value.coverage.sources.every(source=>fresh(source)&&observedAfterBoundary(source,{kind:'calendar',id},now));
const validCollectionRecord=(record,job,now)=>{
  if(!observedAfterBoundary(record,job,now))return false;
  const data=record?.payload?.data;
  if(!Array.isArray(data))return false;
  if(job.kind==='debate')return validDebate(record,job.id);
  if(data.some(node=>!node||typeof node!=='object'||typeof node.id!=='string'))return false;
  if(job.kind==='calendar')return fresh(record)&&Buffer.byteLength(JSON.stringify(record.payload))<=MEETINGS_SOURCE_MAX_BYTES&&data.every(node=>!isPlenarySitting(node)||identifiedPlenarySitting(node)&&node.activity_date.slice(0,4)===job.id);
  return true;
};
const rejectedRecord=record=>Object.assign(new Error('Collection source has invalid metadata.'),{code:'source_parser_rejection',sourceHash:sourceObservationHash(record)});
export function sittingSnapshotNextCheck(id,now,{complete=true,attempts=0,retryAfter=0,confirmed=true}={}) {
  const correcting=brusselsDay(now)<sittingConfirmationDay(id);
  const interval=complete?(correcting||!confirmed?SIX_HOURS:30*DAY):Math.max(correcting?SIX_HOURS:0,missingSourceDelay(attempts));
  // A pre-boundary observation always gets a post-correction confirmation.
  return Math.max(now+Math.max(interval,retryAfter*1000),0);
}
// Retry missing observations less often as their sitting ages. A complete,
// settled observation is reused indefinitely unless its declarations change.
export function pastSittingRecheckDelay(date,now,currentDelay) {
  const today=brusselsDay(now),months=(Number(today.slice(0,4))-Number(date.slice(0,4)))*12+Number(today.slice(5,7))-Number(date.slice(5,7))-(today.slice(8)<date.slice(8)?1:0);
  return Math.max(currentDelay,months>=24?180*DAY:months>=12?90*DAY:months>=4?30*DAY:0);
}
const retryDelay=(job,now,delay)=>['agenda','calendar','debate'].includes(job.kind)?pastSittingRecheckDelay(job.kind==='calendar'?job.id+'-12-31':job.id.slice(7,17),now,delay):delay;
const voteSources=value=>[...value.catalogue.coverage.sources,...Object.values(value.day.sources).flat(),...(value.day.chairing?.sources||[])];
export const sittingSourcesConfirmed=(id,sources)=>sources.every(source=>Number.isFinite(Date.parse(source?.fetchedAt))&&brusselsDay(Date.parse(source.fetchedAt))>=sittingConfirmationDay(id));
export const completeVoteSnapshot=value=>value.catalogue.coverage.state==='complete'&&value.day.coverage.completeness.complete&&
  voteSources(value).every(fresh);
export const completeAttendanceSnapshot=value=>['observed','not-published'].includes(value.extracted.status)&&fresh(value.source)&&
  (!value.extracted.registerLinked||value.register.status==='available'&&fresh(value.register.source));

// Runs only while the activity writer owns its existing lease. No independent
// timer, source writer, request allowance or full-term in-memory cache.
export class SittingSnapshotCollector {
  constructor(store,{hints=sittingSnapshotHints,readChairs=collectVoteChairs,diskLimit,readCached=(endpoint,params)=>odp(endpoint,params,{cachedOnly:true,ttl:Infinity})}={}){
    this.store=store;this.writer=new SittingSnapshotWriter(store,{diskLimit});this.hints=hints;this.readChairs=readChairs;this.readCached=readCached;
  }
  due(){
    const now=this.store.clock();
    return this.store.get('sittingDebateParser')!==debateParserVersion||this.store.get('sittingSnapshotSchema')!==SITTING_SNAPSHOT_SCHEMA||this.hints.size>0||this.store.get('sittingSnapshotDiscovery')!==discoveryKey(now)||this.writer.hasDue(now);
  }
  discoverSittings(nodes){
    for(const node of nodes){
      this.writer.enqueue('agenda',1,node.activity_id);
      for(const ref of array(node.consists_of)){
        const id=tail(typeof ref==='object'?ref.id:ref);
        if(new RegExp('^'+node.activity_id+'-PVCRE-ITM-\\d+$').test(id))this.writer.enqueue('debate',1,id);
      }
    }
  }
  admit(){
    this.store.assertWriter();
    if(this.store.get('sittingDebateParser')!==debateParserVersion)this.store.transaction(()=>{
      // A parser upgrade retries never-collected items immediately. Age decay
      // still applies to held observations and to subsequent failed attempts.
      this.store.db.prepare("UPDATE sitting_snapshots SET next_check=MIN(next_check,?) WHERE kind='debate' AND complete=0 AND body IS NULL AND error IN ('Collection source has invalid metadata.','Exact debate links unavailable.')").run(this.store.clock());
      this.store.set('sittingDebateParser',debateParserVersion);
    });
    const key=discoveryKey(this.store.clock());
    if(this.store.get('sittingSnapshotDiscovery')!==key){
      // A new reader must never write its projection under an older version's
      // job key. Rediscover with current readers, preserving failed backoffs.
      for(const [kind,version] of Object.entries(readerVersions)){
        this.store.db.prepare('DELETE FROM sitting_snapshots WHERE kind=? AND version<>?').run(kind,version);
        this.store.db.prepare('DELETE FROM sitting_snapshot_staging WHERE kind=? AND version<>?').run(kind,version);
      }
      for(const selected of calendarYears(brusselsDay(this.store.clock()))){
        this.writer.enqueue('calendar',SITTING_CALENDAR_VERSION,String(selected));
        const retained=new SittingSnapshotReader({db:this.store.db,clock:this.store.clock}).read('calendar',SITTING_CALENDAR_VERSION,String(selected),{retained:true});
        if(retained){
          this.discoverSittings(retained.nodes);
          if(selected<Number(brusselsDay(this.store.clock()).slice(0,4))&&!calendarConfirmed(retained,String(selected),this.store.clock()))
            this.writer.enqueue('calendar',SITTING_CALENDAR_VERSION,String(selected),0,{changedDeclarations:true});
        }
      }
      this.store.db.prepare("UPDATE sitting_snapshots SET next_check=0 WHERE kind='calendar' AND version=? AND id=? AND complete=1 AND error IS NULL").run(SITTING_CALENDAR_VERSION,brusselsDay(this.store.clock()).slice(0,4));
      this.store.set('sittingSnapshotDiscovery',key);
    }
    for(const hint of this.hints.drain())if(readerVersions[hint.kind]===hint.version)this.writer.enqueue(hint.kind,hint.version,hint.id,100,hint);
  }
  async step(worker,{requestBudget=Infinity}={}){
    this.store.assertWriter();this.admit();
    const now=this.store.clock(),job=this.writer.due(now);
    if(!job)return false;
    const diskBytes=['','-wal','-shm'].reduce((sum,suffix)=>{try{return sum+statSync(this.store.filename+suffix).size;}catch{return sum;}},0);
    if(diskBytes>=worker.diskLimit){this.writer.fail(job,new Error('Activity index reached its configured disk limit.'),now+60*60_000);return false;}
    let deferred=false,retryAfter=0,failure=null,readerObservation=null;
    const observeRecord=(key,record)=>{readerObservation={key,record};return record;};
    const requestLimit=Math.min(worker.budget,worker.requests+requestBudget);
    const rejectionKey='sittingSnapshotRejection:'+JSON.stringify([job.kind,job.version,job.id]);
    const retryNext=error=>{
      const {rejection,confirmed}=confirmSourceRejection(this.store.get(rejectionKey),error,{descriptor:error.snapshotSource||JSON.stringify([job.kind,job.id]),parserVersion:job.kind==='debate'?debateParserVersion:job.version,now});
      if(rejection)this.store.set(rejectionKey,rejection);
      else this.store.db.prepare('DELETE FROM meta WHERE key=?').run(rejectionKey);
      return now+retryDelay(job,now,Math.max(Math.max(retryAfter,error.retryAfter||0)*1000,confirmed?SOURCE_RECHECK_MS:sourceMissing(error)||error.upstreamStatus===404?missingSourceDelay(job.attempts):transientSourceDelay(job.attempts)));
    };
    const request=async(endpoint,params={},options={})=>{
      const key=JSON.stringify([endpoint,params]);
      const heldLinks=['agenda','debate'].includes(job.kind);
      let saved=this.writer.staged(job,key,heldLinks||job.kind==='calendar'?0:this.store.clock());
      const collectionJob=['agenda','calendar','debate'].includes(job.kind);
      const invalidSaved=saved&&!saved.failure&&collectionJob&&!validCollectionRecord(saved,job,this.store.clock());
      if(saved&&(collectionJob&&saved.failure||invalidSaved)){
        this.writer.unstage(job,key);saved=null;
      }
      if(saved?.failure)throw Object.assign(new Error(saved.failure.message),saved.failure);
      if(saved)return observeRecord(key,saved);
      if((heldLinks&&settledLinks(job.id,now))||job.kind==='calendar'){
        let cached;try{cached=await this.readCached(endpoint,params);}catch{}
        const fetchedAt=typeof cached?.fetchedAt==='number'?cached.fetchedAt:Date.parse(cached?.fetchedAt);
        const boundary=job.kind==='calendar'&&collectionBoundary(job,this.store.clock())===-Infinity?this.store.clock()-SIX_HOURS:collectionBoundary(job,this.store.clock());
        const rejected=this.store.get(rejectionKey);
        if(cached&&Array.isArray(cached.payload?.data)&&Number.isFinite(fetchedAt)&&fetchedAt>=boundary&&fetchedAt<=this.store.clock()&&
          validCollectionRecord(cached,job,this.store.clock())&&(job.kind!=='calendar'||fresh(cached))&&(job.kind==='debate'||!rejected||sourceObservationHash(cached)!==rejected.hash)){
          worker.controller.signal.throwIfAborted();this.store.assertWriter();
          const record={...cached,fetchedAt:new Date(fetchedAt).toISOString()};
          this.writer.stage(job,key,record,this.store.clock());return observeRecord(key,record);
        }
      }
      if(worker.requests>=requestLimit||worker.monotonic()>=worker.runDeadline){deferred=true;throw requestTimeout();}
      let record;
      try{
        record=await worker.request(endpoint,params,{...options,priority:'background',staleWhileRevalidate:false,snapshotObservation:true});
        // Observation age is refreshable metadata, not a permanent byte/parser failure.
        if(collectionJob&&!observedAfterBoundary(record,job,this.store.clock()))throw Object.assign(new Error('Collection observation needs refresh.'),{code:'source_observation_stale'});
        if(collectionJob&&!validCollectionRecord(record,job,this.store.clock()))throw rejectedRecord(record);
      }
      catch(error){
        retryAfter=Math.max(retryAfter,error.retryAfter||0);
        failure=Object.assign(error,{snapshotSource:key});
        if(!heldLinks&&job.kind!=='calendar'&&(error.code==='odp_no_content'||error.code==='odp_unavailable'&&error.source?.httpStatus===404)){
          this.store.assertWriter();this.writer.stage(job,key,{failure:{message:error.message,code:error.code,status:error.status,upstreamStatus:error.upstreamStatus,source:error.source,responseBytes:error.responseBytes}},this.store.clock());
        }
        throw error;
      }
      worker.controller.signal.throwIfAborted();this.store.assertWriter();
      this.writer.stage(job,key,record,this.store.clock());return observeRecord(key,record);
    };
    try {
      return await runWithRequestSignal(worker.controller.signal,async()=>{
        let value,complete,next;
        if(job.kind==='agenda'){
          let cursor=this.writer.staged(job,agendaCursorKey,0);
          if(cursor&&(!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset%50!==0||settledLinks(job.id,now)&&!cursor.settled)){
            // Rewind metadata only; each saved page has its own freshness check.
            this.writer.unstage(job,agendaCursorKey);cursor=null;
          }
          cursor??={offset:0,settled:settledLinks(job.id,now),lastHash:null};
          for(let batch=0;batch<agendaDispatchPages&&!cursor.terminal;batch++){
            const params={limit:50,offset:cursor.offset},record=await request(agendaEndpoint(job.id),params);
            const hash=sourceObservationHash(record);
            if(record.payload.data.length>=50&&hash===cursor.lastHash){
              this.writer.unstage(job,JSON.stringify([agendaEndpoint(job.id),params]));
              throw Object.assign(new Error('Agenda pagination repeated a page.'),{code:'source_parser_rejection',sourceHash:hash});
            }
            cursor={offset:cursor.offset+50,settled:settledLinks(job.id,now),lastHash:hash,terminal:record.payload.data.length<50};
            this.writer.stage(job,agendaCursorKey,cursor,this.store.clock());
          }
          if(!cursor.terminal){
            // A dispatch is bounded; the total inventory has no row ceiling.
            this.store.db.prepare('UPDATE sitting_snapshots SET complete=0,next_check=0 WHERE kind=? AND version=? AND id=?').run(job.kind,job.version,job.id);
            return true;
          }
          const pages=[];let bytes=14;
          for(let offset=0;offset<cursor.offset;offset+=50){
            const page=this.writer.staged(job,JSON.stringify([agendaEndpoint(job.id),{limit:50,offset}]),0);
            if(!page||!validCollectionRecord(page,job,this.store.clock())){
              if(page)this.writer.unstage(job,JSON.stringify([agendaEndpoint(job.id),{limit:50,offset}]));
              this.writer.unstage(job,agendaCursorKey);return true;
            }
            bytes+=Buffer.byteLength(JSON.stringify(page))+1;
            if(bytes>SNAPSHOT_MAX_BYTES)throw new Error('Sitting snapshot exceeds its bounded size.');
            pages.push(page);
          }
          if(!pages.length||pages.at(-1).payload.data.length>=50){this.writer.unstage(job,agendaCursorKey);return true;}
          complete=true;value={pages};
          next=settledLinks(job.id,now)?Number.MAX_SAFE_INTEGER:now+retryDelay(job,now,SIX_HOURS);
        }else if(job.kind==='debate'){
          value=await request('/events/'+job.id);
          if(!validDebate(value,job.id)){
            this.writer.unstage(job,JSON.stringify(['/events/'+job.id,{}]));
            throw Object.assign(new Error('Exact debate links unavailable.'),{code:'source_parser_rejection',sourceHash:sourceObservationHash(value)});
          }
          const node=value.payload.data.find(node=>eventIdentity(node.id)==='eli/dl/event/'+job.id);
          for(const link of array(node.consists_of)){
            const id=eventIdentity(typeof link==='object'?link?.id:link)?.slice('eli/dl/event/'.length);
            if(id&&new RegExp('^'+job.id+'-\\d+(?:-\\d+)*$').test(id))this.writer.enqueue('debate',1,id);
          }
          complete=true;next=settledLinks(job.id,now)?Number.MAX_SAFE_INTEGER:now+SIX_HOURS;
        }else if(job.kind==='calendar'){
          const reader=new MeetingsReader({request,clock:this.store.clock,limits:{cataloguePages:Number.MAX_SAFE_INTEGER,maxRows:Number.MAX_SAFE_INTEGER}});
          value=Number(job.id)<Number(brusselsDay(now).slice(0,4))?new SittingSnapshotReader({db:this.store.db,clock:this.store.clock}).read('calendar',SITTING_CALENDAR_VERSION,job.id,{retained:true}):null;
          if(value&&!calendarConfirmed(value,job.id,this.store.clock()))value=null;
          value??=await reader.year(Number(job.id));
          const historical=Number(job.id)<Number(brusselsDay(this.store.clock()).slice(0,4));
          complete=value.coverage.state==='complete'&&value.coverage.sources.every(fresh)&&(!historical||calendarConfirmed(value,job.id,this.store.clock()));
          const readerCode=value.coverage.error?.code;
          if(!complete&&!failure&&readerObservation&&(value.coverage.stopReason==='repeated-page'||readerCode?.startsWith('vote_source_'))){
            const {key,record}=readerObservation;
            // Aggregate capacity is a local bound, not a rejected source page.
            const capacity=readerCode==='vote_source_size'&&Buffer.byteLength(JSON.stringify(record.payload))<=MEETINGS_SOURCE_MAX_BYTES;
            if(!capacity){this.writer.unstage(job,key);failure=Object.assign(rejectedRecord(record),{snapshotSource:key});}
          }
          next=now+(complete?(historical?Number.MAX_SAFE_INTEGER-now:SIX_HOURS):retryDelay(job,now,missingSourceDelay(job.attempts)));
          this.discoverSittings(currentTermSittings(value.nodes,brusselsDay(now)));
          for(const node of currentTermSittings(value.nodes,brusselsDay(now))){
            this.writer.enqueue('votes',MEMBER_VOTE_SNAPSHOT_VERSION,node.activity_id);
            this.writer.enqueue('attendance',MEMBER_ATTENDANCE_VERSION,node.activity_id);
          }
        }else if(job.kind==='votes'){
          const reader=new MemberVotes({request,clock:this.store.clock,snapshots:null,readChairs:(request,id,options)=>this.readChairs(request,id,{...options,priority:'background'})});
          const budget={bytes:0},catalogue=await reader.catalogue({sitting:job.id},budget),catalogueBytes=budget.bytes;
          if(catalogue.nodes.length!==1)throw new Error('Exact sitting metadata unavailable.');
          const node=catalogue.nodes[0],day=await reader.sitting(node,budget);
          value={node,catalogue,catalogueBytes,day,bytes:budget.bytes-catalogueBytes};complete=completeVoteSnapshot(value);
          next=sittingSnapshotNextCheck(job.id,now,{complete,attempts:job.attempts,confirmed:sittingSourcesConfirmed(job.id,voteSources(value))});
        }else if(job.kind==='attendance'){
          value=await new MemberAttendance({request,snapshots:null}).loadInputs(job.id);
          complete=completeAttendanceSnapshot(value);next=sittingSnapshotNextCheck(job.id,now,{complete,attempts:job.attempts,confirmed:sittingSourcesConfirmed(job.id,[value.source,...(value.register.source?[value.register.source]:[])])});
        }else throw new Error('Unsupported sitting snapshot kind.');
        if(deferred)return false;
        worker.controller.signal.throwIfAborted();this.store.assertWriter();
        next=Math.max(next,now+retryAfter*1000);
        if(failure&&!complete)next=retryNext(failure);
        else this.store.db.prepare('DELETE FROM meta WHERE key=?').run(rejectionKey);
        this.writer.retain(job,value,{complete,now,next,preserveStage:!complete&&['calendar','agenda','debate'].includes(job.kind)});
        if(job.kind==='votes'&&complete)retainSittingBallotBindings(this.store,value.day,ballotVotingLists(this.store,job.id));
        if(['agenda','debate'].includes(job.kind))this.store.set('availabilityRevision',Number(this.store.get('availabilityRevision')||0)+1);
        return true;
      });
    }catch(error){
      if(worker.controller.signal.aborted)throw error;
      if(deferred)return false; // Staged pages resume under the next run's budget.
      this.store.assertWriter();
      const next=retryNext(failure||error);
      this.writer.fail(job,error,next);return true;
    }
  }
}

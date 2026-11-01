import {statSync} from 'node:fs';
import {MemberVotes,MEMBER_VOTES_VERSION} from './member-votes.mjs';
import {MemberAttendance,MEMBER_ATTENDANCE_VERSION} from './member-attendance.mjs';
import {MeetingsReader} from './meetings-reader.mjs';
import {calendarYears,currentTermSittings} from './plenary-calendar.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {sittingConfirmationDay,DAY} from './refresh-policy.mjs';
import {missingSourceDelay,sourceMissing,transientSourceDelay,confirmSourceRejection,SOURCE_RECHECK_MS} from './source-retry.mjs';
import {requestTimeout,runWithRequestSignal} from './request-budget.mjs';
import {collectVoteChairs} from './vote-chairs.mjs';
import {SittingSnapshotWriter,sittingSnapshotHints,SITTING_CALENDAR_VERSION,SITTING_SNAPSHOT_SCHEMA} from './sitting-snapshot-store.mjs';

const SIX_HOURS=6*60*60_000;
const readerVersions={votes:MEMBER_VOTES_VERSION,attendance:MEMBER_ATTENDANCE_VERSION,calendar:SITTING_CALENDAR_VERSION};
const discoveryKey=now=>[brusselsDay(now).slice(0,4),...Object.values(readerVersions)].join(':');
const fresh=source=>source&&!source.stale&&!source.refreshInProgress&&!source.refreshError;
export function sittingSnapshotNextCheck(id,now,{complete=true,attempts=0,retryAfter=0,confirmed=true}={}) {
  const correcting=brusselsDay(now)<sittingConfirmationDay(id);
  const interval=complete?(correcting||!confirmed?SIX_HOURS:30*DAY):Math.max(correcting?SIX_HOURS:0,missingSourceDelay(attempts));
  // A pre-boundary observation always gets a post-correction confirmation.
  return Math.max(now+Math.max(interval,retryAfter*1000),0);
}
const voteSources=value=>[...value.catalogue.coverage.sources,...Object.values(value.day.sources).flat(),...(value.day.chairing?.sources||[])];
export const sittingSourcesConfirmed=(id,sources)=>sources.every(source=>Number.isFinite(Date.parse(source?.fetchedAt))&&brusselsDay(Date.parse(source.fetchedAt))>=sittingConfirmationDay(id));
export const completeVoteSnapshot=value=>value.catalogue.coverage.state==='complete'&&value.day.coverage.completeness.complete&&
  voteSources(value).every(fresh);
export const completeAttendanceSnapshot=value=>['observed','not-published'].includes(value.extracted.status)&&fresh(value.source)&&
  (!value.extracted.registerLinked||value.register.status==='available'&&fresh(value.register.source));

// Runs only while the activity writer owns its existing lease. No independent
// timer, source writer, request allowance or full-term in-memory cache.
export class SittingSnapshotCollector {
  constructor(store,{hints=sittingSnapshotHints,readChairs=collectVoteChairs,diskLimit}={}){
    this.store=store;this.writer=new SittingSnapshotWriter(store,{diskLimit});this.hints=hints;this.readChairs=readChairs;
  }
  due(){
    const now=this.store.clock();
    return this.store.get('sittingSnapshotSchema')!==SITTING_SNAPSHOT_SCHEMA||this.hints.size>0||this.store.get('sittingSnapshotDiscovery')!==discoveryKey(now)||this.writer.hasDue(now);
  }
  admit(){
    this.store.assertWriter();
    const key=discoveryKey(this.store.clock());
    if(this.store.get('sittingSnapshotDiscovery')!==key){
      // A new reader must never write its projection under an older version's
      // job key. Rediscover with current readers, preserving failed backoffs.
      for(const [kind,version] of Object.entries(readerVersions)){
        this.store.db.prepare('DELETE FROM sitting_snapshots WHERE kind=? AND version<>?').run(kind,version);
        this.store.db.prepare('DELETE FROM sitting_snapshot_staging WHERE kind=? AND version<>?').run(kind,version);
      }
      for(const selected of calendarYears(brusselsDay(this.store.clock())))this.writer.enqueue('calendar',SITTING_CALENDAR_VERSION,String(selected));
      this.store.db.prepare("UPDATE sitting_snapshots SET next_check=0 WHERE kind='calendar' AND version=? AND complete=1 AND error IS NULL").run(SITTING_CALENDAR_VERSION);
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
    let deferred=false,retryAfter=0,failure=null;
    const requestLimit=Math.min(worker.budget,worker.requests+requestBudget);
    const rejectionKey='sittingSnapshotRejection:'+JSON.stringify([job.kind,job.version,job.id]);
    const retryNext=error=>{
      const {rejection,confirmed}=confirmSourceRejection(this.store.get(rejectionKey),error,{descriptor:error.snapshotSource||JSON.stringify([job.kind,job.id]),parserVersion:job.version,now});
      if(rejection)this.store.set(rejectionKey,rejection);
      else this.store.db.prepare('DELETE FROM meta WHERE key=?').run(rejectionKey);
      return now+Math.max(Math.max(retryAfter,error.retryAfter||0)*1000,confirmed?SOURCE_RECHECK_MS:sourceMissing(error)||error.upstreamStatus===404?missingSourceDelay(job.attempts):transientSourceDelay(job.attempts));
    };
    const request=async(endpoint,params={},options={})=>{
      const key=JSON.stringify([endpoint,params]);
      const saved=this.writer.staged(job,key,this.store.clock());
      if(saved?.failure)throw Object.assign(new Error(saved.failure.message),saved.failure);
      if(saved)return saved;
      if(worker.requests>=requestLimit||worker.monotonic()>=worker.runDeadline){deferred=true;throw requestTimeout();}
      let record;
      try{record=await worker.request(endpoint,params,{...options,priority:'background',staleWhileRevalidate:false,snapshotObservation:true});}
      catch(error){
        retryAfter=Math.max(retryAfter,error.retryAfter||0);
        failure=Object.assign(error,{snapshotSource:key});
        if(error.code==='odp_no_content'||error.code==='odp_unavailable'&&error.source?.httpStatus===404){
          this.store.assertWriter();this.writer.stage(job,key,{failure:{message:error.message,code:error.code,status:error.status,upstreamStatus:error.upstreamStatus,source:error.source,responseBytes:error.responseBytes}},this.store.clock());
        }
        throw error;
      }
      worker.controller.signal.throwIfAborted();this.store.assertWriter();
      this.writer.stage(job,key,record,this.store.clock());return record;
    };
    try {
      return await runWithRequestSignal(worker.controller.signal,async()=>{
        let value,complete,next;
        if(job.kind==='calendar'){
          const reader=new MeetingsReader({request,clock:this.store.clock});
          value=await reader.year(Number(job.id));
          complete=value.coverage.state==='complete'&&value.coverage.sources.every(fresh);
          next=now+(complete?(Number(job.id)===Number(brusselsDay(now).slice(0,4))?SIX_HOURS:30*DAY):missingSourceDelay(job.attempts));
          for(const node of currentTermSittings(value.nodes,brusselsDay(now))){
            this.writer.enqueue('votes',MEMBER_VOTES_VERSION,node.activity_id);
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
        this.writer.retain(job,value,{complete,now,next});return true;
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

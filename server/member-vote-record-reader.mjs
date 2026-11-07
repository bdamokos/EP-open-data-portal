import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {MemberVoteRecordReader} from './member-vote-record.mjs';
import {SittingSnapshotReader} from './sitting-snapshot-store.mjs';
import {HttpError} from './http-utils.mjs';
import {absolutePathFromEnvironment} from './config.mjs';
import {requestSignal} from './request-budget.mjs';

// One bounded, read-only query off the HTTP thread. Reject overlapping work
// rather than queue unbounded scans; always terminate the task-owned worker.
export class MemberVoteRecordService {
  constructor({directory=()=>absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'),timeoutMs=5000}={}){this.directory=directory;this.timeoutMs=timeoutMs;this.busy=false;}
  async query(id,query) {
    if(this.busy)throw new HttpError(503,'member_vote_record_busy','Voting records are temporarily unavailable.');
    this.busy=true;let worker,timer,abort;
    const signal=requestSignal();
    try {
      signal?.throwIfAborted();
      worker=new Worker(new URL(import.meta.url),{workerData:{type:'member-vote-record',directory:typeof this.directory==='function'?this.directory():this.directory,id,query},resourceLimits:{maxOldGenerationSizeMb:256}});
      return await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new HttpError(503,'member_vote_record_timeout','Voting records are temporarily unavailable.')),this.timeoutMs);
        abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});
        worker.once('message',message=>message.error?reject(new HttpError(message.status||503,message.code||'member_vote_record_unavailable',message.error)):resolve(message.result));
        worker.once('error',reject);worker.once('exit',()=>reject(new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.')));
      });
    }finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);await worker?.terminate();this.busy=false;}
  }
}
if(!isMainThread&&workerData?.type==='member-vote-record') {
  const snapshots=new SittingSnapshotReader({directory:workerData.directory});
  try{snapshots.connection()?.exec('BEGIN');parentPort.postMessage({result:new MemberVoteRecordReader({snapshots}).query(workerData.id,workerData.query)});}
  catch(error){parentPort.postMessage({error:error.message,status:error.status,code:error.code});}
  finally{snapshots.db?.exec('ROLLBACK');snapshots.close();}
}
export const memberVoteRecordService=new MemberVoteRecordService();

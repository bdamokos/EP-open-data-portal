import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {MemberVoteRecordReader,memberVoteRecordReadFailure} from './member-vote-record.mjs';
import {HttpError} from './http-utils.mjs';
import {absolutePathFromEnvironment} from './config.mjs';
import {requestSignal} from './request-budget.mjs';

// One bounded, read-only query off the HTTP thread. Reject overlapping work
// rather than queue unbounded scans; always terminate the task-owned worker.
export class MemberVoteRecordService {
  constructor({directory=()=>absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'),timeoutMs=5000}={}){this.directory=directory;this.timeoutMs=timeoutMs;this.busy=false;}
  async query(id,query) {
    if(this.busy)throw Object.assign(new HttpError(503,'busy','Voting records are temporarily unavailable.'),{retryAfter:1});
    this.busy=true;let worker,timer,abort;
    const signal=requestSignal();
    try {
      signal?.throwIfAborted();
      worker=new Worker(new URL(import.meta.url),{workerData:{type:'member-vote-record',directory:typeof this.directory==='function'?this.directory():this.directory,id,query},resourceLimits:{maxOldGenerationSizeMb:256}});
      return await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Object.assign(new HttpError(503,'request_timeout','Voting records are temporarily unavailable.'),{retryAfter:1})),this.timeoutMs);
        abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});
        worker.once('message',message=>message.error?reject(Object.assign(new HttpError(message.status||503,message.code||'member_vote_record_unavailable',message.error),Number.isFinite(message.retryAfter)?{retryAfter:message.retryAfter}:{})):resolve(message.result));
        worker.once('error',()=>reject(Object.assign(new HttpError(503,'busy','Voting records are temporarily unavailable.'),{retryAfter:1})));worker.once('exit',()=>reject(new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.')));
      });
    }finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);await worker?.terminate();this.busy=false;}
  }
}
if(!isMainThread&&workerData?.type==='member-vote-record') {
  let db,began=false;
  try{
    // Open here so lock errors during connection setup reach the same retry
    // classification as query errors, rather than becoming a missing database.
    if(workerData.directory)db=new DatabaseSync(path.join(workerData.directory,'activities-v1.sqlite'),{readOnly:true});
    db?.exec('PRAGMA busy_timeout=250; BEGIN');began=Boolean(db);
    parentPort.postMessage({result:new MemberVoteRecordReader({snapshots:{connection:()=>db}}).query(workerData.id,workerData.query)});
  }catch(error){const failure=memberVoteRecordReadFailure(error);parentPort.postMessage({error:failure.message,status:failure.status,code:failure.code,retryAfter:failure.retryAfter});}
  finally{if(db){if(began)db.exec('ROLLBACK');db.close();}}
}
export const memberVoteRecordService=new MemberVoteRecordService();

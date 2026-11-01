import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {loopTimer} from './sqlite-observability.mjs';

// One logical writer delegates only its atomic generation work. Network reads,
// request admission and their shared quotas remain in the API process.
export async function activityGenerationTask(store,operation,{generation,signal,createWorker=(url,options)=>new Worker(url,options)}={}) {
  if(!['begin','publish','topics','stories'].includes(operation)||operation!=='begin'&&(!Number.isSafeInteger(generation)||generation<1))throw new Error('Invalid activity generation operation.');
  signal?.throwIfAborted();
  if(store.db.isTransaction||store.generationTaskActive)throw new Error('An activity generation operation is already active.');
  store.assertWriter();store.generationTaskActive=true;
  const elapsed=loopTimer('activity-generation');
  try {
    let value;
    for(const step of operation==='publish'?['publish','topics']:[operation]){
    signal?.throwIfAborted();
    value=await new Promise((resolve,reject)=>{
      let thread,result,failure,complete=false;
      try {thread=createWorker(new URL('./activity-generation-worker.mjs',import.meta.url),{...(['topics','stories'].includes(step)?{resourceLimits:{maxOldGenerationSizeMb:28,maxYoungGenerationSizeMb:2}}:{}),workerData:{directory:path.dirname(store.filename),owner:store.owner,operation:step,generation}});}
      catch(error){reject(error);return;}
      const abort=()=>{failure=signal.reason||new Error('Activity generation operation aborted.');void thread.terminate();};
      thread.on('message',message=>{
        if(message?.type==='complete'){result=message.value;complete=true;}
        if(message?.type==='failed')failure=new Error(message.error);
      });
      thread.once('error',error=>{failure=error;});
      // Never release the logical lease or resume writes before the thread has
      // exited and SQLite has committed or rolled back its transaction.
      thread.once('exit',code=>{
        signal?.removeEventListener('abort',abort);
        if(failure)reject(failure);
        else if(code!==0||!complete)reject(new Error('Activity generation operation exited without completion.'));
        else resolve(result);
      });
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
    });
    // SQLite commit and thread exit can consume part of the transaction's
    // final lease. Resume only after a live-owner renewal at the current clock;
    // an expired or replaced owner must reacquire on a later ordinary tick.
    if(!store.renew())throw new Error('Activity-index writer lease was lost.');
    }
    return value;
  } finally {store.generationTaskActive=false;elapsed({operation});}
}

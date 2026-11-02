import {topicBuildMetrics} from './topic-build-metrics.mjs';
import {topicBootstrapRequired} from './topic-projection-state.mjs';
import {topicBuildWindowOpen} from './topic-build-window.mjs';
import {pruneUnpublishedTopicData} from './topic-publication.mjs';
import {topicBuildAllowed,topicBuildStarted,topicBuildFailed,topicBuildSucceeded,topicBuildDiskCheck} from './topic-build-gate.mjs';
import {integerFromEnvironment} from './config.mjs';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {loopTimer} from './sqlite-observability.mjs';

// The 26 MiB policy was measured on a partly collected snapshot. Builds log
// their thread's peakHeapMiB; size this ceiling from that with headroom.
export const topicBuildResourceLimits=()=>({maxOldGenerationSizeMb:integerFromEnvironment('TOPICS_BUILD_MAX_OLD_GENERATION_MIB',64,16,2048),maxYoungGenerationSizeMb:2});
const graphOperation=operation=>['topics','stories'].includes(operation),mib=bytes=>Math.round(bytes/10485.76)/100;
// One logical writer delegates only its atomic generation work. Network reads,
// request admission and their shared quotas remain in the API process.
export async function activityGenerationTask(store,operation,{generation,signal,rebuildWindow,diskLimit,createWorker=(url,options)=>new Worker(url,options)}={}) {
  if(!['begin','publish','topics','stories'].includes(operation)||operation!=='begin'&&(!Number.isSafeInteger(generation)||generation<1))throw new Error('Invalid activity generation operation.');
  signal?.throwIfAborted();
  if(store.db.isTransaction||store.generationTaskActive)throw new Error('An activity generation operation is already active.');
  store.assertWriter();
  // Core operations never depend on the topic window setting.
  if(graphOperation(operation)){const bootstrapNow=topicBootstrapRequired(store),buildNow=(bootstrapNow||topicBuildWindowOpen(store.clock(),rebuildWindow))&&topicBuildAllowed(store,store.clock(),{bootstrap:bootstrapNow,window:rebuildWindow});
   if(!buildNow){store.set('topicProjectionDirty',true);return {deferred:true,generation};}}
  store.generationTaskActive=true;
  try {
    let value;
    for(const step of operation==='publish'?['publish','topics']:[operation]){
    signal?.throwIfAborted();
    const graph=graphOperation(step),bootstrap=graph&&topicBootstrapRequired(store);
    if(graph&&(!bootstrap&&!topicBuildWindowOpen(store.clock(),rebuildWindow)||!topicBuildAllowed(store,store.clock(),{bootstrap,window:rebuildWindow}))){store.set('topicProjectionDirty',true);continue;}
    if(graph){
      // A build adds a publication beside the readable one. Skip it, rather
      // than let it push the index over the limit that pauses core indexing.
      let disk=topicBuildDiskCheck(store,diskLimit);
      // Rows left by a build that died count against the check; prune them and look again.
      if(!disk.ok){await pruneUnpublishedTopicData(store);signal?.throwIfAborted();disk=topicBuildDiskCheck(store,diskLimit);}
      if(!disk.ok){const failed=topicBuildFailed(store,`Index ${mib(disk.size)} MiB plus estimated topic projection ${mib(disk.needed)} MiB exceeds the ${mib(disk.diskLimit)} MiB disk limit.`,store.clock(),{skipped:true});store.set('topicProjectionDirty',true);
        console.warn('[topics-build]',JSON.stringify({operation:step,generation,outcome:'skipped',reason:'disk-limit',indexMiB:mib(disk.size),estimatedProjectionMiB:mib(disk.estimate),diskLimitMiB:mib(disk.diskLimit),failures:failed.failures,retryAt:new Date(failed.retryAt).toISOString()}));
        if(operation!=='publish')value={skipped:true,generation};continue;}
      topicBuildStarted(store,store.clock(),{bootstrap,window:rebuildWindow});
    }
    const metrics=graph?topicBuildMetrics({operation:step,generation}):null,elapsed=graph?null:loopTimer('activity-generation');
    let outcome='failed',details={};
    try{value=await new Promise((resolve,reject)=>{
      let thread,result,failure,complete=false;
      try {thread=createWorker(new URL('./activity-generation-worker.mjs',import.meta.url),{...(graph?{resourceLimits:topicBuildResourceLimits()}:{}),workerData:{directory:path.dirname(store.filename),owner:store.owner,operation:step,generation}});}
      catch(error){reject(error);return;}
      const abort=()=>{failure=signal.reason||new Error('Activity generation operation aborted.');void thread.terminate();};
      thread.on('message',message=>{
        if(Number.isFinite(message?.peakHeapMiB))details.peakHeapMiB=message.peakHeapMiB;
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
    });outcome='complete';if(graph){if(Number.isFinite(value?.projectionBytes))details.projectionMiB=mib(value.projectionBytes);topicBuildSucceeded(store);}}
    catch(error){
      // Only cancellation and lease loss stop the writer. A failed build keeps
      // the last publication, backs off, and lets core work continue.
      if(!graph||signal?.aborted||!store.renew())throw error;
      const failed=topicBuildFailed(store,error);store.set('topicProjectionDirty',true);Object.assign(details,{error:failed.error,failures:failed.failures,retryAt:new Date(failed.retryAt).toISOString()});
      if(operation!=='publish')value={failed:true,generation};
    }
    finally{metrics?.(outcome==='failed'&&signal?.aborted?'cancelled':outcome,{...details,heapLimitMiB:graph?topicBuildResourceLimits().maxOldGenerationSizeMb:undefined});elapsed?.({operation:step});}
    // SQLite commit and thread exit can consume part of the transaction's
    // final lease. Resume only after a live-owner renewal at the current clock;
    // an expired or replaced owner must reacquire on a later ordinary tick.
    if(!store.renew())throw new Error('Activity-index writer lease was lost.');
    }
    return value;
  } finally {store.generationTaskActive=false;store.invalidateMemberProfiles?.();}
}

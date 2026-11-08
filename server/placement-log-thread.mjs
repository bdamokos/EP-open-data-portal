import http from 'node:http';
import https from 'node:https';
import {setPriority} from 'node:os';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

// One thread per list, gone when the list is done, so idle use stays at zero.
export const PLACEMENT_LOG_THREAD=Object.freeze({timeoutMs:5*60_000,maxHeapMiB:384});

export function evaluateOffThread(job,{signal}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{placementLog:job},resourceLimits:{maxOldGenerationSizeMb:PLACEMENT_LOG_THREAD.maxHeapMiB}});
    let settled=false;
    const finish=(apply,value)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      void worker.terminate().catch(()=>{});
      apply(value);
    };
    const abort=()=>finish(reject,signal.reason);
    const timer=setTimeout(()=>finish(reject,Object.assign(new Error('Placement evaluation exceeded its time limit.'),{code:'evaluation-time-limit'})),PLACEMENT_LOG_THREAD.timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.on('message',message=>message.error?finish(reject,Object.assign(new Error(message.error.message),{code:message.error.code})):finish(resolve,message.result));
    worker.on('error',error=>finish(reject,error));
    worker.on('exit',code=>finish(reject,Object.assign(new Error(`Placement evaluation thread exited (${code}).`),{code:'evaluation-thread-exit'})));
    worker.unref();
  });
}

// Everything below runs only in the thread: placement modules stay out of the
// writer's memory, and this thread alone has its network calls refused.
if(!isMainThread&&workerData?.placementLog) {
  const job=workerData.placementLog;
  const refuse=()=>{throw Object.assign(new Error('The source is not held.'),{code:'source-not-held'});};
  globalThis.fetch=refuse;
  for(const client of [http,https]){client.request=refuse;client.get=refuse;}
  // Lowest priority: visitors and the writer come first. Linux applies this to the
  // calling thread; elsewhere it would slow the whole process.
  if(process.platform==='linux')try{setPriority(0,19);}catch{/* Still bounded and one at a time. */}
  const run=async()=>{
    const {placementEvaluator,evaluateList}=await import('./placement-log-evaluate.mjs');
    if(job.kind==='evaluator')return {evaluator:placementEvaluator()};
    const {ActivityStore}=await import('./activity-index-store.mjs');
    const store=new ActivityStore(job.indexDirectory,{readOnly:true});
    try {return {...await evaluateList({store,listId:job.listId,directory:job.cacheDirectory}),evaluator:placementEvaluator()};}
    finally {store.close();}
  };
  run().then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:{message:String(error?.message).slice(0,200),code:error?.code||error?.name||'evaluation-error'}}));
}

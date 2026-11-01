import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {extractAmendments} from './amendment-documents.mjs';

// Amendment-list parsing is synchronous CPU work: a few milliseconds for most
// lists, over half a second for the largest. The index writer runs it on one
// lazily started thread so request handling keeps the main event loop. The
// thread exits after a short idle period, so idle use stays at zero.
export const AMENDMENT_EXTRACTION_THREAD=Object.freeze({idleMs:15_000,timeoutMs:60_000,maxHeapMiB:256});

let thread=null,idleTimer=null,sequence=0;
const pending=new Map();
function stopThread(target,error) {
  if(thread!==target)return;
  thread=null;clearTimeout(idleTimer);idleTimer=null;
  for(const [id,entry] of pending){
    pending.delete(id);clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);entry.reject(error);
  }
  void target.terminate().catch(()=>{});
}
function startThread() {
  const worker=new Worker(new URL(import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:AMENDMENT_EXTRACTION_THREAD.maxHeapMiB}});
  worker.on('message',({id,result,error})=>{
    const entry=pending.get(id);if(!entry)return;
    pending.delete(id);clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);
    if(error)entry.reject(Object.assign(new Error(error.message),{name:error.name,code:error.code,sourceHash:error.sourceHash}));else entry.resolve(result);
    if(!pending.size&&thread===worker){clearTimeout(idleTimer);idleTimer=setTimeout(()=>stopThread(worker,new Error('Amendment extraction thread stopped.')),AMENDMENT_EXTRACTION_THREAD.idleMs);idleTimer.unref();}
  });
  worker.on('error',error=>stopThread(worker,error));
  worker.on('exit',code=>stopThread(worker,new Error(`Amendment extraction thread exited (${code}).`)));
  // Unreference after adding listeners, which would otherwise hold the process.
  worker.unref();
  return worker;
}

// Same result as extractAmendments(buffer, options); the buffer is copied.
export function extractAmendmentsOffThread(buffer,options,{signal}={}) {
  signal?.throwIfAborted();
  clearTimeout(idleTimer);idleTimer=null;
  thread??=startThread();
  const worker=thread,id=++sequence;
  return new Promise((resolve,reject)=>{
    const entry={resolve,reject,signal};
    // A stuck or cancelled parse ends the thread; the next call starts another.
    entry.timer=setTimeout(()=>stopThread(worker,new Error('Amendment extraction exceeded its time limit.')),AMENDMENT_EXTRACTION_THREAD.timeoutMs);
    entry.abort=()=>stopThread(worker,signal.reason);
    signal?.addEventListener('abort',entry.abort,{once:true});
    pending.set(id,entry);
    worker.postMessage({id,buffer:new Uint8Array(buffer),options});
  });
}

// Background extraction runs between request bursts: each slice waits at
// least as long as the previous slice took (at most half of one core), and
// waits again while timers fire late, which means the loop is serving work.
export const AMENDMENT_EXTRACTION_PACE=Object.freeze({minGapMs:25,busyLagMs:20,maxWaitMs:5000});
export async function extractionTurn(state,{signal,now=()=>performance.now()}={}) {
  const {minGapMs,busyLagMs,maxWaitMs}=AMENDMENT_EXTRACTION_PACE;
  if(state.endedAt==null)return;
  let wait=Math.max(minGapMs,state.lastMs ?? 0)-(now()-state.endedAt),waited=0;
  while(wait>0&&waited<maxWaitMs) {
    const started=now();
    await sleep(wait,undefined,{signal});
    const elapsed=now()-started;waited+=elapsed;
    wait=elapsed-wait>busyLagMs?Math.min(2*wait,maxWaitMs-waited):0;
  }
}
export function endExtractionTurn(state,startedAt,{now=()=>performance.now()}={}) {
  state.endedAt=now();state.lastMs=state.endedAt-startedAt;
}

if(!isMainThread&&parentPort) {
  parentPort.on('message',({id,buffer,options})=>{
    try {parentPort.postMessage({id,result:extractAmendments(Buffer.from(buffer.buffer,buffer.byteOffset,buffer.byteLength),options)});}
    catch(error){parentPort.postMessage({id,error:{name:error?.name || 'Error',message:String(error?.message ?? error),code:'source_parser_rejection',sourceHash:createHash('sha256').update(buffer).digest('hex')}});}
  });
}

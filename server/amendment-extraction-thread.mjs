import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';

// Document parsing is synchronous CPU work: a few milliseconds for most
// amendment lists, seconds for the largest lists and Commission proposals. It
// runs on one lazily started, memory-limited thread so the HTTP thread and the
// index writer keep their event loops. The thread exits after a short idle
// period, so idle use stays at zero. A job that exhausts the heap or the time
// limit ends only that job: the thread is replaced and queued jobs still run.
export const AMENDMENT_EXTRACTION_THREAD=Object.freeze({idleMs:15_000,timeoutMs:60_000,maxHeapMiB:256});
// Visitor requests. The heaviest measured parse (the A-10-2026-0105 body, 8.6 MB
// of XML) fails below 150 MiB and runs without GC pressure from 192 MiB; the
// 384 MiB limit leaves twice that. The time limit covers a slow host; a job
// that outlives its request still fills the cache.
export const DOCUMENT_PARSE_THREAD=Object.freeze({idleMs:15_000,timeoutMs:180_000,maxHeapMiB:384,maxQueued:16});

const stopped=message=>Object.assign(new Error(message),{code:'document_parse_stopped'});

// `run(task,payload,{signal,abortRunning,onStart})` resolves with the task's result;
// `onStart` is called when the job reaches the thread.
// Aborting the signal drops a queued job. A running job is stopped when
// `abortRunning` is set (the default) and otherwise finishes in the background.
export function createParseThread({idleMs,timeoutMs,maxHeapMiB,maxQueued=Infinity,workerUrl=new URL(import.meta.url)}) {
  let worker=null,idleTimer=null,current=null,sequence=0;
  const queue=[];

  const settle=(job,method,value)=>{
    const waiter=job.waiter;job.waiter=null;
    if(!waiter)return;
    waiter.signal?.removeEventListener('abort',waiter.abort);waiter[method](value);
  };
  function stopWorker() {
    const target=worker;worker=null;
    if(target)void target.terminate().catch(()=>{});
  }
  function startWorker() {
    const target=new Worker(workerUrl,{workerData:{parseThread:true},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:maxHeapMiB}});
    target.on('message',({id,result,error})=>{
      if(worker!==target||current?.id!==id)return;
      const job=current;current=null;clearTimeout(job.timer);
      if(error)settle(job,'reject',Object.assign(new Error(error.message),{name:error.name,code:error.code,sourceHash:error.sourceHash}));else settle(job,'resolve',result);
      pump();
    });
    // An out-of-memory stop arrives as an error followed by an exit.
    const lost=error=>{
      if(worker!==target)return;
      worker=null;
      const job=current;current=null;
      if(job){clearTimeout(job.timer);settle(job,'reject',error);}
      pump();
    };
    target.on('error',lost);
    target.on('exit',code=>lost(stopped(`Document parse thread exited (${code}).`)));
    // Unreference after adding listeners, which would otherwise hold the process.
    target.unref();
    return target;
  }
  function pump() {
    if(current)return;
    const job=queue.shift();
    if(!job) {
      if(worker&&!idleTimer){
        const target=worker;idleTimer=setTimeout(()=>{idleTimer=null;if(worker===target&&!current)stopWorker();},idleMs);idleTimer.unref();
      }
      return;
    }
    clearTimeout(idleTimer);idleTimer=null;
    worker??=startWorker();
    current=job;
    job.timer=setTimeout(()=>{
      if(current!==job)return;
      current=null;stopWorker();
      settle(job,'reject',Object.assign(new Error('Document parsing exceeded its time limit.'),{code:'document_parse_timeout'}));pump();
    },timeoutMs);
    job.onStart?.();
    worker.postMessage({id:job.id,task:job.task,payload:job.payload});
  }

  return {
    run(task,payload,{signal,abortRunning=true,onStart}={}) {
      if(signal?.aborted)return Promise.reject(signal.reason);
      if(queue.length>=maxQueued)return Promise.reject(Object.assign(new Error('Document parsing is busy.'),{code:'document_parse_busy'}));
      return new Promise((resolve,reject)=>{
        const job={id:++sequence,task,payload,onStart,timer:null,waiter:null},waiter={resolve,reject,signal};
        waiter.abort=()=>{
          if(job.waiter!==waiter)return;
          const queued=queue.indexOf(job);
          // A running job nobody may stop keeps its waiter and delivers its result.
          if(queued<0&&!abortRunning)return;
          settle(job,'reject',signal.reason);
          if(queued>=0)queue.splice(queued,1);
          else if(current===job){clearTimeout(job.timer);current=null;stopWorker();pump();}
        };
        signal?.addEventListener('abort',waiter.abort,{once:true});
        job.waiter=waiter;queue.push(job);
        pump();
      });
    },
    // Whether a worker exists, for tests and diagnostics.
    get active() {return worker!==null;},
    close() {
      clearTimeout(idleTimer);idleTimer=null;
      const error=stopped('Document parse thread closed.');
      for(const job of [current,...queue])if(job){clearTimeout(job.timer);settle(job,'reject',error);}
      queue.length=0;current=null;stopWorker();
    },
  };
}

const extractionThread=createParseThread(AMENDMENT_EXTRACTION_THREAD);
// Same result as extractAmendments(buffer, options); the buffer is copied.
export function extractAmendmentsOffThread(buffer,options,{signal}={}) {
  return extractionThread.run('amendments',{buffer:new Uint8Array(buffer),options},{signal});
}

let documentThread=null;
// The thread behind visitor-facing document parsing; started on first use.
export const documentParseThread={
  run:(...args)=>(documentThread??=createParseThread(DOCUMENT_PARSE_THREAD)).run(...args),
  get active() {return documentThread?.active??false;},
  close() {documentThread?.close();documentThread=null;},
};

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

const asBuffer=bytes=>Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
// Visitor requests receive the JSON text, which is also what the disk cache
// stores, so a fresh parse and a cached one hand out the same data.
const tasks={
  async amendments({buffer,options}) {
    const {extractAmendments}=await import('./amendment-documents.mjs');
    return extractAmendments(asBuffer(buffer),options);
  },
  async 'amendments-json'({buffer,options}) {
    const {extractAmendments}=await import('./amendment-documents.mjs');
    return {json:JSON.stringify(extractAmendments(asBuffer(buffer),options))};
  },
  // Sizes follow the reader's two projections: the record as parsed, and with
  // its image bytes replaced by descriptors. A record over the limit in both is
  // reported by size alone; the caller could not serve it.
  async 'proposal-json'({parser,input,options,limitBytes}) {
    const [{parseProposal},{parsePublicLegalXhtml},{documentImageDescriptors}]=await Promise.all([import('./proposal-structure.mjs'),import('./public-legal-xhtml.mjs'),import('./docx-images.mjs')]);
    const source=input instanceof Uint8Array?asBuffer(input):input;
    const parsed=(parser==='xhtml'?parsePublicLegalXhtml:parseProposal)(source,options);
    const json=JSON.stringify(parsed);
    const rawBytes=Buffer.byteLength(json),describedBytes=Buffer.byteLength(JSON.stringify({...parsed,imageAssets:documentImageDescriptors(parsed)}));
    return {rawBytes,describedBytes,...(Math.min(rawBytes,describedBytes)>limitBytes?{}:{json})};
  },
};

// Importing this helper inside the source writer must not install a parser on
// that writer's control port. Only the dedicated parse thread receives it.
if(!isMainThread&&workerData?.parseThread&&parentPort) {
  parentPort.on('message',async({id,task,payload})=>{
    try {parentPort.postMessage({id,result:await tasks[task](payload)});}
    catch(error) {
      const bytes=payload?.buffer??payload?.input;
      parentPort.postMessage({id,error:{name:error?.name || 'Error',message:String(error?.message ?? error),code:'source_parser_rejection',
        ...(bytes instanceof Uint8Array?{sourceHash:createHash('sha256').update(bytes).digest('hex')}:{})}});
    }
  });
}

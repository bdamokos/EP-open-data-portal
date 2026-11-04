import {rebuildTopicProjection} from './topic-publication.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {getHeapStatistics} from 'node:v8';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';

// Keep this entry module synchronous: top-level await makes V8 evaluate it as an
// async module, and terminating a worker mid-evaluation can abort the process.
const BEGIN_PAUSE_RATIO=0.5,BEGIN_PAUSE_MAX_MS=1000;
let store,message,peakHeap=0;
// Give the disk back between commits of a rotation: visitors and other services
// wait on the same USB drive. Termination still interrupts the wait.
const beginPause=new Int32Array(new SharedArrayBuffer(4));
const pause=elapsedMs=>Atomics.wait(beginPause,0,0,Math.min(BEGIN_PAUSE_MAX_MS,elapsedMs*BEGIN_PAUSE_RATIO));
// Graph builds report their own heap high-water mark to size the thread limit.
const sampleHeap=()=>{peakHeap=Math.max(peakHeap,getHeapStatistics().used_heap_size);},heapTimer=['topics','stories'].includes(workerData.operation)?setInterval(sampleHeap,250):null;heapTimer?.unref();
async function run() {
  try {
    const {directory,owner,operation,generation}=workerData;
    if(!existsSync(path.join(directory,'activities-v1.sqlite')))throw new Error('Prepared activity database is unavailable.');
    if(!['begin','publish','topics','stories'].includes(operation)||operation!=='begin'&&(!Number.isSafeInteger(generation)||generation<1))throw new Error('Invalid activity generation operation.');
    // Worker statements are otherwise unobserved; these transactions are long, so log only the outliers.
    store=new ActivityStore(directory,{preparedOnly:true,observation:{enabled:true,threshold:30_000}});
    // No acquisition or collector starts here. The caller remains the sole
    // logical owner; begin/publish check it after obtaining BEGIN IMMEDIATE.
    store.owner=owner;
    let value;if(operation==='begin')value=store.beginCycle({pause,memoryTemp:true});else if(operation==='publish')value=store.finalize(generation);else value=await rebuildTopicProjection(store,{generation});
    message={type:'complete',value,...(heapTimer?{peakHeapMiB:(sampleHeap(),Math.round(peakHeap/10485.76)/100)}:{})};
  } catch(error){message={type:'failed',error:error.message,...(heapTimer?{peakHeapMiB:(sampleHeap(),Math.round(peakHeap/10485.76)/100)}:{})};}
  finally {
    clearInterval(heapTimer);
    // close() would release the caller's lease. Only this connection is closed;
    // the caller resumes ownership after the thread exits.
    store?.db.close();
  }
  parentPort.postMessage(message);parentPort.close();
}
void run();

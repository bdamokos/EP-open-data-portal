import v8 from 'node:v8';
import vm from 'node:vm';

// A heavy request leaves tens of megabytes of garbage on the main heap. V8
// collects it when allocation pressure returns, and an idle process has none,
// so the memory would stay resident until the next heavy request. One full
// collection shortly after such a burst returns it. The collector is reached
// without a process flag. V8 reads --expose-gc only when it creates a context,
// so setting it at run time affects just the one context made here, whose gc()
// collects the whole isolate. A full collection pauses the HTTP thread, so at
// most one runs per `minIntervalMs`.
export const MEMORY_RELEASE=Object.freeze({heapBytes:48*1024*1024,rssBytes:128*1024*1024,delayMs:2000,minIntervalMs:60_000});

function exposedCollector() {
  if(typeof globalThis.gc==='function')return globalThis.gc;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc');
  } catch {return null;}
}

let timer=null,collector,lastRun=-Infinity;
// Collect once, `delayMs` after the last call and no sooner than `minIntervalMs`
// after the previous collection. The timer never keeps the process alive.
export function scheduleCollection({delayMs=MEMORY_RELEASE.delayMs,minIntervalMs=MEMORY_RELEASE.minIntervalMs,collect,now=()=>performance.now()}={}) {
  clearTimeout(timer);
  const arm=wait=>{
    timer=setTimeout(()=>{
      const early=lastRun+minIntervalMs-now();
      if(early>0){arm(early);return;}
      timer=null;lastRun=now();
      const run=collect??(collector===undefined?(collector=exposedCollector()):collector);
      try {run?.();} catch {/* A failed collection only leaves the memory for V8 to reclaim later. */}
    },wait);
    timer.unref();
  };
  arm(delayMs);
}
export function cancelCollection() {clearTimeout(timer);timer=null;}
// For tests: forget when the last collection ran.
export function resetCollectionInterval() {lastRun=-Infinity;}
// Whether a collection is waiting to run, for tests and diagnostics.
export const collectionPending=()=>timer!==null;

// Called with what a request or job grew the process by, in bytes.
export function collectAfterBurst({heapGrowth,rssGrowth},options) {
  if(heapGrowth>=MEMORY_RELEASE.heapBytes||rssGrowth>=MEMORY_RELEASE.rssBytes)scheduleCollection(options);
}

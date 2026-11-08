import v8 from 'node:v8';
import vm from 'node:vm';

// A heavy request leaves tens of megabytes of garbage on the main heap. V8
// collects it when allocation pressure returns, and an idle process has none,
// so the memory would stay resident until the next heavy request. One full
// collection shortly after such a burst returns it. The collector is reached
// without a process flag: --expose-gc is switched on for new contexts only.
export const MEMORY_RELEASE=Object.freeze({heapBytes:48*1024*1024,rssBytes:128*1024*1024,delayMs:2000});

function exposedCollector() {
  if(typeof globalThis.gc==='function')return globalThis.gc;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc');
  } catch {return null;}
}

let timer=null,collector;
// Collect once, `delayMs` after the last call. The timer never keeps the process alive.
export function scheduleCollection({delayMs=MEMORY_RELEASE.delayMs,collect}={}) {
  clearTimeout(timer);
  timer=setTimeout(()=>{
    timer=null;
    const run=collect??(collector===undefined?(collector=exposedCollector()):collector);
    try {run?.();} catch {/* A failed collection only leaves the memory for V8 to reclaim later. */}
  },delayMs);
  timer.unref();
}
export function cancelCollection() {clearTimeout(timer);timer=null;}
// Whether a collection is waiting to run, for tests and diagnostics.
export const collectionPending=()=>timer!==null;

// Called with what a request or job grew the process by, in bytes.
export function collectAfterBurst({heapGrowth,rssGrowth},options) {
  if(heapGrowth>=MEMORY_RELEASE.heapBytes||rssGrowth>=MEMORY_RELEASE.rssBytes)scheduleCollection(options);
}

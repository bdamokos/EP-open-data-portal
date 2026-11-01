import {Worker,MessageChannel} from 'node:worker_threads';
import {booleanFromEnvironment} from './config.mjs';
import {upstreamPortServices} from './odp.mjs';
import {serveUpstreamPort} from './upstream-rpc.mjs';
import {forwardSittingSnapshotHints} from './sitting-snapshot-hints-rpc.mjs';

// One worker owns both existing loops. A replacement starts only after exit;
// durable SQLite leases still fence any unfinished generation task.
export function startSourceWriters({
  enabled=booleanFromEnvironment('ACTIVITY_INDEX_ENABLED')||booleanFromEnvironment('CORPUS_ENABLED'),
  createWorker=(url,options)=>new Worker(url,options),
  workerUrl=new URL('./source-writers-thread.mjs',import.meta.url),workerData={},
  services=upstreamPortServices(),onPublication=()=>{},log=console.error,
  restartMs=1000,maxRestartMs=60_000,drainMs=30_000,
}={}) {
  let worker,disposePort,restartTimer,stopping=false,attempt=0,exited=Promise.resolve();
  const launch=()=>{
    if(stopping)return;
    const {port1,port2}=new MessageChannel();
    disposePort=serveUpstreamPort(port1,services);
    const started=Date.now();
    try {worker=createWorker(workerUrl,{workerData:{...workerData,upstreamPort:port2},transferList:[port2],resourceLimits:{maxOldGenerationSizeMb:512}});}
    catch(error){disposePort();port2.close();log('[source-writers]',error.message);schedule();return;}
    const stopHints=forwardSittingSnapshotHints(worker);
    exited=new Promise(resolve=>{
      worker.on('message',message=>{if(message?.type==='publication')onPublication(message);});
      worker.once('error',error=>log('[source-writers]',error.message));
      worker.once('exit',code=>{
        stopHints();disposePort();worker=undefined;resolve();
        if(!stopping){log('[source-writers]',`Worker exited (${code}); restarting.`);if(Date.now()-started>=60_000)attempt=0;schedule();}
      });
    });
  };
  const schedule=()=>{
    const delay=Math.min(maxRestartMs,restartMs*2**Math.min(attempt++,16));
    restartTimer=setTimeout(launch,delay);restartTimer.unref();
  };
  if(enabled)launch();
  let stopPromise;
  return ()=>stopPromise??=(async()=>{
    stopping=true;clearTimeout(restartTimer);
    if(!worker)return;
    worker.postMessage({type:'shutdown'});
    const timer=setTimeout(()=>{
      log('[source-writers]','Drain deadline exceeded; terminating worker. Leases expire normally.');
      void worker?.terminate();
    },drainMs);timer.unref();
    try {await exited;}finally {clearTimeout(timer);}
  })();
}

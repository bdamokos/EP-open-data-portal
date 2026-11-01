import {parentPort,workerData} from 'node:worker_threads';
import {setUpstreamBridge} from './odp.mjs';
import {UpstreamRpcClient} from './upstream-rpc.mjs';
import {activityIndex,startActivityIndex} from './activity-index-worker.mjs';
import {corpus,startCorpus} from './corpus-worker.mjs';
import {observePublications} from './source-publications.mjs';
import {booleanFromEnvironment} from './config.mjs';

const rpc=new UpstreamRpcClient(workerData.upstreamPort);
setUpstreamBridge(rpc);
let stopActivity=()=>{},stopCorpus=()=>{},closing=false;
const stores=[];
const unobserve=[];
parentPort.on('message',message=>{
  if(message?.type!=='shutdown'||closing)return;
  closing=true;
  void (async()=>{
    await Promise.all([stopActivity(),stopCorpus()]);
    for(const stop of unobserve)stop();
    for(const service of stores){service.press?.close();service.store.close();}
    rpc.close();parentPort.close();
  })().catch(error=>{console.error('[source-writers]',error.message);process.exitCode=1;rpc.close();parentPort.close();});
});
if(booleanFromEnvironment('ACTIVITY_INDEX_ENABLED')){
  const service=activityIndex();stores.push(service);unobserve.push(observePublications(service.store,'activity',message=>parentPort.postMessage(message)));
  // Generation preparation/publication already use a nested thread under this
  // same writer's lease. Notify after its committed result is visible here.
  const execute=service.worker.generationExecutor;
  service.worker.generationExecutor=async(...args)=>{const value=await execute(...args);service.store.onCommit?.();return value;};
  stopActivity=startActivityIndex();
}
if(booleanFromEnvironment('CORPUS_ENABLED')){
  const service=corpus();stores.push(service);unobserve.push(observePublications(service.store,'corpus',message=>parentPort.postMessage(message)));
  stopCorpus=startCorpus();
}

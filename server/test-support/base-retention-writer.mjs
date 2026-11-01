import {parentPort,isMainThread,threadId} from 'node:worker_threads';
import {BaseSourceStore} from '../base-source-store.mjs';
const publish=BaseSourceStore.prototype.publish;
BaseSourceStore.prototype.publish=async function(...args){
  const value=await publish.apply(this,args);
  parentPort.postMessage({type:'retention-test',isMainThread,threadId,value});return value;
};
await import('../source-writers-thread.mjs');
parentPort.postMessage({type:'ready'});

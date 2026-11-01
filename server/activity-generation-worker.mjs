import {buildTopics} from './topics-project.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';

let store,message;
try {
  const {directory,owner,operation,generation}=workerData;
  if(!existsSync(path.join(directory,'activities-v1.sqlite')))throw new Error('Prepared activity database is unavailable.');
  if(!['begin','publish','topics'].includes(operation)||operation!=='begin'&&(!Number.isSafeInteger(generation)||generation<1))throw new Error('Invalid activity generation operation.');
  store=new ActivityStore(directory,{preparedOnly:true});
  // No acquisition or collector starts here. The caller remains the sole
  // logical owner; begin/publish check it after obtaining BEGIN IMMEDIATE.
  store.owner=owner;
  let value;if(operation==='begin')value=store.beginCycle();else if(operation==='publish')value=store.finalize(generation);else {value=await buildTopics(store,{generation});store.set('topicProjectionDirty',false);}
  message={type:'complete',value};
} catch(error){message={type:'failed',error:error.message};}
finally {
  // close() would release the caller's lease. Only this connection is closed;
  // the caller resumes ownership after the thread exits.
  store?.db.close();
}
parentPort.postMessage(message);parentPort.close();

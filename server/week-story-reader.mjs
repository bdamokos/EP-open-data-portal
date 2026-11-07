import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {SittingSnapshotReader} from './sitting-snapshot-store.mjs';
import {projectWeekVoteFacts} from './week-story-votes.mjs';
import {SerialFactReads} from './week-story-queue.mjs';
import {waitForRequest,requestSignal} from './request-budget.mjs';

// Snapshot decompression, evidence graphs and history JSON parsing are all
// synchronous. Keep the entire projection off the HTTP event loop.
const reads=new SerialFactReads();
export function retainedWeekVoteFacts(params) {return reads.read(JSON.stringify(params),()=>readVoteFacts(params)).catch(()=>{requestSignal()?.throwIfAborted();return {votes:[],storyVotes:[],agenda:[],completeVotes:false,transientReadFailure:true};});}
async function readVoteFacts({ids,directory,generation}) {
 if(!directory)return {votes:[],storyVotes:[],agenda:[],completeVotes:false};
 const worker=new Worker(new URL(import.meta.url),{workerData:{type:'week-story-votes',ids,directory,generation}});let timer;
 try {
  return await waitForRequest(new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(new Error('Week vote projection timed out')),8000);
   worker.once('message',m=>m.error?reject(new Error(m.error)):resolve(m.result));
   worker.once('error',reject);worker.once('exit',code=>reject(new Error('Week vote reader exited '+code)));
  }));
 }finally{clearTimeout(timer);await worker.terminate();}
}
if(!isMainThread&&workerData?.type==='week-story-votes')void (async()=>{
 let db;
 try {
  db=new DatabaseSync(path.join(workerData.directory,'activities-v1.sqlite'),{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=250');
  const store={db,get:key=>{const row=db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;},status:()=>({servingGeneration:workerData.generation})};
  const result=await projectWeekVoteFacts(workerData.ids,{store,snapshots:new SittingSnapshotReader({db})});parentPort.postMessage({result});
 }catch(error){parentPort.postMessage({error:error.message});}finally{db?.close();}
})();

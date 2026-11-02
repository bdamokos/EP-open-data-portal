import {Worker} from 'node:worker_threads';
import {HttpError} from './http-utils.mjs';
// Up to two long-lived read-only workers serve topic reads. Further requests
// wait briefly in a bounded queue before 503. Idle workers exit after minutes.
export const topicReaderSettings={workers:2,waitMs:3000,queue:16,timeoutMs:10000,idleMs:300_000};
const idle=[],waiting=[];let size=0,sequence=0;
const busy=()=>new HttpError(503,'topics_busy','Topics unavailable.');
export const topicReaderWorkers=()=>size;
function spawn(){
 const slot={worker:new Worker(new URL('./topics-reader-worker.mjs',import.meta.url)),job:null,failure:null,dead:false,idleTimer:null};size++;
 slot.worker.on('message',m=>{const job=slot.job;if(!job||m.id!==job.id)return;slot.job=null;clearTimeout(job.timer);if(m.error)job.reject(new HttpError(m.status||503,m.code||'topics_unavailable',m.error));else job.resolve(m.value);release(slot);});
 slot.worker.on('error',error=>{slot.failure=error;});
 slot.worker.once('exit',()=>{
  size--;slot.dead=true;clearTimeout(slot.idleTimer);const i=idle.indexOf(slot);if(i>=0)idle.splice(i,1);
  if(slot.job){const job=slot.job;slot.job=null;clearTimeout(job.timer);job.reject(slot.failure||new HttpError(503,'topics_unavailable','Topics unavailable.'));}
  if(waiting.length&&size<topicReaderSettings.workers)start(spawn(),take());
 });
 // Idle readers never keep the process alive; pending jobs hold their timers.
 slot.worker.unref();return slot;
}
function take(){const job=waiting.shift();clearTimeout(job.wait);return job;}
function start(slot,job){
 clearTimeout(slot.idleTimer);slot.job=job;
 job.timer=setTimeout(()=>{slot.failure=new HttpError(503,'topics_timeout','Topics unavailable.');void slot.worker.terminate();},topicReaderSettings.timeoutMs);
 slot.worker.postMessage({id:job.id,...job.request});
}
function release(slot){
 if(slot.dead)return;
 if(waiting.length){start(slot,take());return;}
 idle.push(slot);slot.idleTimer=setTimeout(()=>{const i=idle.indexOf(slot);if(i>=0){idle.splice(i,1);void slot.worker.terminate();}},topicReaderSettings.idleMs);slot.idleTimer.unref();
}
export function readTopics(filename,view,params,{pressFilename}={}){
 return new Promise((resolve,reject)=>{
  const job={id:++sequence,request:{filename,view,pressFilename,params:[...params]},resolve,reject};
  const slot=idle.pop();if(slot){start(slot,job);return;}
  if(size<topicReaderSettings.workers){start(spawn(),job);return;}
  if(waiting.length>=topicReaderSettings.queue){reject(busy());return;}
  job.wait=setTimeout(()=>{const i=waiting.indexOf(job);if(i>=0){waiting.splice(i,1);reject(busy());}},topicReaderSettings.waitMs);waiting.push(job);
 });
}

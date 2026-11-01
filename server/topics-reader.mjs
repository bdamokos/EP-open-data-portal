import {Worker} from 'node:worker_threads';
import {HttpError} from './http-utils.mjs';
let active=0;
export async function readTopics(filename,view,params){
 if(active>=2)throw new HttpError(503,'topics_busy','Topics unavailable.');active++;
 try{return await new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./topics-reader-worker.mjs',import.meta.url),{workerData:{filename,view,params:[...params]}});
 let value,failure;const timeout=setTimeout(()=>{failure=new HttpError(503,'topics_timeout','Topics unavailable.');void worker.terminate();},10000);
 worker.on('message',m=>{if(m.error)failure=new HttpError(m.status||503,m.code||'topics_unavailable',m.error);else value=m.value;});worker.on('error',e=>{failure=e;});worker.once('exit',()=>{clearTimeout(timeout);failure?reject(failure):resolve(value);});
 });}finally{active--;}
}

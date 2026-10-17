import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CorpusStore } from './corpus-store.mjs';
import { HttpError } from './http-utils.mjs';

// SQLite searches and status scans are synchronous. Run them on a read-only
// connection off the API thread; allow one query at a time and terminate slow
// readers so broad searches cannot queue unbounded work or delay writer leases.
export class CorpusReader {
  constructor(directory,{indexFile=null,timeoutMs=5000}={}) {
    Object.assign(this,{directory,indexFile,timeoutMs});this.busy=false;
  }
  async query(operation,params) {
    if(this.busy)throw new HttpError(503,'corpus_busy','A corpus query is already running. Please retry shortly.');
    this.busy=true;
    let worker,timer,timedOut=false;
    try {
      worker=new Worker(new URL(import.meta.url),{workerData:{directory:this.directory,indexFile:this.indexFile,operation,params}});
      return await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{timedOut=true;reject(new HttpError(503,'corpus_query_timeout','The corpus query took too long. Try fewer words or narrower filters.'));},this.timeoutMs);
        worker.once('message',message=>message.error?reject(new Error(message.error)):resolve(message.result));
        worker.once('error',reject);
        worker.once('exit',code=>reject(new Error(`Corpus reader exited before returning a result (${code}).`)));
      });
    } finally {
      clearTimeout(timer);
      // A native SQLite call may finish before the worker can terminate. Return
      // the timeout immediately, retaining the concurrency slot until it exits.
      if(worker && timedOut)void worker.terminate().finally(()=>{this.busy=false;});
      else {if(worker)await worker.terminate();this.busy=false;}
    }
  }
}

if(!isMainThread && workerData?.operation) {
  let store;
  try {
    store=new CorpusStore(workerData.directory,{indexFile:workerData.indexFile,readOnly:true});
    const result=workerData.operation==='speech-transcript'?store.speechTranscript(workerData.params):workerData.operation==='status'?store.status(workerData.params):workerData.operation==='text'?store.text(workerData.params):store.search(workerData.params);
    parentPort.postMessage({result:workerData.operation==='search' && result?{...result,coverage:store.coverage()}:result});
  } catch(error) {parentPort.postMessage({error:error.message});}
  finally {store?.close();}
}

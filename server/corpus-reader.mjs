import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CorpusStore } from './corpus-store.mjs';
import { HttpError } from './http-utils.mjs';
import {cachedSpeakerIdentities} from './odp.mjs';

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
      worker=new Worker(new URL(import.meta.url),{workerData:{directory:this.directory,indexFile:this.indexFile,operation,params,deadlineMs:Date.now()+this.timeoutMs}});
      return await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{timedOut=true;reject(new HttpError(503,'corpus_query_timeout','The corpus query took too long. Try fewer words or narrower filters.'));},this.timeoutMs);
        worker.once('message',message=>message.error?reject(new Error(message.error)):resolve(message.result));
        worker.once('error',reject);
        worker.once('exit',code=>reject(new Error(`Corpus reader exited before returning a result (${code}).`)));
      });
    } finally {
      clearTimeout(timer);
      // Native SQLite or optional cache-file I/O can delay termination. Return
      // transcript results/timeouts immediately, but keep the slot until exit.
      if(worker && (timedOut||operation.startsWith('speech-'))) {
        void worker.terminate().then(()=>{this.busy=false;},()=>{});
      }
      else {if(worker)await worker.terminate();this.busy=false;}
    }
  }
}

// Identity enrichment is optional. Leave time for returning the retained text
// even when a cached roster/profile read is slow or unavailable.
export async function retainedSpeechMetadata(result,{deadlineMs=Date.now()+1000,enrich=(...args)=>cachedSpeakerIdentities.enrich(...args)}={}) {
  const {summary,speakers:people,sourceUrl,fetchedAt,headerSources,availableTextLanguages=[]}=result.metadataRecord;
  const waitMs=Math.max(0,Math.min(250,deadlineMs-Date.now()-100));
  let speakers=people,timer;
  if(waitMs>0)try {
    speakers=await Promise.race([
      enrich(people,summary.date,{chairs:people.filter(person=>person.sittingRole==='chair').map(person=>person.id),profileIds:people.map(person=>person.id)}),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(people),waitMs);}),
    ]);
  }catch { /* The retained header remains usable without identity enrichment. */ }
  finally {clearTimeout(timer);}
  return {...summary,speakers,xml:null,textLanguage:result.textLanguage,translationType:result.translationType,
    sourceFragmentKey:result.sourceFragmentKey,availableTextLanguages:[...new Set([...result.availableTextLanguages,...availableTextLanguages])],fetchedAt:result.fetchedAt,
    textCache:{sourceFetchedAt:result.fetchedAt,stale:false,refreshInProgress:false,refreshError:null,availableLanguages:result.availableTextLanguages,coverage:'returned-languages-only'},
    video:{available:false,reason:'Recording lookup uses the separate speech media service.'},
    metadataSource:{url:sourceUrl,fetchedAt,headerSources}};
}

if(!isMainThread && workerData?.operation) {
  let store;
  try {
    store=new CorpusStore(workerData.directory,{indexFile:workerData.indexFile,readOnly:true});
    const result=workerData.operation==='speech-transcript'?store.speechTranscript(workerData.params):workerData.operation==='speech-data'?store.speechData(workerData.params):workerData.operation==='speech-page'?store.speechPage(workerData.params):workerData.operation==='status'?store.status(workerData.params):workerData.operation==='text'?store.text(workerData.params):store.search(workerData.params);
    if(workerData.operation==='speech-transcript'&&result.metadataRecord) {
      try {
        result.metadata=await retainedSpeechMetadata(result,{deadlineMs:workerData.deadlineMs});
      }catch {result.metadataUnavailable=true;}
    }
    if(workerData.operation==='speech-transcript')delete result.metadataRecord;
    parentPort.postMessage({result:workerData.operation==='search' && result?{...result,coverage:store.coverage()}:result});
  } catch(error) {parentPort.postMessage({error:error.message});}
  finally {store?.close();}
}

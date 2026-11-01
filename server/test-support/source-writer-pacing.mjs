// Exercise the production pacing and shutdown paths without public downloads.
import {writeFileSync} from 'node:fs';
import {CorpusWorker} from '../corpus-worker.mjs';
const marker=process.env.TEST_SOURCE_WRITER_PACING_FILE;
if(marker){
  globalThis.fetch=async(url,{signal}={})=>{
    signal?.throwIfAborted();
    if(!String(url).includes('www.europarl.europa.eu'))return new Response(null,{status:204});
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  };
  const pace=CorpusWorker.prototype.pace;
  CorpusWorker.prototype.pace=function(){
    const waiting=this.lastRequest+this.interval-this.clock()>0;
    const pending=pace.call(this);
    if(waiting)writeFileSync(marker,'pacing');
    return pending;
  };
}

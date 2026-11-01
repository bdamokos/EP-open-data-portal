// Test-only preload inherited by the real server and its writer thread. Patch
// the actual activity iteration, without replacing production startup or URLs.
import {existsSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {ActivityWorker} from '../activity-index-worker.mjs';

const marker=process.env.TEST_SOURCE_WRITER_BLOCK_FILE;
if(marker){
  const iteration=ActivityWorker.prototype.runIteration;
  let blocked=false;
  ActivityWorker.prototype.runIteration=async function(...args){
    if(!blocked){
      blocked=true;
      writeFileSync(`${marker}.ready`,'ready');
      const deadline=Date.now()+15000;
      while(!existsSync(`${marker}.go`)){
        if(Date.now()>deadline)throw new Error('Writer test barrier timed out.');
        await delay(5);
      }
      writeFileSync(`${marker}.start`,String(Date.now()));
      const end=performance.now()+2000;
      while(performance.now()<end){} // Deliberately block this writer's isolate.
      writeFileSync(`${marker}.end`,String(Date.now()));
    }
    return iteration.apply(this,args);
  };
}

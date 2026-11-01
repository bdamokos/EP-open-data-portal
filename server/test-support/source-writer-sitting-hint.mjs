// Inherited by the production server and its actual source writer. Only source
// reads are fixtures; the HTTP reader, hint transport and collector are real.
import {writeFileSync} from 'node:fs';
import {isMainThread} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {MemberVotes} from '../member-votes.mjs';
import {ActivityWorker} from '../activity-index-worker.mjs';
import {snapshotFixture} from './sitting-snapshots.mjs';

const marker=process.env.TEST_SOURCE_WRITER_HINT_FILE;
if(marker&&isMainThread){
  const catalogue=MemberVotes.prototype.catalogue;
  MemberVotes.prototype.catalogue=function(...args){
    this.request=snapshotFixture().request;this.readChairs=async()=>null;
    return catalogue.apply(this,args);
  };
}else if(marker){
  ActivityWorker.prototype.runIteration=async function(){
    if(this.stopped)return;
    const collector=this.sittingSnapshots,deadline=Date.now()+15000;
    writeFileSync(`${marker}.ready`,'ready');
    while(!collector.hints.size){
      if(this.stopped)return;
      if(Date.now()>deadline)throw new Error('HTTP sitting hint did not reach writer.');
      await delay(5);
    }
    if(!this.store.acquire())throw new Error('Test writer could not acquire its lease.');
    try{
      collector.admit();
      writeFileSync(marker,JSON.stringify({isMainThread,hintsLeft:collector.hints.size,
        jobs:this.store.db.prepare('SELECT kind,version,id,priority FROM sitting_snapshots WHERE priority=100').all()}));
    }finally{this.store.release();}
  };
}

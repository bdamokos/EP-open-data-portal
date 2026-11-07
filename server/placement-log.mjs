import path from 'node:path';
import {commitEvaluation,hasDueList,hasOpenFailures,dueLists,recordEvaluationFailure,reopenForEvaluator} from './placement-log-store.mjs';
import {evaluateOffThread} from './placement-log-thread.mjs';

// Records what a reader would see for amendments on lists first held after the
// log started. It holds the writer's lease only to commit, and the thread runs
// beside the writer's other lanes, which never wait for it. With nothing due it
// does one indexed lookup per tick and starts no thread.
export class PlacementLog {
  constructor(store,{evaluate=evaluateOffThread,clock=store.clock,monotonic=()=>performance.now(),indexDirectory=path.dirname(store.filename),cacheDirectory=process.env.ODP_CACHE_DIR,log=value=>console.info('[placement-log]',JSON.stringify(value))}={}) {
    Object.assign(this,{store,evaluate,clock,monotonic,indexDirectory,cacheDirectory,log});
    this.running=null;this.finished=null;this.controller=new AbortController();this.stopped=false;this.evaluatorChecked=false;this.nextStartAt=0;
  }
  due() {
    if(this.stopped)return false;
    if(this.finished)return true;
    if(this.running||this.monotonic()<this.nextStartAt)return false;
    return !this.evaluatorChecked&&hasOpenFailures(this.store)||hasDueList(this.store,this.clock());
  }
  // Runs inside a leased iteration and never waits for a thread.
  step() {
    if(this.stopped)return false;
    // A log failure never costs the writer its iteration. A lost lease also lands
    // here: nothing was committed, so the list stays due for the next owner.
    try {
      if(this.finished)this.commit();
      if(this.running||this.monotonic()<this.nextStartAt)return false;
      if(!this.evaluatorChecked&&hasOpenFailures(this.store)) {this.start({kind:'evaluator'},null);return true;}
      this.evaluatorChecked=true;
      const listId=dueLists(this.store,this.clock());
      if(!listId)return false;
      this.start({kind:'list',listId,indexDirectory:this.indexDirectory,cacheDirectory:this.cacheDirectory},listId);
      return true;
    }catch(error){this.log({error:String(error?.code||error?.message).slice(0,120)});return false;}
  }
  start(job,listId) {
    const startedAt=this.monotonic();
    this.running=this.evaluate(job,{signal:this.controller.signal}).then(result=>{this.finished={job,listId,result,startedAt};},error=>{this.finished={job,listId,error,startedAt};}).finally(()=>{this.running=null;});
  }
  commit() {
    const {job,listId,result,error,startedAt}=this.finished;this.finished=null;
    // At most half of one core: the next list waits as long as this one took.
    const elapsed=this.monotonic()-startedAt;this.nextStartAt=this.monotonic()+elapsed;
    if(error) {
      if(this.stopped)return;
      if(!listId){this.evaluatorChecked=true;return;}
      const failed=recordEvaluationFailure(this.store,listId,error.code||error.name||'evaluation-error',{now:this.clock()});
      this.log({list:listId,evaluation:failed?'failed':'will-retry',code:error.code||error.name||'evaluation-error'});
      return;
    }
    if(job.kind==='evaluator'){reopenForEvaluator(this.store,result.evaluator,{now:this.clock()});this.evaluatorChecked=true;return;}
    if(result.unavailable){recordEvaluationFailure(this.store,listId,result.unavailable,{now:this.clock()});return;}
    const {counts,added,reasons,dropped}=commitEvaluation(this.store,result,{evaluator:result.evaluator,now:this.clock()});
    if(this.store.get('placementLogEvaluator')!==result.evaluator)this.store.set('placementLogEvaluator',result.evaluator);
    // Exact identifiers and counts only. Wording never reaches a log.
    if(added||dropped)this.log({list:result.listId,document:result.documentId,amendments:counts.amendments,placed:counts.placed,unplaced:counts['withheld-pipeline'],new:added,reasons,...(dropped?{dropped}:{}),ms:Math.round(elapsed)});
  }
  stop() {this.stopped=true;this.controller.abort(new Error('Placement log stopped.'));}
}

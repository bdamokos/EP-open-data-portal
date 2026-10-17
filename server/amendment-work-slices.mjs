import {stat} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setImmediate as yieldTurn} from 'node:timers/promises';

function queuedBody(store,task) {
  const row=store.db?.prepare(`SELECT body FROM ${task.amendmentJob?'amendment_jobs':'tasks'} WHERE generation=? AND key=?`).get(task.generation,task.key);
  return row?JSON.parse(row.body):task.body;
}

// Actions commit complete target work before the cursor advances. Callbacks
// must not keep a SQLite transaction open across an asynchronous yield.
// worker.runDeadline is a monotonic performance.now() timestamp; omitted means
// Infinity for direct callers. The production worker sets it once per run.
export async function runAmendmentWorkSlice(worker,task,{select,action,advance,maxActions=10}) {
  if(!Number.isInteger(maxActions)||maxActions<1)throw new Error('Amendment work slices require a positive action bound.');
  const limit=Math.min(maxActions,10),store=worker.store,deadline=worker.runDeadline ?? Infinity;
  const stopped=()=>worker.stopped||worker.controller?.signal.aborted||performance.now()>=deadline;
  const boundary=async()=>{
    if(stopped())return false;
    store.assertWriter();
    if(Number.isFinite(worker.diskLimit)&&store.filename) {
      const size=(await Promise.all(['','-wal','-shm'].map(suffix=>stat(store.filename+suffix).then(file=>file.size).catch(()=>0)))).reduce((sum,bytes)=>sum+bytes,0);
      if(stopped())return false;
      store.assertWriter();
      if(size>worker.diskLimit) {
        if(store.get?.('working')?.generation===task.generation)store.updateCycle({phase:'paused',error:'Activity index reached its configured disk limit.'});
        return false;
      }
    }
    return true;
  };
  let actions=0;
  while(true) {
    if(stopped())return false;
    if(store.db?.isTransaction)throw new Error('Amendment work cannot yield inside a SQLite transaction.');
    await yieldTurn();
    if(!await boundary())return false;
    const body=queuedBody(store,task),item=select(body);
    if(item==null)return true;
    if(actions>=limit)return false;
    const complete=await action(item,body);
    store.assertWriter();
    task.body=queuedBody(store,task);
    if(complete===false)return false;
    const next={...task.body,...advance(item,task.body)};
    store.taskProgress(task,next);task.body=next;actions++;
  }
}

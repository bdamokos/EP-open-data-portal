import {sittingSnapshotHints,SITTING_HINT_LIMIT} from './sitting-snapshot-store.mjs';

// Coalesce IDs and allow only one bounded batch in flight, even while SQLite
// blocks the writer. Retain an unacknowledged batch across worker restarts.
export function forwardSittingSnapshotHints(worker,{hints=sittingSnapshotHints}={}) {
  let pending,batch,closed=false;
  const flush=()=>{
    pending=undefined;
    if(closed||batch||!hints.size)return;
    batch=hints.drain();
    worker.postMessage({type:'sitting-hints',ids:batch.map(({kind,version,id,changedDeclarations})=>[kind,version,id,Boolean(changedDeclarations)])});
  };
  const schedule=()=>{if(!closed&&!pending)pending=setImmediate(flush);};
  const receive=message=>{
    if(message?.type!=='sitting-hints-received')return;
    batch=undefined;schedule();
  };
  const unsubscribe=hints.subscribe(schedule);
  worker.on('message',receive);schedule();
  return ()=>{
    if(closed)return;
    closed=true;clearImmediate(pending);unsubscribe();worker.off('message',receive);
    for(const hint of batch||[])hints.enqueue(hint.kind,hint.version,hint.id,hint);
  };
}

export function acceptSittingSnapshotHints(message,{hints=sittingSnapshotHints}={}) {
  if(message?.type!=='sitting-hints'||!Array.isArray(message.ids)||message.ids.length>SITTING_HINT_LIMIT)return false;
  for(const tuple of message.ids){
    if(!Array.isArray(tuple)||tuple.length!==4)continue;
    const [kind,version,id,changedDeclarations]=tuple;
    if(!['calendar','votes','attendance'].includes(kind)||!Number.isSafeInteger(version)||version<1||typeof id!=='string'||typeof changedDeclarations!=='boolean')continue;
    if(!(kind==='calendar'?/^\d{4}$/:/^MTG-PL-\d{4}-\d{2}-\d{2}$/).test(id))continue;
    hints.enqueue(kind,version,id,{changedDeclarations});
  }
  return true;
}

import {documentBodyHints} from './document-body-hints.mjs';
const SITTING_HINT_LIMIT=512;

// Coalesce IDs and allow only one bounded batch in flight, even while SQLite
// blocks the writer. Retain an unacknowledged batch across worker restarts.
export function forwardDocumentBodyHints(worker,{hints=documentBodyHints}={}) {
  let pending,batch,closed=false;
  const flush=()=>{
    pending=undefined;
    if(closed||batch||!hints.size)return;
    batch=hints.drain();
    worker.postMessage({type:'document-body-hints',ids:batch});
  };
  const schedule=()=>{if(!closed&&!pending)pending=setImmediate(flush);};
  const receive=message=>{
    if(message?.type!=='document-body-hints-received')return;
    batch=undefined;schedule();
  };
  const unsubscribe=hints.subscribe(schedule);
  worker.on('message',receive);schedule();
  return ()=>{
    if(closed)return;
    closed=true;clearImmediate(pending);unsubscribe();worker.off('message',receive);
    for(const hint of batch||[])hints.enqueue(hint.id,hint.language);
  };
}

export function acceptDocumentBodyHints(message,{hints=documentBodyHints}={}) {
  if(message?.type!=='document-body-hints'||!Array.isArray(message.ids)||message.ids.length>SITTING_HINT_LIMIT)return false;
  for(const hint of message.ids)hints.enqueue(hint?.id,hint?.language);
  return true;
}

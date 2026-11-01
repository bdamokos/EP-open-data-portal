import {EventEmitter} from 'node:events';
const events=new EventEmitter(),pending=new Set();
export const OFFICIAL_HINT_LIMIT=64;
export function hintOfficialContext(url) {
  if(typeof url!=='string'||url.length>16000||pending.has(url)||pending.size>=OFFICIAL_HINT_LIMIT)return;
  pending.add(url);events.emit('hint');
}
export function drainOfficialHints(){const urls=[...pending];pending.clear();return urls;}
export function forwardOfficialHints(worker) {
  let batch=null,timer;
  const flush=()=>{timer=null;if(batch||!pending.size)return;batch=drainOfficialHints();worker.postMessage({type:'official-context-hints',urls:batch});};
  const schedule=()=>{if(!timer)timer=setImmediate(flush);};
  const receive=message=>{if(message?.type==='official-context-hints-received'){batch=null;schedule();}};
  events.on('hint',schedule);worker.on('message',receive);schedule();
  return ()=>{clearImmediate(timer);events.off('hint',schedule);worker.off('message',receive);for(const url of batch||[])hintOfficialContext(url);};
}
export function acceptOfficialHints(message) {
  if(message?.type!=='official-context-hints'||!Array.isArray(message.urls)||message.urls.length>OFFICIAL_HINT_LIMIT)return false;
  for(const url of message.urls)hintOfficialContext(url);
  return true;
}

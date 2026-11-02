import {mkdir,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {requestSignal,waitForRequest} from './request-budget.mjs';

const publications=new Map();

// Preparation may overlap. Final replacements of one file retain their order,
// including when an already-started filesystem operation outlives its owner.
export function writeCacheFile(file,data,{signal=requestSignal(),onOrphan}={}) {
  if(signal?.aborted)return Promise.reject(signal.reason);
  let state=publications.get(file);
  if(!state){state={tail:Promise.resolve(),active:0,latest:0};publications.set(file,state);}
  state.active++;const ticket=++state.latest;
  const operation=(async()=>{
    signal?.throwIfAborted();
    const temporary=file+'.'+randomUUID()+'.tmp';
    try {
      await mkdir(path.dirname(file),{recursive:true});signal?.throwIfAborted();
      if(ticket!==state.latest)return false;
      await writeFile(temporary,data,{flag:'wx'});signal?.throwIfAborted();
      if(ticket!==state.latest)return false;
      const publication=state.tail.catch(()=>{}).then(async()=>{
        signal?.throwIfAborted();
        if(ticket!==state.latest)return false;
        await rename(temporary,file);
        return true;
      });
      state.tail=publication;
      const published=await publication;
      signal?.throwIfAborted();
      return published&&ticket===state.latest;
    } finally {
      await unlink(temporary).catch(async()=>{if(onOrphan){const remaining=await stat(temporary).catch(()=>null);if(remaining)onOrphan(remaining.size);}});
      if(--state.active===0&&publications.get(file)===state)publications.delete(file);
    }
  })();
  // The owner can release its source slot promptly; the filesystem continuation
  // keeps its publication lock and cleanup while checking the same signal.
  return waitForRequest(operation,signal);
}

import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {requestSignal,waitForRequest} from './request-budget.mjs';

const publications=new Map();

// Preparation may overlap. Final replacements of one file retain their order,
// including when an already-started filesystem operation outlives its owner.
export function writeCacheFile(file,data,{signal=requestSignal()}={}) {
  const operation=(async()=>{
    signal?.throwIfAborted();
    const temporary=file+'.'+randomUUID()+'.tmp';
    try {
      await mkdir(path.dirname(file),{recursive:true});signal?.throwIfAborted();
      await writeFile(temporary,data,{flag:'wx'});signal?.throwIfAborted();
      const previous=publications.get(file)||Promise.resolve();
      const publication=previous.catch(()=>{}).then(async()=>{
        signal?.throwIfAborted();
        await rename(temporary,file);
      });
      publications.set(file,publication);
      try {await publication;}
      finally {if(publications.get(file)===publication)publications.delete(file);}
      signal?.throwIfAborted();
    } finally {await unlink(temporary).catch(()=>{});}
  })();
  // The owner can release its source slot promptly; the filesystem continuation
  // keeps its publication lock and cleanup while checking the same signal.
  return waitForRequest(operation,signal);
}

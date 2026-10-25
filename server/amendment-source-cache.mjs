import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {writeCacheFile} from './cache-publication.mjs';
import {normalizedDocxDescriptor,sameDocxDescriptor} from './amendments.mjs';

const MAX_FILE=8*1024*1024,MAX_RECORD=12*1024*1024,WEEK=7*86400000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const caches=new WeakMap();
function cache(store) {
  if(!caches.has(store)) {
    const directory=path.join(path.dirname(store.filename),'amendment-docx-v1');
    caches.set(store,{directory,budget:new CacheDiskBudget(directory,{maxBytes:64*1024*1024,maxEntries:2000,pattern:/^[0-9a-f]{64}\.json$/,clock:store.clock})});
  }
  return caches.get(store);
}
const nameFor=descriptor=>hash(JSON.stringify(normalizedDocxDescriptor(descriptor)))+'.json';

// Bytes are independent of index generations. Reuse is limited to parser-only
// work against the same current distribution, within its weekly refresh window.
export async function retainedAmendmentSource(store,descriptor,{signal}={}) {
  const {directory,budget}=cache(store),name=nameFor(descriptor),file=path.join(directory,name);
  try {
    if((await stat(file)).size>MAX_RECORD)return null;
    const record=JSON.parse(await readFile(file,'utf8'));signal?.throwIfAborted();
    const age=store.clock()-Date.parse(record.fetchedAt);
    if(record.version!==1||!sameDocxDescriptor(record.descriptor,descriptor)||!Number.isFinite(age)||age<0||age>=WEEK||typeof record.bytes!=='string')return null;
    const buffer=Buffer.from(record.bytes,'base64');
    if(buffer.length>MAX_FILE||hash(buffer)!==record.sha256)return null;
    budget.used(name);return {buffer,fetchedAt:record.fetchedAt};
  } catch {signal?.throwIfAborted();return null;}
}
export async function retainAmendmentSource(store,descriptor,buffer,fetchedAt,{signal}={}) {
  if(buffer.length>MAX_FILE)return;
  const {directory,budget}=cache(store),name=nameFor(descriptor);
  const record=JSON.stringify({version:1,descriptor:normalizedDocxDescriptor(descriptor),fetchedAt,sha256:hash(buffer),bytes:buffer.toString('base64')});
  try {if(await writeCacheFile(path.join(directory,name),record,{signal}))await budget.saved(name,Buffer.byteLength(record));}
  catch {signal?.throwIfAborted();/* Cache failure must not discard a valid extraction. */}
}

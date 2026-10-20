import {createHash} from 'node:crypto';
import {readFile,readdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {sharedRequest,waitForRequest,requestSignal,isLocalRequestFailure} from './request-budget.mjs';
import {writeCacheFile} from './cache-publication.mjs';

// Reproducible assembled responses live separately from raw ODP records and index state.
export class InsightViewCache {
  constructor({directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'insights-views-v3'),clock=Date.now,freshMs=5*60_000,maxEntries=48,maxBytes=32*1024*1024}={}) {Object.assign(this,{directory,clock,freshMs,maxEntries,maxBytes});this.cache=new Map();this.pending=new Map();this.failures=new Map();this.diskReads=new Map();this.bytes=0;}
  key(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
  async stored(key) {
    if(this.cache.has(key))return this.cache.get(key);
    if(!this.directory)return null;
    const reads=this.diskReads.get(key)||new Set(),read={superseded:false};
    this.diskReads.set(key,reads);reads.add(read);
    try {
      const name=path.join(this.directory,key+'.json'),info=await stat(name);if(info.size>4*1024*1024)return null;
      const record=JSON.parse(await readFile(name,'utf8'));requestSignal()?.throwIfAborted();
      // A publication while this read was pending wins even if memory evicted it.
      if(read.superseded)return this.cache.get(key)||null;
      if(record.key!==key||!Number.isFinite(record.at)||!record.value)return null;
      this.remember(key,record);return record;
    }catch{return null;}
    finally {reads.delete(read);if(!reads.size)this.diskReads.delete(key);}
  }
  remember(key,record) {
    const bytes=Buffer.byteLength(JSON.stringify(record));if(bytes>4*1024*1024)return;
    for(const read of this.diskReads.get(key)||[])read.superseded=true;
    const previous=this.cache.get(key);if(previous)this.bytes-=previous.bytes;
    this.cache.delete(key);this.cache.set(key,{...record,bytes});this.bytes+=bytes;
    while(this.cache.size>this.maxEntries||this.bytes>this.maxBytes){const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}
  }
  async save(key,value) {
    requestSignal()?.throwIfAborted();
    const record={key,at:this.clock(),value};this.remember(key,record);
    if(!this.directory||Buffer.byteLength(JSON.stringify(record))>4*1024*1024)return record;
    const name=path.join(this.directory,key+'.json');
    try {await writeCacheFile(name,JSON.stringify(record));await this.prune();}catch{/* Disk cache is reproducible; a write failure must not hide available data. */}
    requestSignal()?.throwIfAborted();
    return record;
  }
  async prune() {
    const names=(await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
    const files=await Promise.all(names.map(async name=>{const info=await stat(path.join(this.directory,name));return {name,at:info.mtimeMs,bytes:info.size};}));files.sort((a,b)=>b.at-a.at);
    let bytes=0;for(let i=0;i<files.length;i++){bytes+=files[i].bytes;if(i>=this.maxEntries||bytes>64*1024*1024)await unlink(path.join(this.directory,files[i].name)).catch(()=>{});}
  }
  refresh(key,load) {
    if(this.pending.has(key))return this.pending.get(key);
    const promise=sharedRequest(async()=>{await new Promise(resolve=>setImmediate(resolve));const value=await load();requestSignal()?.throwIfAborted();return this.save(key,value);}).then(record=>{this.failures.delete(key);return record;}).catch(error=>{if(!isLocalRequestFailure(error))this.failures.set(key,{at:this.clock(),error:error.message});while(this.failures.size>this.maxEntries)this.failures.delete(this.failures.keys().next().value);throw error;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,promise);return promise;
  }
  async get(value,load,{freshMs=this.freshMs,validate}={}) {
    const key=this.key(value);let old=await this.stored(key);
    requestSignal()?.throwIfAborted();
    // A concurrent disk miss may finish after another reader has saved the view.
    old ||= this.cache.get(key)||null;
    // Validate both retained records and replacements. A rejected old record
    // is a cache miss; a rejected refresh leaves the last good record intact.
    if(old&&validate)try{validate(old.value);}catch{old=null;}
    const checkedLoad=async()=>{const result=await load();validate?.(result);return result;};
    const failure=this.failures.get(key);
    if(old) {
      const stale=this.clock()-old.at>freshMs;
      if(stale&&(!failure||this.clock()-failure.at>60_000))void this.refresh(key,checkedLoad).catch(()=>{});
      return {...old.value,viewCache:{computedAt:new Date(old.at).toISOString(),stale,refreshInProgress:this.pending.has(key),refreshError:failure?.error||null}};
    }
    const record=await waitForRequest(this.refresh(key,checkedLoad));return {...record.value,viewCache:{computedAt:new Date(record.at).toISOString(),stale:false,refreshInProgress:false,refreshError:null}};
  }
}

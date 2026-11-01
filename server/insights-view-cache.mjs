import {calendarNeedsRefresh} from './meetings-reader.mjs';
import {createHash} from 'node:crypto';
import {readFile,readdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {sharedRequest,waitForRequest,requestSignal,isLocalRequestFailure} from './request-budget.mjs';
import {writeCacheFile} from './cache-publication.mjs';

// Reproducible assembled responses live separately from raw ODP records and index state.
export class InsightViewCache {
  constructor({directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'insights-views-v3'),clock=Date.now,freshMs=5*60_000,maxEntries=48,maxBytes=32*1024*1024,maxDiskEntries=maxEntries,maxDiskBytes=64*1024*1024,cacheable=()=>true,writable=true,assertWriter=()=>{}}={}) {Object.assign(this,{directory,clock,freshMs,maxEntries,maxBytes,maxDiskEntries,maxDiskBytes,cacheable,writable,assertWriter});this.cache=new Map();this.pending=new Map();this.background=new Set();this.foregroundPending=new Map();this.failures=new Map();this.diskReads=new Map();this.bytes=0;}
  key(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
  async stored(key) {
    if(this.cache.has(key)){const record=this.cache.get(key);return this.cacheable(record.value)?record:null;}
    if(!this.directory)return null;
    const reads=this.diskReads.get(key)||new Set(),read={superseded:false};
    this.diskReads.set(key,reads);reads.add(read);
    try {
      const name=path.join(this.directory,key+'.json'),info=await stat(name);if(info.size>4*1024*1024)return null;
      const record=JSON.parse(await readFile(name,'utf8'));requestSignal()?.throwIfAborted();
      // A publication while this read was pending wins even if memory evicted it.
      if(read.superseded)return this.cache.get(key)||null;
      if(record.key!==key||!Number.isFinite(record.at)||!record.value||!this.cacheable(record.value))return null;
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
  async save(key,value,{persist}={}) {
    requestSignal()?.throwIfAborted();
    const record={key,at:this.clock(),value};
    if(!this.cacheable(value))return record;
    this.remember(key,record);
    if(!this.writable||!this.directory||Buffer.byteLength(JSON.stringify(record))>4*1024*1024||persist&&!await persist())return record;
    this.assertWriter();
    const name=path.join(this.directory,key+'.json');
    try {await writeCacheFile(name,JSON.stringify(record));await this.prune();}catch{/* Disk cache is reproducible; a write failure must not hide available data. */}
    requestSignal()?.throwIfAborted();
    return record;
  }
  async prune() {
    if(!this.writable)return;
    this.assertWriter();
    const names=(await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
    const files=await Promise.all(names.map(async name=>{const info=await stat(path.join(this.directory,name));return {name,at:info.mtimeMs,bytes:info.size};}));files.sort((a,b)=>b.at-a.at);
    let bytes=0;for(let i=0;i<files.length;i++){bytes+=files[i].bytes;if(i>=this.maxDiskEntries||bytes>this.maxDiskBytes)await unlink(path.join(this.directory,files[i].name)).catch(()=>{});}
  }
  refresh(key,load,{background=false,persist}={}) {
    if(this.pending.has(key))return this.pending.get(key);
    const promise=sharedRequest(async()=>{await new Promise(resolve=>setImmediate(resolve));const value=await load();requestSignal()?.throwIfAborted();return this.save(key,value,{persist});}).then(record=>{this.failures.delete(key);return record;}).catch(error=>{if(!isLocalRequestFailure(error))this.failures.set(key,{at:this.clock(),error:error.message,retryAt:Number.isFinite(error.retryAt)?error.retryAt:null});while(this.failures.size>this.maxEntries)this.failures.delete(this.failures.keys().next().value);throw error;}).finally(()=>{this.pending.delete(key);this.background.delete(key);});
    if(background)this.background.add(key);
    this.pending.set(key,promise);return promise;
  }
  readForeground(key,load) {
    if(this.foregroundPending.has(key))return this.foregroundPending.get(key);
    // A cold visitor uses its own foreground source admission, rather than
    // inheriting a queued warm-up's background budget. Source clients still
    // coalesce where supported. Only the original refresh publishes the cache.
    const promise=sharedRequest(async()=>({value:await load(),at:this.clock()})).finally(()=>this.foregroundPending.delete(key));
    this.foregroundPending.set(key,promise);return promise;
  }
  async get(value,load,{freshMs=this.freshMs,validate,includeRetryAt=false,background=false,persist}={}) {
    const key=this.key(value);let old=await this.stored(key);
    requestSignal()?.throwIfAborted();
    // A concurrent disk miss may finish after another reader has saved the view.
    const memory=this.cache.get(key);
    if(!old&&memory&&this.cacheable(memory.value))old=memory;
    // Validate both retained records and replacements. A rejected old record
    // is a cache miss; a rejected refresh leaves the last good record intact.
    if(old&&validate)try{validate(old.value);}catch{old=null;}
    const checkedLoad=async()=>{const result=await load();validate?.(result);return result;};
    const failure=this.failures.get(key);
    if(old) {
      const lifetime=typeof freshMs==='function'?freshMs(old.value):freshMs;
      const stale=this.clock()-old.at>(old.value?.coverage?.catalogue&&calendarNeedsRefresh(old.value.coverage.catalogue)?Math.min(lifetime,60_000):lifetime);
      const retryAt=failure?Math.max(failure.at+60_000,failure.retryAt||0):null;
      if(stale&&(!failure||this.clock()>retryAt))void this.refresh(key,checkedLoad,{background,persist}).catch(()=>{});
      return {...old.value,viewCache:{computedAt:new Date(old.at).toISOString(),stale,refreshInProgress:this.pending.has(key),refreshError:failure?.error||null,...(includeRetryAt?{retryAt}: {})}};
    }
    const record=await waitForRequest(!background&&this.background.has(key)?this.readForeground(key,checkedLoad):this.refresh(key,checkedLoad,{background,persist}));return {...record.value,viewCache:{computedAt:new Date(record.at).toISOString(),stale:false,refreshInProgress:false,refreshError:null,...(includeRetryAt?{retryAt:null}: {})}};
  }
}

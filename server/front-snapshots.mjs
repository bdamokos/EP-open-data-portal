import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,openSync,readSync,closeSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';

// Last good API answers kept by the split front (EXPLORER_PROCESS_MODE=split), so
// that a visitor who arrives while the API process is down is answered from the
// stored copy while the process starts. The front is the only writer.
//
// Only a short list of routes qualifies, only for plain anonymous reads, and each
// route has its own staleness bound taken from how the API treats that answer:
//  - directory: the CDN lifetime the API itself sent with the response (it sends
//    none for an incomplete directory, which is therefore never kept).
//  - vote-periods: the API sends no-store because held dates change at Brussels
//    midnight; a copy is used on the Brussels day it was stored, for 6 h at most.
//  - plenary-live: the answer's own validUntil. The client treats a snapshot past
//    it as out of date and polls again only after 30 s, so an expired copy would
//    delay the real answer.
//  - upcoming-votes: the API sends no-store. Ballots of a sitting before today are
//    held records and are used for 1 h; a current or future sitting never.
// The `v` parameter is part of the key and must equal the running API version, so
// a copy never outlives a deployment.
export const SNAPSHOT_HEADER='X-Explorer-Snapshot';
const HOUR=3600_000;
const routes=new Map([
  ['directory',['lang']],
  ['vote-periods',[]],
  ['plenary-live',[]],
  ['upcoming-votes',['sitting','lang']],
]);
const sittingPattern=/^MTG-PL-(\d{4}-\d{2}-\d{2})$/;
const langPattern=/^[a-z]{2}$/;
const credentialHeaders=['authorization','cookie','origin','range','if-range','proxy-authorization'];
// Never replayed: connection-level headers, per-response values and anything that sets state.
const notReplayed=new Set(['connection','keep-alive','proxy-connection','proxy-authenticate','proxy-authorization','te','trailer','upgrade','expect','transfer-encoding',
  'content-length','date','server-timing','x-request-id','set-cookie','retry-after','age','content-encoding']);
const brusselsFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'});
const brusselsDay=time=>brusselsFormat.format(time);
const etagOf=body=>`"${createHash('sha256').update(body).digest('base64url')}"`;
const HEADER_LIMIT=16*1024;

function headerValue(rawHeaders,name) {
  for(let i=0;i<rawHeaders.length;i+=2)if(rawHeaders[i].toLowerCase()===name)return rawHeaders[i+1];
  return undefined;
}
const cdnMaxAgeMs=rawHeaders=>{
  const seconds=Number(/(?:^|[,\s])max-age=(\d+)/.exec(headerValue(rawHeaders,'cdn-cache-control')||'')?.[1]);
  return seconds>0?seconds*1000:0;
};

export class FrontSnapshots {
  constructor({directory=null,currentVersion,clock=Date.now,maxBytes=16*1024*1024,maxEntryBytes=Math.floor(maxBytes/2),maxEntries=64,persistIntervalMs=5*60_000,log=console.warn}) {
    Object.assign(this,{directory,currentVersion,clock,maxBytes,maxEntryBytes,maxEntries,persistIntervalMs,log});
    this.entries=new Map();      // key -> {meta,file,size,body (only until written),persisted:{etag,storedAt}|null}
    this.timer=null;this.writing=Promise.resolve();this.warned=false;this.closed=false;
    this.hits=0;this.misses=0;this.stored=0;
  }
  get enabled() {return this.maxBytes>0;}
  get bytes() {let total=0;for(const entry of this.entries.values())total+=entry.size;return total;}

  // Reads the stored entries (headers only; bodies stay on disk). Anything that
  // does not parse, differs in size from its header or belongs to another API
  // version is deleted.
  load(version=null) {
    if(!this.enabled||!this.directory||!existsSync(this.directory))return;
    for(const name of readdirSync(this.directory)) {
      const file=path.join(this.directory,name);
      try {
        if(!name.endsWith('.snap'))throw new Error('foreign file');
        const meta=this.#readMeta(file);
        if(!meta||version&&meta.version!==version||this.entries.has(meta.key))throw new Error('unusable');
        this.entries.set(meta.key,{meta,file,size:meta.headerBytes+meta.bytes,body:null,persisted:{etag:meta.etag,storedAt:meta.storedAt}});
      } catch {try {unlinkSync(file);}catch{/* already gone */}}
    }
    this.#evict(null);
  }
  #readMeta(file) {
    const fd=openSync(file,'r');
    try {
      const buffer=Buffer.alloc(HEADER_LIMIT),read=readSync(fd,buffer,0,HEADER_LIMIT,0),end=buffer.subarray(0,read).indexOf(10);
      if(end<0)return null;
      const meta=JSON.parse(buffer.subarray(0,end).toString('utf8'));
      meta.headerBytes=end+1;
      if(typeof meta.key!=='string'||!routes.has(meta.route)||!Array.isArray(meta.headers)||!Number.isSafeInteger(meta.bytes)||statSync(file).size!==meta.headerBytes+meta.bytes)return null;
      return meta;
    } finally {closeSync(fd);}
  }

  // The key and route of a request that may use or fill a stored copy; null for
  // anything else. Never set for a request with credentials, an Origin or a Range.
  async candidate(request,url,apiPrefix) {
    if(!this.enabled||request.method!=='GET'||!apiPrefix)return null;
    for(const name of credentialHeaders)if(request.headers[name]!==undefined)return null;
    const route=url.pathname.slice(apiPrefix.length+1),allowed=routes.get(route);
    if(!allowed||url.pathname!==`${apiPrefix}/${route}`)return null;
    const params=new URLSearchParams(url.search),versions=params.getAll('v');
    if(versions.length!==1)return null;
    params.delete('v');
    const names=[...params.keys()];
    if(names.some(name=>!allowed.includes(name))||new Set(names).size!==names.length)return null;
    if(params.has('lang')&&!langPattern.test(params.get('lang')))return null;
    const sitting=params.get('sitting');
    if(route==='upcoming-votes'&&!sittingPattern.test(sitting||''))return null;
    if(versions[0]!==String(await this.currentVersion()))return null;
    // The raw target is the key: path, query and version exactly as the client sent them.
    return {key:request.url,route,version:versions[0],sitting};
  }

  // A fresh stored copy, or null. A copy for another version, past its bound or
  // with a body that no longer matches its checksum is dropped.
  async lookup(candidate) {
    const entry=this.entries.get(candidate.key);
    if(!entry){this.misses++;return null;}
    const {meta}=entry,now=this.clock();
    if(meta.version!==candidate.version||!this.#fresh(meta,now)){this.#drop(candidate.key);this.misses++;return null;}
    let body=entry.body;
    if(!body) {
      try {body=(await readFile(entry.file)).subarray(meta.headerBytes);}
      catch {this.#drop(candidate.key);this.misses++;return null;}
    }
    if(body.length!==meta.bytes||etagOf(body)!==meta.etag){this.#drop(candidate.key);this.misses++;return null;}
    this.hits++;
    return {etag:meta.etag,body,ageMs:Math.max(0,now-meta.storedAt),headers:meta.headers};
  }
  #fresh(meta,now) {
    if(now<meta.storedAt-60_000||now>=meta.expiresAt)return false;
    return meta.route!=='vote-periods'||brusselsDay(meta.storedAt)===brusselsDay(now);
  }

  // Keeps a 200 answer the API process sent for a candidate request, or renews
  // the copy when the API answered a conditional request with 304 for the same body.
  record(candidate,{status,rawHeaders,body=null}) {
    if(!this.enabled||this.closed)return;
    const now=this.clock();
    try {
      if(status===304)return this.#renew(candidate,rawHeaders,now);
      if(status!==200||!body||headerValue(rawHeaders,'content-encoding'))return;
      if(!/^application\/json\b/i.test(headerValue(rawHeaders,'content-type')||''))return;
      const etag=etagOf(body);
      // The API's ETag is the body's digest; anything else is not a copy to trust.
      if(headerValue(rawHeaders,'etag')!==etag||body.length>this.maxEntryBytes)return;
      const expiresAt=this.#expiry(candidate,rawHeaders,body,now);
      if(expiresAt)this.#store(candidate,{etag,body,rawHeaders,now,expiresAt});
    } catch(error) {this.#warn('Could not keep a response copy:',error.message);}
  }
  // When a new answer stops being usable; 0 when the route's rule says it is not to be kept.
  #expiry({route,sitting},rawHeaders,body,now) {
    const json=()=>{try {return JSON.parse(body.toString('utf8'));}catch{return null;}};
    if(route==='directory')return cdnMaxAgeMs(rawHeaders)?now+cdnMaxAgeMs(rawHeaders):0;
    if(route==='vote-periods')return json()?.coverage?.status==='complete'?now+6*HOUR:0;
    if(route==='plenary-live') {
      const until=Date.parse(json()?.validUntil);
      return Number.isFinite(until)&&until>now?until:0;
    }
    return sittingPattern.exec(sitting)[1]<brusselsDay(now)?now+HOUR:0;
  }
  // A 304 proves the stored body is still the API's answer. plenary-live states its own validity in the body, so it is never renewed.
  #renew({key,route,version,sitting},rawHeaders,now) {
    const entry=this.entries.get(key);
    if(!entry||route==='plenary-live'||entry.meta.version!==version||headerValue(rawHeaders,'etag')!==entry.meta.etag||!this.#fresh(entry.meta,now))return;
    const expiresAt=route==='directory'?cdnMaxAgeMs(rawHeaders)&&now+cdnMaxAgeMs(rawHeaders):route==='vote-periods'?now+6*HOUR:this.#expiry({route,sitting},rawHeaders,null,now);
    if(!expiresAt)return;
    Object.assign(entry.meta,{storedAt:now,expiresAt});
    this.#schedule();
  }
  #store({key,route,version},{etag,body,rawHeaders,now,expiresAt}) {
    // Copies of an earlier API version can never be used again.
    for(const [other,entry] of [...this.entries])if(entry.meta.version!==version)this.#drop(other);
    const headers=[];
    for(let i=0;i<rawHeaders.length;i+=2)if(!notReplayed.has(rawHeaders[i].toLowerCase()))headers.push([rawHeaders[i],rawHeaders[i+1]]);
    const meta={key,route,version,storedAt:now,expiresAt,etag,bytes:body.length,headers,headerBytes:0};
    const file=this.directory&&path.join(this.directory,createHash('sha256').update(key).digest('hex').slice(0,32)+'.snap');
    this.entries.set(key,{meta,file,size:body.length+1024,body,persisted:this.entries.get(key)?.persisted??null});
    this.#evict(key);
    this.stored++;
    this.#schedule();
  }
  #evict(keep) {
    const over=()=>this.entries.size>this.maxEntries||this.bytes>this.maxBytes;
    if(!over())return;
    // Oldest copy first; the one just stored goes last.
    const order=[...this.entries].filter(([key])=>key!==keep).sort((a,b)=>a[1].meta.storedAt-b[1].meta.storedAt);
    for(const [key] of order){if(!over())break;this.#drop(key);}
    if(over()&&keep)this.#drop(keep);
  }
  #drop(key) {
    const entry=this.entries.get(key);
    if(!entry)return;
    this.entries.delete(key);
    if(entry.file&&entry.persisted)this.writing=this.writing.then(()=>unlink(entry.file)).catch(()=>{});
  }

  #schedule() {
    if(this.timer||!this.directory)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.persistIntervalMs);
    this.timer.unref();
  }
  // Writes new and changed copies (atomically); a copy already on disk is rewritten
  // only when its body changed or it is over an hour older than the stored one.
  // Entries renewed by a 304 have no body in memory and are rewritten the same way.
  flush() {
    clearTimeout(this.timer);this.timer=null;
    if(!this.directory||!this.enabled)return this.writing;
    this.writing=this.writing.then(async()=>{
      for(const [key,entry] of [...this.entries]) {
        const {meta}=entry,stale=!entry.persisted||entry.persisted.etag!==meta.etag||meta.storedAt-entry.persisted.storedAt>=HOUR;
        if(this.entries.get(key)!==entry||!stale)continue;
        try {
          const body=entry.body??(await readFile(entry.file)).subarray(meta.headerBytes);
          mkdirSync(this.directory,{recursive:true});
          const head=Buffer.from(JSON.stringify({...meta,headerBytes:undefined})+'\n','utf8');
          if(head.length>HEADER_LIMIT)throw new Error('headers too large');
          const temporary=`${entry.file}.${process.pid}.tmp`;
          await writeFile(temporary,Buffer.concat([head,body]),{mode:0o600});
          await rename(temporary,entry.file);
          meta.headerBytes=head.length;entry.size=head.length+body.length;entry.persisted={etag:meta.etag,storedAt:meta.storedAt};
        } catch(error) {this.#warn('Could not write a response copy:',error.message);}
      }
      // Bodies stay in memory only until they are on disk.
      for(const entry of this.entries.values())if(entry.persisted?.etag===entry.meta.etag)entry.body=null;
    }).catch(error=>this.#warn('Could not write response copies:',error.message));
    return this.writing;
  }
  async close() {
    this.closed=true;
    await this.flush();
  }
  #warn(...message) {if(!this.warned){this.warned=true;this.log('[front-snapshots]',...message);}}
}

// The stored reply: the API's own headers, a no-store lifetime so no cache keeps a
// copy past its bound, and a diagnostic marker the client ignores. A matching
// If-None-Match is answered with 304 exactly as the API does.
export function sendSnapshot(request,response,hit,{requestId}={}) {
  for(const [name,value] of hit.headers)response.appendHeader(name,value);
  response.setHeader('Cache-Control','no-store');
  response.setHeader('CDN-Cache-Control','no-store');
  response.setHeader(SNAPSHOT_HEADER,`stored; age=${Math.round(hit.ageMs/1000)}`);
  if(requestId)response.setHeader('X-Request-Id',requestId);
  if(request.headers['if-none-match']===hit.etag) {
    response.statusCode=304;response.removeHeader('Content-Type');response.end();return;
  }
  response.statusCode=200;
  response.setHeader('Content-Length',hit.body.length);
  response.end(hit.body);
}

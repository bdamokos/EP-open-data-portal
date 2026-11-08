import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.mjs';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {writeCacheFile} from './cache-publication.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';
import {documentParseThread} from './amendment-extraction-thread.mjs';
import {extractAmendments,AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {parseProposal,PROPOSAL_PARSER_VERSION} from './proposal-structure.mjs';
import {parsePublicLegalXhtml,PUBLIC_LEGAL_XHTML_VERSION} from './public-legal-xhtml.mjs';

// Bump to discard every stored parse, for a change to this file's record format.
export const DOCUMENT_PARSE_VERSION=1;
export const DOCUMENT_PARSE_LIMITS=Object.freeze({recordBytes:24*1024*1024,entries:8192,failureTtlMs:10*60_000,failureEntries:256,markerEntries:1024});

// The parsers the context endpoint reads documents with. This one runs them on
// the calling thread, which indexers and benchmarks rely on.
export const inlineDocumentParser=Object.freeze({
  async amendments(buffer,options) {return extractAmendments(buffer,options);},
  async proposal(parser,input,options) {return (parser==='xhtml'?parsePublicLegalXhtml:parseProposal)(input,options);},
});

// The download time is the one per-request value in an amendment list's
// extraction. Parsing and storing use a placeholder, replaced on every read.
const FETCHED_AT='fetched-at-placeholder-8c1f3d6a';
const digest=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const retriable=error=>error?.code==='document_parse_timeout'||error?.code==='ERR_WORKER_OUT_OF_MEMORY';
const budgetError=()=>new RangeError('proposal-response-budget');
class StoredParseError extends Error {}

// Visitor-facing parsing: heavy documents are parsed on the memory-limited
// parse thread and stored by source hash, so a restart or a second reader costs a
// file read. A parse that outlives its readers still finishes and fills the
// store. The HTTP thread publishes each file atomically, like the other
// request-path caches; the parse thread never writes.
export class OffThreadDocumentParser {
  constructor({thread=documentParseThread,directory=()=>process.env.ODP_CACHE_DIR,maxBytes=config.documentParseMaxDiskBytes,limits={},clock=Date.now,versions={}}={}) {
    Object.assign(this,{thread,directory,maxBytes,clock});
    // Source-format versions are part of every stored key.
    this.versions={record:DOCUMENT_PARSE_VERSION,amendments:AMENDMENT_EXTRACTION_VERSION,proposal:PROPOSAL_PARSER_VERSION,xhtml:PUBLIC_LEGAL_XHTML_VERSION,...versions};
    this.limits={...DOCUMENT_PARSE_LIMITS,...limits};
    this.inflight=new Map();this.failures=new Map();this.markers=new Set();this.budgets=new Map();
  }

  budget(folder) {
    if(!this.budgets.has(folder))this.budgets.set(folder,new CacheDiskBudget(folder,{maxBytes:this.maxBytes,maxEntries:this.limits.entries,pattern:/^[a-f0-9]{64}\.json$/}));
    return this.budgets.get(folder);
  }
  folder() {
    const directory=this.directory();
    return directory?path.join(directory,'document-parse-v1'):null;
  }
  async read(key) {
    const folder=this.folder();
    if(!folder)return null;
    const name=key+'.json';
    try {
      const file=path.join(folder,name),info=await stat(file);
      if(!info.isFile()||info.size>this.limits.recordBytes)return null;
      const text=await readFile(file,'utf8');
      this.budget(folder).used(name);
      return text;
    } catch {return null;}
  }
  async store(key,text) {
    const folder=this.folder(),size=Buffer.byteLength(text);
    if(!folder||size>this.limits.recordBytes)return;
    const name=key+'.json';
    try {if(await writeCacheFile(path.join(folder,name),text,{signal:null}))await this.budget(folder).saved(name,size);}
    catch {/* The result is still served; the next reader parses again. */}
  }
  fail(key,error) {
    this.failures.delete(key);this.failures.set(key,{until:this.clock()+this.limits.failureTtlMs,message:error.message,code:error.code});
    while(this.failures.size>this.limits.failureEntries)this.failures.delete(this.failures.keys().next().value);
  }

  // The stored record text for `key`: read from disk, else made by `compute`
  // on the parse thread and stored. Readers of one key share one job.
  async record(key,compute,{signal=requestSignal(),refresh=false}={}) {
    signal?.throwIfAborted();
    const failed=this.failures.get(key);
    if(failed&&failed.until>this.clock())throw Object.assign(new Error(failed.message),{code:failed.code});
    const id=refresh?key+':refresh':key;
    let job=this.inflight.get(id);
    if(!job) {
      const controller=new AbortController();
      job={controller,waiters:0};
      const produced=(async()=>{
        if(!refresh){
          const saved=await this.read(key);
          if(saved!==null)return {text:saved};
        }
        // Dropped only while queued; a parse already running finishes for the store.
        controller.signal.throwIfAborted();
        let text;
        try {text=await compute(controller.signal);}
        catch(error) {
          if(retriable(error))this.fail(key,error);
          throw error;
        }
        return {text,stored:this.store(key,text)};
      })();
      job.promise=produced.then(result=>result.text);
      job.promise.catch(()=>{});
      produced.then(result=>result.stored,()=>{}).finally(()=>{if(this.inflight.get(id)===job)this.inflight.delete(id);});
      this.inflight.set(id,job);
    }
    job.waiters++;
    try {return await waitForRequest(job.promise,signal);}
    finally {if(--job.waiters===0)job.controller.abort();}
  }

  // A stored record that cannot be read is replaced by a fresh parse.
  async decoded(key,compute,decode,signal) {
    try {return decode(await this.record(key,compute,{signal}));}
    catch(error) {
      if(!(error instanceof StoredParseError||error instanceof SyntaxError))throw error;
      return decode(await this.record(key,compute,{signal,refresh:true}));
    }
  }

  // Same result as extractAmendments(buffer, options).
  async amendments(buffer,options,{signal=requestSignal()}={}) {
    const {fetchedAt=null,...stable}=options,placeholder=typeof fetchedAt==='string';
    if(!placeholder&&fetchedAt!==null)return this.thread.run('amendments',{buffer:new Uint8Array(buffer),options},{signal});
    const key=digest(['amendments',this.versions.amendments,this.versions.record,digest(buffer),stable,placeholder]);
    const compute=job=>this.thread.run('amendments-json',{buffer:new Uint8Array(buffer),options:{...stable,fetchedAt:placeholder?FETCHED_AT:null}},{signal:job,abortRunning:false})
      .then(({json})=>'{"v":'+DOCUMENT_PARSE_VERSION+',"extraction":'+json+'}');
    const decode=text=>{
      const record=JSON.parse(placeholder?text.replaceAll('"'+FETCHED_AT+'"',()=>JSON.stringify(fetchedAt)):text);
      if(record?.v!==DOCUMENT_PARSE_VERSION||!record.extraction||typeof record.extraction!=='object')throw new StoredParseError('Stored parse is unusable.');
      return record.extraction;
    };
    return this.decoded(key,compute,decode,signal);
  }

  // Same result as parseProposal / parsePublicLegalXhtml (input, options). A
  // result larger than `limitBytes` in both of the reader's projections is
  // remembered by size alone and raises the reader's response-budget error.
  async proposal(parser,input,options,{limitBytes,signal=requestSignal()}={}) {
    const bytes=input instanceof Uint8Array||typeof input==='string'?input:JSON.stringify(input);
    if(bytes===undefined)return inlineDocumentParser.proposal(parser,input,options);
    const key=digest(['proposal',parser,this.versions[parser==='xhtml'?'xhtml':'proposal'],this.versions.record,digest(bytes),options,limitBytes]);
    if(this.markers.has(key))throw budgetError();
    const payload={parser,input:input instanceof Uint8Array?new Uint8Array(input):input,options,limitBytes};
    const compute=job=>this.thread.run('proposal-json',payload,{signal:job,abortRunning:false})
      .then(({rawBytes,describedBytes,json})=>'{"v":'+DOCUMENT_PARSE_VERSION+',"rawBytes":'+rawBytes+',"describedBytes":'+describedBytes+(json===undefined?'':',"parsed":'+json)+'}');
    const decode=text=>{
      const record=JSON.parse(text);
      if(record?.v!==DOCUMENT_PARSE_VERSION||!Number.isSafeInteger(record.rawBytes)||(record.parsed!==undefined&&(record.parsed===null||typeof record.parsed!=='object')))throw new StoredParseError('Stored parse is unusable.');
      return record;
    };
    const record=await this.decoded(key,compute,decode,signal);
    if(record.parsed===undefined){
      this.markers.add(key);
      while(this.markers.size>this.limits.markerEntries)this.markers.delete(this.markers.values().next().value);
      throw budgetError();
    }
    return record.parsed;
  }
}

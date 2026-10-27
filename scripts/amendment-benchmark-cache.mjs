import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {Readable} from 'node:stream';
import {userAgent} from '../server/user-agent.mjs';
import {cellarTransportUrl,CELLAR_DOCX_MIME,CELLAR_LIMITS} from '../server/cellar-documents.mjs';
import {allowedDownload} from '../server/document-text.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function apiOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Expected an HTTPS API origin without credentials or path.');
  return url.origin;
}
const responseIsTransient=meta=>meta.status===429||meta.status>=500;
const repo = fileURLToPath(new URL('../',import.meta.url));
export async function outsideRepository(directory) {
  await mkdir(directory,{recursive:true});
  const resolved = await realpath(directory), root = await realpath(repo);
  if (resolved === root || resolved.startsWith(root+path.sep)) throw new Error('Benchmark cache/output must be outside the repository.');
  return resolved;
}
export function allowedInput(url,apiBase) {
  const value = new URL(url);
  return value.protocol === 'https:' && !value.username && !value.password && !value.hash && (
    value.origin === apiBase && /^\/api\/(?:amendments$|document-context\/(?:A|B|RC)-10-\d{4}-\d{4,6}$)/.test(value.pathname)
    || value.origin === 'https://data.europarl.europa.eu' && /^\/distribution\/.+\.docx$/i.test(value.pathname) && !value.search);
}
export function allowedSource(url) {
  const value=new URL(url);
  if(value.protocol!=='https:'||value.username||value.password||value.port||value.hash)return false;
  if(value.origin==='https://data.europarl.europa.eu'&&/^\/api\/v2\/plenary-documents\/(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(value.pathname)&&value.search==='?format=application%2Fld%2Bjson')return true;
  if(value.origin==='https://publications.europa.eu'&&value.pathname==='/webapi/rdf/sparql'&&!value.hash&&!value.username&&!value.password)return true;
  try{return cellarTransportUrl(url)===url;}catch{return false;}
}
export const retryDelay = (header,now=Date.now()) => {
  if (!header) return 0;
  if (/^\d+$/.test(header)) return Number(header)*1000;
  return Math.max(0,Date.parse(header)-now)||0;
};
const wait = async milliseconds => {
  while (milliseconds > 0) {
    const chunk = Math.min(milliseconds,50_000);
    if (milliseconds > 50_000) process.stderr.write(`Retry-After: ${Math.ceil(milliseconds/1000)}s remaining\n`);
    await new Promise(resolve=>setTimeout(resolve,chunk)); milliseconds-=chunk;
  }
};
// Use standard HTTPS for EP publications. These routes can return HTTP 500
// through Node fetch while the same anonymous HTTPS request succeeds.
function publicFetch(url,options) {
  if(!allowedDownload(url)&&!url.startsWith('https://data.europarl.europa.eu/api/v2/plenary-documents/'))return fetch(url,options);
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:options.headers,signal:options.signal},response=>{
      const body=[204,304].includes(response.statusCode)?null:Readable.toWeb(response);
      if(!body)response.resume();
      resolve(new Response(body,{status:response.statusCode,headers:response.headers}));
    }).on('error',reject);
  });
}
export class InputCache {
  constructor(directory,{fetchMissing=false,cap=1500,delay=750,apiBase,maxRetryAfter=60_000,fetcher=publicFetch,sleep=wait}={}) {
    Object.assign(this,{directory,fetchMissing,cap,delay,apiBase,maxRetryAfter,fetcher,sleep});
    this.requests=0;this.last=0;this.used=new Map();this.missing=new Map();
  }
  async get(url,options={}) {
    try{return await this.read(url,options);}catch(error){this.failure??=error;throw error;}
  }
  assertHealthy(){if(this.failure)throw this.failure;}
  async read(url,{officialRedirect=false,hops=0,accept,language,raw=false,signal}={}) {
    if (!(officialRedirect?allowedDownload(url):allowedInput(url,this.apiBase)||allowedSource(url))) throw new Error('Unsupported public input URL: '+url);
    const request=accept?{accept,...(language?{language}:{})}:null;
    const identity=request?JSON.stringify([url,request]):url;
    const maximum=accept===CELLAR_DOCX_MIME||allowedDownload(url)?CELLAR_LIMITS.itemBytes:accept?.startsWith('application/rdf+xml')||accept==='application/sparql-results+json'?CELLAR_LIMITS.metadataBytes:16*1024*1024;
    if(this.sealed&&!this.sealed.has(identity))throw new Error('input-not-in-snapshot: '+url);
    const key=digest(identity), metaPath=path.join(this.directory,key+'.json'), bodyPath=path.join(this.directory,key+'.body');
    let meta,body;
    try {meta=JSON.parse(await readFile(metaPath,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
    if (meta) {
      if (meta.url!==url||JSON.stringify(meta.request??null)!==JSON.stringify(request)) throw new Error('Cache URL mismatch: '+url);
      body=await readFile(bodyPath);
      if(body.length>maximum)throw new Error('Cached input exceeds source size limit: '+url);
      if (body.length!==meta.bytes||digest(body)!==meta.sha256) throw new Error('Cache hash mismatch: '+url);
    } else {
      if (!this.fetchMissing || this.requests>=this.cap) {
        throw new Error((this.fetchMissing?'request-cap-exhausted':'input-not-cached')+': '+url);
      }
      for(let attempt=0;attempt<3;attempt++) {
        if(this.requests>=this.cap)break;
        signal?.throwIfAborted();
        await this.sleep(Math.max(0,this.last+this.delay-Date.now()));
        signal?.throwIfAborted();
        this.requests++;this.last=Date.now();
        const fetchedAt=new Date().toISOString();
        try {
          const response=await this.fetcher(url,{headers:{'User-Agent':userAgent('amendment benchmark'),Accept:accept||(url.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/json'),...(language?{'Accept-Language':language}:{})},redirect:'manual',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60_000)]):AbortSignal.timeout(60_000)});
          const chunks=[];let bytes=0;
          for await (const chunk of response.body || []) {
            bytes+=chunk.length;
            if(bytes>maximum)throw new Error('input-size-limit');
            chunks.push(chunk);
          }
          body=Buffer.concat(chunks);
          meta={url,fetchedAt,status:response.status,ok:response.ok,bytes:body.length,sha256:digest(body),error:response.ok?null:'http-'+response.status,...(request?{request}:{}),headers:Object.fromEntries(['content-type','location','etag','last-modified'].map(key=>[key,response.headers.get(key)]).filter(([,value])=>value!==null))};
          if(allowedDownload(url)&&[301,302,303,307,308].includes(response.status)&&response.headers.get('location')) {
            meta.redirectUrl=new URL(response.headers.get('location'),url).href;
            meta.ok=true;meta.error=null;
          }
          if([429,503].includes(response.status)) {
            // The embargo also precedes the NEXT URL after the final retry.
            const header=response.headers.get('retry-after');
            const retry=header&&(/^\d+$/.test(header)||Number.isFinite(Date.parse(header)))?retryDelay(header):60_000;
            if(retry>this.maxRetryAfter)throw new Error('retry-after-exceeds-cap: '+retry);
            const delay=Math.max(this.delay,retry,1000);
            this.last=Date.now()+delay-this.delay;
            if(attempt<2&&this.requests<this.cap)continue;
            throw new Error('transient-http-'+response.status);
          }
        } catch(error) {
          signal?.throwIfAborted();
          if(error.message.startsWith('retry-after-exceeds-cap')||attempt===2||this.requests>=this.cap)throw new Error('Acquisition failed (not cached): '+url+' '+error.message);
          continue;
        }
        if(responseIsTransient(meta)) {
          if(attempt<2&&this.requests<this.cap){this.last=Date.now()+Math.max(this.delay,1000*2**attempt)-this.delay;continue;}
          throw new Error('Acquisition failed (not cached): '+url+' '+meta.error);
        }
        break;
      }
      await writeFile(bodyPath+'.tmp',body);await rename(bodyPath+'.tmp',bodyPath);
      await writeFile(metaPath+'.tmp',JSON.stringify(meta,null,2)+'\n');await rename(metaPath+'.tmp',metaPath);
    }
    if(responseIsTransient(meta)||meta.status===null)throw new Error('Transient cached input; use a new snapshot: '+url);
    this.used.set(identity,meta);
    if(meta.redirectUrl&&!raw) {
      if(hops>=3||!allowedDownload(meta.redirectUrl)) {
        throw new Error(hops>=3?'document-redirect-limit':'unapproved-document-redirect');
      }
      const resolved=await this.get(meta.redirectUrl,{officialRedirect:true,hops:hops+1});
      return {...resolved,url,resolvedSourceUrl:resolved.resolvedSourceUrl||resolved.url};
    }
    if(!meta.ok&&!(raw&&[301,302,303,307,308].includes(meta.status)&&meta.headers?.location))this.missing.set(url,meta.error);
    return {...meta,body};
  }
  async seal(manifest) {
    this.fetchMissing=false;
    // Validate every frozen input, including files this producer no longer reads.
    for(const meta of manifest)await this.get(meta.url,{...meta.request,raw:true,officialRedirect:allowedDownload(meta.url)});
    if(JSON.stringify(this.manifest())!==JSON.stringify(manifest))throw new Error('Frozen snapshot manifest/cache metadata mismatch.');
    this.sealed=new Set(manifest.map(meta=>meta.request?JSON.stringify([meta.url,meta.request]):meta.url));
  }
  manifest() {return [...this.used.values()].sort((a,b)=>a.url.localeCompare(b.url,'en')||JSON.stringify(a.request||{}).localeCompare(JSON.stringify(b.request||{}),'en'));}
  async json(url) {
    const input=await this.get(url);
    if(!input.ok)return {input,value:null};
    try {return {input,value:JSON.parse(input.body.toString('utf8'))};}catch {throw new Error('Invalid JSON input: '+url);}
  }
}

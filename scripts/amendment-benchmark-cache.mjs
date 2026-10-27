import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {Readable} from 'node:stream';
import {userAgent} from '../server/user-agent.mjs';
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
    || value.origin === 'https://data.europarl.europa.eu' && /^\/api\/v2\/(?:plenary-documents\/(?:A|B|RC)-10-\d{4}-\d{4,6}|documents\/(?:A|B|RC)-10-\d{4}-\d{4,6}-AM-\d+-\d+)$/.test(value.pathname) && value.search === '?format=application%2Fld%2Bjson'
    || value.origin === 'https://data.europarl.europa.eu' && /^\/distribution\/.+\.docx$/i.test(value.pathname) && !value.search);
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
// Match the application's standard HTTPS transport for official DOCX files:
// this distribution route returns 500 to Node fetch instead of its normal 302.
function publicFetch(url,options) {
  if(!allowedDownload(url)&&!url.startsWith('https://data.europarl.europa.eu/api/v2/'))return fetch(url,options);
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
  async get(url,{officialRedirect=false,hops=0}={}) {
    if (!(officialRedirect?allowedDownload(url):allowedInput(url,this.apiBase))) throw new Error('Unsupported public input URL: '+url);
    const key=digest(url), metaPath=path.join(this.directory,key+'.json'), bodyPath=path.join(this.directory,key+'.body');
    let meta,body;
    try {meta=JSON.parse(await readFile(metaPath,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
    if (meta) {
      if (meta.url!==url) throw new Error('Cache URL mismatch: '+url);
      body=await readFile(bodyPath);
      if (body.length!==meta.bytes||digest(body)!==meta.sha256) throw new Error('Cache hash mismatch: '+url);
    } else {
      if (!this.fetchMissing || this.requests>=this.cap) {
        throw new Error((this.fetchMissing?'request-cap-exhausted':'input-not-cached')+': '+url);
      }
      for(let attempt=0;attempt<3;attempt++) {
        if(this.requests>=this.cap)break;
        await this.sleep(Math.max(0,this.last+this.delay-Date.now()));
        this.requests++;this.last=Date.now();
        const fetchedAt=new Date().toISOString();
        try {
          const response=await this.fetcher(url,{headers:{'User-Agent':userAgent('amendment benchmark'),Accept:url.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':url.startsWith('https://data.europarl.europa.eu/api/v2/')?'application/ld+json':'application/json'},redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(60_000)});
          const chunks=[];let bytes=0;
          for await (const chunk of response.body || []) {
            bytes+=chunk.length;
            if(bytes>16*1024*1024)throw new Error('input-size-limit');
            chunks.push(chunk);
          }
          body=Buffer.concat(chunks);
          meta={url,fetchedAt,status:response.status,ok:response.ok,bytes:body.length,sha256:digest(body),error:response.ok?null:'http-'+response.status};
          if(allowedDownload(url)&&[301,302,303,307,308].includes(response.status)&&response.headers.get('location')) {
            meta.redirectUrl=new URL(response.headers.get('location'),url).href;
            meta.ok=true;meta.error=null;
          }
          if([429,503].includes(response.status)) {
            // The embargo also precedes the NEXT URL after the final retry.
            const retry=retryDelay(response.headers.get('retry-after'));
            if(retry>this.maxRetryAfter)throw new Error('retry-after-exceeds-cap: '+retry);
            const delay=Math.max(this.delay,retry,1000);
            this.last=Date.now()+delay-this.delay;
            if(attempt<2&&this.requests<this.cap)continue;
            throw new Error('transient-http-'+response.status);
          }
        } catch(error) {
          if(error.message.startsWith('retry-after-exceeds-cap')||attempt===2||this.requests>=this.cap)throw new Error('Acquisition failed (not cached): '+url+' '+error.message);
          continue;
        }
        if(responseIsTransient(meta))throw new Error('Acquisition failed (not cached): '+url+' '+meta.error);
        break;
      }
      await writeFile(bodyPath+'.tmp',body);await rename(bodyPath+'.tmp',bodyPath);
      await writeFile(metaPath+'.tmp',JSON.stringify(meta,null,2)+'\n');await rename(metaPath+'.tmp',metaPath);
    }
    if(responseIsTransient(meta)||meta.status===null)throw new Error('Transient cached input; use a new snapshot: '+url);
    this.used.set(url,meta);
    if(meta.redirectUrl) {
      if(hops>=3||!allowedDownload(meta.redirectUrl)) {
        throw new Error(hops>=3?'document-redirect-limit':'unapproved-document-redirect');
      }
      const resolved=await this.get(meta.redirectUrl,{officialRedirect:true,hops:hops+1});
      return {...resolved,url,resolvedSourceUrl:resolved.resolvedSourceUrl||resolved.url};
    }
    if(!meta.ok)this.missing.set(url,meta.error);
    return {...meta,body};
  }
  manifest() {return [...this.used.values()].sort((a,b)=>a.url.localeCompare(b.url,'en'));}
  async json(url) {
    const input=await this.get(url);
    if(!input.ok)return {input,value:null};
    try {return {input,value:JSON.parse(input.body.toString('utf8'))};}catch {throw new Error('Invalid JSON input: '+url);}
  }
}

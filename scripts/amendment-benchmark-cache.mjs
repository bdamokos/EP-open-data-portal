import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {userAgent} from '../server/user-agent.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const API_BASE = 'https://ep.bdamokos.org';
const repo = fileURLToPath(new URL('../',import.meta.url));
export async function outsideRepository(directory) {
  await mkdir(directory,{recursive:true});
  const resolved = await realpath(directory), root = await realpath(repo);
  if (resolved === root || resolved.startsWith(root+path.sep)) throw new Error('Benchmark cache/output must be outside the repository.');
  return resolved;
}
export function allowedInput(url) {
  const value = new URL(url);
  return value.protocol === 'https:' && !value.username && !value.password && !value.hash && (
    value.origin === API_BASE && /^\/api\/(?:amendments$|document-context\/(?:A|B|RC)-10-\d{4}-\d{4,6}$)/.test(value.pathname)
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
export class InputCache {
  constructor(directory,{fetchMissing=false,cap=1500,delay=750,fetcher=fetch,sleep=wait}={}) {
    Object.assign(this,{directory,fetchMissing,cap,delay,fetcher,sleep});
    this.requests=0;this.last=0;this.used=new Map();this.missing=new Map();
  }
  async get(url) {
    if (!allowedInput(url)) throw new Error('Unsupported public input URL: '+url);
    const key=digest(url), metaPath=path.join(this.directory,key+'.json'), bodyPath=path.join(this.directory,key+'.body');
    let meta,body;
    try {meta=JSON.parse(await readFile(metaPath,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
    if (meta) {
      if (meta.url!==url) throw new Error('Cache URL mismatch: '+url);
      body=await readFile(bodyPath);
      if (body.length!==meta.bytes||digest(body)!==meta.sha256) throw new Error('Cache hash mismatch: '+url);
    } else {
      if (!this.fetchMissing || this.requests>=this.cap) {
        // A capped acquisition and its offline replay have the same missing
        // observation. Whether this run could fetch is run metadata, not data.
        this.missing.set(url,'not-cached');
        return {ok:false,status:null,error:'not-cached',url};
      }
      for(let attempt=0;attempt<3;attempt++) {
        if(this.requests>=this.cap)break;
        await this.sleep(Math.max(0,this.last+this.delay-Date.now()));
        this.requests++;this.last=Date.now();
        const fetchedAt=new Date().toISOString();
        try {
          const response=await this.fetcher(url,{headers:{'User-Agent':userAgent('amendment benchmark'),Accept:url.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60_000)});
          const chunks=[];let bytes=0;
          for await (const chunk of response.body || []) {
            bytes+=chunk.length;
            if(bytes>16*1024*1024)throw new Error('input-size-limit');
            chunks.push(chunk);
          }
          body=Buffer.concat(chunks);
          meta={url,fetchedAt,status:response.status,ok:response.ok,bytes:body.length,sha256:digest(body),error:response.ok?null:'http-'+response.status};
          if([429,503].includes(response.status)) {
            // The embargo also precedes the NEXT URL after the final retry.
            const delay=Math.max(this.delay,retryDelay(response.headers.get('retry-after')),1000);
            this.last=Date.now()+delay-this.delay;
            if(attempt<2&&this.requests<this.cap)continue;
          }
        } catch(error) {
          body=Buffer.alloc(0);meta={url,fetchedAt,status:null,ok:false,bytes:0,sha256:digest(body),error:error.message};
        }
        break;
      }
      await writeFile(bodyPath+'.tmp',body);await rename(bodyPath+'.tmp',bodyPath);
      await writeFile(metaPath+'.tmp',JSON.stringify(meta,null,2)+'\n');await rename(metaPath+'.tmp',metaPath);
    }
    this.used.set(url,meta);
    if(!meta.ok)this.missing.set(url,meta.error);
    return {...meta,body};
  }
  manifest() {return [...this.used.values()].sort((a,b)=>a.url.localeCompare(b.url,'en'));}
  async json(url) {
    const input=await this.get(url);
    if(!input.ok)return {input,value:null};
    try {return {input,value:JSON.parse(input.body.toString('utf8'))};}catch {this.missing.set(url,'invalid-json');return {input:{...input,ok:false,error:'invalid-json'},value:null};}
  }
}

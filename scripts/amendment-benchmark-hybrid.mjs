import {readFile,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {publicDocumentUrl} from './amendment-benchmark-replay.mjs';

const key=(url,request)=>request?JSON.stringify([url,request]):url;
const actual=input=>input?.ok&&!input.acquisitionUnavailable&&input.bytes>0&&input.sha256!==digest(Buffer.alloc(0));
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
async function source(directory) {
  directory=await realpath(directory);
  const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));
  if(snapshot.schemaVersion!==3||snapshot.snapshotId!==digest(JSON.stringify({apiBase:snapshot.apiBase,sample:snapshot.sample,manifest:snapshot.manifest})))throw new Error('Invalid hybrid source seal');
  const cache=new InputCache(path.join(directory,'inputs'),{apiBase:snapshot.apiBase,cap:0});
  const manifest=new Map(snapshot.manifest.map(m=>[key(m.url,m.request),m]));
  return {directory,snapshot,async read(url,request){
    const meta=manifest.get(key(url,request));if(!meta)return null;
    const input=await cache.get(url,{...request,raw:true});const {body,...found}=input;
    if(stable(found)!==stable(meta))throw new Error('Hybrid source differs from seal: '+url);
    return input;
  }};
}

// Only canonical base readers enter these scopes. A shared wording/base URL
// remains owned by A because URL-keyed replay cannot represent two bodies.
export class HybridInputs {
  static async open(copy,base,destination,output) {
    const a=await source(copy),b=await source(base);
    const targets=[destination,output].filter(Boolean);
    for(const directory of targets){
    let parent=path.resolve(directory),suffix=[];
    while(true){try{parent=await realpath(parent);break;}catch(e){if(e.code!=='ENOENT')throw e;suffix.unshift(path.basename(parent));parent=path.dirname(parent);}}
    const target=path.join(parent,...suffix);
    for(const s of [a,b])if(target===s.directory||target.startsWith(s.directory+path.sep)||s.directory.startsWith(target+path.sep))throw new Error('Hybrid destination must be separate from both sources');
    try{if((await readdir(target)).length)throw new Error('Hybrid requires a new empty cache');}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    if(a.snapshot.apiBase!==b.snapshot.apiBase||a.snapshot.asOf!==b.snapshot.asOf)throw new Error('Hybrid source origin/date mismatch');
    return new HybridInputs(a,b);
  }
  constructor(a,b){Object.assign(this,{a,b});this.scope=new AsyncLocalStorage();this.wording=new Set();this.rows={};this.current=[];}
  baseScope(identity,operation){return this.scope.run(identity,operation);}
  registerWording(row){for(const v of row.variants?.length?row.variants:[row])if(v.wordingSource?.url)this.wording.add(v.wordingSource.url);}
  trackRows(rows){this.current=rows.map(r=>r.id);for(const row of rows){this.rows[row.id]??={catalogue:this.a.snapshot.snapshotId,wording:this.a.snapshot.snapshotId,bindings:(row.variants?.length?row.variants:[row]).map(v=>({listId:v.listId,language:v.language,url:v.wordingSource?.url??null})),inputs:[]};this.registerWording(row);}}
  observe(meta){for(const id of this.current){const inputs=this.rows[id].inputs,k=key(meta.url,meta.request);if(!inputs.some(i=>key(i.url,i.request)===k))inputs.push({url:meta.url,...(meta.request?{request:meta.request}:{}),sha256:meta.sha256,...meta.hybridSource});}}
  receipt(){return {protocol:'settled-base-hybrid-v1',copySnapshotId:this.a.snapshot.snapshotId,baseSnapshotId:this.b.snapshot.snapshotId,rows:this.rows};}
  async get(url,request){
    const a=await this.a.read(url,request),identity=this.scope.getStore();
    if(a&&!a.acquisitionUnavailable||!identity||this.wording.has(url))return this.wrap(a,url,request,this.a,identity,a?'copy-input':'missing-copy-input');
    let proven=true;
    let proof=null;
    if(identity.type==='ep-document'){proof=await this.epProof(identity);proven=Boolean(proof);}
    else if(identity.type!=='cellar')proven=false;
    const b=proven?await this.b.read(url,request):null;
    // Empty gap hashes are not observations. An attested actual hash conflict
    // cannot be repaired by taking an older observation.
    const redirect=b&&[301,302,303,307,308].includes(b.status)&&typeof b.headers?.location==='string'&&Number.isFinite(Date.parse(b.fetchedAt));
    if((actual(b)||identity.type==='cellar'&&redirect)&&(!actual(a)||a.sha256===b.sha256))return this.wrap(b,url,request,this.b,proof?{...identity,proof}:identity,'settled-base-fallback');
    return this.wrap(a?.acquisitionUnavailable?a:null,url,request,a?.acquisitionUnavailable?this.a:null,identity,proven?'base-missing-in-both':'base-identity-mismatch');
  }
  async epProof(identity){
    const url=publicDocumentUrl(identity.documentId),request={accept:'application/ld+json'};
    const inputs=await Promise.all([this.a.read(url,request),this.b.read(url,request)]);
    const descriptors=inputs.map(input=>{
      if(!actual(input))return [];
      const work=JSON.parse(input.body).data?.[0];
      const expected='def/ep-document-types/'+(identity.documentId.startsWith('A-')?'REPORT_PLENARY':identity.documentId.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION');
      if(String(work?.work_type?.id||work?.work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')!==expected)return [];
      if(!['eli/dl/doc/'+identity.documentId,'https://data.europarl.europa.eu/eli/dl/doc/'+identity.documentId].includes(work?.id))return [];
      const files=this.runtime.documentFiles(work).filter(f=>f.url===identity.file.url&&f.language===identity.file.language&&f.format==='DOCX');
      // documentFiles supplies canonical URL/language/format; retain edition
      // fields as well, including publisher size and issue time.
      return files.flatMap(file=>this.runtime.array(work.is_realized_by).flatMap(e=>this.runtime.array(e.is_embodied_by).filter(m=>m.is_exemplified_by===file.url||new URL(m.is_exemplified_by,'https://data.europarl.europa.eu').href===file.url).map(m=>({file,descriptor:m,edition:Object.fromEntries(['epNumberVersion','isVersionOf','is_replaced_by','replaces'].filter(k=>work[k]!==undefined).map(k=>[k,work[k]]))}))));
    });
    if(!descriptors.every(d=>d.length===1)||stable(descriptors[0][0])!==stable(descriptors[1][0]))return null;
    return {declaration:descriptors[0][0],observations:inputs.map((input,i)=>({snapshotId:[this.a,this.b][i].snapshot.snapshotId,url:input.url,request:input.request,sha256:input.sha256,fetchedAt:input.fetchedAt}))};
  }
  wrap(input,url,request,source,identity,reason){
    const gap={url,status:null,ok:false,fetchedAt:null,bytes:0,sha256:digest(Buffer.alloc(0)),error:'acquisition-unavailable',headers:{},acquisitionUnavailable:true,acquisitionUnavailableReason:reason,body:Buffer.alloc(0),...(request?{request}:{})};
    return {...(input||gap),hybridSource:{snapshotId:input&&source?source.snapshot.snapshotId:null,role:this.wording.has(url)?'wording':identity?'base':'copy',identity:identity||null,...(identity?{attemptedSnapshotIds:[this.a.snapshot.snapshotId,this.b.snapshot.snapshotId]}:{}),reason}};
  }
}

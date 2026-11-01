import {createHash} from 'node:crypto';
import {readFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {writeCacheFile} from './cache-publication.mjs';
import {integerFromEnvironment} from './config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const queues=new Map();
export const BASE_SOURCE_DEFAULT_MIB=128;
// Unlike a reproducible cache, current observations are never evicted. Refuse
// admission when their union fills the budget; only orphan/superseded bytes go.
export class BaseSourceStore {
  constructor(directory,{maxBytes=integerFromEnvironment('BASE_SOURCE_MAX_DISK_MIB',BASE_SOURCE_DEFAULT_MIB,1,8192)*1024*1024,readOnly=false}={}) {
    Object.assign(this,{directory,maxBytes,readOnly});
  }
  save(observation,body) {
    if(!this.directory||this.readOnly)return Promise.resolve(false);
    const previous=queues.get(this.directory)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>this.publish(observation,body));
    queues.set(this.directory,task);
    return task.finally(()=>{if(queues.get(this.directory)===task)queues.delete(this.directory);});
  }
  async publish(observation,body) {
    if(!Buffer.isBuffer(body)||body.length>12*1024*1024)return false;
    const {url,request={},fetchedAt}=observation;
    if(typeof url!=='string'||!Number.isFinite(Date.parse(fetchedAt)))return false;
    const key=hash(JSON.stringify([url,request.accept??null,request.language??null]));
    const record={...observation,schemaVersion:1,key,sha256:hash(body),bytes:body.length};
    const json=JSON.stringify(record);if(Buffer.byteLength(json)>256*1024)return false;
    let names=[];try{names=await readdir(this.directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    const records=[];
    for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)))records.push({name,record:JSON.parse(await readFile(path.join(this.directory,name),'utf8'))});
    const references=new Set(records.map(r=>r.record.sha256));
    for(const name of names.filter(n=>/^[a-f0-9]{64}\.blob$/.test(n)))if(!references.has(name.slice(0,-5)))await unlink(path.join(this.directory,name));
    const retained=records.filter(r=>r.name!==key+'.json');
    if(retained.length>=4096)return false;
    const blobs=new Map(retained.map(r=>[r.record.sha256,r.record.bytes]));blobs.set(record.sha256,body.length);
    const total=[...blobs.values()].reduce((a,b)=>a+b,0)+retained.reduce((a,r)=>a+Buffer.byteLength(JSON.stringify(r.record)),0)+Buffer.byteLength(json);
    if(total>this.maxBytes)return false;
    // Allow bounded transient overlap with the superseded blob until the new
    // descriptor is atomic. A failed publication leaves the prior binding usable.
    if(!await writeCacheFile(path.join(this.directory,record.sha256+'.blob'),body))return false;
    if(!await writeCacheFile(path.join(this.directory,key+'.json'),json))return false;
    const current=new Set([...retained.map(r=>r.record.sha256),record.sha256]);
    for(const {record:old} of records)if(/^[a-f0-9]{64}$/.test(old.sha256)&&!current.has(old.sha256))await unlink(path.join(this.directory,old.sha256+'.blob')).catch(()=>{});
    return true;
  }
}
const stores=new Map();
export async function retainBaseObservation(observation,body,{directory=process.env.ODP_CACHE_DIR}={}) {
  if(!directory)return false;
  const folder=path.join(directory,'base-sources-v1');
  let store=stores.get(folder);if(!store){store=new BaseSourceStore(folder);stores.set(folder,store);}
  try{return await store.save(observation,body);}catch{return false;}
}

// Selection records contain observed identifiers and deterministic decisions,
// never native text, buffers, titles or similarity scores.
function selectionFacts(value) {
  if(Array.isArray(value))return value.map(selectionFacts);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['buffer','paragraphs','text','raw','title','titles','score','similarity'].includes(key)).map(([key,v])=>[key,selectionFacts(v)]));
}
export async function retainBaseSelection(type,input,result,{directory=process.env.ODP_CACHE_DIR}={}) {
  const {nativeReferencePair,documentReferences,...ids}=input;
  const identity=selectionFacts({...ids,...(documentReferences?{documentReferences:documentReferences.map(r=>({field:r.field,reference:r.raw}))}:{}),...(nativeReferencePair?{nativeReferencePair:{report:nativeReferencePair.report?.source,listId:nativeReferencePair.list?.listId,list:nativeReferencePair.list?.source,selection:nativeReferencePair.selection}}:{})}),decision=selectionFacts(result);
  const url='base-selection:'+type+':'+hash(JSON.stringify(identity));
  await retainBaseObservation({url,status:200,fetchedAt:new Date().toISOString(),request:{accept:'application/json'},headers:{'content-type':'application/json'},selection:{type,input:identity}},Buffer.from(JSON.stringify(decision)),{directory});
  return result;
}

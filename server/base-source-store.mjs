import {createHash} from 'node:crypto';
import {readFile,readdir,unlink,stat} from 'node:fs/promises';
import {isMainThread,workerData} from 'node:worker_threads';
import {sendRetention} from './base-source-rpc.mjs';
import path from 'node:path';
import {writeCacheFile} from './cache-publication.mjs';
import {integerFromEnvironment} from './config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const queues=new Map();
export const BASE_SOURCE_DEFAULT_MIB=128;
// Unlike a reproducible cache, current observations are never evicted. Refuse
// admission when their union fills the budget; only orphan/superseded bytes go.
export class BaseSourceStore {
  constructor(directory,{maxBytes=integerFromEnvironment('BASE_SOURCE_MAX_DISK_MIB',BASE_SOURCE_DEFAULT_MIB,1,8192)*1024*1024,readOnly=false,io={readFile,readdir,unlink,stat},write=writeCacheFile}={}) {
    Object.assign(this,{directory,maxBytes,readOnly,io,write});
    this.records=new Map();this.blobs=new Map();this.totalBytes=0;this.ready=null;
  }
  save(observation,body) {
    if(!this.directory||this.readOnly)return Promise.resolve(false);
    const previous=queues.get(this.directory)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>this.publish(observation,body));
    queues.set(this.directory,task);
    return task.finally(()=>{if(queues.get(this.directory)===task)queues.delete(this.directory);});
  }
  async reconcile() {
    let names=[];try{names=await this.io.readdir(this.directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    // Count every file, including interrupted publication temporaries. Unknown
    // files stay charged; only known unreferenced blobs may be removed.
    for(const name of names) {
      const file=path.join(this.directory,name),size=(await this.io.stat(file)).size;
      this.totalBytes+=size;
      if(/^[a-f0-9]{64}\.blob$/.test(name))this.blobs.set(name.slice(0,-5),{bytes:size,refs:0});
      if(/^[a-f0-9]{64}\.json$/.test(name)) {
        const record=JSON.parse(await this.io.readFile(file,'utf8'));
        if(!/^[a-f0-9]{64}$/.test(record.sha256)||!Number.isSafeInteger(record.bytes)||record.bytes<0)throw new Error('Invalid retention descriptor');
        this.records.set(name.slice(0,-5),{record,bytes:size});
      }
    }
    for(const {record} of this.records.values()) {
      const blob=this.blobs.get(record.sha256);
      if(!blob||blob.bytes!==record.bytes)throw new Error('Missing retention blob');
      blob.refs++;
    }
    for(const [sha,blob] of this.blobs)if(!blob.refs)await this.removeBlob(sha);
  }
  async removeBlob(sha) {
    const blob=this.blobs.get(sha);if(!blob||blob.refs)return;
    try{await this.io.unlink(path.join(this.directory,sha+'.blob'));}
    catch(error){if(error.code!=='ENOENT')return;}
    this.totalBytes-=blob.bytes;this.blobs.delete(sha);
  }
  async publish(observation,body) {
    if(!Buffer.isBuffer(body)||body.length>12*1024*1024)return false;
    const {url,request={},fetchedAt}=observation;
    if(typeof url!=='string'||!Number.isFinite(Date.parse(fetchedAt)))return false;
    // A failed reconciliation remains failed, rather than admitting against a
    // partially reconstructed index. Restart can retry it safely.
    await (this.ready??=this.reconcile());
    const key=hash(JSON.stringify([url,request.accept??null,request.language??null]));
    const record={...observation,schemaVersion:1,key,sha256:hash(body),bytes:body.length};
    const json=JSON.stringify(record),bytes=Buffer.byteLength(json);if(bytes>256*1024)return false;
    const old=this.records.get(key),existing=this.blobs.get(record.sha256);
    if(!old&&this.records.size>=4096)return false;
    const oldBlob=old&&this.blobs.get(old.record.sha256);
    const reclaim=oldBlob?.refs===1&&old.record.sha256!==record.sha256?oldBlob.bytes:0;
    const total=this.totalBytes-(old?.bytes||0)-reclaim+(existing?0:body.length)+bytes;
    if(total>this.maxBytes)return false;
    if(!existing) {
      if(!await this.write(path.join(this.directory,record.sha256+'.blob'),body,{signal:null,onOrphan:bytes=>{this.totalBytes+=bytes;}}))return false;
      this.blobs.set(record.sha256,{bytes:body.length,refs:0});this.totalBytes+=body.length;
    }
    let published=false;
    try {published=await this.write(path.join(this.directory,key+'.json'),json,{signal:null,onOrphan:bytes=>{this.totalBytes+=bytes;}});}
    finally {if(!published)await this.removeBlob(record.sha256);}
    if(!published)return false;
    this.records.set(key,{record,bytes});this.totalBytes+=bytes-(old?.bytes||0);
    this.blobs.get(record.sha256).refs++;
    if(old){oldBlob.refs--;await this.removeBlob(old.record.sha256);}
    return true;
  }
}
const stores=new Map();
// Only the #457 source-writer isolate can create a production store. Readers
// (including nested workers without a capture route) never fall back to disk.
export async function retainBaseObservation(observation,body,{directory=process.env.ODP_CACHE_DIR}={}) {
  try {
    if(!directory)return false;
    if(isMainThread||!workerData?.sourceWriter)return await sendRetention({observation,body,directory});
    if(observation.selection&&observation.url==='base-selection:'+observation.selection.type)observation={...observation,url:observation.url+':'+hash(JSON.stringify(observation.selection.input))};
    const folder=path.join(directory,'base-sources-v1');
    let store=stores.get(folder);if(!store){store=new BaseSourceStore(folder);stores.set(folder,store);}
    return await store.save(observation,Buffer.from(body));
  }catch{return false;}
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
  const url='base-selection:'+type;
  await retainBaseObservation({url,status:200,fetchedAt:new Date().toISOString(),request:{accept:'application/json'},headers:{'content-type':'application/json'},selection:{type,input:identity}},Buffer.from(JSON.stringify(decision)),{directory});
  return result;
}

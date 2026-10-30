import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {documentImages,imageInfo,IMAGE_LIMITS} from './docx-images.mjs';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {writeCacheFile} from './cache-publication.mjs';
import {requestSignal} from './request-budget.mjs';
import {HttpError} from './http-utils.mjs';

export const DOCUMENT_IMAGE_STORE_VERSION=1;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Image requests never fetch a URL. Only validated bytes extracted from an exact
// source digest may be served. Text JSON carries small descriptors, not base64.
export class DocumentImageStore {
  constructor(){this.memory=new Map();this.bytes=0;this.budgets=new Map();}
  budget(folder){if(!this.budgets.has(folder))this.budgets.set(folder,new CacheDiskBudget(folder,{maxBytes:64*1024*1024,maxEntries:1000,pattern:/^[a-f0-9]{64}-[a-f0-9]{64}\.bin$/}));return this.budgets.get(folder);}
  remember(key,body){this.bytes-=this.memory.get(key)?.length||0;this.memory.delete(key);this.memory.set(key,body);this.bytes+=body.length;while(this.bytes>32*1024*1024||this.memory.size>200){const oldest=this.memory.keys().next().value;this.bytes-=this.memory.get(oldest).length;this.memory.delete(oldest);}}
  async publish(record,{directory=process.env.ODP_CACHE_DIR}={}){
    const descriptors={};if(!hex(record?.sourceHash))return descriptors;
    const folder=directory&&path.join(directory,'document-images-v1');
    for(const [id,asset] of Object.entries(documentImages(record))){
      requestSignal()?.throwIfAborted();
      const body=Buffer.from(asset.data,'base64'),key=record.sourceHash+'-'+id+'.bin';
      this.remember(key,body);
      // A cache failure must not make the source text unavailable. Memory can
      // still serve this request; eviction gives an explicit unavailable image.
      if(folder)try{if(await writeCacheFile(path.join(folder,key),body))await this.budget(folder).saved(key,body.length);}catch{requestSignal()?.throwIfAborted();}
      const {data,...descriptor}=asset;descriptors[id]={...descriptor,sourceHash:record.sourceHash};
    }return descriptors;
  }
  async read(sourceHash,imageHash,{directory=process.env.ODP_CACHE_DIR}={}){
    if(!hex(sourceHash)||!hex(imageHash))throw new HttpError(400,'invalid_image','Invalid document image.');
    const key=sourceHash+'-'+imageHash+'.bin',folder=directory&&path.join(directory,'document-images-v1');let body=this.memory.get(key);
    if(!body&&folder)try{
      const file=path.join(folder,key),info=await stat(file);if(info.isFile()&&info.size<=IMAGE_LIMITS.bytes)body=await readFile(file);requestSignal()?.throwIfAborted();
    }catch{requestSignal()?.throwIfAborted();}
    if(!body||body.length>IMAGE_LIMITS.bytes||createHash('sha256').update(body).digest('hex')!==imageHash)throw new HttpError(404,'image_unavailable','Document image unavailable.');
    const info=imageInfo(body);if(!info)throw new HttpError(404,'image_unavailable','Document image unavailable.');
    this.remember(key,body);if(folder)this.budget(folder).used(key);return {body,...info};
  }
}
const store=new DocumentImageStore();
export const publishDocumentImages=(record,options)=>store.publish(record,options);
export const documentImage=(sourceHash,imageHash,options)=>store.read(sourceHash,imageHash,options);

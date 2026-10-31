import {languageCode} from './ep-links.mjs';
import {documentEndpoint} from './activities.mjs';
import {createHash} from 'node:crypto';
import https from 'node:https';
import {odp,boundedUpstream,upstreamResponseError} from './odp.mjs';
import {documentFiles,array,tail} from './activity-index-model.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {userAgent} from './user-agent.mjs';
import {HttpError} from './http-utils.mjs';

export const DOCUMENT_PAGES_VERSION=1;
export const PDF_MAX_BYTES=16*1024*1024;
export function allowedPdf(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname.endsWith('.pdf')&&((u.hostname==='data.europarl.europa.eu'&&u.pathname.startsWith('/distribution/'))||(u.hostname==='redmapl3.europarl.europa.eu'&&u.pathname.startsWith('/RedmapFront/media/')));}catch{return false;}}
export function pdfEdition(work,language){
  const candidates=array(work.is_realized_by).filter(e=>languageCode(e.language)===language).flatMap(e=>array(e.is_embodied_by).filter(m=>tail(m.format)==='PDF').flatMap(m=>{
    const file=documentFiles({is_realized_by:[{...e,is_embodied_by:[m]}]})[0];
    return file&&allowedPdf(file.url)?[{...file,expressionId:e.id||null,manifestationId:m.id||null,issued:m.issued||null}]:[];
  }));
  const unique=[...new Map(candidates.map(file=>[JSON.stringify(file),file])).values()];return unique.length===1?unique[0]:null;
}
export async function downloadPdf(url,{signal=requestSignal()}={}){
  for(let hop=0;hop<4;hop++){
    if(!allowedPdf(url))throw new HttpError(400,'unsupported_pdf','Unsupported document address.');
    const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'application/pdf','User-Agent':userAgent('document pages')},signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[])])},resolve).on('error',reject));
    const limited=upstreamResponseError(response,{source:'documents'});if(limited){response.resume();throw limited;}
    if([301,302,303,307,308].includes(response.statusCode)){const next=response.headers.location;response.destroy();if(!next)throw Error('Missing document redirect.');url=new URL(next,url).href;continue;}
    if(response.statusCode!==200){response.resume();throw new HttpError(502,'pdf_unavailable','Document pages unavailable.');}
    if(Number(response.headers['content-length'])>PDF_MAX_BYTES){response.destroy();throw new HttpError(413,'pdf_size_limit','Document exceeds the page-view size limit.');}
    const chunks=[];let length=0;
    for await(const chunk of response){length+=chunk.length;if(length>PDF_MAX_BYTES){response.destroy();throw new HttpError(413,'pdf_size_limit','Document exceeds the page-view size limit.');}chunks.push(chunk);}
    const body=Buffer.concat(chunks);if(body.length<5||body.toString('ascii',0,5)!=='%PDF-')throw new HttpError(502,'invalid_pdf','Document pages unavailable.');
    return {body,resolvedSourceUrl:url,sha256:createHash('sha256').update(body).digest('hex'),fetchedAt:new Date().toISOString()};
  }throw Error('Too many document redirects.');
}
// A short-lived bounded cache, independent of source/index collectors.
export class DocumentPages {
  constructor({read=odp,download=downloadPdf,clock=Date.now}={}){Object.assign(this,{read,download,clock});this.saved=new Map();this.pending=new Map();this.bytes=0;}
  async query(id,language){
    if(typeof id!=='string'||id.length>100)throw new HttpError(400,'invalid_document','Choose a published document.');
    const endpoint=documentEndpoint(id);if(!endpoint)throw new HttpError(400,'invalid_document','Choose a published document.');
    const rootId=id.replace(/-ASW$/,''),record=await this.read(endpoint,{}, {staleWhileRevalidate:true});
    const roots=array(record.payload?.data).filter(w=>(w.identifier||tail(w.id))===rootId&&String(w.id).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')==='eli/dl/doc/'+rootId);
    const work=id.endsWith('-ASW')?roots.flatMap(root=>array(root.inverse_answers_to).filter(w=>(w.identifier||tail(w.id))===id)):roots;
    if(work.length!==1)throw new HttpError(404,'document_unavailable','Document unavailable.');
    const file=pdfEdition(work[0],language);if(!file)throw new HttpError(404,'pdf_unavailable','No PDF in this language.');
    const key=JSON.stringify([id,language,file.url,file.byteSize,file.issued]),saved=this.saved.get(key);
    if(saved&&this.clock()-saved.time<60_000)return saved.value;
    if(!this.pending.has(key)){
      const job=sharedRequest(signal=>boundedUpstream(async()=>{
        const value=await this.download(file.url,{signal});signal.throwIfAborted();
        if(file.byteSize>0&&value.body?.length!==file.byteSize)throw new HttpError(502,'pdf_edition_changed','Document edition changed.');
        if(!Buffer.isBuffer(value.body)||value.body.length>PDF_MAX_BYTES||value.body.toString('ascii',0,5)!=='%PDF-')throw new HttpError(502,'invalid_pdf','Document pages unavailable.');
        const entry={...value,sha256:createHash('sha256').update(value.body).digest('hex'),sourceUrl:file.url,expressionId:file.expressionId,manifestationId:file.manifestationId,language};
        if(this.saved.has(key))this.bytes-=this.saved.get(key).value.body.length;
        this.saved.set(key,{time:this.clock(),value:entry});this.bytes+=entry.body.length;
        while(this.bytes>32*1024*1024||this.saved.size>8){const old=this.saved.keys().next().value;this.bytes-=this.saved.get(old).value.body.length;this.saved.delete(old);}
        return entry;
      },{source:'documents',signal})).finally(()=>this.pending.delete(key));this.pending.set(key,job);
    }return waitForRequest(this.pending.get(key));
  }
}
export const documentPages=new DocumentPages();

import {readFile,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {publicDocumentUrl,contextFileDeclarations} from './amendment-benchmark-replay.mjs';
import {allowedDownload} from '../server/document-text.mjs';

const key=(url,request)=>request?JSON.stringify([url,request]):url;
const actual=input=>input?.ok&&!input.acquisitionUnavailable&&input.bytes>0&&input.sha256!==digest(Buffer.alloc(0));
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
// Optional declaration facts constrain only observations present on both sides.
const compatible=(a,b)=>{
  if(a==null||b==null)return true;
  if(typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))return Object.keys(a).every(k=>compatible(a[k],b[k]));
  return stable(a)===stable(b);
};
const hashes=value=>value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>['sha256','contentHash','hash'].includes(k)&&v!=null?[v]:v&&typeof v==='object'?hashes(v):[]):[];
async function source(directory) {
  directory=await realpath(directory);
  const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));
  if(snapshot.schemaVersion!==3||snapshot.snapshotId!==digest(JSON.stringify({apiBase:snapshot.apiBase,sample:snapshot.sample,manifest:snapshot.manifest})))throw new Error('Invalid hybrid source seal');
  const cache=new InputCache(path.join(directory,'inputs'),{apiBase:snapshot.apiBase,cap:0});
  const manifest=new Map(snapshot.manifest.map(m=>[key(m.url,m.request),m]));
  return {directory,snapshot,manifest,async read(url,request){
    const meta=manifest.get(key(url,request));if(!meta)return null;
    const input=await cache.get(url,{...request,raw:true,officialRedirect:allowedDownload(url)});const {body,...found}=input;
    if(stable(found)!==stable(meta))throw new Error('Hybrid source differs from seal: '+url);
    return input;
  }};
}

// Full identity proofs stay in the sealed input manifest. Row provenance uses
// its exact URL/request/hash key plus the supplying snapshot, avoiding one
// copy of the proof for every amendment that reads the same document.
const inputReference=({identity,...reference})=>reference;
export function compactHybridReceipt(receipt) {
  if(!receipt)return receipt;
  return {...receipt,rows:Object.fromEntries(Object.entries(receipt.rows||{}).map(([id,row])=>[id,{...row,inputs:(row.inputs||[]).map(inputReference)}]))};
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
  constructor(a,b){Object.assign(this,{a,b});this.scope=new AsyncLocalStorage();this.wording=new Set();this.wordingRows=new Map();this.rows={};this.current=[];}
  baseScope(identity,operation){return this.scope.run(identity,operation);}
  registerWording(row){for(const v of row.variants?.length?row.variants:[row])if(v.wordingSource?.url){this.wording.add(v.wordingSource.url);const rows=this.wordingRows.get(v.wordingSource.url)||[];rows.push({id:row.id,documentId:row.targetDocumentId,number:row.number,...v});this.wordingRows.set(v.wordingSource.url,rows);}}
  async catalogue(source){
    source.rows??=(async()=>{const rows=[];for(const m of source.snapshot.manifest){if(!m.url.startsWith(source.snapshot.apiBase+'/api/amendments?'))continue;const input=await source.read(m.url,m.request);if(actual(input))for(const row of JSON.parse(input.body).items||[])for(const v of row.variants?.length?row.variants:[row])rows.push({id:row.id,documentId:row.targetDocumentId,number:row.number,...v,catalogueSource:{snapshotId:source.snapshot.snapshotId,url:m.url,sha256:m.sha256,fetchedAt:m.fetchedAt}});}return rows;})();
    return source.rows;
  }
  async wordingProof(url){
    const a=this.wordingRows.get(url)||[],b=await this.catalogue(this.b),proof=[];
    for(const row of a){
      const matches=b.filter(v=>['id','documentId','listId','language'].every(k=>row[k]&&row[k]===v[k])&&v.wordingSource?.url===url);
      if(matches.length!==1)return null;
      const old=matches[0];
      for(const k of ['sha256','contentHash','byteSize','issued','sourceVersion','edition','epNumberVersion','isVersionOf','descriptor'])if(row.wordingSource[k]!=null&&old.wordingSource[k]!=null&&!compatible(row.wordingSource[k],old.wordingSource[k]))return null;
      proof.push({copy:row,base:old});
    }
    return proof.length?{bindings:proof,sourceHashes:proof.flatMap(p=>[...hashes(p.copy.wordingSource),...hashes(p.base.wordingSource)])}:null;
  }
  async nativeSelections(documentId,language){
    const rows=await this.catalogue(this.b),result=[];
    for(const row of rows.filter(r=>r.documentId===documentId&&r.language===language)){
      const url=row.wordingSource?.url,proof=url&&await this.wordingProof(url);
      if(!proof||!proof.bindings.some(p=>p.base.id===row.id&&p.base.listId===row.listId))continue;
      const a=await this.a.read(url),fallback=await this.wordingFallback(url);
      let input=actual(a)?a:fallback?.input;
      if(input?.redirectUrl)input=fallback?await this.b.read(fallback.proof.finalObservation.url):null;
      if(!actual(input)||!proof.sourceHashes.every(hash=>typeof hash==='string'&&hash.toLowerCase()===input.sha256))continue;
      result.push({listId:row.listId,number:row.number,wordingSource:{url,sha256:input.sha256},originalText:row.originalText,proposedText:row.proposedText});
    }
    return result;
  }
  async metadataProof(input){
    if(!input?.localProjection||!actual(input))return null;
    const work=JSON.parse(input.body).data?.[0],documentId=String(work?.id||'').replace(/^https?:\/\/data.europarl.europa.eu\//,'').replace(/^eli\/dl\/doc\//,'');
    if(!/^(?:A|B|RC)-10-\d{4}-\d{4}(?:-AM-\d+-\d+)?$/.test(documentId))return null;
    const base=await this.b.read(input.url,input.request);if(!actual(base))return null;
    const copyFiles=this.runtime.documentFiles(work).filter(f=>f.format==='DOCX');
    const files=this.runtime.documentFiles(JSON.parse(base.body).data?.[0]||{}).filter(f=>f.format==='DOCX'&&copyFiles.some(c=>c.language===f.language));
    if(!files.length)return null;
    const declarations=[];
    for(const file of files){const proof=await this.epProof({documentId,file});if(!proof)return null;declarations.push(proof);}
    return {type:'ep-metadata',documentId,declarations,copyObservation:{snapshotId:this.a.snapshot.snapshotId,sha256:input.sha256,localProjection:input.localProjection}};
  }
  trackRows(rows){this.current=rows.map(r=>r.id);for(const row of rows){this.rows[row.id]??={catalogue:this.a.snapshot.snapshotId,wording:this.a.snapshot.snapshotId,bindings:(row.variants?.length?row.variants:[row]).map(v=>({listId:v.listId,language:v.language,url:v.wordingSource?.url??null})),inputs:[]};this.registerWording(row);}}
  observe(meta){for(const id of this.current){const inputs=this.rows[id].inputs,k=key(meta.url,meta.request);if(!inputs.some(i=>key(i.url,i.request)===k))inputs.push(inputReference({url:meta.url,...(meta.request?{request:meta.request}:{}),sha256:meta.sha256,...meta.hybridSource}));}}
  receipt(){return {protocol:'settled-base-hybrid-v1',copySnapshotId:this.a.snapshot.snapshotId,baseSnapshotId:this.b.snapshot.snapshotId,rows:this.rows};}
  async get(url,request){
    const a=await this.a.read(url,request);const identity=this.scope.getStore();
    const metadata=await this.metadataProof(a);
    if(metadata){const b=await this.b.read(url,request);if(actual(b)&&b.status===200&&Number.isFinite(Date.parse(b.fetchedAt)))return this.wrap(b,url,request,this.b,metadata,'settled-base-metadata');}
    if(!a||a.acquisitionUnavailable){
      const fallback=await this.wordingFallback(url);
      if(fallback)return this.wrap(fallback.input,url,request,this.b,{type:'wording',proof:fallback.proof},fallback.reason);
    }
    if(a&&!a.acquisitionUnavailable||!identity||this.wording.has(url))return this.wrap(a,url,request,this.a,identity,a?'copy-input':'missing-copy-input');
    let proven=true;
    let proof=null;
    if(identity.type==='ep-document'){proof=await this.epProof(identity,url);proven=Boolean(proof);}
    else if(identity.type!=='cellar'||new URL(url).origin!=='https://publications.europa.eu')proven=false;
    if(identity.discoveryRequest&&key(url,request)!==key(identity.discoveryRequest.url,identity.discoveryRequest.request))proven=false;
    const b=proven?await this.b.read(url,request):null;
    if(actual(b)&&![301,302,303,307,308].includes(b.status)&&proof?.sourceHashes?.some(hash=>hash.toLowerCase()!==b.sha256))return this.wrap(null,url,request,null,identity,'base-source-hash-mismatch');
    // Empty gap hashes are not observations. An attested actual hash conflict
    // cannot be repaired by taking an older observation.
    const redirect=b&&[301,302,303,307,308].includes(b.status)&&typeof b.headers?.location==='string'&&Number.isFinite(Date.parse(b.fetchedAt));
    if((actual(b)||redirect&&(identity.type==='cellar'||identity.type==='ep-document'&&this.runtime.allowedDownload(b.redirectUrl||'')))&&(!actual(a)||a.sha256===b.sha256))return this.wrap(b,url,request,this.b,proof?{...identity,proof}:identity,'settled-base-fallback');
    return this.wrap(a?.acquisitionUnavailable?a:null,url,request,a?.acquisitionUnavailable?this.a:null,identity,proven?'base-missing-in-both':'base-identity-mismatch');
  }
  wordingOwners(requestedUrl){
    // This is only a metadata prefilter. wordingFallback still verifies every
    // selected owner's observations, catalogue bindings and final bytes.
    return [...this.wording].filter(url=>{
      let current=url;const seen=new Set();
      for(let hops=0;hops<=3;hops++){
        if(current===requestedUrl)return true;
        if(seen.has(current))break;seen.add(current);
        const observation=this.b.manifest.get(key(current));
        if(!observation||![301,302,303,307,308].includes(observation.status)||!observation.redirectUrl)break;
        current=observation.redirectUrl;
      }
      return false;
    });
  }
  async wordingFallback(requestedUrl){
    if(!this.runtime.allowedDownload(requestedUrl))return null;
    for(const url of this.wordingOwners(requestedUrl)){
      const proof=await this.wordingProof(url);if(!proof)continue;
      const copy=await this.a.read(url);if(copy&&!copy.acquisitionUnavailable)continue;
      const chain=[];let current=url;
      for(let hops=0;hops<=3;hops++){
        if(!this.runtime.allowedDownload(current))break;
        const input=await this.b.read(current);if(!input)break;
        chain.push(input);
        if([301,302,303,307,308].includes(input.status)){
          if(hops===3||!input.redirectUrl||!Number.isFinite(Date.parse(input.fetchedAt)))break;
          // Older sealed captures retained redirectUrl without response headers.
          // Preserve that observation; a recorded Location must still agree.
          const target=input.headers?.location?new URL(input.headers.location,current).href:input.redirectUrl;
          if(input.redirectUrl!==target||!this.runtime.allowedDownload(target)||chain.some(i=>i.url===target))break;
          current=target;continue;
        }
        const selected=chain.find(i=>i.url===requestedUrl);if(!selected)break;
        const redirects=chain.slice(0,-1).map(({body,...observation})=>observation);
        if(!actual(input)||!proof.sourceHashes.every(hash=>typeof hash==='string'&&hash.toLowerCase()===input.sha256))return {input:null,proof:{...proof,redirects},reason:'wording-source-hash-mismatch'};
        return {input:selected,proof:{...proof,redirects,finalObservation:(( {body,...m})=>m)(input)},reason:'settled-wording-fallback'};
      }
    }
    return null;
  }
  async contextDeclarations(source,documentId,language){
    source.contextFiles??=new Map();const k=documentId+':'+language;
    if(!source.contextFiles.has(k))source.contextFiles.set(k,(async()=>{
      const declarations=[];
      for(const m of source.snapshot.manifest){
        const u=new URL(m.url);
        if(u.origin!==new URL(source.snapshot.apiBase).origin||u.pathname!=='/api/document-context/'+documentId||u.searchParams.get('lang')!==language)continue;
        const input=await source.read(m.url,m.request);if(!actual(input))continue;
        declarations.push(...contextFileDeclarations(documentId,language,JSON.parse(input.body),input,this.runtime));
      }
      return declarations;
    })());
    return source.contextFiles.get(k);
  }
  async epProof(identity,requestedUrl=identity.file.url){
    const url=identity.documentId.includes('-AM-')?'https://data.europarl.europa.eu/api/v2/documents/'+identity.documentId+'?format=application%2Fld%2Bjson':publicDocumentUrl(identity.documentId),request={accept:'application/ld+json'};
    const inputs=await Promise.all([this.a.read(url,request),this.b.read(url,request)]);
    const descriptors=await Promise.all(inputs.map(async(input,index)=>{
      if(!actual(input))return [];
      const work=JSON.parse(input.body).data?.[0];
      const expected='def/ep-document-types/'+(identity.documentId.includes('-AM-')?'AMENDMENT_LIST':identity.documentId.startsWith('A-')?'REPORT_PLENARY':identity.documentId.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION');
      if(String(work?.work_type?.id||work?.work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')!==expected)return [];
      if(!['eli/dl/doc/'+identity.documentId,'https://data.europarl.europa.eu/eli/dl/doc/'+identity.documentId].includes(work?.id))return [];
      const declared=this.runtime.documentFiles(work).filter(f=>f.language===identity.file.language&&f.format==='DOCX');
      const files=declared.filter(f=>f.url===identity.file.url);
      if(!declared.length){
        const contexts=await this.contextDeclarations([this.a,this.b][index],identity.documentId,identity.file.language);
        if(!contexts.length||contexts.some(f=>f.url!==identity.file.url))return [];
        const edition=Object.fromEntries(['epNumberVersion','isVersionOf','is_replaced_by','replaces'].filter(k=>work[k]!==undefined).map(k=>[k,work[k]]));
        const candidates=contexts.map(file=>({file,descriptor:{url:file.url,language:file.language,format:file.format,byteSize:file.byteSize??null,issued:file.issued??null},hash:file.sha256??null,edition}));
        if(candidates.some(a=>candidates.some(b=>!compatible(a.descriptor,b.descriptor)||!compatible(a.hash,b.hash))))return [];
        const descriptor=Object.assign({},...candidates.map(d=>Object.fromEntries(Object.entries(d.descriptor).filter(([,v])=>v!=null))));
        return [{...candidates[0],descriptor,hash:candidates.find(d=>d.hash!=null)?.hash??null,contexts:contexts.map(f=>f.catalogue)}];
      }
      // documentFiles supplies canonical URL/language/format; retain edition
      // fields as well, including publisher size and issue time.
      return files.flatMap(file=>this.runtime.array(work.is_realized_by).flatMap(e=>this.runtime.array(e.is_embodied_by).filter(m=>m.is_exemplified_by===file.url||new URL(m.is_exemplified_by,'https://data.europarl.europa.eu').href===file.url).map(m=>({file,descriptor:{url:file.url,language:file.language,format:file.format,byteSize:m.byteSize==null?null:file.byteSize??null,issued:m.issued??null},hash:m.sha256??null,edition:Object.fromEntries(['epNumberVersion','isVersionOf','is_replaced_by','replaces'].filter(k=>work[k]!==undefined).map(k=>[k,work[k]]))}))));
    }));
    if(!descriptors.every(d=>d.length===1))return null;
    const [copy,base]=descriptors.map(d=>d[0]);
    for(const field of ['url','language','format'])if(!copy.descriptor[field]||copy.descriptor[field]!==base.descriptor[field])return null;
    for(const field of ['byteSize','issued'])if(copy.descriptor[field]!=null&&base.descriptor[field]!=null&&stable(copy.descriptor[field])!==stable(base.descriptor[field]))return null;
    // Compact projections omit raw manifestation IDs and some edition fields.
    // Missing optional fields are unknown; identity still requires both exact
    // document IDs, languages and URLs. Preserve all one-sided evidence.
    for(const field of new Set([...Object.keys(copy.edition),...Object.keys(base.edition)])) {
      if(copy.edition[field]==null||base.edition[field]==null)continue;
      if(stable(copy.edition[field])!==stable(base.edition[field]))return null;
    }
    const sourceHashes=[copy.hash,base.hash].filter(hash=>hash!==null);
    if(sourceHashes.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/i.test(hash))||new Set(sourceHashes.map(hash=>hash.toLowerCase())).size>1)return null;
    const declaration={file:copy.file,descriptor:{copy:copy.descriptor,base:base.descriptor},edition:{copy:copy.edition,base:base.edition},...(copy.contexts||base.contexts?{contexts:{copy:copy.contexts??[],base:base.contexts??[]}}:{})};
    const redirects=[];let current=identity.file.url;
    for(let hops=0;hops<=3;hops++) {
      if(current===requestedUrl)return {declaration,sourceHashes,redirects,observations:inputs.map((input,i)=>({snapshotId:[this.a,this.b][i].snapshot.snapshotId,url:input.url,request:input.request,sha256:input.sha256,fetchedAt:input.fetchedAt}))};
      const response=await this.b.read(current);
      if(!response||![301,302,303,307,308].includes(response.status)||!Number.isFinite(Date.parse(response.fetchedAt))||!this.runtime.allowedDownload(response.redirectUrl||''))return null;
      redirects.push({snapshotId:this.b.snapshot.snapshotId,url:current,redirectUrl:response.redirectUrl,status:response.status,sha256:response.sha256,fetchedAt:response.fetchedAt});
      current=response.redirectUrl;
    }
    return null;
  }
  wrap(input,url,request,source,identity,reason){
    const gap={url,status:null,ok:false,fetchedAt:null,bytes:0,sha256:digest(Buffer.alloc(0)),error:'acquisition-unavailable',headers:{},acquisitionUnavailable:true,acquisitionUnavailableReason:reason,body:Buffer.alloc(0),...(request?{request}:{})};
    return {...(input||gap),hybridSource:{snapshotId:input&&source?source.snapshot.snapshotId:null,role:this.wording.has(url)?'wording':identity?'base':'copy',identity:identity||null,...(identity?{attemptedSnapshotIds:[this.a.snapshot.snapshotId,this.b.snapshot.snapshotId]}:{}),reason}};
  }
}

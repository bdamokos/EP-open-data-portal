import {readFile,readdir,realpath,stat,lstat} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {allowedDownload} from '../server/document-text.mjs';
import {docxRetrievedAfterIssue} from '../server/amendments.mjs';
import {digest} from './amendment-benchmark-cache.mjs';
import {cellarTransportUrl,CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME,CELLAR_LIMITS} from '../server/cellar-documents.mjs';

const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
// Mirror CellarDocuments' representation checks without normalizing the saved
// header itself. Parameters on ordinary media types do not change the format.
function matchesRepresentation(value,accept) {
  const [type,...parameters]=String(value||'').toLowerCase().split(';').map(part=>part.trim()).filter(Boolean);
  if(accept===CELLAR_DECLARED_DOCX_MIME)return type==='application/zip'&&parameters.filter(part=>part.startsWith('type=')).length===1&&parameters.includes('type=akn4eu');
  return type===accept.split(';')[0];
}
export class RetainedInputs {
  static async open(directory) {
    const reader=new RetainedInputs();reader.root=await realpath(directory);
    for(const name of ['index','corpus','cache']) {
      if(name==='cache')try{await stat(path.join(reader.root,name));}catch(error){if(error.code==='ENOENT'){reader.cacheMissing=true;continue;}throw error;}
      const folder=await realpath(path.join(reader.root,name));
      if(!inside(reader.root,folder)||!(await stat(folder)).isDirectory())throw new Error('Invalid retained data layout: '+name);
    }
    // immutable=1 prevents SQLite from creating journals, WAL or shared-memory
    // sidecars even when a backup retains the WAL journal-mode header.
    for(const file of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite']) {
      const filename=await reader.file(file);
      for(const suffix of ['-wal','-shm','-journal'])try {await lstat(filename+suffix);throw new Error('Retained copy has SQLite sidecars: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}
      execFileSync('python3',['-c',`import sqlite3,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro&immutable=1',uri=True)
try:
 if c.execute('PRAGMA quick_check').fetchall()!=[('ok',)]: raise ValueError('Invalid SQLite backup')
 c.execute('SELECT name FROM sqlite_master LIMIT 1').fetchall()
finally: c.close()
`,filename],{stdio:['ignore','pipe','pipe']});
    }
    // Query the existing backup directly: the runtime source store initializes
    // schemas and repairs missing blobs, so it must never be used here.
    reader.amendmentRows=JSON.parse(execFileSync('python3',['-c',`import sqlite3,sys,pathlib,json
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro&immutable=1',uri=True)
c.row_factory=sqlite3.Row
try:
 exists=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='amendment_sources'").fetchone()
 print(json.dumps([dict(r) for r in c.execute('SELECT url,language,byte_size,issued,sha256,size,retrieved_at,list_id FROM amendment_sources')] if exists else None))
finally: c.close()
`,await reader.file('index/activities-v1.sqlite')],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));
    reader.baseRecords=[];
    let baseNames=[];try{baseNames=await readdir(await reader.file('cache/base-sources-v1'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const name of baseNames.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort()) {
      const file=await reader.file('cache/base-sources-v1/'+name);
      if((await stat(file)).size>256*1024)throw new Error('Oversized retained base descriptor');
      const source=JSON.parse(await readFile(file,'utf8'));
      const key=digest(JSON.stringify([source.url,source.request?.accept??null,source.request?.language??null]));
      if(source.schemaVersion!==1||source.key!==key||name!==key+'.json'||!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<0||source.bytes>12*1024*1024||![200,406].includes(source.status)||!Number.isFinite(Date.parse(source.fetchedAt)))throw new Error('Retained base attestation mismatch');
      reader.baseRecords.push(source);
    }
    reader.records=[];
    let names=[];try{names=await readdir(await reader.file('cache/commission-proposals-v1'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const file=await reader.file('cache/commission-proposals-v1/'+name);
      if((await stat(file)).size>64*1024)throw new Error('Oversized retained source attestation');
      const source=JSON.parse(await readFile(file,'utf8'));
      reader.records.push({name,source});
    }
    return reader;
  }
  async file(relative) {
    const file=await realpath(path.join(this.root,relative));
    if(!inside(this.root,file))throw new Error('Retained source escapes supplied directory');
    return file;
  }
  async assertSeparate(directory) {
    // Resolve the nearest existing ancestor before any output directory is made.
    let cursor=path.resolve(directory),tail=[];
    for(;;)try{cursor=path.join(await realpath(cursor),...tail.reverse());break;}catch(error){if(error.code!=='ENOENT')throw error;tail.push(path.basename(cursor));cursor=path.dirname(cursor);}
    if(inside(this.root,cursor)||inside(cursor,this.root))throw new Error('Benchmark cache/output must be separate from retained data');
  }
  async amendment(url,request,unavailable) {
    if(this.amendmentRows===null)return unavailable('amendment-sources-table-missing');
    const rows=this.amendmentRows.filter(row=>row.url===url);
    if(!rows.length)return unavailable('amendment-source-attestation-missing');
    // URL-only benchmark requests cannot disambiguate editions or languages.
    // Never use retrieval recency or a filename to choose between descriptors.
    if(rows.length!==1)throw new Error('Ambiguous retained amendment descriptors: '+url);
    const row=rows[0],mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if(typeof row.language!=='string'||!/^[a-z]{2}$/.test(row.language)||!Number.isSafeInteger(row.byte_size)||row.byte_size < -1||typeof row.issued!=='string'||row.issued&&!Number.isFinite(Date.parse(row.issued))||typeof row.retrieved_at!=='string'||!docxRetrievedAfterIssue(row.retrieved_at,row.issued)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0||row.size>8*1024*1024||row.list_id!==null&&!/^(?:A|B|RC)-10-\d{4}-\d{4,6}(?:-AM-\d+-\d+)?$/.test(row.list_id))throw new Error('Retained amendment attestation mismatch: '+url);
    if(request&&(request.accept!==mime||request.language&&request.language!==row.language))return unavailable('amendment-source-request-mismatch');
    let file;
    try{file=await this.file('index/amendment-docx-v2/'+row.sha256+'.docx');}catch(error){if(error.code==='ENOENT')return unavailable('amendment-source-blob-missing');throw error;}
    const info=await stat(file);
    if(!info.isFile()||info.size!==row.size||row.byte_size>=0&&row.byte_size!==row.size)throw new Error('Retained amendment size mismatch: '+url);
    const body=await readFile(file);
    if(body.length!==row.size||digest(body)!==row.sha256)throw new Error('Retained amendment hash mismatch: '+url);
    return {url,status:200,ok:true,fetchedAt:row.retrieved_at,bytes:body.length,sha256:row.sha256,error:null,...(request?{request}:{}),headers:{'content-type':mime},retainedSource:{store:'amendment-docx-v2',descriptor:{url:row.url,language:row.language,byteSize:row.byte_size<0?null:row.byte_size,issued:row.issued||null},listId:row.list_id},body};
  }
  async baseObservation(source,request) {
    let file;try{file=await this.file('cache/base-sources-v1/'+source.sha256+'.blob');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if((await stat(file)).size!==source.bytes)throw new Error('Retained base size mismatch');
    const body=await readFile(file);
    if(body.length!==source.bytes||digest(body)!==source.sha256)throw new Error('Retained base hash mismatch');
    const d=source.descriptor;
    if(d&&(d.url!==source.url||d.byteSize!=null&&d.byteSize!==body.length||d.issued!=null&&(!Number.isFinite(Date.parse(d.issued))||Date.parse(d.issued)>Date.parse(source.fetchedAt))))throw new Error('Retained base descriptor mismatch');
    return {url:source.url,status:source.status,ok:source.status===200,fetchedAt:source.fetchedAt,bytes:body.length,sha256:source.sha256,error:source.status===200?null:'HTTP '+source.status,...(request?{request}:{}),headers:source.headers,retainedSource:{store:'base-sources-v1',observedRequest:source.request,descriptor:d??null,selection:source.selection??null},body};
  }
  async selections(type) {
    const records=[];
    for(const source of this.baseRecords.filter(s=>s.selection&&(!type||s.selection.type===type))) {
      const observation=await this.baseObservation(source);
      if(observation)records.push({input:source.selection.input,type:source.selection.type,fetchedAt:source.fetchedAt,decision:JSON.parse(observation.body.toString('utf8'))});
    }
    return records;
  }
  async get(url,request) {
    const unavailable=(reason='retained-attestation-missing')=>({url,status:null,ok:false,fetchedAt:null,bytes:0,sha256:digest(''),error:'acquisition-unavailable',acquisitionUnavailable:true,acquisitionUnavailableReason:reason,...(request?{request}:{}),headers:{},body:Buffer.alloc(0)});
    const bases=this.baseRecords.filter(s=>s.url===url&&(!request||(s.request?.accept===request.accept||s.request?.accept==='*/*'&&s.descriptor?.format==='DOCX'&&request.accept==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')&&(!request.language||s.request?.language===request.language)));
    if(bases.length>1)throw new Error('Ambiguous retained base observations: '+url);
    if(bases.length) {
      const source=bases[0];
      if(request?.language&&source.descriptor?.language&&source.descriptor.language.split('/').at(-1).toLowerCase()!==request.language)return unavailable('base-source-request-mismatch');
      return await this.baseObservation(source,request)||unavailable('base-source-blob-missing');
    }
    if(allowedDownload(url))return this.amendment(url,request,unavailable);
    if(this.cacheMissing)return unavailable('retained-cache-missing');
    const matches=this.records.filter(({source})=>source.url===url&&source.accept===request?.accept&&source.language?.split('/').at(-1).toLowerCase()===request?.language);
    if(!matches.length)return unavailable();
    const observations=[];
    for(const {source:s,name} of matches) {
      const identity=JSON.stringify([s.celex,s.language,s.itemId,String(s.format).toLowerCase()]);
      const expected=s.format==='DOCX'?[CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME]:s.format==='XHTML'?['application/xhtml+xml']:[];
      if(s.schemaVersion!==1||s.identity!==identity||s.key!==digest(identity)||name!==s.key+'.json'||!/^5(?:19|20)\d{2}(?:PC\d{4}|AG\d{4}\(01\))$|^[03](?:19|20)\d{2}[RLD]\d{4}(?:-\d{8})?$/.test(s.celex)||!/^http:\/\/publications\.europa\.eu\/resource\/authority\/language\/[A-Z]{3}$/.test(s.language)||s.url!==cellarTransportUrl(s.itemId,{redirect:true})||s.resolvedSourceUrl!==s.url||!expected.includes(s.accept)||!s.contentType||!matchesRepresentation(s.contentType,s.accept)||!Number.isFinite(Date.parse(s.fetchedAt))||!Number.isFinite(Date.parse(s.checkedAt))||!/^[a-f0-9]{64}$/.test(s.sha256))throw new Error('Retained source attestation mismatch: '+url);
      // The negotiation advertisement body is not retained by the application.
      // Never synthesize its406 or silently substitute the negotiated bytes.
      if(s.accept===CELLAR_DECLARED_DOCX_MIME)return unavailable();
      let file;try{file=await this.file('cache/commission-proposals-v1/'+s.sha256+'.blob');}catch(error){if(error.code==='ENOENT')return unavailable();throw error;}
      if((await stat(file)).size>CELLAR_LIMITS.itemBytes)throw new Error('Retained source size limit');
      const body=await readFile(file);
      if(digest(body)!==s.sha256)throw new Error('Retained source hash mismatch: '+url);
      observations.push({url,status:200,ok:true,fetchedAt:s.fetchedAt,bytes:body.length,sha256:s.sha256,error:null,request,headers:{'content-type':s.contentType},retainedSource:{identity:s.identity,language:s.language,format:s.format},body});
    }
    if(observations.some(value=>value.sha256!==observations[0].sha256||value.fetchedAt!==observations[0].fetchedAt))throw new Error('Ambiguous retained source observations: '+url);
    return observations[0];
  }
}

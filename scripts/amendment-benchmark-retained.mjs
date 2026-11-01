import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './amendment-benchmark-cache.mjs';
import {cellarTransportUrl,CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME,CELLAR_LIMITS} from '../server/cellar-documents.mjs';

const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
export class RetainedInputs {
  static async open(directory) {
    const reader=new RetainedInputs();reader.root=await realpath(directory);
    for(const name of ['index','corpus','cache']) {
      const folder=await realpath(path.join(reader.root,name));
      if(!inside(reader.root,folder)||!(await stat(folder)).isDirectory())throw new Error('Invalid retained data layout: '+name);
    }
    // immutable=1 prevents SQLite from creating journals, WAL or shared-memory
    // sidecars even when a backup retains the WAL journal-mode header.
    for(const file of ['index/activities-v1.sqlite','corpus/corpus-v1.sqlite']) {
      const filename=await reader.file(file);
      for(const suffix of ['-wal','-shm','-journal'])try {await stat(filename+suffix);throw new Error('Retained copy has SQLite sidecars: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}
      execFileSync('python3',['-c',`import sqlite3,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro&immutable=1',uri=True)
try:
 if c.execute('PRAGMA quick_check').fetchall()!=[('ok',)]: raise ValueError('Invalid SQLite backup')
 c.execute('SELECT name FROM sqlite_master LIMIT 1').fetchall()
finally: c.close()
`,filename],{stdio:['ignore','pipe','pipe']});
    }
    reader.records=[];
    const folder=path.join(reader.root,'cache/commission-proposals-v1');
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
  async get(url,request) {
    const unavailable=()=>({url,status:null,ok:false,fetchedAt:null,bytes:0,sha256:digest(''),error:'acquisition-unavailable',acquisitionUnavailable:true,...(request?{request}:{}),headers:{},body:Buffer.alloc(0)});
    const matches=this.records.filter(({source})=>source.url===url&&source.accept===request?.accept&&source.language?.split('/').at(-1).toLowerCase()===request?.language);
    if(!matches.length)return unavailable();
    const observations=[];
    for(const {source:s,name} of matches) {
      const identity=JSON.stringify([s.celex,s.language,s.itemId,String(s.format).toLowerCase()]);
      const expected=s.format==='DOCX'?[CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME]:s.format==='XHTML'?['application/xhtml+xml']:[];
      if(s.schemaVersion!==1||s.identity!==identity||s.key!==digest(identity)||name!==s.key+'.json'||!/^5(?:19|20)\d{2}(?:PC\d{4}|AG\d{4}\(01\))$|^[03](?:19|20)\d{2}[RLD]\d{4}(?:-\d{8})?$/.test(s.celex)||!/^http:\/\/publications\.europa\.eu\/resource\/authority\/language\/[A-Z]{3}$/.test(s.language)||s.url!==cellarTransportUrl(s.itemId,{redirect:true})||s.resolvedSourceUrl!==s.url||!expected.includes(s.accept)||!s.contentType||s.contentType!==s.accept||!Number.isFinite(Date.parse(s.fetchedAt))||!Number.isFinite(Date.parse(s.checkedAt))||!/^[a-f0-9]{64}$/.test(s.sha256))throw new Error('Retained source attestation mismatch: '+url);
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

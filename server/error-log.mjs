import {mkdir,stat,rename,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {config,projectRoot} from './config.mjs';
export const ERROR_DIAGNOSTICS_VERSION=1;
import {diagnosticRequest} from '../src/errorDiagnostics.mjs';

// Serialized rotation bounds both disk use and the queue during a failure burst.
export function createErrorLog({directory=process.env.ERROR_LOG_DIR||path.join(projectRoot,'var','diagnostics'),maxBytes=5*1024*1024,files=4}={}) {
  let queue=Promise.resolve(),pending=0,warned=false;
  const file=path.join(directory,'errors.jsonl');
  return {
    write(event) {
      if(pending>=256)return false;
      pending++;
      const line=JSON.stringify({time:new Date().toISOString(),revision:config.appRevision||null,...event})+'\n';
      queue=queue.then(async()=>{
        await mkdir(directory,{recursive:true,mode:0o700});
        const bytes=await stat(file).then(value=>value.size,error=>{if(error.code==='ENOENT')return 0;throw error;});
        if(bytes+Buffer.byteLength(line)>maxBytes) {
          for(let i=files-1;i>=1;i--)await rename(i===1?file:file+'.'+(i-1),file+'.'+i).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
        await appendFile(file,line,{mode:0o600});
        warned=false;
      }).catch(()=>{if(!warned){console.error('[error-log] unable to write diagnostic log');warned=true;}}).finally(()=>{pending--;});
      return true;
    },
    flush:()=>queue,
  };
}
export const errorLog=createErrorLog();
const label=(value,max=120)=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]+$/.test(value)?value.slice(0,max):undefined;
export function clientErrorEvent(body) {
  if(!body||!['http','network','ui'].includes(body.kind))return null;
  const request=diagnosticRequest(body.request);
  if(body.kind!=='ui'&&!request)return null;
  const status=Number(body.status);
  return {source:'browser',kind:body.kind,...(request?{request}:{}),method:['GET','HEAD','POST'].includes(body.method)?body.method:undefined,
    status:body.kind==='http'&&Number.isInteger(status)&&status>=400&&status<=599?status:undefined,
    code:label(body.code),name:label(body.name),requestId:/^[a-f0-9-]{36}$/.test(body.requestId)?body.requestId:undefined,
    elapsedMs:Number.isFinite(body.elapsedMs)?Math.max(0,Math.min(3600000,Math.round(body.elapsedMs))):undefined,
    apiVersion:Number.isInteger(body.apiVersion)?body.apiVersion:undefined};
}
export function serverErrorEvent(request,error,{requestId,elapsedMs}) {
  return {source:'server',kind:'http',request:diagnosticRequest(request.url),method:label(request.method,10),requestId,elapsedMs,
    message:error.name==='HttpError'?String(error.message).replace(/https?:\/\/\S+/g,'[source URL]').slice(0,300):undefined,
    frames:typeof error.stack==='string'?error.stack.split('\n').slice(1,6).map(line=>line.match(/(?:server|src)\/[a-zA-Z0-9_./-]+:\d+:\d+/)?.[0]).filter(Boolean):undefined,
    status:Number.isInteger(error.status)?error.status:500,code:label(error.code)||'internal_error',name:label(error.name)||'Error'};
}

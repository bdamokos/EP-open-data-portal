// Diagnostic request metadata deliberately excludes query text and POST bodies.
import {diagnosticRequest,diagnosticFrames} from '../server/error-diagnostics.mjs';
export {diagnosticRequest} from '../server/error-diagnostics.mjs';
let send=()=>{};
const seen=new WeakSet();
export function reportUiError(error,context={}) {
  if(error && typeof error==='object') {
    if(seen.has(error)||error.name==='AbortError')return;
    seen.add(error);
  }
  // Free text can include search terms or local storage contents. Retain stable IDs.
  send({kind:'ui',code:context.code||(typeof error?.uiMessageId==='string'?error.uiMessageId:'ui_error'),request:diagnosticRequest(context.request),name:error?.name,frames:diagnosticFrames(error?.stack)});
}
export function installErrorDiagnostics(target,endpoint) {
  const original=target.fetch.bind(target);
  let count=0,windowStart=Date.now();
  send=event=>{
    if(Date.now()-windowStart>60_000){count=0;windowStart=Date.now();}
    if(count++>=30)return;
    // Failure reporting never retries and never passes through its own interceptor.
    try {void original(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({...event,apiVersion:API_VERSION}),keepalive:true}).catch(()=>{});}catch{}
  };
  target.fetch=async(input,options)=>{
    const raw=typeof input==='object'&&input!==null&&'url' in input?input.url:input;
    let request;
    try {const url=new URL(String(raw),target.location.href);request=url.origin===target.location.origin?diagnosticRequest(url.href):null;}catch{}
    if(String(raw)===endpoint)return original(input,options);
    const started=Date.now();
    try {
      const response=await original(input,options);
      if(request&&!response.ok)send({kind:'http',request,method:options?.method||input?.method||'GET',status:response.status,requestId:response.headers.get('X-Request-Id'),elapsedMs:Date.now()-started});
      return response;
    }catch(error){
      if(request&&error?.name!=='AbortError')send({kind:'network',request,method:options?.method||input?.method||'GET',name:error?.name,elapsedMs:Date.now()-started});
      throw error;
    }
  };
  target.addEventListener('error',event=>reportUiError(event.error));
  target.addEventListener('unhandledrejection',event=>reportUiError(event.reason));
}
import {API_VERSION} from '../server/api-version.mjs';

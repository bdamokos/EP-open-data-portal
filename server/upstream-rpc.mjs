import {AsyncLocalStorage} from 'node:async_hooks';
import {odpRouteFamily,retryAfterHint,fetchFailure} from './odp-observability.mjs';

const aborted=()=>new DOMException('Source worker stopped.','AbortError');

// The HTTP isolate owns every admission and observation. Bodies stay with the
// worker, and its grant stays held through body consumption, just like run().
export function serveUpstreamPort(port,{queueFor,observations}) {
  const requests=new Map(),headers=new Map();let closed=false;
  const send=message=>{if(!closed)port.postMessage(message);};
  const cancel=id=>{const request=requests.get(id);if(!request)return;requests.delete(id);request.controller.abort(aborted());request.release?.();};
  const finishHeader=(id,result)=>{const pending=headers.get(id);if(!pending)return;headers.delete(id);observations.finish(pending,result);};
  const receive=async message=>{
    const {type,id}=message||{};
    if(type==='acquire') {
      const controller=new AbortController(),request={controller};requests.set(id,request);
      try {
        // A source-writer dependency's default priority cannot borrow readers'
        // foreground reserve. All traffic on this port has a background owner.
        const release=await queueFor(message.source,{backgroundRank:message.backgroundRank||0}).acquire('background',{signal:controller.signal,backgroundRank:message.backgroundRank||0});
        if(closed||controller.signal.aborted){release();return;}
        request.release=release;send({type:'grant',id});
      }catch(error){requests.delete(id);send({type:'rejected',id,error:{message:error.message,code:error.code,retryAfter:error.retryAfter}});}
    } else if(type==='release'||type==='cancel'){
      const request=requests.get(id),result=message.result;
      if(result&&!request?.accounted){
        if(result.status)queueFor(message.source||'odp').recordResponse(result.status);
        if([429,503].includes(result.status))queueFor(message.source||'odp').backoff(result.retryAfter);
      }
      cancel(id);
    }
    else if(type==='response-status')queueFor(message.source).recordResponse(message.status);
    else if(type==='backoff')queueFor(message.source).backoff(message.seconds);
    else if(type==='headers-start')headers.set(id,observations.start(message.route));
    else if(type==='headers-end') {
      const request=requests.get(message.grant);if(request)request.accounted=true;
      // Apply the pause before any release can admit another background job.
      if([429,503].includes(message.result.status))queueFor('odp').backoff(message.result.retryAfter);
      finishHeader(id,message.result);
    }
  };
  port.on('message',receive);
  const close=()=>{
    if(closed)return;closed=true;
    for(const id of requests.keys())cancel(id);
    for(const id of headers.keys())finishHeader(id,{networkError:{kind:'aborted',code:null},signalAborted:true});
    port.off('message',receive);port.close();
  };
  port.once('close',close);return close;
}

export class UpstreamRpcClient {
  constructor(port) {
    this.port=port;this.sequence=0;this.pending=new Map();this.grants=new Map();this.context=new AsyncLocalStorage();this.closed=false;
    port.on('message',message=>{
      const request=this.pending.get(message.id);
      if(!request){if(message.type==='grant')this.send({type:'release',id:message.id});return;}
      this.pending.delete(message.id);request.cleanup();
      if(message.type==='grant'){this.grants.set(message.id,{});request.resolve(message.id);}
      else request.reject(Object.assign(new Error(message.error.message),message.error));
    });
    port.once('close',()=>this.close());
  }
  send(message){if(!this.closed)this.port.postMessage(message);}
  acquire(priority='background',route='/other',{source='odp',signal,backgroundRank=0}={}) {
    if(this.closed||signal?.aborted)return Promise.reject(signal?.reason||aborted());
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.pending.delete(id);signal.removeEventListener('abort',abort);this.send({type:'cancel',id});reject(signal.reason);};
      this.pending.set(id,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});
      signal?.addEventListener('abort',abort,{once:true});this.send({type:'acquire',id,priority,route,source,backgroundRank});
    });
  }
  release(id,result=this.grants.get(id)){if(this.grants.delete(id))this.send({type:'release',id,result});}
  queue(source) {
    const client=this;
    return {
      async run(operation,{priority,signal,backgroundRank=0}={}) {
        const id=await client.acquire(priority,'/other',{source,signal,backgroundRank});
        try {signal?.throwIfAborted();return await client.context.run(id,()=>operation(signal));}
        finally {client.release(id);}
      },
      async runHeld(operation,{priority,signal}={}) {
        const id=await client.acquire(priority,'/other',{source,signal});
        const release=()=>client.release(id);
        try {signal?.throwIfAborted();return await client.context.run(id,()=>operation(release,signal));}
        catch(error){release();throw error;}
      },
      recordResponse:status=>client.send({type:'response-status',source,status}),
      backoff:seconds=>client.send({type:'backoff',source,seconds}),
      // The writer isolate has no foreground subscribers to promote.
      reprioritize:()=>{},joinBackground:promise=>promise,
    };
  }
  async fetch(url,options) {
    const id=++this.sequence,started=performance.now();
    this.send({type:'headers-start',id,route:odpRouteFamily(url)});
    try {
      const response=await globalThis.fetch(url,options);
      const result={status:response.status,latencyMs:performance.now()-started,...retryAfterHint(response)},grant=this.context.getStore();
      if(this.grants.has(grant))this.grants.set(grant,result);
      this.send({type:'headers-end',id,grant,result});
      return response;
    }catch(error){
      const result={latencyMs:performance.now()-started,networkError:fetchFailure(error,options?.signal),signalAborted:Boolean(options?.signal?.aborted)},grant=this.context.getStore();
      if(this.grants.has(grant))this.grants.set(grant,result);
      this.send({type:'headers-end',id,grant,result});throw error;
    }
  }
  close() {
    if(this.closed)return;
    for(const [id,request] of this.pending){request.cleanup();request.reject(aborted());this.send({type:'cancel',id});}
    this.pending.clear();for(const id of this.grants.keys())this.release(id);
    this.closed=true;this.port.close();
  }
}

import {AsyncLocalStorage} from 'node:async_hooks';
import {odpRouteFamily,retryAfterHint,fetchFailure} from './odp-observability.mjs';
import {HttpError} from './http-utils.mjs';

const aborted=()=>new DOMException('Source worker stopped.','AbortError');
// Rejections cross the link as plain data; rebuild an HTTP error so a busy queue still answers 503 with its retry hint.
const wireError=error=>({message:error.message,code:error.code,retryAfter:error.retryAfter,status:error instanceof HttpError?error.status:undefined});
const fromWire=error=>Object.assign(Number.isInteger(error.status)?new HttpError(error.status,error.code,error.message):new Error(error.message),
  {code:error.code,...(error.retryAfter!==undefined?{retryAfter:error.retryAfter}:{})});

// The HTTP isolate owns every admission and observation. Bodies stay with the
// worker, and its grant stays held through body consumption, just like run().
// A writer thread's traffic is all background. A port with `foreground` serves a
// visitor-facing process: requests keep their priority, owner and yield hook.
export function serveUpstreamPort(port,{queueFor,observations},{foreground=false}={}) {
  const requests=new Map(),headers=new Map(),joins=new Map();let closed=false;
  const send=message=>{if(!closed)port.postMessage(message);};
  const cancel=id=>{const request=requests.get(id);if(!request)return;requests.delete(id);request.controller.abort(aborted());request.release?.();};
  const finishHeader=(id,result)=>{const pending=headers.get(id);if(!pending)return;headers.delete(id);observations.finish(pending,result);};
  const receive=async message=>{
    const {type,id}=message||{};
    if(type==='acquire') {
      const controller=new AbortController(),request={controller,source:message.source};requests.set(id,request);
      if(foreground&&message.owner)request.owner={backgroundOwner:Boolean(message.backgroundOwner)};
      try {
        // A source-writer dependency's default priority cannot borrow readers'
        // foreground reserve, so its port treats all traffic as background.
        const priority=foreground&&message.priority!=='background'?'interactive':'background';
        const owned=request.owner?{owner:request.owner,backgroundOwner:request.owner.backgroundOwner,yieldBackground:()=>send({type:'yield',id})}:{};
        const release=await queueFor(message.source,{backgroundRank:message.backgroundRank||0}).acquire(priority,{signal:controller.signal,backgroundRank:message.backgroundRank||0,...owned});
        if(closed||controller.signal.aborted){release();return;}
        request.release=release;send({type:'grant',id});
      }catch(error){requests.delete(id);send({type:'rejected',id,error:wireError(error)});}
    } else if(type==='release'||type==='cancel'){
      const request=requests.get(id),result=message.result;
      if(result&&!request?.accounted){
        if(result.status)queueFor(message.source||'odp').recordResponse(result.status);
        if([429,503].includes(result.status))queueFor(message.source||'odp').backoff(result.retryAfter);
      }
      cancel(id);
    }
    else if(type==='reprioritize'){
      const request=requests.get(id);
      if(request?.owner){request.owner.backgroundOwner=Boolean(message.backgroundOwner);queueFor(request.source).reprioritize(request.owner,message.priority==='background'?'background':'interactive');}
    }
    else if(type==='join'&&foreground){
      // A reader joining a background fetch waits as it would in-process: it stops
      // at an upstream pause or after the queue's interactive wait.
      const controller=new AbortController();joins.set(id,controller);
      queueFor(message.source).joinBackground(new Promise(()=>{}),{signal:controller.signal})
        .catch(error=>{if(joins.delete(id)&&!controller.signal.aborted)send({type:'join-failed',id,error:wireError(error)});});
    }
    else if(type==='join-end'){joins.get(id)?.abort();joins.delete(id);}
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
    for(const controller of joins.values())controller.abort();joins.clear();
    for(const id of headers.keys())finishHeader(id,{networkError:{kind:'aborted',code:null},signalAborted:true});
    port.off('message',receive);port.close();
  };
  port.once('close',close);return close;
}

export class UpstreamRpcClient {
  // `defaultPriority` applies when a caller names none: a writer thread is all background, a visitor-facing process is interactive.
  constructor(port,{defaultPriority='background'}={}) {
    this.port=port;this.defaultPriority=defaultPriority;this.sequence=0;this.pending=new Map();this.grants=new Map();this.context=new AsyncLocalStorage();this.closed=false;
    this.owners=new Map();this.yields=new Map();this.joins=new Map();
    // A visitor-facing process bounds a reader's wait on a background fetch; a writer thread has no such readers.
    this.foreground=defaultPriority==='interactive';
    port.on('message',message=>{
      if(message.type==='yield'){this.yields.get(message.id)?.();return;}
      if(message.type==='join-failed'){this.joins.get(message.id)?.(fromWire(message.error));return;}
      const request=this.pending.get(message.id);
      if(!request){if(message.type==='grant')this.send({type:'release',id:message.id});return;}
      this.pending.delete(message.id);request.cleanup();
      if(message.type==='grant'){this.grants.set(message.id,{});request.resolve(message.id);}
      else request.reject(fromWire(message.error));
    });
    port.once('close',()=>this.close());
  }
  send(message){if(!this.closed)this.port.postMessage(message);}
  // The returned promise carries the request `id` so an owner can be reprioritized while it still waits.
  acquire(priority=this.defaultPriority,route='/other',{source='odp',signal,backgroundRank=0,owner,backgroundOwner=false,yieldBackground}={}) {
    if(this.closed||signal?.aborted)return Promise.reject(signal?.reason||aborted());
    const id=++this.sequence;
    if(owner){let ids=this.owners.get(owner);if(!ids)this.owners.set(owner,ids=new Set());ids.add(id);}
    if(yieldBackground)this.yields.set(id,yieldBackground);
    const forget=()=>{
      this.yields.delete(id);
      if(owner){const ids=this.owners.get(owner);ids?.delete(id);if(!ids?.size)this.owners.delete(owner);}
    };
    const promise=new Promise((resolve,reject)=>{
      const abort=()=>{this.pending.delete(id);signal.removeEventListener('abort',abort);this.send({type:'cancel',id});forget();reject(signal.reason);};
      this.pending.set(id,{resolve,reject:error=>{forget();reject(error);},cleanup:()=>signal?.removeEventListener('abort',abort)});
      signal?.addEventListener('abort',abort,{once:true});this.send({type:'acquire',id,priority,route,source,backgroundRank,owner:Boolean(owner),backgroundOwner});
    });
    promise.id=id;promise.forget=forget;return promise;
  }
  release(id,result=this.grants.get(id)){if(this.grants.delete(id))this.send({type:'release',id,result});}
  reprioritize(owner,priority) {
    for(const id of this.owners.get(owner)||[])this.send({type:'reprioritize',id,priority,backgroundOwner:Boolean(owner.backgroundOwner)});
  }
  queue(source) {
    const client=this;
    return {
      async run(operation,{priority,signal,backgroundRank=0}={}) {
        const id=await client.acquire(priority,'/other',{source,signal,backgroundRank});
        try {signal?.throwIfAborted();return await client.context.run(id,()=>operation(signal));}
        finally {client.release(id);}
      },
      async runHeld(operation,{priority,signal,backgroundRank=0,owner,backgroundOwner,yieldBackground}={}) {
        const acquisition=client.acquire(priority,'/other',{source,signal,backgroundRank,owner,backgroundOwner,yieldBackground}),id=await acquisition;
        const release=()=>{client.release(id);acquisition.forget();};
        try {signal?.throwIfAborted();return await client.context.run(id,()=>operation(release,signal));}
        catch(error){release();throw error;}
      },
      recordResponse:status=>client.send({type:'response-status',source,status}),
      backoff:seconds=>client.send({type:'backoff',source,seconds}),
      // The writer isolate has no foreground subscribers to promote; a visitor-facing process does.
      reprioritize:(owner,priority)=>client.reprioritize(owner,priority),
      joinBackground:(promise,{signal}={})=>client.foreground?client.joinBackground(source,promise,{signal}):promise,
    };
  }
  joinBackground(source,promise,{signal}={}) {
    if(this.closed||signal?.aborted)return Promise.reject(signal?.reason||aborted());
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const finish=(settle,value)=>{
        if(!this.joins.delete(id))return;
        signal?.removeEventListener('abort',abort);this.send({type:'join-end',id});settle(value);
      };
      const abort=()=>finish(reject,signal.reason);
      this.joins.set(id,error=>finish(reject,error));
      signal?.addEventListener('abort',abort,{once:true});
      this.send({type:'join',id,source});
      // Only this reader stops waiting; the background fetch keeps its owner.
      promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
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
    this.pending.clear();for(const id of this.grants.keys())this.release(id);this.owners.clear();this.yields.clear();
    for(const fail of [...this.joins.values()])fail(aborted());
    this.closed=true;this.port.close();
  }
}

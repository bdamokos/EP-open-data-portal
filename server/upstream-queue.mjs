import {HttpError} from './http-utils.mjs';

export function retryAfterSeconds(value, now=Date.now()) {
  const text=String(value??'').trim();
  // The obsolete asctime form has no zone, but HTTP dates are always UTC.
  const date=/^[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(text)?text+' GMT':text;
  const seconds=/^\d+(?:\.\d+)?$/.test(text)?Number(text):/^[A-Za-z]{3,9},? /.test(text)?(Date.parse(date)-now)/1000:NaN;
  // A valid server pause is never shortened to a local retry cap.
  return Number.isFinite(seconds)&&Math.abs(seconds)<=Number.MAX_SAFE_INTEGER/1000?Math.max(0,Math.ceil(seconds)):60;
}
// Concurrency is a resource bound. Only sources with published quotas set rateLimit.
export class UpstreamQueue {
  constructor({ interval=0, maximum=2, backgroundMaximum=1, interactiveWaitMs=10_000, rateLimit=null }={}) {
    this.interval=interval;this.maximum=maximum;this.backgroundMaximum=backgroundMaximum;
    this.interactiveWaitMs=interactiveWaitMs;this.rateLimit=rateLimit;this.starts=[];
    this.active=0;this.background=0;this.nextStart=0;this.cooldownUntil=0;this.waiters=[];this.joiners=new Set();this.timer=null;
  }
  joinBackground(promise,{signal}={}) {
    if(signal?.aborted)return Promise.reject(signal.reason);
    if(this.cooldownUntil>Date.now())return Promise.reject(this.unavailable());
    return new Promise((resolve,reject)=>{
      let timer;
      const finish=(settle,value)=>{clearTimeout(timer);this.joiners.delete(fail);signal?.removeEventListener('abort',abort);settle(value);};
      const fail=()=>finish(reject,this.unavailable());
      const abort=()=>finish(reject,signal.reason);
      this.joiners.add(fail);timer=setTimeout(fail,this.interactiveWaitMs);
      signal?.addEventListener('abort',abort,{once:true});
      // Only this reader stops waiting. The shared background request keeps its
      // owner, retry budget and cache write, including when the reader times out.
      promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
  acquire(priority='interactive',options={}) {return this.enqueue(priority,options);}
  run(operation,{priority='interactive',signal}={}) {
    return this.enqueue(priority,{signal},(release,resolve,reject)=>{
      // Invoke synchronously on admission: queued/cancelled jobs never consume starts.
      try{Promise.resolve(operation(signal)).then(resolve,reject).finally(release);}
      catch(error){release();reject(error);}
    });
  }
  runHeld(operation,{priority='interactive',signal,owner,backgroundOwner=priority==='background'}={}) {
    return this.enqueue(priority,{signal,owner,backgroundOwner},(release,resolve,reject)=>{
      try{Promise.resolve(operation(release,signal)).then(resolve,error=>{release();reject(error);});}
      catch(error){release();reject(error);}
    });
  }
  reprioritize(owner,priority) {
    for(const waiter of this.waiters)if(waiter.owner===owner)waiter.priority=priority;
    this.drain();
  }
  enqueue(priority,{signal,owner,backgroundOwner=priority==='background'}={},start=(release,resolve)=>resolve(release)) {
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason);return;}
      if(!backgroundOwner&&priority!=='background'&&this.cooldownUntil>Date.now()){reject(this.unavailable());return;}
      const waiter={priority,owner,backgroundOwner,resolve,reject,start,timer:null,cleanup:()=>signal?.removeEventListener('abort',abort)};
      const abort=()=>{
        const index=this.waiters.indexOf(waiter);if(index<0)return;
        this.waiters.splice(index,1);clearTimeout(waiter.timer);waiter.cleanup();reject(signal.reason);this.drain();
      };
      signal?.addEventListener('abort',abort,{once:true});
      if(!backgroundOwner&&priority!=='background')waiter.timer=setTimeout(()=>{
        const index=this.waiters.indexOf(waiter);if(index<0)return;
        this.waiters.splice(index,1);waiter.cleanup();reject(this.unavailable());this.drain();
      },this.interactiveWaitMs);
      this.waiters.push(waiter);this.drain();
    });
  }
  unavailable() {
    const retryAfter=Math.max(1,Math.ceil((this.readyAt('interactive')-Date.now())/1000));
    return Object.assign(new HttpError(503,'upstream_busy',this.cooldownUntil>Date.now()?'Parliament is temporarily limiting requests. Please try again after the pause.':'Parliament requests are busy. Please try again.'),{retryAfter,retryAt:Date.now()+retryAfter*1000});
  }
  snapshot() {return {active:this.active,background:this.background,queued:this.waiters.length,joining:this.joiners.size,cooldownMs:Math.max(0,this.cooldownUntil-Date.now())};}
  backoff(seconds) {
    if(!Number.isFinite(seconds)||seconds<=0)return;
    this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+seconds*1000);
    this.nextStart=Math.max(this.nextStart,this.cooldownUntil);
    for(const fail of this.joiners)fail();
    this.waiters=this.waiters.filter(waiter=>{
      // Foreground joiners may promote scheduling, never the durable owner.
      if(waiter.backgroundOwner){waiter.priority='background';return true;}
      clearTimeout(waiter.timer);waiter.cleanup();waiter.reject(this.unavailable());return false;
    });
    this.drain();
  }
  readyAt(priority) {
    const now=Date.now();
    if(this.rateLimit){
      const {maximum,windowMs,foregroundReserve=0}=this.rateLimit;
      // Keep the boundary inclusive; a start exactly one window old still counts.
      while(this.starts.length&&this.starts[0]<now-windowMs)this.starts.shift();
      const allowance=maximum-(priority==='background'?foregroundReserve:0);
      if(this.starts.length>=allowance)return Math.max(this.cooldownUntil,this.nextStart,this.starts[this.starts.length-allowance]+windowMs+1);
    }
    return Math.max(this.cooldownUntil,this.nextStart);
  }
  drain() {
    clearTimeout(this.timer);this.timer=null;
    if(this.active>=this.maximum)return;
    let i=this.waiters.findIndex(w=>w.priority!=='background');
    if(i<0 && this.background<this.backgroundMaximum)i=this.waiters.findIndex(w=>w.priority==='background');
    if(i<0)return;
    const delay=this.readyAt(this.waiters[i].priority)-Date.now();
    if(delay>0){this.timer=setTimeout(()=>this.drain(),Math.min(delay,2**31-1));return;}
    const waiter=this.waiters.splice(i,1)[0];clearTimeout(waiter.timer);waiter.cleanup();this.active++;
    if(waiter.priority==='background')this.background++;
    this.nextStart=Date.now()+this.interval;
    if(this.rateLimit)this.starts.push(Date.now());
    let released=false;
    waiter.start(()=>{if(released)return;released=true;this.active--;if(waiter.priority==='background')this.background--;this.drain();},waiter.resolve,waiter.reject);
    this.drain();
  }
}

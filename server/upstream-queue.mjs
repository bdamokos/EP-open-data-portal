import {HttpError} from './http-utils.mjs';

export function retryAfterSeconds(value, now=Date.now()) {
  const seconds=/^\d+(?:\.\d+)?$/.test(String(value||'').trim())?Number(value):(Date.parse(value)-now)/1000;
  return Math.min(1800,Math.max(30,Number.isFinite(seconds)?Math.ceil(seconds):60));
}
// One shared rate limit; background work never occupies both connection slots.
export class UpstreamQueue {
  constructor({ interval=2100, maximum=2, backgroundMaximum=1, interactiveWaitMs=10_000 }={}) {
    this.interval=interval;this.maximum=maximum;this.backgroundMaximum=backgroundMaximum;
    this.interactiveWaitMs=interactiveWaitMs;
    this.active=0;this.background=0;this.nextStart=0;this.cooldownUntil=0;this.waiters=[];this.timer=null;
  }
  acquire(priority='interactive') {
    return new Promise((resolve,reject)=>{
      if(priority!=='background'&&this.cooldownUntil>Date.now()){reject(this.unavailable());return;}
      const waiter={priority,resolve,reject,timer:null};
      if(priority!=='background')waiter.timer=setTimeout(()=>{
        const index=this.waiters.indexOf(waiter);if(index<0)return;
        this.waiters.splice(index,1);reject(this.unavailable());this.drain();
      },this.interactiveWaitMs);
      this.waiters.push(waiter);this.drain();
    });
  }
  unavailable() {
    const retryAfter=Math.max(1,Math.ceil((Math.max(this.cooldownUntil,this.nextStart)-Date.now())/1000));
    return Object.assign(new HttpError(503,'upstream_busy',this.cooldownUntil>Date.now()?'Parliament is temporarily limiting requests. Please try again after the pause.':'Parliament requests are busy. Please try again.'),{retryAfter,retryAt:Date.now()+retryAfter*1000});
  }
  backoff(seconds) {
    this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+seconds*1000);
    this.nextStart=Math.max(this.nextStart,this.cooldownUntil);
    this.waiters=this.waiters.filter(waiter=>{
      if(waiter.priority==='background')return true;
      clearTimeout(waiter.timer);waiter.reject(this.unavailable());return false;
    });
    this.drain();
  }
  drain() {
    clearTimeout(this.timer);this.timer=null;
    if(this.active>=this.maximum)return;
    let i=this.waiters.findIndex(w=>w.priority!=='background');
    if(i<0 && this.background<this.backgroundMaximum)i=this.waiters.findIndex(w=>w.priority==='background');
    if(i<0)return;
    const delay=this.nextStart-Date.now();
    if(delay>0){this.timer=setTimeout(()=>this.drain(),delay);return;}
    const waiter=this.waiters.splice(i,1)[0];clearTimeout(waiter.timer);this.active++;
    if(waiter.priority==='background')this.background++;
    this.nextStart=Date.now()+this.interval;
    let released=false;
    waiter.resolve(()=>{if(released)return;released=true;this.active--;if(waiter.priority==='background')this.background--;this.drain();});
    this.drain();
  }
}

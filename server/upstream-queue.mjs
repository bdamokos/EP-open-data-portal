// One shared rate limit; background work never occupies both connection slots.
export class UpstreamQueue {
  constructor({ interval=2100, maximum=2, backgroundMaximum=1 }={}) {
    this.interval=interval;this.maximum=maximum;this.backgroundMaximum=backgroundMaximum;
    this.active=0;this.background=0;this.nextStart=0;this.waiters=[];this.timer=null;
  }
  acquire(priority='interactive') {
    return new Promise(resolve=>{this.waiters.push({priority,resolve});this.drain();});
  }
  backoff(seconds) {this.nextStart=Math.max(this.nextStart,Date.now()+seconds*1000);this.drain();}
  drain() {
    clearTimeout(this.timer);this.timer=null;
    if(this.active>=this.maximum)return;
    let i=this.waiters.findIndex(w=>w.priority!=='background');
    if(i<0 && this.background<this.backgroundMaximum)i=this.waiters.findIndex(w=>w.priority==='background');
    if(i<0)return;
    const delay=this.nextStart-Date.now();
    if(delay>0){this.timer=setTimeout(()=>this.drain(),delay);return;}
    const waiter=this.waiters.splice(i,1)[0];this.active++;
    if(waiter.priority==='background')this.background++;
    this.nextStart=Date.now()+this.interval;
    let released=false;
    waiter.resolve(()=>{if(released)return;released=true;this.active--;if(waiter.priority==='background')this.background--;this.drain();});
    this.drain();
  }
}

import {EventEmitter} from 'node:events';
import {HttpError} from './http-utils.mjs';
import {ipcPort} from './ipc-port.mjs';

// Starts the API process when a visitor needs it, keeps it while requests keep
// arriving and stops it after `idleMs` without any. Memory only returns to the
// system when the process exits, so idle means exit. A crashed process is
// started again by the next request, with exponential backoff.
//
// States: idle -> starting -> ready -> (stopping) -> idle.
export class ApiSupervisor extends EventEmitter {
  constructor({spawn,idleMs=20*60_000,startTimeoutMs=90_000,stopGraceMs=10_000,maxWaiters=128,backoffBaseMs=500,backoffMaxMs=30_000,stableMs=60_000,clock=Date.now,log=console.error}) {
    super();
    Object.assign(this,{spawn,idleMs,startTimeoutMs,stopGraceMs,maxWaiters,backoffBaseMs,backoffMaxMs,stableMs,clock,log});
    this.state='idle';this.child=null;this.control=null;this.port=null;this.readyAt=0;
    this.waiters=new Set();this.active=0;this.lastActivity=clock();
    this.failures=0;this.nextSpawnAt=0;this.respawn=false;this.idleTimer=null;this.startTimer=null;this.killTimer=null;
    this.pending=new Map();this.shutDown=false;this.starts=0;this.idleExits=0;this.crashes=0;
  }
  snapshot() {
    return {state:this.state,active:this.active,waiting:this.waiters.size,starts:this.starts,idleExits:this.idleExits,crashes:this.crashes,failures:this.failures,pid:this.child?.pid??null};
  }
  // Starts the process for a page load without taking a request.
  wake() {
    this.touch();
    if(this.state==='stopping'&&!this.shutDown)this.respawn=true;
    if(this.shutDown||this.state!=='idle'||this.clock()<this.nextSpawnAt)return;
    this.#start();
  }
  get ready() {return this.state==='ready';}
  touch() {
    this.lastActivity=this.clock();
    if(this.state==='ready')this.#armIdle();
  }
  // Resolves with a lease on the ready process. The lease counts as activity until released.
  acquire({budgetMs=30_000,signal}={}) {
    if(signal?.aborted)return Promise.reject(signal.reason);
    this.touch();
    if(this.state==='ready')return Promise.resolve(this.#lease());
    if(this.shutDown)return Promise.reject(this.#unavailable('shutting_down',5));
    if(this.waiters.size>=this.maxWaiters)return Promise.reject(this.#unavailable('api_busy',2));
    if(this.state==='idle'){
      const wait=this.nextSpawnAt-this.clock();
      if(wait>0)return Promise.reject(this.#unavailable('api_unavailable',Math.ceil(wait/1000)));
      this.#start();
      if(this.state==='idle')return Promise.reject(this.#unavailable('api_unavailable',Math.max(1,Math.ceil((this.nextSpawnAt-this.clock())/1000))));
    }else if(this.state==='stopping')this.respawn=true;
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject};
      const finish=settle=>value=>{
        clearTimeout(waiter.timer);signal?.removeEventListener('abort',waiter.abort);
        if(this.waiters.delete(waiter))settle(value);
      };
      waiter.resolve=finish(resolve);waiter.reject=finish(reject);
      waiter.timer=setTimeout(()=>waiter.reject(this.#unavailable('api_starting',2)),budgetMs);
      waiter.abort=()=>waiter.reject(signal.reason);
      signal?.addEventListener('abort',waiter.abort,{once:true});
      this.waiters.add(waiter);
    });
  }
  #lease() {
    this.active++;let released=false;
    return {port:this.port,release:()=>{
      if(released)return;
      released=true;this.active--;this.lastActivity=this.clock();
      if(this.state==='ready')this.#armIdle();
    }};
  }
  #unavailable(code,retryAfter) {
    return Object.assign(new HttpError(503,code,code==='api_starting'?'The service is starting. Please try again shortly.':'The service is temporarily unavailable. Please try again shortly.'),{retryAfter});
  }
  #start() {
    this.state='starting';this.starts++;
    let child;
    try {child=this.spawn();}
    catch(error){this.log('[api-supervisor]','Start failed:',error.message);this.state='idle';this.#fail();return;}
    this.child=child;this.control=ipcPort(child,'control');
    this.control.on('message',message=>{
      if(child!==this.child)return;
      if(message?.type==='listening'&&this.state==='starting')this.#ready(message.port);
      else this.emit('message',message);
    });
    child.once('exit',(code,signal)=>this.#exited(child,code,signal));
    child.once('error',error=>this.log('[api-supervisor]',error.message));
    this.startTimer=setTimeout(()=>{
      this.log('[api-supervisor]','API process did not start in time; stopping it.');
      child.kill('SIGKILL');
    },this.startTimeoutMs);
    this.emit('spawn',child);
  }
  #ready(port) {
    clearTimeout(this.startTimer);
    this.port=port;this.state='ready';this.readyAt=this.clock();
    this.lastActivity=this.clock();this.#armIdle();
    // Publications that arrived after the process began reading its stores.
    for(const message of this.pending.values())this.control.postMessage({type:'publication',message});
    this.pending.clear();
    for(const waiter of [...this.waiters])waiter.resolve(this.#lease());
  }
  #exited(child,code,signal) {
    if(child!==this.child)return;
    clearTimeout(this.startTimer);clearTimeout(this.killTimer);clearTimeout(this.idleTimer);
    const expected=this.state==='stopping';
    const stable=this.state==='ready'&&this.clock()-this.readyAt>=this.stableMs;
    this.child=null;this.control=null;this.port=null;this.state='idle';this.pending.clear();
    if(expected){
      this.failures=0;
      if(this.respawn||this.waiters.size){this.respawn=false;if(!this.shutDown)this.#start();}
      this.emit('stopped');return;
    }
    this.crashes++;
    this.log('[api-supervisor]',`API process exited (${signal||code}); the next request starts it again.`);
    if(stable)this.failures=0;
    this.#fail();
    this.emit('stopped');
  }
  #fail() {
    this.failures++;
    const delay=Math.min(this.backoffMaxMs,this.backoffBaseMs*2**(this.failures-1));
    this.nextSpawnAt=this.clock()+delay;
    for(const waiter of [...this.waiters])waiter.reject(this.#unavailable('api_unavailable',Math.max(1,Math.ceil(delay/1000))));
  }
  #armIdle() {
    if(!this.idleMs)return;
    clearTimeout(this.idleTimer);
    this.idleTimer=setTimeout(()=>this.#idleCheck(),Math.max(1,this.lastActivity+this.idleMs-this.clock()));
    this.idleTimer.unref();
  }
  #idleCheck() {
    if(this.state!=='ready')return;
    if(this.active>0||this.clock()-this.lastActivity<this.idleMs){this.#armIdle();return;}
    this.idleExits++;this.#stop();
  }
  #stop() {
    if(!this.child)return;
    this.state='stopping';clearTimeout(this.idleTimer);
    this.control?.postMessage({type:'shutdown'});
    const child=this.child;
    this.killTimer=setTimeout(()=>child.kill('SIGKILL'),this.stopGraceMs);this.killTimer.unref();
  }
  // The writer commits before it publishes, so a process that is stopping or
  // stopped loses nothing: the next one reads the stores afresh. A starting one
  // gets the latest publication of each source once it listens.
  publish(message) {
    if(this.state==='ready')this.control.postMessage({type:'publication',message});
    else if(this.state==='starting')this.pending.set(message?.source,message);
  }
  // Stops the process and refuses new work.
  async close() {
    this.shutDown=true;clearTimeout(this.idleTimer);
    for(const waiter of [...this.waiters])waiter.reject(this.#unavailable('shutting_down',5));
    const child=this.child;
    if(!child)return;
    const exited=new Promise(resolve=>child.once('exit',resolve));
    if(this.state==='starting'){clearTimeout(this.startTimer);this.state='stopping';child.kill('SIGTERM');}
    else if(this.state!=='stopping')this.#stop();
    await exited;
  }
}

import {retryAfterSeconds} from './upstream-queue.mjs';

// Only route families and allowlisted numeric response hints enter logs. Never
// retain request query strings, document/person IDs, response bodies or cookies.
export function odpRouteFamily(input) {
  const parts=new URL(input).pathname.replace(/^\/api\/v2\/?/,'').split('/').filter(Boolean);
  const roots=new Set(['meps','speeches','meetings','procedures','documents','adopted-texts','plenary-documents','plenary-session-documents','committee-documents','parliamentary-questions','external-documents','corporate-bodies']);
  if(!roots.has(parts[0]))return '/other';
  if(parts.length===1)return '/'+parts[0];
  if(parts[1]==='feed'||parts[1]==='show-current')return '/'+parts[0]+'/'+parts[1];
  const children=new Set(['activities','decisions','vote-results','foreseen-activities','speeches','memberships']);
  return '/'+parts[0]+'/{id}'+(parts.length>2?(children.has(parts[2])?'/'+parts[2]:'/{collection}'):'');
}

export class OdpObservations {
  constructor({clock=Date.now,log=console.warn,queue=()=>({}),onResponse=()=>{}}={}) {
    Object.assign(this,{clock,log,queue,onResponse});
    this.startedAt=clock();this.buckets=new Map();this.lastThrottle=null;
  }
  bucket() {
    const minute=Math.floor(this.clock()/60_000);
    for(const key of this.buckets.keys())if(key<minute-59)this.buckets.delete(key);
    if(!this.buckets.has(minute))this.buckets.set(minute,{starts:0,responses:0,networkErrors:0,latencyMs:0,statuses:{},routes:{}});
    return this.buckets.get(minute);
  }
  snapshot() {
    this.bucket();
    const result={starts:0,responses:0,networkErrors:0,latencyMs:0,statuses:{},routes:{}};
    for(const b of this.buckets.values()) {
      for(const key of ['starts','responses','networkErrors','latencyMs'])result[key]+=b[key];
      for(const key of ['statuses','routes'])for(const [name,count] of Object.entries(b[key]))result[key][name]=(result[key][name]||0)+count;
    }
    const minutes=[...this.buckets].slice(-5).map(([minute,b])=>({at:new Date(minute*60_000).toISOString(),starts:b.starts,responses:b.responses,networkErrors:b.networkErrors,statuses:{...b.statuses}}));
    return {since:new Date(this.startedAt).toISOString(),window:'current and previous 59 UTC minutes',...result,minutes,meanHeaderLatencyMs:result.responses?Math.round(result.latencyMs/result.responses):null,lastThrottle:this.lastThrottle,admission:this.queue()};
  }
  async fetch(url,options) {
    const route=odpRouteFamily(url),started=this.clock(),b=this.bucket();
    b.starts++;b.routes[route]=(b.routes[route]||0)+1;
    let response;
    try {response=await globalThis.fetch(url,options);}
    catch(error){this.bucket().networkErrors++;throw error;}
    const completed=this.bucket();completed.responses++;completed.latencyMs+=Math.max(0,this.clock()-started);
    completed.statuses[response.status]=(completed.statuses[response.status]||0)+1;
    this.onResponse(response.status);
    if(response.status===429||response.status===503) {
      const retryAfter=retryAfterSeconds(response.headers.get('retry-after'),this.clock());
      const hints={};
      for(const name of ['ratelimit-limit','ratelimit-remaining','ratelimit-reset','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset']) {
        const value=response.headers.get(name);
        if(value!==null&&/^\d{1,15}$/.test(value))hints[name]=Number(value);
      }
      this.lastThrottle={at:new Date(this.clock()).toISOString(),route,status:response.status,retryAfterSeconds:retryAfter,hints};
      this.log('[odp-throttle]',JSON.stringify({...this.lastThrottle,admission:this.queue()}));
    }
    return response;
  }
}

// Normal keeps the existing admission policy. Backfill smooths starts near the
// published ceiling; steady is an optional gentler periodic-update setting.
export function odpPacing(mode='normal') {
  if(!['normal','backfill','steady'].includes(mode))throw new Error('Invalid ODP_REQUEST_MODE.');
  return {mode,interval:mode==='backfill'?667:mode==='steady'?1500:0,adaptive:mode!=='normal'};
}

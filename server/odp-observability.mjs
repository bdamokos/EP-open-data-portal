import {retryAfterSeconds} from './upstream-queue.mjs';

// Error messages and arbitrary codes can contain URLs or other source data.
// Retain only fixed classifications and known runtime codes, never their text.
const failureCodes=new Map([
  ...['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].map(code=>[code,'transport-timeout']),
  ...['ENOTFOUND','EAI_AGAIN'].map(code=>[code,'dns']),
  ...['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET'].map(code=>[code,'connection']),
  ...['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].map(code=>[code,'tls']),
  ...['ABORT_ERR','UND_ERR_ABORTED'].map(code=>[code,'aborted']),
  ['request_timeout','request-timeout'],['request_cancelled','request-cancelled'],
]);
function fetchFailure(error,signal) {
  // The combined fetch signal carries the actual local deadline/cancellation
  // reason even when fetch wraps it. An abort alone does not establish why.
  const causes=[...(signal?.aborted?[signal.reason]:[]),error,error?.cause,error?.cause?.cause];
  for(const cause of causes) {
    if(failureCodes.has(cause?.code))return {kind:failureCodes.get(cause.code),code:cause.code};
    if(cause?.name==='TimeoutError')return {kind:'transport-timeout',code:null};
  }
  return {kind:signal?.aborted||causes.some(cause=>cause?.name==='AbortError')?'aborted':'other',code:null};
}
const increment=(counts,key)=>{counts[key]=(counts[key]||0)+1;};

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
    this.startedAt=clock();this.buckets=new Map();this.lastThrottle=null;this.lastFailure=null;
    this.pendingHeaders=new Set();this.untrackedHeaders=0;
  }
  bucket() {
    const minute=Math.floor(this.clock()/60_000);
    for(const key of this.buckets.keys())if(key<minute-59)this.buckets.delete(key);
    if(!this.buckets.has(minute))this.buckets.set(minute,{starts:0,responses:0,networkErrors:0,latencyMs:0,statuses:{},routes:{},failureKinds:{},failureLatencyMs:0,maxFailureLatencyMs:0,routeFailures:{}});
    return this.buckets.get(minute);
  }
  headerSnapshot() {
    return {pendingHeaders:[...this.pendingHeaders].map(({route,started})=>({route,ageMs:Math.max(0,this.clock()-started)})),
      untrackedHeaders:this.untrackedHeaders,lastFailure:this.lastFailure?{...this.lastFailure}:null};
  }
  snapshot() {
    this.bucket();
    const result={starts:0,responses:0,networkErrors:0,latencyMs:0,statuses:{},routes:{},failureKinds:{},failureLatencyMs:0,maxFailureLatencyMs:0,routeFailures:{}};
    for(const b of this.buckets.values()) {
      for(const key of ['starts','responses','networkErrors','latencyMs','failureLatencyMs'])result[key]+=b[key];
      result.maxFailureLatencyMs=Math.max(result.maxFailureLatencyMs,b.maxFailureLatencyMs);
      for(const key of ['statuses','routes','failureKinds'])for(const [name,count] of Object.entries(b[key]))result[key][name]=(result[key][name]||0)+count;
      for(const [route,stats] of Object.entries(b.routeFailures)) {
        const total=result.routeFailures[route]??={count:0,latencyMs:0,maxLatencyMs:0,kinds:{}};
        total.count+=stats.count;total.latencyMs+=stats.latencyMs;total.maxLatencyMs=Math.max(total.maxLatencyMs,stats.maxLatencyMs);
        for(const [kind,count] of Object.entries(stats.kinds))total.kinds[kind]=(total.kinds[kind]||0)+count;
      }
    }
    const minutes=[...this.buckets].slice(-5).map(([minute,b])=>({at:new Date(minute*60_000).toISOString(),starts:b.starts,responses:b.responses,networkErrors:b.networkErrors,statuses:{...b.statuses},failureKinds:{...b.failureKinds},failureLatencyMs:b.failureLatencyMs,maxFailureLatencyMs:b.maxFailureLatencyMs}));
    return {since:new Date(this.startedAt).toISOString(),window:'current and previous 59 UTC minutes',...result,minutes,
      meanHeaderLatencyMs:result.responses?Math.round(result.latencyMs/result.responses):null,
      meanFailureLatencyMs:result.networkErrors?Math.round(result.failureLatencyMs/result.networkErrors):null,
      ...this.headerSnapshot(),lastThrottle:this.lastThrottle,admission:this.queue()};
  }
  async fetch(url,options) {
    const route=odpRouteFamily(url),started=this.clock(),b=this.bucket();
    b.starts++;b.routes[route]=(b.routes[route]||0)+1;
    const pending={route,started},tracked=this.pendingHeaders.size<16;
    if(tracked)this.pendingHeaders.add(pending);else this.untrackedHeaders++;
    let response;
    try {response=await globalThis.fetch(url,options);}
    catch(error){
      const failed=this.bucket(),elapsedMs=Math.max(0,this.clock()-started),classification=fetchFailure(error,options?.signal);
      failed.networkErrors++;failed.failureLatencyMs+=elapsedMs;failed.maxFailureLatencyMs=Math.max(failed.maxFailureLatencyMs,elapsedMs);
      increment(failed.failureKinds,classification.kind);
      const stats=failed.routeFailures[route]??={count:0,latencyMs:0,maxLatencyMs:0,kinds:{}};
      stats.count++;stats.latencyMs+=elapsedMs;stats.maxLatencyMs=Math.max(stats.maxLatencyMs,elapsedMs);increment(stats.kinds,classification.kind);
      this.lastFailure={at:new Date(this.clock()).toISOString(),route,elapsedMs,...classification,signalAborted:Boolean(options?.signal?.aborted)};
      throw error;
    }finally{if(tracked)this.pendingHeaders.delete(pending);else this.untrackedHeaders--;}
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

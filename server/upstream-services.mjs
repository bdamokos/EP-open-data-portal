import {UpstreamQueue} from './upstream-queue.mjs';
import {OdpObservations,odpPacing} from './odp-observability.mjs';

// The upstream queues, rate budget and request observations. One process owns
// them: the HTTP process in single mode, the front process in split mode. This
// module stays small so the front can own them without loading the API graph.

// The published 500/5min endpoint ceiling is conservatively shared across ALL
// API v2 paths/IDs/queries. Reserve 100 starts (20%) for readers and other foreground work.
export const ODP_RATE_LIMIT=Object.freeze({maximum:500,windowMs:300_000,foregroundReserve:100});
export const UPSTREAM_SOURCES=Object.freeze(['wikidata','odp','website','documents','document-files','multimedia','player','https://oeil.europarl.europa.eu','https://publications.europa.eu','https://data.consilium.europa.eu']);

// Each call builds an independent set of queues; a process normally holds one (see defaultUpstreamServices).
export function createUpstreamServices() {
  const pacing=odpPacing(process.env.ODP_REQUEST_MODE||'normal');
  const upstreamQueue = new UpstreamQueue({rateLimit:ODP_RATE_LIMIT,...pacing,backgroundPacing:pacing.mode==='backfill'});
  const observations=new OdpObservations({queue:()=>({...upstreamQueue.quotaSnapshot(),mode:pacing.mode}),onResponse:status=>upstreamQueue.recordResponse(status)});
  const odpObservations=()=>observations.snapshot();
  const odpHeaderStatus=()=>observations.headerSnapshot();
  function startOdpMonitoring({log=console.warn,intervalMs=60_000}={}) {
    const report=()=>log('[odp-monitor]',JSON.stringify(odpObservations()));
    report();const timer=setInterval(report,intervalMs);timer.unref();
    return ()=>{clearInterval(timer);report();};
  }
  const sourceQueues=new Map([['odp',upstreamQueue]]);
  let sourceWakeQueued=false;
  function wireCollectorAdmission(queue){
    queue.lowBackgroundAllowed=()=>![...sourceQueues.values()].some(q=>[...q.admitted].some(w=>w.priority!=='background')||q.waiters.some(w=>w.priority!=='background'));
    queue.onActivity=()=>{if(sourceWakeQueued)return;sourceWakeQueued=true;queueMicrotask(()=>{sourceWakeQueued=false;for(const q of sourceQueues.values())q.drain();});};
    return queue;
  }
  wireCollectorAdmission(upstreamQueue);
  function assertUpstreamSource(source) {
    if(!UPSTREAM_SOURCES.includes(source))throw new Error('Unknown upstream source.');
  }
  function localSourceQueue(source,{backgroundRank=0}={}) {
    assertUpstreamSource(source);
    if(!sourceQueues.has(source))sourceQueues.set(source,wireCollectorAdmission(new UpstreamQueue(source==='wikidata'?{interval:1000,maximum:1,backgroundMaximum:1}:source==='https://oeil.europarl.europa.eu'?{interval:1000,maximum:1,backgroundMaximum:1}:source==='https://publications.europa.eu'?{rateLimit:{maximum:500,windowMs:300_000,foregroundReserve:100},interval:750,adaptive:true,backgroundPacing:true}:{})));
    const queue=sourceQueues.get(source);
    if(source==='odp'&&backgroundRank>0&&!queue.adaptive){const mode=odpPacing('backfill');Object.assign(pacing,mode);queue.adaptive=true;queue.backgroundPacing=true;queue.interval=Math.max(queue.interval,mode.interval);queue.minimumInterval=queue.interval;}
    return queue;
  }
  return {observations,odpObservations,odpHeaderStatus,startOdpMonitoring,assertUpstreamSource,localSourceQueue,
    upstreamPortServices:()=>({queueFor:localSourceQueue,observations}),upstreamStatus:()=>upstreamQueue.snapshot()};
}

// The services of this process. odp.mjs adopts its own set when it loads, so
// the API code and the source writers share one rate budget; a front process
// that never loads odp.mjs creates its set on first use.
let defaultServices;
export const defaultUpstreamServices=()=>defaultServices??=createUpstreamServices();
export function adoptUpstreamServices(services) {
  defaultServices??=services;
  return services;
}

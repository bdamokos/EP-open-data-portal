export const PROGRESS_REFRESH_DELAYS=Object.freeze([500,1000,2000,4000,6000,8000]);
export const PROGRESS_REFRESH_DEADLINE=30_000;
export const isProgressRoute=route=>/^insights\/procedure-progress(?:\?|$)/.test(route||'');
const sources=data=>data?.sources||[data?.source];
export const progressPending=data=>sources(data).some(source=>source?.refreshInProgress);
export const progressCacheMaxAge=(data,route,maxAge)=>isProgressRoute(route)&&(sources(data).some(source=>source?.stale||source?.refreshInProgress||source?.refreshError)||data?.fallback?.status==='unavailable')?0:maxAge;

function pause(ms,signal) {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}

// Follow only an admitted background refresh. An error/backoff or finite poll
// budget settles the read; explicit retry starts a new, cancellable lifecycle.
export async function readRefreshingInsight(route,{get,force,signal,onData}) {
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const progress=isProgressRoute(route),timer=progress?setTimeout(()=>controller.abort(new Error('Updates are still pending.')),PROGRESS_REFRESH_DEADLINE):null;
  try {
    let data=await get(route,{force,signal:controller.signal});
    controller.signal.throwIfAborted();
    onData(data,progress&&progressPending(data));
    if(!progress)return data;
    for(const delay of PROGRESS_REFRESH_DELAYS) {
      if(!progressPending(data))return data;
      await pause(delay,controller.signal);
      data=await get(route,{force:true,signal:controller.signal});
      controller.signal.throwIfAborted();
      onData(data,progressPending(data));
    }
    if(progressPending(data))throw new Error('Updates are still pending.');
    return data;
  }finally{if(timer!==null)clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

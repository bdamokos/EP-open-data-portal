export const PROGRESS_REFRESH_DELAYS=Object.freeze([500,1000,2000,4000,6000,8000]);
export const PROGRESS_REFRESH_DEADLINE=30_000;
export const isProgressRoute=route=>/^insights\/procedure-progress(?:\?|$)/.test(route||'');
const sources=data=>[data?.source,...(Array.isArray(data?.sources)?data.sources:[])].filter(Boolean);
export function progressSourceState(data) {
  const observations=sources(data),retryAt=Math.max(0,...[data?.fallback?.retryAt,...observations.map(source=>source.retryAt)].filter(Number.isFinite));
  const failed=Boolean(data?.fallback?.status==='unavailable'||observations.some(source=>source.refreshError));
  return {failed,retryAt,stale:observations.some(source=>source.stale),pending:!failed&&retryAt<=Date.now()&&observations.some(source=>source.refreshInProgress)};
}
export const progressPending=data=>progressSourceState(data).pending;
export const progressCacheMaxAge=(data,route,maxAge)=>{
  const state=progressSourceState(data);
  return isProgressRoute(route)&&(state.failed||state.stale||state.pending||state.retryAt>Date.now())?0:maxAge;
};
const usable=data=>data?.state==='mapped'&&Boolean(data.status||data.events?.length||data.documents?.length);
function retainProgress(previous,next) {
  if(!previous||previous.reference!==next.reference||previous.language!==next.language||previous.detail!==next.detail||!usable(previous)||usable(next)||!progressSourceState(next).failed)return next;
  // Display the saved observation with its original retrieval date. The new
  // source failure must remain visible even when its HTTP envelope was valid.
  const source={...previous.source,stale:true,refreshInProgress:false,refreshError:next.fallback?.error||'Progress update unavailable.'};
  return {...previous,source,sources:[...sources(next).filter(item=>item.url!==source.url),source],fallback:next.fallback};
}

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
export async function readRefreshingInsight(route,{get,force,signal,onData,initialData=null}) {
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const progress=isProgressRoute(route),timer=progress?setTimeout(()=>controller.abort(new Error('Updates are still pending.')),PROGRESS_REFRESH_DEADLINE):null;
  try {
    let data=initialData;
    const read=async requestForce=>{
      const next=await get(route,{force:requestForce,signal:controller.signal});
      controller.signal.throwIfAborted();
      data=progress?retainProgress(data,next):next;
      onData(data,progress&&progressPending(data));
    };
    await read(force);
    if(!progress)return data;
    for(const delay of PROGRESS_REFRESH_DELAYS) {
      if(!progressPending(data))return data;
      await pause(delay,controller.signal);
      await read(true);
    }
    if(progressPending(data))throw new Error('Updates are still pending.');
    return data;
  }finally{if(timer!==null)clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

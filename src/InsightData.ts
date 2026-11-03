import {retryableGap,gapRetryAt} from './automaticRetry.mjs';
import {useAutomaticRetry} from './useAutomaticRetry';
import {calendarCacheMaxAge} from './sittingCalendarCache.mjs';
import { useEffect,useState,useCallback,useRef } from 'react';
import { api } from './data';
import { createDataClient, dataTimeoutFor } from './client.mjs';
import {isProgressRoute,progressCacheMaxAge,readRefreshingInsight} from './insightRefresh.mjs';
const client=createDataClient(api,{maxEntries:24,maxAge:5*60_000,maxAgeFor:(data,route)=>/^insights\/dossier-(activity|references)(?:\?|$)/.test(route)?0:progressCacheMaxAge(data,route,calendarCacheMaxAge(data,5*60_000)),timeoutFor:dataTimeoutFor});
export function prefetchInsightData(routes:string[]) { return client.prefetch(routes); }
export function useInsightData<T>(route:string|null,equivalentRoute?:(loaded:string,requested:string,data:T)=>boolean,{retryWhile,retryAtFor}:{retryWhile?:(data:T)=>boolean;retryAtFor?:(data:T)=>number}={}) {
  const [attempt,setAttempt]=useState(0),[state,setState]=useState<{route:string|null;data:T|null;loading:boolean;error:string|null;status?:number;code?:string;retryAt?:number}>({route,data:null,loading:true,error:null});
  const failure=useRef<unknown>(null);
  const lastRequest=useRef({route,attempt});
  const retry=useCallback(()=>setAttempt(x=>x+1),[]);
  const equivalent=Boolean(route&&state.route&&state.data&&!state.loading&&!state.error&&equivalentRoute?.(state.route,route,state.data));
  useEffect(()=>{
    // A resolved URL may name the response already displayed; explicit retries still fetch it.
    if(equivalent&&lastRequest.current.attempt===attempt){lastRequest.current={route,attempt};return;}
    if(route===null){lastRequest.current={route,attempt};setState({route,data:null,loading:false,error:null});return;}
    let active=true;
    const controller=new AbortController();
    const force=lastRequest.current.route===route&&lastRequest.current.attempt!==attempt;
    lastRequest.current={route,attempt};
    let retained=state.route===route&&state.data?state.data:client.peek<T>(route);
    setState({route,data:retained,loading:true,error:null});
    readRefreshingInsight(route,{get:client.get,force,signal:controller.signal,initialData:retained,onData:(data:T,loading:boolean)=>{retained=data;if(active)setState({route,data,loading,error:null});}})
      .then(data=>{failure.current=null;if(active)setState({route,data,loading:false,error:null});})
      .catch(e=>{if(active)failure.current=e;if(active)setState({route,data:e.status===401||e.status===403?null:retained,loading:false,error:e.message,status:e.status,code:e.code,retryAt:e.retryAt});});
    return()=>{active=false;controller.abort();};
  },[route,attempt]);
  const retrying=useAutomaticRetry(route,state.route===route?failure.current:null,state.route!==route||state.loading,retry,retryableGap(state.data,retryWhile),gapRetryAt(state.data,retryAtFor));
  return {retrying,...((state.route===route||equivalent)?{...state,route}:{route,data:null,loading:route!==null,error:null}),...(retrying?{error:null,loading:!state.data||state.loading}:{}),retry};
}

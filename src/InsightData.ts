import {calendarCacheMaxAge} from './sittingCalendarCache.mjs';
import { useEffect,useState,useCallback,useRef } from 'react';
import { api } from './data';
import { createDataClient, dataTimeoutFor } from './client.mjs';
const client=createDataClient(api,{maxEntries:24,maxAge:5*60_000,maxAgeFor:(data,route)=>/^insights\/dossier-(activity|references)(?:\?|$)/.test(route)?0:calendarCacheMaxAge(data,5*60_000),timeoutFor:dataTimeoutFor});
export function prefetchInsightData(routes:string[]) { return client.prefetch(routes); }
export function useInsightData<T>(route:string|null,equivalentRoute?:(loaded:string,requested:string,data:T)=>boolean) {
  const [attempt,setAttempt]=useState(0),[state,setState]=useState<{route:string|null;data:T|null;loading:boolean;error:string|null}>({route,data:null,loading:true,error:null});
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
    setState({route,data:client.peek<T>(route),loading:true,error:null});
    client.get<T>(route,{force,signal:controller.signal})
      .then(data=>{if(active)setState({route,data,loading:false,error:null});})
      .catch(e=>{if(active)setState({route,data:client.peek<T>(route),loading:false,error:e.message});});
    return()=>{active=false;controller.abort();};
  },[route,attempt]);
  return {...((state.route===route||equivalent)?{...state,route}:{route,data:null,loading:route!==null,error:null}),retry};
}

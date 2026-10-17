import { useEffect,useState,useCallback,useRef } from 'react';
import { api } from './data';
import { createDataClient } from './client.mjs';
const client=createDataClient(api,{maxEntries:24,maxAge:5*60_000,timeoutFor:()=>55_000});
export function useInsightData<T>(route:string|null) {
  const [attempt,setAttempt]=useState(0),[state,setState]=useState<{route:string|null;data:T|null;loading:boolean;error:string|null}>({route,data:null,loading:true,error:null});
  const lastRequest=useRef({route,attempt});
  const retry=useCallback(()=>setAttempt(x=>x+1),[]);
  useEffect(()=>{if(route===null){lastRequest.current={route,attempt};setState({route,data:null,loading:false,error:null});return;}let active=true;const force=lastRequest.current.route===route&&lastRequest.current.attempt!==attempt;lastRequest.current={route,attempt};setState({route,data:client.peek<T>(route),loading:true,error:null});client.get<T>(route,{force}).then(data=>{if(active)setState({route,data,loading:false,error:null});}).catch(e=>{if(active)setState({route,data:client.peek<T>(route),loading:false,error:e.message});});return()=>{active=false;};},[route,attempt]);
  return {...(state.route===route?state:{route,data:null,loading:route!==null,error:null}),retry};
}

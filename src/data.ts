import {localizePlaceLabels} from './placeLabels.mjs';
import {retryableGap,gapRetryAt} from './automaticRetry.mjs';
import {useAutomaticRetry} from './useAutomaticRetry';
import {useUiI18n} from './UiI18nReact';
import {uiErrorText} from './uiErrors.mjs';
import {defaultUi} from './uiDefault.mjs';
import { useCallback, useEffect, useRef, useState } from "react";
import { API_ROOT } from "./api";
import { createDataClient, dataTimeoutFor, readJson } from "./client.mjs";
import type {SpeechDetail,StoredSpeechTranscript} from './explorerTypes';

export function api<T>(route: string, signal?: AbortSignal, { priority = 'auto', getPriority }: { priority?: 'auto' | 'low'; getPriority?: () => 'auto' | 'low' } = {}, ui: import('./uiI18n.mjs').UiFormatter = defaultUi): Promise<T> {
  return readJson<T>(`${API_ROOT}/${route}`, { signal, priority, getPriority, timeoutMs: dataTimeoutFor(route) }, ui).then(data=>/^(?:topics\/|insights\/record-topics(?:\?|$))/.test(route)?localizePlaceLabels(data,new URLSearchParams(route.split('?')[1]).get('lang')||'en') as T:data);
}
const client = createDataClient((route,signal,options)=>api(route==='directory'&&client.peek<{committeeDetails?:{error?:string}}>(route)?.committeeDetails?.error?'directory?retry=committee-details':route,signal,options), { timeoutFor: dataTimeoutFor });
export function expireActivityReads() { client.expireMatching(route=>/^(document\/|latest-activities\/)/.test(route)); }
export function useSpeechData(id:string,language:string) {
  const route=encodeURIComponent(id)+'?lang='+language;
  const saved=useData<StoredSpeechTranscript>('speech-transcript/'+route,{automatic:false});
  const retained=saved.data?.available&&saved.data.xml&&saved.data.id===id&&saved.data.metadata?.id===id?saved.data.metadata:null;
  const detail=useData<SpeechDetail>(!saved.fetching&&!retained?'speech/'+route:null,{automatic:false});
  const previousDetail=useRef<{route:string;data:SpeechDetail}|null>(null);
  const denied=[saved.status,detail.status].some(status=>status===401||status===403);
  useEffect(()=>{
    if(denied||previousDetail.current?.route!==route)previousDetail.current=null;
    if(!denied&&detail.data?.id===id)previousDetail.current={route,data:detail.data};
  },[route,id,detail.data,denied]);
  // A coordinated refresh checks the corpus first and retains the chosen text
  // while its fallback is disabled. IDs and languages never share bodies.
  const data=denied?null:retained||detail.data||(!denied&&previousDetail.current?.route===route?previousDetail.current.data:null);
  const transcript=saved.data?.id===id&&saved.data.available&&saved.data.xml?saved.data:data?.id===id?data:null;
  const body=saved.data?.id===id&&saved.data.available&&saved.data.xml?saved:detail;
  const retry=useCallback(()=>{saved.retry();detail.retry();},[saved.retry,detail.retry]);
  const fetching=saved.fetching||detail.fetching;
  const failure=denied?([401,403].includes(saved.status||0)?saved.failure:detail.failure):body.failure||(!transcript?detail.failure||saved.failure:null);
  const retrying=useAutomaticRetry(route,failure,fetching,retry,retryableGap(transcript)||retryableGap(data?.textCache),Math.max(saved.retryAt||0,detail.retryAt||0,gapRetryAt(transcript),gapRetryAt(data?.textCache)));
  const availableTextLanguages=[...new Set([...(saved.data?.id===id?saved.data.availableTextLanguages||[]:[]),...(data?.id===id?data.availableTextLanguages||[]:[])])];
  return {...detail,data,transcript,retry,retrying,availableTextLanguages,loading:!transcript&&(fetching||retrying),
    error:transcript||fetching||retrying?null:detail.error||saved.error,
    refreshing:fetching||retrying,refreshError:transcript?.xml&&!retrying?body.error:null,refreshRetryAt:transcript?.xml?body.retryAt:undefined};
}
export function prefetchData(routes: string[]) { return client.prefetch(routes); }
export function useData<T>(route: string | null, {retryWhile,retryAtFor,automatic=true}: {retryWhile?:(data:T)=>boolean;retryAtFor?:(data:T)=>number;automatic?:boolean} = {}) {
  const ui=useUiI18n();
  const [state, setState] = useState<{
    route: string | null;
    data: T | null;
    error: unknown | null;
    status?: number;
    retryAt?: number;
    loading: boolean;
  }>({ route, data: route ? client.peek<T>(route) : null, error: null, loading: Boolean(route) });
  const [retry, setRetry] = useState(0);
  const previousRequest = useRef({ route, retry });
  const refresh = useCallback(() => setRetry(x => x + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const force = previousRequest.current.retry !== retry;
    // A dependent read can be disabled while its prerequisite refreshes. Keep
    // its explicit retry pending until it has a route again.
    previousRequest.current = { route, retry: route ? retry : previousRequest.current.retry };
    setState(previous => ({ route, data: route ? (previous.route === route ? previous.data : client.peek<T>(route)) : null, error: null, loading: Boolean(route) }));
    if (route)
      client.get<T>(route, { force, signal: controller.signal })
        .then((data) => { if (active) setState({ route, data, error: null, loading: false }); })
        .catch((e) => {
          if (active) setState(previous => ({ route, data: e.status === 401 || e.status === 403 ? null : previous.data, error: e, status:typeof e.status==='number'?e.status:undefined,retryAt: e.retryAt, loading: false }));
        });
    return () => { active = false; controller.abort(); };
  }, [route, retry]);
  const retrying=useAutomaticRetry(automatic?route:null,state.route===route?state.error:null,state.route!==route||state.loading,refresh,Boolean(state.route===route&&state.data&&retryableGap(state.data,retryWhile)),gapRetryAt(state.data,retryAtFor));
  const current = state.route === route ? state : {route,data:route ? client.peek<T>(route) : null,error:null,loading:Boolean(route)};
  // Expose a retry before effects run, so dependent hooks do not briefly start
  // a fallback while this prerequisite is about to refresh.
  return { ...current, attempt:retry, fetching:current.loading,failure:current.error, loading:current.loading||retrying&&!current.data, retrying, error:retrying||current.error===null?null:uiErrorText(current.error,ui), ...(previousRequest.current.retry !== retry ? {error:null,failure:null,status:undefined,retryAt:undefined,fetching:Boolean(route),loading:Boolean(route)} : {}), retry: refresh };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { API_ROOT } from "./api";
import { createDataClient, dataTimeoutFor, readJson } from "./client.mjs";
import type {SpeechDetail,StoredSpeechTranscript} from './explorerTypes';

export function api<T>(route: string, signal?: AbortSignal, { priority = 'auto', getPriority }: { priority?: 'auto' | 'low'; getPriority?: () => 'auto' | 'low' } = {}): Promise<T> {
  return readJson<T>(`${API_ROOT}/${route}`, { signal, priority, getPriority, timeoutMs: dataTimeoutFor(route) });
}
const client = createDataClient(api, { timeoutFor: dataTimeoutFor });
export function expireActivityReads() { client.expireMatching(route=>/^(document\/|latest-activities\/)/.test(route)); }
export function useSpeechData(id:string,language:string) {
  const route=encodeURIComponent(id)+'?lang='+language;
  const saved=useData<StoredSpeechTranscript>('speech-transcript/'+route);
  const retained=saved.data?.available&&saved.data.xml&&saved.data.id===id&&saved.data.metadata?.id===id?saved.data.metadata:null;
  const detail=useData<SpeechDetail>(!saved.loading&&!retained?'speech/'+route:null);
  const data=retained||detail.data;
  const transcript=saved.data?.id===id&&saved.data.available&&saved.data.xml?saved.data:data?.id===id?data:null;
  const retry=useCallback(()=>{saved.retry();detail.retry();},[saved.retry,detail.retry]);
  const availableTextLanguages=[...new Set([...(saved.data?.id===id?saved.data.availableTextLanguages||[]:[]),...(data?.id===id?data.availableTextLanguages||[]:[])])];
  return {...detail,data,transcript,retry,availableTextLanguages,loading:!transcript&&(saved.loading||detail.loading),
    error:transcript?null:saved.loading?null:detail.error};
}
export function prefetchData(routes: string[]) { return client.prefetch(routes); }
export function useData<T>(route: string | null) {
  const [state, setState] = useState<{
    route: string | null;
    data: T | null;
    error: string | null;
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
    const force = previousRequest.current.route === route && previousRequest.current.retry !== retry;
    previousRequest.current = { route, retry };
    setState(previous => ({ route, data: route ? (previous.route === route ? previous.data : client.peek<T>(route)) : null, error: null, loading: Boolean(route) }));
    if (route)
      client.get<T>(route, { force, signal: controller.signal })
        .then((data) => { if (active) setState({ route, data, error: null, loading: false }); })
        .catch((e) => {
          if (active) setState(previous => ({ route, data: e.status === 401 || e.status === 403 ? null : previous.data, error: e.message, status:typeof e.status==='number'?e.status:undefined,retryAt: e.retryAt, loading: false }));
        });
    return () => { active = false; controller.abort(); };
  }, [route, retry]);
  return { ...(state.route === route ? state : {route,data:route ? client.peek<T>(route) : null,error:null,loading:Boolean(route)}), retry: refresh };
}

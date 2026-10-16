import { useCallback, useEffect, useRef, useState } from "react";
import { API_ROOT } from "./api";
import { createPocClient } from "./pocClient.mjs";

export async function api<T>(route: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${API_ROOT}/poc/${route}`, {
    signal,
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok)
    throw Object.assign(new Error(data?.error?.message || `The data service is unavailable (${r.status}).`), { status: r.status, retryAt: data?.error?.retryAt });
  if (!data) throw new Error("The data service returned an unreadable response.");
  return data;
}
const client = createPocClient(api, { timeoutFor: route => route.startsWith('speech-context/') ? 60_000 : /^(speech\/|document\/|references\?|reference-summary\?)/.test(route) ? 35_000 : route.startsWith("speech-media/") ? 30_000 : 8_000 });
export function expireActivityReads() { client.expireMatching(route=>/^(document\/|latest-activities\/)/.test(route)); }
export function useData<T>(route: string | null) {
  const [state, setState] = useState<{
    route: string | null;
    data: T | null;
    error: string | null;
    retryAt?: number;
    loading: boolean;
  }>({ route, data: route ? client.peek<T>(route) : null, error: null, loading: Boolean(route) });
  const [retry, setRetry] = useState(0);
  const previousRequest = useRef({ route, retry });
  const refresh = useCallback(() => setRetry(x => x + 1), []);
  useEffect(() => {
    let active = true;
    const force = previousRequest.current.route === route && previousRequest.current.retry !== retry;
    previousRequest.current = { route, retry };
    setState(previous => ({ route, data: route ? (previous.route === route ? previous.data : client.peek<T>(route)) : null, error: null, loading: Boolean(route) }));
    if (route)
      client.get<T>(route, { force })
        .then((data) => { if (active) setState({ route, data, error: null, loading: false }); })
        .catch((e) => {
          if (active) setState(previous => ({ route, data: e.status === 401 || e.status === 403 ? null : previous.data, error: e.message, retryAt: e.retryAt, loading: false }));
        });
    return () => { active = false; };
  }, [route, retry]);
  return { ...(state.route === route ? state : {route,data:route ? client.peek<T>(route) : null,error:null,loading:Boolean(route)}), retry: refresh };
}

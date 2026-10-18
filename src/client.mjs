import {versionedApiUrl} from '../server/api-version.mjs';
import {reportApiVersionMismatch} from './apiVersionMismatch.mjs';

// Browser budgets include the server's queue wait inside its 30s request budget,
// plus transport headroom. Local index/corpus reads keep the short default.
export function dataTimeoutFor(route) {
  const path = route.split('?')[0];
  if (path.startsWith('motion-comparison/')) return 90_000;
  if (path.startsWith('speech-context/')) return 60_000;
  if (path.startsWith('profile/')) return 40_000;
  if (/^(directory$|speeches\/|activities\/|speech-statistics\/|speech\/|document\/|document-context\/|member-votes\/|speech-media\/|references$|reference-summary$|source-record$)/.test(path)) return 35_000;
  if (/^insights\/(speech-cloud|procedure-context|topic-trends|legislation|participation)$/.test(path)) return 35_000;
  return 8_000;
}

function retryTime(value, now) {
  if (value == null || String(value).trim() === '') return null;
  const seconds = Number(value);
  const at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

// GET only: one deadline covers response bodies, backoff and every attempt.
// Short busy responses get at most two retries and six seconds of backoff.
export async function readJson(url, { signal, priority = 'auto', getPriority = () => priority, timeoutMs = 8_000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeoutError = new Error('The request took too long. Try again.');
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const active = controller.signal;
  let waited = 0;
  try {
    for (let attempt = 0; ; attempt++) {
      active.throwIfAborted();
      const response = await fetchImpl(versionedApiUrl(url), { method: 'GET', signal: active, priority: getPriority(), credentials: 'omit', headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => null);
      active.throwIfAborted();
      reportApiVersionMismatch(response.status, data);
      if (response.ok) {
        if (!data) throw new Error('The data service returned an unreadable response.');
        return data;
      }
      const now = Date.now();
      const retryAt = Number.isFinite(data?.error?.retryAt) ? data.error.retryAt : null;
      const headerAt = retryTime(response.headers.get('Retry-After'), now);
      const bodyAt = retryTime(data?.error?.retryAfter, now);
      const times = [retryAt, headerAt, bodyAt].filter(at => at !== null);
      const at = times.length ? Math.max(...times) : null;
      const error = Object.assign(new Error(data?.error?.message || `The data service is unavailable (${response.status}).`), {
        status: response.status, code: data?.error?.code, retryAt: at ?? undefined,
      });
      const transient = response.status === 503 && ['upstream_busy', 'odp_rate_limited', 'request_timeout'].includes(error.code);
      const delay = at === null ? null : Math.max(250, at - now);
      if (!transient || delay === null || delay > 3000 || waited + delay > 6000 || attempt >= 2 || getPriority() === 'low') throw error;
      waited += delay;
      await pause(delay, active);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function createDataClient(load, { maxEntries = 60, maxAge = 30_000, timeoutFor = () => 8_000, prefetchDelay = 150 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const prefetches = new Set();
  let prefetchTimer, prefetching = false;
  const peek = route => cache.get(route)?.data ?? null;
  const get = (route, { force = false, priority = 'auto' } = {}) => {
    const saved = cache.get(route);
    if (!force && saved && Date.now() - saved.at < maxAge) return Promise.resolve(saved.data);
    if (pending.has(route)) {
      if (priority !== 'low') pending.get(route).priority = priority;
      return pending.get(route).promise;
    }
    const controller = new AbortController();
    const entry = { controller, priority, invalidated: false, promise: null, invalidate: null };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The request took too long. Try again."));
      }, timeoutFor(route));
    });
    const invalidation = new Promise(resolve => { entry.invalidate = () => {
      entry.invalidated = true;
      controller.abort();
      resolve();
    }; });
    const request = Promise.race([Promise.resolve().then(() => load(route, controller.signal, { priority, getPriority: () => entry.priority })), timeout, invalidation])
      .then(data => {
        // Superseded callers receive the replacement too, even if the loader ignores abort.
        if (entry.invalidated) return get(route);
        cache.delete(route);
        cache.set(route, { data, at: Date.now() });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return data;
      }, error => {
        if (entry.invalidated) return get(route);
        if (error.status === 401 || error.status === 403) cache.clear();
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        if (pending.get(route) === entry) pending.delete(route);
      });
    entry.promise = request;
    pending.set(route, entry);
    return request;
  };
  const schedulePrefetch = () => {
    if (prefetchTimer || prefetching || !prefetches.size) return;
    prefetchTimer = setTimeout(async () => {
      prefetchTimer = null;
      // Leave capacity for reads the user has actually requested.
      if ([...pending.values()].some(entry => entry.priority !== 'low')) { schedulePrefetch(); return; }
      const batch = prefetches.values().next().value;
      if (!batch) return;
      const route = batch.next().value;
      if (!route) { prefetches.delete(batch); schedulePrefetch(); return; }
      prefetching = true;
      try { await get(route, { priority: 'low' }); }
      catch { prefetches.delete(batch); } // Speculation must not surface errors or keep hitting a busy upstream.
      finally { prefetching = false; schedulePrefetch(); }
    }, prefetchDelay);
  };
  return { peek, get, prefetch(routes) {
    if (!routes.length) return () => {};
    const batch = new Set(routes).values();
    prefetches.add(batch);
    schedulePrefetch();
    // Keep an in-flight read available to a foreground caller joining it.
    return () => {
      prefetches.delete(batch);
      if (!prefetches.size) { clearTimeout(prefetchTimer); prefetchTimer = null; }
    };
  }, expireMatching(matches) {
    for (const [route, entry] of cache) if (matches(route)) entry.at = -Infinity;
    for (const [route, entry] of pending) if (matches(route)) {
      pending.delete(route);
      entry.invalidate();
    }
  } };
}

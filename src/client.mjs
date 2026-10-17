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
    const request = Promise.race([Promise.resolve().then(() => load(route, controller.signal, { priority })), timeout, invalidation])
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

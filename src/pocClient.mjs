export function createPocClient(load, { maxEntries = 60, maxAge = 30_000, timeoutFor = () => 8_000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const peek = route => cache.get(route)?.data ?? null;
  const get = (route, { force = false } = {}) => {
    const saved = cache.get(route);
    if (!force && saved && Date.now() - saved.at < maxAge) return Promise.resolve(saved.data);
    if (pending.has(route)) return pending.get(route).promise;
    const controller = new AbortController();
    const entry = { controller, invalidated: false, promise: null, invalidate: null };
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
    const request = Promise.race([Promise.resolve().then(() => load(route, controller.signal)), timeout, invalidation])
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
  return { peek, get, expireMatching(matches) {
    for (const [route, entry] of cache) if (matches(route)) entry.at = -Infinity;
    for (const [route, entry] of pending) if (matches(route)) {
      pending.delete(route);
      entry.invalidate();
    }
  } };
}

export function createPocClient(load, { maxEntries = 60, maxAge = 30_000, timeoutFor = () => 8_000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const peek = route => cache.get(route)?.data ?? null;
  const get = (route, { force = false } = {}) => {
    const saved = cache.get(route);
    if (!force && saved && Date.now() - saved.at < maxAge) return Promise.resolve(saved.data);
    if (pending.has(route)) return pending.get(route);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The request took too long. Try again."));
      }, timeoutFor(route));
    });
    const request = Promise.race([Promise.resolve().then(() => load(route, controller.signal)), timeout])
      .then(data => {
        cache.delete(route);
        cache.set(route, { data, at: Date.now() });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return data;
      })
      .catch(error => {
        if (error.status === 401 || error.status === 403) cache.clear();
        throw error;
      })
      .finally(() => { clearTimeout(timer); pending.delete(route); });
    pending.set(route, request);
    return request;
  };
  return { peek, get };
}

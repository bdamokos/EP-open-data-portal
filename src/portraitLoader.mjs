const portraitPath = /^(?:(?:\.\/)*|\/)api\/poc\/portrait\/([1-9][0-9]*)$/;
const aborted = () => new DOMException('Portrait no longer needed', 'AbortError');

export function isManagedPortrait(url) {
  return portraitPath.test(url);
}

export function createPortraitLoader({concurrency = 3, maxQueued = 1024, fetchImpl = (...args) => fetch(...args), wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const queue = [], jobs = new Map();
  let active = 0;

  async function read(job) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(job.url, {credentials: 'omit', redirect: 'error'});
      if (response.ok) return response.blob();
      const retry = [429, 503].includes(response.status) && attempt < 2 && job.listeners.size;
      await response.arrayBuffer();
      if (!retry) throw new Error(`Portrait request failed (${response.status})`);
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
      const requested = seconds !== null ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 2000;
      const delay = Math.max(2000, Math.min(30000, Number.isFinite(requested) ? requested : 2000));
      await wait(delay);
      if (!job.listeners.size) throw aborted();
    }
  }

  function settle(job, error, blob) {
    if (jobs.get(job.url) === job) jobs.delete(job.url);
    for (const listener of job.listeners) {
      listener.cleanup();
      if (error) listener.reject(error);
      else listener.resolve(blob);
    }
    job.listeners.clear();
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (!job.listeners.size) continue;
      active++;
      job.started = true;
      // A detached consumer does not abort active HTTP work: the backend may
      // still be serving it. Keep its slot until the response body settles.
      read(job).then(blob => settle(job, null, blob), error => settle(job, error)).finally(() => {
        active--;
        pump();
      });
    }
  }

  function load(url, {signal} = {}) {
    const match = portraitPath.exec(url);
    if (!match) return Promise.reject(new Error('Invalid portrait path'));
    url = `/api/poc/portrait/${match[1]}`;
    if (signal?.aborted) return Promise.reject(aborted());
    let job = jobs.get(url);
    if (!job) {
      if (queue.length >= maxQueued) return Promise.reject(new Error('Portrait queue is full'));
      job = {url, started: false, listeners: new Set()};
      jobs.set(url, job);
      queue.push(job);
    }
    const promise = new Promise((resolve, reject) => {
      const cancel = () => {
        job.listeners.delete(listener);
        listener.cleanup();
        reject(aborted());
        if (!job.started && !job.listeners.size) {
          queue.splice(queue.indexOf(job), 1);
          jobs.delete(url);
        }
      };
      const listener = {resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel)};
      job.listeners.add(listener);
      signal?.addEventListener('abort', cancel, {once: true});
    });
    pump();
    return promise;
  }

  return {load};
}

// Shared by the wall, profiles, question authors and plenary/vote cards.
// Three portrait requests leave room for text and other interactive API reads.
export const portraitLoader = createPortraitLoader();

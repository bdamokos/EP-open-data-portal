import {versionedApiUrl} from '../server/api-version.mjs';
import {reportApiVersionMismatch} from './apiVersionMismatch.mjs';

const portraitPath = /^(?:(?:\.\/)*|\/)api\/portrait\/([1-9][0-9]*)$/;
const aborted = () => new DOMException('Portrait no longer needed', 'AbortError');

export function isManagedPortrait(url) {
  return portraitPath.test(url);
}

export function createPortraitLoader({concurrency = 3, maxQueued = 1024, startInterval = 250, fetchImpl = (...args) => fetch(...args), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now()} = {}) {
  const queue = [], jobs = new Map();
  let active = 0;
  let credit = concurrency, refilledAt = now(), pausedUntil = 0;

  function admit(job) {
    if (!job.listeners.size) throw aborted();
    const time = now();
    if (startInterval > 0 && time > refilledAt) {
      credit = Math.min(concurrency, credit + (time - refilledAt) / startInterval);
      refilledAt = time;
    }
    const pacing = startInterval > 0 && credit < 1 ? Math.max(0, refilledAt - time) + Math.ceil((1 - credit) * startInterval) : 0;
    const delay = Math.max(pausedUntil - time, pacing);
    // Check again after each bounded wait: another response can extend the
    // cooldown, and a filtered/unmounted consumer may no longer need the job.
    if (delay > 0) return wait(Math.min(delay, 30_000)).then(() => admit(job));
    if (startInterval > 0) credit--;
    // Do not yield between checking the shared cooldown and starting HTTP.
    // Another response may otherwise establish a cooldown in that gap.
    return fetchImpl(versionedApiUrl(job.url), {credentials: 'omit', redirect: 'error'});
  }

  function pause(response) {
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
    const requested = seconds !== null ? seconds * 1000 : header ? Date.parse(header) - now() : 2000;
    const delay = Math.max(2000, Number.isFinite(requested) ? requested : 2000);
    pausedUntil = Math.max(pausedUntil, now() + delay);
    // Refill one start at the deadline, then resume at the normal pace rather
    // than releasing all waiting retries and new portraits together.
    credit = 0;
    refilledAt = pausedUntil - startInterval;
  }

  async function read(job) {
    for (let attempt = 0; ; attempt++) {
      const response = await admit(job);
      if (response.ok) return response.blob();
      if (response.status === 409) {
        reportApiVersionMismatch(response.status, await response.json().catch(() => null));
        throw new Error('Portrait request failed (409)');
      }
      const limited = [429, 503].includes(response.status);
      if (limited) pause(response);
      const retry = limited && attempt < 2 && job.listeners.size;
      await response.arrayBuffer();
      if (!retry) throw new Error(`Portrait request failed (${response.status})`);
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
    url = `/api/portrait/${match[1]}`;
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
// Admit the first three immediately, then pace starts even for fast cache hits.
// Text and other interactive API reads do not wait behind this portrait queue.
export const portraitLoader = createPortraitLoader();

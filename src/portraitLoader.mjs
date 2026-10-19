import {versionedApiUrl} from '../server/api-version.mjs';
import {reportApiVersionMismatch} from './apiVersionMismatch.mjs';

const portraitPath = /^(?:(?:\.\/)*|\/)api\/portrait\/([1-9][0-9]*)$/;
const aborted = () => new DOMException('Portrait no longer needed', 'AbortError');

export function isManagedPortrait(url) {
  return portraitPath.test(url);
}

export function createPortraitLoader({concurrency = 6, backgroundConcurrency = Math.min(3, concurrency), maxQueued = 1024, startInterval = 250, fetchImpl = (...args) => fetch(...args), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now()} = {}) {
  const queue = [], jobs = new Map();
  let active = 0, backgroundActive = 0;
  let credit = backgroundConcurrency, refilledAt = now(), pausedUntil = 0, recovering = false;
  let wakeAt = Infinity, wakeGeneration = 0;
  const visible = job => [...job.listeners].some(listener => listener.priority === 'visible');
  const rejected = error => Object.assign(Promise.reject(error), {setPriority() {}});

  function schedule(delay) {
    const bounded = Math.min(delay, 30_000), deadline = now() + bounded;
    if (deadline >= wakeAt) return;
    wakeAt = deadline;
    const generation = ++wakeGeneration;
    wait(bounded).then(() => {
      if (generation !== wakeGeneration) return;
      wakeAt = Infinity;
      pump();
    });
  }

  function admissionDelay(foreground) {
    const time = now();
    if (startInterval > 0 && time > refilledAt) {
      const refill = (time - refilledAt) / startInterval;
      credit = Math.min(backgroundConcurrency, credit + refill);
      refilledAt = time;
    }
    const available = foreground && !recovering ? 1 : credit;
    const pacing = startInterval > 0 && available < 1 ? Math.max(0, refilledAt - time) + Math.ceil((1 - available) * startInterval) : 0;
    return Math.max(pausedUntil - time, pacing);
  }

  function pause(response) {
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
    const requested = seconds !== null ? seconds * 1000 : header ? Date.parse(header) - now() : 2000;
    const delay = Math.max(2000, Number.isFinite(requested) ? requested : 2000);
    pausedUntil = Math.max(pausedUntil, now() + delay);
    // Refill one start at the deadline, then resume at the normal pace rather
    // than releasing all waiting retries and new portraits together.
    recovering = true;
    credit = 0;
    refilledAt = pausedUntil - startInterval;
  }

  async function read(job) {
    try {
      const response = await fetchImpl(versionedApiUrl(job.url), {credentials: 'omit', redirect: 'error'});
      if (response.ok) return settle(job, null, await response.blob());
      if (response.status === 409) {
        reportApiVersionMismatch(response.status, await response.json().catch(() => null));
        throw new Error('Portrait request failed (409)');
      }
      const limited = [429, 503].includes(response.status);
      if (limited) pause(response);
      await response.arrayBuffer();
      if (limited && job.attempt++ < 2 && job.listeners.size) {
        job.started = false;
        queue.push(job);
      } else throw new Error(`Portrait request failed (${response.status})`);
    } catch (error) { settle(job, error); }
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

  function resetIfIdle() {
    if (!active && !queue.length && now() >= pausedUntil) recovering = false;
  }

  function pump() {
    resetIfIdle();
    while (active < concurrency && queue.length) {
      const foregroundIndex = queue.findIndex(visible);
      const index = foregroundIndex < 0 ? 0 : foregroundIndex;
      const job = queue[index], foreground = visible(job);
      if (!job.listeners.size) {queue.splice(index, 1); settle(job, aborted()); continue;}
      if (!foreground && backgroundActive >= backgroundConcurrency) return;
      const delay = admissionDelay(foreground);
      if (delay > 0) {schedule(delay); return;}
      queue.splice(index, 1);
      if (startInterval > 0 && (!foreground || recovering)) credit--;
      active++;
      if (!foreground) backgroundActive++;
      job.started = true;
      // Admission and HTTP dispatch are synchronous. Paced jobs keep no active
      // slot, so newly visible portraits can overtake look-ahead work.
      // Detached HTTP work keeps its slot until its response body settles.
      read(job).finally(() => {
        active--;
        if (!foreground) backgroundActive--;
        pump();
      });
    }
  }

  function load(url, {signal, priority = 'background'} = {}) {
    resetIfIdle();
    const match = portraitPath.exec(url);
    if (!match) return rejected(new Error('Invalid portrait path'));
    url = `/api/portrait/${match[1]}`;
    if (signal?.aborted) return rejected(aborted());
    let job = jobs.get(url);
    if (!job) {
      if (queue.length >= maxQueued) return rejected(new Error('Portrait queue is full'));
      job = {url, started: false, attempt: 0, listeners: new Set()};
      jobs.set(url, job);
      queue.push(job);
    }
    let listener;
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
      listener = {resolve, reject, priority, cleanup: () => signal?.removeEventListener('abort', cancel)};
      job.listeners.add(listener);
      signal?.addEventListener('abort', cancel, {once: true});
    });
    promise.setPriority = value => {
      if (!job.listeners.has(listener)) return;
      listener.priority = value;
      pump();
    };
    pump();
    return promise;
  }

  return {load};
}

// Shared by the wall, profiles, question authors and plenary/vote cards.
// Visible portraits fill six response slots without fixed start spacing.
// Look-ahead work keeps its three-slot limit and 250 ms start pacing; busy
// responses temporarily apply that pacing to both priorities until idle.
// Text and other interactive API reads do not wait behind this portrait queue.
export const portraitLoader = createPortraitLoader();

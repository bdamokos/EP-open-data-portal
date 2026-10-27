const HOUR = 3600;
const DAY = 24 * HOUR;
const noStore = Object.freeze({cacheControl: 'no-store', cdnCacheControl: 'no-store'});
const direct = new Set(['directory', 'references', 'reference-summary', 'source-record', 'amendments', 'vote-periods']);
const byId = new Set(['profile', 'activities', 'speeches', 'latest-activities', 'speech', 'speech-context', 'speech-media', 'document', 'motion-comparison']);
const insights = new Set(['questions', 'legislation', 'saved', 'participation', 'speech-words', 'procedure-context', 'procedure-progress', 'press-releases', 'group-voices']);

function approvedPath(pathname) {
  const parts = pathname.split('/');
  if (parts[0] !== '' || parts[1] !== 'api') return false;
  const [, , resource, item] = parts;
  if (parts.length === 3) return direct.has(resource);
  if (parts.length !== 4 || !item) return false;
  // Attendance registers remain revisable, independent observations.
  if(resource==='member-attendance')return false;
  if (byId.has(resource)) return true;
  if (resource === 'insights') return insights.has(item);
  if (resource === 'corpus') return item === 'search' || item === 'text';
  return resource === 'outside' && (item === 'directory' || /^[1-9]\d*$/.test(item));
}

function transientState(payload) {
  const pending = [payload], seen = new Set();
  let visited = 0;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    // Unexpectedly complex envelopes fail closed without an unbounded walk.
    if (++visited > 20_000) return true;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'stale' || key === 'refreshInProgress' || key === 'loading') && child === true) return true;
      if (key === 'status' && ['error', 'unavailable', 'loading', 'pending', 'missing_acquisition', 'fetch_failed'].includes(child)) return true;
      if (key === 'kind' && ['agenda-unavailable', 'votes-unavailable'].includes(child)) return true;
      if (key === 'identityIssues' && Array.isArray(child) && child.some(issue => ['person-names-unavailable', 'person-profile-unavailable'].includes(issue))) return true;
      if (/errors?$/i.test(key) && child && (!Array.isArray(child) || child.length)) return true;
      if (key === 'catalogueComplete' && child === false) return true;
      if (key === 'nextRetryAt' && child) return true;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

function publicPolicy(seconds, browserSeconds = 0) {
  return {
    cacheControl: `public, max-age=${browserSeconds}`,
    cdnCacheControl: `public, max-age=${seconds}, stale-if-error=0`,
  };
}

export function apiCachePolicy(request, url, payload, {now = Date.now()} = {}) {
  if (!['GET', 'HEAD'].includes(request.method) || request.headers?.authorization || !approvedPath(url.pathname) || transientState(payload)) return noStore;
  if(url.pathname==='/api/insights/procedure-progress') {
    if(!['mapped','unmapped'].includes(payload?.state)||!payload?.coverage||payload.coverage.limited||payload.coverage.invalidRows||payload.coverage.incompleteEvents||payload.coverage.timeline==='unavailable')return noStore;
    return publicPolicy(5*60);
  }
  // Feeds are read daily. Nothing is cached before following starts.
  if(url.pathname==='/api/insights/press-releases')return payload?.coverage?.followingSince?publicPolicy(15*60):noStore;
  // Memberships are assembled after a process restart. Polls must reach the
  // origin until that work finishes instead of retaining its first snapshot.
  if (url.pathname === '/api/directory' && (payload?.index?.complete !== true || payload?.committeeDetails?.complete === false)) return noStore;
  // Held dates change at Brussels midnight; a CDN lifetime must not hide the new day.
  if (url.pathname === '/api/vote-periods') return noStore;
  if (url.pathname.includes('/speech-media/') && payload?.available === false) return noStore;
  const resource = url.pathname.split('/')[2];
  if (resource === 'speech' && !payload?.xml) return noStore;
  if (['activities', 'latest-activities', 'speeches'].includes(resource)) return publicPolicy(HOUR);

  // Only positive reading responses qualify for the longer historical lifetime.
  // An old unanswered question can still acquire an answer and remains at 6 h.
  const reading = resource === 'speech' || resource === 'document' || url.pathname === '/api/corpus/text';
  const selectedAnswer = resource === 'document' && url.pathname.endsWith('-ASW');
  const date = selectedAnswer ? payload?.selectedDocumentDate : payload?.date;
  const time = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN;
  const established = Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && now - time >= 14 * DAY * 1000;
  const unanswered = resource === 'document' && /^[EOP]-\d+-\d{4}-\d+$/.test(url.pathname.split('/').at(-1)) && !payload?.answers?.length;
  return publicPolicy(reading && established && !unanswered ? DAY : 6 * HOUR);
}

export function portraitCachePolicy(image, {now = Date.now()} = {}) {
  // Do not cache a retained, expired portrait for another week while its source
  // refresh runs. Its existing seven-day conditional source refresh is unchanged.
  const seconds = Math.min(7 * DAY, Math.floor((image.fetchedAt + 7 * DAY * 1000 - now) / 1000));
  return Number.isFinite(seconds) && seconds > 0 ? publicPolicy(seconds, Math.min(DAY, seconds)) : noStore;
}

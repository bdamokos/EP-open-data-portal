import {agendaViewFreshMs,brusselsMidnight} from './plenary-cache-policy.mjs';
import {brusselsDay} from './analysis-period.mjs';
const HOUR = 3600;
const DAY = 24 * HOUR;
const noStore = Object.freeze({cacheControl: 'no-store', cdnCacheControl: 'no-store'});
const direct = new Set(['directory', 'references', 'reference-summary', 'source-record', 'amendments', 'amendment-neighbours', 'vote-periods']);
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

// The member directory alone holds about 30,000 objects (5 MB); JSON_RESPONSE_LIMIT_BYTES
// bounds every reply, so this cap only guards against unexpectedly dense envelopes.
const TRANSIENT_WALK_LIMIT = 250_000;

function transientState(payload) {
  const pending = [payload], seen = new Set();
  let visited = 0;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    // Unexpectedly complex envelopes fail closed without an unbounded walk.
    if (++visited > TRANSIENT_WALK_LIMIT) return true;
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

function untilNextBrusselsDay(now) {
  const next = new Date(Date.parse(brusselsDay(now) + 'T12:00:00Z') + DAY * 1000).toISOString().slice(0, 10);
  return Math.min(DAY + HOUR, Math.max(60, Math.ceil((brusselsMidnight(next) - now) / 1000) + 60));
}

// revalidate: the CDN may answer with an expired copy once while it refreshes
// in the background, so a visitor does not wait for a sleeping origin.
// ifError: the CDN may answer with an expired copy while the origin fails.
// Day-bound and agenda answers keep neither.
function publicPolicy(seconds, browserSeconds = 0, {revalidate = 0, ifError = 0} = {}) {
  return {
    cacheControl: `public, max-age=${browserSeconds}`,
    cdnCacheControl: `public, max-age=${seconds}${revalidate ? `, stale-while-revalidate=${revalidate}` : ''}, stale-if-error=${ifError}`,
  };
}
const settled = {revalidate: HOUR, ifError: 7 * DAY};
// Records whose content does not depend on today's date. Views that mark
// sittings upcoming, current or held, or pick the latest period, are not here.
// Amendment pages add today's scheduled votes, and corpus search reports coverage up to today.
const staleSafe = new Set(['references', 'source-record', 'amendment-neighbours', 'speech', 'speech-context', 'speech-media', 'document', 'motion-comparison', 'corpus/text']);
const established = {revalidate: DAY, ifError: 7 * DAY};

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
  // Memberships are rare and dated, but each reply marks them current for one Brussels day.
  // Expire a minute after the next midnight, when the server recomputes them.
  if (url.pathname === '/api/directory') return publicPolicy(untilNextBrusselsDay(now));
  // Held dates change at Brussels midnight. Only a complete, current calendar
  // is kept, and only until a minute after that midnight.
  if (url.pathname === '/api/vote-periods') {
    const years = payload?.coverage?.years;
    const clean = payload?.coverage?.status === 'complete' && Array.isArray(years) && years.every(year => year?.state === 'complete' && Array.isArray(year.sources) && year.sources.every(source => !source?.stale && !source?.refreshInProgress && !source?.refreshError));
    return clean ? publicPolicy(untilNextBrusselsDay(now)) : noStore;
  }
  if (url.pathname.includes('/speech-media/') && payload?.available === false) return noStore;
  const resource = url.pathname.split('/')[2];
  if (resource === 'speech' && !payload?.xml) return noStore;
  if (['activities', 'latest-activities', 'speeches'].includes(resource)) return publicPolicy(HOUR);
  if(url.pathname==='/api/insights/legislation'&&!payload?.detail){
    const freshness=agendaViewFreshMs(payload,now);
    if(Number.isFinite(freshness))return publicPolicy(freshness/1000);
  }

  // Only positive reading responses qualify for the longer historical lifetime.
  // An old unanswered question can still acquire an answer and remains at 6 h.
  const reading = resource === 'speech' || resource === 'document' || url.pathname === '/api/corpus/text';
  const selectedAnswer = resource === 'document' && url.pathname.endsWith('-ASW');
  const date = selectedAnswer ? payload?.selectedDocumentDate : payload?.date;
  const time = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN;
  const settledReading = Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && now - time >= 14 * DAY * 1000;
  const unanswered = resource === 'document' && /^[EOP]-\d+-\d{4}-\d+$/.test(url.pathname.split('/').at(-1)) && !payload?.answers?.length;
  if (reading && settledReading && !unanswered) return publicPolicy(DAY, 0, established);
  // An unanswered question can gain its answer at any time; date-bound views
  // (profiles, insights, outside speakers) keep no stale copy either.
  const record = resource === 'corpus' ? 'corpus/' + url.pathname.split('/')[3] : resource;
  return staleSafe.has(record) && !unanswered ? publicPolicy(6 * HOUR, 0, settled) : publicPolicy(6 * HOUR);
}

export function portraitCachePolicy(image, {now = Date.now()} = {}) {
  // Do not cache a retained, expired portrait for another week while its source
  // refresh runs. Its existing seven-day conditional source refresh is unchanged.
  const seconds = Math.min(7 * DAY, Math.floor((image.fetchedAt + 7 * DAY * 1000 - now) / 1000));
  return Number.isFinite(seconds) && seconds > 0 ? publicPolicy(seconds, Math.min(DAY, seconds), {revalidate: DAY, ifError: 7 * DAY}) : noStore;
}

// Image bytes are addressed by their own SHA-256 and that of their source document.
export const documentImageCachePolicy = request => request.headers?.authorization ? noStore : {cacheControl: 'public, max-age=31536000, immutable', cdnCacheControl: 'public, max-age=31536000, immutable'};

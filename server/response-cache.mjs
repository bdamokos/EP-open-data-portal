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

const addDays = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * DAY * 1000).toISOString().slice(0, 10);
const calendarDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && addDays(value, 0) === value;

// Routes added after 17 October. Each is cached only behind its own completeness
// gate, because their partial and pending shapes are not caught by transientState.
// None keeps a stale copy. Undefined means the route is not one of these.
function gatedRoutePolicy(url, p, now) {
  const [, , resource, item, extra] = url.pathname.split('/');
  if (extra !== undefined) return undefined;
  const q = url.searchParams, today = brusselsDay(now), six = publicPolicy(6 * HOUR);
  const only = (...keys) => [...q.keys()].every(key => keys.includes(key));
  const gate = ok => ok ? six : noStore;
  if (resource === 'document-context' && item) {
    // Only the plain document; amendment, passage, provision and final-text replies drop or lack their evidence.
    return gate(only('lang') && (p?.baseline == null || p.baseline.status === 'available') && !p?.amendment && !p?.related?.gaps?.length && p?.related?.status !== 'partial');
  }
  if (resource === 'decision-votes' && item) {
    const day = item.slice(7, 17);
    return gate(calendarDay(day) && day < today && p?.status === 'found' && p.coverage === 'complete' && p.integrity === 'complete'
      && p.decision?.ballotStatus === 'conducted' && Array.isArray(p.decision.evidenceGaps) && !p.decision.evidenceGaps.length && !p.decision.sourceConflicts && p.groupHistory != null);
  }
  if (resource === 'insights' && (item === 'week-results' || item === 'week-story')) {
    const week = q.get('week'), finished = calendarDay(week) && addDays(week, 6) < today;
    if (item === 'week-results') return gate(finished && Array.isArray(p?.days) && p.days.length > 0 && p.days.every(day => day?.complete === true));
    return gate(finished && p?.status === 'complete');
  }
  if (resource === 'topics' && ['search', 'overview', 'detail'].includes(item)) {
    // The current quarter and the overview turn over with the Brussels day. Records whose
    // subject read is unavailable stay counted as such; only pending reads are transient.
    const ok = p?.ready === true && p.coverage?.pending === 0;
    return ok ? publicPolicy(Math.min(6 * HOUR, untilNextBrusselsDay(now))) : noStore;
  }
  if (resource === 'voting-lists' && item === undefined) {
    // Lists are re-read through the session and purged after 30 days; only a settled week-old sitting is kept.
    const day = (q.get('sitting') || '').slice(7);
    return gate(calendarDay(day) && addDays(day, 7) <= today && Array.isArray(p?.gaps) && !p.gaps.length
      && Array.isArray(p.documents) && p.documents.length > 0 && p.documents.every(document => document?.documentId && !document.gaps?.length));
  }
  if (resource === 'member-votes' && item) {
    const selected = q.get('sitting') || (q.get('week') && q.get('week') !== 'latest');
    const sittings = p?.coverage?.sittings;
    return gate(Boolean(selected) && p.coverage.status === 'complete' && p.coverage.collectionComplete === true && Array.isArray(sittings) && sittings.length > 0
      && sittings.every(sitting => sitting?.state === 'complete' && sitting.completeness?.complete === true && !sitting.pendingVotes && calendarDay(sitting.date) && sitting.date < today));
  }
  if (resource === 'member-vote-record' && item) {
    // The record grows with every vote day and attributes the group as of today: a short lifetime.
    const ok = p?.coverage?.status === 'complete' && p.coverage.missing === 0 && p.coverage.unprojectedDecisions === 0 && p.period?.to != null;
    return ok ? publicPolicy(15 * 60) : noStore;
  }
  if (resource === 'motion-amendments' && item) {
    const c = p?.coverage;
    return gate(c?.complete === true && c.indexStatus === 'indexed' && ['records', 'observed-empty'].includes(c.resultState) && c.backgroundPending === false
      && Array.isArray(c.gaps) && !c.gaps.length && p.text?.status === 'indexed' && p.text.outcome?.totalsStatus === 'available');
  }
  if (resource === 'speech-transcript' && item) {
    if (!(p?.available === true && typeof p.xml === 'string' && p.xml && p.metadataUnavailable !== true)) return noStore;
    const day = item.slice(7, 17);
    return calendarDay(day) && Date.parse(day) <= now - 14 * DAY * 1000 ? publicPolicy(DAY) : six;
  }
  return undefined;
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
// Single records whose content does not depend on today's date or a running
// sitting. Not here: views that mark sittings upcoming, current or held or pick
// the latest period; amendment pages and neighbours (today's votes and
// outcomes); speech context (a debate still in progress); source records
// (collections and current rosters); references (unresolved until published).
const staleSafe = new Set(['speech', 'speech-media', 'document', 'motion-comparison', 'corpus/text']);
const established = {revalidate: DAY, ifError: 7 * DAY};

export function apiCachePolicy(request, url, payload, {now = Date.now()} = {}) {
  if (!['GET', 'HEAD'].includes(request.method) || request.headers?.authorization || transientState(payload)) return noStore;
  const gated = gatedRoutePolicy(url, payload, now);
  if (gated) return gated;
  if (!approvedPath(url.pathname)) return noStore;
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

export const COMMITTEE_MEMBERSHIP_VERSION = 1;
const committeeClass = /^COMMITTEE_PARLIAMENTARY_(STANDING|SUB|TEMPORARY|SPECIAL)$/;
const canonical = /^(?:https:\/\/data\.europarl\.europa\.eu\/)?org\/[A-Z][A-Z0-9_-]*$/;
const dayNumber = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n / 86400_000 : null;
};
const identity = body => canonical.test(body?.isVersionOf || '') ? body.isVersionOf.replace('https://data.europarl.europa.eu/', '') : null;
const tail = value => String(value || '').split('/').at(-1);

// The public isVersionOf relationship, never a matching code/name, connects
// temporal committee bodies. Original membership observations remain intact.
export function committeeMemberships(memberships, bodies = [], day) {
  const metadata = new Map(bodies.map(body => [String(body.identifier), body]));
  const family = m => {
    const body = metadata.get(m.id);
    return body && tail(body.classification) === m.classification && identity(body) || 'body/' + m.id;
  };
  const rows = memberships.filter(m => committeeClass.test(m.classification));
  const current = rows.filter(m => {
    const temporal = metadata.get(m.id)?.temporal;
    return dayNumber(m.start) !== null && m.start <= day && (!m.end || dayNumber(m.end) !== null && m.end >= day)
      && (!temporal?.startDate || temporal.startDate <= day) && (!temporal?.endDate || temporal.endDate >= day);
  });
  const active = new Set(current.map(family));
  const groups = new Map();
  for (const m of rows) {
    const key = family(m);
    if (!active.has(key) || m.start && m.start > day) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups].map(([key, members]) => {
    const present = current.filter(m => family(m) === key);
    const bodyId = present.slice().sort((a,b) => (b.start || '').localeCompare(a.start || '') || a.id.localeCompare(b.id))[0].id;
    const body = metadata.get(bodyId);
    const periods = [];
    for (const m of members.slice().sort((a,b) => (a.start || '').localeCompare(b.start || '') || (a.end || '9999').localeCompare(b.end || '9999') || a.role.localeCompare(b.role))) {
      const prior = periods.at(-1);
      // Merge only bounded, touching observations of the exact same role and
      // classification. Gaps, overlaps and unknown dates stay separate.
      const touching = prior && dayNumber(prior.start) !== null && dayNumber(prior.end) !== null && prior.end >= prior.start && (!m.end || dayNumber(m.end) !== null && m.end >= m.start) && dayNumber(m.start) === dayNumber(prior.end) + 1;
      const blocked = prior && members.some(other => other.role !== m.role && dayNumber(other.start) !== null && other.start <= m.start && (!other.end || other.end >= prior.end));
      const observation = {membershipId:m.membershipId || null, bodyId:m.id, role:m.role, classification:m.classification, start:m.start, end:m.end};
      if (touching && !blocked && prior.role === m.role && prior.classification === m.classification) {
        prior.end = m.end; prior.current ||= present.includes(m); prior.observations.push(observation);
      } else periods.push({role:m.role, classification:m.classification, start:m.start, end:m.end, current:present.includes(m), observations:[observation]});
    }
    return {id:bodyId, identity:key, code:body?.label || bodyId, names:body?.prefLabel || {}, roles:[...new Set(present.map(m => m.role))], periods:periods.reverse()};
  });
}

export function createCommitteeMembershipReader({request, budgetMs = 8000} = {}) {
  const rejectedBodies = new Set();
  const rejectBody = id => {
    rejectedBodies.delete(id); rejectedBodies.add(id);
    if (rejectedBodies.size > 256) rejectedBodies.delete(rejectedBodies.values().next().value);
  };
  return async function readCommitteeMemberships(profile, day, {signal:parentSignal} = {}) {
    parentSignal?.throwIfAborted();
    const memberships = (profile.memberships || []).filter(m => committeeClass.test(m.classification));
    const current = memberships.filter(m => committeeClass.test(m.classification) && dayNumber(m.start) !== null && m.start <= day && (!m.end || dayNumber(m.end) !== null && m.end >= day));
    const candidates = current.length ? [...new Set([...current, ...memberships].map(m => m.id))] : [];
    const ids = candidates.filter(id => /^[1-9]\d*$/.test(id));
    const selected = ids.slice(0, 64), bodies = [], sources = [];
    let cursor = 0, failed = ids.length > selected.length || candidates.length !== ids.length;
    const signal = AbortSignal.any([AbortSignal.timeout(budgetMs), ...(parentSignal ? [parentSignal] : [])]);
    await Promise.all(Array.from({length:Math.min(2, selected.length)}, async () => {
      while (cursor < selected.length) {
        const id = selected[cursor++];
        if (signal.aborted) { failed = true; break; }
        try {
          const record = await request('/corporate-bodies/' + id, {}, {signal, staleWhileRevalidate:true, force:rejectedBodies.has(id)});
          const body = record.payload?.data?.[0];
          if (record.payload?.data?.length !== 1 || String(body?.identifier) !== id || !committeeClass.test(tail(body.classification))) {
            rejectBody(id); throw Error('Committee identity unavailable');
          }
          bodies.push(body);
          sources.push({url:record.url, fetchedAt:new Date(record.fetchedAt).toISOString(), stale:Boolean(record.stale)});
          if (!identity(body) || memberships.some(m => m.id === id && m.classification !== tail(body.classification))) {rejectBody(id);failed = true;}
          else rejectedBodies.delete(id);
          if (record.stale || record.refreshError) failed = true;
        } catch { parentSignal?.throwIfAborted(); failed = true; }
      }
    }));
    parentSignal?.throwIfAborted();
    return {version:COMMITTEE_MEMBERSHIP_VERSION, day, items:committeeMemberships(memberships,bodies,day), complete:!failed,
      error:failed ? 'Some committee history is unavailable. Showing the available role periods.' : null, sources};
  };
}

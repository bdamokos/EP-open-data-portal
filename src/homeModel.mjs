// Pure home-page logic: which URL shows Home, the sitting headline, the
// default agenda week, agenda rows and the three vote picks. Dates are
// Brussels calendar days (YYYY-MM-DD) from plenaryAvailability.brusselsDate.

const dateShape = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z'));

// Home owns only the bare URL. Language and the shared global-search state
// travel with the reader; every other query parameter selects an explorer
// destination and keeps today's behaviour.
export function isHomeQuery(query) {
  for (const key of new Set(query.keys())) if (key !== 'lang' && !key.startsWith('global-fts-')) return false;
  return true;
}

const weekMonday = day => {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
};

const validWeeks = value => Array.isArray(value) && value.every(week => week && typeof week.week === 'string' && dateShape(week.week) && Array.isArray(week.sittings) && week.sittings.every(sitting => dateShape(sitting.date)));
const allSittings = weeks => weeks.flatMap(week => week.sittings);

// The plenary headline: sitting today, later this week, the next known date,
// or no future date at all. Weeks are held sittings; upcoming holds future
// ones. Both are newest-first like the vote-periods response.
export function headlineState(today, weeks = [], upcoming = []) {
  if (!dateShape(today)) return { case: 'unknown' };
  const future = allSittings(upcoming).filter(sitting => sitting.date >= today);
  const thisMonday = weekMonday(today);
  const inWeek = [...allSittings(weeks), ...future].filter(sitting => weekMonday(sitting.date) === thisMonday).sort((a, b) => a.date.localeCompare(b.date));
  const sittingToday = inWeek.find(sitting => sitting.date === today);
  if (sittingToday) return { case: 'sitting-today', city: sittingToday.location || null };
  const laterThisWeek = inWeek.find(sitting => sitting.date > today);
  if (laterThisWeek) return { case: 'sitting-later-this-week', city: laterThisWeek.location || null, nextDate: laterThisWeek.date };
  const next = future.sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next) return { case: 'next-known', city: next.location || null, nextDate: next.date };
  return { case: 'no-future-date' };
}

// With no agenda period the plenary view opens on the week containing today
// when it has sittings, otherwise the next week, otherwise the most recent.
export function defaultAgendaWeek(today, weeks = [], upcoming = []) {
  if (!dateShape(today)) return null;
  const thisMonday = weekMonday(today);
  const current = [...weeks, ...upcoming].find(week => week.week === thisMonday);
  if (current) return current.week;
  const next = [...upcoming].reverse().find(week => week.week > thisMonday);
  if (next) return next.week;
  return weeks[0]?.week || null;
}

// Agenda rows for the current or next sitting week, grouped by day in order.
// A week in progress starts at today. Times are not part of the published
// agenda response, so rows carry none.
export function agendaRows(topics, today, limit = 8) {
  const valid = (Array.isArray(topics) ? topics : []).filter(topic => topic && typeof topic.id === 'string' && dateShape(topic.date));
  const days = new Map();
  for (const topic of valid) {
    if (topic.date < today) continue;
    if (!days.has(topic.date)) days.set(topic.date, []);
    days.get(topic.date).push(topic);
  }
  const rows = [];
  for (const date of [...days.keys()].sort()) {
    const items = days.get(date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    for (const topic of items) {
      rows.push({ day: date, topic });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

const voteTotals = vote => (vote && vote.namedVotersAvailable && vote.aggregateTotals && ['for', 'against', 'abstaining'].every(position => Number.isFinite(vote.aggregateTotals[position]))) ? vote.aggregateTotals : null;

const voteMargin = totals => Math.abs(totals.for - totals.against);

// Three fixed picks from one sitting's roll-calls: the closest whole-text
// vote, the vote with the most members differing from their group, and the
// most recent final vote. Only votes with published named totals qualify; a
// missing rule (no group deviation data) yields no pick.
export function votePicks(votes, finalTextVoteIds = []) {
  const candidates = (Array.isArray(votes) ? votes : []).map(vote => ({ vote, totals: voteTotals(vote) })).filter(row => row.totals);
  const finals = new Set(finalTextVoteIds);
  const finalRows = candidates.filter(row => finals.has(row.vote.id));
  const byRecency = (a, b) => b.vote.date.localeCompare(a.vote.date) || b.vote.id.localeCompare(a.vote.id);
  const picks = [];
  const closest = finalRows.slice().sort((a, b) => voteMargin(a.totals) - voteMargin(b.totals) || byRecency(a, b))[0];
  if (closest) picks.push({ rule: 'closest', vote: closest.vote, totals: closest.totals });
  const divergent = candidates.filter(row => Number.isFinite(row.vote.groupDeviations)).sort((a, b) => b.vote.groupDeviations - a.vote.groupDeviations || byRecency(a, b))[0];
  if (divergent && divergent.vote.groupDeviations > 0) picks.push({ rule: 'divergent', vote: divergent.vote, totals: divergent.totals });
  const recent = finalRows.slice().sort(byRecency)[0];
  if (recent && !picks.some(pick => pick.vote.id === recent.vote.id)) picks.push({ rule: 'recent', vote: recent.vote, totals: recent.totals });
  return picks;
}

// Rows of unread updates from browser-local following data, newest first.
export function unreadRows(items, now) {
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    const entries = (item && Array.isArray(item.entries) ? item.entries : []).filter(entry => entry && entry.readAt === null && Number.isFinite(entry.discoveredAt) && entry.discoveredAt + 24 * 60 * 60 * 1000 > now);
    for (const entry of entries) rows.push({ item, entry });
  }
  return rows.sort((a, b) => b.entry.discoveredAt - a.entry.discoveredAt || String(b.entry.date || '').localeCompare(String(a.entry.date || '')));
}

// Member states for the "Find your MEPs" control (Greece is EL in the directory).
export const HOME_COUNTRIES = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','EL','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];

// A procedure reference only when the row has exactly one id of the exact
// published year-number shape; anything else shows none.
export function procedureReference(ids) {
  if (!Array.isArray(ids) || ids.length !== 1) return null;
  const match = /^(\d{4})-(\d{4})$/.exec(ids[0]);
  return match ? match[1] + '/' + match[2] : null;
}

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

// Agenda grouped by day, in published order, starting today for a week in
// progress. Each day shows at most perDay rows; `more` counts the rest.
// Times are not part of the published agenda list, so rows carry none.
export function agendaDays(topics, today, perDay = 4) {
  const valid = (Array.isArray(topics) ? topics : []).filter(topic => topic && typeof topic.id === 'string' && dateShape(topic.date) && topic.date >= today);
  const days = new Map();
  for (const topic of valid) {
    if (!days.has(topic.date)) days.set(topic.date, []);
    days.get(topic.date).push(topic);
  }
  return [...days.keys()].sort().map(day => {
    const items = days.get(day).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    return { day, rows: items.slice(0, perDay), more: Math.max(0, items.length - perDay), sittingId: items.find(topic => topic.sittingId)?.sittingId || null };
  });
}

const validVote = vote => vote && typeof vote.id === 'string' && typeof vote.date === 'string' && vote.totals && ['for', 'against', 'abstaining'].every(position => Number.isInteger(vote.totals[position]) && vote.totals[position] >= 0);
const margin = vote => Math.abs(vote.totals.for - vote.totals.against);
const newer = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

// Up to three cards from /api/latest-results votes (whole-text roll calls with
// published totals): the closest (smallest for-against margin), the biggest
// split from group, and the most recent. A vote fills at most one card, in that
// order; a rule whose best vote is already shown yields no card.
export function votePicks(votes) {
  const rows = (Array.isArray(votes) ? votes : []).filter(validVote);
  const picks = [];
  const add = (rule, vote) => { if (vote && !picks.some(pick => pick.vote.id === vote.id)) picks.push({ rule, vote }); };
  add('closest', rows.slice().sort((a, b) => margin(a) - margin(b) || newer(a, b))[0]);
  const split = rows.filter(vote => Number.isFinite(vote.differing) && vote.differing > 0).sort((a, b) => b.differing - a.differing || newer(a, b))[0];
  add('split', split);
  add('recent', rows.slice().sort(newer)[0]);
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

// A date inside a Home message is formatted in the locale the message text
// actually came from, so an English fallback sentence never carries a
// Hungarian date. `ui.messageLocale(id)` names that locale.
export const longDate = (value, locale) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }).format(new Date(value + 'T12:00:00Z'));

// The headline sentence and the language it is written in.
export function headlineLine(ui, headline) {
  const city = headline.city;
  const pick = (withCity, plain) => (city ? withCity : plain);
  const id = {
    'sitting-today': pick('home.headline.today_city', 'home.headline.today_plain'),
    'sitting-later-this-week': pick('home.headline.later_city', 'home.headline.later_plain'),
    'next-known': pick('home.headline.next_city', 'home.headline.next_plain'),
  }[headline.case] || 'home.headline.none';
  const locale = ui.messageLocale(id);
  const values = {};
  if (city) values.city = city;
  if (headline.nextDate) values.date = longDate(headline.nextDate, locale);
  return { text: ui.t(id, values), locale };
}

// Debate words that say nothing about a topic. Kept short and explicit: these
// are the filler terms that lead a real week's cloud ("time", "debate",
// "proposal", "business") and carry no subject. Matched on the stemmed form.
const GENERIC_TERMS = ['time', 'debate', 'proposal', 'business', 'vote', 'report', 'start', 'life', 'single', 'left', 'public', 'political', 'solution', 'deliver', 'reduce', 'essential', 'rules'];
const stem = word => word.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1');
const stems = name => name.toLowerCase().split(/\s+/).filter(Boolean).map(stem);
const contains = (outer, inner) => outer.length > inner.length && outer.some((_, start) => inner.every((word, i) => outer[start + i] === word));

// Speech-cloud words, most used first, reduced to subject terms: generic words,
// plural duplicates and terms already inside a longer shown phrase are dropped.
// Up to eight; none when fewer than four remain.
export function homeTerms(words) {
  const seen = new Set(), kept = [];
  for (const word of Array.isArray(words) ? words : []) {
    if (kept.length === 8) break;
    const name = String(word?.label || word?.word || '').replace(/-/g, ' ').trim();
    if (!name) continue;
    const parts = stems(name), key = parts.join(' ');
    if (parts.length === 1 && GENERIC_TERMS.map(stem).includes(parts[0]) || seen.has(key) || kept.some(other => contains(other.parts, parts))) continue;
    seen.add(key);
    kept.push({ name, parts });
  }
  const terms = kept.filter(term => !kept.some(other => contains(other.parts, term.parts))).map(term => term.name);
  return terms.length >= 4 ? terms : [];
}

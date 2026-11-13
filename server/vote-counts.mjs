const FIELDS = {for: 'number_of_votes_favor', against: 'number_of_votes_against', abstaining: 'number_of_votes_abstention'};
const count = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

/** A decision's three vote counts, null where unknown.
 * ODP leaves a count out when it is zero: no decision in the 2024–2026 sittings
 * carries an explicit 0, and number_of_attendees equals the sum of the three on
 * every decision that publishes all of them. So when the published counts add
 * up to number_of_attendees, an omitted count is 0. Without that proof, or when
 * no count is published (show of hands), an omitted count stays unknown. */
export function voteCounts(raw) {
  const totals = Object.fromEntries(Object.entries(FIELDS).map(([position, field]) => [position, count(raw?.[field])]));
  const attendees = count(raw?.number_of_attendees);
  const published = Object.values(totals).filter(value => value !== null);
  const omitted = Object.entries(FIELDS).filter(([position]) => totals[position] === null);
  if (attendees === null || !published.length || !omitted.length) return totals;
  // Present but malformed is not an omission.
  if (omitted.some(([, field]) => raw[field] !== undefined && raw[field] !== null)) return totals;
  if (published.reduce((sum, value) => sum + value, 0) !== attendees) return totals;
  return Object.fromEntries(Object.entries(totals).map(([position, value]) => [position, value ?? 0]));
}

/** voteCounts in the source's own field names, for code that keeps them. */
export function voteCountFields(raw) {
  const totals = voteCounts(raw);
  return Object.fromEntries(Object.entries(FIELDS).map(([position, field]) => [field, totals[position]]));
}

const VOTERS = {for: 'had_voter_favor', against: 'had_voter_against', abstaining: 'had_voter_abstention'};
/** A position's named-voter list. ODP drops the empty list along with its zero
 * count, so an absent list is empty exactly when voteCounts proves the count 0;
 * otherwise the source value is returned unchanged. */
export function namedVoters(raw, position) {
  const value = raw?.[VOTERS[position]];
  return value === undefined && voteCounts(raw)[position] === 0 && raw[FIELDS[position]] === undefined ? [] : value;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { votingAliases, resolveAmendmentAuthors } from './amendment-authors.mjs';

const source = { sittingDate: '2024-11-14', fetchedAt: '2026-10-16T12:00:00Z', sourceUrl: 'https://data.europarl.europa.eu/distribution/reds_iPlPv_Rcv/PV-10-2024-11-14-RCV/PV-10-2024-11-14-RCV-FNL_en.xml' };
const voter = (alias, personId, mepId) => `<PoliticalGroup.Member.Name PersId="${personId}" MepId="${mepId}">${alias}</PoliticalGroup.Member.Name>`;
const result = body => `<RollCallVote.Result Identifier="170466"><Result.For><Result.PoliticalGroup.List Identifier="EPP">${body}</Result.PoliticalGroup.List></Result.For></RollCallVote.Result>`;
const document = body => `<PV.RollCallVoteResults Sitting.Date="2024-11-14">${body}</PV.RollCallVoteResults>`;
const members = [
  { id: 257033, givenName: 'Niels Flemming', familyName: 'Hansen', mandates: [{ start: '2024-07-16', end: null }] },
  { id: 193419, givenName: 'Christophe', familyName: 'Hansen', mandates: [{ start: '2024-07-16', end: '2024-11-30' }] },
  { id: 261797, givenName: 'Christophe', familyName: 'Bay', mandates: [{ start: '2026-10-01', end: null }] },
  { id: 124760, givenName: 'Nicolas', familyName: 'Bay', mandates: [{ start: '2024-07-16', end: null }] },
];
const sample = document(result(voter('Hansen', 257033, 7595) + voter('Hansen Christophe', 193419, 6777)) + result(voter('Hansen', 257033, 7595)));

test('reads actual voter aliases and keeps PersId distinct from MepId, with source evidence', () => {
  const aliases = votingAliases(sample, source);
  assert.deepEqual(aliases, [
    { alias: 'Hansen', personId: 257033, mepId: 7595, ...source },
    { alias: 'Hansen Christophe', personId: 193419, mepId: 6777, ...source },
  ]);
  const baySource = { ...source, sittingDate: '2026-10-08' };
  assert.equal(votingAliases(document(result(voter('Bay Christophe', 261797, 7764))).replaceAll('2024-11-14', '2026-10-08'), baySource)[0].personId, 261797);
});

test('corrections, intentions and unrelated matching tag names cannot add identities', () => {
  const xml = document(result(voter('Hansen', 257033, 7595) + '<PoliticalGroup.Member.Name MepId="123456">No official person ID</PoliticalGroup.Member.Name>') + `<Vote.Corrections>${voter('Invented', 9999, 999)}</Vote.Corrections><Vote.Intentions><Member.Name PersId="8888">Another</Member.Name></Vote.Intentions>${voter('Outside roll calls', 7777, 777)}`);
  assert.deepEqual(votingAliases(xml, source).map(alias => alias.personId), [257033]);
});

test('rejects conflicting aliases, malformed XML, declarations, untrusted provenance and date mismatch', () => {
  for (const conflicting of [voter('Hansen', 193419, 6777), voter('HANSEN', 257033, 1111)]) {
    assert.throws(() => votingAliases(document(result(voter('Hansen', 257033, 7595) + conflicting)), source), { code: 'conflicting_voting_alias' });
  }
  for (const xml of ['<broken>', '<html><body>Not voting data</body></html>', '<error>Unavailable</error>', '<!DOCTYPE x><x/>', '<!ENTITY x "test"><x/>', '<x>' + 'a'.repeat(32 * 1024 * 1024) + '</x>']) {
    assert.throws(() => votingAliases(xml, source), { code: 'invalid_voting_xml' });
  }
  assert.throws(() => votingAliases(sample, { ...source, sittingDate: '2024-11-15' }), { code: 'invalid_sitting_date' });
  assert.throws(() => votingAliases(sample, { ...source, sittingDate: '2024-02-30' }), { code: 'invalid_sitting_date' });
  assert.throws(() => votingAliases(sample, { ...source, sourceUrl: 'https://example.com/votes.xml' }), { code: 'invalid_alias_source' });
  assert.deepEqual(votingAliases('<PV.RollCallVoteResults/>', source), []);
  assert.deepEqual(votingAliases('<PV.RollCallVoteResults>\n </PV.RollCallVoteResults>', source), []);
  assert.deepEqual(votingAliases(document(''), source), []);
});

test('resolves simultaneous surname homonyms only through exact names or dated official aliases', () => {
  const resolved = resolveAmendmentAuthors(['Hansen', 'Hansen Christophe', 'Christophe Hansen', 'Bay'], { members, aliases: votingAliases(sample, source), date: '2024-11-14' });
  assert.deepEqual(resolved.map(author => [author.personId, author.status]), [[257033, 'resolved'], [193419, 'resolved'], [193419, 'resolved'], [null, 'missing']]);
  assert.equal(resolved[0].method, 'official_voting_alias_active_mandate');
  assert.equal(resolved[0].evidence[0].sourceUrl, source.sourceUrl);
  assert.equal(resolved[0].evidence[0].fetchedAt, source.fetchedAt);
  assert.equal(resolved[0].evidence[0].date, '2024-11-14');
  assert.equal(resolved[2].method, 'exact_full_name_active_mandate');
});

test('uses complete compound names, Unicode NFC and whitespace without dropping accents or particles', () => {
  const member = { id: 257043, givenName: 'Maravillas', familyName: 'Abadía Jover', mandates: [{ start: '2024-07-16' }] };
  const names = ['  MARAVILLAS  ABADI\u0301A JOVER  ', 'Maravillas Jover', 'Maravillas Abadia Jover', 'Jover'];
  const authors = resolveAmendmentAuthors(names, { members: [member], date: '2024-11-14' });
  assert.deepEqual(authors.map(author => author.status), ['resolved', 'missing', 'missing', 'missing']);
  assert.equal(authors[0].name, names[0]);
});

test('complete family-given names resolve across dates while abbreviated aliases need an explicit validity interval', () => {
  const aliases = votingAliases(sample, source);
  const reversed = resolveAmendmentAuthors(['Hansen Christophe'], { members, aliases, date: '2024-11-15' })[0];
  assert.equal(reversed.personId, 193419);
  assert.equal(reversed.method, 'exact_full_name_active_mandate');
  const intervalAlias = { ...aliases[0], validFrom: '2024-07-16', validTo: '2024-11-30' };
  const inInterval = resolveAmendmentAuthors(['Hansen'], { members, aliases: [intervalAlias], date: '2024-11-15' })[0];
  assert.equal(inInterval.personId, 257033);
  assert.equal(inInterval.evidence[0].dateValidity, 'explicit_interval');
  assert.equal(inInterval.evidence[0].sourceUrl, source.sourceUrl);
  assert.equal(inInterval.evidence[0].validFrom, '2024-07-16');
  assert.equal(resolveAmendmentAuthors(['Hansen'], { members, aliases: [intervalAlias], date: '2024-12-01' })[0].status, 'missing');
  assert.equal(resolveAmendmentAuthors(['Hansen'], { members, aliases: [{ ...intervalAlias, validFrom: '2024-02-30' }], date: '2024-11-15' })[0].status, 'missing');
});

test('explicitly related sittings allow dated aliases without inventing a validity interval', () => {
  const alias = { ...votingAliases(sample, source)[0], sittingDate: '2026-10-08', sourceUrl: 'https://data.europarl.europa.eu/distribution/doc/PV-10-2026-10-08-RCV_en.xml' };
  const context = { members, aliases: [alias], date: '2026-10-02', relatedSittingDates: ['2026-10-08'] };
  const resolved = resolveAmendmentAuthors(['Hansen'], context)[0];
  assert.equal(resolved.personId, 257033);
  assert.equal(resolved.evidence[0].dateValidity, 'related_sitting');
  assert.equal(resolved.evidence[0].date, '2026-10-02');
  assert.equal(resolved.evidence[0].sittingDate, '2026-10-08');
  assert.equal(resolved.evidence[0].validFrom, undefined);
  assert.equal(resolveAmendmentAuthors(['Hansen'], { ...context, relatedSittingDates: ['2026-10-07'] })[0].status, 'missing');
  assert.equal(resolveAmendmentAuthors(['Hansen'], { ...context, date: '2023-10-02' })[0].status, 'inactive');
  const conflict = { ...alias, personId: 124760, sittingDate: '2026-10-07' };
  assert.equal(resolveAmendmentAuthors(['Hansen'], { ...context, aliases: [alias, conflict], relatedSittingDates: ['2026-10-07', '2026-10-08'] })[0].status, 'ambiguous');
});

test('mandates disambiguate reused full names but overlapping active identities stay ambiguous', () => {
  const matching = [
    { id: 1, givenName: 'Alex', familyName: 'Example', mandates: [{ start: '2019-07-02', end: '2024-07-15' }] },
    { id: 2, givenName: 'Alex', familyName: 'Example', mandates: [{ start: '2024-07-16' }] },
  ];
  const resolve = list => resolveAmendmentAuthors(['Alex Example'], { members: list, date: '2024-11-14' })[0];
  assert.equal(resolve(matching).personId, 2);
  assert.equal(resolve(matching.map(member => ({ ...member, mandates: [{ start: '2024-07-16' }] }))).status, 'ambiguous');
  assert.equal(resolve([...matching, { id: 3, givenName: 'Alex', familyName: 'Example' }]).status, 'ambiguous');
});

test('official profile parliamentary memberships count, committee memberships do not', () => {
  const profile = { identifier: '257113', givenName: 'Antonella', familyName: 'Sberna', hasMembership: [
    { role: 'def/ep-roles/MEMBER', memberDuring: { startDate: '2020-01-01' } },
    { role: 'def/ep-roles/MEMBER_PARLIAMENT', memberDuring: { startDate: '2024-07-16' } },
  ] };
  assert.equal(resolveAmendmentAuthors(['Antonella Sberna'], { members: [profile], date: '2025-05-19' })[0].personId, 257113);
  assert.equal(resolveAmendmentAuthors(['Antonella Sberna'], { members: [profile], date: '2023-01-01' })[0].status, 'inactive');
});

test('unavailable dates, mandates, unknown names and other-day aliases remain explicit gaps', () => {
  const aliases = votingAliases(sample, source);
  const otherDay = resolveAmendmentAuthors(['Hansen'], { members, aliases, date: '2024-11-15' })[0];
  assert.equal(otherDay.status, 'missing');
  assert.equal(otherDay.evidence[0].reason, 'missing_alias_date');
  assert.equal(resolveAmendmentAuthors(['Niels Flemming Hansen'], { members, aliases })[0].status, 'missing_date');
  assert.equal(resolveAmendmentAuthors(['Niels Flemming Hansen'], { members: [{ id: 257033, givenName: 'Niels Flemming', familyName: 'Hansen' }], date: '2024-11-14' })[0].status, 'missing_mandate');
  assert.equal(resolveAmendmentAuthors(['Christophe Hansen'], { members, date: '2024-12-01' })[0].status, 'inactive');
  assert.equal(resolveAmendmentAuthors(['Christophe Hansen'], { members, date: '2024-11-30' })[0].status, 'resolved');
  assert.equal(resolveAmendmentAuthors(['Unknown Person'], { members, date: '2024-11-14' })[0].status, 'missing');
});

test('conflicting sourced aliases and conflicting full-name/alias evidence stay ambiguous', () => {
  const alias = votingAliases(sample, source)[0];
  const aliases = [alias, { ...alias, personId: 193419 }];
  assert.equal(resolveAmendmentAuthors(['Hansen'], { members, aliases, date: source.sittingDate })[0].status, 'ambiguous');
  const nameConflict = { ...alias, alias: 'Christophe Hansen' };
  assert.equal(resolveAmendmentAuthors(['Christophe Hansen'], { members, aliases: [nameConflict], date: source.sittingDate })[0].status, 'ambiguous');
  assert.equal(resolveAmendmentAuthors(['Hansen'], { members, aliases: [{ ...alias, sourceUrl: 'https://example.com' }], date: source.sittingDate })[0].status, 'missing');
});

import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_XML_BYTES = 32 * 1024 * 1024;
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const normalized = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und') : '';
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false });

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value ? value : null;
}
function id(value) {
  const raw = typeof value === 'object' ? value?.id : value;
  const digits = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.replace(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\//, '') : '';
  const number = /^[1-9]\d*$/.test(digits) ? Number(digits) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}
function officialUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['data.europarl.europa.eu', 'www.europarl.europa.eu'].includes(url.hostname) && !url.port && !url.username && !url.password;
  } catch { return false; }
}
function timestamp(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) || (typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value)));
}
function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// Only the announced roll-call voter lists establish this crosswalk. Corrections,
// intentions and bare Member.Name nodes cannot introduce an identity or a vote.
export function votingAliases(xml, { sourceUrl, fetchedAt, sittingDate } = {}) {
  if (!officialUrl(sourceUrl) || !timestamp(fetchedAt)) throw failure('invalid_alias_source', 'Voting aliases require an official source URL and retrieval timestamp.');
  if (!day(sittingDate)) throw failure('invalid_sitting_date', 'Voting aliases require a valid sitting date.');
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw failure('invalid_voting_xml', 'Voting XML is unsafe or exceeds the supported size.');
  let root;
  try {
    if (XMLValidator.validate(xml) !== true) throw new Error('Invalid XML');
    root = parser.parse(xml)['PV.RollCallVoteResults'];
  } catch { throw failure('invalid_voting_xml', 'Voting XML is malformed.'); }
  const emptyRoot = typeof root === 'string' && !root.trim();
  if (root == null || Array.isArray(root) || (typeof root !== 'object' && !emptyRoot)) throw failure('invalid_voting_xml', 'Voting XML has no valid roll-call results root.');
  if (emptyRoot) return [];
  if (root['@_Sitting.Date'] && root['@_Sitting.Date'] !== sittingDate) throw failure('invalid_sitting_date', 'Voting XML and requested sitting dates differ.');
  const aliases = new Map();
  for (const result of array(root['RollCallVote.Result'])) {
    for (const key of ['Result.For', 'Result.Against', 'Result.Abstention']) {
      for (const group of array(result?.[key]?.['Result.PoliticalGroup.List'])) {
        for (const voter of array(group?.['PoliticalGroup.Member.Name'])) {
          const alias = typeof voter?.['#text'] === 'string' ? voter['#text'].trim().replace(/\s+/gu, ' ') : '';
          const personId = id(voter?.['@_PersId']);
          const mepId = id(voter?.['@_MepId']);
          if (!alias || !personId) continue;
          const previous = aliases.get(normalized(alias));
          if (previous && (previous.personId !== personId || (previous.mepId && mepId && previous.mepId !== mepId))) throw failure('conflicting_voting_alias', 'Voting XML assigns conflicting identities to the same alias.');
          if (!previous || (!previous.mepId && mepId)) aliases.set(normalized(alias), { alias, personId, mepId, sittingDate, sourceUrl, fetchedAt });
        }
      }
    }
  }
  return [...aliases.values()];
}

function mandatePeriods(member) {
  const periods = [
    ...array(member?.mandates).map(period => ({ start: period?.start ?? period?.startDate, end: period?.end ?? period?.endDate ?? null })),
    ...array(member?.hasMembership).filter(membership => /(?:^|\/)MEMBER_PARLIAMENT$/.test(String(membership?.role?.id || membership?.role || ''))).map(membership => ({ start: membership?.memberDuring?.startDate, end: membership?.memberDuring?.endDate ?? null })),
  ];
  return periods.filter(period => day(period.start) && (!period.end || day(period.end)) && (!period.end || period.end >= period.start));
}
function evidenceForMember(member, date, matchType) {
  const periods = mandatePeriods(member);
  const active = periods.find(period => period.start <= date && (!period.end || period.end >= date));
  return {
    type: matchType, personId: id(member?.id ?? member?.identifier), date,
    givenName: member?.givenName || '', familyName: member?.familyName || '',
    mandates: periods, activeMandate: active || null,
    ...(member?.sourceUrl ? { sourceUrl: member.sourceUrl } : {}),
    ...(member?.fetchedAt != null ? { fetchedAt: member.fetchedAt } : {}),
  };
}
function fullNameMatches(member, key) {
  return Boolean(member?.givenName && member?.familyName && [
    `${member.givenName} ${member.familyName}`,
    `${member.familyName} ${member.givenName}`,
  ].some(value => normalized(value) === key));
}
function aliasValidity(alias, date, relatedSittingDates) {
  if (alias.sittingDate === date) return 'sitting_date';
  if (relatedSittingDates.has(alias.sittingDate)) return 'related_sitting';
  if (day(alias.validFrom) && day(alias.validTo) && alias.validFrom <= alias.validTo && alias.validFrom <= date && date <= alias.validTo) return 'explicit_interval';
  return null;
}

// Full names preserve compound surnames, diacritics and punctuation. A voting
// alias needs its recorded sitting date, an explicitly related sitting, or an
// externally evidenced validity interval. Callers must establish related
// sittings through exact document/vote-parent links, never date proximity.
// Complete given/family or family/given names can match the roster.
// The returned person ID is a derived authorship link, never API authorship data.
export function resolveAmendmentAuthors(names, { members = [], aliases = [], date, relatedSittingDates = [] } = {}) {
  const relatedDates = new Set(array(relatedSittingDates).filter(value => day(value)));
  const validMembers = array(members).filter(member => id(member?.id ?? member?.identifier));
  const memberMap = new Map();
  for (const member of validMembers) {
    const personId = id(member.id ?? member.identifier);
    if (!memberMap.has(personId)) memberMap.set(personId, []);
    memberMap.get(personId).push(member);
  }
  const validAliases = array(aliases).filter(alias => id(alias?.personId) && normalized(alias?.alias) && day(alias?.sittingDate) && officialUrl(alias?.sourceUrl) && timestamp(alias?.fetchedAt));
  return array(names).map(name => {
    const base = { name, personId: null, method: null, evidence: [], status: 'missing' };
    if (!day(date)) return { ...base, status: 'missing_date' };
    const key = normalized(name);
    if (!key) return base;
    const fullMatches = validMembers.filter(member => fullNameMatches(member, key));
    const aliasMatches = validAliases.filter(alias => normalized(alias.alias) === key);
    const datedAliases = aliasMatches.filter(alias => aliasValidity(alias, date, relatedDates));
    const candidateEvidence = fullMatches.map(member => evidenceForMember(member, date, 'full_name'));
    for (const alias of datedAliases) {
      const matchingMembers = memberMap.get(id(alias.personId)) || [];
      const memberEvidence = matchingMembers.map(member => evidenceForMember(member, date, 'mandate'));
      candidateEvidence.push({
        type: 'voting_alias', ...alias, personId: id(alias.personId), date, dateValidity: aliasValidity(alias, date, relatedDates),
        mandates: memberEvidence.flatMap(item => item.mandates),
        activeMandate: memberEvidence.find(item => item.activeMandate)?.activeMandate || null,
      });
    }
    const allIds = [...new Set(candidateEvidence.map(item => item.personId))];
    const activeIds = [...new Set(candidateEvidence.filter(item => item.activeMandate).map(item => item.personId))];
    if (new Set(datedAliases.map(alias => id(alias.personId))).size > 1 || activeIds.length > 1) return { ...base, evidence: candidateEvidence, status: 'ambiguous' };
    if (activeIds.length === 1) {
      const personId = activeIds[0];
      // A name match without a mandate is still an unresolved competing identity.
      if (candidateEvidence.some(item => item.personId !== personId && !item.mandates.length)) return { ...base, evidence: candidateEvidence, status: 'ambiguous' };
      const method = candidateEvidence.some(item => item.personId === personId && item.type === 'full_name' && item.activeMandate) ? 'exact_full_name_active_mandate' : 'official_voting_alias_active_mandate';
      return { ...base, personId, method, evidence: candidateEvidence, status: 'resolved' };
    }
    if (allIds.length) return { ...base, evidence: candidateEvidence, status: candidateEvidence.some(item => !item.mandates.length) ? 'missing_mandate' : 'inactive' };
    return { ...base, evidence: aliasMatches.map(alias => ({ type: 'voting_alias', ...alias, date, reason: 'missing_alias_date' })) };
  });
}

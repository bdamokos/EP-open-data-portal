const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const BASE = 'https://data.europarl.europa.eu/';
const SUPPORTED = new Set(['QUESTION_WRITTEN', 'QUESTION_WRITTEN_PRIORITY', 'QUESTION_ORAL', 'RESOLUTION_MOTION', 'RESOLUTION_MOTION_JOINT', 'QUESTION_RESOLUTION_MOTION']);

function reference(value) {
  const text = typeof value === 'string' ? value : value?.id;
  if (typeof text !== 'string') return null;
  if (!text.includes('://')) return text;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'data.europarl.europa.eu' || url.port || url.username || url.password || url.search || url.hash) return null;
    return url.pathname.slice(1);
  } catch { return null; }
}
function personId(value) {
  const match = reference(value)?.match(/^person\/([1-9]\d*)$/);
  const id = match && Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

// These are document creators/explicit AUTHOR participants, never a name search.
// Organizations and rapporteur-only participations cannot introduce a MEP author.
export function documentAuthorIdentities(work) {
  const type = reference(work?.work_type)?.replace(/^def\/ep-document-types\//, '');
  if (!SUPPORTED.has(type)) return [];
  const authors = new Map();
  const add = (value, relationship) => {
    const id = personId(value);
    if (!id) return;
    if (!authors.has(id)) authors.set(id, { id, relationships: [] });
    const paths = authors.get(id).relationships;
    if (!paths.includes(relationship)) paths.push(relationship);
  };
  array(work.creator).forEach(value => add(value, 'creator'));
  array(work.workHadParticipation).forEach((participation, index) => {
    if (reference(participation?.participation_role) !== 'def/ep-roles/AUTHOR') return;
    array(participation.had_participant_person).forEach(value => add(value, `workHadParticipation[${index}].had_participant_person (AUTHOR)`));
  });
  return [...authors.values()];
}

export function documentCoAuthors(work, { members = [], selectedDocumentId, documentApiUrl, documentFetchedAt, rosterFetchedAt = null } = {}) {
  const sourceDocumentId = work.identifier || reference(work.id)?.split('/').at(-1);
  const role = selectedDocumentId?.endsWith('-ASW') ? 'QUESTION_AUTHOR' : 'AUTHOR';
  const roster = new Map(members.flatMap(member => {
    const id = Number(member.id);
    return Number.isSafeInteger(id) && id > 0 ? [[id, member]] : [];
  }));
  const coAuthors = documentAuthorIdentities(work).map(author => {
    const member = roster.get(author.id);
    const name = typeof member?.name === 'string' && member.name.trim() ? member.name.trim() : null;
    return { ...author, name, personUri: BASE + 'person/' + author.id, profileAvailable: Boolean(member && name), role, sourceDocumentId };
  });
  return { coAuthors, coAuthorSource: { documentApiUrl, documentFetchedAt, rosterApiUrl: BASE + 'api/v2/meps/show-current', rosterFetchedAt } };
}

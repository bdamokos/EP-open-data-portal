const whitespace = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const english = language => typeof language === 'string' && /^en(?:-|$)/i.test(language);
const result = (status, reason, fields = {}) => ({
  status, paragraphs: [], basis: null, relation: null, quoteMatches: null, reason, ...fields,
});
// Keep source normalization and every quote-candidate scan bounded independently
// of how many blank or repeated paragraphs a published document contains.
const MATCH_LIMITS = Object.freeze({
  paragraphs: 10_000,
  sourceCharacters: 4 * 1024 * 1024,
  quoteCharacters: 64 * 1024,
  referenceCharacters: 1024,
  quoteSteps: 100_000,
  comparedCharacters: 16 * 1024 * 1024,
});

function exceedsInputBudget(text, {originalText, targetLabel, referenceText}) {
  if (typeof originalText === 'string' && originalText.length > MATCH_LIMITS.quoteCharacters) return true;
  if ([targetLabel, referenceText].some(value => typeof value === 'string' && value.length > MATCH_LIMITS.referenceCharacters)) return true;
  if (!Array.isArray(text?.paragraphs)) return false;
  if (text.paragraphs.length > MATCH_LIMITS.paragraphs) return true;
  let characters = 0;
  for (const value of text.paragraphs) {
    if (typeof value === 'string') characters += value.length;
    if (characters > MATCH_LIMITS.sourceCharacters) return true;
  }
  return false;
}

function sourceStructure(text) {
  if (text?.structureStatus !== 'extracted' || !Array.isArray(text.paragraphs)
    || !Array.isArray(text.paragraphSources) || text.paragraphs.length !== text.paragraphSources.length) return null;
  let previousOrdinal = -1;
  const paths = new Set();
  const rows = [];
  for (let index = 0; index < text.paragraphs.length; index++) {
    const source = text.paragraphSources[index], value = text.paragraphs[index];
    if (typeof value !== 'string' || !source || typeof source !== 'object'
      || typeof source.path !== 'string' || !source.path || paths.has(source.path)
      || !Number.isSafeInteger(source.ordinal) || source.ordinal <= previousOrdinal
      || !['body', 'table-cell', 'other'].includes(source.container)
      || typeof source.containerPath !== 'string' || !source.containerPath
      || !((typeof source.segment === 'string' && source.segment.length > 0)
        || (typeof source.segment === 'number' && Number.isSafeInteger(source.segment)))
      || typeof source.complete !== 'boolean') return null;
    previousOrdinal = source.ordinal;
    paths.add(source.path);
    rows.push({index, source, value, normal: whitespace(value), complete: source.complete && !value.includes('\uFFFC')});
  }
  return rows;
}

function consecutive(left, right) {
  return left.source.container === right.source.container
    && left.source.containerPath === right.source.containerPath
    && left.source.segment === right.source.segment
    && right.source.ordinal === left.source.ordinal + 1;
}

function quotedTargets(rows, quote) {
  if (!quote) return [];
  const matches = [];
  let steps = 0, comparedCharacters = 0;
  for (let start = 0; start < rows.length; start++) {
    const first = rows[start];
    if (!first.complete || first.source.container === 'other' || !first.normal) continue;
    let accumulated = '';
    for (let end = start; end < rows.length; end++) {
      if (++steps > MATCH_LIMITS.quoteSteps) return null;
      const row = rows[end];
      if (!row.complete || row.source.container === 'other' || (end > start && !consecutive(rows[end - 1], row))) break;
      // Charge the growing prefix before allocating, trimming or comparing it.
      // Counting characters as well as iterations bounds long repeated prefixes.
      comparedCharacters += 4 * (accumulated.length + row.normal.length + 1);
      if (comparedCharacters > MATCH_LIMITS.comparedCharacters) return null;
      accumulated = accumulated ? `${accumulated} ${row.normal}`.trim() : row.normal;
      if (accumulated === quote) {
        matches.push(rows.slice(start, end + 1).map(item => item.index));
        break;
      }
      if (!quote.startsWith(accumulated)) break;
    }
  }
  return matches;
}

const referenceKey = reference => reference.kind === 'point'
  ? `paragraph:${reference.number}/point:${reference.point}`
  : `${reference.kind}:${reference.number ?? reference.letter}`;

function parseReference(value) {
  const literal = whitespace(value);
  if (!literal || /\(\s*new\s*\)/i.test(literal)) return null;
  const text = literal.replace(/\.$/, '');
  let match = /^(after|before)\s+recital\s+([a-z]{1,3})$/i.exec(text);
  if (match) return {kind: 'recital', letter: match[2].toUpperCase(), relation: match[1].toLowerCase()};
  match = /^(?:paragraph\s+|§\s*)([1-9]\d{0,5})\s*(?:[,–—-]\s*)?(after|before)\s+point\s+([a-z]{1,4}|\([a-z]{1,4}\))$/i.exec(text);
  if (match) return {kind: 'point', number: match[1], point: match[3].replace(/[()]/g, '').toLowerCase(), relation: match[2].toLowerCase()};
  match = /^(after|before)\s+(?:paragraph\s+|§\s*)([1-9]\d{0,5})$/i.exec(text);
  if (match) return {kind: 'paragraph', number: match[2], relation: match[1].toLowerCase()};
  match = /^(after|before)\s+article\s+([1-9]\d{0,5}[a-z]?)$/i.exec(text);
  if (match) return {kind: 'article', number: match[2].toLowerCase(), relation: match[1].toLowerCase()};
  match = /^recital\s+([a-z]{1,3})$/i.exec(text);
  if (match) return {kind: 'recital', letter: match[1].toUpperCase(), relation: 'at'};
  match = /^(?:paragraph\s+|§\s*)([1-9]\d{0,5})\s*(?:[,–—-]\s*)?point\s+([a-z]{1,4}|\([a-z]{1,4}\))$/i.exec(text);
  if (match) return {kind: 'point', number: match[1], point: match[2].replace(/[()]/g, '').toLowerCase(), relation: 'at'};
  match = /^(?:paragraph\s+|§\s*)([1-9]\d{0,5})$/i.exec(text);
  if (match) return {kind: 'paragraph', number: match[1], relation: 'at'};
  match = /^article\s+([1-9]\d{0,5}[a-z]?)$/i.exec(text);
  if (match) return {kind: 'article', number: match[1].toLowerCase(), relation: 'at'};
  return null;
}

function publishedTargets(rows) {
  const labels = new Map();
  let paragraph = null, paragraphRecord = null, previous = null;
  for (const row of rows) {
    if (!previous || !consecutive(previous, row) || !previous.complete) {
      paragraph = null;
      paragraphRecord = null;
    }
    previous = row;
    if (row.source.container !== 'body') {
      paragraph = null;
      paragraphRecord = null;
      continue;
    }
    const value = row.normal;
    let reference = null;
    let match = /^([A-Z]{1,3})\.\s+/u.exec(value);
    if (match) reference = {kind: 'recital', letter: match[1]};
    match = /^([1-9]\d{0,5})\.\s+/u.exec(value);
    if (match) reference = {kind: 'paragraph', number: match[1]};
    // An article heading must end, break a line, or have an explicit title delimiter.
    // A sentence beginning "Article 5 applies ..." is not an article heading.
    match = /^\s*Article\s+([1-9]\d{0,5}[a-z]?)(?:\s*$|[ \t]*[\r\n]|\s*[:–—-]\s+)/i.exec(row.value);
    if (match) reference = {kind: 'article', number: match[1].toLowerCase()};
    match = /^(?:\(([a-z]{1,4})\)|([a-z]{1,4})\))\s+/u.exec(value);
    if (match && paragraph && row.complete) reference = {kind: 'point', number: paragraph, point: match[1] || match[2]};
    if (!reference) {
      // Without heading/style evidence an unlabeled block cannot safely carry
      // numbered-point scope into the next paragraph.
      paragraph = null;
      paragraphRecord = null;
      continue;
    }
    const record = {index: row.index, complete: row.complete, reference, members: new Set([row.index])};
    const key = referenceKey(reference);
    const records = labels.get(key);
    if (records) records.push(record);
    else labels.set(key, [record]);
    if (reference.kind === 'point') paragraphRecord?.members.add(row.index);
    else {
      paragraph = reference.kind === 'paragraph' && row.complete ? reference.number : null;
      paragraphRecord = paragraph ? record : null;
    }
    if (!row.complete) {
      paragraph = null;
      paragraphRecord = null;
    }
  }
  return labels;
}

const overlap = (indices, record) => indices.some(index => record.members.has(index));
const contains = (outer, inner) => [...inner.members].every(index => outer.members.has(index));

/** Resolve a passage only from source wording or an explicit published provision.
 * Source/parent identity and source version are the caller's responsibility.
 * The returned indices address the unmodified input paragraphs.
 */
export function resolveDocumentTarget(text, {originalText, targetLabel, referenceText, language} = {}) {
  if (exceedsInputBudget(text, {originalText, targetLabel, referenceText})) return result('unavailable', 'matching_budget');
  const rows = sourceStructure(text);
  if (!rows) return result('unavailable', 'source_structure_unavailable');
  const quote = whitespace(originalText);
  const quotes = quotedTargets(rows, quote);
  if (quotes === null) return result('unavailable', 'matching_budget');
  const isEnglish = english(language);
  const target = isEnglish ? parseReference(targetLabel) : null;
  const published = isEnglish ? parseReference(referenceText) : null;
  const isInsertion = /\(\s*new\s*\)/i.test(typeof targetLabel === 'string' ? targetLabel : '');
  if (isInsertion && (!published || published.relation === 'at')) return result('unavailable', 'insertion_reference_unavailable');
  const references = [target, published].filter(Boolean);
  const labels = publishedTargets(rows);
  const foundReferences = references.map(reference => ({reference, matches: labels.get(referenceKey(reference)) || []}));
  if (foundReferences.some(item => item.matches.length > 1)) return result('ambiguous', 'multiple_published_targets');
  const found = foundReferences.filter(item => item.matches.length === 1);
  if (found.some(item => !item.matches[0].complete)) return result('unavailable', 'source_passage_incomplete');
  const relative = references.filter(reference => reference.relation !== 'at');
  if (relative.some(reference => references.some(other => referenceKey(reference) !== referenceKey(other)))) {
    return result('ambiguous', 'conflicting_published_references');
  }
  if (relative.length && !found.some(item => item.reference.relation !== 'at')) return result('unavailable', 'relative_target_not_found');
  if (references.length === 2 && referenceKey(references[0]) === referenceKey(references[1])
    && references[0].relation !== 'at' && references[1].relation !== 'at'
    && references[0].relation !== references[1].relation) return result('ambiguous', 'conflicting_published_references');
  let selectedReference = found[0] || null;
  for (const next of found.slice(1)) {
    const firstRecord = selectedReference.matches[0], nextRecord = next.matches[0];
    if (!contains(firstRecord, nextRecord) && !contains(nextRecord, firstRecord)) return result('ambiguous', 'conflicting_published_references');
    if (contains(firstRecord, nextRecord)) selectedReference = next;
  }
  const relation = relative[0]?.relation || 'at';
  if (selectedReference && quotes.length && !quotes.some(indices => overlap(indices, selectedReference.matches[0]))) {
    return result('ambiguous', 'conflicting_target_evidence');
  }
  if (quotes.length === 1) {
    return result('found', null, {paragraphs: quotes[0], basis: 'quoted-original', relation, quoteMatches: true});
  }
  if (selectedReference) {
    const record = selectedReference.matches[0];
    return result('found', null, {
      paragraphs: [record.index], basis: 'published-reference', relation,
      quoteMatches: quote ? quotes.some(indices => overlap(indices, record)) : null,
    });
  }
  if (quotes.length > 1) return result('ambiguous', 'multiple_quoted_targets');
  if (!isEnglish && (whitespace(targetLabel) || whitespace(referenceText))) return result('unavailable', 'reference_language_unsupported');
  return result('unavailable', quote || references.length ? 'target_not_found' : 'target_reference_unavailable');
}

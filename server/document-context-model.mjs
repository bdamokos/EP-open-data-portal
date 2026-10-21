import {motionBodyStart} from './motion-diff.mjs';
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

function compatibleReferenceIdentities(left, right) {
  if (referenceKey(left) === referenceKey(right)) return true;
  if (left.relation !== 'at' || right.relation !== 'at') return false;
  return left.number === right.number
    && ((left.kind === 'paragraph' && right.kind === 'point') || (left.kind === 'point' && right.kind === 'paragraph'));
}

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
    // An observed label still competes for identity when its content is incomplete.
    // Record it before the completeness check prevents selection and further scope.
    if (match && paragraph) reference = {kind: 'point', number: paragraph, point: match[1] || match[2]};
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
  const isEnglish = english(language);
  const target = isEnglish ? parseReference(targetLabel) : null;
  const published = isEnglish ? parseReference(referenceText) : null;
  const isInsertion = /\(\s*new\s*\)/i.test(typeof targetLabel === 'string' ? targetLabel : '');
  if (isInsertion && (!published || published.relation === 'at')) return result('unavailable', 'insertion_reference_unavailable');
  const references = [target, published].filter(Boolean);
  const relative = references.filter(reference => reference.relation !== 'at');
  // Missing source labels cannot erase a contradiction between the requested
  // identities. Only a numbered paragraph and its own point may differ in scope.
  if (references.length === 2 && (!compatibleReferenceIdentities(references[0], references[1])
    || (relative.length === 2 && relative[0].relation !== relative[1].relation))) {
    return result('ambiguous', 'conflicting_published_references');
  }
  const narrowerReference = references.length === 2 && referenceKey(references[0]) !== referenceKey(references[1])
    ? references.find(reference => reference.kind === 'point') : null;
  const quote = whitespace(originalText);
  const quotes = quotedTargets(rows, quote);
  if (quotes === null) return result('unavailable', 'matching_budget');
  const labels = publishedTargets(rows);
  const foundReferences = references.map(reference => ({reference, matches: labels.get(referenceKey(reference)) || []}));
  if (foundReferences.some(item => item.matches.length > 1)) return result('ambiguous', 'multiple_published_targets');
  const found = foundReferences.filter(item => item.matches.length === 1);
  if (found.some(item => !item.matches[0].complete)) return result('unavailable', 'source_passage_incomplete');
  if (narrowerReference && !found.some(item => referenceKey(item.reference) === referenceKey(narrowerReference))) {
    return result('unavailable', 'target_not_found');
  }
  if (relative.length && !found.some(item => item.reference.relation !== 'at')) return result('unavailable', 'relative_target_not_found');
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


// Column values are preserved by the DOCX parser, including localized deletion
// markers. Only a whole cell is a marker; prose containing these words is text.
export const DELETION_MARKERS = Object.freeze([
  'deleted', 'supprimé', 'supprimée', 'entfällt', 'gestrichen', 'suprimido',
  'soppresso', 'soppressa', 'suprimida', 'geschrapt', 'udgår',
  'utgår', 'poistetaan', 'διαγράφεται', 'törölve', 'eliminat', 'eliminată',
  'заличава се', 'vypouští se', 'vypúšťa sa', 'črtano', 'briše se',
  'skreśla się', 'svītrots', 'išbraukta', 'välja jäetud', 'imħassar', 'scriosta',
]);
const deletionMarkers = new Set(DELETION_MARKERS);
export const isDeletionMarker = value => deletionMarkers.has(whitespace(value).normalize('NFC').toLowerCase());
export function amendmentOperation({originalText, proposedText} = {}) {
  if (typeof originalText !== 'string' || typeof proposedText !== 'string') return null;
  if (whitespace(originalText)) return !whitespace(proposedText) || isDeletionMarker(proposedText) ? 'delete' : 'replace';
  return whitespace(proposedText) && !isDeletionMarker(proposedText) ? 'insert' : null;
}

// Only standalone section labels establish an explicit end. Ordinary prose
// mentioning an annex, a signature or notes must remain in its provision.
const annexLabels = {
  bg:'приложение',es:'anexo',cs:'příloha',da:'bilag',de:'anlage|anhang',et:'lisa',el:'παράρτημα',en:'annex',fr:'annexe',ga:'iarscríbhinn',hr:'prilog',it:'allegato',
  lv:'pielikums',lt:'priedas',hu:'melléklet',mt:'anness',nl:'bijlage',pl:'załącznik',pt:'anexo',ro:'anexă',sk:'príloha',sl:'priloga',fi:'liite',sv:'bilaga',
};
const resolutionEndLabels = Object.fromEntries(Object.entries(annexLabels).map(([language, label]) => [language,
  new RegExp(`^(?:(?:${label.normalize('NFD').replace(/\p{M}/gu, '')})(?:\\s+(?:[IVXLCDM]+|\\d+))?${language === 'en' ? '|explanatory statement|signature(?:s)?|notes|footnotes' : ''})$`, 'iu'),
]));
function motionStructure(text, language) {
  const paragraphs = text?.paragraphs || [], start = motionBodyStart(paragraphs, language), rows = sourceStructure(text);
  const units = [], stack = [], invalid = new Set(), incompleteLabels = new Set();
  if (start < 0 || !rows || rows[start].source.container !== 'body' || !rows[start].complete) return {units, invalid, incompleteLabels, end: -1, endAvailable: false};
  let citation = 0, provisionsStarted = false, openList = false, end = paragraphs.length - 1, endAvailable = false;
  const close = (at, broken = false) => {
    while (stack.length) {const unit = stack.pop(); unit.end = at; if (broken) invalid.add(unit.start);}
    openList = false;
  };
  for (let index = start + 1; index < paragraphs.length; index++) {
    const row = rows[index], value = row.normal;
    if (!consecutive(rows[index - 1], row)) close(index - 1, true);
    if (row.source.container !== 'body' || !row.complete) {
      close(index - 1, true);
      // Incomplete labels still prevent a complete duplicate from claiming identity.
      if (row.source.container === 'body') {
        const match = /^([1-9]\d{0,5}\s*[a-z]{0,3}|[A-Z]{1,3}[a-z]{0,3})[.)]\s+/u.exec(value);
        if (match) incompleteLabels.add(match[1].replace(/\s/g, ''));
      }
      continue;
    }
    if (resolutionEndLabels[language]?.test(value.normalize('NFD').replace(/\p{M}/gu, ''))) {
      end = index - 1; endAvailable = true; close(end); break;
    }
    let kind, label, level = 1;
    let match = /^([1-9]\d{0,5}\s*[a-z]{0,3})[.)]\s+/u.exec(value);
    if (match) {kind = 'paragraph'; label = match[1].replace(/\s/g, ''); provisionsStarted = true; openList = false;}
    else if ((match = /^([A-Z]{1,3}[a-z]{0,3})[.)]\s+/u.exec(value))) {kind = 'recital'; label = match[1]; provisionsStarted = true; openList = false;}
    else if ((match = /^(?:\(([a-z]{1,4})\)|([a-z]{1,4})\))\s+/u.exec(value)) && stack.some(unit => unit.kind === 'paragraph')) {kind = 'point'; label = match[1] || match[2]; level = 2;}
    else if (!provisionsStarted && /^[–—−\-•]\s*\S/u.test(value)) {kind = 'citation'; label = String(++citation);}
    else if (!openList && !/^[–—−\-•]\s*\S/u.test(value) && value && value.length < 180 && value === value.toLocaleUpperCase(language) && /\p{L}/u.test(value) && !/[\p{P}]$/u.test(value)) {kind = 'heading'; label = value; level = 0;}
    else {if (/:$/.test(value)) openList = true; continue;}
    while (stack.length && stack.at(-1).level >= level) stack.pop().end = index - 1;
    const unit = {kind, label, parent: stack.at(-1)?.start ?? null, start: index, end, level};
    units.push(unit); stack.push(unit);
    if (/:$/.test(value)) openList = true;
  }
  close(end);
  // A child may be locally complete while its parent's source subtree is broken.
  const byStart = new Map(units.map(unit => [unit.start, unit]));
  for (const unit of units) for (let parent = byStart.get(unit.parent); parent; parent = byStart.get(parent.parent)) {
    if (invalid.has(parent.start)) {invalid.add(unit.start); break;}
  }
  return {units, invalid, incompleteLabels, end, endAvailable};
}

/** Inclusive extents from complete, contiguous body rows; source breaks end scope.
 * Only conservative headings interrupt a provision; its lists stay in its subtree.
 */
export function segmentMotionUnits(text, language) {
  return motionStructure(text, language).units;
}

// Only the first (proposal-level) target line selects a provision. Underlying-act
// lines are deliberately excluded, including their '(new)' annotations.
function placementReference(value) {
  const first = typeof value === 'string' ? value.split(/[\r\n]/)[0] : '';
  const text = whitespace(first).replace(/\s*\(\s*new\s*\)\s*$/i, '').replace(/\.$/, '');
  let match = /^(?:paragraph\s+|§\s*)([1-9]\d{0,5})\s*([a-z]{0,3})(?:\s*[,–—-]?\s*point\s+\(?([a-z]{1,4})\)?)?$/i.exec(text);
  if (match) return {kind: match[3] ? 'point' : 'paragraph', label: match[3] || match[1] + match[2].toLowerCase(), paragraph: match[1] + match[2].toLowerCase(), base: match[1], suffix: match[2].toLowerCase()};
  match = /^recital\s+([A-Z]{1,3})(?:\s+([a-z]{1,3})|([a-z]{1,3}))?$/.exec(text.replace(/^recital/i, 'recital'));
  if (match) return {kind: 'recital', label: match[1] + (match[2] || match[3] || ''), base: match[1], suffix: match[2] || match[3] || ''};
  match = /^citation\s+([1-9]\d{0,5})$/i.exec(text);
  if (match) return {kind: 'citation', label: match[1]};
  return null;
}
const wordingNormal = value => whitespace(value).normalize('NFC').replace(/\u00ad/g, '')
  .replace(/^(?:\d+\s*[a-z]*|[A-Z]{1,3}[a-z]*)[.)]\s+/u, '');

export function resolveAmendmentPlacement(text, options = {}) {
  const operation = amendmentOperation(options), evidence = [];
  const unresolved = reason => ({operation, status: 'unresolved', reason, evidence});
  const placed = fields => ({operation, status: 'placed', ...fields, evidence});
  if (!operation) return unresolved('amendment_wording_unavailable');
  if (exceedsInputBudget(text, options) || options.proposedText.length > MATCH_LIMITS.quoteCharacters) return unresolved('matching_budget');
  const firstLine = (options.targetLabel || '').split(/[\r\n]/)[0];
  // Articles and nested legislative references are outside the resolution baseline.
  // Never quote-match them against a similarly numbered paragraph in a report.
  if (/\barticle\b|\bregulation\b|\bdirective\b/i.test(firstLine) || options.baseline === 'other') return unresolved('baseline_unavailable');
  if (!options.language || text?.textLanguage && text.textLanguage !== options.language) return unresolved('different_text_languages');
  const rows = sourceStructure(text);
  if (!rows) return unresolved('source_structure_unavailable');
  const structure = motionStructure(text, options.language), {units} = structure;
  if (!units.length) return unresolved('baseline_unavailable');
  const ref = english(options.language) ? placementReference(options.targetLabel) : null;
  const matching = reference => units.filter(unit => unit.kind === reference.kind && unit.label === reference.label &&
    (reference.kind !== 'point' || units.find(parent => parent.start === unit.parent)?.label === reference.paragraph));
  const complete = (start, end) => rows.slice(start, end + 1).every((row, index) => row.complete && row.source.container === 'body' && (!index || consecutive(rows[start + index - 1], row)));
  const span = unit => ({start: unit.start, end: unit.end});
  if (operation === 'insert') {
    if (!ref || !ref.suffix || !['paragraph', 'recital'].includes(ref.kind)) return unresolved('insertion_reference_unavailable');
    if (matching(ref).length) return unresolved('duplicate_target_label');
    const siblings = units.filter(unit => unit.kind === ref.kind && (unit.label === ref.base || unit.label.startsWith(ref.base) && /^[a-z]+$/.test(unit.label.slice(ref.base.length)) && unit.label.slice(ref.base.length) < ref.suffix));
    if (!siblings.some(unit => unit.label === ref.base)) return unresolved('relative_target_not_found');
    const ordered = siblings.sort((a, b) => a.start - b.start), anchor = ordered.at(-1);
    if (new Set(siblings.map(unit => unit.label)).size !== siblings.length || siblings.some(unit => unit.parent !== anchor.parent)) return unresolved('multiple_published_targets');
    evidence.push({basis: 'published-reference', label: ref.label, anchor: anchor.label});
    if (options.referenceText) {
      const relative = parseReference(options.referenceText);
      // Independent decision evidence may name the unsuffixed parent (After §19).
      if (!relative || relative.relation !== 'after' || relative.kind !== ref.kind || (relative.number ?? relative.letter) !== ref.base) return unresolved('conflicting_target_evidence');
      evidence.push({basis: 'relative-reference', reference: options.referenceText});
    }
    if (structure.invalid.has(anchor.start) || structure.incompleteLabels.has(anchor.label) || !complete(anchor.start, anchor.end)) return unresolved('source_passage_incomplete');
    if (anchor.end === structure.end && !structure.endAvailable) return unresolved('resolution_end_unavailable');
    return placed({insertAfter: anchor.end, insertBefore: anchor.end + 1});
  }
  if (ref) {
    const matches = matching(ref);
    if (matches.length > 1) return unresolved('multiple_published_targets');
    if (!matches.length) return unresolved(structure.incompleteLabels.has(ref.label) ? 'source_passage_incomplete' : 'target_not_found');
    const unit = matches[0];
    if (structure.invalid.has(unit.start) || structure.incompleteLabels.has(unit.label) || !complete(unit.start, unit.end)) return unresolved('source_passage_incomplete');
    const source = text.paragraphs.slice(unit.start, unit.end + 1).join(' ');
    if (wordingNormal(source) !== wordingNormal(options.originalText)) return unresolved('conflicting_target_evidence');
    if (options.referenceText) {
      const decision = placementReference(options.referenceText);
      if (!decision || decision.kind !== ref.kind || decision.label !== ref.label || decision.kind === 'point' && decision.paragraph !== ref.paragraph) return unresolved('conflicting_target_evidence');
    }
    evidence.push({basis: 'published-reference', label: ref.label}, {basis: 'quoted-original'});
    return placed({span: span(unit)});
  }
  const quotes = quotedTargets(rows, whitespace(options.originalText));
  if (quotes === null) return unresolved('matching_budget');
  if (quotes.length !== 1) return unresolved(quotes.length ? 'multiple_quoted_targets' : 'target_not_found');
  const indices = quotes[0], start = indices[0], end = indices.at(-1);
  if (!complete(start, end)) return unresolved('source_passage_incomplete');
  // Quotation fallback is restricted to the resolution body, never the cover.
  if (!units.some(unit => !structure.invalid.has(unit.start) && start >= unit.start && end <= unit.end)) return unresolved('target_not_found');
  if (options.referenceText) {
    const decision = placementReference(options.referenceText), matches = decision ? matching(decision) : [];
    if (matches.length !== 1 || start < matches[0].start || end > matches[0].end) return unresolved('conflicting_target_evidence');
  }
  evidence.push({basis: 'quoted-original'});
  return placed({span: {start, end}});
}

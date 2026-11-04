import {resolutionPointCollision} from './resolution-point-collision.mjs';
import {characterSimilarity} from './proposal-similarity.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {relativeResolutionHeading} from './resolution-labels.mjs';
import {comparisonHeading} from './amendment-baseline.mjs';
import {parseTargetLabel} from './proposal-labels.mjs';
import {motionBodySelection,resolutionSectionHeading,resolutionSubheading,resolutionSeparator} from './resolution-body.mjs';
import {resolutionPointPlacement,resolutionPointNearPlacement} from './resolution-points.mjs';
import {recitalCategoryPlacement} from './resolution-category-repair.mjs';
import {resolutionFootnoteMatch} from './resolution-footnotes.mjs';
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

function exceedsInputBudget(text, {originalText, targetLabel, referenceText, numberingReferenceTexts}) {
  if(numberingReferenceTexts!=null&&(!Array.isArray(numberingReferenceTexts)||numberingReferenceTexts.length>64
    ||numberingReferenceTexts.some(value=>typeof value!=='string'||value.length>MATCH_LIMITS.referenceCharacters)))return true;
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
    && (left.source.segment === right.source.segment && right.source.ordinal === left.source.ordinal + 1
      // A-10-2026-0042 embeds paragraph 52 in the physical row for 51.
      // A trailing blank cannot certify a boundary for the first label alone.
      || right.source.previousParagraph === left.source.path && !/[;.!?]\s*[1-9]\d{0,5}[.)]\t/u.test(left.value)
        && right.source.ordinal > left.source.ordinal
        && right.source.segment - left.source.segment === right.source.ordinal - left.source.ordinal - 1);
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
    match = /^(?:\(([\p{Ll}]{1,4})\)|([\p{Ll}]{1,4})\))\s+/u.exec(value);
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
  'soppresso', 'soppressa', 'suprimida', 'geschrapt', 'schrappen', 'udgår',
  'utgår', 'poistetaan', 'διαγράφεται', 'törölve', 'eliminat', 'eliminată',
  'заличава се', 'vypouští se', 'vypúšťa sa', 'črtano', 'briše se',
  'skreśla się', 'svītrots', 'išbraukta', 'välja jäetud', 'imħassar', 'scriosta',
]);
const deletionMarkers = new Set(DELETION_MARKERS);
// Published FI/LT/HR cells also use a terminal full stop. Do not strip other
// punctuation, quotes or words: only an entire instruction cell is deletion.
export const isDeletionMarker = value => deletionMarkers.has(whitespace(value).normalize('NFC').toLowerCase().replace(/\.$/u,'').trimEnd());
export function amendmentOperation({originalText, proposedText, language} = {}) {
  if(amendmentMixedLanguageScope({originalText,proposedText,language})||amendmentLanguageScope({originalText,proposedText,language}))return null;
  if (typeof originalText !== 'string' || typeof proposedText !== 'string') return null;
  if (whitespace(originalText)) return !whitespace(proposedText) || isDeletionMarker(proposedText) ? 'delete' : 'replace';
  return whitespace(proposedText) && !isDeletionMarker(proposedText) ? 'insert' : null;
}

// EP report/motion section labels; public examples are attributed in the test fixture.
// Match a whole label, optional number and an optional delimited title, never an
// ordinary sentence that merely mentions an annex or explanatory statement.
const resolutionEndLabels = {
  bg: ['приложение', 'изложение на мотивите|мотиви|обосновка'], es: ['anexo', 'exposición de motivos|justificación'],
  cs: ['příloha', 'vysvětlující prohlášení|odůvodnění'], da: ['bilag', 'begrundelse'],
  de: ['anlage|anhang', 'begründung'], et: ['lisa', 'seletuskiri|selgitus'],
  el: ['παράρτημα', 'αιτιολογική έκθεση|αιτιολόγηση'], en: ['annex', 'explanatory statement|justification|signatures?|notes|footnotes'],
  fr: ['annexe', 'exposé des motifs|justification'], ga: ['iarscríbhinn', 'ráiteas míniúcháin|réasúnú'],
  hr: ['prilog', 'obrazloženje'], it: ['allegato', 'motivazione|giustificazione'],
  lv: ['pielikums', 'paskaidrojums|pamatojums'], lt: ['priedas', 'aiškinamoji dalis|pagrindimas'],
  hu: ['melléklet', 'indokolás'], mt: ['anness', 'nota spjegattiva|ġustifikazzjoni'],
  nl: ['bijlage', 'toelichting|motivering|beknopte motivering'], pl: ['załącznik', 'uzasadnienie'],
  pt: ['anexo', 'exposição de motivos|justificação'], ro: ['anexă', 'expunere de motive|justificare'],
  sk: ['príloha', 'dôvodová správa|odôvodnenie'], sl: ['priloga', 'obrazložitev'],
  fi: ['liite', 'perustelut'], sv: ['bilaga', 'motivering'],
};
const headingNormal = value => value.normalize('NFD').replace(/\p{M}/gu, '');
const resolutionEndPatterns = Object.fromEntries(Object.entries(resolutionEndLabels).map(([language, [annex, explanation]]) => [language,
  new RegExp(`^(?:(?:${headingNormal(annex)})(?:\\s+(?:[IVXLCDM]+|\\d+))?|(?:${headingNormal(explanation)}))(?:\\s*[:.–—-]\\s*.*)?$`, 'iu'),
]));
const annexPrefixes = Object.fromEntries(Object.entries(resolutionEndLabels).map(([language, [annex]]) => [language,
  new RegExp(`^(?:${headingNormal(annex)})(?:\\s|$)`, 'iu'),
]));
// Numbered provisions and dash items supply continuation evidence before this
// check. Punctuation alone cannot turn a short title into a prose continuation.
const headingLike = value => value.length > 0 && value.length < 180 && /\p{L}/u.test(value)
  && (value === value.toUpperCase() || /^\p{Lu}/u.test(value)
    && (!/\p{P}$/u.test(value) || /:$/u.test(value) || value.split(/\s+/u).length <= 3));
// A-10-2026-0085's EDF title is wholly bold but ends in ')'; 0199 uses
// standalone degree-sign rows before its final instruction. These source-backed
// boundaries close the preceding provision without making its extent uncertain.
const structuralRow = (row, format) => row.normal === '°' || row.normal === '° °'
  || row.normal.length < 180 && /^\p{Lu}/u.test(row.normal) && !/[.;!?]$/u.test(row.normal)
    && format?.marks?.some(mark => mark.kind === 'bold' && mark.start === 0 && mark.end === row.value.length);
const emphasisedRow = (value, format) => {
  const start = value.search(/\S/u), end = value.trimEnd().length;
  return start >= 0 && ['bold', 'italic'].some(kind => (format?.marks || []).some(mark => mark.kind === kind
    && Number.isInteger(mark.start) && Number.isInteger(mark.end) && mark.start <= start && mark.end >= end))
    || start===0&&value.length<180&&!/[.;!?:]$/u.test(value)&&['bold','italic'].every(kind=>{const marks=(format?.marks||[]).filter(m=>m.kind===kind);return marks.some(m=>m.start===0&&m.end>=end/3)&&marks.some(m=>m.end===end&&m.start<=end*2/3);});
};
function motionStructure(text, language) {
  const paragraphs = text?.paragraphs || [], selection = motionBodySelection(paragraphs, language), {start} = selection, rows = sourceStructure(text);
  const formats = Array.isArray(text?.paragraphFormats) && text.paragraphFormats.length === paragraphs.length ? text.paragraphFormats : [];
  const units = [], stack = [], invalid = new Set(), uncertain = new Set(), incompleteLabels = new Set(), certainHeadings = new Set();
  if (start < 0 || !rows || rows[start].source.container !== 'body' || !rows[start].complete) return {units, invalid, uncertain, incompleteLabels, start, end: -1, endAvailable: false};
  // Blank Word title rows may be omitted (A-10-2026-0199). Selecting a
  // section does not join wording across those gaps; provision extents below
  // still require complete consecutive source rows.
  if (selection.heading != null && !rows.slice(selection.heading, start + 1).every(row => row.complete && row.source.container === 'body'))
    return {units, invalid, uncertain, incompleteLabels, start: -1, end: -1, endAvailable: false};
  let citation = 0, provisionsStarted = false, end = paragraphs.length - 1, endAvailable = false;
  const close = (at, broken = false) => {
    while (stack.length) {const unit = stack.pop(); unit.end = at; if (broken) invalid.add(unit.start);}
  };
  for (let index = start + 1; index < paragraphs.length; index++) {
    const row = rows[index], value = row.normal;
    if (!consecutive(rows[index - 1], row)) close(index - 1, true);
    // Word soft breaks separate a section label from its title inside one
    // paragraph. Inspect that physical line before whitespace normalization.
    const firstLine = headingNormal(whitespace(row.value.split(/[\r\n]/u)[0]));
    if (row.source.container === 'body' && (resolutionEndPatterns[language]?.test(firstLine) || resolutionSectionHeading(row.value, language))) {
      end = index - 1; endAvailable = row.complete; close(end, !row.complete); break;
    }
    if (row.source.container === 'body' && annexPrefixes[language]?.test(firstLine) && !/[.;!?]$/u.test(firstLine)) {
      // An undelimited annex title has no safe extent. Exclude everything after
      // it and withhold the preceding extent rather than resuming annex numbers.
      for (const unit of stack) if (unit.kind !== 'heading') uncertain.add(unit.start);
      end = index - 1; close(end); break;
    }
    if (row.source.container !== 'body' || !row.complete) {
      close(index - 1, true);
      // Incomplete labels still prevent a complete duplicate from claiming identity.
      if (row.source.container === 'body') {
        const match = /^([1-9]\d{0,5}\s*[a-zα-ωа-я]{0,3}|[\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u.exec(value);
        if (match) incompleteLabels.add(match[1].replace(/\s/g, ''));
      }
      continue;
    }
    // Degree-sign rows close the final substantive paragraph in both single-
    // and multi-body resolutions, before the instruction to forward the text.
    if (resolutionSeparator(value)) {
      close(index - 1);
      certainHeadings.add(index);
      units.push({kind: 'heading', label: value, parent: null, start: index, end: index, level: 0});
      continue;
    }
    // A standalone source editorial reference between consecutive recitals
    // is retained in the document but is not part of either recital's text.
    const beforeRecital=/^([A-Z]{1,3})[.)]\s+/u.exec(rows[index-1]?.normal||'')?.[1];
    const afterRecital=/^([A-Z]{1,3})[.)]\s+/u.exec(rows[index+1]?.normal||'')?.[1];
    const recitalOrdinal=s=>s?[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0):null;
    if(language==='en'&&!/[\r\n]/u.test(row.value)&&/^\(Ex AM [1-9]\d* \(Or\. [A-Z]{2}\) of FdR [^()\r\n]+\.docx\)$/u.test(value)
      &&beforeRecital&&afterRecital&&recitalOrdinal(afterRecital)===recitalOrdinal(beforeRecital)+1
      &&rows[index+1]?.complete&&consecutive(rows[index-1],row)&&consecutive(row,rows[index+1])) {
      close(index-1);certainHeadings.add(index);
      units.push({kind:'heading',label:value,parent:null,start:index,end:index,level:0});continue;
    }
    const heading = formats[index]?.heading;
    const recordedHeading = Number.isInteger(heading) && heading >= 1 && heading <= 6;
    // A Roman-numbered section title can look like a recital. Require both
    // full emphasis and consecutive operative numbers before treating it as a heading.
    const marks = formats[index]?.marks || [], length = row.value.trimEnd().length, start = row.value.search(/\S/u);
    const fullyMarked = kind => start >= 0 && marks.some(mark => mark.kind === kind && mark.start <= start && mark.end >= length);
    const priorNumber = /^([1-9]\d*)[.)]\s+/u.exec(rows[index - 1]?.normal || '')?.[1];
    const nextNumber = /^([1-9]\d*)[.)]\s+/u.exec(rows[index + 1]?.normal || '')?.[1];
    if (/^[IVXLCDM]+[.)]\s+\S/u.test(value) && fullyMarked('bold') && fullyMarked('italic')
      && priorNumber && nextNumber && Number(priorNumber) + 1 === Number(nextNumber)
      && rows[index + 1]?.complete && consecutive(rows[index - 1], row) && consecutive(row, rows[index + 1])) {
      close(index - 1); certainHeadings.add(index);
      units.push({kind: 'heading', label: value, parent: null, start: index, end: index, level: 0});
      continue;
    }
    let kind, label, level = 1;
    let match = /^([1-9]\d{0,5}\s*[a-zα-ωа-я]{0,3})[.)]\s+/u.exec(value);
    if (match) {kind = 'paragraph'; label = match[1].replace(/\s/g, ''); provisionsStarted = true;}
    else if ((match = /^([\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u.exec(value))) {kind = 'recital'; label = match[1]; provisionsStarted = true;}
    else if ((match = /^(?:\(([\p{Ll}]{1,4})\)|([\p{Ll}]{1,4})\))\s+/u.exec(value)) && stack.some(unit => unit.kind === 'paragraph')) {kind = 'point'; label = match[1] || match[2]; level = 2;}
    else if (!provisionsStarted && /^[–—−\-•]\s*\S/u.test(value)) {kind = 'citation'; label = String(++citation);}
    // Fill only the absorption gaps. The existing policy for recognised
    // headings is handled separately (and can evolve in the stacked change).
    else if (!recordedHeading && !headingLike(value) && structuralRow(row, formats[index])) {
      close(index - 1);
      kind = 'heading'; label = value; level = 0;
    }
    else if (recordedHeading || resolutionSubheading(row.value, formats[index]) || !/^[–—−\-•]\s*\S/u.test(value) && headingLike(value)) {
      // Recorded outline headings also close scope when their text resembles prose.
      // A whole-row bold/italic EP subheading followed immediately by a
      // complete numbered provision closes the preceding extent. Plain or
      // partially emphasized heading-like prose remains ambiguous.
      const next = rows[index + 1];
      const nextNumber = next && /^([1-9]\d{0,5})\s*[a-zα-ωа-я]{0,3}[.)]\s+/u.exec(next.normal)?.[1];
      // A-10-2026-0081/0085/0087/0105 mark section titles with bold or italic
      // alone. Whole-row emphasis is certain only between consecutive numbers,
      // after a provision that does not introduce further content.
      const previous = units.findLast(unit => unit.kind === 'paragraph');
      const successorTitle = !recordedHeading && emphasisedRow(row.value, formats[index]) && nextNumber
        && previous && Number.parseInt(previous.label, 10) + 1 === Number(nextNumber)
        && !/:\s*$/u.test(rows[index - 1].normal);
      const certain = (resolutionSubheading(row.value, formats[index]) || successorTitle) && next?.complete
        && next.source.container === 'body' && consecutive(row, next)
        && /^[1-9]\d{0,5}\s*[a-zα-ωа-я]{0,3}[.)]\s+/u.test(next.normal);
      if (certain) certainHeadings.add(index);
      else for (const unit of stack) if (unit.kind !== 'heading') uncertain.add(unit.start);
      close(index - 1);
      kind = 'heading'; label = value; level = 0;
    }
    else continue;
    while (stack.length && stack.at(-1).level >= level) stack.pop().end = index - 1;
    const unit = {kind, label, parent: stack.at(-1)?.start ?? null, start: index, end, level};
    units.push(unit); stack.push(unit);
  }
  close(end);
  // A break taints units still open at that break. Earlier closed children
  // (including provisions under a long section heading) keep their own extent.
  const extentUncertain = new Set(uncertain);
  const byStart = new Map(units.map(unit => [unit.start, unit]));
  for (const unit of units) for (let parent = byStart.get(unit.parent); parent; parent = byStart.get(parent.parent)) {
    if (invalid.has(parent.start) && unit.end >= parent.end) invalid.add(unit.start);
    if (uncertain.has(parent.start)) uncertain.add(unit.start);
  }
  return {units, invalid, uncertain, extentUncertain, incompleteLabels, certainHeadings, start, end, endAvailable, selection};
}

/** Inclusive extents from complete, contiguous body rows; source breaks end scope.
 * Heading-like rows close lists and make the preceding provision uncertain.
 */
export function segmentMotionUnits(text, language) {
  return motionStructure(text, language).units;
}

// Only the first (proposal-level) target line selects a provision. Underlying-act
// lines are deliberately excluded, including their '(new)' annotations.
export function placementReference(value, language = 'en', proposedText = '') {
  const first = typeof value === 'string' ? value.split(/[\r\n]/)[0] : '';
  let text = whitespace(first);
  // These are published resolution forms, separate from legislative paths.
  const subheading = relativeResolutionHeading(text, language);
  if (subheading) return subheading;
  if (language === 'en') text = text.replace(/^§\s*/u, 'Paragraph ').replace(/^Paragraph(?=\d)/iu, 'Paragraph ')
    .replace(/^Rectial\b/u, 'Recital').replace(/^Paragraph (\d+) \(([a-z]+)\) ([a-z]) (\(new\))$/u, 'Paragraph $1 – point $2 $3 $4');
  if (language === 'en') text = text.replace(/^(Paragraph\s+\d+\s*[a-z]{0,3})\s*,?\s+point\s+\(?([a-z]{1,4})\)?$/iu, '$1 – point $2');
  if (language === 'et') text = text.replace(/^Punkt(?=\s)/iu, 'Lõige');
  if (language === 'da') text = text.replace(/^Punkt\b/iu, 'Stykke');
  if (language === 'ro') text = text.replace(/^Punctul\b/iu, 'Paragraful');
  if (language === 'de') text = text.replace(/^Ziffer(?=\s)/iu, 'Absatz');
  if (language === 'cs') text = text.replace(/^Bod(?=\s+\d)/iu, 'odstavec');
  const translatedCitation = language === 'bg' && /^Позоваване\s+([1-9]\d{0,5})$/iu.exec(text);
  if (translatedCitation) return {kind:'citation',label:translatedCitation[1],base:translatedCitation[1],suffix:'',isNew:false,parents:[]};
  // Citation ordinals count the published dash-led preambular siblings.
  const citation = language === 'en' && /^Citation (\d+)(?:\s*([a-z]{1,3}))?(?:\s*\(new\))?$/iu.exec(text);
  if (citation) return {kind: 'citation', label: citation[1] + (citation[2] || ''), base: citation[1], suffix: citation[2] || '', isNew: /\(new\)/iu.test(text), parents: []};
  if (language === 'en' && /^\d+\s+[a-z] \(new\)$/u.test(text)) text = 'Paragraph ' + text;
  let target;
  try {target = parseTargetLabel(text, language);} catch {return null;}
  if (!target.complete || target.underlyingLabel || !target.segments.length) {
    // Translated resolution recitals can use multiletter capitals plus a Latin
    // suffix, e.g. the published Spanish "Considerando AL ter (nuevo)".
    const recitals={fr:'considérant',es:'considerando',de:'Erwägung|Erwägungsgrund',bg:'съображение',el:'αιτιολογική σκέψη',hr:'uvodna izjava',cs:'bod odůvodnění'};
    const qualifiers={fr:'nouveau|nouvelle',es:'nuevo|nueva',de:'neu',bg:'нов|нова|ново',el:'νέο|νέα|νέος',hr:'novi|nova|novo',cs:'nový|nová|nové'};
    if (!recitals[language]) return null;
    const qualifier=new RegExp(`\\s*\\((?:${qualifiers[language]})\\)\\s*$`,'iu');
    const isNew=qualifier.test(text),label=text.replace(qualifier,'').replace(/\.$/,'');
    const bare=label.replace(new RegExp(`^(?:${recitals[language]})\\s+`,'iu'),'');
    const recital=bare!==label&&/^([A-ZА-Я]{1,3})(?:\s*([a-z]{1,8}))?$/u.exec(bare);
    return recital?{kind:'recital',label:recital[1]+(recital[2]||''),base:recital[1],suffix:recital[2]||'',isNew,parents:[]}:null;
  }
  const segments = target.segments.map(segment => {
    let kind = segment.kind;
    // The source calls these "Recital 6 b" / "Paragraph B a", while the
    // resolution itself prints operative numbers / recital letters respectively.
    if (kind === 'recital' && /^\d/u.test(segment.value)
      && proposedText.trimStart().startsWith(segment.value + '.')) kind = 'paragraph';
    if (kind === 'paragraph' && /^[\p{Lu}]/u.test(segment.value)) kind = 'recital';
    return {...segment, kind, label: segment.value};
  });
  const last = segments.at(-1);
  if (!['paragraph', 'recital', 'point', 'citation'].includes(last.kind) || segments.slice(0,-1).some(s => !['paragraph','point'].includes(s.kind))) return null;
  const parents = segments.slice(0,-1).map(({kind,label}) => ({kind,label}));
  if (last.kind === 'point' && parents[0]?.kind !== 'paragraph') return null;
  return {kind: last.kind, label: last.value, base: last.base ?? (last.number != null ? String(last.number) : last.suffix ? last.value.slice(0,-last.suffix.length) : last.value), suffix: last.suffix, isNew: last.isNew,
    ...(last.negative ? {negative: true} : {}), parents, ...(parents.length ? {paragraph: parents[0].label} : {})};
}
// Match the proposal alignment's typographic folding while retaining every
// punctuation mark; its full normalizer also removes boundary terminators.
const wordingNormal = value => whitespace(value).normalize('NFC').replace(/\u00ad/g, '')
  .replace(/[‘’‚‛ʻʼ]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐‑‒–—]/g, '-')
  .replace(/^(?:\d+\s*[a-z]*|[A-Z]{1,3}[a-z]*)[.)](?:\s+|(?=\p{Lu}))/u, '');

// Plenary decision references are published in English. Unparsed descriptions
// and references in a different wording language carry no location evidence.
// Keep them in provenance; only parsed comparable locations constrain placement.
export const resolutionReference = (value, language) => english(language)
  && (parseReference(value) || placementReference(value)) ? value : undefined;

// A lost paragraph mark can print a provision inside its predecessor's row
// (A-10-2026-0237 "…Un;L.", A-10-2026-0042 "…services;72."). Plain numbers and
// single Latin or Cyrillic capitals only: the neighbours are one ordinal below
// and above, adjacent, and the lower one's last row carries the merged label.
function numberingGapAnchor(text, family, base) {
  const ordinalOf = value => /^\d+$/u.test(value) ? Number(value) : /^[A-Z\u0410-\u042f]$/u.test(value) ? value.codePointAt(0) : null;
  const wanted = ordinalOf(base);
  if (wanted === null || family.some(unit => unit.label.startsWith(base))) return null;
  const ordered = [...family].sort((a, b) => a.start - b.start);
  const anchors = ordered.filter((unit, i) => ordinalOf(unit.label) === wanted - 1 && ordinalOf(ordered[i + 1]?.label ?? '') === wanted + 1
    && ordered[i + 1].start === unit.end + 1 && ordered[i + 1].parent === unit.parent);
  if (anchors.length !== 1 || ordered.filter(unit => unit.label === anchors[0].label).length !== 1) return null;
  const merged = new RegExp(`[;.:]\\s*${base}[.)]\\s*\\S`, 'u');
  return merged.test(text.paragraphs[anchors[0].end] ?? '') ? anchors[0] : null;
}

export function resolveAmendmentPlacement(text, options = {}) {
  let operation = amendmentOperation(options);
  const evidence = [];
  const referenceText = resolutionReference(options.referenceText, options.language);
  const unresolved = reason => ({operation, status: 'unresolved', reason, evidence});
  const placed = fields => ({operation, status: 'placed', ...fields, evidence});
  const mixedScope=amendmentMixedLanguageScope(options);
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  if(amendmentLanguageScope(options))return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...amendmentLanguageScope(options)}]};
  if (!operation) return unresolved('amendment_wording_unavailable');
  if (options.baselineSource?.conflicted === true) return unresolved('conflicting_baselines');
  if (exceedsInputBudget(text, options) || options.proposedText.length > MATCH_LIMITS.quoteCharacters) return unresolved('matching_budget');
  const firstLine = (options.targetLabel || '').split(/[\r\n]/)[0];
  // Articles and nested legislative references are outside the resolution baseline.
  // Never quote-match them against a similarly numbered paragraph in a report.
  if (/\barticle\b|\bregulation\b|\bdirective\b/i.test(firstLine)
    || options.baseline != null && options.baseline !== 'motion-resolution'
      && (options.baseline !== 'unknown' || options.resolutionDocument !== true)) return unresolved('baseline_unavailable');
  if (!options.language || text?.textLanguage && text.textLanguage !== options.language) return unresolved('different_text_languages');
  const rows = sourceStructure(text);
  if (!rows) return unresolved('source_structure_unavailable');
  // The first annex of this Swedish resolution format contains numbered
  // recommendations, each followed by a title and numbered points.
  const recommendation=options.language==='sv'&&operation==='replace'&&/^Bilaga I – rekommendation ([1-9]\d*) – punkt 1$/u.exec(options.targetLabel||'');
  if(recommendation) {
    const headings=rows.flatMap((row,i)=>/^BILAGA TILL RESOLUTIONSFÖRSLAGET(?:\n|$)/u.test(row.value)?[i]:[]);
    const end=headings.length===1?rows.findIndex((row,i)=>i>headings[0]&&row.normal==='MOTIVERING'):-1;
    const hits=rows.flatMap((row,i)=>i>headings[0]&&i<end&&row.normal==='Rekommendation '+recommendation[1]?[i]:[]);
    if(headings.length===1&&end>headings[0]&&hits.length===1) {
      const start=hits[0],target=start+2,part=rows.slice(start,start+4),next=rows.findIndex((row,i)=>i>start&&i<end&&row.normal==='Rekommendation '+(Number(recommendation[1])+1));
      if(part.length===4&&part.every((row,i)=>row.complete&&row.source.container==='body'&&(!i||consecutive(part[i-1],row)))
        &&next>target+1&&rows.slice(start+1,next).every((row,i)=>row.complete&&row.source.container==='body'&&consecutive(rows[start+i],row))
        &&rows.slice(start+1,next).filter(row=>/^1[.)]\s+\S/u.test(row.normal)).length===1
        &&/^1[.)]\s+\S/u.test(rows[target].normal)&&/^2[.)]\s+\S/u.test(rows[target+1].normal)
        &&whitespace(rows[target].value)===whitespace(options.originalText)) {
        evidence.push({basis:'published-recommendation',recommendation:recommendation[1],point:'1'});
        return placed({span:{start:target,end:target}});
      }
    }
    return unresolved('target_not_found');
  }
  const structure = motionStructure(text, options.language), {units} = structure;
  if (!units.length) return unresolved('baseline_unavailable');
  if (structure.selection?.multipleOpenings) {
    // The report identity alone cannot distinguish decisions that restart at 1.
    // Require the amendment's published section label; wording is checked only
    // against units in that section below, never against another decision.
    const label = value => comparisonHeading(value, options.language).category === 'motion-resolution';
    const references = options.documentReferences || [];
    const sectionLabels = references.filter(reference => reference.field === 'DocAmend');
    const headings = options.baselineSource?.headings || [];
    if (sectionLabels.some(reference => !label(reference.raw)) || !(sectionLabels.some(reference => label(reference.raw))
      || headings.length && headings.every(heading => label(heading.left?.raw)))) return unresolved('baseline_unavailable');
    evidence.push({basis: 'published-resolution-section', heading: structure.selection.heading, opening: structure.start});
  }
  let ref = placementReference(options.targetLabel, options.language, options.proposedText);
  const categoryPlacement=recitalCategoryPlacement(text,rows,structure,options,operation);
  if(categoryPlacement)return categoryPlacement;
  // A-10-2026-0080 AM2/3 print Latin B; the source uses Greek ordinal Β.
  // Recognise this published alias only in the source's Α, Β, Γ convention.
  const recitalLabels=units.filter(unit=>unit.kind==='recital').map(unit=>unit.label);
  if(options.language==='el'&&ref?.kind==='recital'&&ref.base==='B'
    &&!recitalLabels.includes('B')&&recitalLabels.slice(0,3).join('|')==='Α|Β|Γ') {
    evidence.push({basis:'published-ordinal-alias',publishedLabel:ref.label,sourceLabel:'Β'+ref.suffix,ordinal:2});
    ref={...ref,label:'Β'+ref.suffix,base:'Β'};
  }
  const contextInsertion=operation==='replace'&&ref?.kind==='paragraph'&&ref.isNew&&Boolean(ref.suffix)&&!ref.parents?.length;
  if(contextInsertion)operation='insert';
  // A one-step numbering drift needs two independent signals: the amendment's
  // uniquely matching original and an agreeing vote reference. Keep this vote
  // input separate from ordinary label-first placement in the endpoint wrapper.
  const driftVotes=options.numberingReferenceTexts??(referenceText?[referenceText]:[]);
  if(!options.requireUniqueOriginal&&options.language==='en'&&['replace','delete'].includes(operation)
    &&ref?.kind==='paragraph'&&!ref.isNew&&!ref.suffix&&!ref.after&&!ref.parents.length
    &&/^[1-9]\d{0,5}$/u.test(ref.label)&&driftVotes.length&&!/\n(?:_{5,}\s*\n|[1-9]\d*\.\s+)/u.test(options.originalText)) {
    const votes=driftVotes.map(value=>/^(?:§|Paragraph)\s*([1-9]\d{0,5})$/iu.exec(whitespace(value))?.[1]);
    const original=wordingNormal(options.originalText),target=votes[0];
    if(votes.every(value=>value===target)&&target&&Math.abs(Number(target)-Number(ref.label))===1
      &&original.length>=80&&original.length<=10000) {
      const matches=units.filter(unit=>unit.kind==='paragraph'&&unit.label===target);
      if(matches.length===1&&characterSimilarity(wordingNormal(text.paragraphs.slice(matches[0].start,matches[0].end+1).join(' ')),original,.95)>=.95) {
        const drift=resolveAmendmentPlacement(text,{...options,targetLabel:'Paragraph '+target,referenceText:'§ '+target,numberingReferenceTexts:[],requireUniqueOriginal:true});
        if(drift.status==='placed')return {...drift,evidence:[...drift.evidence,{basis:'original-and-vote-numbering-drift',publishedLabel:ref.label,sourceLabel:target,references:driftVotes}]};
      }
    }
  }
  const collision=resolutionPointCollision(text,rows,structure,{...options,referenceText},operation,ref);
  if(collision)return collision;
  const nearPoint=resolutionPointNearPlacement(text,rows,structure,{...options,referenceText},operation);
  if(nearPoint)return nearPoint;
  const pointPlacement = resolutionPointPlacement(text, rows, structure, {...options, referenceText}, operation);
  if (pointPlacement) return pointPlacement;
  const parentMatches = (unit, reference) => {
    if (reference.kind !== 'point') return true;
    let parent = units.find(candidate => candidate.start === unit.parent);
    for (const wanted of [...(reference.parents || [{kind: 'paragraph', label: reference.paragraph}])].reverse()) {
      if (!parent || parent.kind !== wanted.kind || parent.label !== wanted.label) return false;
      parent = units.find(candidate => candidate.start === parent.parent);
    }
    return true;
  };
  const matching = reference => units.filter(unit => unit.kind === reference.kind && unit.label === reference.label && parentMatches(unit, reference));
  const complete = (start, end) => rows.slice(start, end + 1).every((row, index) => row.complete && row.source.container === 'body' && (!index || consecutive(rows[start + index - 1], row)));
  const span = unit => ({start: unit.start, end: unit.end});
  if (operation === 'insert') {
    // Terminal unnumbered dash items acquire their ordinal from this one
    // complete paragraph, not from dashes elsewhere in the document.
    const indent=options.language==='en'&&/^Paragraph ([1-9]\d*) – indent ([1-9]\d*) a \(new\)$/u.exec(options.targetLabel||'');
    if(indent&&!referenceText&&options.originalText===''&&/^[-–—•]\s+\S/u.test(options.proposedText)) {
      const owners=units.filter(unit=>unit.kind==='paragraph'&&unit.label===indent[1]),owner=owners[0],count=Number(indent[2]);
      if(owners.length===1&&count<=100&&!structure.invalid.has(owner.start)&&!structure.uncertain.has(owner.start)&&!structure.incompleteLabels.has(owner.label)
        &&/:\s*$/u.test(rows[owner.start].normal)&&owner.end-owner.start===count&&complete(owner.start,owner.end+1)
        &&Number.isFinite(text.paragraphFormats?.[owner.start]?.indent)
        &&Number.isFinite(text.paragraphFormats?.[owner.start+1]?.indent)
        &&text.paragraphFormats[owner.start+1].indent>text.paragraphFormats[owner.start].indent
        &&rows.slice(owner.start+1,owner.end+1).every((row,index)=>{
          const format=text.paragraphFormats[owner.start+1+index],first=text.paragraphFormats[owner.start+1];
          return !/[\r\n]/u.test(row.value)&&/^[-–—•]\s+\S/u.test(row.normal)
            &&format?.indent===first.indent&&Number.isFinite(format?.hanging)&&format.hanging===first.hanging;
        })
        &&units.some(unit=>unit.kind==='paragraph'&&unit.label===String(Number(indent[1])+1)&&unit.start===owner.end+1)) {
        evidence.push({basis:'terminal-indent-order',paragraph:indent[1],indent:count});
        return placed({insertAfter:owner.end,insertBefore:owner.end+1});
      }
    }
    if(ref?.kind==='citation'&&ref.isNew&&!ref.suffix&&!ref.parents.length&&/^[1-9]\d{0,5}$/u.test(ref.label)){
      const citations=units.filter(unit=>unit.kind==='citation').sort((a,b)=>a.start-b.start),at=Number(ref.label)-1,following=citations[at],prior=citations[at-1];
      if(at<1||!following||!prior||citations.some((unit,i)=>unit.label!==String(i+1)||unit.start!==unit.end)||prior.end+1!==following.start||!complete(structure.start,following.end)||[prior,following].some(unit=>structure.invalid.has(unit.start)||structure.uncertain.has(unit.start)))return unresolved('insertion_reference_unavailable');
      if(referenceText||!/^[–—−-]\s*\S/u.test(options.proposedText))return unresolved('conflicting_target_evidence');
      evidence.push({basis:'citation-number-collision',label:ref.label,anchor:prior.label});
      return placed({insertAfter:prior.end,insertBefore:following.start});
    }
    if(ref?.kind==='recital'&&ref.isNew&&!ref.parents.length) {
      const recitals=units.filter(unit=>unit.kind==='recital'),first=units.find(unit=>unit.kind==='paragraph');
      const ordinal=value=>/^[A-Z]+$/u.test(value)?[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0):null;
      const beyond=recitals.length&&!recitals.some(unit=>unit.label===ref.base)&&ordinal(ref.base)!==null&&ordinal(recitals.at(-1).label)!==null&&ordinal(ref.base)>ordinal(recitals.at(-1).label);
      if(first?.label==='1'&&(!recitals.length&&['-A','A'].includes(ref.label)||beyond)) {
        const last=recitals.at(-1);
        if(first.start<1||!complete(structure.start,first.start)||recitals.some((unit,i)=>ordinal(unit.label)!==i+1||structure.invalid.has(unit.start)||structure.uncertain.has(unit.start))||last&&last.end!==first.start-1)return unresolved('source_passage_incomplete');
        evidence.push({basis:'published-reference',label:ref.label,anchor:last?.label??'body-start'});
        return placed({insertAfter:first.start-1,insertBefore:first.start});
      }
    }
    // A negative first label (-1, -1a, -A, point -a) precedes the first
    // published sibling of its kind, after any heading that opens that part.
    // A negative number is never printed, so an empty original marks it new.
    const firstLabel={paragraph:'1',recital:'A',point:'a'}[ref?.kind];
    if(ref?.negative&&firstLabel&&new RegExp(`^-${firstLabel}[a-z]?$`,'u').test(ref.label)&&(ref.isNew||!String(options.originalText??'').trim())) {
      const paragraphs=units.filter(unit=>unit.kind==='paragraph');
      const siblings=units.filter(unit=>unit.kind===ref.kind&&parentMatches(unit,ref)).sort((a,b)=>a.start-b.start);
      const first=siblings[0];
      if(first?.label!==firstLabel||siblings.filter(unit=>unit.label===firstLabel).length!==1||first.start<1||!complete(first.start,first.end)||!consecutive(rows[first.start-1],rows[first.start]))return unresolved('insertion_reference_unavailable');
      // Recitals precede the operative paragraphs; a later recital A belongs
      // to an annexed opinion, not to this resolution.
      if(ref.kind==='recital'&&!(paragraphs[0]&&first.start<paragraphs[0].start))return unresolved('insertion_reference_unavailable');
      if(ref.kind==='point'&&ref.parents.length!==1)return unresolved('insertion_reference_unavailable');
      // An incomplete row can hide another first label or parent paragraph.
      if(structure.incompleteLabels.has(ref.kind==='point'?ref.paragraph:firstLabel))return unresolved('source_passage_incomplete');
      if(ref.kind==='point') {
        const owners=paragraphs.filter(unit=>unit.label===ref.paragraph);
        if(owners.length!==1||!complete(owners[0].start,first.start))return unresolved('source_passage_incomplete');
      }
      if(referenceText) {
        const relative=parseReference(referenceText),same=placementReference(referenceText,'en');
        const before=relative?.relation==='before'&&relative.kind===ref.kind&&(ref.kind==='paragraph'?relative.number==='1':ref.kind==='recital'?relative.letter==='A':relative.number===ref.paragraph&&relative.point==='a');
        if(!before&&!(same?.kind===ref.kind&&same.label===ref.label&&same.negative&&JSON.stringify(same.parents)===JSON.stringify(ref.parents)))return unresolved('conflicting_target_evidence');
        evidence.push({basis:'relative-reference',reference:referenceText});
      }
      evidence.push({basis:'published-reference',label:ref.label,anchor:first.label});
      return {operation,status:'placed',insertAfter:first.start-1,insertBefore:first.start,evidence};
    }
    // A new recital that continues the published A, B, C… sequence (G after
    // F) follows the last recital, which must precede the operative paragraphs.
    if(ref?.kind==='recital'&&ref.isNew&&!ref.negative&&!ref.suffix&&!ref.after&&/^[A-Z]$/u.test(ref.label)) {
      const paragraphs=units.filter(unit=>unit.kind==='paragraph'),recitals=units.filter(unit=>unit.kind==='recital').sort((a,b)=>a.start-b.start);
      const last=recitals.at(-1);
      if(last&&recitals.every((unit,index)=>unit.label===String.fromCharCode(65+index))&&ref.label===String.fromCharCode(65+recitals.length)&&paragraphs.length&&last.start<paragraphs[0].start) {
        if(referenceText) {
          const relative=parseReference(referenceText);
          if(!relative||relative.kind!=='recital'||relative.relation!=='after'||relative.letter!==last.label)return unresolved('conflicting_target_evidence');
          evidence.push({basis:'relative-reference',reference:referenceText});
        }
        if(structure.invalid.has(last.start)||structure.uncertain.has(last.start)||!complete(last.start,last.end))return unresolved('source_passage_incomplete');
        evidence.push({basis:'published-sequence',label:ref.label,anchor:last.label});
        return {operation,status:'placed',insertAfter:last.end,insertBefore:last.end+1,evidence};
      }
    }
    if (!ref || ref.negative || (!ref.suffix && !ref.after) || !['paragraph', 'recital', 'point', 'citation'].includes(ref.kind)) return unresolved('insertion_reference_unavailable');
    // A Latin sequence may contain visually identical Greek M/N glyphs in a
    // published English motion. Require the entire sequence and both neighbours.
    if(options.language==='en'&&ref.kind==='recital'&&ref.isNew&&['M','N'].includes(ref.base)&&ref.suffix&&!ref.parents?.length&&!ref.after&&!referenceText
      &&new RegExp('^'+ref.base+ref.suffix+'[.)]\\s+whereas\\b','u').test(options.proposedText)) {
      const aliases={'Μ':'M','Ν':'N'},recitals=units.filter(unit=>unit.kind==='recital').sort((a,b)=>a.start-b.start);
      const normal=label=>aliases[label]||label,at=recitals.findIndex(unit=>normal(unit.label)===ref.base),first=units.find(unit=>unit.kind==='paragraph');
      if(at>0&&at<recitals.length-1&&recitals[at].label!==ref.base&&first?.label==='1'
        &&![...structure.incompleteLabels].some(label=>/^\p{Lu}/u.test(label))
        &&recitals.every((unit,i)=>normal(unit.label)===String.fromCharCode(65+i)&&unit.end<first.start&&(!i||recitals[i-1].end+1===unit.start)
          &&!structure.invalid.has(unit.start)&&!structure.uncertain.has(unit.start)&&!structure.incompleteLabels.has(unit.label)&&complete(unit.start,unit.end))
        &&recitals[at].end+1===recitals[at+1].start&&complete(recitals[at].start,recitals[at+1].start)) {
        evidence.push({basis:'published-ordinal-alias',publishedLabel:ref.label,sourceLabel:recitals[at].label+ref.suffix});
        return placed({insertAfter:recitals[at].end,insertBefore:recitals[at+1].start});
      }
    }
    if (!ref.after && matching(ref).length) return unresolved('duplicate_target_label');
    if (ref.kind === 'point') {
      const path = ref.parents || [], parent = path.at(-1);
      const candidates = units.filter(unit => unit.kind === parent?.kind && unit.label === parent.label
        && (path.length === 1 || parentMatches({...unit, kind: 'point'}, {...ref, parents: path.slice(0,-1)})));
      if (candidates.length !== 1) return unresolved(candidates.length ? 'multiple_published_targets' : 'parent_target_not_found');
    }
    const rank = suffix => {
      const latin = ['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];
      if (!suffix || latin.includes(suffix)) return suffix ? latin.indexOf(suffix) + 1 : 0;
      return /^[a-zα-ωа-я]{0,3}$/u.test(suffix) ? suffix : null;
    };
    const siblings = units.filter(unit => unit.kind === ref.kind && parentMatches(unit, ref)
      && (unit.label === ref.base || !ref.after && unit.label.startsWith(ref.base) && rank(unit.label.slice(ref.base.length)) !== null && rank(unit.label.slice(ref.base.length)) < rank(ref.suffix)));
    // A base label merged into its predecessor's row (K then M, 71 then 73)
    // ends where that row ends, directly before the next neighbour.
    const gap = !siblings.length && !ref.after && !ref.parents?.length && ['paragraph', 'recital'].includes(ref.kind)
      && !structure.incompleteLabels.has(ref.base) ? numberingGapAnchor(text, units.filter(unit => unit.kind === ref.kind), ref.base) : null;
    if (gap) {
      siblings.push(gap);
      evidence.push({basis: 'merged-provision', merged: ref.base, anchor: gap.label});
    } else if (!siblings.some(unit => unit.label === ref.base)) return unresolved('relative_target_not_found');
    const ordered = siblings.sort((a, b) => a.start - b.start), anchor = ordered.at(-1);
    if (new Set(siblings.map(unit => unit.label)).size !== siblings.length || siblings.some(unit => unit.parent !== anchor.parent)) return unresolved('multiple_published_targets');
    if(contextInsertion) {
      // A new paragraph label can quote its existing base as context. Preserve
      // that paragraph and require its entire original before inserting after it.
      const base=siblings.find(unit=>unit.label===ref.base);
      if(!base||structure.invalid.has(base.start)||structure.uncertain.has(base.start)||!complete(base.start,base.end))return unresolved('source_passage_incomplete');
      if(wordingNormal(text.paragraphs.slice(base.start,base.end+1).join(' '))!==wordingNormal(options.originalText))return unresolved('conflicting_target_evidence');
      evidence.push({basis:'quoted-predecessor-context',label:base.label});
    }
    evidence.push({basis: 'published-reference', label: ref.label, anchor: anchor.label});
    if (referenceText) {
      const relative = parseReference(referenceText);
      // Independent decision evidence may name the unsuffixed parent (After §19).
      if (!relative || relative.relation !== 'after' || relative.kind !== ref.kind || (ref.kind === 'point' ? relative.point !== ref.base || relative.number !== ref.paragraph : (relative.number ?? relative.letter) !== ref.base)) return unresolved('conflicting_target_evidence');
      evidence.push({basis: 'relative-reference', reference: referenceText});
    }
    // An ordinal citation also needs the complete preceding preamble: a lost
    // dash item would renumber every later citation.
    if (ref.kind === 'citation' && !complete(structure.start, anchor.end)) return unresolved('source_passage_incomplete');
    if (structure.invalid.has(anchor.start) || structure.incompleteLabels.has(anchor.label) || !complete(anchor.start, anchor.end)) return unresolved('source_passage_incomplete');
    if (structure.uncertain.has(anchor.start) && !(anchor.kind === 'point'
      && !structure.extentUncertain.has(anchor.start)
      && complete(anchor.parent, anchor.end))) return unresolved('resolution_extent_uncertain');
    if (anchor.end === structure.end && !structure.endAvailable) return unresolved('resolution_end_unavailable');
    // Check the other side of the insertion independently of the anchor's
    // extent: it must be the verified heading, the next sibling, or a body end.
    const nextIndex = anchor.end + 1, next = rows[nextIndex];
    const nextSibling = units.find(unit => unit.start === nextIndex && unit.level === anchor.level && unit.parent === anchor.parent);
    // The final point can end with its parent paragraph. The following
    // paragraph independently verifies that parent's closing boundary.
    const parent = units.find(unit => unit.start === anchor.parent);
    const afterParent = parent?.kind === 'paragraph' && parent.end === anchor.end
      && !structure.invalid.has(parent.start) && !structure.uncertain.has(parent.start)
      && complete(parent.start, parent.end) && units.some(unit => unit.start === nextIndex
        && unit.kind === parent.kind && unit.level === parent.level && unit.parent === parent.parent);
    if (resolutionSeparator(rows[anchor.end].value) || !next?.complete || !consecutive(rows[anchor.end], next)
      || !(structure.certainHeadings.has(nextIndex) || nextSibling || afterParent || units.some(unit => unit.start === nextIndex && unit.kind === 'heading') || anchor.end === structure.end && structure.endAvailable))
      return unresolved('resolution_extent_uncertain');
    return placed({insertAfter: anchor.end, insertBefore: anchor.end + 1});
  }
  if (ref) {
    const matches = matching(ref);
    if (matches.length > 1) return unresolved('multiple_published_targets');
    if (!matches.length) return unresolved(structure.incompleteLabels.has(ref.label) ? 'source_passage_incomplete' : 'target_not_found');
    const unit = matches[0];
    // An amendment can quote only the lead while leaving its points intact.
    if(operation==='replace'&&unit.kind==='paragraph'&&complete(unit.start,unit.end)&&!structure.invalid.has(unit.start)&&!structure.uncertain.has(unit.start)
      &&!structure.incompleteLabels.has(unit.label)&&/:$/u.test(rows[unit.start].normal)
      &&units.some(child=>child.kind==='point'&&child.label==='a'&&child.parent===unit.start&&child.start===unit.start+1)
      &&whitespace(rows[unit.start].value)===whitespace(options.originalText)) {
      evidence.push({basis:'exact-paragraph-lead',label:unit.label});
      return placed({span:{start:unit.start,end:unit.start}});
    }
    const source = text.paragraphs.slice(unit.start, unit.end + 1).join(' ');
    const sourceKey = wordingNormal(source), originalKey = wordingNormal(options.originalText);
    // B-10-2026-0424 prints dash-led citations, while its amendments print
    // their numeric ordinals. Only the resolved citation's source marker is
    // presentation; the complete preamble must establish that exact ordinal.
    const numberedCitation = unit.kind === 'citation'
      && /^([1-9]\d*)\.\s+/u.exec(whitespace(options.originalText))?.[1] === unit.label
      && complete(structure.start, unit.end);
    const footnotes = sourceKey !== originalKey && ['paragraph', 'recital', 'point', 'citation'].includes(unit.kind)
      && resolutionFootnoteMatch(text, unit.start, unit.end, options.originalText, options.originalFormatting);
    // A unique labelled whole provision can survive small transcription damage
    // or a replaced tail. Compare all same-kind provisions in this motion so
    // repeated boilerplate cannot make a near match appear unique.
    // Detached notes require their own body, payload and anchor proof. A small
    // payload must never be mistaken for a damaged tail by edit distance.
    let nearMatch=false;
    if((sourceKey!==originalKey||options.requireUniqueOriginal)&&!/\n(?:_{5,}\s*\n|[1-9]\d*\.\s+)/u.test(options.originalText)&&['paragraph','recital'].includes(unit.kind)&&originalKey.length>=80&&originalKey.length<=10000) {
      const score=value=>{
        let prefix=0;while(prefix<Math.min(value.length,originalKey.length)&&value[prefix]===originalKey[prefix])prefix++;
        return {similarity:characterSimilarity(value,originalKey,.93),prefix:prefix>=80&&prefix<Math.min(value.length,originalKey.length)?prefix/Math.min(value.length,originalKey.length):0};
      };
      // The segmenter intentionally omits damaged labelled rows from placeable
      // units. Keep their surviving wording as competing evidence nonetheless.
      const topLabel=/^(?:[1-9]\d{0,5}\s*[a-zα-ωа-я]{0,3}|[\p{Lu}]{1,3}[\p{Ll}]{0,3})[.)]\s+/u;
      const ownKind=unit.kind==='paragraph'?/^[1-9]\d{0,5}\s*[a-zα-ωа-я]{0,3}[.)]\s+/u:/^[\p{Lu}]{1,3}[\p{Ll}]{0,3}[.)]\s+/u;
      const damaged=rows.filter(row=>row.index>structure.start&&row.index<=structure.end&&!row.complete&&row.source.container==='body'&&ownKind.test(row.normal)).map(row=>{
        let end=row.index;
        while(end<structure.end&&end<row.index+29&&rows[end+1].source.container==='body'&&consecutive(rows[end],rows[end+1])
          &&!topLabel.test(rows[end+1].normal)&&!units.some(candidate=>candidate.kind==='heading'&&candidate.start===end+1))end++;
        return {start:row.index,end};
      });
      const own=score(sourceKey),others=[...units.filter(candidate=>candidate.kind===unit.kind&&candidate!==unit),...damaged]
        .map(candidate=>score(wordingNormal(text.paragraphs.slice(candidate.start,candidate.end+1).join(' '))));
      nearMatch=own.similarity>=.95&&others.every(other=>other.similarity<=own.similarity-.02&&other.prefix<.5)
        ||own.prefix>=.5&&others.every(other=>other.prefix<=own.prefix-.02&&other.similarity<.93);
    }
    const wordingMatches = nearMatch || !options.requireUniqueOriginal&&(sourceKey === originalKey || footnotes
      || numberedCitation && sourceKey.replace(/^[–—−\-•]\s*/u, '') === originalKey);
    // Exact whole-unit wording independently proves a labelled paragraph or
    // recital's extent, even when the following boundary is unclassified.
    // Never use it to recover incomplete rows, duplicate labels or point scope.
    const wordingProvesExtent = ['paragraph', 'recital'].includes(unit.kind)
      && complete(unit.start, unit.end) && !structure.incompleteLabels.has(unit.label)
      && wordingNormal(source) === wordingNormal(options.originalText);
    if (!wordingProvesExtent && (structure.invalid.has(unit.start) || structure.incompleteLabels.has(unit.label) || !complete(unit.start, unit.end))) return unresolved('source_passage_incomplete');
    if (!wordingProvesExtent && structure.uncertain.has(unit.start)) return unresolved('resolution_extent_uncertain');
    if (!wordingMatches) return unresolved('conflicting_target_evidence');
    if (referenceText) {
      const decision = placementReference(referenceText);
      if (!decision || decision.kind !== ref.kind || decision.label !== ref.label || decision.kind === 'point' && decision.paragraph !== ref.paragraph) return unresolved('conflicting_target_evidence');
    }
    evidence.push({basis: 'published-reference', label: ref.label}, {basis: footnotes ? 'quoted-original-source-notes' : nearMatch ? 'unique-similar-original' : 'quoted-original'});
    return placed({span: span(unit)});
  }
  const quotes = quotedTargets(rows.slice(structure.start + 1, structure.end + 1), whitespace(options.originalText));
  if (quotes === null) return unresolved('matching_budget');
  if (quotes.length !== 1) return unresolved(quotes.length ? 'multiple_quoted_targets' : 'target_not_found');
  const indices = quotes[0], start = indices[0], end = indices.at(-1);
  if (!complete(start, end)) return unresolved('source_passage_incomplete');
  // Every quote must belong to an established provision inside the resolution.
  const owners = units.filter(unit => unit.kind !== 'heading' && !structure.invalid.has(unit.start) && start >= unit.start && end <= unit.end);
  if (!owners.length) return unresolved('target_not_found');
  if (owners.some(unit => structure.uncertain.has(unit.start))) return unresolved('resolution_extent_uncertain');
  if (referenceText) {
    const decision = placementReference(referenceText), matches = decision ? matching(decision) : [];
    if (matches.length !== 1 || start < matches[0].start || end > matches[0].end) return unresolved('conflicting_target_evidence');
  }
  evidence.push({basis: 'quoted-original'});
  return placed({span: {start, end}});
}

// Paragraphs which explicitly introduce a complete body table own its final
// cell boundary. A numbered successor closes it; ordinary source gaps remain
// unavailable. This does not join replacement quotations across table cells.
export function resolveTableInsertion(text,options={}) {
  if(options.language!=='en'||options.originalText!=='')return null;
  const ref=placementReference(options.targetLabel,'en',options.proposedText);
  if(ref?.kind!=='paragraph'||!ref.isNew||!ref.suffix||ref.negative)return null;
  const structure=motionStructure(text,'en'),rows=sourceStructure(text);
  const owners=structure.units.filter(unit=>unit.kind==='paragraph'&&unit.label===ref.base);
  if(!rows||owners.length!==1)return null;
  const anchor=owners[0],prior=rows[anchor.start];
  if(!prior.complete||!/:$/u.test(prior.normal))return null;
  const candidates=(text.tables||[]).filter(table=>table.bodyBoundary?.before===prior.source.path);
  if(candidates.length!==1)return null;
  const table=candidates[0],cells=table.rows?.flat(),first=cells?.[0]?.start,end=cells?.at(-1)?.end;
  if(first!==anchor.start+1||!Number.isInteger(end)||end<=first||!rows[end]?.complete||rows[end].source.container!=='body'||rows[end].source.path!==table.bodyBoundary.after)return null;
  const following=structure.units.find(unit=>unit.start===end&&unit.kind==='paragraph'&&unit.label===String(Number(ref.base)+1));
  if(!following||rows.slice(first,end).some(row=>!row.complete||row.source.container!=='table-cell'))return null;
  let cursor=first;
  for(const cell of cells){if(cell.start!==cursor||cell.end<cursor||cell.end>end||cell.gap)return null;cursor=cell.end;}
  if(cursor!==end)return null;
  return {operation:'insert',status:'placed',insertAfter:end-1,insertBefore:end,evidence:[{basis:'published-reference',label:ref.label,anchor:ref.base},{basis:'complete-body-table-boundary'}]};
}

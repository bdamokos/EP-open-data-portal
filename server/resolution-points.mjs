import {parseTargetLabel} from './proposal-labels.mjs';
import {resolutionSubheading, resolutionSeparator} from './resolution-body.mjs';

const pointLabel = value => /^(?:\(([a-z]{1,4})\)|([a-z]{1,4})\)|([ivxlcdm]+)\.)\s+/u.exec(value);
const pointValue = match => match[1] || match[2] || match[3];
const alphabetic = value => [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 96, 0);
const samePath = (a, b) => a.length === b.length && a.every((part, i) => part.kind === b[i].kind && part.value === b[i].value);
const contiguous = (a, b) => a?.complete && b?.complete && a.source.container === 'body' && b.source.container === 'body'
  && a.source.containerPath === b.source.containerPath && a.source.segment === b.source.segment && b.source.ordinal === a.source.ordinal + 1;

// Recommendation A-10-2026-0103 keeps one paragraph across topic headings;
// budget report A-10-2026-0272 prints Roman children as "i.". Indentation,
// rather than a Roman-compatible letter, establishes the child level.
function pointUnits(text, rows, structure) {
  const units = [], stack = [];
  let paragraph = null, previousPoint = null;
  const close = (end, broken = false, keepParagraph = false) => {
    while (stack.length && (!keepParagraph || stack.at(-1).kind === 'point')) {
      const unit = stack.pop(); unit.end = end; unit.broken ||= broken;
    }
    if (!keepParagraph) { paragraph = null; previousPoint = null; }
  };
  for (let i = structure.start + 1; i <= structure.end; i++) {
    const row = rows[i], format = text.paragraphFormats?.[i], value = row.normal;
    if (!contiguous(rows[i - 1], row)) close(i - 1, true);
    if (!row.complete || row.source.container !== 'body') { close(i - 1, true); continue; }
    const number = /^([1-9]\d{0,5}[a-z]{0,3})[.)]\s+/u.exec(value);
    if (number) {
      close(i - 1);
      paragraph = {kind: 'paragraph', value: number[1], start: i, indent: format?.indent, path: [{kind: 'paragraph', value: number[1]}]};
      stack.push(paragraph); units.push(paragraph); continue;
    }
    const point = pointLabel(value);
    if (point && paragraph) {
      const indent = format?.indent;
      if (!Number.isFinite(indent) || !Number.isFinite(paragraph.indent) || indent <= paragraph.indent) { close(i - 1, true); continue; }
      while (stack.at(-1)?.kind === 'point' && stack.at(-1).indent >= indent) stack.pop().end = i - 1;
      const parent = stack.at(-1), label = pointValue(point);
      // A deeper source row needs an existing point. A first Roman child starts
      // at i; later siblings inherit that established level, never a letter guess.
      if (parent.kind === 'point' && (!/^[ivxlcdm]+$/u.test(label) || !parent.children && label !== 'i')) { close(i - 1, true); continue; }
      const unit = {kind: 'point', value: label, start: i, indent, parent, path: [...parent.path, {kind: 'point', value: label}]};
      parent.children = true; stack.push(unit); units.push(unit);
      if (parent === paragraph) previousPoint = unit;
      continue;
    }
    if (resolutionSubheading(row.value, format)) {
      const next = rows[i + 1], match = next && pointLabel(next.normal), label = match && pointValue(match);
      const expected = previousPoint ? alphabetic(previousPoint.value) + 1 : 1;
      const continues = paragraph && /:\s*$/u.test(rows[paragraph.start].value) && match && contiguous(row, next)
        && Number.isFinite(text.paragraphFormats?.[i + 1]?.indent) && text.paragraphFormats[i + 1].indent > paragraph.indent
        && (!previousPoint || text.paragraphFormats[i + 1].indent === previousPoint.indent) && alphabetic(label) === expected;
      close(i - 1, false, Boolean(continues));
      continue;
    }
    if (resolutionSeparator(value) || structure.units.some(unit => unit.kind === 'heading' && unit.start === i)) close(i - 1);
  }
  close(structure.end, !structure.endAvailable);
  return units.filter(unit => unit.kind === 'point').map(unit => ({...unit,
    complete: !unit.broken && rows.slice(unit.start, unit.end + 1).every((row, offset) => row.complete && row.source.container === 'body'
      && (!offset || contiguous(rows[unit.start + offset - 1], row))),
  }));
}

export function resolutionPointPlacement(text, rows, structure, options, operation) {
  let target;
  try { target = parseTargetLabel(options.targetLabel, options.language); } catch { return null; }
  const segments = target.segments;
  if (!target.complete || segments?.length < 2 || segments[0].kind !== 'paragraph' || segments.slice(1).some(part => part.kind !== 'point')) return null;
  if (segments.length === 2 && structure.units.some(unit => unit.kind === 'point'
    && unit.label === (operation === 'insert' ? segments[1].base : segments[1].value)
    && structure.units.find(parent => parent.start === unit.parent)?.label === segments[0].value)) return null;
  const units = pointUnits(text, rows, structure), evidence = [{basis: 'published-point-path', path: segments.map(({kind, value}) => ({kind, value}))}];
  const unresolved = reason => ({operation, status: 'unresolved', reason, evidence});
  const matches = units.filter(unit => samePath(unit.path, segments));
  if (operation === 'insert') {
    if (matches.length) return unresolved('duplicate_target_label');
    const label = segments.at(-1);
    if (!label.isNew || !label.base || !/^[a-z]{1,3}$/u.test(label.suffix)) return unresolved('insertion_reference_unavailable');
    const anchors = units.filter(unit => samePath(unit.path.slice(0, -1), segments.slice(0, -1)) && unit.value === label.base);
    if (!anchors.length && segments.length === 2) return null;
    if (anchors.length !== 1) return unresolved(anchors.length ? 'multiple_published_targets' : 'relative_target_not_found');
    const anchor = anchors[0], next = rows[anchor.end + 1];
    if (!anchor.complete) return unresolved('source_passage_incomplete');
    const siblings = units.filter(unit => unit.parent === anchor.parent).sort((a, b) => a.start - b.start);
    if (new Set(siblings.map(unit => unit.value)).size !== siblings.length) return unresolved('multiple_published_targets');
    const at = siblings.indexOf(anchor), following = siblings[at + 1];
    if (following && alphabetic(following.value) !== alphabetic(anchor.value) + 1) return unresolved('resolution_extent_uncertain');
    if (!next || !contiguous(rows[anchor.end], next) || !(following?.start === anchor.end + 1
      || resolutionSubheading(next.value, text.paragraphFormats?.[anchor.end + 1])
      || units.some(unit => unit.start === anchor.end + 1 && samePath(unit.path, anchor.path.slice(0, -1)))
      || /^[1-9]\d{0,5}[.)]\s+/u.test(next.normal) || anchor.end === structure.end && structure.endAvailable)) return unresolved('resolution_extent_uncertain');
    if (options.referenceText) return unresolved('conflicting_target_evidence');
    evidence.push({basis: 'preceding-point-subtree', anchor: anchor.start});
    return {operation, status: 'placed', insertAfter: anchor.end, insertBefore: anchor.end + 1, evidence};
  }
  // Preserve the established flat-point reader for older projections without
  // indentation. Nested paths never fall through to a document-wide quote.
  if (!matches.length) return segments.length === 2 ? null : unresolved('target_not_found');
  if (matches.length !== 1) return unresolved('multiple_published_targets');
  const unit = matches[0];
  if (!unit.complete) return unresolved('source_passage_incomplete');
  const labels = units.filter(child => child.start >= unit.start && child.end <= unit.end).map(child => child.value);
  const normalize = value => value.split(/[\r\n]/u).map(line => {
    const match = pointLabel(line.trim());
    return match && labels.includes(pointValue(match)) ? line.trim().slice(match[0].length) : line;
  }).join(' ').normalize('NFC').replace(/\u00ad/g, '').replace(/[‘’‚‛ʻʼ]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐‑‒–—]/g, '-').replace(/\s+/gu, ' ').trim();
  if (normalize(text.paragraphs.slice(unit.start, unit.end + 1).join('\n')) !== normalize(options.originalText)) return unresolved('conflicting_target_evidence');
  if (options.referenceText) {
    let decision; try { decision = parseTargetLabel(options.referenceText, 'en'); } catch { /* Unparsed references cannot verify a path. */ }
    if (!decision?.complete || !samePath(decision.segments, segments)) return unresolved('conflicting_target_evidence');
  }
  evidence.push({basis: 'quoted-original'});
  return {operation, status: 'placed', span: {start: unit.start, end: unit.end}, evidence};
}

import {characterSimilarity} from './proposal-similarity.mjs';
import {parseTargetLabel} from './proposal-labels.mjs';
import {resolutionSubheading, resolutionSeparator} from './resolution-body.mjs';
import {resolutionFootnoteMatch} from './resolution-footnotes.mjs';

const pointLabel = value => /^(?:\(([a-z]{1,4})\)|([a-z]{1,4})\)|([ivxlcdm]+)\.)\s+/u.exec(value);
const pointValue = match => match[1] || match[2] || match[3];
const alphabetic = value => [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 96, 0);
const roman = value => [...value].reduce((sum, c, i) => {
  const digits = {i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000};
  return sum + (digits[c] < (digits[value[i + 1]] || 0) ? -digits[c] : digits[c]);
}, 0);
const samePath = (a, b) => a.length === b.length && a.every((part, i) => part.kind === b[i].kind && part.value === b[i].value);
const contiguous = (a, b) => a?.complete && b?.complete && a.source.container === 'body' && b.source.container === 'body'
  && a.source.containerPath === b.source.containerPath && a.source.segment === b.source.segment && b.source.ordinal === a.source.ordinal + 1;

// Recommendation A-10-2026-0103 keeps one paragraph across topic headings;
// budget report A-10-2026-0272 prints Roman children as "i.". Indentation,
// rather than a Roman-compatible letter, establishes the child level.
function pointUnits(text, rows, structure) {
  const units = [], stack = [];
  const headings = new Set(structure.units.filter(unit => unit.kind === 'heading').map(unit => unit.start));
  const paragraphCounts = new Map();
  let paragraph = null, previousPoint = null;
  const close = (end, broken = false, keepParagraph = false) => {
    while (stack.length && (!keepParagraph || stack.at(-1).kind === 'point')) {
      const unit = stack.pop(); unit.end = end; unit.broken ||= broken;
    }
    if (!keepParagraph) { paragraph = null; previousPoint = null; }
  };
  for (let i = structure.start + 1; i <= structure.end; i++) {
    const row = rows[i], format = text.paragraphFormats?.[i], value = row.normal;
    const number = /^([1-9]\d{0,5}[a-z]{0,3})[.)]\s+/u.exec(value);
    if (number && row.source.container === 'body') paragraphCounts.set(number[1], (paragraphCounts.get(number[1]) || 0) + 1);
    const incompletePoint = !row.complete && pointLabel(value);
    if (incompletePoint && paragraph) {
      while (stack.at(-1)?.kind === 'point' && stack.at(-1).indent >= (format?.indent ?? Infinity)) stack.pop().end = i - 1;
      const parent = stack.at(-1), label = pointValue(incompletePoint);
      units.push({kind: 'point', value: label, start: i, end: i, broken: true, parent, path: [...parent.path, {kind: 'point', value: label}]});
    }
    if (!contiguous(rows[i - 1], row)) close(i - 1, true);
    if (!row.complete || row.source.container !== 'body') { close(i - 1, true); continue; }
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
    if (resolutionSeparator(value) || headings.has(i)) close(i - 1);
  }
  close(structure.end, !structure.endAvailable);
  return units.filter(unit => unit.kind === 'point').map(unit => ({...unit,
    complete: !unit.broken && paragraphCounts.get(unit.path[0].value) === 1 && rows.slice(unit.start, unit.end + 1).every((row, offset) => row.complete && row.source.container === 'body'
      && (!offset || contiguous(rows[unit.start + offset - 1], row))),
  }));
}

export function resolutionPointPlacement(text, rows, structure, options, operation) {
  let target;
  try { target = parseTargetLabel(options.targetLabel, options.language); } catch { return null; }
  const segments = target.segments;
  if (!target.complete || segments?.length < 2 || segments[0].kind !== 'paragraph' || segments.slice(1).some(part => part.kind !== 'point')) return null;
  const firstNumeric=options.language==='fr'&&operation==='insert'&&segments.length===2&&segments[1].isNew&&segments[1].base==='1'&&segments[1].suffix==='bis';
  if (segments.slice(1).some(part => !/^[a-z]+$/u.test(part.value))&&!firstNumeric) return null;
  if (!/\bEUR\s+XXX\b/u.test(options.originalText||'') && segments.length === 2 && structure.units.some(unit => unit.kind === 'point'
    && unit.label === (operation === 'insert' ? segments[1].base : segments[1].value)
    && structure.units.find(parent => parent.start === unit.parent)?.label === segments[0].value)) return null;
  const units = pointUnits(text, rows, structure), evidence = [{basis: 'published-point-path', path: segments.map(({kind, value}) => ({kind, value}))}];
  const unresolved = reason => ({operation, status: 'unresolved', reason, evidence});
  const matches = units.filter(unit => samePath(unit.path, segments));
  if(firstNumeric){
    const points=units.filter(unit=>unit.path.length===2&&unit.path[0].value===segments[0].value).sort((a,b)=>a.start-b.start),first=points[0],parent=first?.parent;
    if(!first||first.value!=='a'||!first.complete||points.some(unit=>unit.parent!==parent)||!/^1\s*bis\)\s/u.test(options.proposedText)||options.originalText!==''||options.referenceText)return unresolved('insertion_reference_unavailable');
    const start=parent.start,interior=first.start-start;
    if(![1,2].includes(interior)||!/:\s*$/u.test(rows[start].value)||interior===2&&!resolutionSubheading(rows[start+1].value,text.paragraphFormats?.[start+1])||rows.slice(start,first.start+1).some((row,i)=>!row.complete||row.source.container!=='body'||i&&!contiguous(rows[start+i-1],row)))return unresolved('source_passage_incomplete');
    evidence.push({basis:'first-numeric-point-in-lettered-list',anchor:start});
    return {operation,status:'placed',insertAfter:start,insertBefore:start+1,evidence};
  }
  if (operation === 'insert') {
    if (matches.length) return unresolved('duplicate_target_label');
    const label = segments.at(-1);
    const latinSuffix = options.language === 'fr' && /^(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies)$/u.test(label.suffix);
    if (!label.isNew || !label.base || !(/^[a-z]{1,3}$/u.test(label.suffix) || latinSuffix)) return unresolved('insertion_reference_unavailable');
    const anchors = units.filter(unit => samePath(unit.path.slice(0, -1), segments.slice(0, -1)) && unit.value === label.base);
    if (!anchors.length && segments.length === 2) return null;
    if (anchors.length !== 1) return unresolved(anchors.length ? 'multiple_published_targets' : 'relative_target_not_found');
    const anchor = anchors[0], next = rows[anchor.end + 1];
    if (!anchor.complete) return unresolved('source_passage_incomplete');
    const siblings = units.filter(unit => unit.parent === anchor.parent).sort((a, b) => a.start - b.start);
    if (new Set(siblings.map(unit => unit.value)).size !== siblings.length) return unresolved('multiple_published_targets');
    const at = siblings.indexOf(anchor), following = siblings[at + 1];
    const ordinal = anchor.parent.kind === 'point' ? roman : alphabetic;
    if (following && ordinal(following.value) !== ordinal(anchor.value) + 1) return unresolved('resolution_extent_uncertain');
    if (!next || !contiguous(rows[anchor.end], next) || !(following?.start === anchor.end + 1
      || resolutionSubheading(next.value, text.paragraphFormats?.[anchor.end + 1])
      || units.some(unit => unit.start === anchor.end + 1 && unit.path.length < anchor.path.length
        && samePath(unit.path.slice(0, -1), anchor.path.slice(0, unit.path.length - 1)))
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
  const sourceText=text.paragraphs.slice(unit.start,unit.end+1).join('\n');
  const placeholder=operation==='delete'&&options.language==='en'&&options.baseline==='motion-resolution'
    && /\bEUR\s+XXX\b/u.test(options.originalText||'')&&/\bbudget line\b/u.test(sourceText)
    && /\bEUR\s+\d/u.test(sourceText)&&!sourceText.includes('\uFFFC')
    && placeholderMatches(sourceText,options.originalText);
  const footnotes = !placeholder && normalize(sourceText) !== normalize(options.originalText);
  if (footnotes && !resolutionFootnoteMatch(text, unit.start, unit.end, options.originalText, options.originalFormatting)) return unresolved('conflicting_target_evidence');
  if (options.referenceText) {
    let decision; try { decision = parseTargetLabel(options.referenceText, 'en'); } catch { /* Unparsed references cannot verify a path. */ }
    if (!decision?.complete || !samePath(decision.segments, segments)) return unresolved('conflicting_target_evidence');
  }
  evidence.push({basis: placeholder ? 'addressed-budget-placeholder' : footnotes ? 'quoted-original-source-notes' : 'quoted-original'});
  return {operation, status: 'placed', span: {start: unit.start, end: unit.end}, evidence};
}

// A near match never chooses a point: the native paragraph/point chain and
// complete point extent must already identify it. This leaves the top-level
// paragraph/recital matcher and the strict point matcher unchanged.
export function resolutionPointNearPlacement(text,rows,structure,options,operation){
 const decision=options.baseline==='unknown'&&options.resolutionDocument===true&&options.documentReferences?.some(ref=>ref.field==='DocAmend'&&ref.raw==='Proposal for a decision')&&options.baselineSource?.headings?.length>0&&options.baselineSource.headings.every(heading=>heading.left?.raw==='Proposal for a decision'&&heading.right?.raw==='Amendment');
 if(options.language!=='en'||!(options.baseline==='motion-resolution'||decision)||!['replace','delete'].includes(operation)||/\n_{5,}\s*\n/u.test(options.originalText||'')||(options.originalFormatting||[]).some(m=>m.kind==='superscript'))return null;
 let target;try{target=parseTargetLabel(options.targetLabel,'en');}catch{return null;}
 const path=target.segments;if(!target.complete||path.length!==2||path[0].kind!=='paragraph'||path.slice(1).some(p=>p.kind!=='point'||p.isNew))return null;
 const old=pointLabel((options.originalText||'').trim()),proposed=pointLabel((options.proposedText||'').trim());
 if(!old||pointValue(old)!==path.at(-1).value||operation==='replace'&&(!proposed||pointValue(proposed)!==path.at(-1).value))return null;
 const points=pointUnits(text,rows,structure),matches=points.filter(p=>samePath(p.path,path));
 if(matches.length!==1||!matches[0].complete)return null;
 const unit=matches[0];if(points.some(p=>p!==unit&&p.start>unit.start&&p.end<=unit.end))return null;
 const next=rows[unit.end+1],nextLabel=next&&pointLabel(next.normal);
 if(!next||!contiguous(rows[unit.end],next)||!(nextLabel&&text.paragraphFormats?.[unit.end+1]?.indent<=unit.indent||/^\d+[.)]\s/u.test(next.normal)||structure.units.some(u=>u.kind==='heading'&&u.start===unit.end+1)))return null;
 const textOf=u=>text.paragraphs.slice(u.start,u.end+1).join('\n'),labels=u=>points.filter(p=>p.start>=u.start&&p.end<=u.end).map(p=>p.value);
 const normal=(value,known)=>value.split(/\r?\n/u).map(line=>{const m=pointLabel(line.trim());return m&&known.includes(pointValue(m))?line.trim().slice(m[0].length):line;}).join(' ').normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/[‐‑‒–—]/gu,'-').replace(/\s+/gu,' ').trim();
 const source=normal(textOf(unit),labels(unit)),original=normal(options.originalText,labels(unit));
 if(source===original||original.length<80||original.length>10000||source.includes('\uFFFC')||[...(text.noteAnchors||[]),...(text.anchors||[])].some(a=>a.paragraph>=unit.start&&a.paragraph<=unit.end))return null;
 if(options.referenceText){let ref;try{ref=parseTargetLabel(options.referenceText,'en');}catch{return null;}if(!ref.complete||!samePath(ref.segments,path))return null;}
 const candidates=points.map(p=>({...p,wording:normal(textOf(p),labels(p))}));
 for(let start=structure.start+1;start<=structure.end;start++){
  const m=pointLabel(rows[start].normal);if(!m||points.some(p=>p.start===start&&p.complete))continue;
  let end=start;for(let i=start+1;i<=structure.end&&i<start+30;i++){if(pointLabel(rows[i].normal)||/^\d+[.)]\s/u.test(rows[i].normal)||structure.units.some(u=>u.kind==='heading'&&u.start===i))break;end=i;}
  for(let prefixEnd=start;prefixEnd<=end;prefixEnd++)candidates.push({start,end:prefixEnd,complete:false,wording:normal(textOf({start,end:prefixEnd}),[pointValue(m)])});
 }
 const score=value=>{let prefix=0;while(prefix<Math.min(value.length,original.length)&&value[prefix]===original[prefix])prefix++;return {similarity:characterSimilarity(value,original,.93),prefix:prefix>=80&&prefix<Math.min(value.length,original.length)?prefix/Math.min(value.length,original.length):0};};
 const own=score(source),others=candidates.filter(p=>p.start!==unit.start||p.end!==unit.end).map(p=>score(p.wording));
 const unique=own.similarity>=.95&&others.every(p=>p.similarity<=own.similarity-.02&&p.prefix<.5)||own.prefix>=.5&&others.every(p=>p.prefix<=own.prefix-.02&&p.similarity<.93);
 return unique?{operation,status:'placed',span:{start:unit.start,end:unit.end},evidence:[{basis:'published-point-path',path:path.map(({kind,value})=>({kind,value}))},{basis:'unique-similar-point-original',anchor:unit.start}]}:null;
}

// Budget comparisons may compress a child into an 'including' clause. Only
// explicit EUR XXX deletions reach this comparison, after unique path proof.
function placeholderMatches(source,original) {
  const key=value=>value.normalize('NFC').toLowerCase()
    .replace(/(^|\s)(\([a-z]+\)|[a-z]+[.)])\s+(?:the\s+)?/gu,'$1$2 ')
    .replace(/,\s*including\s+/gu,' ').replace(/[–—]/gu,'-')
    .replace(/[.;,]/gu,' ').replace(/\s+/gu,' ').trim();
  const parts=key(original).split(/(?<=\beur )xxx\b/u);
  if(parts.length<2||parts.join('').includes('xxx'))return false;
  const pattern=parts.map(part=>part.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('\\d+(?: \\d{3})*');
  return new RegExp('^'+pattern+'$','u').test(key(source));
}

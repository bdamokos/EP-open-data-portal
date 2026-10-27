// Map only whitespace-equivalent originals. No fuzzy wording or label matching:
// annotation offsets must refer to the exact original side of the comparison.
function normalizedOffsets(text) {
  const offsets = new Array(text.length + 1).fill(0), end = text.trimEnd().length;
  let normal = '';
  for (const match of text.matchAll(/\s+|\S+/gu)) {
    const start = match.index, stop = start + match[0].length;
    if (/^\s/u.test(match[0])) {
      const space = normal.length > 0 && start < end;
      offsets[start] = normal.length;
      if (space) normal += ' ';
      for (let i = start + 1; i <= stop; i++) offsets[i] = normal.length;
    } else {
      for (let i = start; i <= stop; i++) offsets[i] = normal.length + i - start;
      normal += match[0];
    }
  }
  return {normal, offsets};
}
export function mapContextAnnotations(paragraphs, span, original, anchors = [], links = []) {
  const source = paragraphs.slice(span.start, span.end + 1).join(' '), from = normalizedOffsets(source), to = normalizedOffsets(original);
  if (from.normal !== to.normal) return null;
  const inverse = new Map(), starts = new Map();
  to.offsets.forEach((offset, index) => {if (!inverse.has(offset)) inverse.set(offset, index); starts.set(offset, index);});
  const mappedAnchors = [], mappedLinks = [];
  let base = 0;
  for (let paragraph = span.start; paragraph <= span.end; paragraph++) {
    const value = paragraphs[paragraph];
    const map = (offset, start = false) => (start ? starts : inverse).get(from.offsets[base + offset]);
    for (const anchor of anchors.filter(item => item.paragraph === paragraph)) {
      if (!Number.isInteger(anchor.offset) || anchor.offset < 0 || anchor.offset > value.length) return null;
      mappedAnchors.push({...anchor, offset: map(anchor.offset)});
    }
    for (const link of links.filter(item => item.paragraph === paragraph)) {
      if (!Number.isInteger(link.start) || !Number.isInteger(link.end) || link.start < 0 || link.end > value.length || link.end <= link.start) return null;
      const start = map(link.start, true), end = map(link.end);
      if (start === undefined || end === undefined || end <= start) return null;
      mappedLinks.push({...link, start, end});
    }
    base += value.length + 1;
  }
  return {anchors: mappedAnchors, links: mappedLinks};
}

// A placed span may include an explicit provision prefix or different whitespace.
// Only exact normalized text equivalence permits moving amendment formatting.
// null means mapping failed; [] means verified text without vertical formatting.
export function mapWordingFormatting(source,target,formatting=[]) {
  if(typeof source!=='string'||typeof target!=='string')return null;
  if(source===target)return formatting;
  let prefix=0;
  const label=target.match(/^\s*(?:\([\p{L}\p{N}]{1,6}\)|[\p{L}\p{N}]{1,6}[.)])\s+/u)?.[0];
  if(normalizedOffsets(source).normal!==normalizedOffsets(target).normal&&label)prefix=label.length;
  const mapped=mapContextAnnotations([source],{start:0,end:0},target.slice(prefix),[],formatting.map(mark=>({...mark,paragraph:0})));
  return mapped?mapped.links.map(mark=>({start:mark.start+prefix,end:mark.end+prefix,kind:mark.kind})):null;
}

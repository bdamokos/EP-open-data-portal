import {parseTargetLabel} from '../server/proposal-structure.mjs';
import {segmentMotionUnits,placementReference} from '../server/document-context-model.mjs';
import {proposalMatchingOffsets} from '../server/proposal-placement.mjs';

// Only these affirmative observations remove a row from the denominator.
// HTTP 404/410 of the exact published DOCX proves that distribution unavailable
// at retrieval. Two empty, successfully extracted comparison columns prove no
// wording in that block. Parser failures, missing index URLs, unsupported grids,
// timeouts, language fallbacks and missing API projections NEVER prove absence.
export const SOURCE_REASONS = Object.freeze({
  'source-document-unavailable': 'The exact published DOCX returned HTTP 404 or 410.',
  'source-wording-empty': 'The extracted, supported comparison has two empty columns.',
});

export function classify(stages) {
  if (stages.S5.status === 'placed' && stages.S6.status === 'failed') return {outcome:'false-placement', reason:stages.S6.reason};
  for (const key of ['S1','S2','S3','S4']) {
    const stage = stages[key];
    // A parse limit does not erase a placement the actual pipeline can verify
    // through its quoted-original fallback. Still retain the failed parse stage.
    if (key === 'S3' && stages.S5.status === 'placed') continue;
    if (stage.status !== 'passed') return {outcome:Object.hasOwn(SOURCE_REASONS, stage.reason) ? 'withheld-source' : 'withheld-pipeline', reason:stage.reason};
  }
  if (stages.S5.status !== 'placed') return {outcome:'withheld-pipeline', reason:stages.S5.reason};
  return stages.S6.status === 'verified' ? {outcome:'correct', reason:'oracle-verified'} : {outcome:'placed-unverified', reason:stages.S6.reason};
}

const flatten = units => units.flatMap(unit => [unit, ...flatten(unit.children || [])]);
const parentKey = unit => JSON.stringify(unit.path.slice(0,-1));
const pathKey = path => JSON.stringify(path.map(({kind,value}) => [kind,value]));
const suffixOrder = suffix => {
  const latin = ['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];
  if (!suffix) return 0;
  if (latin.includes(suffix)) return latin.indexOf(suffix)+1;
  if (!/^[a-z]{1,3}$/.test(suffix)) return null;
  return [...suffix].reduce((value,c) => value*26+c.charCodeAt(0)-96,0);
};
const fail = reason => ({status:'failed', reason});
const verified = reason => ({status:'verified', reason});

export function parseBenchmarkTarget(wording) {
  try {
    if (wording.language === 'en' && ['motion-resolution','unknown'].includes(wording.baseline)) {
      const ref=placementReference(wording.targetLabel);
      if(ref) {
        const split=/^(\d+|[A-Z]+)([a-z]*)$/.exec(ref.kind==='point'?ref.paragraph:ref.label);
        const segment={kind:ref.kind==='point'?'paragraph':ref.kind,value:ref.kind==='point'?ref.paragraph:ref.label,number:split?(/^\d+$/.test(split[1])?Number(split[1]):split[1]):null,suffix:split?.[2]||'',isNew:/\(\s*new\s*\)/i.test((wording.targetLabel||'').split('\n')[0])};
        return {raw:wording.targetLabel,language:'en',complete:true,segments:ref.kind==='point'?[segment,{kind:'point',value:ref.label,number:null,suffix:'',isNew:false}]:[segment],unparsed:[]};
      }
    }
    const raw = wording.targetPath?.proposal?.length === 1 ? wording.targetPath.proposal[0].raw : wording.targetLabel;
    return parseTargetLabel(raw || '', wording.language);
  } catch {
    return {raw:wording.targetLabel, language:wording.language, complete:false, segments:[], unparsed:['unsupported-language']};
  }
}

/** Independent assertions on the returned source coordinates, never another
 * placement implementation. Unknown oracle grammars stay placed-unverified. */
export function verifyPlacement({placement, wording, items, text, target = parseBenchmarkTarget(wording)}) {
  if (placement.status !== 'placed') return {status:'not-applicable', reason:'not-placed'};
  const proposal = items?.[placement.itemIndex]?.proposal;
  if (placement.operation === 'replace' || placement.operation === 'delete') {
    let source, labels = [];
    if (proposal) {
      const {splice} = placement;
      if (!splice || !placement.span || splice.start.paragraph !== placement.span.start || splice.end.paragraph !== placement.span.end) return fail('oracle-invalid-span');
      const rows = proposal.paragraphs.filter(p => p.index >= splice.start.paragraph && p.index <= splice.end.paragraph);
      if (!rows.length || rows[0].index !== splice.start.paragraph || rows.at(-1).index !== splice.end.paragraph
        || splice.start.offset < 0 || splice.end.offset < 0 || splice.start.offset > rows[0].text.length || splice.end.offset > rows.at(-1).text.length
        || rows.length === 1 && splice.end.offset < splice.start.offset) return fail('oracle-invalid-span');
      source = rows.map((p,i) => p.text.slice(i === 0 ? splice.start.offset : 0, i === rows.length-1 ? splice.end.offset : p.text.length)).join('\n');
      labels = flatten(proposal.units).filter(u => u.label?.prefix && ['paragraph','point','recital'].includes(u.kind)).map(u => u.label);
    } else {
      const span = placement.span;
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end >= (text?.paragraphs?.length || 0)) return fail('oracle-invalid-span');
      source = text.paragraphs.slice(span.start,span.end+1).join('\n');
      labels = segmentMotionUnits(text,wording.language).filter(u=>u.kind!=='heading').map(u=>({value:u.label}));
    }
    if (source.includes('\uFFFC') || wording.originalText.includes('\uFFFC')) return {status:'unverified',reason:'oracle-object-comparison-unavailable'};
    const key = value => proposalMatchingOffsets(value,value.split(/\r?\n/).map(() => labels))?.normal;
    const left = key(source), right = key(wording.originalText);
    return left && right && left === right ? verified('oracle-original-equals-source-span') : fail('oracle-original-span-mismatch');
  }
  if (placement.operation !== 'insert' || !target.complete || !target.segments.length) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const label = target.segments.at(-1), rank = suffixOrder(label.suffix);
  if (!label.isNew || !rank || label.number == null) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  let siblings, anchor, end;
  if (proposal) {
    const all = flatten(proposal.units).filter(u => u.scope === 'proposal');
    anchor = all.find(u => u.id === placement.evidence?.find(e => e.basis === 'preceding-sibling-subtree')?.anchor);
    if (!anchor) return fail('oracle-anchor-missing');
    const parent = target.segments.slice(0,-1);
    // Heading containers may precede the published address. Compare its exact
    // suffix, as proposalCandidates does; retain the actual source parent below.
    if (parent.length && pathKey(anchor.path.slice(-parent.length-1,-1)) !== pathKey(parent)) return fail('oracle-parent-mismatch');
    siblings = all.filter(u => u.kind === label.kind && parentKey(u) === parentKey(anchor)).map(u => ({...u, number:u.label?.number, suffix:u.label?.suffix || '', start:u.extent.start}));
    anchor = {...anchor, number:anchor.label?.number, suffix:anchor.label?.suffix || '', start:anchor.extent.start};
    end = anchor.extent.end;
  } else {
    if (wording.language !== 'en' || !['paragraph','recital'].includes(label.kind)) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    const units = segmentMotionUnits(text,wording.language);
    const published = placement.evidence?.find(e => e.basis === 'published-reference');
    const candidates = units.filter(u => u.kind === label.kind && u.label === published?.anchor && u.end === placement.insertAfter);
    if (candidates.length !== 1) return fail('oracle-anchor-missing');
    anchor = candidates[0];
    // The resolution grammar currently has no nested insertion form.
    if (target.segments.length !== 1) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    const split = value => {const match = /^(\d+|[A-Z]+)([a-z]*)$/.exec(value); return match ? {number:/^\d+$/.test(match[1])?Number(match[1]):match[1],suffix:match[2]} : {number:null,suffix:''};};
    siblings = units.filter(u => u.kind === label.kind && u.parent === anchor.parent).map(u => ({...u,...split(u.label)}));
    anchor = {...anchor,...split(anchor.label)};
    end = anchor.end+1;
  }
  // Recital letters are carried as value rather than number by the parser.
  const wanted = label.number;
  if (anchor.number !== wanted || suffixOrder(anchor.suffix) == null || suffixOrder(anchor.suffix) >= rank || anchor.kind !== label.kind) return fail('oracle-anchor-label-mismatch');
  if (placement.insertBefore !== end || placement.insertAfter !== end-1) return fail('oracle-insertion-boundary-mismatch');
  const ordered = siblings.sort((a,b) => a.start-b.start), at = ordered.findIndex(u => u.start === anchor.start);
  if (at < 0 || ordered.some(u => u.number === wanted && u.suffix === label.suffix)) return fail('oracle-duplicate-insertion-label');
  const next = ordered[at+1];
  if (next && (next.start < end || next.number < wanted || next.number === wanted && (suffixOrder(next.suffix) == null || suffixOrder(next.suffix) <= rank))) return fail('oracle-next-sibling-order');
  return verified('oracle-sibling-boundary');
}

export function targetPatterns(wording = {}, gaps = []) {
  const label = wording.targetLabel || '', parsed = parseBenchmarkTarget(wording), patterns = new Set();
  for (const segment of parsed.segments) {
    if (segment.suffix) patterns.add('letter-suffix');
    if (segment.kind) patterns.add(segment.kind);
    if (String(segment.value).startsWith('-')) patterns.add('negative-label');
  }
  for (const [pattern,re] of [['introductory-part',/introductory|introductif|einleitung/i],['negative-label',/(?:^|\s)[−-]\s*\d/u],['subparagraph',/subparagraph/i],['title',/^title\b/i],['underlying-act-insertion',/\n[\s\S]*\(new\)/i]]) if (re.test(label)) patterns.add(pattern);
  if (wording.targetPath?.underlying?.length) patterns.add('underlying-act');
  for (const gap of gaps) if (/vertical-text|comparison-grid/.test(gap.code || gap)) patterns.add((gap.code || gap).replace('-loss',''));
  return [...patterns].sort().length ? [...patterns].sort() : ['unparsed'];
}

const ratio = (n,d) => d ? n/d : null;
export function metrics(rows) {
  const counts = Object.fromEntries(['correct','placed-unverified','withheld-pipeline','withheld-source','false-placement'].map(key => [key,0]));
  const votes = new Map(), groups = new Map(),strata=new Map();
  for(const row of rows){const key=JSON.stringify([row.documentType,row.language]);strata.set(key,(strata.get(key)||0)+1);}
  for (const row of rows) {
    counts[row.outcome]++;
    // Variants do not multiply votes. Every referenced amendment and every
    // evaluated source variant of that amendment must be correct for a vote.
    for (const id of row.voteIds) votes.set(id,(votes.get(id) ?? true) && row.outcome === 'correct');
    for (const pattern of row.patterns) {
      const key = JSON.stringify([row.documentType,row.language,row.reason,pattern]);
      const group = groups.get(key) || {documentType:row.documentType,language:row.language,reason:row.reason,pattern,count:0,examples:[]};
      group.count++; if (group.examples.length < 3 && !group.examples.includes(row.id)) group.examples.push(row.id); groups.set(key,group);
    }
  }
  const total = rows.length, eligible = total-counts['withheld-source'], correctVotes = [...votes.values()].filter(Boolean).length;
  return {total,counts,eligible,headline:ratio(counts.correct,eligible),raw:ratio(counts.correct,total),falsePlacements:counts['false-placement'],votes:{total:votes.size,correct:correctVotes,share:ratio(correctVotes,votes.size)},taxonomy:[...groups.values()].map(group => ({...group,share:ratio(group.count,total),stratumShare:ratio(group.count,strata.get(JSON.stringify([group.documentType,group.language])))})).sort((a,b)=>b.count-a.count||JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
}

export function compareBaseline(current, baseline) {
  // Refuse a changing census or input snapshot: a score difference would not
  // isolate checkout behaviour. Code identity deliberately does not participate.
  const fingerprint = value => JSON.stringify({sample:value.sample,inputs:value.inputs});
  if (fingerprint(current) !== fingerprint(baseline)) throw new Error('Baseline sample/input hashes differ; replay the same frozen cache and sample.');
  const now = new Map(current.rows.map(row=>[row.key,row]));
  const regressions = baseline.rows.filter(old => {
    const row = now.get(old.key);
    return !row || old.outcome === 'correct' && row.outcome !== 'correct' || old.outcome !== 'false-placement' && row.outcome === 'false-placement';
  }).map(old=>({key:old.key,id:old.id,before:old.outcome,after:now.get(old.key)?.outcome || 'missing',reason:now.get(old.key)?.reason}));
  const deltas = {};
  const walk = (a,b,prefix='') => {for (const key of Object.keys(a)) {const name=prefix+key;if(typeof a[key]==='number'&&typeof b?.[key]==='number')deltas[name]=a[key]-b[key];else if(a[key]&&typeof a[key]==='object'&&!Array.isArray(a[key]))walk(a[key],b?.[key],name+'.');}};
  walk(current.metrics,baseline.metrics);
  const taxonomyKey=row=>JSON.stringify([row.documentType,row.language,row.reason,row.pattern]);
  const before=new Map(baseline.metrics.taxonomy.map(row=>[taxonomyKey(row),row]));
  const after=new Map(current.metrics.taxonomy.map(row=>[taxonomyKey(row),row]));
  const taxonomyDeltas=[...new Set([...before.keys(),...after.keys()])].sort().map(key=>({key,count:(after.get(key)?.count||0)-(before.get(key)?.count||0),share:(after.get(key)?.share||0)-(before.get(key)?.share||0)}));
  return {deltas,taxonomyDeltas,regressions,failed:regressions.length>0||current.metrics.falsePlacements>0};
}

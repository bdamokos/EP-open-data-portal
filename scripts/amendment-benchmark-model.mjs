import {oracleAddress,oracleRelative} from './amendment-oracle-grammar.mjs';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
import {rawResolutionUnits,rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';


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
    if (stage.status !== 'passed') return {outcome:stage.reason?.startsWith('acquisition-')?'acquisition-unavailable':Object.hasOwn(SOURCE_REASONS, stage.reason) ? 'withheld-source' : 'withheld-pipeline', reason:stage.reason};
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
  const alphabet=/^[α-ω]+$/u.test(suffix)?'αβγδεζηθικλμνξοπρστυφχψω':/^[а-я]+$/u.test(suffix)?'абвгдежзийклмнопрстуфхцчшщъьюя':null;
  if(alphabet)return [...suffix].reduce((value,c)=>value*alphabet.length+alphabet.indexOf(c)+1,0);
  if (!/^[a-z]{1,3}$/.test(suffix)) return null;
  return [...suffix].reduce((value,c) => value*26+c.charCodeAt(0)-96,0);
};
const ordinal = value => {
  if(typeof value==='number')return value;
  const alphabet=typeof value==='string'&&/^[A-Z]+$/.test(value)?'ABCDEFGHIJKLMNOPQRSTUVWXYZ':typeof value==='string'&&/^[А-Я]+$/u.test(value)?'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ':null;
  return alphabet?[...value].reduce((n,c)=>n*alphabet.length+alphabet.indexOf(c)+1,0):null;
};
const fail = reason => ({status:'failed', reason});
const verified = reason => ({status:'verified', reason});

export function parseBenchmarkTarget(wording) {
 const raw=wording.targetPath?.proposal?.length===1?wording.targetPath.proposal[0].raw:wording.targetLabel||'';
 const resolution=['motion-resolution','unknown'].includes(wording.baseline);
 const relative=resolution&&oracleRelative(raw,wording.language);
 const segments=relative?[relative]:oracleAddress(raw.split('\n')[0],wording.language,{resolution});
 if(segments&&resolution&&segments.length===1&&segments[0].kind==='recital'&&segments[0].number!==null&&new RegExp('^\\s*'+segments[0].value+'[.)]\\s','u').test(wording.proposedText||''))segments[0].kind='paragraph';
 return {raw,language:wording.language,complete:Boolean(segments),segments:segments||[],unparsed:segments?[]:['unsupported-oracle-grammar']};
}

// Fixed oracle policy, deliberately independent of the placer's normaliser.
// Preserve case, accents, words and numbers. Strip only a published provision
// prefix, enclosing quotes, whitespace and comparison-column terminators.
export function oracleNormal(value,labels=[]) {
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const prefixes=[...new Set(labels.map(label=>label.value))].map(value=>'\\('+escape(value)+'\\)|'+escape(value)+'[.)]');
  const prefix=prefixes.length?new RegExp('^(?:'+prefixes.join('|')+')\\s*','u'):null;
  // A comparison cell can flatten several source paragraphs. Only the end
  // of the complete comparison has a terminator; internal punctuation stays.
  return value.normalize('NFC').replace(/\u00ad/g,'').replace(/[‘’‚‛ʻʼ]/g,"'").replace(/[“”„‟«»]/g,'"').replace(/[‐‑‒–—]/g,'-')
    .split(/\r?\n/).map(line=>{
      let text=line.trim().replace(/^["']\s*/, '');
      if(prefix)text=text.replace(prefix,'');
      // Published comparison columns can put a closing quote before or after
      // the same terminators. Keep the marks, with one ordering on both sides.
      return text.replace(/([.;]+)(["']+)([.;]*)$/u,'$2$1$3');
    }).join(' ').replace(/\s+/gu,' ').trim().replace(/[.;'"\s]+$/u,'');
}
const occurrences=(haystack,needle)=>{
  let count=0,offset=0;if(!needle)return 0;
  while((offset=haystack.indexOf(needle,offset))>=0){count++;offset++;}return count;
};
function firstSubparagraphAddress(proposal,target){
  const at=target.segments.findIndex((segment,index)=>segment.kind==='subparagraph'&&index<target.segments.length-1);
  if(at<0)return {target};
  if(target.segments[at].value!=='1')return null;
  const parents=flatten(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind===target.segments[at-1]?.kind&&pathKey(unit.path)===pathKey(target.segments.slice(0,at)));
  if(parents.length!==1)return null;
  const parent=parents[0],first=proposal.paragraphs[parent.content?.at(-1)];
  if(!first?.text.trimEnd().endsWith(':')||!parent.children.some(unit=>unit.kind==='point'))return null;
  const end=parent.children.find(unit=>unit.kind==='subparagraph')?.extent.start??parent.extent.end;
  return {target:{...target,segments:target.segments.filter((_,i)=>i!==at)},bounds:{start:parent.extent.start,end}};
}
function locationOracle({proposal,text,target,wording,placement,labels}) {
  const span=placement.span;
  const source=proposal?proposal.paragraphs.map(p=>p.text).join('\n'):text.paragraphs.join('\n');
  const count=occurrences(oracleNormal(source,labels),oracleNormal(wording.originalText,labels));
  // An introductory part is the provision's own lead before its first child;
  // without children the lead cannot be established independently.
  const introductory=target.complete&&target.segments.at(-1)?.kind==='introductory-part';
  if(introductory)target={...target,segments:target.segments.slice(0,-1)};
  if(target.complete&&target.segments.length) {
    let candidates=[];
    if(proposal) {
      if(target.segments.some(segment=>segment.kind==='subparagraph')){
        const address=firstSubparagraphAddress(proposal,target);
        if(!address?.bounds)return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
        if(span.start<address.bounds.start||span.end>=address.bounds.end)return fail('oracle-subparagraph-span-mismatch');
        target=address.target;
      }
      candidates=flatten(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.path.length>=target.segments.length&&pathKey(unit.path.slice(-target.segments.length))===pathKey(target.segments))
        .map(unit=>introductory
          ?(unit.children.length?{start:unit.extent.start,end:Math.min(...unit.children.map(child=>child.extent.start))-1,spans:unit.spans||[]}:null)
          :{start:unit.extent.start,end:unit.extent.end-1,spans:flatten([unit]).flatMap(child=>child.spans||[])});
      if(introductory&&candidates.some(unit=>!unit))return {status:'unverified',reason:'oracle-introductory-part-unavailable'};
    } else {
      const label=target.segments.at(-1),parent=target.segments.at(-2);
      if(!['paragraph','recital','citation','point'].includes(label.kind))return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
      const {units,reason}=rawResolutionUnits(text,wording.language);
      if(reason)return {status:'unverified',reason};
      candidates=units.filter(unit=>unit.kind===label.kind&&unit.label===(label.kind==='recital'?label.value.toUpperCase():label.value)&&(label.kind!=='point'||units.find(owner=>owner.start===unit.parent)?.label===parent.value));
      if(label.kind==='point'){
        const indented=rawResolutionPointUnits(text).units.filter(unit=>pathKey(unit.path)===pathKey(target.segments));
        if(indented.length)candidates=indented;
        else if(parent?.kind!=='paragraph')return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
      }
      if(introductory) {
        // Repeated paragraph numbers elsewhere in a multilingual report do not
        // determine the lead boundary of the unit containing the returned span.
        candidates=candidates.filter(unit=>span.start>=unit.start&&span.end<=unit.end);
        candidates=candidates.map(unit=>{const children=units.filter(child=>child.parent===unit.start);return children.length?{...unit,end:Math.min(...children.map(child=>child.start))-1}:null;});
        if(candidates.some(unit=>!unit))return {status:'unverified',reason:'oracle-introductory-part-unavailable'};
      }
    }
    if(!candidates.length)return {status:'unverified',reason:'oracle-address-unit-unavailable'};
    const inside=unit=>{
      if(span.start<unit.start||span.end>unit.end)return false;
      if(!proposal)return true;
      const splice=placement.splice;
      // Every covered character must belong to this addressed subtree; paragraph
      // extents alone cannot distinguish inline quoted provisions in one row.
      for(let paragraph=span.start;paragraph<=span.end;paragraph++) {
        const from=paragraph===span.start?splice.start.offset:0,to=paragraph===span.end?splice.end.offset:proposal.paragraphs.find(p=>p.index===paragraph)?.text.length;
        const spans=unit.spans.filter(s=>s.paragraph===paragraph).sort((a,b)=>a.start-b.start);
        let covered=from;for(const slice of spans){if(slice.start>covered)break;if(slice.end>covered)covered=slice.end;}
        if(covered<to)return false;
      }
      return true;
    };
    if(!candidates.some(inside))return fail('oracle-address-span-mismatch');
    // Replacement coordinates need a verified addressed span, not a complete
    // trailing extent. Unknown rows already close the raw unit before them;
    // insertion still requires the independently complete subtree below.
    if(!proposal&&text.paragraphSources.slice(span.start,span.end+1).some(source=>source.complete!==true))return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(candidates.length===1)return {...verified('oracle-addressed-source-span'),originalOccurrences:count};
  }
  return count===1?{...verified('oracle-unique-original-source-span'),originalOccurrences:count}:{status:'unverified',reason:'oracle-original-not-unique',occurrences:count};
}

function verifyResolutionInsertion(text,wording,target,placement) {
  const label=target.segments.at(-1);
  if(!label.isNew||label.negative)return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const raw=rawResolutionUnits(text,wording.language);
  if(raw.reason)return {status:'unverified',reason:raw.reason};
  const units=raw.units,parents=target.segments.slice(0,-1);
  const owns=unit=>{
    let at=units.find(candidate=>candidate.start===unit.parent);
    for(const wanted of [...parents].reverse()) {
      if(!at||at.kind!==wanted.kind||at.label!==wanted.value)return false;
      at=units.find(candidate=>candidate.start===at.parent);
    }
    return true;
  };
  const kind=label.after?'paragraph':label.kind;
  if(!['paragraph','recital','citation','point'].includes(kind))return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const bases=units.filter(unit=>unit.kind===kind&&unit.label===String(label.base)&&owns(unit));
  if(!bases.length&&kind==='point'){
    const indented=rawResolutionPointUnits(text).units;
    const anchors=indented.filter(unit=>unit.label===label.base&&pathKey(unit.path.slice(0,-1))===pathKey(parents));
    if(anchors.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    const anchor=anchors[0],family=indented.filter(unit=>unit.parent===anchor.parent&&unit.group===anchor.group);
    if(!anchor.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(family.some(unit=>unit.label===label.value))return fail('oracle-duplicate-insertion-label');
    if(placement.insertAfter!==anchor.end||placement.insertBefore!==anchor.end+1)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-indented-point-boundary');
  }
  if(bases.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  const base=bases[0],family=units.filter(unit=>unit.kind===kind&&unit.parent===base.parent&&unit.group===base.group);
  const before=suffix=>wording.language==='fr'?suffixOrder(suffix)<suffixOrder(label.suffix):suffix<label.suffix;
  const preceding=family.filter(unit=>unit.label===String(label.base)||!label.after&&unit.label.startsWith(String(label.base))&&/^[a-zα-ωа-я]+$/u.test(unit.label.slice(String(label.base).length))&&before(unit.label.slice(String(label.base).length)));
  const anchor=preceding.sort((a,b)=>a.start-b.start).at(-1);
  if(!anchor?.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
  if(!label.after&&family.some(unit=>unit.label===label.value))return fail('oracle-duplicate-insertion-label');
  // Independently reject a predecessor that appears after a later-numbered
  // sibling, even if the placement happened to use that raw extent.
  const numeric=value=>/^(\d+|[A-ZА-Я]+)([a-zα-ωа-я]*)$/u.exec(value);
  const position=base=>/^\d+$/u.test(base)?Number(base):ordinal(base);
  const ordered=family.filter(unit=>numeric(unit.label));
  for(let i=1;i<ordered.length;i++) {
    const previous=numeric(ordered[i-1].label),current=numeric(ordered[i].label);
    if(position(previous[1])>position(current[1])
      || position(previous[1])===position(current[1])&&suffixOrder(previous[2])>=suffixOrder(current[2]))return fail('oracle-previous-sibling-order');
  }
  const next=family.find(unit=>unit.start>anchor.start),nextLabel=next&&numeric(next.label),wanted=position(String(label.base));
  if(!label.after&&nextLabel&&wanted!=null&&(position(nextLabel[1])<wanted||position(nextLabel[1])===wanted&&suffixOrder(nextLabel[2])<=suffixOrder(label.suffix)))return fail('oracle-next-sibling-order');
  if(placement.insertBefore!==anchor.end+1||placement.insertAfter!==anchor.end)return fail('oracle-insertion-boundary-mismatch');
  return verified('oracle-sibling-boundary');
}

/** Independent assertions on the returned source coordinates, never another
 * placement implementation. Unknown oracle grammars stay placed-unverified. */
export function verifyPlacement(input) {
  const result=verifyKnownPlacement(input);
  const proposal=input.items?.[input.placement.itemIndex]?.proposal;
  if(result.status!=='unverified'||!proposal||!['oracle-address-grammar-unavailable','oracle-address-unit-unavailable','oracle-introductory-part-unavailable','oracle-insertion-grammar-unavailable'].includes(result.reason))return result;
  const raw=rawProposalAssertion({proposal,wording:input.wording,placement:input.placement});
  return raw.status==='unverified'?result:raw;
}

function verifyKnownPlacement({placement, wording, items, text, target = parseBenchmarkTarget(wording)}) {
  if (placement.status !== 'placed') return {status:'not-applicable', reason:'not-placed'};
  const expected = expectedOperation(wording);
  if (!expected) return {status:'unverified', reason:'oracle-operation-unavailable'};
  if (placement.operation !== expected) return {...fail('oracle-operation-mismatch'), expectedOperation:expected, actualOperation:placement.operation};
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
      labels = [...rawResolutionUnits(text,wording.language).units.map(u=>({value:u.label})),...target.segments.map(segment=>({value:segment.value}))];
    }
    if (source.includes('\uFFFC') || wording.originalText.includes('\uFFFC')) return {status:'unverified',reason:'oracle-object-comparison-unavailable'};
    const key = value => oracleNormal(value,labels);
    const left = key(source), right = key(wording.originalText);
    if(!left||!right||left!==right)return fail('oracle-original-span-mismatch');
    return locationOracle({proposal,text,target,wording,placement,labels});
  }
  if (placement.operation !== 'insert' || !target.complete || !target.segments.length) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  if (!proposal) return verifyResolutionInsertion(text,wording,target,placement);
  // COM(2025)531 puts an instruction's semicolon in a separate Word row
  // after its closing quotation. Even an otherwise unsupported point address
  // cannot insert a sibling between that quotation and its terminator.
  const following=proposal.paragraphs[placement.insertBefore],preceding=proposal.paragraphs[placement.insertAfter];
  if(target.segments.at(-1)?.kind==='point'&&following?.text.trim()===';'
    &&/[’'”"]\s*$/u.test(preceding?.text??'')&&preceding?.source?.container==='body'&&following.source?.container==='body'
    &&preceding.source.containerPath===following.source.containerPath&&preceding.source.segment===following.source.segment
    &&following.source.ordinal===preceding.source.ordinal+1)return fail('oracle-insertion-before-instruction-terminator');
  if(target.segments.some((segment,index)=>segment.kind==='subparagraph'&&index<target.segments.length-1)){
    const address=firstSubparagraphAddress(proposal,target),label=target.segments.at(-1);
    if(!address?.bounds||label.kind!=='point'||!label.isNew||!label.base||!label.suffix)return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    const path=address.target.segments.slice(0,-1),all=flatten(proposal.units).filter(unit=>unit.scope==='proposal');
    const family=all.filter(unit=>unit.kind==='point'&&pathKey(unit.path.slice(0,-1))===pathKey(path));
    const anchors=family.filter(unit=>unit.label?.value===label.base);
    if(anchors.length!==1||!anchors[0].complete)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    const anchor=anchors[0],after=proposal.paragraphs[anchor.extent.end],last=proposal.paragraphs[anchor.extent.end-1];
    if(family.some(unit=>unit.label?.value===label.value))return fail('oracle-duplicate-insertion-label');
    if(placement.insertBefore!==anchor.extent.end||placement.insertAfter!==anchor.extent.end-1||placement.insertBefore>address.bounds.end)return fail('oracle-insertion-boundary-mismatch');
    if(!after?.complete||!last?.complete||after.source?.ordinal!==last.source?.ordinal+1||after.source?.containerPath!==last.source?.containerPath)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    return verified('oracle-subparagraph-point-boundary');
  }
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
  }
  // Recital letters are carried as value rather than number by the parser.
  const wanted = label.number;
  if (anchor.number !== wanted || suffixOrder(anchor.suffix) == null || suffixOrder(anchor.suffix) >= rank || anchor.kind !== label.kind) return fail('oracle-anchor-label-mismatch');
  // A parser-created implicit paragraph must not swallow the publication's
  // next explicitly styled paragraph. A-10-2026-0069's unstyled article subtitle
  // otherwise makes paragraphs 1 and 2 look like children of implicit paragraph 1.
  if(proposal&&wording.language==='en'&&label.kind==='paragraph'&&anchor.implicit&&!anchor.instruction) {
    const quoted=flatten(proposal.units).filter(unit=>unit.scope==='quoted');
    for(const row of proposal.paragraphs) {
      if(row.index<=anchor.start||row.index>=placement.insertBefore||!/^(?:Manual)?NumPar1$/i.test(row.properties?.styleId||''))continue;
      if(quoted.some(unit=>row.index>=unit.extent.start&&row.index<unit.extent.end))continue;
      const number=/^\s*(\d+)([a-z]*)[.)]\s/u.exec(row.text);
      if(number&&(Number(number[1])>wanted||Number(number[1])===wanted&&suffixOrder(number[2])>=rank))return fail('oracle-published-paragraph-boundary-mismatch');
    }
  }
  if (placement.insertBefore !== end || placement.insertAfter !== end-1) return fail('oracle-insertion-boundary-mismatch');
  const ordered = siblings.sort((a,b) => a.start-b.start), at = ordered.findIndex(u => u.start === anchor.start);
  if (at < 0 || ordered.some(u => u.number === wanted && u.suffix === label.suffix)) return fail('oracle-duplicate-insertion-label');
  const previous=ordered[at-1],next = ordered[at+1],wantedOrdinal=ordinal(wanted);
  if(previous&&(ordinal(previous.number)>ordinal(anchor.number)||ordinal(previous.number)===ordinal(anchor.number)&&suffixOrder(previous.suffix)>=suffixOrder(anchor.suffix)))return fail('oracle-previous-sibling-order');
  if (next && (next.start < end || ordinal(next.number) < wantedOrdinal || ordinal(next.number) === wantedOrdinal && (suffixOrder(next.suffix) == null || suffixOrder(next.suffix) <= rank))) return fail('oracle-next-sibling-order');
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
  const counts = Object.fromEntries(['correct','placed-unverified','withheld-pipeline','withheld-source','acquisition-unavailable','not-placeable','false-placement'].map(key => [key,0]));
  const votes = new Map(), groups = new Map(),strata=new Map(),reasons=new Map();
  for(const row of rows){const key=JSON.stringify([row.documentType,row.language]);strata.set(key,(strata.get(key)||0)+1);}
  for (const row of rows) {
    counts[row.outcome]++;
    const reason=reasons.get(row.reason)||{reason:row.reason,count:0,examples:[]};reason.count++;if(reason.examples.length<3)reason.examples.push(row.id);reasons.set(row.reason,reason);
    // Variants do not multiply votes. Every referenced amendment and every
    // evaluated source variant of that amendment must be correct for a vote.
    for (const id of row.outcome==='not-placeable'?[]:row.voteIds) votes.set(id,(votes.get(id) ?? true) && row.outcome === 'correct');
    for (const pattern of row.patterns) {
      const key = JSON.stringify([row.documentType,row.language,row.reason,pattern]);
      const group = groups.get(key) || {documentType:row.documentType,language:row.language,reason:row.reason,pattern,count:0,examples:[]};
      group.count++; if (group.examples.length < 3 && !group.examples.includes(row.id)) group.examples.push(row.id); groups.set(key,group);
    }
  }
  const total = rows.length, eligible = total-counts['withheld-source']-counts['not-placeable'], correctVotes = [...votes.values()].filter(Boolean).length;
  return {total,counts,eligible,headline:ratio(counts.correct,eligible),raw:ratio(counts.correct,total),falsePlacements:counts['false-placement'],uniqueReasons:[...reasons.values()].map(r=>({...r,share:ratio(r.count,total)})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,'en')),votes:{total:votes.size,correct:correctVotes,share:ratio(correctVotes,votes.size)},taxonomy:[...groups.values()].map(group => ({...group,share:ratio(group.count,total),stratumShare:ratio(group.count,strata.get(JSON.stringify([group.documentType,group.language])))})).sort((a,b)=>b.count-a.count||JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
}

export function projectionCompatibility(rows,code) {
  const distinct=values=>[...new Set(values)].sort();
  const liveContextVersions=distinct(rows.flatMap(row=>row.acquisition.contextVersions));
  const projections=rows.flatMap(row=>row.acquisition.projectionVersions||[]);
  const liveProposalParserVersions=distinct(projections.flatMap(p=>p.proposalParsers).filter(v=>v!=null));
  const liveDocumentExtractionVersions=distinct(projections.map(p=>p.documentExtraction).filter(v=>v!=null));
  const mismatches=[];
  for(const [kind,observed,expected] of [['document-context',liveContextVersions,code.documentContextVersion],['proposal-parser',liveProposalParserVersions,code.proposalParserVersion],['document-extractor',liveDocumentExtractionVersions,code.documentExtractionVersion]])
    for(const version of observed)if(version!==expected)mismatches.push({kind,observed:version??null,expected});
  if(!liveContextVersions.length)mismatches.push({kind:'document-context',observed:null,expected:code.documentContextVersion});
  return {liveContextVersions,liveProposalParserVersions,liveDocumentExtractionVersions,checkoutDocumentContextVersion:code.documentContextVersion,checkoutProposalParserVersion:code.proposalParserVersion,checkoutDocumentExtractionVersion:code.documentExtractionVersion,mismatches,compatible:!mismatches.length};
}

export function compareBaseline(current, baseline, {placementOnly=false}={}) {
  // Refuse a changing census or input snapshot: a score difference would not
  // isolate checkout behaviour. Code identity deliberately does not participate.
  const fingerprint = value => JSON.stringify({sample:value.sample,snapshotId:value.snapshotId,inputs:value.inputs});
  if (fingerprint(current) !== fingerprint(baseline)) throw new Error('Baseline sample/input hashes differ; replay the same frozen cache and sample.');
  const warnings=[];
  for(const file of ['scripts/amendment-benchmark-sample.mjs','scripts/amendment-benchmark-model.mjs','scripts/amendment-benchmark-resolution-oracle.mjs','scripts/amendment-benchmark-proposal-oracle.mjs','scripts/amendment-benchmark-operation-oracle.mjs','scripts/amendment-benchmark.mjs'])if((current.harness?.files||current.code?.files)?.[file]!== (baseline.harness?.files||baseline.code?.files)?.[file])warnings.push('Benchmark/oracle model changed: '+file+'; review scoring-policy changes before using deltas.');
  const replay=current.projectionMode==='cached-source-replay'&&['cached-source-replay','live-projection-comparison'].includes(baseline.projectionMode);
  const scope=replay?'full-pipeline-cached-sources':placementOnly?'placement-only-frozen-projections':'full-pipeline';
  const refuse=reason=>({scope,failed:true,refused:true,warnings,reason,deltas:{},taxonomyDeltas:[],regressions:[]});
  if(current.projectionMode!==baseline.projectionMode&&!replay)return refuse('Projection modes differ; create a cached-source baseline for this snapshot.');
  if(replay) {
    if(baseline.projectionMode==='live-projection-comparison')warnings.push('Baseline is the recorded live-projection comparison; deltas include switching to cached-source replay.');
    if(placementOnly)warnings.push('--placement-only is an alias for full cached-source comparison; all producer outcomes are evaluated.');
  } else if(placementOnly) {
    const before=baseline.code?.producerFingerprint,after=current.code?.producerFingerprint;
    if(!before?.sha256||!after?.sha256||before.schemaVersion!==2||after.schemaVersion!==2||JSON.stringify(before)!==JSON.stringify(after))return refuse('Source-extraction/projection producers changed or their fingerprints are missing; placement-only comparison requires a new cached-source baseline.');
    for(const report of [baseline,current]) {
      const compatibility=report.compatibility;
      if(typeof compatibility?.compatible!=='boolean'||!Array.isArray(compatibility.mismatches)||!compatibility.compatible&&!compatibility.mismatches.length||compatibility.mismatches.some(m=>m.kind!=='document-context'||!Number.isInteger(m.observed)||m.observed<1||!Number.isInteger(m.expected)||m.expected<1))return refuse('Placement-only mode waives only a recorded document-context wrapper-version mismatch.');
    }
    warnings.push('Placement-only scope: frozen API projections; unchanged source producers; document-context wrapper-version mismatches acknowledged. Extraction/projection changes are not evaluated.');
  } else if(current.compatibility?.compatible===false||baseline.compatibility?.compatible===false)return refuse('Live projection versions differ from checkout; in-process source replay is required.');
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
  return {scope,warnings,deltas,taxonomyDeltas,regressions,failed:regressions.length>0||current.metrics.falsePlacements>0};
}

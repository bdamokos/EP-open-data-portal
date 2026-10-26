import {parseTargetLabel,proposalCandidates,normaliseForMatching} from './proposal-structure.mjs';
import {amendmentOperation} from './document-context-model.mjs';

const normal=value=>normaliseForMatching(value,{stripNumbering:false});
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const labelPattern=label=>new RegExp(`^(?:\\(${escape(label.value)}\\)\\s*|${escape(label.value)}[.)]${/^\d/u.test(label.value)?'(?:\\s+|(?=\\p{Lu}))':'\\s*'})`,'u');
const MAX_UNIT_CHARACTERS=256*1024,MAX_COLUMN_CHARACTERS=64*1024;
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
const parentKey=unit=>JSON.stringify(unit.path.slice(0,-1).map(({kind,value,occurrence})=>[kind,value,occurrence??null]));
const suffixes=['','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','aa','ab','ac'];
const latinSuffixes=['','bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];
const suffixRank=(suffix,requested)=> (latinSuffixes.includes(requested)&&requested?latinSuffixes:suffixes).indexOf(suffix);

// Retain UTF-16 source ranges while normalizing punctuation and whitespace.
// Numbering is removed only for labels supplied by the parsed unit metadata.
// A parity check below withholds any normalization form we cannot map exactly.
export function proposalMatchingOffsets(text,labelsByLine=[]) {
  let normalized='',positions=[],expected=[];
  let lineIndex=0;
  const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'});
  for(const line of text.split(/\r?\n/)) {
    const lineStart=positions._lineStart??0;
    let tokens=[];
    for(const part of segmenter.segment(line)) {
      const value=part.segment.normalize('NFC').replace(/\u00ad/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/[‘’‚‛ʻʼ]/g,"'").replace(/[“”„‟«»]/g,'"').replace(/[‐‑‒–—]/g,'-');
      for(let i=0;i<value.length;i++)tokens.push({value:value[i],start:lineStart+part.index,end:lineStart+part.index+part.segment.length});
    }
    const trim=()=>{while(tokens.length&&/\s/u.test(tokens[0].value))tokens.shift();while(tokens.length&&/\s/u.test(tokens.at(-1).value))tokens.pop();};
    trim();if(/['"]/.test(tokens[0]?.value??'')){tokens.shift();trim();}
    let key=tokens.map(t=>t.value).join('');
    const labels=labelsByLine[lineIndex++]??[],pattern=labels.map(labelPattern).find(pattern=>pattern.test(key));
    const prefix=pattern?.exec(key)?.[0].length??0;
    expected.push(normal(line).replace(pattern??/$^/u,''));
    tokens=tokens.slice(prefix);
    while(tokens.length&&/[.;'"\s]/u.test(tokens.at(-1).value))tokens.pop();
    trim();
    const collapsed=[];
    for(const token of tokens) {
      if(/\s/u.test(token.value)){if(collapsed.at(-1)?.value===' ')collapsed.at(-1).end=token.end;else collapsed.push({...token,value:' '});}
      else collapsed.push(token);
    }
    if(collapsed.length){if(normalized){normalized+=' ';positions.push({start:lineStart,end:lineStart});}normalized+=collapsed.map(t=>t.value).join('');positions.push(...collapsed);}
    positions._lineStart=lineStart+line.length+(text.slice(lineStart+line.length).startsWith('\r\n')?2:1);
  }
  delete positions._lineStart;
  return normalized===expected.join(' ').replace(/\s+/gu,' ').trim()?{normal:normalized,positions}:null;
}
function unitText(proposal,unit) {
  const paragraphs=proposal.paragraphs.slice(unit.extent.start,unit.extent.end);
  return {paragraphs,text:paragraphs.map(p=>p.text).join('\n')};
}
function toSourcePosition(paragraphs,offset) {
  let base=0;
  for(const p of paragraphs){if(offset<=base+p.text.length)return {paragraph:p.index,offset:Math.max(0,offset-base)};base+=p.text.length+1;}
  return null;
}
// A heading styled as an article can be unreadable by the current label
// grammar (for example a compact "Article2"). It cannot extend Article 1.
function unparsedArticleHeading(proposal,unit) {
  const articles=new Set(flat(proposal.units).filter(u=>u.kind==='article').map(u=>u.extent.start));
  return proposal.paragraphs.slice(unit.extent.start,unit.extent.end).some(p=>/Titrearticle/i.test(p.properties?.styleId??'')&&/^[\p{L}]+\s*\d[\p{L}\d. -]*$/u.test(p.text.trim().split(/\r?\n/)[0])&&!articles.has(p.index));
}
function matchUnit(proposal,unit,original) {
  if(unparsedArticleHeading(proposal,unit))return {reason:'source_structure_unavailable'};
  const {paragraphs,text}=unitText(proposal,unit);
  if(text.length>MAX_UNIT_CHARACTERS)return {reason:'matching_budget'};
  const labelled=flat([unit]).filter(u=>u.label?.prefix&&['paragraph','point','recital'].includes(u.kind));
  const labelsByLine=paragraphs.map(p=>labelled.filter(u=>u.spans.some(span=>span.paragraph===p.index&&span.start===0)).map(u=>u.label));
  const labels=labelled.map(u=>u.label);
  const key=proposalMatchingOffsets(original,original.split(/\r?\n/).map(()=>labels))?.normal,mapped=proposalMatchingOffsets(text,labelsByLine);
  if(!key||!mapped)return {reason:'conflicting_target_evidence'};
  const whole=mapped.normal===key;
  let at=whole?0:mapped.normal.indexOf(key),matches=[];
  while(at>=0){const end=at+key.length;const word=char=>/[\p{L}\p{N}]/u.test(char??'');if(!(word(key[0])&&word(mapped.normal[at-1]))&&!(word(key.at(-1))&&word(mapped.normal[end])))matches.push(at);if(whole)break;at=mapped.normal.indexOf(key,at+1);}
  if(matches.length!==1)return {reason:'conflicting_target_evidence'};
  at=matches[0];
  let start=whole?0:mapped.positions[at].start,end=whole?text.length:mapped.positions[at+key.length-1].end;
  // If the match consumes a normalized source line, retain its original label,
  // quotation and punctuation too. A partial sentence keeps its exact slice.
  const lineStart=text.lastIndexOf('\n',start-1)+1,nextBreak=text.indexOf('\n',end),lineEnd=nextBreak<0?text.length:nextBreak;
  const consumesLineEnd=!normal(text.slice(end,lineEnd));
  if(consumesLineEnd&&(at===0||mapped.positions[at-1].end<=lineStart))start=lineStart;
  if(!normal(text.slice(end,lineEnd)))end=lineEnd;
  else if(/[.;'’”"]\s*$/u.test(original))end+=text.slice(end,lineEnd).match(/^[.;'’”"]+/u)?.[0].length??0;
  const from=toSourcePosition(paragraphs,start),to=toSourcePosition(paragraphs,end);
  if(!from||!to)return {reason:'conflicting_target_evidence'};
  const matched=paragraphs.filter(p=>p.index>=from.paragraph&&p.index<=to.paragraph);
  if(original.includes('\uFFFC')||text.slice(start,end).includes('\uFFFC'))return {reason:'math_comparison_unavailable'};
  if(matched.some(p=>!p.complete||!p.source||p.source.complete===false||p.source.container==='other')||matched.some(p=>p.source.container!==matched[0].source.container||p.source.container==='table-cell'&&p.source.containerPath!==matched[0].source.containerPath))return {reason:'source_passage_incomplete'};
  if(proposal.gaps.some(gap=>gap.code==='unclosed-quotation'&&gap.paragraph>=unit.extent.start&&gap.paragraph<unit.extent.end))return {reason:'source_passage_incomplete'};
  return {span:{start:from.paragraph,end:to.paragraph},splice:{start:from,end:to},originalText:text.slice(start,end),whole};
}

// Subparagraphs carry no label in the proposal. Resolve the containing
// provision and require a unique wording match within the numbered
// subparagraph's own paragraphs. A provision's own lead text is the first
// subparagraph; an implicit paragraph has none. Points make numbering ambiguous.
function subparagraphMatch(items,target,original) {
  const last=target.segments.at(-1);
  if(last?.kind!=='subparagraph'||last.isNew||last.suffix||!last.number||target.segments.length<2)return null;
  const parents=items.flatMap((item,itemIndex)=>proposalCandidates(item.proposal,target.segments.slice(0,-1)).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  if(!parents.length)return null;
  if(parents.length>1||parents[0].unit.pathConflict)return {reason:'multiple_published_targets'};
  const {itemIndex,proposal}=parents[0];let unit=parents[0].unit;
  if(unit.kind==='article') {
    const body=unit.children.filter(child=>child.kind!=='title');
    if(body.length!==1||!body[0].implicit)return {reason:'source_structure_unavailable'};
    unit=body[0];
  }
  if(!['paragraph','point'].includes(unit.kind))return {reason:'source_structure_unavailable'};
  // A numbered line parsed as a title may be the real first subparagraph.
  const container=flat(proposal.units).find(parent=>parent.children.includes(unit));
  if(unit.implicit&&container?.children.some(child=>child.kind==='title'&&child.content.some(index=>/^\s*[‘'"“«„]?\s*(?:\(|\p{N}|[\p{L}\p{N}]{1,6}[.)])/u.test(proposal.paragraphs[index]?.text??''))))return {reason:'source_structure_unavailable'};
  const children=unit.children,lead=unit.implicit||!unit.content.length?null:{start:unit.content[0],end:children[0]?.extent.start??unit.extent.end};
  if(children.some(child=>child.kind!=='subparagraph')&&(last.number>1||!lead))return {reason:'source_structure_unavailable'};
  const bounds=[...(lead?[lead]:[]),...children.map(child=>child.extent)][last.number-1];
  if(!bounds||bounds.end<=bounds.start)return null;
  const match=matchUnit(proposal,unit,original);
  if(!match.span)return match;
  if(match.span.start<bounds.start||match.span.end>=bounds.end)return {reason:'conflicting_target_evidence'};
  return {itemIndex,unit,match};
}

/** All addresses are proposal-level. Inner quoted provisions cannot be candidates. */
export function resolveProposalPlacement(items,{originalText,proposedText,targetLabel,targetPath,language}={}) {
  const operation=amendmentOperation({originalText,proposedText}),evidence=[];
  const unresolved=reason=>({operation,status:'unresolved',reason,evidence});
  if(!operation)return unresolved('amendment_wording_unavailable');
  if([originalText,proposedText].some(text=>text.length>MAX_COLUMN_CHARACTERS))return unresolved('matching_budget');
  if([originalText,proposedText].some(text=>text.includes('\uFFFC')))return unresolved('math_comparison_unavailable');
  // Lists without structured location tags still publish the location as a
  // heading in the same document and language; that heading is the target.
  const paths=targetPath?.proposal?.length?targetPath.proposal:null;
  if(paths&&paths.length!==1)return unresolved('target_reference_unavailable');
  // A structured underlying-act target without a proposal address is not an outer location.
  if(!paths&&targetPath?.underlying?.length)return unresolved('target_reference_unavailable');
  let target;try{target=parseTargetLabel(paths?.[0]?.raw??targetLabel,language);}catch{return unresolved('reference_language_unsupported');}
  if(!target.complete||!target.segments.length)return unresolved('target_reference_unavailable');
  evidence.push({basis:'proposal-target-path',label:target.raw});
  const candidates=items.flatMap((item,itemIndex)=>proposalCandidates(item.proposal,target).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  if(operation==='insert') {
    if(candidates.length)return unresolved('duplicate_target_label');
    const label=target.segments.at(-1),rank=suffixRank(label.suffix,label.suffix);
    if(!label.isNew||label.number===null||!label.suffix||rank<1)return unresolved('insertion_reference_unavailable');
    const preceding=target.segments.slice(0,-1),parents=preceding.length?items.flatMap((item,itemIndex)=>proposalCandidates(item.proposal,preceding).map(unit=>({itemIndex,unit}))):null;
    if(parents&&parents.length!==1)return unresolved('parent_target_not_found');
    const anchors=[];
    for(const [itemIndex,item] of items.entries())for(const unit of flat(item.proposal.units)){
      if(unit.scope!=='proposal'||unit.kind!==label.kind||unit.label?.number!==label.number)continue;
      const index=suffixRank(unit.label.suffix,label.suffix);if(index<0||index>=rank)continue;
      if(parents&&(itemIndex!==parents[0].itemIndex||parentKey(unit)!==JSON.stringify(parents[0].unit.path.map(({kind,value,occurrence})=>[kind,value,occurrence??null]))))continue;
      anchors.push({itemIndex,unit,index});
    }
    if(!anchors.length)return unresolved('relative_target_not_found');
    if(new Set(anchors.map(a=>a.itemIndex+'|'+parentKey(a.unit))).size!==1)return unresolved('multiple_published_targets');
    const highest=Math.max(...anchors.map(a=>a.index)),best=anchors.filter(a=>a.index===highest);
    if(best.length!==1||best[0].unit.pathConflict)return unresolved('multiple_published_targets');
    const anchor=best[0],proposal=items[anchor.itemIndex].proposal;
    // A suffix boundary must follow physical siblings in increasing source order.
    // Descendants and provisions under other parents do not establish this boundary.
    const siblings=flat(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind===label.kind&&parentKey(unit)===parentKey(anchor.unit)).sort((a,b)=>a.extent.start-b.extent.start);
    for(let i=0;i<siblings.length;i++){
      const current=siblings[i],previous=siblings[i-1];
      const currentRank=suffixRank(current.label?.suffix,label.suffix),previousRank=previous?suffixRank(previous.label?.suffix,label.suffix):0;
      if(current.pathConflict||current.label?.number===null||currentRank<0||previous&&(previous.extent.end>current.extent.start||previous.label.number>current.label.number||previous.label.number===current.label.number&&previousRank>=currentRank))return unresolved('source_structure_unavailable');
    }
    if(!anchor.unit.complete||proposal.paragraphs.slice(anchor.unit.extent.start,anchor.unit.extent.end).some(p=>!p.source||p.source.complete===false)||proposal.gaps.some(gap=>gap.code==='unclosed-quotation'&&gap.paragraph>=anchor.unit.extent.start&&gap.paragraph<anchor.unit.extent.end))return unresolved('source_passage_incomplete');
    if(unparsedArticleHeading(proposal,anchor.unit))return unresolved('source_structure_unavailable');
    const insertBefore=anchor.unit.extent.end;
    if(insertBefore<=anchor.unit.extent.start)return unresolved('source_passage_incomplete');
    evidence.push({basis:'preceding-sibling-subtree',anchor:anchor.unit.id});
    return {operation,status:'placed',itemIndex:anchor.itemIndex,insertAfter:insertBefore-1,insertBefore,evidence};
  }
  if(!candidates.length) {
    const sub=subparagraphMatch(items,target,originalText);
    if(!sub)return unresolved('target_not_found');
    if(sub.reason)return unresolved(sub.reason);
    evidence.push({basis:'subparagraph-wording-match',anchor:sub.unit.id});
    return {operation,status:'placed',itemIndex:sub.itemIndex,span:sub.match.span,splice:sub.match.splice,originalText:sub.match.originalText,evidence};
  }
  if(candidates.length>1&&new Set(candidates.map(c=>c.itemIndex+'|'+parentKey(c.unit))).size!==1)return unresolved('multiple_published_targets');
  const matches=candidates.map(candidate=>({...candidate,match:matchUnit(candidate.proposal,candidate.unit,originalText)}));
  const matching=matches.filter(candidate=>candidate.match.span&&(candidates.length===1||candidate.match.whole));
  if(matching.length!==1)return unresolved(matches.find(c=>c.match.reason==='math_comparison_unavailable')?'math_comparison_unavailable':matches.find(c=>c.match.reason==='source_structure_unavailable')?'source_structure_unavailable':'conflicting_target_evidence');
  const selected=matching[0];
  if(candidates.length===1&&selected.unit.pathConflict)return unresolved('multiple_published_targets');
  evidence.push({basis:candidates.length>1?'unique-duplicate-wording-match':'normalised-original-match',anchor:selected.unit.id});
  return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
}

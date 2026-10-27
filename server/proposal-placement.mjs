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
function subparagraphMatch(items,target,original,candidatesFor) {
  const last=target.segments.at(-1);
  if(last?.kind!=='subparagraph'||last.isNew||last.suffix||!last.number||target.segments.length<2)return null;
  const parents=candidatesFor(target.segments.slice(0,-1));
  if(!parents.length)return null;
  if(parents.length>1||parents[0].unit.pathConflict)return {reason:'multiple_published_targets'};
  const {itemIndex,proposal}=parents[0];let unit=parents[0].unit;
  if(unit.kind==='article') {
    const body=unit.children.filter(child=>child.kind!=='title');
    if(body.length!==1||!body[0].implicit)return {reason:'source_structure_unavailable'};
    unit=body[0];
  }
  if(!['paragraph','point'].includes(unit.kind))return {reason:'source_structure_unavailable'};
  const children=unit.children,lead=unit.implicit||!unit.content.length?null:{start:unit.content[0],end:children[0]?.extent.start??unit.extent.end};
  if(children.some(child=>child.kind!=='subparagraph')&&(last.number>1||!lead))return {reason:'source_structure_unavailable'};
  const bounds=[...(lead?[lead]:[]),...children.map(child=>child.extent)][last.number-1];
  if(!bounds||bounds.end<=bounds.start)return null;
  const match=matchUnit(proposal,unit,original);
  if(!match.span)return match;
  if(match.span.start<bounds.start||match.span.end>=bounds.end)return {reason:'conflicting_target_evidence'};
  return {itemIndex,unit,match};
}

// A parser can lose a target's final levels while preserving its containing
// provision. Wording is sufficient only when it selects complete source lines
// inside the deepest unique ancestor and occurs once in the entire document.
// Numbered subparagraphs keep their independent ordinal check above.
const documentMatches=new WeakMap();
function uniqueDocumentWording(proposal,original) {
  let cached=documentMatches.get(proposal);
  if(!cached){
    const units=flat(proposal.units).filter(unit=>unit.label?.prefix&&['paragraph','point','recital'].includes(unit.kind));
    const byParagraph=new Map();
    for(const unit of units)for(const span of unit.spans)if(span.start===0){const labels=byParagraph.get(span.paragraph)??[];labels.push(unit.label);byParagraph.set(span.paragraph,labels);}
    cached={labels:units.map(unit=>unit.label),mapped:proposalMatchingOffsets(proposal.paragraphs.map(p=>p.text).join('\n'),proposal.paragraphs.map(p=>byParagraph.get(p.index)??[]))};
    documentMatches.set(proposal,cached);
  }
  const key=proposalMatchingOffsets(original,original.split(/\r?\n/).map(()=>cached.labels))?.normal;
  if(!key||!cached.mapped)return false;
  const text=cached.mapped.normal,word=char=>/[\p{L}\p{N}]/u.test(char??'');
  let count=0,at=text.indexOf(key);
  while(at>=0){
    if(!(word(key[0])&&word(text[at-1]))&&!(word(key.at(-1))&&word(text[at+key.length])))if(++count>1)return false;
    at=text.indexOf(key,at+1);
  }
  return count===1;
}
const wholeLines=(proposal,match)=>match.splice.start.offset===0&&match.splice.end.offset===proposal.paragraphs[match.splice.end.paragraph].text.length;
// A missing parser level cannot override a provision that the source actually
// names. Match labels from the owning proposal units, allowing extra parser
// levels; quoted underlying-act labels are a separate address space.
function contradictoryFallbackOwner(ancestor,omitted,match) {
  const overlaps=span=>span.paragraph>=match.span.start&&span.paragraph<=match.span.end&&
    span.end>(span.paragraph===match.span.start?match.splice.start.offset:0)&&
    span.start<(span.paragraph===match.span.end?match.splice.end.offset:Infinity);
  const contradicts=chain=>{
    const proposalOwners=chain.filter(unit=>unit.scope==='proposal');
    const instruction=[ancestor,...proposalOwners].findLast(unit=>unit.instruction)?.instruction;
    const instructionLead=instruction?.raw.split(/:\s*[‘“„«"'”]/u,1)[0].replace(/\s+/gu,' ');
    for(const kind of new Set(omitted.map(segment=>segment.kind))){
      const wanted=omitted.filter(segment=>segment.kind===kind);
      let observed=proposalOwners.filter(unit=>!unit.implicit&&unit.label?.kind===kind).map(unit=>unit.label);
      if(observed.length){
        for(let index=wanted.length-1;index>=0;index--){
          const exact=observed.findLastIndex(label=>label.value===wanted[index].value);
          if(exact>=0)observed=observed.slice(0,exact);
          // A label matching an earlier omitted level leaves the later level
          // silent. An extra enclosing parser level does not change its owner.
          else if(observed.length&&!wanted.slice(0,index).some(segment=>segment.value===observed.at(-1).value))return true;
        }
      }else{
        const named=(instruction?.underlyingTargets??[]).filter(segment=>segment.kind===kind&&instructionLead.includes(segment.raw)&&
          (segment.number!==null||/^[\p{L}]$|^[IVXLCDMivxlcdm]+$/u.test(segment.value)||/[([]/u.test(segment.raw)));
        if(named.length&&!named.some(segment=>segment.value===wanted.at(-1).value))return true;
      }
    }
    return false;
  };
  const visit=(unit,chain)=>unit.spans.some(overlaps)&&contradicts(chain)||unit.children.some(child=>visit(child,[...chain,child]));
  return visit(ancestor,[]);
}

function ancestorFallback(target,original,candidatesFor) {
  if(target.segments.at(-1).kind==='subparagraph')return null;
  for(let depth=target.segments.length-1;depth>0;depth--){
    const parents=candidatesFor(target.segments.slice(0,depth));
    if(!parents.length)continue;
    if(parents.length!==1)return null;
    const parent=parents[0],match=matchUnit(parent.proposal,parent.unit,original);
    if(!match.span||!wholeLines(parent.proposal,match)||!uniqueDocumentWording(parent.proposal,original))return null;
    if(contradictoryFallbackOwner(parent.unit,target.segments.slice(depth),match))return {reason:'conflicting_target_evidence'};
    return {...parent,match};
  }
  return null;
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
  // An uncontained annex paragraph can share an act address. The item identity
  // still establishes that an address without Annex cannot select it.
  const eligible=item=>item.kind!=='annex'||target.segments.some(segment=>segment.kind==='annex');
  const candidatesFor=address=>items.flatMap((item,itemIndex)=>!eligible(item)?[]:proposalCandidates(item.proposal,address).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  const candidates=candidatesFor(target);
  const placedMatch=(selected,basis)=>{
    evidence.push({basis,anchor:selected.unit.id});
    return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
  };
  if(operation==='insert') {
    if(candidates.length)return unresolved('duplicate_target_label');
    const label=target.segments.at(-1),rank=suffixRank(label.suffix,label.suffix);
    if(!label.isNew||label.number===null||!label.suffix||rank<1)return unresolved('insertion_reference_unavailable');
    const preceding=target.segments.slice(0,-1),parents=preceding.length?candidatesFor(preceding):null;
    if(parents&&parents.length!==1)return unresolved('parent_target_not_found');
    const anchors=[];
    for(const [itemIndex,item] of items.entries())for(const unit of eligible(item)?flat(item.proposal.units):[]){
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
    const sub=subparagraphMatch(items,target,originalText,candidatesFor);
    if(!sub){
      const fallback=ancestorFallback(target,originalText,candidatesFor);
      if(fallback?.reason)return unresolved(fallback.reason);
      return fallback?placedMatch(fallback,'ancestor-unique-wording'):unresolved('target_not_found');
    }
    if(sub.reason)return unresolved(sub.reason);
    evidence.push({basis:'subparagraph-wording-match',anchor:sub.unit.id});
    return {operation,status:'placed',itemIndex:sub.itemIndex,span:sub.match.span,splice:sub.match.splice,originalText:sub.match.originalText,evidence};
  }
  if(candidates.length>1&&new Set(candidates.map(c=>c.itemIndex+'|'+parentKey(c.unit))).size!==1)return unresolved('multiple_published_targets');
  const matches=candidates.map(candidate=>({...candidate,match:matchUnit(candidate.proposal,candidate.unit,originalText)}));
  const matching=matches.filter(candidate=>candidate.match.span&&(candidates.length===1||candidate.match.whole||uniqueDocumentWording(candidate.proposal,originalText)));
  // A resolved address with different wording is a conflict, even when a
  // unique passage occurs elsewhere in its ancestor. Repair numbering first.
  if(matching.length!==1)return unresolved(matches.find(c=>c.match.reason==='math_comparison_unavailable')?'math_comparison_unavailable':matches.find(c=>c.match.reason==='source_structure_unavailable')?'source_structure_unavailable':'conflicting_target_evidence');
  const selected=matching[0];
  if(candidates.length===1&&selected.unit.pathConflict&&!uniqueDocumentWording(selected.proposal,originalText))return unresolved('multiple_published_targets');
  evidence.push({basis:candidates.length>1?'unique-duplicate-wording-match':'normalised-original-match',anchor:selected.unit.id});
  return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
}

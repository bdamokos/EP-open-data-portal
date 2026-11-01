import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {parseTargetLabel,proposalCandidates,normaliseForMatching} from './proposal-structure.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {latinSuffixRank} from './legal-latin-numbering.mjs';
import {instructionOperation} from './proposal-instructions.mjs';

const normal=value=>normaliseForMatching(value,{stripNumbering:false});
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const labelPattern=label=>new RegExp(`^(?:\\(${escape(label.value)}\\)\\s*|${escape(label.value)}[.)]${/^\d/u.test(label.value)?'(?:\\s+|(?=\\p{Lu}))':'\\s*'})`,'u');
const MAX_UNIT_CHARACTERS=256*1024,MAX_COLUMN_CHARACTERS=64*1024;
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
const parentKey=unit=>JSON.stringify(unit.path.slice(0,-1).map(({kind,value,occurrence})=>[kind,value,occurrence??null]));
const suffixes=['','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','aa','ab','ac'];
const greekSuffixes=['','α','β','γ','δ','ε','στ','ζ','η','θ','ι','ια','ιβ','ιγ','ιδ','ιε','ιστ','ιζ','ιη','ιθ','κ'];
const suffixRank=(suffix,requested)=>requested&&latinSuffixRank(requested)!==null?(latinSuffixRank(suffix)??-1):(greekSuffixes.includes(requested)&&requested?greekSuffixes:suffixes).indexOf(suffix);

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
// Compare the complete original, including native notes, before matching its body.
function footnoteBody(proposal,unit,original,formatting) {
  const divider=/\n_{5,}\s*\n/u.exec(original);
  if(!divider)return null;
  const body=original.slice(0,divider.index),lines=original.slice(divider.index+divider[0].length).trim().split(/\n+/u);
  const marks=(formatting??[]).filter(f=>f.kind==='superscript'&&f.end<=body.length).sort((a,b)=>a.start-b.start);
  const compact=text=>text.normalize('NFC').replace(/\s/gu,'');
  if(!marks.length||marks.length!==lines.length)return false;
  let clean='',last=0;const positions=[];
  for(const m of marks){
    if(m.start<last||m.end<=m.start||!/^\d+$/u.test(body.slice(m.start,m.end)))return false;
    clean+=body.slice(last,m.start);positions.push(compact(clean).length);last=m.end;
  }
  clean+=body.slice(last);
  const rows=proposal.paragraphs.slice(unit.extent.start,unit.extent.end),text=rows.map(p=>p.text).join('\n');
  if(compact(text)!==compact(clean))return false;
  const anchors=(proposal.anchors??[]).filter(a=>a.paragraph>=unit.extent.start&&a.paragraph<unit.extent.end);
  if(anchors.length!==marks.length)return false;
  for(const [i,a] of anchors.entries()){
    const note=proposal.notes?.find(n=>n.id===a.note),line=/^(\d+)\s+([\s\S]+)$/u.exec(lines[i]);
    const prefix=rows.filter(p=>p.index<a.paragraph).map(p=>p.text).join('\n')+'\n'+proposal.paragraphs[a.paragraph].text.slice(0,a.offset);
    if(!note?.complete||!line||line[1]!==body.slice(marks[i].start,marks[i].end)||compact(line[2])!==compact(note.text)||compact(prefix).length!==positions[i])return false;
  }
  return text;
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
// subparagraph; an implicit paragraph has none. Points belong to the preceding
// subparagraph; only directly owned continuations start subsequent ones.
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
  const continuations=children.filter(child=>child.kind==='subparagraph');
  if(children.some(child=>child.kind!=='subparagraph')&&!continuations.length&&!lead)return {reason:'source_structure_unavailable'};
  const bounds=[...(lead?[lead]:[]),...continuations.map(child=>child.extent)][last.number-1];
  if(!bounds&&children.some(child=>child.kind!=='subparagraph'))return {reason:'source_structure_unavailable'};
  if(!bounds||bounds.end<=bounds.start)return null;
  const match=matchUnit(proposal,unit,original);
  if(!match.span)return match;
  if(match.span.start<bounds.start||match.span.end>=bounds.end)return {reason:'conflicting_target_evidence'};
  return {itemIndex,unit,match};
}

// "Introductory part" addresses only a provision's own lead, as for
// subparagraph 1. Points and later continuation paragraphs are outside it.
function introductoryMatch(target,original,candidatesFor) {
  if(target.segments.at(-2)?.kind==='subparagraph')return subparagraphMatch(null,{...target,segments:target.segments.slice(0,-1)},original,candidatesFor)??{reason:'target_not_found'};
  const parents=candidatesFor(target.segments.slice(0,-1));
  if(parents.length!==1||parents[0].unit.pathConflict)return {reason:'multiple_published_targets'};
  const selected=parents[0];let unit=selected.unit;
  if(unit.kind==='article'){
    const body=unit.children.filter(child=>child.kind!=='title');
    if(body.length!==1||!body[0].implicit)return {reason:'source_structure_unavailable'};
    unit=body[0];
  }
  if(!['paragraph','point'].includes(unit.kind))return {reason:'source_structure_unavailable'};
  const bounds=unit.implicit?unit.children[0]?.kind==='subparagraph'?unit.children[0].extent:null:unit.content.length?{start:unit.content[0],end:unit.children[0]?.extent.start??unit.extent.end}:null;
  if(!bounds||bounds.end<=bounds.start)return {reason:'source_structure_unavailable'};
  const match=matchUnit(selected.proposal,{...unit,extent:bounds},original);
  return match.span?{...selected,unit,match}:match;
}

const labelBase=label=>label.base??(label.number!==null?String(label.number):label.suffix?label.value.slice(0,-label.suffix.length):label.value);
const romanNumber=value=>{
  if(!/^[ivxlcdm]+$/u.test(value))return null;
  const digits={i:1,v:5,x:10,l:50,c:100,d:500,m:1000};
  return [...value].reduce((sum,c,i)=>sum+(digits[c]<(digits[value[i+1]]??0)?-digits[c]:digits[c]),0);
};
function siblingOrder(siblings,label) {
  const bases=[...siblings.map(unit=>labelBase(unit.label)),labelBase(label)];
  const family=bases.every(base=>/^\d+$/u.test(base))?'number':bases.every(base=>/^[a-z]$/u.test(base))?'letter':bases.every(base=>romanNumber(base)!==null)?'roman':null;
  const ordinal=base=>family==='number'?Number(base):family==='letter'?base.charCodeAt(0):romanNumber(base);
  return family?unitLabel=>({number:ordinal(labelBase(unitLabel)),rank:suffixRank(unitLabel.suffix,label.suffix)}):null;
}
function completeBoundary(proposal,unit) {
  return unit.complete&&!unparsedArticleHeading(proposal,unit)&&proposal.paragraphs.slice(unit.extent.start,unit.extent.end).every(p=>p.complete&&p.source&&p.source.complete!==false)&&!proposal.gaps.some(gap=>gap.code==='unclosed-quotation'&&gap.paragraph>=unit.extent.start&&gap.paragraph<unit.extent.end);
}
// Repeated labels inside a replacement quotation make its children ambiguous,
// but do not move the next printed instruction. Use that boundary only for a
// sibling insertion, with consecutive native rows and no other incompleteness.
function quotedConflictBoundary(proposal,unit,next) {
  if(unit.scope!=='proposal'||unit.kind!=='point'||unit.pathConflict||!unit.instruction||!next||
    unit.extent.end!==next.extent.start||parentKey(unit)!==parentKey(next)||!completeBoundary(proposal,next))return false;
  const descendants=flat([unit]);
  if(!descendants.some(child=>child.pathConflict)||descendants.some(child=>child.boundaryAmbiguous||
    child.pathConflict&&child.scope!=='quoted'||child.kind==='table'&&!child.table.complete))return false;
  const intact=child=>child.content.every(index=>proposal.paragraphs[index].complete)&&child.children.every(intact)&&!child.boundaryAmbiguous;
  if(!intact(unit)||unparsedArticleHeading(proposal,unit)||proposal.gaps.some(gap=>gap.code==='unclosed-quotation'&&gap.paragraph>=unit.extent.start&&gap.paragraph<unit.extent.end))return false;
  const rows=proposal.paragraphs.slice(unit.extent.start,next.extent.start+1);
  return rows.every((row,index)=>row.complete&&row.source?.complete===true&&row.source.container==='body'&&(!index||
    row.source.containerPath===rows[index-1].source.containerPath&&row.source.segment===rows[index-1].source.segment&&row.source.ordinal===rows[index-1].source.ordinal+1));
}
function insertionPlacement(items,target,candidatesFor,eligible) {
  const label=target.segments.at(-1),rank=suffixRank(label.suffix,label.suffix),preceding=target.segments.slice(0,-1);
  if(!label.isNew||rank<0||(!label.suffix&&label.kind!=='point'))return {reason:'insertion_reference_unavailable'};
  const parents=preceding.length?candidatesFor(preceding):null;
  if(parents&&parents.length!==1)return {reason:'parent_target_not_found'};
  const parent=parents?.[0];
  if(parent?.unit.pathConflict)return {reason:'multiple_published_targets'};
  const siblings=[];
  for(const [itemIndex,item] of items.entries())for(const unit of eligible(item)?flat(item.proposal.units):[]){
    if(unit.scope!=='proposal'||unit.kind!==label.kind||!unit.label)continue;
    if(parent&&(itemIndex!==parent.itemIndex||parentKey(unit)!==JSON.stringify(parent.unit.path.map(({kind,value,occurrence})=>[kind,value,occurrence??null]))))continue;
    siblings.push({itemIndex,unit});
  }
  // A new first Roman point can start a list under an existing childless point.
  // Other missing predecessors cannot be inferred from the amendment sequence.
  if(!siblings.length&&!label.suffix&&!label.negative&&label.value==='i'&&parent?.unit.kind==='point'&&!parent.unit.children.length){
    if(!completeBoundary(parent.proposal,parent.unit))return {reason:'source_passage_incomplete'};
    return {itemIndex:parent.itemIndex,insertBefore:parent.unit.extent.end,anchor:parent.unit,basis:'childless-parent-end'};
  }
  let anchors;
  if(label.negative){
    if(!parent||label.suffix||!['a','1'].includes(label.value.slice(1)))return {reason:'insertion_reference_unavailable'};
    const first=siblings.slice().sort((a,b)=>a.unit.extent.start-b.unit.extent.start)[0];
    if(!first||first.unit.label.value!==label.value.slice(1))return {reason:'relative_target_not_found'};
    anchors=[first];
  }else if(label.suffix){
    anchors=siblings.filter(({unit})=>labelBase(unit.label)===labelBase(label)&&suffixRank(unit.label.suffix,label.suffix)>=0&&suffixRank(unit.label.suffix,label.suffix)<rank);
    if(new Set(anchors.map(a=>a.itemIndex+'|'+parentKey(a.unit))).size>1)return {reason:'multiple_published_targets'};
    const highest=Math.max(...anchors.map(({unit})=>suffixRank(unit.label.suffix,label.suffix)));
    anchors=anchors.filter(({unit})=>suffixRank(unit.label.suffix,label.suffix)===highest);
  }else{
    if(!parent||!/^[a-z]$/u.test(label.value))return {reason:'insertion_reference_unavailable'};
    const previous=String.fromCharCode(label.value.charCodeAt(0)-1);
    anchors=siblings.filter(({unit})=>labelBase(unit.label)===previous);
    const highest=Math.max(...anchors.map(({unit})=>suffixRank(unit.label.suffix,label.suffix)));
    anchors=anchors.filter(({unit})=>suffixRank(unit.label.suffix,label.suffix)===highest);
  }
  if(!anchors.length)return {reason:'relative_target_not_found'};
  if(anchors.length!==1||anchors[0].unit.pathConflict)return {reason:'multiple_published_targets'};
  const anchor=anchors[0],proposal=items[anchor.itemIndex].proposal;
  const ordered=siblings.filter(s=>s.itemIndex===anchor.itemIndex&&parentKey(s.unit)===parentKey(anchor.unit)).map(s=>s.unit).sort((a,b)=>a.extent.start-b.extent.start);
  const positive=label.negative?{...label,value:label.value.slice(1),number:label.number}:label;
  const order=siblingOrder(ordered,positive);
  if(!order)return {reason:'source_structure_unavailable'};
  for(let i=0;i<ordered.length;i++){
    const unit=ordered[i],previous=ordered[i-1],current=order(unit.label),before=previous&&order(previous.label);
    if(unit.pathConflict||current.rank<0||previous&&(previous.extent.end>unit.extent.start||before.number>current.number||before.number===current.number&&before.rank>=current.rank))return {reason:'source_structure_unavailable'};
  }
  const next=ordered[ordered.indexOf(anchor.unit)+1];
  if(!completeBoundary(proposal,anchor.unit)&&!(label.suffix&&!label.negative&&quotedConflictBoundary(proposal,anchor.unit,next)))return {reason:'source_passage_incomplete'};
  if(label.negative){
    if(!completeBoundary(proposal,parent.unit)||parent.unit.extent.start>=anchor.unit.extent.start)return {reason:'source_passage_incomplete'};
    return {itemIndex:anchor.itemIndex,insertBefore:anchor.unit.extent.start,anchor:anchor.unit,basis:'first-sibling-start'};
  }
  const insertBefore=anchor.unit.extent.end;
  if(insertBefore<=anchor.unit.extent.start)return {reason:'source_passage_incomplete'};
  return {itemIndex:anchor.itemIndex,insertBefore,anchor:anchor.unit,basis:'preceding-sibling-subtree'};
}

const sameAddress=(left,right)=>!!left&&left.length===right.length&&left.every((segment,index)=>segment.kind===right[index].kind&&segment.value===right[index].value);

// Some Word lists flatten a numbered paragraph and its lettered points to
// peers. Recover only the printed, colon-introduced list bounded by the next
// numeric paragraph, using both published target lines and the act instruction.
function twoLinePointInsertion(selected,targetPath,proposedText,language) {
  const {unit:owner,proposal,itemIndex}=selected,reference=targetPath?.underlying?.[0];
  if(language!=='en'||targetPath?.language!==language||proposal.language!==language||targetPath.underlying?.length!==1||!reference?.document)return null;
  const inner=parseTargetLabel(reference.raw,language),[article,paragraph,label]=inner.segments;
  if(!inner.complete||inner.segments.length!==3||article.kind!=='article'||paragraph.kind!=='paragraph'||paragraph.isNew||paragraph.suffix||
    label.kind!=='point'||!label.isNew||!/^([a-z])[ab]$/u.test(label.value))return null;
  const printed=proposedText.trim().match(/^\(([a-z])\s*([ab])\)\s+\S/u);
  if(!printed||printed[1]+printed[2]!==label.value||instructionOperation(proposedText,language))return {reason:'conflicting_target_evidence'};
  let chain=[];
  const visit=(units,parents=[])=>{for(const unit of units){if(unit===owner){chain=[...parents,unit];return true;}if(visit(unit.children,[...parents,unit]))return true;}return false;};
  visit(proposal.units);
  const named=chain.map(unit=>unit.instruction?.raw.replace(/\s+/gu,' ').trim()).filter(raw=>/^(?:Regulation|Directive|Decision) .+ is amended as follows:$/u.test(raw??'')).at(-1);
  if(named!==reference.document.replace(/\s+/gu,' ').trim()+' is amended as follows:')return {reason:'conflicting_target_evidence'};
  const quotes=owner.children.filter(unit=>unit.kind==='quotation'&&sameAddress(unit.instructionPath,owner.path));
  if(quotes.length!==1)return null;
  const articles=flat(quotes).filter(unit=>unit.kind==='article'&&sameAddress(unit.underlyingPath,[article]));
  if(articles.length!==1)return {reason:'conflicting_target_evidence'};
  const container=articles[0],lines=proposal.paragraphs.slice(container.extent.start,container.extent.end);
  const starts=lines.filter(p=>new RegExp(`^${escape(paragraph.value)}\\.\\s+`).test(p.text));
  if(starts.length!==1||!/:\s*$/u.test(starts[0].text))return {reason:'source_structure_unavailable'};
  const start=starts[0].index,end=lines.find(p=>p.index>start&&/^\d+\.\s+/u.test(p.text))?.index;
  if(end===undefined)return {reason:'source_structure_unavailable'};
  const points=proposal.paragraphs.slice(start+1,end);
  const labels=points.map(p=>/^\(([a-z])\)\s+\S/u.exec(p.text)?.[1]);
  if(!labels.length||labels.some((value,index)=>!value||value!==String.fromCharCode(97+index)))return {reason:'source_structure_unavailable'};
  const index=labels.indexOf(label.value[0]);
  if(index<0||index+1>=points.length)return {reason:'insertion_reference_unavailable'};
  const boundary=proposal.paragraphs.slice(start,end+1);
  if(!owner.complete||owner.pathConflict||!container.complete||boundary.some((p,index)=>!p.complete||!p.source||p.source.complete===false||p.source.container!=='body'||
    index&&(p.source.segment!==boundary[index-1].source?.segment||p.source.ordinal!==boundary[index-1].source?.ordinal+1)))return {reason:'source_passage_incomplete'};
  return {itemIndex,insertBefore:points[index+1].index,evidence:[{basis:'two-line-act-target',label:reference.document,target:reference.raw,anchor:owner.id},{basis:'printed-paragraph-point-boundary',paragraph:paragraph.value,preceding:labels[index],following:labels[index+1]}]};
}

// ISG 3.3.2: an English numeric subdivision inserted between Na and Nb
// starts at Naa. This is a local, source-bounded family, not a suffix order.
function quotedInteriorInsertion(selected,targetPath,proposedText,language) {
  const {unit:owner,proposal,itemIndex}=selected,reference=targetPath?.underlying?.[0];
  if(language!=='en'||targetPath?.language!==language||proposal.language!==language||targetPath.underlying?.length!==1||!reference?.document||!reference.raw)return null;
  const inner=parseTargetLabel(reference.raw,language),label=inner.segments.at(-1);
  if(!inner.complete||inner.segments.length<2||inner.segments.slice(0,-1).some(segment=>segment.isNew)||
    label?.kind!=='paragraph'||!label.isNew||label.suffix!=='aa'||!/^\d+aa$/u.test(label.value))return null;
  // The published target "2a a" already parses as 2aa. Require that same
  // amendment's complete proposed cell to print 2aa, without an instruction.
  if(!new RegExp(`^${escape(label.value)}\\.\\s+\\S`,'u').test(proposedText.trim())||instructionOperation(proposedText,language))return {reason:'conflicting_target_evidence'};
  if(owner.scope!=='proposal'||!owner.instruction||!completeBoundary(proposal,owner))return {reason:'source_passage_incomplete'};
  let chain=[];
  const findOwner=(units,parents=[])=>{
    for(const unit of units){if(unit===owner){chain=[...parents,unit];return true;}if(findOwner(unit.children,[...parents,unit]))return true;}
    return false;
  };
  findOwner(proposal.units);
  // Use the nearest enclosing act instruction, never a recital, document title
  // or another amendment. Keep its literal citation rather than deriving a URL.
  const actPattern=/^((?:Directive|Regulation|Decision) (?:\((?:EU|EC|EEC)\) )?(?:No )?\d{1,4}\/\d{1,4}(?:\/(?:EU|EC|EEC))?) is amended as follows:$/u;
  const named=chain.map(unit=>({unit,match:actPattern.exec(unit.instruction?.raw.replace(/\s+/gu,' ').trim()??'')})).filter(value=>value.match).at(-1);
  if(!named||named.match[1]!==reference.document.replace(/\s+/gu,' ').trim())return {reason:'conflicting_target_evidence'};
  const quotes=owner.children.filter(unit=>unit.kind==='quotation'&&sameAddress(unit.instructionPath,owner.path));
  if(quotes.length!==1)return {reason:'source_structure_unavailable'};
  const quote=quotes[0];
  if(!completeBoundary(proposal,quote)||proposal.gaps.some(gap=>gap.paragraph>=owner.extent.start&&gap.paragraph<owner.extent.end))return {reason:'source_passage_incomplete'};
  const units=flat([quote]);
  if(units.some(unit=>unit.label&&sameAddress(unit.underlyingPath,inner.segments)))return {reason:'duplicate_target_label'};
  const prefix=inner.segments.slice(0,-1),base=String(label.number);
  const matches=(unit,suffix)=>unit.scope==='quoted'&&unit.kind===label.kind&&unit.label?.value===base+suffix&&
    sameAddress(unit.instructionPath,owner.path)&&sameAddress(unit.underlyingPath,[...prefix,{kind:label.kind,value:base+suffix}]);
  const anchors=units.filter(unit=>matches(unit,'a')),following=units.filter(unit=>matches(unit,'b'));
  if(anchors.length!==1||following.length!==1)return {reason:'relative_target_not_found'};
  const anchor=anchors[0],next=following[0],parent=units.find(unit=>unit.children.includes(anchor));
  if(!parent||parent.pathConflict||parent.children[parent.children.indexOf(anchor)+1]!==next||anchor.extent.end!==next.extent.start||
    anchor.extent.start<quote.extent.start||next.extent.end>quote.extent.end)return {reason:'source_structure_unavailable'};
  if(!completeBoundary(proposal,anchor)||!completeBoundary(proposal,next))return {reason:'source_passage_incomplete'};
  // Consecutive body rows prove that the predecessor includes its complete
  // continuation/child subtree and no omitted block lies at the boundary.
  const rows=proposal.paragraphs.slice(anchor.extent.start,next.extent.start+1);
  if(rows.length<2||rows.some((row,index)=>row.source.container!=='body'||index&&
    (row.source.containerPath!==rows[index-1].source.containerPath||row.source.segment!==rows[index-1].source.segment||row.source.ordinal!==rows[index-1].source.ordinal+1)))return {reason:'source_structure_unavailable'};
  return {itemIndex,insertBefore:next.extent.start,evidence:[
    {basis:'quoted-target-path',label:reference.raw,document:reference.document,language,sourceUrl:targetPath.sourceUrl,fetchedAt:targetPath.fetchedAt},
    {basis:'quoted-act-owner',anchor:named.unit.id,label:reference.document},
    {basis:'quoted-interior-sibling-boundary',owner:owner.id,quotation:quote.id,anchor:anchor.id,following:next.id},
  ]};
}

// A suffixed sibling may follow a whole provision supplied by an instruction.
// Partial-subparagraph replacements never establish the whole sibling's end.
function quotedSiblingInsertion(selected,proposedText,language) {
  if(language!=='en')return null;
  const {proposal,unit:owner,itemIndex}=selected;
  if(owner.scope!=='proposal'||!owner.instruction||!completeBoundary(proposal,owner)||/subparagraph/u.test(owner.instruction.raw))return null;
  const printed=/^[‘']?(\d+\s*[a-z]+)\.\s/u.exec(proposedText.trim());
  const instruction=/^(?:The following paragraph (\d+\s*[a-z]+) is inserted:|The following paragraph is inserted after the (seventh) paragraph:)/u.exec(proposedText.trim());
  const value=printed?(printed[1].replace(/\s/gu,'')):instruction?(instruction[1]?.replace(/\s/gu,'')??'7a'):null;
  if(!value)return null;
  const quotes=owner.children.filter(u=>u.kind==='quotation');
  if(!quotes.length)return null;
  const units=flat(quotes);
  if(units.some(u=>u.label?.value===value))return {reason:'duplicate_target_label'};
  const possible=units.filter(u=>['paragraph','point'].includes(u.kind)&&u.label?.value&&value.startsWith(u.label.value)&&value!==u.label.value&&/^[a-z]+$/u.test(value.slice(u.label.value.length)));
  const longest=Math.max(...possible.map(u=>u.label.value.length)),anchors=possible.filter(u=>u.label.value.length===longest);
  if(anchors.length!==1)return null;
  const anchor=anchors[0],quote=quotes.find(q=>q.extent.start<=anchor.extent.start&&q.extent.end>=anchor.extent.end);
  if(!quote||!completeBoundary(proposal,anchor)||anchor.pathConflict)return null;
  // A quotation with no explicit article must be a whole-paragraph/point
  // insertion or replacement, with the same printed label in its instruction.
  const article=units.find(u=>u.kind==='article'&&u.extent.start<=anchor.extent.start&&u.extent.end>=anchor.extent.end);
  const raw=owner.instruction.raw.replace(/\s+/gu,' ');
  if(!article){
    const lead=raw.replace(/^\([^)]*\)\s*/u,'');
    const named=/^(?:the following )?paragraphs? (.+?) (?:are|is)/u.exec(lead);
    const labels=named?.[1].split(/,\s*| and /u)??[];
    if(!labels.includes(anchor.label.value))return null;
  }
  let before=anchor.extent.end;
  while(before>anchor.extent.start&&proposal.paragraphs[before-1].text.trim()===';')before--;
  if(before>quote.extent.end||before<=anchor.extent.start)return null;
  return {itemIndex,insertBefore:before,evidence:[{basis:'whole-quoted-sibling',owner:owner.id,anchor:anchor.id,label:value}]};
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
  if(['subparagraph','introductory-part','title'].includes(target.segments.at(-1).kind))return null;
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

/** Outer addresses select proposal units; explicit inner insertions stay inside their owner. */
export function resolveProposalPlacement(items,{originalText,proposedText,targetLabel,targetPath,language,originalFormatting}={}) {
  const operation=amendmentOperation({originalText,proposedText,language}),evidence=[];
  const unresolved=reason=>({operation,status:'unresolved',reason,evidence});
  const mixedScope=amendmentMixedLanguageScope({originalText,proposedText,language});
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  const scope=amendmentLanguageScope({originalText,proposedText,language});
  if(scope)return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...scope}]};
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
  // Italian EP addresses name the printed instruction directly below an
  // unnumbered article lead ("Articolo 1 – punto 2"). The parser's implicit
  // paragraph is an internal container, not an additional published label.
  if(target.segments[0]?.kind==='article'&&target.segments[1]?.kind==='point'){
    const articles=items.flatMap(item=>item.kind==='annex'?[]:proposalCandidates(item.proposal,target.segments.slice(0,1)));
    const body=articles.length===1?articles[0].children.filter(child=>child.kind!=='title'):[];
    if(body.length===1&&body[0].kind==='paragraph'&&body[0].implicit&&!body[0].pathConflict){
      target={...target,segments:[target.segments[0],body[0].label,...target.segments.slice(1)]};
      evidence.push({basis:'implicit-paragraph',anchor:body[0].id});
    }
  }
  // A subparagraph's directly nested points share the provision's address.
  // Its next continuation supplies the boundary without adding a path label.
  let subparagraphBounds=null;
  const subparagraph=target.segments.findIndex((segment,index)=>segment.kind==='subparagraph'&&index<target.segments.length-1);
  if(subparagraph>=0){
    const label=target.segments[subparagraph],parents=items.flatMap((item,itemIndex)=>
      item.kind==='annex'&&!target.segments.some(segment=>segment.kind==='annex')?[]:
        proposalCandidates(item.proposal,target.segments.slice(0,subparagraph)).map(unit=>({unit,itemIndex,proposal:item.proposal})));
    if(!label.number||label.suffix||label.isNew)return unresolved('source_structure_unavailable');
    if(parents.length===1){
      const {unit,itemIndex,proposal}=parents[0],points=unit.children.filter(child=>child.kind==='point');
      const boundary=unit.children.find(child=>child.kind==='subparagraph')?.extent.start??unit.extent.end;
      if(label.number===1&&!unit.pathConflict&&['paragraph','point'].includes(unit.kind)&&unit.content.length
        &&/:\s*$/u.test(proposal.paragraphs[unit.content.at(-1)].text)&&points.length
        &&points.every(point=>point.extent.start<boundary&&point.extent.end<=boundary)
        &&unit.children.every(child=>child.extent.start>=boundary||child.kind==='point')){
        subparagraphBounds={itemIndex,start:unit.extent.start,end:boundary};
        target={...target,segments:target.segments.filter((_,index)=>index!==subparagraph)};
        evidence.push({basis:'first-subparagraph-points',anchor:unit.id});
      }
      // XHTML retains native, directly owned unnumbered paragraphs in source
      // order. A later colon introduction owns only the following list, up to
      // the next direct paragraph; nested Roman children stay with their point.
      if(label.number>1&&proposal.sourceKind==='xhtml'&&unit.complete&&!unit.pathConflict&&['paragraph','point'].includes(unit.kind)){
        const continuations=unit.children.filter(child=>child.kind==='subparagraph');
        const index=label.number-(unit.content.length?2:1),intro=continuations[index];
        const end=continuations[index+1]?.extent.start??unit.extent.end;
        const list=intro&&points.filter(point=>point.extent.start>=intro.extent.end&&point.extent.start<end);
        if(intro&&intro.content.length===1&&/:\s*$/u.test(proposal.paragraphs[intro.content[0]].text)&&list.length
          &&list[0].extent.start===intro.extent.end&&list.every((point,index)=>point.extent.end<=end&&(!index||list[index-1].extent.end===point.extent.start))
          &&list.at(-1).extent.end===end){
          subparagraphBounds={itemIndex,start:intro.extent.start,end};
          target={...target,segments:target.segments.filter((_,index)=>index!==subparagraph)};
          evidence.push({basis:'xhtml-subparagraph-points',anchor:unit.id});
        }
      }
    }
    if(!subparagraphBounds&&(label.number>1||operation==='insert'))return unresolved('source_structure_unavailable');
  }
  // An uncontained annex paragraph can share an act address. The item identity
  // still establishes that an address without Annex cannot select it.
  const eligible=item=>item.kind!=='annex'||target.segments.some(segment=>segment.kind==='annex');
  const candidatesFor=address=>items.flatMap((item,itemIndex)=>!eligible(item)?[]:proposalCandidates(item.proposal,address).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  const candidates=candidatesFor(target);
  const placedMatch=(selected,basis)=>{
    if(subparagraphBounds&&(selected.itemIndex!==subparagraphBounds.itemIndex||selected.match.span.start<subparagraphBounds.start||selected.match.span.end>=subparagraphBounds.end))return unresolved('conflicting_target_evidence');
    evidence.push({basis,anchor:selected.unit.id});
    return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
  };
  if(operation==='insert') {
    const quoted=candidates.length===1?(twoLinePointInsertion(candidates[0],targetPath,proposedText,language)??quotedInteriorInsertion(candidates[0],targetPath,proposedText,language)??quotedSiblingInsertion(candidates[0],proposedText,language)):null;
    if(quoted){
      if(quoted.reason)return unresolved(quoted.reason);
      evidence.push(...quoted.evidence);
      return {operation,status:'placed',itemIndex:quoted.itemIndex,insertAfter:quoted.insertBefore-1,insertBefore:quoted.insertBefore,evidence};
    }
    if(candidates.length)return unresolved('duplicate_target_label');
    const insertion=insertionPlacement(items,target,candidatesFor,eligible);
    if(insertion.reason)return unresolved(insertion.reason);
    if(subparagraphBounds&&(insertion.itemIndex!==subparagraphBounds.itemIndex||insertion.insertBefore<=subparagraphBounds.start||insertion.insertBefore>subparagraphBounds.end))return unresolved('source_structure_unavailable');
    evidence.push({basis:insertion.basis,anchor:insertion.anchor.id});
    return {operation,status:'placed',itemIndex:insertion.itemIndex,insertAfter:insertion.insertBefore-1,insertBefore:insertion.insertBefore,evidence};
  }
  if(target.segments.at(-1).kind==='introductory-part'){
    const intro=introductoryMatch(target,originalText,candidatesFor);
    return intro.reason?unresolved(intro.reason):placedMatch(intro,'introductory-wording-match');
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
  const adaptedOriginal=candidate=>{
    const {proposal,unit}=candidate;
    const notes=footnoteBody(proposal,unit,originalText,originalFormatting);
    if(notes)return notes;
    if(candidates.length!==1||unit.pathConflict||!completeBoundary(proposal,unit))return originalText;
    const text=unitText(proposal,unit).text;
    const quotes=value=>value.normalize('NFC').replace(/[‘’‚‛ʻʼ“”„‟«»"'\s]/gu,'');
    if(quotes(text)===quotes(originalText))return text;
    if(operation==='delete'&&new RegExp(`^\\(${escape(unit.label?.value??'')}\\)\\s*\\[\\.\\.\\.\\]$`,'u').test(originalText.trim())){
      const ref=targetPath?.underlying;
      const lead=proposal.paragraphs[unit.extent.start].text;
      const named=proposal.paragraphs.slice(0,unit.extent.start).filter(p=>/^(?:Regulation|Directive|Decision) .+ is amended as follows:$/u.test(p.text)).at(-1)?.text.trim();
      if(ref?.length===1&&/^Article \d+$/u.test(ref[0].raw)&&lead.endsWith(ref[0].raw+' is amended as follows:')&&named===ref[0].document.replace(/^Regulation (?=\d)/u,'Regulation (EU) ')+' is amended as follows:')return text;
    }
    return originalText;
  };
  const matches=candidates.map(candidate=>({...candidate,match:matchUnit(candidate.proposal,candidate.unit,adaptedOriginal(candidate))}));
  const matching=matches.filter(candidate=>candidate.match.span&&(candidates.length===1||candidate.match.whole||uniqueDocumentWording(candidate.proposal,originalText)));
  // A resolved address with different wording is a conflict, even when a
  // unique passage occurs elsewhere in its ancestor. Repair numbering first.
  if(matching.length!==1)return unresolved(matches.find(c=>c.match.reason==='math_comparison_unavailable')?'math_comparison_unavailable':matches.find(c=>c.match.reason==='source_structure_unavailable')?'source_structure_unavailable':'conflicting_target_evidence');
  const selected=matching[0];
  if(candidates.length===1&&selected.unit.pathConflict&&!uniqueDocumentWording(selected.proposal,originalText))return unresolved('multiple_published_targets');
  evidence.push({basis:candidates.length>1?'unique-duplicate-wording-match':'normalised-original-match',anchor:selected.unit.id});
  return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
}

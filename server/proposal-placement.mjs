import {uniqueAnnexEntryPlacement} from './proposal-unique-entry.mjs';
import {unnumberedTableInsertion} from './proposal-unnumbered-table.mjs';
import {tableContextPlacement} from './proposal-table-context.mjs';
import {rejectionWordingScope} from './amendment-rejection.mjs';
import {nativeInlineRowsComplete,nativeTitleRowsComplete} from './proposal-inline-guard.mjs';
import {quotedSectionPointInsertion} from './proposal-quoted-section.mjs';
import {wholeAnnexInstructionPlacement} from './proposal-whole-instruction.mjs';
import {similarPassage,singleWordDifference} from './proposal-similarity.mjs';
import {firstAnnexInsertion,sequentialAnnexInsertion} from './proposal-first-annex.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {parseTargetLabel,proposalCandidates,normaliseForMatching} from './proposal-structure.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {latinSuffixRank} from './legal-latin-numbering.mjs';
import {instructionOperation} from './proposal-instructions.mjs';
import {councilDraftInstructionOwns} from './council-draft-instruction.mjs';
import {councilOuterInstructionPrefix} from './council-outer-instruction.mjs';

const normal=value=>normaliseForMatching(value,{stripNumbering:false});
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const labelPattern=label=>new RegExp(`^(?:\\(${escape(label.value)}\\)\\s*|${escape(label.value)}[.)]${/^\d/u.test(label.value)?'(?:\\s+|(?=\\p{Lu}))':'\\s*'})`,'u');
const MAX_UNIT_CHARACTERS=256*1024,MAX_COLUMN_CHARACTERS=64*1024;
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
// Whole whitespace-delimited words only. Keep every other token and every
// punctuation mark; do not reinterpret identifiers or URL fragments as words.
export function singleAlphabeticWordDifference(left,right) {
  const tokens=s=>s.normalize('NFC').trim().split(/\s+/u),a=tokens(left),b=tokens(right);
  if(a.length!==b.length)return false;
  const changed=a.flatMap((token,index)=>token===b[index]?[]:[index]);if(changed.length!==1)return false;
  const word=/^([("“‘«„]*)(\p{L}+)([).,;!?…”’»"]*)$/u,x=word.exec(a[changed[0]]),y=word.exec(b[changed[0]]);
  return !!x&&!!y&&x[1]===y[1]&&x[3]===y[3]&&x[2]!==y[2];
}
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
// Detached notes do not establish the extent of an article. Require an
// ordinary native article bounded by the next complete printed article.
function articleNoteBoundary(proposal,unit,{operation,language,baseline}={}) {
  if(language!=='en'||baseline!=='commission-proposal'||operation!=='delete'||proposal.sourceKind!=='docx'||unit.scope!=='proposal'||unit.pathConflict||!completeBoundary(proposal,unit))return false;
  const rows=proposal.paragraphs.slice(unit.extent.start,unit.extent.end+1),first=rows[0],next=rows.at(-1);
  const header=p=>p?.properties?.styleId==='Titrearticle'&&/^Article \d+[a-z]*$/u.test(p.text.trim());
  if(!header(first)||!header(next)||first.text===next.text||proposal.paragraphs.filter(p=>header(p)&&p.text===first.text).length!==1)return false;
  const prefix=proposal.paragraphs.slice(0,unit.extent.start),adoption=prefix.findLastIndex(p=>/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(p.text.trim()));
  if(adoption<0||prefix.slice(adoption+1).some(p=>/^\s*['‘“«"]/u.test(p.text)||/\b(?:is|are) (?:amended|replaced|inserted)\b/u.test(p.text)))return false;
  return rows.length>1&&rows.every((p,i)=>p.complete&&p.source?.complete===true&&p.source.container==='body'&&/^\/w:document\[1\]\/w:body\[1\]\/w:p\[\d+\]$/u.test(p.source.path)&&!p.objects.length&&
    ['Titrearticle','Normal','ManualNumPar1','NumPar1'].includes(p.properties?.styleId)&&!p.properties.numberingLabel&&
    (!i||p.source.ordinal===rows[i-1].source.ordinal+1&&p.source.segment===rows[i-1].source.segment&&p.source.containerPath===rows[i-1].source.containerPath));
}
// Compare the complete original, including native notes, before matching its body.
function footnoteBody(proposal,unit,original,formatting,options) {
  const divider=/\n_{5,}\s*\n/u.exec(original);
  if(!divider)return null;
  if(unit.kind==='annex'||unit.kind==='article'&&!articleNoteBoundary(proposal,unit,options))return false;
  const body=original.slice(0,divider.index),lines=original.slice(divider.index+divider[0].length).trim().split(/\n+/u);
  const marks=(formatting??[]).filter(f=>f.kind==='superscript'&&f.end<=body.length).sort((a,b)=>a.start-b.start);
  const compact=text=>text.normalize('NFC').replace(/\s/gu,'');
  if(!marks.length||marks.length!==lines.length)return false;
  let clean='',last=0;const positions=[],labels=[];
  for(const m of marks){
    const marker=/^(?:(st|nd|rd|th))?(\d+)$/u.exec(body.slice(m.start,m.end));
    if(m.start<last||m.end<=m.start||!marker||marker[1]&&!/[0-9]$/u.test(body.slice(0,m.start)))return false;
    // Adjacent superscript runs can merge 'th' from an ordinal with its note.
    // Keep those letters in the exact body comparison; remove only note digits.
    clean+=body.slice(last,m.start+(marker[1]?.length??0));positions.push(compact(clean).length);labels.push(marker[2]);last=m.end;
  }
  clean+=body.slice(last);
  const rows=proposal.paragraphs.slice(unit.extent.start,unit.extent.end),text=rows.map(p=>p.text).join('\n');
  if(compact(text)!==compact(clean))return false;
  const anchors=(proposal.anchors??[]).filter(a=>a.paragraph>=unit.extent.start&&a.paragraph<unit.extent.end);
  if(anchors.length!==marks.length)return false;
  for(const [i,a] of anchors.entries()){
    const note=proposal.notes?.find(n=>n.id===a.note),line=/^(\d+)\s+([\s\S]+)$/u.exec(lines[i]);
    const prefix=rows.filter(p=>p.index<a.paragraph).map(p=>p.text).join('\n')+'\n'+proposal.paragraphs[a.paragraph].text.slice(0,a.offset);
    if(!note?.complete||!line||line[1]!==labels[i]||compact(line[2])!==compact(note.text)||compact(prefix).length!==positions[i])return false;
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
  // A native list proof preserves repeated printed labels. Only a globally
  // unique original inside a proved, directly owned continuation selects one.
  const proved=parents.flatMap(parent=>{
    const {unit,proposal}=parent,proof=unit.listOwnership,index=proof?.continuations[last.number-2];
    if(proposal.sourceKind!=='pdf'||proposal.language!=='cs'||!Number.isSafeInteger(index)||!uniqueDocumentWording(proposal,original))return [];
    const match=matchUnit(proposal,unit,original);
    return match.span?.start===index&&match.span.end===index?[{...parent,match}]:[];
  });
  if(proved.length===1)return proved[0];
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
  const lead=original.split(/\r?\n/u)[0];
  const addressed=unitText(selected.proposal,{...unit,extent:bounds}).text;
  const match=matchUnit(selected.proposal,{...unit,extent:bounds},normal(lead)===normal(addressed)?lead:original);
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
// Numeric additions to the final article precede its unnumbered binding formula.
function closingFormulaInsertion(items,target,candidatesFor) {
 const [article,label]=target.segments;
 if(target.language!=='en'||target.segments.length!==2||article.kind!=='article'||label.kind!=='paragraph'||!label.isNew||label.suffix||!label.number)return null;
 const parents=candidatesFor([article]);
 if(parents.length!==1)return null;
 const {proposal,unit,itemIndex}=parents[0];
 if(unit.pathConflict||!completeBoundary(proposal,unit))return null;
 const articles=flat(proposal.units).filter(u=>u.scope==='proposal'&&u.kind==='article');
 if(articles.at(-1)!==unit)return null;
 const rows=proposal.paragraphs.slice(unit.extent.start+1,unit.extent.end);
 const formulas=rows.filter(p=>p.text.trim()==='This Regulation shall be binding in its entirety and directly applicable in all Member States.');
 if(formulas.length!==1||formulas[0].index!==unit.extent.end-1)return null;
 const paragraphs=unit.children.filter(u=>u.kind==='paragraph');
 if(!paragraphs.length||paragraphs.some((u,i)=>u.label?.number!==i+1||u.label.suffix)||label.number<=paragraphs.length)return null;
 const formula=formulas[0];
 if(rows.some(p=>p.source?.container!=='body')||!rows.some(p=>/^This Regulation shall enter into force\b/u.test(p.text.trim())||/^1[.)]\s/u.test(p.text)))return null;
 return {itemIndex,insertBefore:formula.index,anchor:unit,basis:'before-closing-formula'};
}
// Published amendment point numbers can differ from the Commission text.
// Resolve only a complete, unique single-row wording match in implicit paragraph 1.
function wordingNumberingMatch(target,original,candidatesFor) {
 const [article,paragraph,point]=target.segments;
 const prefix=/^\(([a-z])\)\s+([^\n]+)$/u.exec(original);
 if(target.language!=='en'||target.underlyingLabel||target.segments.length!==3||article.kind!=='article'||paragraph.kind!=='paragraph'||paragraph.value!=='1'||point.kind!=='point'||point.isNew||!prefix||prefix[1]!==point.value)return null;
 const parents=candidatesFor(target.segments.slice(0,2));
 if(parents.length!==1)return null;
 const selected=parents[0],{proposal,unit}=selected;
 if(!unit.implicit||unit.pathConflict||!completeBoundary(proposal,unit))return null;
 const key=s=>normal(s.replace(/^\([a-z]\)\s+/u,''));
 const wanted=key(original);
 if(wanted.length<30)return null;
 const rows=proposal.paragraphs.slice(unit.extent.start,unit.extent.end);
 if(rows.some(r=>r.source?.container!=='body'))return null;
 const hits=rows.filter(r=>key(r.text)===wanted);
 if(hits.length!==1)return null;
 const row=hits[0];
 return {...selected,match:{span:{start:row.index,end:row.index},splice:{start:{paragraph:row.index,offset:0},end:{paragraph:row.index,offset:row.text.length}},originalText:row.text}};
}

// A suffixed outer annex follows its base. Native headings establish an
// interior boundary even when objects in the preceding annex are unreadable.
function numberedAnnexInsertion(items,target,language,nativeProposalInputs) {
 const label=target.segments[0];
 if(language!=='en'||target.segments.length!==1||label.kind!=='annex'||!label.isNew||label.suffix!=='a'||!/^([IVXLCDM]+)$/u.test(label.base||''))return null;
 const annexes=items.flatMap((item,itemIndex)=>item.kind!=='annex'?[]:flat(item.proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind==='annex'&&unit.path.length===1).map(unit=>({itemIndex,unit,proposal:item.proposal})));
 const bases=annexes.filter(({unit})=>unit.label.value===label.base);
 if(bases.length!==1||annexes.some(({unit})=>unit.label.value.startsWith(label.base)&&/^[a-z]$/u.test(unit.label.value.slice(label.base.length))))return null;
 const base=bases[0],peers=annexes.filter(a=>a.itemIndex===base.itemIndex).sort((a,b)=>a.unit.extent.start-b.unit.extent.start),next=peers[peers.indexOf(base)+1];
 if(next&&base.unit.extent.end!==next.unit.extent.start||base.unit.pathConflict||new Set(peers.map(a=>a.unit.label.value)).size!==peers.length)return null;
 if(!next&&(!completeBoundary(base.proposal,base.unit)||base.unit.extent.end!==base.proposal.paragraphs.length||base.proposal.gaps.some(gap=>!Number.isInteger(gap.paragraph)||gap.paragraph>=base.unit.extent.start)))return null;
 const rows=[base.proposal.paragraphs[base.unit.extent.start],...(next?[base.proposal.paragraphs[next.unit.extent.start]]:[])];
 if(rows.some(row=>row.properties?.styleId!=='Annexetitre'||!row.complete||row.source?.complete!==true)||!nativeInlineRowsComplete(nativeProposalInputs?.[base.itemIndex],base.proposal.sourceHash,rows,{annexHeadings:peers.map(peer=>base.proposal.paragraphs[peer.unit.extent.start])}))return null;
 if(!next&&!nativeInlineRowsComplete(nativeProposalInputs?.[base.itemIndex],base.proposal.sourceHash,[base.proposal.paragraphs.at(-1)],{wholeBodyAfter:true,onlyBlankAfter:true}))return null;
 return {...base,insertBefore:next?.unit.extent.start??base.unit.extent.end,anchor:base.unit,basis:next?'numbered-annex-before-next-heading':'numbered-annex-at-end'};
}

// Amendments call a proposal's sole bare ANNEX 'Annex I'. Keep that alias
// local to a new sibling insertion; it never renumbers the published source.
function bareAnnexInsertion(items,target,language) {
  const label=target.segments[0];
  if(language!=='en'||target.segments.length!==1||label.kind!=='annex'||!label.isNew||label.base!=='I'||!label.suffix||!/^[a-z]{1,3}$/u.test(label.suffix))return null;
  const annexes=items.flatMap((item,itemIndex)=>flat(item.proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind==='annex').map(unit=>({itemIndex,unit,proposal:item.proposal})));
  if(annexes.length!==1||annexes[0].unit.label?.value!=='')return null;
  const {itemIndex,unit,proposal}=annexes[0],rows=proposal.paragraphs.slice(unit.extent.start);
  const headings=items.flatMap(item=>item.proposal.paragraphs.filter(row=>/^Annexetitre$/iu.test(row.properties?.styleId||'')));
  if(headings.length!==1||headings[0].text.split(/\r?\n/u)[0].trim()!=='ANNEX')return null;
  if(proposal.sourceKind!=='docx'||unit.extent.end!==proposal.paragraphs.length||!completeBoundary(proposal,unit)
    ||proposal.gaps.some(gap=>!Number.isInteger(gap.paragraph)||gap.paragraph>=unit.extent.start)
    ||!rows.every((row,i)=>row.complete&&row.source?.complete===true&&row.source.container==='body'&&(!i||row.source.containerPath===rows[i-1].source.containerPath&&(row.source.segment===rows[i-1].source.segment&&row.source.ordinal===rows[i-1].source.ordinal+1||row.source.previousParagraph===rows[i-1].source.path&&row.source.ordinal>rows[i-1].source.ordinal&&row.source.segment-rows[i-1].source.segment===row.source.ordinal-rows[i-1].source.ordinal-1))))return {reason:'source_passage_incomplete'};
  return {itemIndex,insertBefore:unit.extent.end,anchor:unit,basis:'sole-bare-annex-end'};
}

// An interior indent can name Annex I when the proposal has one bare Annex.
// This is separate from appending a new annex and never supplies an EOF gap.
function bareAnnexPoint(items,pointNumber,nativeProposalInputs) {
  if(items.length!==2||items.filter(i=>i.kind==='act').length!==1||items.filter(i=>i.kind==='annex').length!==1)return null;
  const itemIndex=items.findIndex(i=>i.kind==='annex'),proposal=items[itemIndex].proposal,act=items.find(i=>i.kind==='act').proposal;
  if(proposal.sourceKind!=='docx'||act.sourceKind!=='docx'||!act.paragraphs.some(p=>p.complete&&p.source?.complete===true&&/\bthe Annex\b/u.test(p.text))||act.paragraphs.some(p=>/\bAnnex\s+(?:[IVXLCDM]+|\d+)\b/u.test(p.text)))return null;
  const roots=items.flatMap(i=>flat(i.proposal.units).filter(u=>u.kind==='annex'&&u.scope==='proposal'&&u.normative)),root=roots[0];
  if(roots.length!==1||!flat(proposal.units).includes(root)||root.label.value!==''||root.pathConflict||!completeBoundary(proposal,root)||proposal.paragraphs[root.extent.start].text.trim()!=='ANNEX'||proposal.paragraphs[root.extent.start].properties?.styleId!=='Annexetitre'||proposal.gaps.some(g=>!Number.isInteger(g.paragraph)||g.paragraph>=root.extent.start))return null;
  const parents=root.children.filter(u=>u.kind==='paragraph');if(parents.length!==1||!parents[0].implicit||parents[0].pathConflict)return null;
  const points=parents[0].children.filter(u=>u.kind==='point');
  if(!points.length||points.some((u,i)=>u.label.value!==String(i+1)||u.pathConflict||!completeBoundary(proposal,u)||proposal.paragraphs[u.extent.start].properties?.styleId!=='Point0number'||proposal.paragraphs[u.extent.start].properties.numberingLabel!==`(${i+1})`||proposal.paragraphs[u.extent.start].properties.numbering?.format!=='decimal'||proposal.paragraphs[u.extent.start].properties.numbering?.level!==0))return null;
  const point=points[pointNumber-1],indents=point?.children;
  if(!point||!indents.length||indents.some((u,i)=>u.kind!=='indent'||u.label.value!==String(i+1)||u.pathConflict||!u.complete||u.extent.end!==u.extent.start+1||u.children.length))return null;
  const rows=proposal.paragraphs.slice(point.extent.start,point.extent.end),bullets=rows.slice(1);
  if(rows.length!==indents.length+1||rows.some((p,i)=>!p.complete||p.source?.complete!==true||p.source.container!=='body'||p.objects.length||(proposal.anchors||[]).some(a=>a.paragraph===p.index)||i&&(p.source.ordinal!==rows[i-1].source.ordinal+1||p.source.segment!==rows[i-1].source.segment||p.source.containerPath!==rows[i-1].source.containerPath))||bullets.some(p=>p.properties?.styleId!=='Bullet0'||p.properties.numberingLabel!=='•'||p.properties.numbering?.format!=='bullet'||p.properties.numbering.level!==0||!/^•\t\S/u.test(p.text)||p.properties.numbering.abstractId!==bullets[0].properties.numbering.abstractId))return null;
  if(!nativeInlineRowsComplete(nativeProposalInputs?.[itemIndex],proposal.sourceHash,proposal.paragraphs.slice(root.extent.start,root.extent.end),{wholeBodyAfter:true})||!act.paragraphs.some(p=>p.complete&&p.source?.complete===true&&/\bthe Annex\b/u.test(p.text)&&nativeInlineRowsComplete(nativeProposalInputs?.[items.findIndex(i=>i.kind==='act')],act.sourceHash,[p])))return null;
  return {itemIndex,proposal,root,point,indents,rows};
}
function bareAnnexIndentInsertion(items,target,{language,baseline,originalText,proposedText,nativeProposalInputs}) {
  const [rootLabel,pointLabel,indentLabel]=target.segments;
  if(language!=='en'||baseline!=='commission-proposal'||originalText!==''||target.segments.length!==3||rootLabel.kind!=='annex'||rootLabel.value!=='I'||pointLabel.kind!=='point'||!pointLabel.number||pointLabel.suffix||pointLabel.isNew||indentLabel.kind!=='indent'||!indentLabel.number||indentLabel.suffix!=='a'||!indentLabel.isNew||!/^[-–—•]\s+\S/u.test(proposedText||''))return null;
  const proof=bareAnnexPoint(items,pointLabel.number,nativeProposalInputs);if(!proof||proof.indents.length<=indentLabel.number)return null;
  const {itemIndex,root,point,indents}=proof,before=indents[indentLabel.number].extent.start;
  return {operation:'insert',status:'placed',itemIndex,insertBefore:before,insertAfter:before-1,evidence:[{basis:'sole-bare-annex-first-ordinal',anchor:root.id},{basis:'native-interior-indent-order',anchor:point.id}]};
}
function bareAnnexReplacement(items,target,{language,baseline,originalText,proposedText,targetLabel,targetPath,nativeProposalInputs}) {
  const [rootLabel,pointLabel,last]=target.segments,literal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
  if((targetPath?.language??language)!==language)return null;
  if(language!=='en'||baseline!=='commission-proposal'||target.segments.length!==3||rootLabel.kind!=='annex'||rootLabel.value!=='I'||rootLabel.isNew||pointLabel.kind!=='point'||!pointLabel.number||pointLabel.suffix||pointLabel.isNew||!['introductory-part','indent'].includes(last.kind)||last.isNew||last.suffix||targetPath?.underlying?.length||literal(target.raw)!==literal(targetLabel)||!/^Annex I – point [1-9]\d* – (?:introductory part|indent [1-9]\d*)$/u.test(targetLabel))return null;
  const proof=bareAnnexPoint(items,pointLabel.number,nativeProposalInputs);if(!proof)return null;
  const {itemIndex,root,point,indents,rows}=proof;
  let row;
  if(last.kind==='introductory-part'){
    row=rows[0];const prefix=new RegExp('^\\('+pointLabel.number+'\\)\\s+','u');
    if(!prefix.test(originalText)||!prefix.test(proposedText)||!/:\s*$/u.test(row.text)||!/:\s*$/u.test(proposedText)||literal(row.text)!==literal(originalText))return null;
  }else{
    if(!last.number||last.number>indents.length)return null;row=rows[last.number];
    const bullet=/^[-–—•]\s+\S/u,body=value=>literal(value.replace(/^[-–—•]\s+/u,''));
    if(!bullet.test(originalText)||!bullet.test(proposedText)||body(row.text)!==body(originalText))return null;
  }
  return {operation:'replace',status:'placed',itemIndex,span:{start:row.index,end:row.index},splice:{start:{paragraph:row.index,offset:0},end:{paragraph:row.index,offset:row.text.length}},originalText:row.text,evidence:[{basis:'sole-bare-annex-first-ordinal',anchor:root.id},{basis:'native-annex-replacement-row',anchor:point.id}]};
}

function insertionPlacement(items,target,candidatesFor,eligible,proposedText,{scope='proposal',unitsFor=item=>flat(item.proposal.units),quoted=null,outerPrefix=null,listOwnership=null}={}) {
  const listMember=unit=>listOwnership?.points.includes(unit),conflict=unit=>unit.pathConflict&&unit!==listOwnership?.parent&&!listMember(unit);
  const boundary=(proposal,unit)=>completeBoundary(proposal,unit)||listMember(unit)&&!unit.children.length&&unit.extent.end===unit.extent.start+1&&proposal.paragraphs[unit.extent.start]?.complete&&proposal.paragraphs[unit.extent.start]?.source?.complete===true;
  const closing=closingFormulaInsertion(items,target,candidatesFor);
  if(closing)return closing;
  const label=target.segments.at(-1),preceding=target.segments.slice(0,-1);
  // A two-letter suffix (Article 4ba) follows its first letter in drafting
  // order. Without suffixed siblings of the same base, it follows the base.
  const twoLetter=suffixRank(label.suffix,label.suffix)<0&&!label.negative&&/^[a-z]{2}$/u.test(label.suffix);
  const rank=twoLetter?suffixes.length:suffixRank(label.suffix,label.suffix);
  if(!label.isNew||rank<0||(!label.suffix&&label.kind!=='point'))return {reason:'insertion_reference_unavailable'};
  const parents=preceding.length?candidatesFor(preceding):null;
  if(parents&&parents.length!==1)return {reason:'parent_target_not_found'};
  const parent=parents?.[0];
  if(parent&&conflict(parent.unit))return {reason:'multiple_published_targets'};
  // Subparagraphs are anonymous continuations. Count the numbered lead
  // (including its points) once, then each directly owned continuation.
  if(label.kind==='subparagraph'&&label.suffix==='a'&&parent?.unit.kind==='paragraph'&&!parent.unit.implicit&&!parent.unit.instruction) {
    const {unit,proposal,itemIndex}=parent;
    // The raw oracle recognises explicit NumPar rows. Word Point styles can
    // denote paragraphs in the placer but do not establish that raw grammar.
    const lead=proposal.paragraphs[unit.extent.start];
    if(target.language!=='en'||!/^(?:Manual)?NumPar1$/iu.test(lead?.properties?.styleId??'')||!/^\s*\d+[a-z]*[.)]\s/u.test(lead.text))return {reason:'source_structure_unavailable'};
    if(!completeBoundary(proposal,unit)||unit.children.some(child=>!['point','subparagraph'].includes(child.kind)))return {reason:'source_passage_incomplete'};
    const continuations=unit.children.filter(child=>child.kind==='subparagraph');
    const parts=[...(unit.content.length?[{start:unit.content[0],end:continuations[0]?.extent.start??unit.extent.end}]:[]),...continuations.map(child=>child.extent)];
    const anchor=parts[label.number-1];
    if(!anchor)return {reason:'relative_target_not_found'};
    const rows=proposal.paragraphs.slice(anchor.start,anchor.end+1);
    if(rows.length<2||rows.at(-1).index!==anchor.end||rows.some((row,index)=>!row.complete||row.source?.container!=='body'||!Number.isSafeInteger(row.source.ordinal)||index&&(row.source.containerPath!==rows[index-1].source.containerPath||row.source.segment!==rows[index-1].source.segment||row.source.ordinal!==rows[index-1].source.ordinal+1)))return {reason:'source_passage_incomplete'};
    return {itemIndex,insertBefore:anchor.end,anchor:unit,basis:'ordinal-subparagraph-gap'};
  }
  const siblings=[];
  for(const [itemIndex,item] of items.entries())for(const unit of eligible(item)?unitsFor(item):[]){
    if(unit.scope!==scope||unit.kind!==label.kind||!unit.label)continue;
    if(parent&&(itemIndex!==parent.itemIndex||parentKey(unit)!==JSON.stringify(parent.unit.path.map(({kind,value,occurrence})=>[kind,value,occurrence??null]))))continue;
    siblings.push({itemIndex,unit});
  }
  if(twoLetter&&siblings.some(({unit})=>labelBase(unit.label)===labelBase(label)&&unit.label.suffix))return {reason:'insertion_reference_unavailable'};
  // New Roman points can start a list under an existing childless point. The
  // parent's end is their only source position, whichever amendment tables
  // the preceding new points (A-10-2026-0257 AM114-116 add i, ii and iii).
  if(!siblings.length&&!label.suffix&&!label.negative&&(label.value==='i'||/^[ivx]+$/u.test(label.value)&&romanNumber(label.value)<=30&&/^[a-z]$/u.test(parent?.unit.label?.value??''))&&parent?.unit.kind==='point'&&!parent.unit.children.length){
    if(!completeBoundary(parent.proposal,parent.unit))return {reason:'source_passage_incomplete'};
    // Repeated Word styles can flatten a nested (i) beside (a) and (b): only an
    // unbroken a, b, c... peer sequence establishes that the parent is childless.
    const peers=flat(parent.proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind==='point'&&parentKey(unit)===parentKey(parent.unit)).sort((a,b)=>a.extent.start-b.extent.start);
    // A following peer (i) may itself be a flattened first Roman child (after (h)).
    if(!peers.every((unit,index)=>unit.label?.value===String.fromCharCode(97+index))||peers[peers.indexOf(parent.unit)+1]?.label?.value==='i')return {reason:'source_structure_unavailable'};
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
  if(anchors.length!==1||conflict(anchors[0].unit))return {reason:'multiple_published_targets'};
  const anchor=anchors[0],proposal=items[anchor.itemIndex].proposal;
  const ordered=siblings.filter(s=>s.itemIndex===anchor.itemIndex&&parentKey(s.unit)===parentKey(anchor.unit)).map(s=>s.unit).sort((a,b)=>a.extent.start-b.extent.start);
  const positive=label.negative?{...label,value:label.value.slice(1),number:label.number}:label;
  const order=siblingOrder(ordered,positive);
  const orderComplete=order&&ordered.every((unit,i)=>{
    const previous=ordered[i-1],current=order(unit.label),before=previous&&order(previous.label);
    return !conflict(unit)&&current.rank>=0&&(!previous||previous.extent.end<=unit.extent.start&&(before.number<current.number||before.number===current.number&&before.rank<current.rank));
  });
  if(!orderComplete){
    // Unrelated recast damage later in the preamble does not erase a unique,
    // complete pair of physically adjacent, consecutively numbered recitals.
    const next=ordered[ordered.indexOf(anchor.unit)+1],unit=anchor.unit;
    const own=ordered.filter(peer=>peer.label.number===label.number);
    if(target.language==='en'&&label.kind==='recital'&&!preceding.length&&/^[a-z]$/u.test(label.suffix)&&!label.negative&&own.length===1
      &&new RegExp('^\\('+label.number+label.suffix+'\\)\\s+','u').test(proposedText??'')
      &&proposal.sourceKind==='docx'&&!unit.label.suffix&&next?.kind==='recital'&&!next.label.suffix&&next.label.number===label.number+1
      &&!unit.pathConflict&&!next.pathConflict&&completeBoundary(proposal,unit)&&completeBoundary(proposal,next)
      &&unit.content.length===1&&!unit.children.length&&next.content.length===1&&!next.children.length&&unit.extent.end===next.extent.start){
      const left=proposal.paragraphs[unit.content[0]],right=proposal.paragraphs[next.content[0]];
      if(left?.complete&&right?.complete&&left.source?.container==='body'&&right.source?.container==='body'&&left.source.containerPath===right.source.containerPath
        &&left.source.segment===right.source.segment&&right.source.ordinal===left.source.ordinal+1)
        return {itemIndex:anchor.itemIndex,insertBefore:unit.extent.end,anchor:unit,basis:'native-adjacent-recital-boundary'};
    }
    return {reason:'source_structure_unavailable'};
  }
  const next=ordered[ordered.indexOf(anchor.unit)+1];
  if(quoted&&(!boundary(proposal,anchor.unit)||conflict(anchor.unit)))return {reason:'source_passage_incomplete'};
  // A new paragraph after a quotation's final closing delimiter would fall
  // outside the replacement. This renderer needs a proved interior boundary.
  if(quoted&&!next&&(!parent||anchor.unit.extent.end>=parent.unit.extent.end)){
    if(anchor.unit.extent.end<quoted.extent.end){
      const following=proposal.paragraphs[anchor.unit.extent.end];
      if(following?.complete&&following.properties?.headingBasis==='native-first-line'&&following.properties.styleId==='Titrearticle')return {itemIndex:anchor.itemIndex,insertBefore:anchor.unit.extent.end,anchor:anchor.unit,basis:'quoted-article-end'};
    }
    const index=anchor.unit.extent.end-1,row=proposal.paragraphs[index],opening=proposal.paragraphs[quoted.extent.start]?.text.trim()[0],closing={'„':'“','‘':'’','“':'”','«':'»','»':'«','"':'"'}[opening];
    const tail=closing&&new RegExp(escape(closing)+'[;.]?\\s*$','u').exec(row?.text??'');
    if(anchor.unit.extent.end!==quoted.extent.end||!tail)return {reason:'quoted_terminal_boundary_unverified'};
    return {itemIndex:anchor.itemIndex,insertBefore:index+1,anchor:anchor.unit,basis:'quoted-terminal-splice',splice:{start:{paragraph:index,offset:tail.index},end:{paragraph:index,offset:tail.index}}};
  }
  if(!boundary(proposal,anchor.unit)&&!(label.suffix&&!label.negative&&quotedConflictBoundary(proposal,anchor.unit,next)))return {reason:'source_passage_incomplete'};
  if(label.negative){
    const prefixProved=outerPrefix?.itemIndex===parent.itemIndex&&outerPrefix.parent===parent.unit&&outerPrefix.first===anchor.unit;
    if((!completeBoundary(proposal,parent.unit)&&!prefixProved)||parent.unit.extent.start>=anchor.unit.extent.start)return {reason:'source_passage_incomplete'};
    return {itemIndex:anchor.itemIndex,insertBefore:anchor.unit.extent.start,anchor:anchor.unit,basis:'first-sibling-start'};
  }
  const insertBefore=anchor.unit.extent.end;
  if(insertBefore<=anchor.unit.extent.start)return {reason:'source_passage_incomplete'};
  return {itemIndex:anchor.itemIndex,insertBefore,anchor:anchor.unit,basis:'preceding-sibling-subtree'};
}

// Bind an inner address to one native quotation under the exact outer point.
// Only candidate selection changes; matching and insertion use the existing
// resolver below. No source or amendment identifier participates in this rule.
function councilQuotedTarget(items,target,targetPath,language,targetLabel) {
 const refs=targetPath?.underlying;
 if(refs?.length!==1||targetPath?.language!==language||target.segments.length!==3||target.segments[0].kind!=='article'||target.segments[1].kind!=='paragraph'||target.segments[1].value!=='1'||target.segments[2].kind!=='point')return {reason:'council_pdf_address_unverified'};
 if(targetLabel!==undefined&&String(targetLabel).split('\n')[0].replace(/\s+/gu,' ').trim()!==target.raw.replace(/\s+/gu,' ').trim())return {reason:'conflicting_target_evidence'};
 const candidates=items.flatMap((item,itemIndex)=>item.proposal?.sourceKind==='pdf'?proposalCandidates(item.proposal,target).map(unit=>({unit,proposal:item.proposal,itemIndex})):[]);
 if(candidates.length!==1)return {reason:'council_pdf_outer_owner_unverified'};
 const {unit:owner,proposal,itemIndex}=candidates[0],all=flat(proposal.units);
 const parent=all.find(u=>u.children.includes(owner)),lead=parent?.instruction?.raw.replace(/\s+/gu,' ').trim();
 const actPattern={en:/^(.+) is amended as follows:$/u,cs:/^(.+) se mění takto:$/u,es:/^La (.+) se modifica como sigue:$/u,da:/^I (.+) foretages følgende ændringer:$/u}[language];
 const named=actPattern?.exec(lead??'')?.[1],document=refs[0].document?.replace(/\s+/gu,' ').trim();
 if(!named||named.toLocaleLowerCase(language)!==document?.toLocaleLowerCase(language)||owner.scope!=='proposal'||!owner.instruction||!proposal.paragraphs[owner.extent.start]?.complete||!proposal.paragraphs[parent.extent.start]?.complete)return {reason:'council_pdf_outer_owner_unverified'};
 const quotes=owner.children.filter(u=>u.kind==='quotation'&&sameAddress(u.instructionPath,owner.path));
 if(quotes.length!==1||quotes[0].boundaryAmbiguous||proposal.gaps.some(g=>g.code==='unclosed-quotation'&&g.paragraph===quotes[0].extent.start))return {reason:'council_pdf_quotation_unverified'};
 const inner=parseTargetLabel(refs[0].raw,language);
 if(!inner.complete||inner.segments[0]?.kind!=='article'||inner.segments.length<2)return {reason:'council_pdf_address_unverified'};
 if(inner.segments.some((segment,index)=>segment.kind==='subparagraph'&&inner.segments[index-1]?.kind==='point'))return {reason:'council_pdf_subparagraph_owner_unverified'};
 if(!councilDraftInstructionOwns(owner.instruction.raw,inner,proposal.paragraphs[quotes[0].extent.start]?.text,language))return {reason:'council_pdf_outer_instruction_unverified'};
 return {target:inner,quote:quotes[0],owner,proposal,itemIndex,units:flat(quotes)};
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
function finnishQuotedSiblingInsertion(selected,targetPath,proposedText,language) {
 if(language!=='fi'||targetPath?.underlying?.length!==1)return null;
 const ref=targetPath.underlying[0];if(ref.document&&ref.document!==ref.raw)return null;const inner=parseTargetLabel(ref.raw,language),label=inner.segments.at(-1),printed=/^(\d+)\s*a[.]\s/u.exec(proposedText??'');
 if(!inner.complete||inner.segments.length!==2||inner.segments[0].kind!=='article'||label?.kind!=='paragraph'||label.suffix!=='a'||!printed||Number(printed[1])!==label.number)return null;
 const {proposal,unit:owner,itemIndex}=selected,normal=value=>value.replace(/\s+/gu,' ').trim();
 if(owner.scope!=='proposal'||owner.kind!=='point'||!/^\([a-z]\) korvataan \d+ kohta seuraavasti:$/u.test(normal(owner.instruction?.raw??''))||!completeBoundary(proposal,owner))return null;
 if(normal(owner.instruction.raw)!=='('+owner.label.value+') korvataan '+label.number+' kohta seuraavasti:')return null;
 let chain=[];const find=(units,parents=[])=>{for(const unit of units){if(unit===owner){chain=[...parents,unit];return true;}if(find(unit.children,[...parents,unit]))return true;}return false;};find(proposal.units);
 const named=chain.filter(unit=>/^\(\d+\) Muutetaan \d+ artikla seuraavasti:$/u.test(normal(unit.instruction?.raw??''))).at(-1);
 if(!named||!new RegExp('^\\(\\d+\\) Muutetaan '+escape(inner.segments[0].value)+' artikla seuraavasti:$','u').test(normal(named.instruction.raw)))return null;
 const quotes=owner.children.filter(unit=>unit.kind==='quotation');if(quotes.length!==1)return null;
 const quote=quotes[0],paragraphs=quote.children.filter(unit=>unit.kind==='paragraph'),parent=paragraphs[0];
 if(paragraphs.length!==1||parent.children.length||parent.label?.value!==String(label.number)||!sameAddress(parent.underlyingPath,[inner.segments[0],{kind:'paragraph',value:String(label.number)}])||!completeBoundary(proposal,quote)||parent.extent.start!==quote.extent.start||parent.extent.end!==quote.extent.end||quote.extent.end!==owner.extent.end||parent.extent.end!==parent.extent.start+1)return null;
 const row=proposal.paragraphs[parent.extent.start],next=proposal.paragraphs[parent.extent.end],nextLetter=String.fromCharCode(owner.label.value.charCodeAt(0)+1);
 if(!row.complete||!next?.complete||row.source?.complete!==true||next.source?.complete!==true||row.source.container!=='body'||next.source.container!=='body'||row.objects.length||(proposal.anchors??[]).some(a=>a.paragraph===row.index)||row.source.containerPath!==next.source.containerPath||row.source.segment!==next.source.segment||row.source.ordinal+1!==next.source.ordinal||!new RegExp('^”'+label.number+'[.]\\s[\\s\\S]+”$','u').test(row.text.trim())||!next.text.startsWith('('+nextLetter+')'))return null;
 return {itemIndex,insertBefore:parent.extent.end,evidence:[{basis:'finnish-printed-quoted-sibling',owner:owner.id,anchor:parent.id,label:label.value}]};
}
function quotedSiblingInsertion(selected,targetPath,proposedText,language) {
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
  const reference=targetPath?.underlying;
  if(reference?.length){
    if(reference.length!==1)return null;
    const inner=parseTargetLabel(reference[0].raw.split(/[–-]/u,1)[0].trim(),language),root=inner.segments[0];
    const actual=anchor.underlyingPath?.find(segment=>segment.kind==='article');
    if(!inner.complete||root?.kind!=='article'||root.isNew||!actual||root.value!==actual.value)return null;
  }

  // A quotation with no explicit article must be a whole-paragraph/point
  // insertion or replacement, with the same printed label in its instruction.
  const article=units.find(u=>u.kind==='article'&&u.extent.start<=anchor.extent.start&&u.extent.end>=anchor.extent.end);
  const raw=owner.instruction.raw.replace(/\s+/gu,' ');
  if(!article){
    const lead=raw.replace(/^\([^)]*\)\s*/u,'').replace(/^in Article \d+[a-z]*, /u,'');
    const named=/^(?:the following )?paragraphs? (.+?) (?:are|is)/u.exec(lead);
    const labels=named?.[1].split(/,\s*| and /u)??[];
    if(!labels.includes(anchor.label.value))return null;
  }
  let before=anchor.extent.end;
  while(before>anchor.extent.start&&proposal.paragraphs[before-1].text.trim()===';')before--;
  // The quoted provision's own asterisk note (a rule, then '*' rows) stays
  // after it: the new sibling follows the provision text (A-10-2026-0276).
  const rows=proposal.paragraphs.slice(anchor.extent.start,before),rule=rows.findIndex((p,at)=>at&&/^_{3,}$/u.test(p.text.trim()));
  if(rule>0&&rows.length>rule+1&&rows.slice(rule+1).every(p=>/^\*/u.test(p.text.trim())))before=anchor.extent.start+rule;
  if(before>quote.extent.end||before<=anchor.extent.start)return null;
  return {itemIndex,insertBefore:before,evidence:[{basis:'whole-quoted-sibling',owner:owner.id,anchor:anchor.id,label:value}]};
}

// An instruction replacing "the second subparagraph" of Article 30(6) quotes
// that whole subparagraph. Its published inner address (point b – point iii a,
// point (b)(va), point (ba), third subparagraph) is read from the quoted rows'
// printed labels: the parser flattens nested Roman points (A-10-2026-0201).
function printedInnerPath(targetLabel,targetPath,language) {
  if(targetPath?.underlying?.length)return targetPath;
  const lines=String(targetLabel??'').split('\n');
  if(lines.length!==3||language!=='en'||!/^(?:Regulation|Directive|Decision) \(EU\) \d{4}\/\d+$/u.test(lines[1]))return targetPath;
  return {...targetPath,language,underlying:[{document:lines[1],raw:lines[2]}]};
}
const SUBPARAGRAPH_ORDINALS=['first','second','third','fourth','fifth','sixth'];
function quotedOrdinalSubparagraphInsertion(selected,targetPath,proposedText,language) {
 const refs=targetPath?.underlying??[];if(language!=='en'||targetPath?.language!==language||refs.length!==1||!refs[0].document)return null;
 const inner=parseTargetLabel(refs[0].raw,language),label=inner.segments.at(-1);
 if(!inner.complete||inner.segments.length!==3||inner.segments[0].kind!=='article'||inner.segments[1].kind!=='paragraph'||label?.kind!=='subparagraph'||!label.isNew||!label.suffix||label.negative||!proposedText?.trim()||/^\d+[a-z]*[.)]\s/u.test(proposedText.trim())||instructionOperation(proposedText,language))return null;
 const {proposal,unit:owner,itemIndex}=selected;if(owner.scope!=='proposal'||!owner.instruction||!completeBoundary(proposal,owner))return null;
 const named=new RegExp('^\\(\\d+\\)\\s+in Article '+escape(inner.segments[0].value)+', the following paragraphs (.+) are inserted after paragraph \\d+:$','u').exec(owner.instruction.raw.trim());
 if(!named||!named[1].split(/,\s*| and /u).includes(inner.segments[1].value))return null;
 const intro=proposal.paragraphs.filter(row=>row.index<owner.extent.start&&/^(?:Directive|Regulation|Decision) .+ is amended as follows:$/u.test(row.text.trim())).at(-1);if(!intro||intro.text.trim()!==refs[0].document+' is amended as follows:')return null;
 const quotes=owner.children.filter(unit=>unit.kind==='quotation'),parents=flat(quotes).filter(unit=>unit.kind==='paragraph'&&unit.scope==='quoted'&&sameAddress(unit.underlyingPath,inner.segments.slice(0,-1)));
 if(parents.length!==1)return null;const parent=parents[0];
 if(parent.pathConflict||!completeBoundary(proposal,parent)||parent.content.length!==1||parent.children.some(child=>child.kind!=='subparagraph'||child.children.length||child.content.length!==1))return null;
 const parts=[{start:parent.content[0],end:parent.content[0]+1},...parent.children.map(child=>child.extent)].sort((a,b)=>a.start-b.start),part=parts[label.number-1];
 if(!part||parts.some((p,i)=>p.end!==p.start+1||i&&parts[i-1].end!==p.start))return null;
 const rows=proposal.paragraphs.slice(parent.extent.start,part.end+1);
 if(rows.some((row,i)=>!row.complete||row.source?.complete!==true||row.source.container!=='body'||row.objects.length||(proposal.anchors??[]).some(a=>a.paragraph===row.index)||i&&(row.source.containerPath!==rows[i-1].source.containerPath||row.source.segment!==rows[i-1].source.segment||row.source.ordinal!==rows[i-1].source.ordinal+1)))return null;
 return {itemIndex,insertBefore:part.end,evidence:[{basis:'quoted-ordinal-subparagraph',owner:owner.id,anchor:parent.id,label:label.value}]};
}
function quotedSubparagraphInsertion(selected,targetPath,proposedText,language) {
  const {unit:owner,proposal,itemIndex}=selected;
  const reference=targetPath?.underlying;
  if(language!=='en'||targetPath?.language!==language||proposal.language!==language||reference?.length!==1||!reference[0].raw)return null;
  // The parser's nested-list ambiguity is what the printed labels resolve here;
  // every row must still be complete, with no other source gap in the owner.
  const ownerRows=proposal.paragraphs.slice(owner.extent.start,owner.extent.end);
  if(owner.scope!=='proposal'||owner.kind!=='point'||!owner.instruction||owner.pathConflict||ownerRows.some(p=>!p.complete||!p.source||p.source.complete===false)
    ||proposal.gaps.some(gap=>gap.paragraph>=owner.extent.start&&gap.paragraph<owner.extent.end&&!['ambiguous-point-level','duplicate-label'].includes(gap.code)))return null;
  const instruction=/^\(\d+\)\s*in Article (\d+[a-z]*)\((\d+)\), the ([a-z]+) subparagraph is replaced by the following:$/u.exec(owner.instruction.raw.replace(/\s+/gu,' ').trim());
  if(!instruction)return null;
  const [article,paragraph,subparagraph,...points]=reference[0].raw.split(/\s+[–-]\s+/u);
  const sub=/^(?:subparagraph (\d+)|([a-z]+) subparagraph)(\s*\(new\))?$/u.exec(subparagraph??'');
  if(article!=='Article '+instruction[1]||paragraph!=='paragraph '+instruction[2]||!sub)return null;
  const replaced=SUBPARAGRAPH_ORDINALS.indexOf(instruction[3])+1,number=sub[1]?Number(sub[1]):SUBPARAGRAPH_ORDINALS.indexOf(sub[2])+1;
  const act=/(\d{4}\/\d+)/u.exec(reference[0].document??'')?.[1];
  let parent=null;for(let u=owner;u;u=flat(proposal.units).find(c=>c.children.includes(u))){if(u.instruction&&/is amended as follows:$/u.test(u.instruction.raw.trim())){parent=u;break;}}
  if(!replaced||!act||!parent||!new RegExp(`\\b${escape(act)} is amended as follows:$`,'u').test(parent.instruction.raw.replace(/\s+/gu,' ').trim()))return null;
  const quotes=owner.children.filter(unit=>unit.kind==='quotation');
  if(quotes.length!==1)return null;
  const rows=proposal.paragraphs.slice(quotes[0].extent.start,quotes[0].extent.end);
  if(!rows.length||!/^‘/u.test(rows[0].text.trim())||!/’[;.]?\s*$/u.test(rows.at(-1).text)||rows.some((row,i)=>!row.complete||row.source?.container!=='body'||i&&row.source.ordinal!==rows[i-1].source.ordinal+1))return null;
  const end=quotes[0].extent.end;
  if(!points.length)return sub[3]&&number===replaced+1&&!/^\(/u.test(proposedText.trim())?{itemIndex,insertBefore:end,evidence:[{basis:'quoted-subparagraph-following',owner:owner.id,quotation:quotes[0].id}]}:null;
  if(number!==replaced||sub[3]||points.some(point=>!point.startsWith('point ')))return null;
  const labels=points.flatMap(point=>{
    const value=point.slice(6).replace(/\s*\(?new\)?$/u,'').trim(),nested=/^\(?([a-z]+)\)?\s*\(([a-z]+)\)$/u.exec(value);
    return nested?[nested[1],nested[2]]:[value.replace(/[()\s]/gu,'')];
  });
  const label=labels.at(-1),split=/^([a-z]+?)([a-z])$/u.exec(label),printed=new RegExp(`^\\(${escape(label)}\\)\\s`,'u');
  if(labels.length>2||!split||/^[ivxl]+$/u.test(label)||!printed.test(proposedText.trim().replace(/^\(([^)]+)\)/u,(_,value)=>'('+value.replace(/\s/gu,'')+')')))return null;
  const opens=value=>row=>row.text.trim().replace(/^‘/u,'').startsWith('('+value+')');
  const block=letter=>{
    const at=rows.findIndex(opens(letter));
    if(at<0||rows.filter(opens(letter)).length!==1)return null;
    const next=rows.findIndex(opens(String.fromCharCode(letter.charCodeAt(0)+1)));
    return {start:at,end:next>at?next:rows.length};
  };
  let at,collision=false;
  if(labels.length===1){
    const own=/^[a-z]$/u.test(split[1])&&block(split[1]);
    if(!own||rows.some(opens(label)))return null;
    at=own.end;
  } else {
    const own=/^[a-z]$/u.test(labels[0])&&/^[ivxl]+$/u.test(split[1])&&block(labels[0]);
    if(!own)return null;
    const inside=rows.slice(own.start+1,own.end),base=inside.filter(opens(split[1]));
    if(base.length!==1)return {reason:'relative_target_not_found'};
    const suffixed=new RegExp('^\\('+escape(split[1])+'[a-z]\\)','u');
    collision=inside.some(row=>suffixed.test(row.text.trim()));
    if(collision&&!/\(new\)\s*$/u.test(points.at(-1)))return {reason:'duplicate_target_label'};
    const following=inside.slice(inside.indexOf(base[0])+1).findIndex(row=>/^\([ivxl]+[a-z]?\)/u.test(row.text.trim()));
    at=following<0?own.end:own.start+1+inside.indexOf(base[0])+1+following;
  }
  return {itemIndex,insertBefore:at<rows.length?rows[at].index:end,evidence:[{basis:collision?'colliding-new-point':'quoted-subparagraph-point',owner:owner.id,quotation:quotes[0].id,label:labels.join('/')}]};
}

// Explicit drafting conventions within the instruction selected by the label.
function draftingInsertion(selected,proposedText,language) {
  if(language!=='en')return null;
  const {proposal,unit:owner,itemIndex}=selected;
  if(!owner.instruction||owner.scope!=='proposal'||!completeBoundary(proposal,owner))return null;
  const text=proposedText.trim(),rows=proposal.paragraphs.slice(owner.extent.start,owner.extent.end);
  const result=(before,principle)=>({itemIndex,insertBefore:before,evidence:[{basis:'drafting-'+principle,anchor:owner.id}]});
  if(/^[-−]1(?:a)?\.\s/u.test(text))return result(owner.extent.start+1,'negative-instruction');
  const printed=/^[‘']?\(?(\d+)\s*([ab])\)?\.?(?:\s|\t)/u.exec(text);
  if(printed){
    const value=printed[1]+printed[2],units=flat(owner.children);
    if(units.some(u=>u.label?.value===value))return null;
    const anchors=units.filter(u=>['paragraph','point'].includes(u.kind)&&u.label?.value===printed[1]);
    if(anchors.length===1&&completeBoundary(proposal,anchors[0]))return result(anchors[0].extent.end,'quoted-numbered-block');
    if(!anchors.length&&printed[1]==='1'&&/Article \d+ is replaced by the following:/u.test(owner.instruction.raw.replace(/\s+/gu,' '))){
      const articles=units.filter(u=>u.kind==='article');
      const body=articles.length===1?proposal.paragraphs.slice(articles[0].extent.start+1,articles[0].extent.end):[];
      // One title plus one unnumbered substantive paragraph.
      if(body.length===2&&body[0].text.length<180&&!/[.;:!?]$/u.test(body[0].text)&&!/^\d+[.)]/u.test(body[1].text.trim()))return result(owner.extent.end,'implicit-paragraph-one');
    }
    if(!anchors.length&&/^[a-z]$/u.test(owner.label?.value??''))return result(owner.extent.end,'labelled-point-end');
  }
  if(/^The first subparagraph shall not apply\b/u.test(text)&&/Article \d+ is replaced by the following:/u.test(owner.instruction.raw.replace(/\s+/gu,' '))){
    const anchors=flat(owner.children).filter(u=>u.kind==='paragraph'&&u.label?.value==='1');
    if(anchors.length===1&&completeBoundary(proposal,anchors[0]))return result(anchors[0].extent.end,'first-subparagraph-exception');
  }
  return null;
}
// Restrict typo recovery to the label's resolved unit and complete source rows.
function similarMatch(proposal,unit,original){
 if(unit.pathConflict||!unit.instruction||unit.scope!=='proposal'||unit.path[0]?.kind!=='article')return null;
 const hit=similarPassage(proposal.paragraphs.slice(unit.extent.start,unit.extent.end),original);
 if(!hit)return null;
 const {start,end,similarity}=hit,rows=proposal.paragraphs.slice(start,end+1);
 if(rows.some(p=>!p.complete||p.source?.complete!==true||p.source.container!=='body')||proposal.gaps.some(g=>g.code==='unclosed-quotation'&&g.paragraph>=start&&g.paragraph<=end))return null;
 return {span:{start,end},splice:{start:{paragraph:start,offset:0},end:{paragraph:end,offset:rows.at(-1).text.length}},originalText:rows.map(p=>p.text).join('\n'),whole:start===unit.extent.start&&end===unit.extent.end-1,similarity};
}

function singleWordMatch(proposal,unit,original) {
 if(unit.pathConflict||unit.scope!=='proposal'||unit.kind!=='point'||unit.path[0]?.kind!=='article'||unit.children.length||!completeBoundary(proposal,unit)||unit.extent.end!==unit.extent.start+1)return null;
 const row=proposal.paragraphs[unit.extent.start];
 const body=value=>value.replace(/^\(?(\d+)\)?[.)]?\s+/u,(full,number)=>number===unit.label.value?'':full);
 if(row.source?.container!=='body'||!singleWordDifference(body(row.text),body(original)))return null;
 return {span:{start:row.index,end:row.index},splice:{start:{paragraph:row.index,offset:0},end:{paragraph:row.index,offset:row.text.length}},originalText:row.text,whole:true,singleWord:true};
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

// A comparison may print the chapter number and caption together while Word
// splits them into two heading rows. Keep the source's CHAPTER prefix intact.
function chapterTitlePlacement(items,target,original,proposed,language) {
  const [chapter,title]=target.segments;
  if(language!=='en'||target.segments.length!==2||chapter.kind!=='chapter'||chapter.isNew||title.kind!=='title'||title.isNew)return null;
  const candidates=items.flatMap((item,itemIndex)=>item.kind==='annex'?[]:proposalCandidates(item.proposal,[chapter]).map(unit=>({unit,proposal:item.proposal,itemIndex})));
  if(candidates.length!==1)return {reason:'multiple_published_targets'};
  const {unit,proposal,itemIndex}=candidates[0],head=proposal.paragraphs[unit.extent.start],caption=proposal.paragraphs[unit.extent.start+1],next=proposal.paragraphs[unit.extent.start+2];
  if(!completeBoundary(proposal,unit)||unit.pathConflict||head?.properties?.styleId!=='ChapterTitle'||caption?.properties?.styleId!=='ChapterTitle'||next?.properties?.styleId!=='Titrearticle'||!/^Article \d+[a-z]*$/u.test(next.text.trim()))return {reason:'source_structure_unavailable'};
  const header=/^(\s*CHAPTER\s+)([IVXLCDM]+)\s*$/u.exec(head.text);
  if(header?.[2]!==chapter.value)return {reason:'conflicting_target_evidence'};
  const prefix=proposal.paragraphs.slice(0,head.index),adoption=prefix.findLastIndex(p=>/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(p.text.trim()));
  if(adoption<0||prefix.slice(adoption+1).some(p=>/^\s*['‘“«"]/u.test(p.text)||/:\s*['‘“«"]/u.test(p.text)||/\b(?:is|are) (?:amended|replaced|inserted)\b/u.test(p.text)))return {reason:'source_structure_unavailable'};
  const rows=[head,caption,next];
  if(rows.some((p,i)=>!p.complete||p.source?.complete!==true||p.source.container!=='body'||!Number.isSafeInteger(p.source.ordinal)||i&&(p.source.ordinal!==rows[i-1].source.ordinal+1||p.source.segment!==rows[i-1].source.segment||p.source.containerPath!==rows[i-1].source.containerPath)))return {reason:'source_passage_incomplete'};
  const text=chapter.value+' '+caption.text.trim(),fold=value=>value.replace(/\s+/gu,' ').trim();
  if(fold(original)!==fold(text)||!proposed.startsWith(chapter.value)||!/^\s+\S/u.test(proposed.slice(chapter.value.length)))return {reason:'conflicting_target_evidence'};
  const offset=header[1].length;
  return {status:'placed',operation:'replace',itemIndex,span:{start:head.index,end:caption.index},splice:{start:{paragraph:head.index,offset},end:{paragraph:caption.index,offset:caption.text.length}},originalText:head.text.slice(offset)+'\n'+caption.text,evidence:[{basis:'published-chapter-title',anchor:unit.id}]};
}

/** Outer addresses select proposal units; explicit inner insertions stay inside their owner. */
// An annex table address names its owning annex provision. Lines of the
// original column are table rows (cells joined by tabs) or body lines; they
// must match one unique contiguous run cell for cell inside that provision.
const tableRowKey=path=>/^(.*\/w:tr\[\d+\])\/w:tc\[\d+\]\/w:p\[(\d+)\]$/u.exec(path??'');
// Only the opening caption decoration may differ; every table cell stays exact.
function captionDecorationProfile(items,wording) {
  if(wording.baseline!=='commission-proposal'||items.length!==2||items.filter(item=>item.kind==='act').length!==1||items.filter(item=>item.kind==='annex').length!==1||wording.targetPath?.underlying?.length)return null;
  const header=/^Annex ([IVXLC]+) – paragraph 1 – table on ([^\r\n]+)\n(Regulation \((?:EU|EC)\) \d{4}\/\d+)\nAnnex ([IVXLC]+) – table ([^\r\n]+)$/u.exec(wording.targetLabel||'');
  const caption=/^‘\[([^\r\n\t\[\]]+)\r?\nCN code\tGreenhouse gas\r?\n/u.exec(wording.originalText||'');
  const key=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
  if(!header||!caption||key(header[2])!==key(caption[1])||key(header[5])!==key(caption[1]))return null;
  if(wording.targetPath?.proposal?.length&&(wording.targetPath.proposal.length!==1||wording.targetPath.proposal[0].raw!==wording.targetLabel.split('\n')[0]))return null;
  const lead=items.find(item=>item.kind==='act').proposal.paragraphs.filter(row=>row.text.normalize('NFC').replace(/\s+/gu,' ').trim()===header[3]+' is amended as follows:');
  if(lead.length!==1||!lead[0].complete||lead[0].source?.complete!==true||lead[0].source.container!=='body')return null;
  return {outer:header[1],inner:header[4]};
}
function annexTablePlacement(items,address,originalText,language,operation,evidence,unresolved,decoration) {
  let parsed;try{parsed=parseTargetLabel(address,language);}catch{return unresolved('target_reference_unavailable');}
  const article=parsed.segments[0]?.kind==='article';
  if(!parsed.complete||!['annex','article'].includes(parsed.segments[0]?.kind)||article&&(parsed.segments.length!==2||parsed.segments[1].kind!=='paragraph'))return unresolved('target_reference_unavailable');
  const find=segments=>items.flatMap((item,itemIndex)=>(article?item.kind==='annex':item.kind!=='annex')?[]:proposalCandidates(item.proposal,{...parsed,segments}).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  let candidates=find(parsed.segments);
  // A published annex point address omits the annex's sole implicit paragraph.
  if(!candidates.length&&parsed.segments[1]?.kind==='point'){
    const annexes=find(parsed.segments.slice(0,1)),body=annexes.length===1?annexes[0].unit.children.filter(child=>child.kind!=='title'):[];
    if(body.length===1&&body[0].kind==='paragraph'&&body[0].implicit&&!body[0].pathConflict)candidates=find([parsed.segments[0],body[0].label,...parsed.segments.slice(1)]);
  }
  if(candidates.length!==1||candidates[0].unit.pathConflict)return unresolved(candidates.length?'multiple_published_targets':'target_not_found');
  const {itemIndex,unit,proposal}=candidates[0],cell=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
  const rows=[];let current=null;
  for(const row of (decoration?proposal.paragraphs:proposal.paragraphs.slice(unit.extent.start,unit.extent.end))){
    if(row.source?.container==='table-cell'){
      const key=tableRowKey(row.source.path);
      if(!key)return unresolved('source_structure_unavailable');
      if(current?.key!==key[1]){current={key:key[1],cells:[],rows:[],columns:[]};rows.push(current);}
      if(key[2]==='1')current.columns.push(Number(/\/w:tc\[(\d+)\]\/w:p\[\d+\]$/u.exec(row.source.path)[1]));
      // A multi-paragraph cell cannot match one tab-separated cell exactly.
      if(key[2]!=='1')current.cells.push('\u0000');else current.cells.push(cell(row.text));
      current.rows.push(row);
    }else{current=null;rows.push({key:null,cells:[cell(row.text)],rows:[row]});}
  }
  // Empty cells keep no paragraph: require columns 1..n at the table's widest
  // row, and consecutive row numbers inside a matched run.
  // The extracted table records every cell, empty ones included.
  const cellCounts=new Map();
  for(const source of flat(proposal.units).filter(u=>u.table).flatMap(u=>[u.table,...(u.table.nestedTables??[])]))for(const tr of source.rows??[]){
    const plain=tr.cells.every(c=>(c.colSpan??1)===1&&!c.horizontalMerge&&!c.verticalMerge);
    for(const c of tr.cells)for(const index of c.paragraphs??[])cellCounts.set(index,plain?tr.cells.length:-1);
  }
  const tableOf=key=>key.replace(/\/w:tr\[\d+\]$/u,''),rowOf=key=>Number(/\/w:tr\[(\d+)\]$/u.exec(key)[1]);
  rows.forEach((row,index)=>{
    if(!row.key)return;
    if(row.columns.some((column,at)=>column!==at+1)||cellCounts.get(row.rows[0].index)!==row.columns.length){if(decoration)row.broken=true;else row.cells=['\u0000'];}
    const previous=rows[index-1];
    row.gap=Boolean(previous?.key&&tableOf(previous.key)===tableOf(row.key)&&rowOf(row.key)!==rowOf(previous.key)+1);
  });
  const lines=originalText.split(/\r?\n/u).map(line=>line.split('\t').map(cell));
  const starts=[];
  for(let i=0;i+lines.length<=rows.length;i++)if(lines.every((line,offset)=>rows[i+offset].cells.length===line.length&&rows[i+offset].cells.every((value,index)=>value===line[index])))starts.push(i);
  let repaired=false;
  if(!starts.length&&decoration){
    lines[0][0]=lines[0][0].slice(2);repaired=true;
    for(let i=0;i+lines.length<=rows.length;i++)if(lines.every((line,offset)=>rows[i+offset].cells.length===line.length&&rows[i+offset].cells.every((value,index)=>value===line[index])))starts.push(i);
  }
  let wordDifference=false;
  if(!starts.length&&!decoration)for(let i=0;i+lines.length<=rows.length;i++){
    const run=rows.slice(i,i+lines.length);
    let differences=0;
    const compatible=run.every((row,j)=>row.cells.length===lines[j].length&&row.cells.every((value,k)=>value===lines[j][k]||++differences===1&&singleWordDifference(value,lines[j][k])));
    if(compatible&&differences===1){starts.push(i);wordDifference=true;}
  }
  if(starts.length!==1)return unresolved(starts.length?'duplicate_target_label':'conflicting_target_evidence');
  if(article){
    const run=rows.slice(starts[0],starts[0]+lines.length),key=run[0]?.key&&tableOf(run[0].key);
    if(!key||run.some(row=>!row.key||tableOf(row.key)!==key)||rows[starts[0]-1]?.key&&tableOf(rows[starts[0]-1].key)===key||rows[starts[0]+lines.length]?.key&&tableOf(rows[starts[0]+lines.length].key)===key)return unresolved('source_structure_unavailable');
    const geometry=flat(proposal.units).filter(unit=>unit.table).flatMap(unit=>[unit.table,...(unit.table.nestedTables??[])]).filter(table=>table.sourcePath===key);
    if(geometry.length!==1||geometry[0].complete!==true||!Array.isArray(geometry[0].rows)||geometry[0].rows.length!==run.length||rowOf(run[0].key)!==1||rowOf(run.at(-1).key)!==geometry[0].rows.length)return unresolved('source_structure_unavailable');
  }
  if(repaired){
    const run=rows.slice(starts[0],starts[0]+lines.length),before=rows.slice(0,starts[0]),heading=before.findLastIndex(row=>!row.key&&/^ANNEX [IVXLC]+$/u.test(row.cells[0]));
    const scopeRows=before.slice(heading).filter(row=>!row.key),prefix=scopeRows.slice(1).map(row=>row.cells[0]),tableKey=run[1]?.key&&tableOf(run[1].key);
    if(scopeRows.some(row=>row.rows.some(p=>!p.complete||p.source?.complete!==true))||run.some(row=>row.broken)||heading<0||before[heading].cells[0]!=='ANNEX '+decoration.outer||run[0].key||!tableKey||run.slice(1).some(row=>!row.key||tableOf(row.key)!==tableKey||row.cells.length!==2)||prefix.filter(value=>/^‘ANNEX [IVXLC]+$/u.test(value)).length!==1||!prefix.includes('‘ANNEX '+decoration.inner)||prefix.filter(value=>/^The following Annex [IVXLC]+ is added:$/u.test(value)).length!==1||!prefix.includes('The following Annex '+decoration.inner+' is added:')||run.some(row=>row.rows.some(p=>p.index<unit.extent.start||p.index>=unit.extent.end)))return unresolved('conflicting_target_evidence');
  }
  if(rows.slice(starts[0],starts[0]+lines.length).some((row,index)=>row.broken||index&&row.gap||row.rows.some(p=>p.index<unit.extent.start||p.index>=unit.extent.end)))return unresolved('source_passage_incomplete');
  const matched=rows.slice(starts[0],starts[0]+lines.length).flatMap(row=>row.rows);
  if(matched.some(row=>!row.complete||!row.source||row.source.complete===false))return unresolved('source_passage_incomplete');
  const first=matched[0],last=matched.at(-1);
  evidence.push({basis:wordDifference?'single-word-original-difference':repaired?'annex-table-caption-decoration':'annex-table-rows',anchor:unit.id,rows:lines.length});
  return {operation,status:'placed',itemIndex,span:{start:first.index,end:last.index},splice:{start:{paragraph:first.index,offset:0},end:{paragraph:last.index,offset:last.text.length}},originalText:article?originalText:matched.map(row=>row.text).join('\n'),evidence};
}

function preambleCitationPlacement(items,label,operation,originalText,originalFormatting,evidence,unresolved) {
  const preambles=[];
  for(const [itemIndex,item] of items.entries()) {
    if(item.kind==='annex')continue;
    const rows=item.proposal.paragraphs,opens=rows.filter(row=>/^THE (?:EUROPEAN PARLIAMENT AND THE )?COUNCIL OF THE EUROPEAN UNION,$/u.test(row.text.trim()));
    if(opens.length!==1)continue;
    const close=rows.find(row=>row.index>opens[0].index&&/^Whereas:$/u.test(row.text.trim()));
    if(close)preambles.push({itemIndex,proposal:item.proposal,open:opens[0],close,citations:rows.slice(opens[0].index+1,close.index)});
  }
  if(preambles.length!==1)return unresolved('source_structure_unavailable');
  const {itemIndex,proposal,open,close,citations}=preambles[0];
  const run=proposal.paragraphs.slice(open.index,close.index+1);
  // Each citation opens with a fixed phrase; a continuation row or heading
  // would shift every ordinal, so such preambles are withheld.
  if(citations.some(row=>!/^(?:Having regard to|After (?:transmission|consulting|consultation)|Acting in accordance with)\b/u.test(row.text.trim())))return unresolved('source_structure_unavailable');
  if(!citations.length||run.some((row,index)=>!row.complete||!row.source||row.source.complete===false||row.source.container!=='body'||!row.text.trim()
    ||index&&(row.source.containerPath!==run[index-1].source.containerPath||row.source.segment!==run[index-1].source.segment||row.source.ordinal!==run[index-1].source.ordinal+1)))return unresolved('source_passage_incomplete');
  const row=citations[label.number-1];
  if(!row)return unresolved('target_not_found');
  evidence.push({basis:'preamble-citation-ordinal',ordinal:label.number,row:row.index});
  if(operation==='insert') {
    if(!label.isNew||!label.suffix)return unresolved('insertion_reference_unavailable');
    return {operation,status:'placed',itemIndex,insertAfter:row.index,insertBefore:row.index+1,evidence};
  }
  if(label.isNew||label.suffix)return unresolved('conflicting_target_evidence');
  const unit={kind:'citation',extent:{start:row.index,end:row.index+1},content:[row.index],children:[]};
  const notes=footnoteBody(proposal,unit,originalText,originalFormatting,{operation,language:'en'});
  if(notes===false)return unresolved('conflicting_target_evidence');
  const match=matchUnit(proposal,unit,notes??originalText);
  if(!match.span)return unresolved(match.reason??'conflicting_target_evidence');
  return {operation,status:'placed',itemIndex,span:match.span,splice:match.splice,originalText:match.originalText,evidence};
}

function negativeArticlePlacement(items,proposedText,language,evidence,unresolved) {
  const articles=items.flatMap((item,itemIndex)=>item.kind==='annex'?[]:flat(item.proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind==='article').map(unit=>({itemIndex,unit,proposal:item.proposal})));
  const first=articles.sort((a,b)=>a.itemIndex-b.itemIndex||a.unit.extent.start-b.unit.extent.start)[0];
  if(language!=='en'||!/^Article\s*[-−–‑]\s*1\b/u.test(proposedText.trim()))return unresolved('insertion_reference_unavailable');
  if(!first||first.unit.label?.value!=='1'||articles.filter(({unit})=>unit.label?.value==='1').length!==1||first.unit.pathConflict)return unresolved('relative_target_not_found');
  const {proposal,unit}=first,before=proposal.paragraphs[unit.extent.start-1],at=proposal.paragraphs[unit.extent.start];
  if(!before||!/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(before.text.trim())||!completeBoundary(proposal,unit)||!before.complete||before.source?.complete===false||at.source?.ordinal!==before.source?.ordinal+1)return unresolved('source_passage_incomplete');
  evidence.push({basis:'negative-article-before-first',anchor:unit.id});
  return {operation:'insert',status:'placed',itemIndex:first.itemIndex,insertAfter:unit.extent.start-1,insertBefore:unit.extent.start,evidence};
}

export function resolveProposalPlacement(items,{originalText,proposedText,targetLabel,targetPath,language,originalFormatting,baseline,documentReferences,number,listId}={}, {nativeProposalInputs}={}) {
  const operation=amendmentOperation({originalText,proposedText,language}),evidence=[];
  const unresolved=reason=>({operation,status:'unresolved',reason,evidence});
  const pdfArticle=items?.some(item=>item.proposal?.sourceKind==='pdf')&&!/^(?:Recital|Bod odůvodnění|Betragtning|Considerando)\s+\d+/iu.test(targetLabel??'');
  const mixedScope=amendmentMixedLanguageScope({originalText,proposedText,language});
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  const scope=amendmentLanguageScope({originalText,proposedText,language});
  if(scope)return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...scope}]};
  if(!operation)return unresolved('amendment_wording_unavailable');
  if([originalText,proposedText].some(text=>text.length>MAX_COLUMN_CHARACTERS))return unresolved('matching_budget');
  if([originalText,proposedText].some(text=>text.includes('\uFFFC')))return unresolved('math_comparison_unavailable');
  const unnumbered=unnumberedTableInsertion(items,{originalText,proposedText,targetLabel,targetPath,language,baseline});
  if(unnumbered)return unnumbered;
  const tableContext=operation==='replace'?tableContextPlacement(items,{originalText,proposedText,targetLabel,targetPath,language,baseline,documentReferences},nativeProposalInputs):null;if(tableContext)return tableContext;
  if(operation==='replace'&&documentReferences?.some(ref=>ref.basis==='caption-before-original-heading'))return unresolved('conflicting_target_evidence');
  const sequence=sequentialAnnexInsertion(items,{originalText,proposedText,targetLabel,targetPath,language,baseline,documentReferences,number,listId},nativeProposalInputs);
  if(sequence)return sequence.status==='placed'?{...sequence,evidence:[...evidence,...sequence.evidence]}:unresolved(sequence.reason);
  const firstAnnex=firstAnnexInsertion(items,{originalText,proposedText,targetLabel,targetPath,language,baseline,documentReferences},nativeProposalInputs);
  if(firstAnnex)return firstAnnex.reason?unresolved(firstAnnex.reason):firstAnnex;
  // Lists without structured location tags still publish the location as a
  // heading in the same document and language; that heading is the target.
  const paths=targetPath?.proposal?.length?targetPath.proposal:null;
  if(paths&&paths.length!==1)return unresolved('target_reference_unavailable');
  // A structured underlying-act target without a proposal address is not an outer location.
  if(!paths&&targetPath?.underlying?.length)return unresolved('target_reference_unavailable');
  // This title is a contiguous three-row act heading after the procedure
  // reference, not one of the separately numbered chapters or articles.
  if(language==='en'&&baseline==='commission-proposal'&&operation==='replace'&&targetLabel==='Title 1'&&!targetPath?.underlying?.length) {
    const candidates=[];
    for(const [itemIndex,item] of items.entries()) {
      if(item.kind==='annex'||item.proposal?.sourceKind!=='docx')continue;
      const paragraphs=item.proposal.paragraphs;
      for(let i=1;i+3<paragraphs.length;i++) {
        const group=paragraphs.slice(i-1,i+4),styles=group.slice(1,4).map(row=>row.properties?.styleId);
        if(styles.join('|')!=='Statut|Typedudocument|Titreobjet'||!/^\d{4}\/\d+ \(CNS\)$/u.test(group[0].text.trim())
          ||group[1].text.trim()!=='Proposal for a'||group[2].text.trim()!=='COUNCIL DIRECTIVE'||group[4].text.trim()!=='THE COUNCIL OF THE EUROPEAN UNION,')continue;
        if(group.some((row,n)=>!row.complete||row.source?.complete!==true||row.source.container!=='body'||n&&(row.source.ordinal!==group[n-1].source.ordinal+1||row.source.segment!==group[n-1].source.segment||row.source.containerPath!==group[n-1].source.containerPath)))continue;
        if(normal(group.slice(1,4).map(row=>row.text).join('\n'))!==normal(originalText))continue;
        if(!nativeTitleRowsComplete(nativeProposalInputs?.[itemIndex],item.proposal.sourceHash,group))continue;
        candidates.push({itemIndex,start:group[1],end:group[3]});
      }
    }
    if(candidates.length!==1)return unresolved('target_not_found');
    const {itemIndex,start,end}=candidates[0];evidence.push({basis:'published-proposal-title'});
    return {operation,status:'placed',itemIndex,span:{start:start.index,end:end.index},splice:{start:{paragraph:start.index,offset:0},end:{paragraph:end.index,offset:end.text.length}},originalText,evidence};
  }
  // An empty original column and a printed Na insertion instruction establish
  // a new outer point even when its published heading still names base N.
  const printedBase=language==='en'&&baseline==='commission-proposal'&&operation==='insert'&&originalText===''&&/^Article [1-9]\d* – paragraph 1 – point ([1-9]\d*)$/u.exec(paths?.[0]?.raw??String(targetLabel??'').split('\n')[0]);
  const printedNew=/^\(([1-9]\d*)a\) in Article [1-9]\d*, the following paragraph is inserted:\n\S/u.exec(proposedText);
  if(printedBase&&printedNew&&printedBase[1]===printedNew[1]){
    const raw=(paths?.[0]?.raw??targetLabel.split('\n')[0])+' a (new)';
    const placed=resolveProposalPlacement(items,{originalText,proposedText,targetLabel:raw,targetPath:{proposal:[{raw}]},language,originalFormatting,baseline,documentReferences},{nativeProposalInputs});
    if(placed.status!=='placed')return placed;
    return {...placed,evidence:[...evidence,{basis:'proposal-target-path',label:paths?.[0]?.raw??targetLabel.split('\n')[0]},{basis:'printed-new-point-label',label:printedBase[1],reference:printedBase[1]+'a'},...placed.evidence.filter(e=>e.basis!=='proposal-target-path')]};
  }
  const uniqueEntry=uniqueAnnexEntryPlacement(items,{originalText,proposedText,targetLabel,targetPath,language,baseline},nativeProposalInputs);
  if(uniqueEntry)return uniqueEntry;
  const instruction=wholeAnnexInstructionPlacement(items,{originalText,proposedText,targetLabel,targetPath,language,baseline,documentReferences,operation},unresolved,nativeProposalInputs);
  if(instruction)return instruction;
  const table=language==='en'&&operation!=='insert'&&/^(Annex .+?)\s[–—-]\s+table(?:\s+on\s+[^–—-]+)?$/u.exec(String(paths?.[0]?.raw??targetLabel??'').split('\n')[0].trim());
  if(table)return annexTablePlacement(items,table[1],originalText,language,operation,evidence,unresolved,captionDecorationProfile(items,{targetLabel,targetPath,originalText,baseline}));
  // A matrix comparison already publishes its cells; its owning annex point
  // is enough to scope an exact table match, without an extra table suffix.
  const matrix=language==='en'&&baseline==='commission-proposal'&&operation==='replace'&&originalText.includes('\t')&&originalText.includes('\n')&&/^Annex [IVXLC]+ – point [1-9]\d*$/u.exec(String(paths?.[0]?.raw??targetLabel??'').split('\n')[0].trim());
  if(matrix)return annexTablePlacement(items,matrix[0],originalText,language,operation,evidence,unresolved);
  const articleTable=language==='en'&&operation!=='insert'&&/^(Article [1-9]\d* – paragraph [1-9]\d*) – table$/u.exec(String(paths?.[0]?.raw??targetLabel??'').split('\n')[0]);
  if(articleTable&&!targetPath?.underlying?.length)return annexTablePlacement(items,articleTable[1],originalText,language,operation,evidence,unresolved,null);
  const targetRaw=paths?.[0]?.raw??targetLabel;
  const outerAnnexRaw=language==='en'&&/^Annex [IVXLCDM]+\s*a \(new\) [-–—] table$/u.test(targetRaw?.split('\n')[0]??'')?targetRaw.replace(/(\(new\)) [-–—] table/u,'$1'):targetRaw;
  let target;try{target=parseTargetLabel(outerAnnexRaw,language);}catch{return unresolved('reference_language_unsupported');}
  if(!target.complete||!target.segments.length)return unresolved('target_reference_unavailable');
  evidence.push({basis:'proposal-target-path',label:target.raw});
  // A source with no printed paragraph numbers is addressed by native row
  // order. Match the whole row only; points and titled articles stay excluded.
  if(operation==='replace'&&language==='en'&&target.segments.length===2&&target.segments[0].kind==='article'&&target.segments[1].kind==='paragraph'&&!target.segments[1].isNew){
    const found=[];
    for(const [itemIndex,item] of items.entries()){
      const proposal=item.proposal;if(proposal.sourceKind!=='docx')continue;
      const headings=proposal.paragraphs.filter(row=>row.properties?.styleId==='Titrearticle'&&new RegExp('^Article\\s+'+escape(target.segments[0].value)+'(?:$|\\n)','u').test(row.text));
      if(headings.length!==1)continue;
      const start=headings[0].index,next=proposal.paragraphs.find(row=>row.index>start&&row.properties?.styleId==='Titrearticle');
      if(!next||!next.complete||next.source?.complete!==true||next.source.container!=='body')continue;
      const rows=proposal.paragraphs.filter(row=>row.index>start&&row.index<next.index);
      if(!rows.length||rows.some(row=>row.properties?.styleId!=='Normal'||row.properties.numberingLabel||/^\d+[.)]\s/u.test(row.text)||row.source?.container!=='body'||!row.complete||row.source.complete!==true||row.objects?.length))continue;
      const row=rows[target.segments[1].number-1],compact=v=>v.normalize('NFC').replace(/\s+/gu,'').trim();
      if(!row||compact(row.text)!==compact(originalText)||rows.filter(r=>compact(r.text)===compact(originalText)).length!==1)continue;
      const boundary=[headings[0],...rows];
      if(boundary.some((r,i)=>!r.complete||r.source?.complete!==true||r.source.container!=='body'||i&&(r.source.ordinal!==boundary[i-1].source.ordinal+1||r.source.containerPath!==boundary[i-1].source.containerPath||r.source.segment!==boundary[i-1].source.segment)))continue;
      found.push({operation,status:'placed',itemIndex,span:{start:row.index,end:row.index},splice:{start:{paragraph:row.index,offset:0},end:{paragraph:row.index,offset:row.text.length}},originalText:row.text,evidence:[...evidence,{basis:'ordinal-unnumbered-paragraph'}]});
    }
    if(found.length===1)return found[0];
  }
  const outerPrefix=pdfArticle?councilOuterInstructionPrefix(items,target,{language,baseline,targetPath,targetLabel,originalText,proposedText}):null;
  const bound=pdfArticle&&!outerPrefix?councilQuotedTarget(items,target,targetPath,language,targetLabel):null;
  if(bound?.reason)return unresolved(bound.reason);
  if(outerPrefix){target={...target,segments:target.segments.map((s,i)=>i===target.segments.length-1?{...s,isNew:true}:s)};evidence.push({basis:'council-new-outer-prefix',anchor:outerPrefix.parent.id});}
  if(bound){target=bound.target;evidence.push({basis:'council-quoted-owner',anchor:bound.owner.id},{basis:'published-underlying-path',label:target.raw});}
  let nativeList=null;
  const scopedCandidates=(proposal,address)=>{
    if(!bound)return proposalCandidates(proposal,address);
    if(proposal!==bound.proposal)return [];
    const found=bound.units.filter(u=>u.kind===address.at(-1)?.kind&&u.label&&sameAddress(u.underlyingPath,address)&&(!nativeList||address.length<nativeList.parent.underlyingPath.length||u===nativeList.parent||flat(nativeList.parent.children).includes(u)));
    if(!found.length&&address.length===1&&address[0].kind==='article'&&bound.quote.underlyingPath?.[0]?.kind==='article'&&sameAddress(bound.quote.underlyingPath.slice(0,1),address))return [{...bound.quote,kind:'article',label:address[0],underlyingPath:address,implicit:true}];
    return found;
  };
  if(bound&&operation==='insert'&&!originalText.trim()){
    const last=target.segments.at(-1),printed=/^(\d+)\s*(bis|[a-z])\.\s+/iu.exec(proposedText.trim());
    if(last.suffix&&!last.isNew&&printed&&(printed[1]+printed[2]).toLowerCase()===last.value&&!scopedCandidates(bound.proposal,target.segments).length){target={...target,segments:target.segments.map((s,i)=>i===target.segments.length-1?{...s,isNew:true}:s)};evidence.push({basis:'blank-original-printed-suffixed-insertion',label:last.value});}
  }
  const sole=target.segments.length===1?target.segments[0]:null;
  // A numbered address whose whole cell rejects the proposal (A-10-2026-0104 AM90) is no citation or article.
  if(sole&&['citation','article'].includes(sole.kind)&&rejectionWordingScope(language,proposedText))return unresolved('conflicting_target_evidence');
  if(language==='en'&&sole?.kind==='citation'&&Number.isInteger(sole.number))return preambleCitationPlacement(items,sole,operation,originalText,originalFormatting,evidence,unresolved);
  if(sole?.kind==='article'&&sole.negative&&sole.value==='-1'&&operation==='insert')return negativeArticlePlacement(items,proposedText,language,evidence,unresolved);
  if(operation==='insert'){const indent=bareAnnexIndentInsertion(items,target,{language,baseline,originalText,proposedText,nativeProposalInputs});if(indent)return {...indent,evidence:[...evidence,...indent.evidence]};}
  if(operation==='replace'){const annex=bareAnnexReplacement(items,target,{language,baseline,originalText,proposedText,targetLabel,targetPath,nativeProposalInputs});if(annex)return {...annex,evidence:[...evidence,...annex.evidence]};}
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
    const label=target.segments[subparagraph];let parents=items.flatMap((item,itemIndex)=>
      item.kind==='annex'&&!target.segments.some(segment=>segment.kind==='annex')?[]:
        scopedCandidates(item.proposal,target.segments.slice(0,subparagraph)).map(unit=>({unit,itemIndex,proposal:item.proposal})));
    if(!label.number||label.suffix||label.isNew)return unresolved('source_structure_unavailable');
    if(bound&&language==='cs'&&subparagraph===2&&target.segments.length===4&&label.number===1&&operation==='insert'&&target.segments.at(-1)?.kind==='point'){
      const last=target.segments.at(-1),anchors=parents.flatMap(p=>p.unit.children.filter(c=>c.kind==='point'&&labelBase(c.label)===labelBase(last)).map(anchor=>({parent:p,anchor}))),selected=anchors.length===1?anchors[0]:null;
      if(selected?.parent.unit.listOwnership&&last.isNew&&last.suffix==='a'&&/^[a-z]a$/u.test(last.value)&&new RegExp('^'+escape(last.value)+'\\)\\s+\\S','u').test(proposedText.trim())&&!originalText.trim()){parents=[selected.parent];nativeList={parent:selected.parent.unit,points:selected.parent.unit.children.filter(c=>c.kind==='point')};}
    }
    if(parents.length===1){
      const {unit,itemIndex,proposal}=parents[0],points=unit.children.filter(child=>child.kind==='point');
      const boundary=unit.children.find(child=>child.kind==='subparagraph')?.extent.start??unit.extent.end;
      if(label.number===1&&(!unit.pathConflict||nativeList?.parent===unit)&&['paragraph','point'].includes(unit.kind)&&unit.content.length
        &&/:\s*$/u.test(proposal.paragraphs[unit.content.at(-1)].text)&&points.length
        &&points.every(point=>point.extent.start<boundary&&point.extent.end<=boundary)
        &&unit.children.every(child=>child.extent.start>=boundary||child.kind==='point')){
        subparagraphBounds={itemIndex,start:unit.extent.start,end:boundary};
        target={...target,segments:target.segments.filter((_,index)=>index!==subparagraph)};
        evidence.push({basis:'first-subparagraph-points',anchor:unit.id});
      }
      // Native XHTML and DOCX retain directly owned unnumbered paragraphs in source
      // order. A later colon introduction owns only the following list, up to
      // the next direct paragraph; nested Roman children stay with their point.
      if(label.number>1&&(proposal.sourceKind==='xhtml'||proposal.sourceKind==='docx'&&operation==='replace')&&unit.complete&&!unit.pathConflict&&['paragraph','point'].includes(unit.kind)){
        const continuations=unit.children.filter(child=>child.kind==='subparagraph');
        const index=label.number-(unit.content.length?2:1),intro=continuations[index];
        const end=continuations[index+1]?.extent.start??unit.extent.end;
        const list=intro&&points.filter(point=>point.extent.start>=intro.extent.end&&point.extent.start<end);
        if(intro&&intro.content.length===1&&/:\s*$/u.test(proposal.paragraphs[intro.content[0]].text)&&list.length
          &&list[0].extent.start===intro.extent.end&&list.every((point,index)=>point.extent.end<=end&&(!index||list[index-1].extent.end===point.extent.start))
          &&list.at(-1).extent.end===end){
          subparagraphBounds={itemIndex,start:intro.extent.start,end};
          target={...target,segments:target.segments.filter((_,index)=>index!==subparagraph)};
          evidence.push({basis:proposal.sourceKind==='docx'?'docx-subparagraph-points':'xhtml-subparagraph-points',anchor:unit.id});
        }
      }
    }
    if(!subparagraphBounds&&(label.number>1||operation==='insert'))return unresolved('source_structure_unavailable');
  }
  // An uncontained annex paragraph can share an act address. The item identity
  // still establishes that an address without Annex cannot select it.
  const eligible=item=>item.kind!=='annex'||target.segments.some(segment=>segment.kind==='annex');
  const candidatesFor=address=>items.flatMap((item,itemIndex)=>!eligible(item)?[]:scopedCandidates(item.proposal,Array.isArray(address)?address:address.segments).map(unit=>({itemIndex,unit,proposal:item.proposal})));
  if(operation==='replace'){
    const chapter=chapterTitlePlacement(items,target,originalText,proposedText,language);
    if(chapter)return chapter.reason?unresolved(chapter.reason):{...chapter,evidence:[...evidence,...chapter.evidence]};
  }
  const candidates=candidatesFor(target);
  const wordDifferenceUnits=new Set();
  const drafting=candidates.length===1?draftingInsertion(candidates[0],proposedText,language):null;
  if(drafting&&(operation==='insert'||/^[-−]1(?:a)?\.\s/u.test(proposedText.trim()))){
    evidence.push(...drafting.evidence);
    return {operation:'insert',status:'placed',itemIndex:drafting.itemIndex,insertBefore:drafting.insertBefore,insertAfter:drafting.insertBefore-1,evidence};
  }
  const placedMatch=(selected,basis)=>{
    const wordDifference=wordDifferenceUnits.has(selected.unit);
    if(wordDifference&&(selected.match.span.start!==selected.unit.extent.start||selected.match.span.end!==selected.unit.extent.end-1||selected.match.splice.start.offset!==0||selected.match.splice.end.offset!==selected.proposal.paragraphs[selected.match.span.end].text.length))return unresolved('source_structure_unavailable');
    if(subparagraphBounds&&(selected.itemIndex!==subparagraphBounds.itemIndex||selected.match.span.start<subparagraphBounds.start||selected.match.span.end>=subparagraphBounds.end))return unresolved('conflicting_target_evidence');
    if(bound){
      const proposal=selected.proposal??bound.proposal,unit=selected.unit,match=selected.match,start={...match.splice.start},end={...match.splice.end},first=proposal.paragraphs[start.paragraph].text,last=proposal.paragraphs[end.paragraph].text;
      const literal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim(),opening=start.paragraph===bound.quote.extent.start&&/^[„“‘«»"]/u.test(first)?first[0]:'';
      const oldOpen=opening&&originalText.trimStart().startsWith(opening),newOpen=opening&&proposedText.trimStart().startsWith(opening);
      if(!!oldOpen!==!!newOpen)return unresolved('conflicting_target_evidence');
      if(start.offset===0&&opening&&!oldOpen)start.offset=1;
      const prefix=unit.content[0]===start.paragraph?unit.label?.prefix:null;
      if(prefix&&first.startsWith(prefix,start.offset)){
        const pattern=new RegExp('^'+escape(prefix.trim())+'(?:\\s|$)','u'),oldLabel=pattern.test(originalText.trimStart()),newLabel=pattern.test(proposedText.trimStart());
        if(oldLabel!==newLabel)return unresolved('conflicting_target_evidence');
        if(!oldLabel)start.offset+=prefix.length;
      }
      const closing=end.paragraph===bound.quote.extent.end-1?/[“’»«"][;.]?\s*$/u.exec(last):null;
      if(closing&&end.offset===last.length&&!originalText.trimEnd().endsWith(closing[0].trim()))end.offset=closing.index;
      const text=proposal.paragraphs.slice(start.paragraph,end.paragraph+1).map((p,i)=>p.text.slice(i?0:start.offset,i===end.paragraph-start.paragraph?end.offset:p.text.length)).join('\n');
      if(literal(text)!==literal(originalText))return unresolved('conflicting_target_evidence');
      selected={...selected,match:{...match,splice:{start,end},originalText:text}};
    }
    evidence.push({basis,anchor:selected.unit.id});
    return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,...(wordDifference?{originalDifference:'one-word'}:{}),evidence};
  };
  if(operation==='insert') {
    const quoted=candidates.length===1?(quotedSectionPointInsertion(candidates[0],{targetLabel,targetPath,originalText,proposedText,language,baseline},nativeProposalInputs?.[candidates[0].itemIndex])??twoLinePointInsertion(candidates[0],targetPath,proposedText,language)??quotedInteriorInsertion(candidates[0],targetPath,proposedText,language)??finnishQuotedSiblingInsertion(candidates[0],targetPath,proposedText,language)??quotedSiblingInsertion(candidates[0],targetPath,proposedText,language)??quotedOrdinalSubparagraphInsertion(candidates[0],targetPath,proposedText,language)??quotedSubparagraphInsertion(candidates[0],printedInnerPath(targetLabel,targetPath,language),proposedText,language)):null;
    if(quoted){
      if(quoted.reason)return unresolved(quoted.reason);
      evidence.push(...quoted.evidence);
      return {operation,status:'placed',itemIndex:quoted.itemIndex,insertAfter:quoted.insertBefore-1,insertBefore:quoted.insertBefore,evidence};
    }
    if(candidates.length)return unresolved('duplicate_target_label');
    const insertion=(originalText===''&&baseline==='commission-proposal'?newParentChildInsertion(items,target,candidatesFor,eligible):null)??numberedAnnexInsertion(items,target,language,nativeProposalInputs)??bareAnnexInsertion(items,target,language)??insertionPlacement(items,target,candidatesFor,eligible,proposedText,bound?{scope:'quoted',unitsFor:item=>item.proposal===bound.proposal?bound.units:[],quoted:bound.quote,listOwnership:nativeList}:{outerPrefix});
    if(insertion.reason)return unresolved(insertion.reason);
    if(subparagraphBounds&&(insertion.itemIndex!==subparagraphBounds.itemIndex||insertion.insertBefore<=subparagraphBounds.start||insertion.insertBefore>subparagraphBounds.end))return unresolved('source_structure_unavailable');
    evidence.push({basis:insertion.basis,anchor:insertion.anchor.id});
    return {operation,status:'placed',itemIndex:insertion.itemIndex,insertAfter:insertion.insertBefore-1,insertBefore:insertion.insertBefore,...(insertion.splice?{splice:insertion.splice}:{}),evidence};
  }
  const introParents=subparagraphBounds&&target.segments.at(-1).kind==='introductory-part'?candidatesFor(target.segments.slice(0,-1)):[];
  if(introParents.length===1){
    const c=introParents[0],row=c.proposal.paragraphs[subparagraphBounds.start];
    if(c.itemIndex===subparagraphBounds.itemIndex&&normal(row.text)===normal(originalText)){
      const match=matchUnit(c.proposal,{...c.unit,extent:{start:row.index,end:row.index+1}},originalText);
      if(match.span)return placedMatch({...c,match},'subparagraph-introductory-wording');
    }
  }
  if(target.segments.at(-1).kind==='introductory-part'){
    const intro=introductoryMatch(target,originalText,candidatesFor);
    return intro.reason?unresolved(intro.reason):placedMatch(intro,'introductory-wording-match');
  }
  if(!candidates.length) {
    const numbering=!bound&&wordingNumberingMatch(target,originalText,candidatesFor);
    if(numbering)return placedMatch(numbering,'unique-wording-numbering');
    const sub=subparagraphMatch(items,target,originalText,candidatesFor);
    if(!sub){
      if(bound)return unresolved('target_not_found');
      const fallback=ancestorFallback(target,originalText,candidatesFor);
      if(fallback?.reason)return unresolved(fallback.reason);
      return fallback?placedMatch(fallback,'ancestor-unique-wording'):unresolved('target_not_found');
    }
    if(sub.reason)return unresolved(sub.reason);
    if(bound)return placedMatch(sub,'subparagraph-wording-match');
    evidence.push({basis:'subparagraph-wording-match',anchor:sub.unit.id});
    return {operation,status:'placed',itemIndex:sub.itemIndex,span:sub.match.span,splice:sub.match.splice,originalText:sub.match.originalText,evidence};
  }
  if(candidates.length>1&&new Set(candidates.map(c=>c.itemIndex+'|'+parentKey(c.unit))).size!==1)return unresolved('multiple_published_targets');
  const adaptedOriginal=candidate=>{
    const {proposal,unit}=candidate;
    const notes=footnoteBody(proposal,unit,originalText,originalFormatting,{operation,language,baseline});
    if(notes)return notes;
    if(candidates.length!==1||unit.pathConflict||!completeBoundary(proposal,unit))return originalText;
    const text=unitText(proposal,unit).text;
    const row=proposal.paragraphs[unit.extent.start];
    if(baseline==='council-position'&&proposal.sourceKind==='pdf'&&operation==='replace'&&sole?.kind==='recital'&&unit.kind==='recital'&&unit.extent.end===unit.extent.start+1&&row.complete&&row.source?.complete===true&&row.source.role==='/P'&&row.properties?.annotationsComplete===true&&!row.objects.length&&!(proposal.anchors??[]).some(a=>a.paragraph===row.index)&&!(proposal.links??[]).some(l=>l.paragraph===row.index)&&singleAlphabeticWordDifference(text,originalText)){
      wordDifferenceUnits.add(unit);return text;
    }
    // A printed “1.” can address the article's sole unnumbered paragraph.
    // Retain every word and require its complete, single native body row.
    if(baseline==='commission-proposal'&&language==='en'&&operation==='replace'&&proposal.sourceKind==='docx'&&
      target.segments.length===2&&target.segments[0].kind==='article'&&target.segments[1].kind==='paragraph'&&target.segments[1].value==='1'&&unit.kind==='paragraph'&&unit.implicit&&
      unit.extent.end===unit.extent.start+1&&unit.children.length===1&&unit.children[0].kind==='subparagraph'&&unit.children[0].children.length===0&&/^1\.\s+\S/u.test(proposedText||'')){
      const owner=flat(proposal.units).filter(u=>u.kind==='article'&&u.scope==='proposal'&&JSON.stringify(u.path)===JSON.stringify(unit.path.slice(0,-1))),row=proposal.paragraphs[unit.extent.start],next=proposal.paragraphs[unit.extent.end],old=/^1\.\s+([\s\S]+)$/u.exec(originalText);
      const clean=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
      if(!row.objects?.length&&!(proposal.anchors||[]).some(a=>a.paragraph===row.index)&&!text.includes('\uFFFC')&&owner.length===1&&owner[0].children.filter(u=>u.kind==='paragraph').length===1&&row.properties?.styleId==='Normal'&&!row.properties.numberingLabel&&row.source?.container==='body'&&row.source.complete===true&&next?.complete&&next.source?.complete===true&&next.source.container==='body'&&
        next.source.ordinal===row.source.ordinal+1&&next.source.containerPath===row.source.containerPath&&next.source.segment===row.source.segment&&old&&clean(old[1])===clean(text)&&!/^['‘“«"\d]/u.test(text.trim()))return text;
    }

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
  for(const candidate of candidates.length===1?matches:[])if(!candidate.match.span){const tolerant=similarMatch(candidate.proposal,candidate.unit,originalText)??singleWordMatch(candidate.proposal,candidate.unit,originalText);if(tolerant)candidate.match=tolerant;}
  const matching=matches.filter(candidate=>candidate.match.span&&(candidates.length===1||candidate.match.whole||uniqueDocumentWording(candidate.proposal,originalText)));
  if(matching.length!==1&&candidates.length===1&&candidates[0].unit.instruction){
    const c=candidates[0],lead=originalText.split(/\r?\n/u)[0],row=c.proposal.paragraphs[c.unit.extent.start];
    if(originalText.includes('\n')&&normal(lead)===normal(row.text)){
      const match=matchUnit(c.proposal,{...c.unit,extent:{start:row.index,end:row.index+1}},lead);
      if(match.span)return placedMatch({...c,match},'exact-instruction-line');
    }
  }
  // A resolved address with different wording is a conflict, even when a
  // unique passage occurs elsewhere in its ancestor. Repair numbering first.
  if(matching.length!==1&&!bound){const numbering=wordingNumberingMatch(target,originalText,candidatesFor);if(numbering)return placedMatch(numbering,'unique-wording-numbering');}
  if(matching.length!==1)return unresolved(matches.find(c=>c.match.reason==='math_comparison_unavailable')?'math_comparison_unavailable':matches.find(c=>c.match.reason==='source_structure_unavailable')?'source_structure_unavailable':'conflicting_target_evidence');
  const selected=matching[0];
  if(wordDifferenceUnits.has(selected.unit))return placedMatch(selected,'one-alphabetic-word-original-difference');
  if(candidates.length===1&&selected.unit.pathConflict&&!uniqueDocumentWording(selected.proposal,originalText))return unresolved('multiple_published_targets');
  if(bound)return placedMatch(selected,'normalised-original-match');
  evidence.push({basis:selected.match.singleWord?'single-word-original-difference':selected.match.similarity!==undefined?'unique-similar-original':candidates.length>1?'unique-duplicate-wording-match':'normalised-original-match',anchor:selected.unit.id,...(selected.match.similarity!==undefined?{matchKind:'similar',similarity:selected.match.similarity}:{})});
  return {operation,status:'placed',itemIndex:selected.itemIndex,span:selected.match.span,splice:selected.match.splice,originalText:selected.match.originalText,evidence};
}

// A new child under an absent Na occupies the same N/N+1 boundary as Na.
// This places the amendment independently; it does not synthesize parent text.
function newParentChildInsertion(items,target,candidatesFor,eligible) {
  const path=target.segments,parent=path.at(-2),child=path.at(-1);
  if(!parent||!child?.isNew||parent.suffix!=='a'||!/^\d+a$/u.test(parent.value)||!['article','point'].includes(parent.kind)||!['paragraph','point'].includes(child.kind)||candidatesFor(path.slice(0,-1)).length)return null;
  const basePath=[...path.slice(0,-2),{...parent,value:String(parent.number),suffix:'',isNew:false}],nextPath=[...path.slice(0,-2),{...parent,value:String(parent.number+1),base:String(parent.number+1),number:parent.number+1,suffix:'',isNew:false}];
  const bases=candidatesFor(basePath),next=candidatesFor(nextPath);
  if(bases.length!==1||next.length!==1||bases[0].itemIndex!==next[0].itemIndex||bases[0].unit.pathConflict||next[0].unit.pathConflict)return null;
  const a=bases[0],b=next[0];
  if(a.unit.extent.end!==b.unit.extent.start||!completeBoundary(a.proposal,a.unit)||!completeBoundary(b.proposal,b.unit))return null;
  const rows=a.proposal.paragraphs.slice(a.unit.extent.start,b.unit.extent.start+1);
  if(rows.some((row,i)=>row.source?.container!=='body'||row.source?.complete===false||!row.complete||i&&(row.source.ordinal!==rows[i-1].source.ordinal+1||row.source.containerPath!==rows[i-1].source.containerPath||row.source.segment!==rows[i-1].source.segment)))return null;
  const synthetic={...target,segments:[...path.slice(0,-2),{...parent,isNew:true}]};
  const insertion=insertionPlacement(items,synthetic,candidatesFor,eligible);
  if(insertion.reason||insertion.itemIndex!==a.itemIndex||insertion.insertBefore!==b.unit.extent.start)return null;
  return {...insertion,basis:'new-parent-child-boundary'};
}

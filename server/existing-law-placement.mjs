import {existingLawReference} from './existing-law-baseline.mjs';
import {parseTargetLabel,proposalCandidates,normaliseForMatching} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';

const exactKey=text=>normaliseForMatching(text,{stripNumbering:false,stripTerminators:false}).replace(/\s+/gu,' ').trim().replace(/[.;’”'"]+$/u,'').trim();
const prefixless=(text,unit)=>unit.label?.prefix&&text.startsWith(unit.label.prefix)?text.slice(unit.label.prefix.length):text;

export function existingLawReplacement(text,language) {
  if(typeof text!=='string')return null;
  // ETS AM13 separates two closing quotes with a semicolon. Neither the
  // normative ending nor the wrapper boundary can be established from it.
  if(/[’”"'][;.]+\s*[’”"']\s*[;.]*\s*$/u.test(text))return null;
  // Keep the published wrapper and its replacement as exact separate slices.
  // Polish committee lists sometimes omit the opening quotation mark.
  const instruction=language==='en'?/[^\n]*(?:is|are) replaced by the following:\s*\n/u:language==='pl'?/[^\n]*otrzymuje brzmienie:\s*\n/u:null;
  const match=instruction?.exec(text);
  if(!match)return null;
  let start=match.index+match[0].length,end=text.length;
  while(/\s/u.test(text[start]||'')&&start<end)start++;
  if(/[‘“"„]/u.test(text[start]||''))start++;
  const tail=/[’”"]\s*(?:["’”])?\s*[;.]*\s*$/u.exec(text.slice(start));
  if(tail)end=start+tail.index;
  while(end>start&&/\s/u.test(text[end-1]))end--;
  if(start>=end)return null;
  return {text:text.slice(start,end),start,end,instruction:text.slice(0,start),closing:text.slice(end)};
}
export function resolveExistingLawPlacement(items,chosen,baseline) {
  const unresolved=reason=>({operation:amendmentOperation(chosen),status:'unresolved',reason,evidence:[]});
  const mixedScope=amendmentMixedLanguageScope(chosen),scope=amendmentLanguageScope(chosen);
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  if(scope)return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...scope}]};
  const identity=existingLawReference(chosen);
  if(identity.status!=='resolved')return unresolved(identity.gaps[0]);
  if(baseline?.status!=='available'||baseline.baseCelex!==identity.baseCelex||baseline.amendmentDate!==identity.amendmentDate||baseline.language!==chosen.language)return unresolved(baseline?.gaps?.[0]||'existing-law-baseline-unavailable');
  let target;try{target=parseTargetLabel(identity.target,chosen.language);}catch{return unresolved('existing-law-target-unavailable');}
  if(!target.complete||target.segments[0]?.kind!=='article'||target.segments.some(s=>s.isNew))return unresolved('existing-law-target-unavailable');
  const replacement=existingLawReplacement(chosen.proposedText,chosen.language);
  if(!replacement||!chosen.originalText?.trim())return unresolved('existing-law-operation-unavailable');
  const addressed=target.segments.at(-1)?.kind==='subparagraph'?{...target,segments:target.segments.slice(0,-1)}:target;
  const candidates=items.flatMap(item=>proposalCandidates(item.proposal,addressed));
  if(candidates.length!==1)return unresolved('existing-law-target-unavailable');
  if(items.some(item=>item.proposal.identity?.work!==baseline.workId||item.proposal.identity?.celex!==baseline.celex))return unresolved('existing-law-version-conflict');
  let result=resolveProposalPlacement(items,{...chosen,targetLabel:identity.target,targetPath:{proposal:[{raw:identity.target}]},proposedText:replacement.text});
  const unit=candidates[0],itemIndex=items.findIndex(item=>proposalCandidates(item.proposal,addressed).includes(unit)),proposal=items[itemIndex].proposal;
  const source=proposal.paragraphs.slice(unit.extent.start,unit.extent.end).map(p=>p.text).join('\n');
  // A comparison cell can join two source list points on one line (INSPIRE
  // AM15). Compare all their labels and internal punctuation without removing
  // per-line terminators; only an enclosing boundary and typography may differ.
  if(result.status!=='placed'&&target.segments.at(-1)?.kind!=='subparagraph'&&unit.complete&&exactKey(source)===exactKey(chosen.originalText))result={operation:'replace',status:'placed',itemIndex,span:{start:unit.extent.start,end:unit.extent.end-1},splice:{start:{paragraph:unit.extent.start,offset:0},end:{paragraph:unit.extent.end-1,offset:proposal.paragraphs[unit.extent.end-1].text.length}},originalText:source,evidence:[{basis:'existing-law-exact-original',anchor:unit.id}]};
  if(result.status!=='placed')return result;
  if(exactKey(result.originalText)!==exactKey(chosen.originalText)&&exactKey(prefixless(result.originalText,unit))!==exactKey(chosen.originalText))return unresolved('existing-law-wording-conflict');
  // AM55 quotes only the end of Article 8 while instructing replacement of the
  // whole article. A partial quotation cannot define that replacement's extent.
  if(target.segments.length===1&&/\bArticle\s+\d+\w*\s+is replaced/u.test(replacement.instruction)) {
    const first=unit.children[0]?.extent.start;
    if(first==null||result.splice.start.paragraph!==first||result.splice.start.offset!==0||result.splice.end.paragraph!==unit.extent.end-1||result.splice.end.offset!==items[result.itemIndex].proposal.paragraphs[unit.extent.end-1].text.length)return unresolved('existing-law-instruction-scope-conflict');
  }
  let outerOperation=null;try{outerOperation=parseTargetLabel(chosen.targetPath?.proposal?.[0]?.raw||chosen.targetLabel,chosen.language).segments.at(-1)?.isNew?'insert':null;}catch{/* Keep unknown outer operations explicit. */}
  return {...result,proposedText:replacement.text,proposedRange:{start:replacement.start,end:replacement.end},instruction:replacement.instruction,closing:replacement.closing,outerOperation,evidence:[...result.evidence,{basis:'existing-law-version',anchor:baseline.celex},{basis:'existing-law-target',label:identity.target}]};
}

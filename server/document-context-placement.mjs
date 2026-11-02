import {amendmentRejection} from './amendment-rejection.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {resolveAmendmentPlacement,amendmentOperation,resolutionReference} from './document-context-model.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {resolveExistingLawPlacement} from './existing-law-placement.mjs';
import {parseTargetLabel} from './proposal-labels.mjs';

// A present-text amendment that adds a new amending instruction is located by
// the proposal's instruction label; building the consolidated law is separate.
// The proposed column must open with that instruction's own printed number.
export function proposalInstructionTarget(chosen) {
  if(chosen?.baseline!=='present-text'||!chosen.proposedText||typeof chosen.language!=='string')return null;
  const paths=chosen.targetPath?.proposal;
  if(paths?.length>1||(chosen.targetPath?.language??chosen.targetLabelLanguage)!==chosen.language)return null;
  // Lists often print the proposal line only as the label's first line.
  const raw=paths?.length?paths[0].raw:typeof chosen.targetLabel==='string'?chosen.targetLabel.split('\n')[0].trim():'';
  if(!raw||raw.includes(' — ')||(chosen.targetPath?.underlying||[]).some(path=>path.raw===raw))return null;
  let target;try{target=parseTargetLabel(raw,chosen.language);}catch{return null;}
  const label=target.segments.at(-1);
  if(!target.complete||target.segments[0]?.kind!=='article'||!label||!['point','article'].includes(label.kind)||!(label.isNew||label.negative))return null;
  // Outer-level instructions only: a new article, or a new point directly
  // under the amending paragraph. Nested points stay withheld.
  const [article,paragraph]=target.segments;
  if(!(target.segments.length===1&&label.kind==='article'||target.segments.length===3&&article.kind==='article'&&paragraph.kind==='paragraph'&&label.kind==='point'))return null;
  const printed=label.kind==='article'?new RegExp(`^(?:Article|Artykuł)\\s+${label.value.replace(/^(\d+)([a-z]+)$/u,'$1\\s*$2')}(?![ \\t]*[\\p{L}\\p{N}])`,'u')
    :new RegExp(`^\\(?${label.value.replace(/^(-?\d+)([a-z]+)$/u,'$1\\s*$2')}\\)`,'u');
  return printed.test(chosen.proposedText.trim())?{raw,label}:null;
}
function proposalInstructionPlacement(items,chosen) {
  const target=proposalInstructionTarget(chosen);
  if(!target||!items?.length)return null;
  const placement=resolveProposalPlacement(items,{...chosen,originalText:'',originalFormatting:undefined,targetLabel:target.raw,targetPath:{...chosen.targetPath,proposal:[{raw:target.raw}],underlying:[]}});
  if(placement.status!=='placed'||placement.operation!=='insert')return null;
  return {...placement,frame:'commission-proposal',evidence:[{basis:'proposal-instruction-frame',label:target.raw},...placement.evidence]};
}

/** Pure final placement selection shared by the endpoint and offline consumers.
 * Source acquisition, identity checks and proposal parsing belong to the caller. */
export function documentContextPlacement({chosen,text,items,baseline,proposalItems=null,referenceTexts=[],resolutionDocument=false,includeBody=true,amendmentRequested=true}={}) {
  if(!includeBody)return null;
  const unresolved=reason=>({operation:amendmentOperation(chosen||{}),status:'unresolved',reason,evidence:[]});
  if(!chosen)return amendmentRequested?unresolved(referenceTexts.length>1?'conflicting_target_evidence':'amendment_wording_unavailable'):null;
  const rejection=amendmentRejection(chosen);
  if(rejection)return rejection;
  const mixedScope=amendmentMixedLanguageScope(chosen),scope=amendmentLanguageScope(chosen);
  if(scope&&text?.paragraphs?.length&&text.textLanguage&&scope.language!==text.textLanguage)return unresolved('different_text_languages');
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  if(scope)return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...scope}]};
  if(chosen.baselineSource?.conflicted===true)return unresolved('conflicting_baselines');
  if(chosen.baseline==='present-text'&&chosen.baselineSource?.category==='present-text'&&chosen.baselineSource.conflicted===false) {
    const existing=items?.length||baseline?resolveExistingLawPlacement(items||[],chosen,baseline):null;
    if(existing?.status==='placed')return existing;
    // Only when the consolidated law cannot place it, and only in the proposal.
    const framed=proposalInstructionPlacement(proposalItems,chosen);
    if(framed)return framed;
    if(existing)return existing;
  }
  const council=chosen.baseline==='council-position';
  const proposalKind=['commission-proposal','council-position'].includes(chosen.baseline)&&chosen.baselineSource?.category===chosen.baseline&&chosen.baselineSource.conflicted===false;
  const consultation=chosen.baseline==='commission-proposal'&&(chosen.documentReferences||[]).some(r=>(r.field==='DocRef'||/^DocAmend\d?$/.test(r.field))&&/\b\d{4}\/\d{4}\s*\(CNS\)/u.test(r.raw||''));
  const nle=chosen.baseline==='commission-proposal'&&baseline?.evidence?.some(e=>e.kind==='native-procedure'&&e.status==='verified'&&/\(NLE\)$/u.test(e.procedure));
  // Native CNS/NLE source support covers the provision body. A separated note payload
  // has another legal scope; keep it readable without claiming its placement.
  if(proposalKind&&(consultation||nle)&&[chosen.originalText,chosen.proposedText].some(text=>typeof text==='string'&&/(?:^|\n)_{3,}[ \t]*(?:\n|$)/u.test(text)))return unresolved('proposal_note_scope_unavailable');
  if(proposalKind&&nle&&baseline.evidence.some(e=>e.kind==='native-nle-annex-part'&&e.ordinal===null&&e.legalPlacement===false)&&/\bAnnex\b/iu.test(chosen.targetLabel||''))return unresolved('proposal_annex_ordinal_unverified');
  if(proposalKind)return items?.length&&chosen.language&&(chosen.targetPath?.language??chosen.targetLabelLanguage)===chosen.language
    ?resolveProposalPlacement(items,chosen):unresolved(items?.length?'different_text_languages':council?'council_position_unavailable':'proposal_baseline_unavailable');
  // Only parsed, same-language vote references are location evidence; the rest stay in provenance.
  const comparable=referenceTexts.filter(reference=>resolutionReference(reference,chosen.language));
  let placement=['present-text','council-position'].includes(chosen.baseline)
    ?unresolved(chosen.baseline==='present-text'?'amends_existing_law':'council_position_unavailable')
    :resolveAmendmentPlacement(text,{...chosen,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined,referenceText:comparable[0],resolutionDocument});
  if(comparable.length>1){placement={...placement,status:'unresolved',reason:'conflicting_target_evidence'};delete placement.span;delete placement.insertAfter;delete placement.insertBefore;}
  return placement;
}

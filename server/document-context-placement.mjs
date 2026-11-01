import {amendmentRejection} from './amendment-rejection.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {resolveAmendmentPlacement,amendmentOperation,resolutionReference} from './document-context-model.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {resolveExistingLawPlacement} from './existing-law-placement.mjs';

/** Pure final placement selection shared by the endpoint and offline consumers.
 * Source acquisition, identity checks and proposal parsing belong to the caller. */
export function documentContextPlacement({chosen,text,items,baseline,referenceTexts=[],resolutionDocument=false,includeBody=true,amendmentRequested=true}={}) {
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
  if(chosen.baseline==='present-text'&&chosen.baselineSource?.category==='present-text'&&chosen.baselineSource.conflicted===false&&(items?.length||baseline))return resolveExistingLawPlacement(items||[],chosen,baseline);
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

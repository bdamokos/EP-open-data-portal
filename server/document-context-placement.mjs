import {resolveAmendmentPlacement,amendmentOperation,resolutionReference} from './document-context-model.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

/** Pure final placement selection shared by the endpoint and offline consumers.
 * Source acquisition, identity checks and proposal parsing belong to the caller. */
export function documentContextPlacement({chosen,text,items,referenceTexts=[],resolutionDocument=false,includeBody=true,amendmentRequested=true}={}) {
  if(!includeBody)return null;
  const unresolved=reason=>({operation:amendmentOperation(chosen||{}),status:'unresolved',reason,evidence:[]});
  if(!chosen)return amendmentRequested?unresolved(referenceTexts.length>1?'conflicting_target_evidence':'amendment_wording_unavailable'):null;
  if(chosen.baselineSource?.conflicted===true)return unresolved('conflicting_baselines');
  const proposalKind=chosen.baseline==='commission-proposal'&&chosen.baselineSource?.category==='commission-proposal'&&chosen.baselineSource.conflicted===false;
  if(proposalKind)return items?.length&&chosen.language&&(chosen.targetPath?.language??chosen.targetLabelLanguage)===chosen.language
    ?resolveProposalPlacement(items,chosen):unresolved(items?.length?'different_text_languages':'proposal_baseline_unavailable');
  // Only parsed, same-language vote references are location evidence; the rest stay in provenance.
  const comparable=referenceTexts.filter(reference=>resolutionReference(reference,chosen.language));
  let placement=['present-text','council-position'].includes(chosen.baseline)
    ?unresolved(chosen.baseline==='present-text'?'amends_existing_law':'council_position_unavailable')
    :resolveAmendmentPlacement(text,{...chosen,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined,referenceText:comparable[0],resolutionDocument});
  if(comparable.length>1){placement={...placement,status:'unresolved',reason:'conflicting_target_evidence'};delete placement.span;delete placement.insertAfter;delete placement.insertBefore;}
  return placement;
}

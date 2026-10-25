const contradictions=new Set(['ambiguous-result-binding','conflicting-result-source','conflicting-decision-source']);

// Missing context or wording does not contradict an exact decision reference.
// Conflicting ownership/definitions do, even when the voter arrays agree.
export function decisionVoteBindingConflict(vote) {
  return Boolean(vote.bindingConflicts?.length)||vote.resultRelationship?.binding==='ambiguous'||new Set([...(vote.resultRelationship?.inverseResultIds||[]),...(vote.resultRelationship?.forwardResultIds||[])]).size>1||(vote.evidenceGaps||[]).some(gap=>
    contradictions.has(gap.code)||gap.code==='invalid-reference'&&gap.field==='inverse_consists_of'||
    gap.code==='ambiguous-component'&&gap.details?.some(detail=>detail.code==='conflicting-component-definition'));
}

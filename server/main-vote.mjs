const labels=new Set(['Commission proposal','Commission proposal and amendments','Commission proposal to the Council','Motion for a resolution','Motion for a resolution (as a whole)','Proposal for a decision','Draft legislative act','Provisional agreement']);
const notHeld=new Set(['LAPSED','WITHDRAWN','CANCELLED','CANCELED','NOT_HELD']);
const eligible=decision=>decision&&decision.ballotStatus!=='not-conducted'&&!notHeld.has(decision.outcome);

/** Select from the supplied source order, without changing scope or inferring
 * from titles or tallies. Fallback decisions must belong to this exact subject.
 */
export function mainVote(decisions=[],subject) {
  if(!subject)return null;
  const whole=(subject.wholeTextDecisions||[]).filter(eligible).at(-1);
  if(whole)return decisions.find(decision=>decision.id===whole.id)??whole;
  return decisions.filter(decision=>subject.id&&decision.subjectId===subject.id&&eligible(decision)&&decision.ballotStatus==='conducted'&&labels.has(decision.referenceTexts?.en?.trim())).at(-1)??null;
}

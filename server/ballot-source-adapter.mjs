export function ballotVotingLists(store,sittingId) {return store?.votingListsForSitting?.(sittingId)||[];}
export function ballotScheduledFor(amendment,agendaItemId,sittingId) {
  return [amendment.scheduledVote,...(amendment.scheduledVotes||[])].some(v=>v?.agendaItemId===agendaItemId&&v.sittingId===sittingId);
}

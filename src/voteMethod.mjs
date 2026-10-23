const labels=Object.freeze({
  VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',
  VOTE_HAND:'Show of hands',
  VOTE_ELECTRONIC:'Electronic vote (names not recorded)',
  VOTE_SECRET:'Secret ballot',
  VOTE_SECRET_BALLOT:'Secret ballot',
});
export const knownVoteMethodLabel=method=>Object.hasOwn(labels,method)?labels[method]:null;
export const voteMethodLabel=method=>knownVoteMethodLabel(method)||'Voting method unavailable';

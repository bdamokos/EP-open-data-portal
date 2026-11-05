// The text a vote item decided on, from exact document links only: a vote's
// decided-on references name either the text itself or one of its amendments
// (<text>-AM-<n>), so the text voted on is the item document those links point at most often.
export function votedDocumentId(votes,documentIds) {
  const counts=new Map();
  for(const vote of votes||[])for(const id of vote.decidedDocumentIds||[]) {
    const text=id.replace(/-AM-\d+(?:-\d+)?$/,'');
    if(documentIds.includes(text))counts.set(text,(counts.get(text)||0)+1);
  }
  let best=null;
  for(const id of documentIds)if(counts.has(id)&&(best===null||counts.get(id)>counts.get(best)))best=id;
  return best;
}

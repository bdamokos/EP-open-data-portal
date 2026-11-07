// The ledger may show one counted sibling under its own published label when
// at most three decisions belong to the item. Otherwise preserve all outcomes.
export const countedTotals=totals=>totals&&['for','against','abstaining'].every(key=>Number.isSafeInteger(totals[key])&&totals[key]>=0);
export const summaryVote=vote=>({id:vote.id,label:vote.title,outcome:vote.outcome,method:vote.method,totals:vote.totals});
export function itemVoteSummary(rows,main) {
  if(main)return null;
  const counted=rows.filter(row=>countedTotals(row.totals));
  const single=rows.length<=3&&counted.length===1?counted[0]:rows.length===1?rows[0]:null;
  if(single)return {kind:'single',vote:summaryVote(single)};
  const counts={kind:'counts',adopted:0,rejected:0,lapsed:0,unknown:0};
  for(const row of rows)counts[({ADOPTED:'adopted',REJECTED:'rejected',LAPSED:'lapsed'})[row.outcome]||'unknown']++;
  return counts;
}

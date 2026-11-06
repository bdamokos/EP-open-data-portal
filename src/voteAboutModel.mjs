// The official summary of an item can quote the tally of one decision (usually the vote on the whole text).
// The page ties that figure to a decision only by exact identifiers; without a tie the figure is left out,
// and a tie to another vote than the one shown is stated as belonging to the whole text.

// "T10-0361/2026" is the text adopted TA-10-2026-0361.
export function textAdoptedId(reference) {
  const match=/^T(\d+)-(\d{4})\/(\d{4})$/.exec(String(reference||'').trim());
  return match?`TA-${match[1]}-${match[3]}-${match[2]}`:null;
}
// The one vote whose decided-on link names the summary's adopted text; no link, or several, name none.
export function quotedVote(votes,documentReference) {
  const id=textAdoptedId(documentReference);
  if(!id)return null;
  const hits=(votes||[]).filter(vote=>(vote.decidedDocumentIds||[]).includes(id));
  return hits.length===1?hits[0]:null;
}
const count='\\d+(?:[.,]\\d{3})*';
const tally=new RegExp('\\s*\\bby '+count+' votes? to '+count+'(?:,? with '+count+' abstentions?)?,?','i');
export function withoutTally(text) {
  return String(text).replace(tally,'').replace(/\s{2,}/g,' ');
}
// What the About block shows: the blocks (without the quoted figure unless it is tied to a vote) and, when
// that vote is not the one being viewed, the vote to point to.
export function aboutContent({blocks,votes,viewedId,documentReference}) {
  const quoted=quotedVote(votes,documentReference);
  if(!quoted)return {blocks:blocks.map(block=>({...block,text:withoutTally(block.text)})),whole:null};
  return {blocks,whole:quoted.id===viewedId?null:quoted};
}

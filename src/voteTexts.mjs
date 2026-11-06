// Picker entries: the vote's own subject, with the split part where the source's
// decided-on link names one (…-SPLIT-<group>-<part>), and an ordinal only for
// entries that would otherwise read the same. Parts are never guessed.
export function voteOptionParts(votes) {
  const rows=votes.map(vote=>{
    const subject=vote.subject||vote.title;
    const part=(vote.decidedDocumentIds||[]).map(id=>id.match(/-SPLIT-\d+-(\d+)$/)?.[1]).find(Boolean);
    const text=part&&!/\/\d+\s*$/.test(subject)?subject+'/'+part:subject;
    return {id:vote.id,text,key:[vote.scope,text,vote.method].join('|')};
  });
  const groups=new Map();
  for(const row of rows)groups.set(row.key,[...(groups.get(row.key)||[]),row.id]);
  return new Map(rows.map(row=>{const same=groups.get(row.key);return [row.id,{text:row.text,ordinal:same.length>1?{number:same.indexOf(row.id)+1,count:same.length}:null}];}));
}

// "Vote N of M" only for a vote that is in the list; a stale or unknown id has no position.
export function votePosition(votes,id) {
  const index=votes.findIndex(vote=>vote.id===id);
  return index<0?null:{number:index+1,count:votes.length};
}

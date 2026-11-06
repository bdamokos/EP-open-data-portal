// Competition ranks keep every tie at the fifth rank. Input rows are facts,
// never reader-facing prose. Each list contains one entry per exact identity.
export function rankFacts(rows,value,{descending=false}={}) {
  const sorted=rows.slice().sort((a,b)=>(descending?-1:1)*(value(a)-value(b))||a.key.localeCompare(b.key));
  const seen=new Set(),unique=sorted.filter(row=>{if(seen.has(row.key))return false;seen.add(row.key);return true;});
  let previous,rank=0;
  return unique.map((row,index)=>{const score=value(row);if(score!==previous)rank=index+1;previous=score;return {...row,rank};});
}
export function storyLists({votes=[],speeches=[],blueCards=[],completeVotes=true}) {
  return {
    closest:completeVotes?rankFacts(votes,v=>Math.abs(v.totals.for-v.totals.against)):[],
    differing:completeVotes?rankFacts(votes.filter(v=>Number.isInteger(v.differing)),v=>v.differing,{descending:true}):[],
    speeches:rankFacts(speeches,v=>v.speeches,{descending:true}),
    blueCards:rankFacts(blueCards,v=>v.blueCards,{descending:true}),
  };
}
export function selectWeekStory(lists,{pressByKey=new Map(),voteByKey=new Map(),completeVotes=true}={}) {
  const candidates=new Map();
  if(completeVotes)for(const [list,rows] of Object.entries(lists))for(const row of rows.filter(r=>r.rank<=5)) {
    if(!pressByKey.has(row.key)||!row.linked)continue;
    const entry=candidates.get(row.key)||{key:row.key,item:row,reasons:[]};
    entry.reasons.push({list,rank:row.rank,value:list==='closest'?Math.abs(row.totals.for-row.totals.against):row[list]});candidates.set(row.key,entry);
  }
  const stories=[...candidates.values()].sort((a,b)=>b.reasons.length-a.reasons.length||Math.min(...a.reasons.map(r=>r.rank))-Math.min(...b.reasons.map(r=>r.rank))||a.key.localeCompare(b.key)).map(row=>({...row,press:pressByKey.get(row.key),vote:voteByKey.get(row.key)||null}));
  const storyKeys=new Set(stories.map(row=>row.key)),shown=new Set(storyKeys),highlights=[];
  for(const [list,rows] of Object.entries(lists))for(const row of rows.filter(r=>r.rank===1))if(!storyKeys.has(row.key)){highlights.push({...row,list});shown.add(row.key);}
  const rejected=lists.closest.find(row=>row.outcome==='REJECTED'&&!shown.has(row.key));
  if(rejected)highlights.push({...rejected,list:'rejected'});
  return {stories,highlights};
}
// Exact substrings only. A heading with no terminal punctuation adds nothing.
export function pressExcerpt(release) {
  const lead=(release.lead||'').trim(),paragraph=release.paragraphs?.[1]||'';
  const ends=/[.!?](?:[”’"']?)(?=\s|$)/g;let match;
  while((match=ends.exec(paragraph))) {
    const prefix=paragraph.slice(0,match.index+1);
    if(/\b(?:Mr|Dr|No|Art|e\.g|i\.e)\.$/i.test(prefix))continue;
    return {lead,sentence:paragraph.slice(0,ends.lastIndex)};
  }
  return {lead,sentence:null};
}

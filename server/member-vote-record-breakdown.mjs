// Evidence thresholds for the breakdown, in one place. Every amendment, paragraph
// and split is its own vote, so a count of votes alone overstates the evidence:
// twenty votes can come from a single text. A row therefore also needs several
// distinct procedures, and it is shown only when it is clearly below the
// member's own overall share in the same scope.
export const BREAKDOWN={minVotes:20,minProcedures:3,margin:0.05,rows:5};
// Procedures are counted by their base number: 2025-0810 and 2025-0810R are one file,
// and one file's many amendment votes are exactly what the rule guards against.
export const baseProcedure=id=>String(id).replace(/[A-Z]+$/,'');

// rows: one {vector,tags} per sitting the member has a row in. The vector has one
// mark per named decision (w with, a against, b abstained, n not comparable;
// capitals are whole-text votes, '-' no ballot) and tags has one
// [decisionId, procedures, microthesaurusIds, countryIds] entry per decision.
// Abstentions and uncomparable votes are not comparable votes. A vote without
// a tag counts towards the overall share only.
export function memberBreakdown(rows,scope='all') {
  const lists={topic:new Map(),country:new Map()};
  const decisionTags=new Map();
  let withGroup=0,against=0;
  for(const {vector,tags} of rows) {
    for(let index=0;index<vector.length;index++) {
      const mark=vector[index];
      if(scope==='final'&&mark!==mark.toUpperCase())continue;
      const kind=mark.toLowerCase();
      if(kind!=='w'&&kind!=='a')continue;
      if(kind==='w')withGroup++;else against++;
      const entry=tags[index];if(!entry)continue;
      const [decisionId,procedures,micro,countries]=entry;
      decisionTags.set(decisionId,[...micro.map(id=>'topic:'+id),...countries.map(id=>'country:'+id)]);
      for(const [map,keys] of [[lists.topic,micro.map(id=>'topic:'+id)],[lists.country,countries.map(id=>'country:'+id)]])
        for(const key of keys) {
          const row=map.get(key)||{key,withGroup:0,against:0,procedures:new Set()};
          if(kind==='w')row.withGroup++;else row.against++;
          for(const procedure of procedures)row.procedures.add(baseProcedure(procedure));
          map.set(key,row);
        }
    }
  }
  const comparable=withGroup+against,overall=comparable?withGroup/comparable:null;
  const pick=map=>{
    const eligible=[...map.values()].filter(row=>row.withGroup+row.against>=BREAKDOWN.minVotes&&row.procedures.size>=BREAKDOWN.minProcedures)
      .map(row=>({key:row.key,comparable:row.withGroup+row.against,withGroup:row.withGroup,share:row.withGroup/(row.withGroup+row.against)}));
    const rowsBelow=overall===null?[]:eligible.filter(row=>overall-row.share>=BREAKDOWN.margin-1e-9)
      .sort((a,b)=>a.share-b.share||b.comparable-a.comparable||(a.key<b.key?-1:1)).slice(0,BREAKDOWN.rows);
    return {eligible:eligible.length,rows:rowsBelow};
  };
  return {overall,topics:pick(lists.topic),countries:pick(lists.country),decisionTags};
}

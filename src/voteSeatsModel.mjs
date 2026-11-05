import {filterCountry} from './countries.mjs';
import {groupMajorities} from './voteGroupMetrics.mjs';

const positions=['for','against','abstaining'];

// A seat shows the recorded position of the Member who holds it. The join is by
// exact person identifier only; voters without a seat in the plan stay visible
// as dots below the chart, so the drawn marks keep adding up to the votes.
export function seatBallots(voters,seats) {
  const seatByMember=new Map();
  for(const seat of seats)if(seat.member!==undefined&&seat.member!==null&&!seatByMember.has(String(seat.member)))seatByMember.set(String(seat.member),seat);
  const bySeat=new Map(),unseated=[];
  for(const voter of voters) {
    if(!positions.includes(voter.position))continue;
    const seat=seatByMember.get(String(voter.id));
    if(seat)bySeat.set(seat.seat,{id:String(voter.id),position:voter.position});
    else unseated.push({id:String(voter.id),position:voter.position});
  }
  return {bySeat,unseated};
}

export function positionTotals(voters) {
  const totals={for:0,against:0,abstaining:0};
  for(const voter of voters)if(positions.includes(voter.position))totals[voter.position]++;
  return totals;
}

export function unseatedDotTotals(voters,seats) {
  return positionTotals(seatBallots(voters,seats).unseated);
}

// The same rule as differentFromMajority: a voter differs when their group has a
// majority position and they recorded another one. Groups without a majority and
// groups outside the metrics (NI, unavailable) never differ.
export function differingVoterIds(rows) {
  const majorities=new Map(groupMajorities(rows).map(group=>[group.code,group.majority]));
  const ids=new Set();
  for(const row of rows)if(row.id&&row.position&&majorities.get(row.group)&&row.position!==majorities.get(row.group))ids.add(String(row.id));
  return ids;
}

// Countries as rows and political groups as columns. Each cell holds the count
// of the group's most common position in that country; a tied most common
// position keeps its tied counts so a shaded single position is never invented.
// A country or group with no ballots stays present with a null cell, never 0.
export function countryGroupBreakdown(rows) {
  const countries=new Map(),groups=new Set();
  for(const row of rows) {
    if(!row.country||!positions.includes(row.position)||!row.group)continue;
    const code=filterCountry(row.country);
    if(!countries.has(code))countries.set(code,{country:code,counts:{for:0,against:0,abstaining:0},groups:new Map()});
    const country=countries.get(code);
    country.counts[row.position]++;
    if(!country.groups.has(row.group))country.groups.set(row.group,{for:0,against:0,abstaining:0});
    country.groups.get(row.group)[row.position]++;
    groups.add(row.group);
  }
  const cell=counts=>{
    const ranked=[...positions].sort((a,b)=>counts[b]-counts[a]);
    if(!counts[ranked[0]])return {position:null,count:0,tied:null};
    if(counts[ranked[0]]===counts[ranked[1]])return {position:null,count:counts[ranked[0]],tied:ranked.filter(position=>counts[position]===counts[ranked[0]])};
    return {position:ranked[0],count:counts[ranked[0]],tied:null};
  };
  return [...countries.values()].map(country=>{
    const cells=new Map();
    for(const [group,counts] of country.groups)cells.set(group,cell(counts));
    return {...country,cells};
  });
}

// One URL parameter carries the matrix sort: '' is the protocol country order,
// otherwise `country:asc`, `group:CODE` or `group:CODE:asc`. Unknown values
// decode to null and the interface falls back to the default order.
export function encodeMatrixSort(sort) {
  if(!sort||sort.kind==='country'&&sort.dir==='asc'&&!sort.key)return '';
  const dir=sort.dir==='desc'?'desc':'asc';
  if(sort.kind==='country')return 'country:'+dir;
  if(sort.kind==='group'&&sort.key)return 'group:'+sort.key+(dir==='asc'?':asc':'');
  return '';
}
export function decodeMatrixSort(raw) {
  if(!raw)return {kind:'country',dir:'asc'};
  const parts=String(raw).split(':');
  if(parts[0]==='country'&&parts.length===2&&(parts[1]==='asc'||parts[1]==='desc'))return {kind:'country',dir:parts[1]};
  if(parts[0]==='group'&&parts.length>=2&&parts[1]) {
    if(parts.length===2)return {kind:'group',key:parts[1],dir:'desc'};
    if(parts.length===3&&(parts[2]==='asc'||parts[2]==='desc'))return {kind:'group',key:parts[1],dir:parts[2]};
  }
  return null;
}

import {filterCountry} from './countries.mjs';
import {groupMajorities} from './voteGroupMetrics.mjs';

const positions=['for','against','abstaining'];

// The same rule as differentFromMajority: a voter differs when their group has a
// majority position and they recorded another one. Groups without a majority and
// groups outside the metrics (NI, unavailable) never differ.
export function differingVoterIds(rows) {
  const majorities=new Map(groupMajorities(rows).map(group=>[group.code,group.majority]));
  const ids=new Set();
  for(const row of rows)if(row.id&&row.position&&majorities.get(row.group)&&row.position!==majorities.get(row.group))ids.add(String(row.id));
  return ids;
}

// One tally per country of election, every recorded ballot counted. Greece uses the EU identifier EL.
// A country appears only when one of its members cast a ballot, so a missing country is never a row of zeros.
export function countryTallies(rows) {
  const tallies=new Map();
  for(const row of rows) {
    if(!row.country||!positions.includes(row.position))continue;
    const code=filterCountry(row.country);
    if(!tallies.has(code))tallies.set(code,{country:code,counts:{for:0,against:0,abstaining:0},ballots:0});
    const entry=tallies.get(code);entry.counts[row.position]++;entry.ballots++;
  }
  return [...tallies.values()];
}
// The country list's orders. The default ('' in the address) is `share`: countries by the winning side's share,
// so the side that won leads. Each order has a natural direction (share: winners first; name: A to Z; counts:
// most first); `-rev` reverses it, so the address holds `for`, `against-rev`, `name` and so on.
export const countryOrderKeys=Object.freeze(['share','name','for','against','abstain']);
export function decodeCountryOrder(raw) {
  const match=/^(share|name|for|against|abstain)(-rev)?$/.exec(String(raw||''));
  return match?{key:match[1],reversed:Boolean(match[2])}:{key:'share',reversed:false};
}
export const encodeCountryOrder=order=>order.key==='share'&&!order.reversed?'':order.key+(order.reversed?'-rev':'');
// The winning side's share of the ballots that took a side. Abstentions do not count, as in Parliament's own
// count, where a text passes when For outnumbers Against. Null when nobody from the country took a side.
export function winningShare(counts,winning) {
  const decided=counts.for+counts.against;
  return decided?counts[winning]/decided:null;
}
// 'win': more of the country's ballots for the winning side than against it; 'lose': the other way;
// 'split': as many on each side, or abstentions only.
export function countrySide(counts,winning) {
  const share=winningShare(counts,winning);
  return share===null||share===.5?'split':share>.5?'win':'lose';
}
const countColumn={for:'for',against:'against',abstain:'abstaining'};
const sideRank={win:0,split:1,lose:2};
// The list in the chosen order. Share order groups the countries by side (winning majority, split, the other
// way), then follows the bars: the winning colour shrinks down to the rule and the other colour grows after it.
// Ties keep the larger delegation first, then the name A to Z.
export function orderCountries(tallies,order,{winning,nameOf,locale}) {
  const byName=(a,b)=>nameOf(a.country).localeCompare(nameOf(b.country),locale)||a.country.localeCompare(b.country);
  const dir=order.reversed?-1:1,losing=winning==='for'?'against':'for';
  const part=(tally,position)=>tally.ballots?tally.counts[position]/tally.ballots:0;
  const byShare=(a,b)=>{
    const side=countrySide(a.counts,winning);
    return sideRank[side]-sideRank[countrySide(b.counts,winning)]
      ||(side==='lose'?part(a,losing)-part(b,losing):part(b,winning)-part(a,winning))
      ||b.ballots-a.ballots;
  };
  const compare=order.key==='name'?(a,b)=>dir*byName(a,b)
    :order.key==='share'?(a,b)=>dir*byShare(a,b)||byName(a,b)
    :(a,b)=>dir*(b.counts[countColumn[order.key]]-a.counts[countColumn[order.key]])||byName(a,b);
  return [...tallies].sort(compare);
}
// In share order, the index of the first row past the countries whose majority went the winning way
// (or, reversed, the first row of them): where the dashed rule goes. -1 when every country is on one side.
export function sideTurn(ordered,winning) {
  for(let index=1;index<ordered.length;index++) {
    const before=countrySide(ordered[index-1].counts,winning)==='win',after=countrySide(ordered[index].counts,winning)==='win';
    if(before!==after)return index;
  }
  return -1;
}

// Tight bounds of the drawn seats, so the chart has no empty margin of its own.
export function seatBounds(seats) {
  if(!seats.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const seat of seats) {
    minX=Math.min(minX,seat.x-seat.r);maxX=Math.max(maxX,seat.x+seat.r);
    minY=Math.min(minY,seat.y-seat.r);maxY=Math.max(maxY,seat.y+seat.r);
  }
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}

// The Parliament's left-to-right group order, read from the seat plan: groups sorted by the mean direction
// of their seats around the hemicycle's centre, leftmost first. Seats without a group are ignored.
export function planGroupOrder(seats) {
  const bounds=seatBounds(seats);
  if(!bounds)return [];
  const cx=(bounds.minX+bounds.maxX)/2,cy=bounds.maxY,groups=new Map();
  for(const seat of seats) {
    if(!seat.group)continue;
    const dx=seat.x-cx,dy=cy-seat.y,distance=Math.hypot(dx,dy);
    if(!distance)continue;
    const entry=groups.get(seat.group)||{ux:0,uy:0};
    entry.ux+=dx/distance;entry.uy+=dy/distance;groups.set(seat.group,entry);
  }
  return [...groups.entries()].map(([group,entry])=>({group,angle:Math.atan2(entry.uy,entry.ux)})).sort((a,b)=>b.angle-a.angle||a.group.localeCompare(b.group)).map(entry=>entry.group);
}

const UNKNOWN_GROUP='unavailable';
const NON_ATTACHED='NI';

// The table and way-line order: plan groups largest first by seats, then groups the plan lacks
// by this vote's size, then "Group unknown", with non-attached always last. Without a plan the
// vote's own counts order every group. A plan is a snapshot: it orders rows, never counts them.
export function tableGroupOrder(voteCounts,planCounts=[]) {
  const present=new Map(voteCounts),special=new Set([UNKNOWN_GROUP,NON_ATTACHED]);
  const planned=planCounts.filter(entry=>present.has(entry.group)&&!special.has(entry.group)).map(entry=>entry.group);
  const rest=[...present.keys()].filter(code=>!planned.includes(code)&&!special.has(code)).sort((a,b)=>present.get(b)-present.get(a)||a.localeCompare(b));
  return [...planned,...rest,...[UNKNOWN_GROUP,NON_ATTACHED].filter(code=>present.has(code))];
}

const insideOut=['for','abstaining','against'];
const WEDGE_GAP=.062,INNER_RATIO=.48;

// One mark per ballot on concentric rows, with an even share of the half circle cut into one wedge
// per group in `order` (groups the order lacks follow by size, an unknown group last). The rows are
// evenly spaced; each takes marks in proportion to its radius. Inside a wedge marks fill from the
// inner row out: For, then Abstain, then Against. Coordinates are px around the centre of the
// baseline, y up negative. The marks always add up to the recorded ballots.
export function groupArcLayout(ballots,{order,radius}) {
  const valid=ballots.filter(ballot=>positions.includes(ballot.position)),total=valid.length;
  if(!total||!(radius>0))return {dots:[],wedges:[],dotRadius:0,rows:0,radius,inner:0};
  const byGroup=new Map();
  for(const ballot of valid) {
    const code=ballot.group||UNKNOWN_GROUP;
    if(!byGroup.has(code))byGroup.set(code,[]);
    byGroup.get(code).push(ballot);
  }
  const known=order.filter(code=>byGroup.has(code)),rest=[...byGroup.keys()].filter(code=>!order.includes(code)).sort((a,b)=>(a===UNKNOWN_GROUP)-(b===UNKNOWN_GROUP)||byGroup.get(b).length-byGroup.get(a).length||a.localeCompare(b));
  const codes=[...known,...rest],inner=radius*INNER_RATIO;
  const circle=rows=>Array.from({length:rows},(_,i)=>rows===1?radius:inner+(radius-inner)*i/(rows-1));
  // The row count whose spacing along a row best matches the spacing between rows.
  let radii=null,best=Infinity;
  for(let rows=5;rows<16;rows++) {
    const candidate=circle(rows),score=Math.abs(candidate.reduce((sum,r)=>sum+Math.PI*r,0)/total-(radius-inner)/(rows-1));
    if(score<best){best=score;radii=candidate;}
  }
  const usable=Math.PI-WEDGE_GAP*(codes.length-1),sumRadii=radii.reduce((a,b)=>a+b,0);
  const spacing=sumRadii*usable/total,rowGap=(radius-inner)/(radii.length-1);
  const exact=radii.map(r=>total*r/sumRadii),rowCounts=exact.map(Math.floor);
  let left=total-rowCounts.reduce((a,b)=>a+b,0);
  for(const [,i] of exact.map((value,i)=>[value-Math.floor(value),i]).sort((x,y)=>y[0]-x[0]||x[1]-y[1])){if(left<=0)break;rowCounts[i]++;left--;}
  const grid=radii.flatMap((r,row)=>Array.from({length:rowCounts[row]},(_,i)=>({phi:usable*(i+.5)/rowCounts[row],r,row}))).sort((a,b)=>a.phi-b.phi||a.r-b.r);
  const dots=[],wedges=[];
  let at=0;
  codes.forEach((code,w)=>{
    const members=byGroup.get(code),counts={for:0,against:0,abstaining:0};
    for(const ballot of members)counts[ballot.position]++;
    const ranked=[...members].sort((a,b)=>insideOut.indexOf(a.position)-insideOut.indexOf(b.position)||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
    const chunk=grid.slice(at,at+members.length).sort((a,b)=>a.r-b.r||a.phi-b.phi);
    at+=members.length;
    const angles=chunk.map(slot=>slot.phi+w*WEDGE_GAP);
    const own=chunk.map((slot,i)=>{
      const angle=slot.phi+w*WEDGE_GAP;
      return {id:String(ranked[i].id),group:code,position:ranked[i].position,x:-Math.cos(angle)*slot.r,y:-Math.sin(angle)*slot.r,angle,row:slot.row,radius:slot.r};
    }).sort((a,b)=>a.angle-b.angle||a.radius-b.radius);
    for(const dot of own)dots.push({...dot,index:dots.length});
    const first=Math.min(...angles),last=Math.max(...angles);
    wedges.push({group:code,count:members.length,counts,start:first,end:last,angle:(first+last)/2,known:code!==UNKNOWN_GROUP});
  });
  return {dots,wedges,dotRadius:Math.min(spacing,rowGap)*.43,rows:radii.length,radius,inner,gap:WEDGE_GAP};
}

// A mark is a few pixels wide on a phone, so a press picks the closest one within reach.
export function nearestDot(dots,x,y,reach) {
  let best=null,distance=Infinity;
  for(const dot of dots){const d=Math.hypot(dot.x-x,dot.y-y);if(d<distance&&d<=reach){best=dot;distance=d;}}
  return best;
}
// A label sits just outside the middle of its wedge. `align` says how far the text shifts from that point.
export function wedgeLabels(wedges,{radius,dotRadius}) {
  const reach=radius+dotRadius+8;
  return wedges.map(wedge=>{
    const cos=Math.cos(wedge.angle),sin=Math.sin(wedge.angle);
    return {group:wedge.group,x:-cos*reach,y:-sin*reach,alignX:cos<-.3?'0%':cos>.3?'-100%':'-50%',alignY:sin>.7?'-100%':'-60%'};
  });
}

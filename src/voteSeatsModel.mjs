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

// Countries as rows and political groups as columns. Each cell holds the count
// of the group's most common position in that country plus how many other ballots
// the group cast there (`other`), so a split is never hidden; a tied most common
// position keeps its tied counts so a shaded single position is never invented.
// A country or group with no ballots stays present with a null cell, never 0.
const rank=counts=>[...positions].sort((a,b)=>counts[b]-counts[a]);
// The position with strictly the most ballots; a tie for first has no majority.
export function pluralityPosition(counts) {
  const ranked=rank(counts);
  if(!counts[ranked[0]]||counts[ranked[0]]===counts[ranked[1]])return null;
  return ranked[0];
}
const cellOf=counts=>{
  const ranked=rank(counts),total=positions.reduce((sum,position)=>sum+counts[position],0);
  if(!total)return {position:null,count:0,tied:null,total:0,other:0,counts};
  if(counts[ranked[0]]===counts[ranked[1]])return {position:null,count:counts[ranked[0]],tied:ranked.filter(position=>counts[position]===counts[ranked[0]]),total,other:total-counts[ranked[0]],counts};
  return {position:ranked[0],count:counts[ranked[0]],tied:null,total,other:total-counts[ranked[0]],counts};
};
function breakdownBy(rows,keyOf) {
  const keys=new Map();
  for(const row of rows) {
    if(!row.country||!positions.includes(row.position)||!row.group)continue;
    const code=keyOf(filterCountry(row.country));
    if(!keys.has(code))keys.set(code,{country:code,counts:{for:0,against:0,abstaining:0},groups:new Map()});
    const entry=keys.get(code);
    entry.counts[row.position]++;
    if(!entry.groups.has(row.group))entry.groups.set(row.group,{for:0,against:0,abstaining:0});
    entry.groups.get(row.group)[row.position]++;
  }
  return [...keys.values()].map(entry=>{
    const cells=new Map();
    for(const [group,counts] of entry.groups)cells.set(group,cellOf(counts));
    return {...entry,cells,ballots:positions.reduce((sum,position)=>sum+entry.counts[position],0),majority:pluralityPosition(entry.counts)};
  });
}
export const countryGroupBreakdown=rows=>breakdownBy(rows,code=>code);
// The same measures across every country: the table's first row. Its country is null.
export const allCountriesBreakdown=rows=>breakdownBy(rows,()=>null)[0]||null;

const majorityOrder=[...positions,null];
// Rows by the chosen column. Countries without ballots for a chosen group sort last.
export function sortCountryRows(rows,sort,nameOf,locale) {
  const by=(a,b)=>nameOf(a).localeCompare(nameOf(b),locale);
  const dir=sort.dir==='asc'?1:-1;
  const compare=sort.kind==='country'?(a,b)=>dir*by(a,b)
    :sort.kind==='total'?(a,b)=>dir*(a.ballots-b.ballots)||by(a,b)
    :sort.kind==='majority'?(a,b)=>dir*(majorityOrder.indexOf(a.majority)-majorityOrder.indexOf(b.majority))||b.ballots-a.ballots||by(a,b)
    :(a,b)=>{
      const x=a.cells.get(sort.key)?.count||0,y=b.cells.get(sort.key)?.count||0;
      if(!x||!y)return (x?0:1)-(y?0:1)||by(a,b);
      return dir*(x-y)||by(a,b);
    };
  return [...rows].sort(compare);
}

// One URL parameter carries the table sort: '' is the default (most ballots first),
// otherwise `country:asc|desc`, `total:asc|desc`, `majority:asc|desc`, `group:CODE` or
// `group:CODE:asc`. Unknown values decode to null and the interface falls back to the default.
export const defaultMatrixSort=Object.freeze({kind:'total',dir:'desc'});
export function encodeMatrixSort(sort) {
  if(!sort||sort.kind==='total'&&sort.dir==='desc')return '';
  const dir=sort.dir==='asc'?'asc':'desc';
  if(['country','total','majority'].includes(sort.kind))return sort.kind+':'+dir;
  if(sort.kind==='group'&&sort.key)return 'group:'+sort.key+(dir==='asc'?':asc':'');
  return '';
}
export function decodeMatrixSort(raw) {
  if(!raw)return {...defaultMatrixSort};
  const parts=String(raw).split(':');
  if(['country','total','majority'].includes(parts[0])&&parts.length===2&&(parts[1]==='asc'||parts[1]==='desc'))return {kind:parts[0],dir:parts[1]};
  if(parts[0]==='group'&&parts.length>=2&&parts[1]) {
    if(parts.length===2)return {kind:'group',key:parts[1],dir:'desc'};
    if(parts.length===3&&(parts[2]==='asc'||parts[2]==='desc'))return {kind:'group',key:parts[1],dir:parts[2]};
  }
  return null;
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

// A country, group or cell reads as pressed only while the voter list is showing that filter:
// the list shown (position not null), the same country and group, and for a cell the same position.
export function countryFilterPressed(selection,target) {
  if(selection.position===null)return false;
  if(selection.country!==target.country||selection.group!==target.group)return false;
  return target.position===undefined||selection.position===target.position;
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

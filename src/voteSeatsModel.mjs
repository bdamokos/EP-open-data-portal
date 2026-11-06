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

// Group labels sit just outside the outer edge of the hemicycle, along the mean
// direction of each group's seats. Everything derives from the plan: the centre
// is the middle of the seats' span at their lowest line. A label is skipped when
// it would overlap one already placed (larger groups win) at the rendered scale,
// so a small chart shows fewer labels instead of colliding ones.
export function groupLabelPlacements(seats,{scale,widthOf,height=12,gap=4,pad=6,extra=0,extraWidthOf=()=>0}) {
  const bounds=seatBounds(seats);
  if(!bounds||!(scale>0))return [];
  const cx=(bounds.minX+bounds.maxX)/2,cy=bounds.maxY;
  const groups=new Map();
  for(const seat of seats) {
    if(!seat.group)continue;
    const dx=seat.x-cx,dy=cy-seat.y,distance=Math.hypot(dx,dy);
    if(!distance)continue;
    const entry=groups.get(seat.group)||{group:seat.group,count:0,ux:0,uy:0,outer:0};
    entry.count++;entry.ux+=dx/distance;entry.uy+=dy/distance;entry.outer=Math.max(entry.outer,distance+seat.r);
    groups.set(seat.group,entry);
  }
  const seatStep=bounds.width/200,placed=[];
  // A label may carry a second line (`extra` px tall, `extraWidthOf` wide); it keeps that line only where the
  // taller box clears every seat and every label already placed, otherwise it is the label alone.
  const attempt=(entry,withExtra)=>{
    const length=Math.hypot(entry.ux,entry.uy);
    if(!length)return null;
    const ux=entry.ux/length,uy=entry.uy/length;
    const anchor=ux>0.35?'start':ux<-0.35?'end':'middle';
    const w=Math.max(widthOf(entry.group),withExtra?extraWidthOf(entry.group):0)/scale,h=(height+(withExtra?extra:0))/scale,g=gap/scale;
    // The ray can pass other groups' outer seats, so step outwards until the label clears every seat.
    let reach=entry.outer+pad/scale,x,y,box,clear=false;
    for(let step=0;step<40;step++,reach+=seatStep) {
      x=cx+ux*reach;y=cy-uy*reach;
      const left=anchor==='start'?x:anchor==='end'?x-w:x-w/2,top=y-height/2/scale;
      box={left:left-g,right:left+w+g,top:top-g,bottom:top+h+g};
      if(!seats.some(seat=>seat.x+seat.r>box.left&&seat.x-seat.r<box.right&&seat.y+seat.r>box.top&&seat.y-seat.r<box.bottom)){clear=true;break;}
    }
    if(!clear||placed.some(other=>box.left<other.box.right&&box.right>other.box.left&&box.top<other.box.bottom&&box.bottom>other.box.top))return null;
    return {group:entry.group,x,y,anchor,box,withExtra};
  };
  for(const entry of [...groups.values()].sort((a,b)=>b.count-a.count||a.group.localeCompare(b.group))) {
    const label=(extra>0?attempt(entry,true):null)||attempt(entry,false);
    if(label)placed.push(label);
  }
  return placed;
}

// A country, group or cell reads as pressed only while the voter list is showing that filter:
// the list shown (position not null), the same country and group, and for a cell the same position.
export function countryFilterPressed(selection,target) {
  if(selection.position===null)return false;
  if(selection.country!==target.country||selection.group!==target.group)return false;
  return target.position===undefined||selection.position===target.position;
}

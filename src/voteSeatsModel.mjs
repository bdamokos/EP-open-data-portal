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
export function groupLabelPlacements(seats,{scale,widthOf,height=12,gap=4,pad=6}) {
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
  for(const entry of [...groups.values()].sort((a,b)=>b.count-a.count||a.group.localeCompare(b.group))) {
    const length=Math.hypot(entry.ux,entry.uy);
    if(!length)continue;
    const ux=entry.ux/length,uy=entry.uy/length;
    const anchor=ux>0.35?'start':ux<-0.35?'end':'middle';
    const w=widthOf(entry.group)/scale,h=height/scale,g=gap/scale;
    // The ray can pass other groups' outer seats, so step outwards until the label clears every seat.
    let reach=entry.outer+pad/scale,x,y,box,clear=false;
    for(let step=0;step<40;step++,reach+=seatStep) {
      x=cx+ux*reach;y=cy-uy*reach;
      const left=anchor==='start'?x:anchor==='end'?x-w:x-w/2,top=y-h/2;
      box={left:left-g,right:left+w+g,top:top-g,bottom:top+h+g};
      if(!seats.some(seat=>seat.x+seat.r>box.left&&seat.x-seat.r<box.right&&seat.y+seat.r>box.top&&seat.y-seat.r<box.bottom)){clear=true;break;}
    }
    if(!clear)continue;
    if(placed.some(other=>box.left<other.box.right&&box.right>other.box.left&&box.top<other.box.bottom&&box.bottom>other.box.top))continue;
    placed.push({group:entry.group,x,y,anchor,box});
  }
  return placed.map(({box,...label})=>({...label,box}));
}

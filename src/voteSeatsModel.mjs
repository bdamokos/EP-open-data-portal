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

const positionRank={for:0,against:1,abstaining:2};
const UNKNOWN_GROUP='unavailable';

// Cuts each row's dots into consecutive parts so that every part adds up to its total over all rows.
// Row i holds rowCounts[i] dots; the result m[i][k] is how many of them go to part k, in order, with
// row sums rowCounts[i] and column sums totals[k]. Each part is a contiguous angular block across the rows.
export function allocateRows(rowCounts,totals) {
  const rows=rowCounts.length,parts=totals.length,sum=rowCounts.reduce((a,b)=>a+b,0);
  const target=[];totals.reduce((acc,value,k)=>{target[k]=acc+value;return acc+value;},0);
  const bound=rowCounts.map(count=>target.map((t,k)=>k===parts-1?count:Math.round(count*t/sum)));
  for(let k=0;k<parts-1;k++) {
    let diff=target[k]-bound.reduce((acc,row)=>acc+row[k],0),guard=rows*4+8;
    while(diff!==0&&guard-->0) {
      const direction=diff>0?1:-1;
      let best=-1,bestScore=-Infinity;
      for(let i=0;i<rows;i++) {
        const next=bound[i][k]+direction;
        if(next<(k?bound[i][k-1]:0)||next>bound[i][k+1])continue;
        // Move where the rounding was furthest from the exact share.
        const score=direction*(rowCounts[i]*target[k]/sum-bound[i][k]);
        if(score>bestScore){bestScore=score;best=i;}
      }
      if(best<0)break;
      bound[best][k]+=direction;diff-=direction;
    }
  }
  return bound.map(row=>row.map((value,k)=>value-(k?row[k-1]:0)));
}

// One dot per ballot on concentric arcs. Every wedge (a group, in `order` left to right, then other groups with
// an unknown one last) is a block across all rows, separated from its neighbours by an angular gap of about two
// dot spacings. Inside a wedge each position is a block of its own running from the inner row outwards: For at
// the wedge's left edge, then Against, then Abstained. Coordinates are px around the centre of the baseline
// (y up is negative). The dots always add up to the recorded ballots.
export function groupArcLayout(ballots,{order,radius,innerRatio=0.3}) {
  const valid=ballots.filter(ballot=>positions.includes(ballot.position));
  const total=valid.length;
  if(!total||!(radius>0))return {dots:[],wedges:[],dotRadius:0,rows:0,radius};
  const byGroup=new Map();
  for(const ballot of valid) {
    const code=ballot.group||UNKNOWN_GROUP;
    if(!byGroup.has(code))byGroup.set(code,[]);
    byGroup.get(code).push(ballot);
  }
  const known=order.filter(code=>byGroup.has(code)),rest=[...byGroup.keys()].filter(code=>!order.includes(code)).sort((a,b)=>(a===UNKNOWN_GROUP)-(b===UNKNOWN_GROUP)||byGroup.get(b).length-byGroup.get(a).length||a.localeCompare(b));
  const codes=[...known,...rest],gaps=codes.length-1;
  const inner=radius*innerRatio,area=Math.PI/2*(radius*radius-inner*inner),mid=(radius+inner)/2;
  // Dot spacing d with the gaps taken out of the arc: N d² + b d - A = 0.
  const b=2*area*gaps/(mid*Math.PI),spacing=(-b+Math.sqrt(b*b+4*total*area))/(2*total);
  const gapAngle=2*spacing/mid;
  const rows=Math.max(1,Math.round((radius-inner)/spacing)),step=(radius-inner)/rows;
  const radii=Array.from({length:rows},(_,i)=>inner+step*(i+0.5)),sumRadii=radii.reduce((a,b2)=>a+b2,0);
  const exact=radii.map(r=>total*r/sumRadii),rowCounts=exact.map(Math.floor);
  let left=total-rowCounts.reduce((a,b2)=>a+b2,0);
  for(const index of exact.map((value,i)=>[value-Math.floor(value),i]).sort((x,y)=>y[0]-x[0]).map(entry=>entry[1])){if(left<=0)break;rowCounts[index]++;left--;}
  const wedgeRows=allocateRows(rowCounts,codes.map(code=>byGroup.get(code).length));
  const dots=[],wedges=[],arcSpacing=[];
  const available=Math.PI-gaps*gapAngle;
  // Per row, the angle one dot takes: the arc left after the gaps, shared by the row's dots.
  const cell=rowCounts.map(count=>available/count);
  rowCounts.forEach((count,i)=>arcSpacing.push(radii[i]*cell[i]));
  const startAt=radii.map(()=>Math.PI);
  codes.forEach((code,w)=>{
    const members=byGroup.get(code),counts={for:0,against:0,abstaining:0};
    for(const ballot of members)counts[ballot.position]++;
    const byPosition=positions.map(position=>members.filter(ballot=>ballot.position===position).sort((x,y)=>String(x.id).localeCompare(String(y.id),undefined,{numeric:true})));
    const perRow=allocateRows(wedgeRows.map(row=>row[w]),positions.map(position=>counts[position]));
    const cursor=[0,0,0],own=[];
    for(let i=0;i<rows;i++) {
      let at=startAt[i];
      for(let k=0;k<positions.length;k++)for(let j=0;j<perRow[i][k];j++) {
        const ballot=byPosition[k][cursor[k]++],angle=at-cell[i]/2;at-=cell[i];
        own.push({id:String(ballot.id),group:code,position:ballot.position,x:radii[i]*Math.cos(angle),y:-radii[i]*Math.sin(angle),angle,row:i,radius:radii[i]});
      }
      startAt[i]=at-gapAngle;
    }
    own.sort((x,y)=>y.angle-x.angle||x.radius-y.radius);
    const angles=own.map(dot=>dot.angle);
    for(const dot of own)dots.push({...dot,index:dots.length});
    wedges.push({group:code,count:members.length,counts,start:Math.max(...angles),end:Math.min(...angles),angle:(Math.max(...angles)+Math.min(...angles))/2,known:code!==UNKNOWN_GROUP});
  });
  return {dots,wedges,dotRadius:0.42*Math.min(step,Math.min(...arcSpacing)),rows,radius,inner,gapAngle,spacing};
}

// Labels sit just outside their wedge. Wedges at the very ends of the baseline put theirs below it. A label that
// would touch one already placed moves outwards until it clears. `measure(group)` gives the label's size in px.
export function arcLabelPlacements(wedges,{radius,dotRadius,measure,gap=6,edge=0.2}) {
  const placed=[];
  for(const wedge of wedges) {
    const {w,h}=measure(wedge.group),cos=Math.cos(wedge.angle),sin=Math.sin(wedge.angle);
    const atEdge=wedge.angle<edge||wedge.angle>Math.PI-edge;
    let reach=radius+dotRadius+gap,label;
    for(let step=0;step<60;step++,reach+=3) {
      let x,y,anchor;
      if(atEdge){x=cos*(radius*0.85);y=dotRadius+gap+h/2+step*3;anchor='middle';}
      else{x=reach*cos;y=-reach*sin;anchor=cos>0.35?'start':cos<-0.35?'end':'middle';}
      const left=anchor==='start'?x:anchor==='end'?x-w:x-w/2;
      const top=atEdge?y-h/2:anchor==='middle'?y-h:y-h/2;
      label={group:wedge.group,x,top,anchor,box:{left,right:left+w,top,bottom:top+h}};
      if(!placed.some(other=>label.box.left<other.box.right+4&&label.box.right+4>other.box.left&&label.box.top<other.box.bottom+2&&label.box.bottom+2>other.box.top))break;
    }
    placed.push(label);
  }
  return placed;
}

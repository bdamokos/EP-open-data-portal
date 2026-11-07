import type {VotePosition} from './votePositions';

// Against is a bold ×: two bars at 45° and 135°. It is four-fold symmetric, so no row's curve can make it look tilted.
export function againstPath(x:number,y:number,r:number) {
  const length=r*1.06,half=r*.36;
  return [45,135].map(degrees=>{
    const c=Math.cos(degrees*Math.PI/180),s=Math.sin(degrees*Math.PI/180);
    return 'M'+([[-length,-half],[length,-half],[length,half],[-length,half]] as const).map(([u,v])=>`${(x+u*c-v*s).toFixed(2)} ${(y+u*s+v*c).toFixed(2)}`).join('L')+'z';
  }).join('');
}
// The chart's marks at a small size, so the column heads are the chart's legend. Always next to a word or number.
export function VoteMark({position}:{position:VotePosition}) {
  return <svg className="mk" viewBox="0 0 10 10" aria-hidden="true">
    {position==='for'&&<circle cx="5" cy="5" r="5" fill="var(--vote-for)"/>}
    {position==='against'&&<path fill="var(--vote-against)" d={againstPath(5,5,4.6)}/>}
    {position==='abstaining'&&<circle cx="5" cy="5" r="3.9" fill="none" stroke="var(--vote-abstain)" strokeWidth="2"/>}
  </svg>;
}

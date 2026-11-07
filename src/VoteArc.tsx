import {memo,useCallback,useMemo,useRef,useState,type KeyboardEvent,type MouseEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {useUiI18n} from './UiI18nReact';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {groupShortLabel} from './groupShort';
import {voteCountryName as countryName} from './voteCountryName';
import {againstPath} from './VoteMark';
import {votePositionKeys,type VotePosition} from './votePositions';
import {groupArcLayout,nearestDot,wedgeLabels,type ArcDot} from './voteSeatsModel.mjs';

export type ArcVoter={id:string;name:string|null;group:string;position:VotePosition;country:string|null};
type Props={voters:ArcVoter[];order:string[];word:string|null;small:string|null;smallLanguage?:string;noRecord:number|null;picked:string|null;onPick:(id:string|null)=>void;dimmedGroup:string|null;language:string;onMember?:(id:number)=>void;positionWord:(position:VotePosition)=>string};
const WIDTH=760,PAD=58,TOP=30;
const radius=WIDTH/2-PAD;

function Mark({dot,r,tabbable,selected,dim,label}:{dot:ArcDot;r:number;tabbable:boolean;selected:boolean;dim:boolean;label:string}) {
  const className=['d',dot.position,dim?'dim':'',selected?'sel':''].filter(Boolean).join(' '),common={className,'data-i':dot.index,role:'button',tabIndex:tabbable?0:-1,'aria-label':label};
  if(dot.position==='for')return <circle {...common} cx={dot.x.toFixed(1)} cy={dot.y.toFixed(1)} r={r.toFixed(1)}/>;
  if(dot.position==='abstaining')return <circle {...common} cx={dot.x.toFixed(1)} cy={dot.y.toFixed(1)} r={(r*.72).toFixed(1)} strokeWidth={(r*.5).toFixed(1)}/>;
  return <path {...common} d={againstPath(dot.x,dot.y,r)}/>;
}
const MemoMark=memo(Mark);

// The fan of wedges: one per group in seating order, every ballot a mark, the answer in its own centre.
export function VoteArc({voters,order,word,small,smallLanguage,noRecord,picked,onPick,dimmedGroup,language,onMember,positionWord}:Props) {
  const ui=useUiI18n(),svg=useRef<SVGSVGElement>(null);
  const [hovered,setHovered]=useState<number|null>(null),[focused,setFocused]=useState(0);
  const words=useMemo(()=>Object.fromEntries(votePositionKeys.map(position=>[position,positionWord(position)])) as Record<VotePosition,string>,[ui]);
  const people=useMemo(()=>new Map(voters.map(voter=>[voter.id,voter])),[voters]);
  const layout=useMemo(()=>groupArcLayout(voters,{order,radius}),[voters,order]);
  const labels=useMemo(()=>wedgeLabels(layout.wedges,{radius,dotRadius:layout.dotRadius}),[layout]);
  const height=TOP+radius+layout.dotRadius*1.6,dots=layout.dots;
  const groupName=(code:string)=>code==='unavailable'?ui.t('votegroups.seats.unknownGroup'):groupLabel(code,ui);
  const describe=useCallback((id:string)=>{
    const person=people.get(id);
    return [person?.name||ui.t('insightshared.mep'),person?groupName(person.group):null,person?.country?countryName(person.country,language):null].filter(Boolean).join(', ');
  },[people,language,ui]);
  const pickedIndex=picked===null?null:dots.find(dot=>dot.id===picked)?.index??null;
  const shown=hovered??pickedIndex,answer=shown===null?null:dots[shown]||null;
  const indexOf=(target:EventTarget)=>{const value=(target as SVGElement).getAttribute?.('data-i');return value===null||value===undefined?null:Number(value);};
  const touchNearest=(event:MouseEvent<SVGSVGElement>)=>{
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return null;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return nearestDot(dots,point.x,point.y,layout.dotRadius+14/matrix.a)?.index??null;
  };
  const click=(event:MouseEvent<SVGSVGElement>)=>{
    const index=indexOf(event.target)??touchNearest(event);
    if(index===null)return;
    const dot=dots[index];
    setFocused(index);
    if(dot.id===picked)onMember?.(Number(dot.id));else onPick(dot.id);
  };
  const key=(event:KeyboardEvent<SVGSVGElement>)=>{
    const index=indexOf(event.target);
    if(index===null)return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onMember?.(Number(dots[index].id));return;}
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
    if(step===undefined&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?dots.length-1:Math.min(dots.length-1,Math.max(0,index+step!));
    setFocused(next);
    svg.current?.querySelector<SVGElement>(`[data-i="${next}"]`)?.focus();
    onPick(dots[next].id);
  };
  const over=(event:ReactPointerEvent<SVGSVGElement>)=>{if(event.pointerType==='mouse'){const index=indexOf(event.target);if(index!==null)setHovered(index);}};
  const marks=useMemo(()=>dots.map(dot=><MemoMark key={dot.index} dot={dot} r={layout.dotRadius} tabbable={dot.index===focused} selected={dot.index===pickedIndex} dim={Boolean(dimmedGroup)&&dot.group!==dimmedGroup} label={describe(dot.id)+': '+words[dot.position]}/>),[dots,layout.dotRadius,focused,pickedIndex,dimmedGroup,describe,words]);
  return <figure className="seats">
    <div className="stage" style={{aspectRatio:`${WIDTH}/${Math.round(height)}`}}>
      <svg ref={svg} viewBox={`${-WIDTH/2} ${-(TOP+radius)} ${WIDTH} ${height}`} role="group" aria-label={ui.t('votegroups.seats.chart')} onClick={click} onKeyDown={key} onPointerOver={over} onPointerLeave={()=>setHovered(null)}>{marks}</svg>
      {labels.map(label=><span key={label.group} className={'gl'+(dimmedGroup&&dimmedGroup!==label.group?' off':'')} lang={groupLabelLanguage(label.group,ui)} aria-hidden="true" style={{left:`${(label.x+WIDTH/2)/WIDTH*100}%`,top:`${(label.y+TOP+radius)/height*100}%`,transform:`translate(${label.alignX},${label.alignY})`}}>{label.group==='unavailable'?ui.t('votegroups.seats.unknownGroup'):groupShortLabel(label.group,ui)}</span>)}
      <div className="hollow" style={{width:`${(layout.inner*1.78/WIDTH*100).toFixed(1)}%`}} aria-live="polite">
        {answer?<><strong>{words[answer.position]}</strong><small lang="">{describe(answer.id)}</small></>:<><strong>{word}</strong>{small&&<small lang={smallLanguage}>{small}</small>}</>}
      </div>
    </div>
    {noRecord!==null&&<p className="seatkey">{ui.t('votepage.no_vote_recorded',{count:noRecord})}</p>}
  </figure>;
}

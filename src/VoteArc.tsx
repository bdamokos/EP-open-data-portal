import {useEffect,useMemo,useRef,useState,type KeyboardEvent,type MouseEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {groupShortLabel} from './groupShort';
import {voteCountryName as countryName} from './voteCountryName';
import {positionsUi,votePositionKeys,type VotePosition} from './votePositions';
import {groupArcLayout,arcLabelPlacements,type ArcDot} from './voteSeatsModel.mjs';
import type {NamedVote} from './LegislationTypes';

type Person={id:string;name?:string|null;country?:string|null};
type Props={vote:NamedVote;rows:{id?:string;group:string|null;position:VotePosition|null}[];order:string[];language:string;differIds:Set<string>;differ:boolean;narrow:boolean;onMember?:(id:number,sourceId?:string)=>void;onList?:(group:string|null,position:VotePosition)=>void};
const positionFill:Record<VotePosition,string>={for:'var(--vote-for)',against:'var(--vote-against)',abstaining:'var(--vote-abstain)'};

// The arrangement by group: one dot per ballot, a wedge per group in the Parliament's left-to-right order.
export function VoteArc({vote,rows,order,language,differIds,differ,narrow,onMember,onList}:Props) {
  const ui=useUiI18n(),positions=positionsUi(ui);
  const [width,setWidth]=useState(0),box=useRef<HTMLDivElement>(null);
  const [active,setActive]=useState<number|null>(null),[hovered,setHovered]=useState<number|null>(null);
  const pointerType=useRef<'mouse'|'touch'|'pen'>('mouse'),activeAtPress=useRef<number|null>(null);
  useEffect(()=>{
    const node=box.current;if(!node)return;
    const measure=()=>setWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[]);
  const ballots=useMemo(()=>{
    const groupOf=new Map(rows.map(row=>[String(row.id),row.group]));
    return votePositionKeys.flatMap(position=>(vote.groups?.[position]||[]).map(person=>({id:person.id,position,group:groupOf.get(String(person.id))??null})));
  },[vote,rows]);
  const people=useMemo(()=>new Map<string,Person>(votePositionKeys.flatMap(position=>(vote.groups?.[position]||[]).map(person=>[String(person.id),person] as [string,Person]))),[vote]);
  const fontSize=narrow?12:13,lineHeight=Math.round(fontSize*1.25);
  const labelOf=(group:string)=>group==='unavailable'?ui.t('votegroups.seats.unknownGroup'):groupShortLabel(group,ui);
  const geometry=useMemo(()=>{
    if(width<=0)return null;
    // Fit the arc and its labels into the column: shrink the arc until nothing sticks out at the sides.
    let radius=width/2-8,result=null as null|{layout:ReturnType<typeof groupArcLayout>;labels:ReturnType<typeof arcLabelPlacements>;minY:number;maxY:number};
    for(let attempt=0;attempt<5;attempt++) {
      const layout=groupArcLayout(ballots,{order,radius});
      const counts=(group:string)=>layout.wedges.find(wedge=>wedge.group===group)!.counts;
      const measure=(group:string)=>{
        const name=labelOf(group).length*fontSize*0.62,numbers=narrow?0:votePositionKeys.map(position=>counts(group)[position]).join(' · ').length*fontSize*0.6;
        return {w:Math.max(name,numbers),h:narrow?lineHeight:lineHeight*2};
      };
      const labels=arcLabelPlacements(layout.wedges,{radius,dotRadius:layout.dotRadius,measure,gap:narrow?4:8});
      const minX=Math.min(-radius-layout.dotRadius,...labels.map(label=>label.box.left)),maxX=Math.max(radius+layout.dotRadius,...labels.map(label=>label.box.right));
      const minY=Math.min(-radius-layout.dotRadius,...labels.map(label=>label.box.top))-2,maxY=Math.max(layout.dotRadius,...labels.map(label=>label.box.bottom))+2;
      result={layout,labels,minY,maxY};
      const overflow=Math.max(-width/2-minX,maxX-width/2,0);
      if(overflow<1)break;
      radius-=overflow+1;
    }
    return result;
  },[width,ballots,order,narrow,ui]);
  const dots=geometry?.layout.dots||[];
  const label=(dot:ArcDot)=>{
    const person=people.get(dot.id);
    return [person?.name||ui.t('insightshared.mep'),groupLabel(dot.group,ui),person?.country?countryName(person.country,language):null,positions[dot.position],differIds.has(dot.id)?ui.t('votegroups.seats.differs'):null].filter(Boolean).join(' · ');
  };
  const shown=hovered??active,selected=shown===null?null:dots[shown]||null;
  const select=(dot:ArcDot,event:MouseEvent<SVGCircleElement>)=>{
    event.stopPropagation();setActive(dot.index);
    if(pointerType.current==='mouse'||activeAtPress.current===dot.index)onMember?.(Number(dot.id));
  };
  const key=(event:KeyboardEvent<SVGCircleElement>,dot:ArcDot)=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onMember?.(Number(dot.id));return;}
    const step={'ArrowRight':1,'ArrowDown':1,'ArrowLeft':-1,'ArrowUp':-1}[event.key];
    if(step===undefined&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?dots.length-1:Math.min(dots.length-1,Math.max(0,dot.index+step!));
    setActive(next);
    (event.currentTarget.ownerSVGElement||event.currentTarget).querySelector<SVGCircleElement>(`[data-dot="${next}"]`)?.focus();
  };
  const clickChart=(event:MouseEvent<SVGSVGElement>)=>{
    if(event.target!==event.currentTarget||!geometry)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    let best:ArcDot|null=null,distance=Infinity;
    for(const dot of dots){const d=Math.hypot(dot.x-point.x,dot.y-point.y);if(d<distance){distance=d;best=dot;}}
    if(best&&distance<=geometry.layout.dotRadius+14/matrix.a)setActive(best.index);
  };
  const markPointer=(event:ReactPointerEvent<SVGCircleElement>)=>{pointerType.current=event.pointerType as typeof pointerType.current;activeAtPress.current=active;};
  const circles=useMemo(()=>geometry?dots.map(dot=><circle key={dot.index} data-dot={dot.index} cx={dot.x} cy={dot.y} r={geometry.layout.dotRadius} fill={positionFill[dot.position]} data-dimmed={differ&&!differIds.has(dot.id)?'true':undefined} tabIndex={dot.index===(active??0)?0:-1} role="button" aria-label={label(dot)} onPointerDown={markPointer} onClick={event=>select(dot,event)} onFocus={()=>setActive(dot.index)} onPointerEnter={()=>setHovered(dot.index)} onPointerLeave={()=>setHovered(null)} onKeyDown={event=>key(event,dot)}><title>{label(dot)}</title></circle>):null,[geometry,dots,differ,differIds,active,ui,language]);
  const view=geometry?`${-width/2} ${geometry.minY} ${width} ${geometry.maxY-geometry.minY}`:'0 0 1 1';
  return <figure className="vote-seats-chart vote-arc-chart">
    <div ref={box} className="vote-arc-box">
      {geometry&&<svg viewBox={view} role="group" aria-label={ui.t('votegroups.seats.chart')} onClick={clickChart}>
        {circles}
        {geometry.layout.wedges.map((wedge,index)=>{
          const placed=geometry.labels[index];
          return <g key={wedge.group} className="vote-arc-label" aria-hidden="true">
            <text x={placed.x} y={placed.box.top} dominantBaseline="hanging" textAnchor={placed.anchor} fontSize={fontSize} className="vote-arc-name" lang={groupLabelLanguage(wedge.group,ui)}>{labelOf(wedge.group)}</text>
            {!narrow&&<text x={placed.x} y={placed.box.top+lineHeight} dominantBaseline="hanging" textAnchor={placed.anchor} fontSize={fontSize} className="vote-seat-counts">{votePositionKeys.map((position,i)=><tspan key={position} className={'vote-'+position}>{i?<tspan className="vote-seat-counts-sep"> · </tspan>:null}{wedge.counts[position]}</tspan>)}</text>}
          </g>;
        })}
        {selected&&<circle className="vote-seat-selected" cx={selected.x} cy={selected.y} r={geometry.layout.dotRadius*1.9} style={{strokeWidth:Math.max(1.5,geometry.layout.dotRadius*.4)}}/>}
      </svg>}
    </div>
    <figcaption className="vote-seat-info" aria-live="polite">{selected?<>{people.get(selected.id)?.name||ui.t('insightshared.mep')} · <span lang={groupLabelLanguage(selected.group,ui)}>{groupLabel(selected.group,ui)}</span> · {people.get(selected.id)?.country?countryName(people.get(selected.id)!.country!,language):''} · {positions[selected.position]}{differIds.has(selected.id)&&<> · <UiMessage id="votegroups.seats.differs"/></>} <button type="button" className="insight-text-button" onClick={()=>onMember?.(Number(selected.id))}><UiMessage id="hemicycle.openMember"/></button>{onList&&<> <button type="button" className="insight-text-button" onClick={()=>onList(selected.group==='unavailable'?null:selected.group,selected.position)}><UiMessage id="votegroups.seats.list"/></button></>}</>:null}</figcaption>
  </figure>;
}

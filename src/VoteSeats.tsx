import {useEffect,useMemo,useRef,useState,useId,type KeyboardEvent,type MouseEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useExplorerParam} from './explorerUrl';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {voteCountryName as countryName} from './voteCountryName';
import {nearestSeat,type HemicycleSeat} from './hemicycleModel.mjs';
import {VoteArc} from './VoteArc';
import {planGroupOrder,seatBallots,unseatedDotTotals,differingVoterIds,seatBounds,groupLabelPlacements,type SeatBallotVoter} from './voteSeatsModel.mjs';
import {groupShortLabel} from './groupShort';
import {positionsUi,votePositionKeys,type VotePosition} from './votePositions';
import {useNarrow} from './useNarrow';
import type {NamedVote} from './LegislationTypes';
import './VoteSeats.css';

type HemicyclePlan={chamber:string;sourcePageUrl:string;sourceDate:string|null;width:number;height:number;seats:HemicycleSeat[]};
type MetricRow={id?:string;group:string|null;country?:string|null;position:VotePosition|null};
type Props={vote:NamedVote;rows:MetricRow[];sittingId:string;language:string;onMember?:(id:number,sourceId?:string)=>void;onList?:(group:string|null,position:VotePosition)=>void};
const positionFill:Record<VotePosition,string>={for:'var(--vote-for)',against:'var(--vote-against)',abstaining:'var(--vote-abstain)'};
const chamberFor=(location:string|null|undefined)=>location==='Brussels'?'bru':'str';
const fullName=(seat:HemicycleSeat)=>`${seat.firstName||''} ${seat.name||''}`.trim();

export function VoteSeats({vote,rows,sittingId,language,onMember,onList}:Props) {
  const ui=useUiI18n(),headingId=useId(),narrow=useNarrow();
  const [view,setView]=useExplorerParam<'all'|'differ'>('agenda-seat-view','all',['all','differ']);
  const [arrangement,setArrangement]=useExplorerParam<'group'|'seats'>('agenda-seat-arrangement','group',['group','seats']);
  const [active,setActive]=useState<number|null>(null),[hovered,setHovered]=useState<number|null>(null);
  const pointerType=useRef<'mouse'|'touch'|'pen'>('mouse'),activeAtPress=useRef<number|null>(null);
  const [svgNode,setSvgNode]=useState<SVGSVGElement|null>(null),[pixelWidth,setPixelWidth]=useState(0);
  useEffect(()=>{
    if(!svgNode||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(()=>setPixelWidth(svgNode.getBoundingClientRect().width));
    observer.observe(svgNode);setPixelWidth(svgNode.getBoundingClientRect().width);
    return()=>observer.disconnect();
  },[svgNode]);

  const calendar=useData<VotePeriodsResponse>('vote-periods',{unavailable:'error.records'});
  const chamber=useMemo(()=>{
    if(!calendar.data||!validateVotePeriods(calendar.data))return 'str';
    return chamberFor(calendar.data.weeks.flatMap(week=>week.sittings).find(sitting=>sitting.sittingId===sittingId)?.location);
  },[calendar.data,sittingId]);
  const state=useData<HemicyclePlan>(`hemicycle/${chamber}`,{unavailable:'error.unavailable'});
  const plan=state.data?.chamber===chamber?state.data:null;
  const voters=useMemo<SeatBallotVoter[]>(()=>votePositionKeys.flatMap(position=>(vote.groups?.[position]||[]).map(person=>({id:person.id,position}))),[vote]);
  const seats=useMemo(()=>plan?.seats.filter(seat=>seat.member)||[],[plan]);
  const ballots=useMemo(()=>seatBallots(voters,seats),[voters,seats]);
  const differIds=useMemo(()=>differingVoterIds(rows),[rows]);
  const groupOrder=useMemo(()=>planGroupOrder(plan?.seats||[]),[plan]);
  const positions=positionsUi(ui);
  const selected=(hovered??active)===null?null:seats.find(seat=>seat.seat===(hovered??active))||null;
  const selectedBallot=selected?ballots.bySeat.get(selected.seat):null;
  const dotted=unseatedDotTotals(voters,seats);
  const groupCodes=useMemo(()=>[...new Set(rows.map(row=>row.group).filter((code):code is string=>Boolean(code)))],[rows]);
  const groupCounts=(code:string)=>votePositionKeys.map(position=>rows.filter(row=>row.group===code&&row.position===position).length);
  const countsText=(code:string)=>groupCounts(code).join(' · ');
  const positionLabel=(seat:HemicycleSeat,ballot:{position:VotePosition}|undefined)=>ballot?positions[ballot.position]:ui.t('votegroups.seats.noRecord');
  const label=(seat:HemicycleSeat,ballot:{position:VotePosition}|undefined)=>{
    const differs=ballot&&differIds.has(ballots.bySeat.get(seat.seat)!.id);
    return [fullName(seat),groupLabel(seat.group||'',ui),countryName(seat.country||'',language),positionLabel(seat,ballot),differs?ui.t('votegroups.seats.differs'):null].filter(Boolean).join(' · ');
  };
  // Hover re-renders this component; seat labels only change with the data.
  const labels=useMemo(()=>new Map(seats.map(seat=>[seat.seat,label(seat,ballots.bySeat.get(seat.seat))])),[seats,ballots,differIds,ui,language]);
  const dimmed=(seat:HemicycleSeat)=>view==='differ'&&!differIds.has(ballots.bySeat.get(seat.seat)?.id||'');
  const openMember=(seat:HemicycleSeat)=>{const ballot=ballots.bySeat.get(seat.seat);if(ballot)onMember?.(Number(ballot.id));};
  const clickSeat=(event:MouseEvent<SVGCircleElement>,seat:HemicycleSeat)=>{
    event.stopPropagation();
    setActive(seat.seat);
    // A mouse click opens the MEP; a touch or pen tap selects first. Pressing a seat focuses it, so the
    // selection to compare is the one held when the press began.
    if(pointerType.current==='mouse'||activeAtPress.current===seat.seat)openMember(seat);
  };
  const clickChart=(event:MouseEvent<SVGSVGElement>)=>{
    if(event.target!==event.currentTarget)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const seat=nearestSeat(seats,point.x,point.y,14/matrix.a);
    if(seat)setActive(seat.seat);
  };
  const markPointer=(event:ReactPointerEvent<SVGCircleElement>)=>{pointerType.current=event.pointerType as typeof pointerType.current;activeAtPress.current=active;};
  const keySeat=(event:KeyboardEvent<SVGCircleElement>,seat:HemicycleSeat)=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();openMember(seat);return;}
    const step={'ArrowRight':1,'ArrowDown':1,'ArrowLeft':-1,'ArrowUp':-1}[event.key];
    if(step===undefined&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();
    if(!seats.length)return;
    const at=Math.max(0,seats.findIndex(item=>item.seat===seat.seat));
    const next=event.key==='Home'?0:event.key==='End'?seats.length-1:Math.min(seats.length-1,Math.max(0,at+step!));
    const target=seats[next];
    setActive(target.seat);
    (event.currentTarget.ownerSVGElement||event.currentTarget).querySelector<SVGCircleElement>(`[data-seat="${target.seat}"]`)?.focus();
  };
  // The chart is cropped to its seats, with room outside the arc for group labels.
  const chart=useMemo(()=>{
    const bounds=seatBounds(seats);
    if(!bounds)return {box:'0 0 1 1',width:1,labels:[] as ReturnType<typeof groupLabelPlacements>,scale:0};
    const padX=bounds.width*.1,padTop=bounds.width*.06,width=bounds.width+padX*2,height=bounds.height+padTop+bounds.width*.01;
    const scale=pixelWidth>0?pixelWidth/width:0;
    // Phones keep the labels alone; wider screens add each group's three counts where they fit.
    const labels=groupLabelPlacements(seats,{scale,widthOf:group=>groupShortLabel(group,ui).length*6.6+4,height:12,gap:3,pad:5,extra:narrow?0:12,extraWidthOf:group=>countsText(group).length*6+6});
    return {box:`${bounds.minX-padX} ${bounds.minY-padTop} ${width} ${height}`,width,labels,scale};
  },[seats,pixelWidth,ui,narrow,rows]);
  const circles=useMemo(()=>seats.map(seat=>{
            const ballot=ballots.bySeat.get(seat.seat);
            return <circle key={seat.seat} data-seat={seat.seat} cx={seat.x} cy={seat.y} r={seat.r} fill={ballot?positionFill[ballot.position]:'transparent'} strokeWidth={ballot?undefined:Math.max(1,seat.r*.18)} data-hollow={ballot?undefined:'true'} data-dimmed={dimmed(seat)?'true':undefined} tabIndex={seat.seat===(active??seats[0]?.seat)?0:-1} role="button" aria-label={labels.get(seat.seat)} onPointerDown={markPointer} onClick={event=>clickSeat(event,seat)} onFocus={()=>setActive(seat.seat)} onPointerEnter={()=>setHovered(seat.seat)} onPointerLeave={()=>setHovered(null)} onKeyDown={event=>keySeat(event,seat)}>
              <title>{labels.get(seat.seat)}</title>
            </circle>;
          }),[seats,ballots,view,differIds,active,labels]);
  return <section className="vote-seats" lang={ui.language} aria-labelledby={headingId} data-voter-anchor="seats">
    <div className="insight-section-heading">
      <h4 id={headingId}><UiMessage id="votegroups.seats.heading"/></h4>
      <div className="vote-seat-controls">
      <div className="insight-chart-switch" role="group" aria-label={ui.t('votegroups.seats.arrangement')}>
        <button type="button" aria-pressed={arrangement==='group'} onClick={()=>setArrangement('group')}><UiMessage id="votegroups.seats.arrangement.group"/></button>
        <button type="button" aria-pressed={arrangement==='seats'} onClick={()=>setArrangement('seats')}><UiMessage id="votegroups.seats.arrangement.seats"/></button>
      </div>
      <div className="insight-chart-switch" role="group" aria-label={ui.t('votegroups.seats.view')}>
        <button type="button" aria-pressed={view==='all'} onClick={()=>setView('all')}><UiMessage id="votegroups.seats.view.all"/></button>
        <button type="button" aria-pressed={view==='differ'} onClick={()=>setView('differ')}>{ui.t('votegroups.seats.view.differ',{count:String(differIds.size)})}</button>
      </div>
      </div>
    </div>
    {!plan?<p className="insight-secondary" role={state.error?'alert':'status'}>{state.error?<UiMessage id="votegroups.seats.unavailable"/>:<UiMessage id="insightshared.loading"/>}</p>:<>
      {arrangement==='group'?<VoteArc vote={vote} rows={rows} order={groupOrder} language={language} differIds={differIds} differ={view==='differ'} narrow={narrow} onMember={onMember} onList={onList}/>:<>
      <figure className="vote-seats-chart">
        <svg ref={setSvgNode} viewBox={chart.box} role="group" aria-label={ui.t('votegroups.seats.chart')} onClick={clickChart}>
          {circles}
          {chart.labels.map(label=>{const counts=label.withExtra?groupCounts(label.group):null;return <g key={label.group} aria-hidden="true"><text className="vote-seat-group" x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="middle" fontSize={11/(chart.scale||1)} lang={groupLabelLanguage(label.group,ui)}>{groupShortLabel(label.group,ui)}</text>{counts&&counts.some(Boolean)&&<text className="vote-seat-counts" x={label.x} y={label.y+12/(chart.scale||1)} textAnchor={label.anchor} dominantBaseline="middle" fontSize={10/(chart.scale||1)}>{votePositionKeys.map((position,index)=><tspan key={position} className={'vote-'+position}>{index?<tspan className="vote-seat-counts-sep"> · </tspan>:null}{counts[index]}</tspan>)}</text>}</g>;})}
          {selected&&<circle className="vote-seat-selected" cx={selected.x} cy={selected.y} r={selected.r*1.9} style={{strokeWidth:Math.max(1.5,selected.r*.4)}}/>}
        </svg>
        <figcaption className="vote-seat-info" aria-live="polite">{selected?<>{fullName(selected)} · <span lang={groupLabelLanguage(selected.group||'',ui)}>{groupLabel(selected.group||'',ui)}</span> · {countryName(selected.country||'',language)} · {positionLabel(selected,selectedBallot||undefined)}{selectedBallot&&differIds.has(selectedBallot.id)&&<> · <UiMessage id="votegroups.seats.differs"/></>}{selectedBallot&&<button type="button" className="insight-text-button" onClick={()=>openMember(selected)}><UiMessage id="hemicycle.openMember"/></button>}</>:null}</figcaption>
      </figure>
</>}

      <ul className="vote-seat-legend">{votePositionKeys.map(position=><li key={position}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill={positionFill[position]}/></svg>{ui.t('votegroups.position.'+position)}</li>)}{arrangement==="seats"&&<li><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle className="vote-seat-legend-hollow" cx="6" cy="6" r="5" fill="transparent"/></svg>{ui.t('votegroups.seats.noRecord')}</li>}</ul>
      {arrangement==='seats'&&<>{(dotted.for||dotted.against||dotted.abstaining)>0&&<div className="vote-seat-unseated"><p className="insight-chart-caption"><UiMessage id="votegroups.seats.unseated"/></p>{votePositionKeys.filter(position=>dotted[position]).map(position=><div key={position} className="vote-seat-dots-row"><span className={'vote-seat-dots-label vote-'+position}>{positions[position]} <strong>{dotted[position]}</strong></span><span className="vote-seat-dots" aria-hidden="true">{Array.from({length:dotted[position]},(_,index)=><i key={index} className={'vote-'+position}/>)}</span></div>)}</div>}</>}
    </>}
    <div data-voter-host="seats"/>
    <table className="vote-seats-sr">
      <caption><UiMessage id="votegroups.seats.table"/></caption>
      <thead><tr><th scope="col"><UiMessage id="groupvoices.political_group.c2db1f"/></th>{votePositionKeys.map(position=><th key={position} scope="col">{positions[position]}</th>)}</tr></thead>
      <tbody>{groupCodes.map(code=><tr key={code}><th scope="row" lang={groupLabelLanguage(code,ui)}>{groupLabel(code,ui)}</th>{groupCounts(code).map((count,index)=><td key={index}>{count}</td>)}</tr>)}</tbody>
      <tfoot><tr><th scope="row"><UiMessage id="votegroups.seats.table.total"/></th>{votePositionKeys.map(position=><td key={position}>{rows.filter(row=>row.position===position).length}</td>)}</tr></tfoot>
    </table>
  </section>;
}

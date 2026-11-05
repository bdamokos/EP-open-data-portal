import {useMemo,useRef,useState,useId,type KeyboardEvent,type MouseEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useExplorerParam} from './explorerUrl';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {voteCountryName as countryName} from './voteCountryName';
import {nearestSeat,type HemicycleSeat} from './hemicycleModel.mjs';
import {seatBallots,unseatedDotTotals,differingVoterIds,type SeatBallotVoter} from './voteSeatsModel.mjs';
import {positionsUi,votePositionKeys,type VotePosition} from './votePositions';
import type {NamedVote} from './LegislationTypes';
import './VoteSeats.css';

type HemicyclePlan={chamber:string;sourcePageUrl:string;sourceDate:string|null;width:number;height:number;seats:HemicycleSeat[]};
type MetricRow={id?:string;group:string|null;country?:string|null;position:VotePosition|null};
type Props={vote:NamedVote;rows:MetricRow[];sittingId:string;language:string;onMember?:(id:number,sourceId?:string)=>void};
const positionFill:Record<VotePosition,string>={for:'var(--vote-for)',against:'var(--vote-against)',abstaining:'var(--vote-abstain)'};
const chamberFor=(location:string|null|undefined)=>location==='Brussels'?'bru':'str';
const fullName=(seat:HemicycleSeat)=>`${seat.firstName||''} ${seat.name||''}`.trim();

export function VoteSeats({vote,rows,sittingId,language,onMember}:Props) {
  const ui=useUiI18n(),headingId=useId();
  const [view,setView]=useExplorerParam<'all'|'differ'>('agenda-seat-view','all',['all','differ']);
  const [active,setActive]=useState<number|null>(null),[hovered,setHovered]=useState<number|null>(null);
  const pointerType=useRef<'mouse'|'touch'|'pen'>('mouse');
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
  const positions=positionsUi(ui);
  const selected=(hovered??active)===null?null:seats.find(seat=>seat.seat===(hovered??active))||null;
  const selectedBallot=selected?ballots.bySeat.get(selected.seat):null;
  const dotted=unseatedDotTotals(voters,seats);
  const groupCodes=useMemo(()=>[...new Set(rows.map(row=>row.group).filter((code):code is string=>Boolean(code)))],[rows]);
  const groupCounts=(code:string)=>votePositionKeys.map(position=>rows.filter(row=>row.group===code&&row.position===position).length);
  const positionLabel=(seat:HemicycleSeat,ballot:{position:VotePosition}|undefined)=>ballot?positions[ballot.position]:ui.t('voteSeats.noRecord');
  const label=(seat:HemicycleSeat,ballot:{position:VotePosition}|undefined)=>{
    const differs=ballot&&differIds.has(ballots.bySeat.get(seat.seat)!.id);
    return [fullName(seat),groupLabel(seat.group||'',ui),countryName(seat.country||'',language),positionLabel(seat,ballot),differs?ui.t('voteSeats.differs'):null].filter(Boolean).join(' · ');
  };
  // Hover re-renders this component; seat labels only change with the data.
  const labels=useMemo(()=>new Map(seats.map(seat=>[seat.seat,label(seat,ballots.bySeat.get(seat.seat))])),[seats,ballots,differIds,ui,language]);
  const dimmed=(seat:HemicycleSeat)=>view==='differ'&&!differIds.has(ballots.bySeat.get(seat.seat)?.id||'');
  const openMember=(seat:HemicycleSeat)=>{const ballot=ballots.bySeat.get(seat.seat);if(ballot)onMember?.(Number(ballot.id));};
  const clickSeat=(event:MouseEvent<SVGCircleElement>,seat:HemicycleSeat)=>{
    event.stopPropagation();
    setActive(seat.seat);
    // A mouse click opens the MEP; a touch or pen tap selects first.
    if(pointerType.current==='mouse'||active===seat.seat)openMember(seat);
  };
  const clickChart=(event:MouseEvent<SVGSVGElement>)=>{
    if(event.target!==event.currentTarget)return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const seat=nearestSeat(seats,point.x,point.y,14/matrix.a);
    if(seat)setActive(seat.seat);
  };
  const markPointer=(event:ReactPointerEvent<SVGCircleElement>)=>{pointerType.current=event.pointerType as typeof pointerType.current;};
  const keySeat=(event:KeyboardEvent<SVGSVGElement>,seat:HemicycleSeat)=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();openMember(seat);return;}
    const step={'ArrowRight':1,'ArrowDown':1,'ArrowLeft':-1,'ArrowUp':-1}[event.key];
    if(step===undefined&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();
    if(!seats.length)return;
    const at=Math.max(0,seats.findIndex(item=>item.seat===seat.seat));
    const next=event.key==='Home'?0:event.key==='End'?seats.length-1:Math.min(seats.length-1,Math.max(0,at+step!));
    const target=seats[next];
    setActive(target.seat);
    event.currentTarget.querySelector<SVGCircleElement>(`[data-seat="${target.seat}"]`)?.focus();
  };
  const circles=useMemo(()=>seats.map(seat=>{
            const ballot=ballots.bySeat.get(seat.seat);
            return <circle key={seat.seat} data-seat={seat.seat} cx={seat.x} cy={seat.y} r={seat.r} fill={ballot?positionFill[ballot.position]:'transparent'} style={ballot?undefined:{stroke:'var(--line)',strokeWidth:Math.max(1,seat.r*.18)}} data-dimmed={dimmed(seat)?'true':undefined} tabIndex={seat.seat===(active??seats[0]?.seat)?0:-1} role="button" aria-label={labels.get(seat.seat)} onPointerDown={markPointer} onClick={event=>clickSeat(event,seat)} onFocus={()=>setActive(seat.seat)} onPointerEnter={()=>setHovered(seat.seat)} onPointerLeave={()=>setHovered(null)} onKeyDown={event=>keySeat(event,seat)}>
              <title>{labels.get(seat.seat)}</title>
            </circle>;
          }),[seats,ballots,view,differIds,active,labels]);
  return <section className="vote-seats" lang={ui.language} aria-labelledby={headingId}>
    <div className="insight-section-heading">
      <h4 id={headingId}><UiMessage id="voteSeats.heading"/></h4>
      <div className="insight-chart-switch" role="group" aria-label={ui.t('voteSeats.view')}>
        <button type="button" aria-pressed={view==='all'} onClick={()=>setView('all')}><UiMessage id="voteSeats.view.all"/></button>
        <button type="button" aria-pressed={view==='differ'} onClick={()=>setView('differ')}>{ui.t('voteSeats.view.differ',{count:String(differIds.size)})}</button>
      </div>
    </div>
    {!plan?<p className="insight-secondary" role={state.error?'alert':'status'}>{state.error?<UiMessage id="voteSeats.unavailable"/>:<UiMessage id="insightshared.loading"/>}</p>:<>
      <figure className="vote-seats-chart">
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} role="group" aria-label={ui.t('voteSeats.chart')} onClick={clickChart}>
          {circles}
          {selected&&<circle className="vote-seat-selected" cx={selected.x} cy={selected.y} r={selected.r*1.9} style={{strokeWidth:Math.max(1.5,selected.r*.4)}}/>}
        </svg>
        <figcaption className="vote-seat-info" aria-live="polite">{selected?<>{fullName(selected)} · <span lang={groupLabelLanguage(selected.group||'',ui)}>{groupLabel(selected.group||'',ui)}</span> · {countryName(selected.country||'',language)} · {positionLabel(selected,selectedBallot||undefined)}{selectedBallot&&differIds.has(selectedBallot.id)&&<> · <UiMessage id="voteSeats.differs"/></>}{selectedBallot&&<button type="button" className="insight-text-button" onClick={()=>openMember(selected)}><UiMessage id="hemicycle.openMember"/></button>}</>:<UiMessage id="voteSeats.pick"/>}</figcaption>
      </figure>
      <p className="insight-chart-caption"><UiMessage id="voteSeats.caption"/></p>
      {(dotted.for||dotted.against||dotted.abstaining)>0&&<div className="vote-seat-unseated"><p className="insight-chart-caption"><UiMessage id="voteSeats.unseated"/></p>{votePositionKeys.filter(position=>dotted[position]).map(position=><div key={position} className="vote-seat-dots-row"><span className={'vote-seat-dots-label vote-'+position}>{positions[position]} <strong>{dotted[position]}</strong></span><span className="vote-seat-dots" aria-hidden="true">{Array.from({length:dotted[position]},(_,index)=><i key={index} className={'vote-'+position}/>)}</span></div>)}</div>}
    </>}
    <table className="vote-seats-sr">
      <caption><UiMessage id="voteSeats.table"/></caption>
      <thead><tr><th scope="col"><UiMessage id="groupvoices.political_group.c2db1f"/></th>{votePositionKeys.map(position=><th key={position} scope="col">{positions[position]}</th>)}</tr></thead>
      <tbody>{groupCodes.map(code=><tr key={code}><th scope="row" lang={groupLabelLanguage(code,ui)}>{groupLabel(code,ui)}</th>{groupCounts(code).map((count,index)=><td key={index}>{count}</td>)}</tr>)}</tbody>
      <tfoot><tr><th scope="row"><UiMessage id="voteSeats.table.total"/></th>{votePositionKeys.map(position=><td key={position}>{rows.filter(row=>row.position===position).length}</td>)}</tr></tfoot>
    </table>
  </section>;
}

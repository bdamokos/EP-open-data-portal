import {useMemo,useState,type KeyboardEvent,PointerEvent} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useExplorerParam} from './explorerUrl';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {countryName} from './CountryMap';
import {nearestSeat,type HemicycleSeat} from './hemicycleModel.mjs';
import {groupMajorities} from './voteGroupMetrics.mjs';
import {seatBallots,unseatedDotTotals,type SeatBallotVoter} from './voteSeatsModel.mjs';
import {positionsUi} from './Legislation';
import type {NamedVote} from './LegislationTypes';
import './VoteSeats.css';

type HemicyclePlan={chamber:string;sourcePageUrl:string;sourceDate:string|null;width:number;height:number;seats:HemicycleSeat[]};
type Props={vote:NamedVote;rows:{id?:string;group:string|null;country?:string|null;position:'for'|'against'|'abstaining'|null}[];sittingId:string;language:string;onMember?:(id:number,sourceId?:string)=>void};
const positionFill={for:'var(--vote-for)',against:'var(--vote-against)',abstaining:'var(--vote-abstain)'};
const chamberFor=(location:string|null|undefined)=>location==='Brussels'?'bru':'str';

export function VoteSeats({vote,rows,sittingId,language,onMember}:Props) {
  const ui=useUiI18n();
  const [view,setView]=useExplorerParam<'all'|'differ'>('agenda-seat-view','all',['all','differ']);
  const [picked,setPicked]=useState<number|null>(null);
  const calendar=useData<VotePeriodsResponse>('vote-periods',{unavailable:'error.records'});
  const chamber=useMemo(()=>{
    if(!calendar.data||!validateVotePeriods(calendar.data))return 'str';
    return chamberFor(calendar.data.weeks.flatMap(week=>week.sittings).find(sitting=>sitting.sittingId===sittingId)?.location);
  },[calendar.data,sittingId]);
  const state=useData<HemicyclePlan>(`hemicycle/${chamber}`,{unavailable:'error.unavailable'});
  const plan=(state.data?.chamber===chamber)?state.data:null;
  const voters=useMemo<SeatBallotVoter[]>(()=>(['for','against','abstaining'] as const).flatMap(position=>(vote.groups?.[position]||[]).map(person=>({id:person.id,position}))),[vote]);
  const seats=useMemo(()=>plan?.seats.filter(seat=>seat.member)||[],[plan]);
  const ballots=useMemo(()=>seatBallots(voters,seats),[voters,seats]);
  const differIds=useMemo(()=>new Set(rows.filter(row=>row.id).map(row=>String(row.id)) as string[]),[rows]);
  const positions=positionsUi(ui);
  const label=(seat:HemicycleSeat,position:string|null)=>`${seat.name||''} ${seat.firstName||''}`.trim()+` · `+groupLabel(seat.group||'',ui)+` · `+countryName(seat.country||'',language)+` · `+(position?positions[position as keyof typeof positions]:ui.t('voteSeats.noRecord'))+(view==='differ'?` · `+ui.t('voteSeats.differs'):'');
  const select=(seat:HemicycleSeat|null)=>{setPicked(seat?seat.seat:null);};
  const openMember=(seat:HemicycleSeat)=>{const ballot=ballots.bySeat.get(seat.seat);if(ballot)onMember?.(Number(ballot.id));};
  const press=(event:PointerEvent<SVGSVGElement>)=>{
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const seat=nearestSeat(seats,point.x,point.y,14/matrix.a);
    if(!seat)return;
    if(event.pointerType==='mouse'){select(seat);openMember(seat);}
    else if(picked===seat.seat)openMember(seat);
    else select(seat);
  };
  const move=(event:KeyboardEvent<SVGSVGElement>)=>{
    const order=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].indexOf(event.key);
    if(order<0)return;
    event.preventDefault();
    if(!seats.length)return;
    const current=seats.findIndex(seat=>seat.seat===picked),at=current<0?0:current;
    const next=(order===4)?0:((order===5)?seats.length-1:Math.min(seats.length-1,Math.max(0,at+(order<2?1:-1))));
    const seat=seats[next];
    select(seat);
    event.currentTarget.querySelector<SVGCircleElement>(`[data-seat="${seat.seat}"]`)?.focus();
  };
  const dotted=unseatedDotTotals(voters,seats);
  const selected=picked===null?null:seats.find(seat=>seat.seat===picked);
  const selectedBallot=selected?ballots.bySeat.get(selected.seat):null;
  const majorities=useMemo(()=>groupMajorities(rows),[rows]);
  const counts=(code:string)=>(['for','against','abstaining'] as const).map(position=>rows.filter(row=>row.group===code&&row.position===position).length);
  const dimmed=(seat:HemicycleSeat,position:string|null)=>view==='differ'&&(!position||!differIds.has(ballots.bySeat.get(seat.seat)!.id));
  return <section className="vote-seats" lang={ui.language} aria-labelledby={undefined}>
    <div className="insight-section-heading"><h4><UiMessage id="voteSeats.heading"/></h4><div className="insight-chart-switch" role="group" aria-label={ui.t('voteSeats.view')}><button type="button" aria-pressed={view==='all'} onClick={()=>setView('all')}><UiMessage id="voteSeats.view.all"/></button><button type="button" aria-pressed={view==='differ'} onClick={()=>setView('differ')}><UiMessage id="voteSeats.view.differ"/></button></div></div>
    {!plan?<p className="insight-secondary" role={(state.error)?'alert':'status'}>{state.error?<UiMessage id="voteSeats.unavailable"/>:<UiMessage id="insightshared.loading"/>}</p>:<>
      <figure className="vote-seats-chart">
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} role="group" aria-label={ui.t('voteSeats.chart')} onPointerDown={press} onKeyDown={move}>
          {seats.map(seat=>{
            const ballot=ballots.bySeat.get(seat.seat),position=ballot?ballot.position:null;
            return <circle key={seat.seat} data-seat={seat.seat} cx={seat.x} cy={seat.y} r={seat.r} fill={position?positionFill[position]:'transparent'} style={position?undefined:{stroke:'var(--line)',strokeWidth:Math.max(1,seat.r*.18)}} data-dimmed={dimmed(seat,position)?'true':undefined} tabIndex={picked===seat.seat||(picked===null&&seat===seats[0])?0:-1} role="button" aria-label={label(seat,position)} onClick={()=>{if(picked===seat.seat)openMember(seat);else select(seat);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openMember(seat);}}}>
              <title>{label(seat,position)}</title>
            </circle>;
          })}
          {selected&&<circle className="vote-seat-selected" cx={selected.x} cy={selected.y} r={selected.r*1.9} style={{strokeWidth:Math.max(1.5,selected.r*.4)}}/>}
        </svg>
        <figcaption className="vote-seat-info" aria-live="polite">{selected?(selectedBallot?<>{`${selected.name||''} ${selected.firstName||''}`.trim()} · <span lang={groupLabelLanguage(selected.group||'',ui)}>{groupLabel(selected.group||'',ui)}</span> · {countryName(selected.country||'',language)} · {positions[selectedBallot.position]} <button type="button" className="insight-text-button" onClick={()=>openMember(selected)}><UiMessage id="hemicycle.openMember"/></button></>:<UiMessage id="voteSeats.noRecord"/>):<UiMessage id="voteSeats.pick"/>}</figcaption>
      </figure>
      {(dotted.for||dotted.against||dotted.abstaining)>0&&<div className="vote-seat-unseated"><p className="insight-chart-caption"><UiMessage id="voteSeats.unseated"/></p>{(['for','against','abstaining'] as const).filter(position=>dotted[position]).map(position=><div key={position} className="vote-seat-dots-row"><span className={'vote-seat-dots-label vote-'+position}>{positions[position]} <strong>{dotted[position]}</strong></span><span className="vote-seat-dots" aria-hidden="true">{Array.from({length:dotted[position]},(_,index)=><i key={index} className={'vote-'+position}/>)}</span></div>)}</div>}
    </>}
    <table className="vote-seats-sr">
      <caption><UiMessage id="voteSeats.table"/></caption>
      <thead><tr><th scope="col"><UiMessage id="groupvoices.political_group.c2db1f"/></th>{(['for','against','abstaining'] as const).map(position=><th key={position} scope="col">{positions[position]}</th>)}</tr></thead>
      <tbody>{majorities.map(group=><tr key={group.code}><th scope="row" lang={groupLabelLanguage(group.code,ui)}>{groupLabel(group.code,ui)}</th>{counts(group.code).map((count,index)=><td key={index}>{count}</td>)}</tr>)}</tbody>
    </table>
  </section>;
}

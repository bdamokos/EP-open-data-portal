import type {MemberVote} from './MemberVotesTypes';
import {memberVoteOutcome,memberVotePosition,memberVoteTotals} from './memberVotesPresentation.mjs';
import './MemberVotes.css';
type ResultVote=Pick<MemberVote,'outcome'|'totals'|'ballotStatus'>;
type PositionVote=Pick<MemberVote,'actualPosition'|'ballotStatus'|'method'>;
export function Result({vote,showMissingTotals=true,showPartialTotals=false}:{vote:ResultVote;showMissingTotals?:boolean;showPartialTotals?:boolean}) {
  const totals=memberVoteTotals(vote),outcome=memberVoteOutcome(vote);
  return <span className="member-votes-result">
    <span className="member-votes-result-heading"><span>Parliament</span><strong>{outcome}</strong></span>
    {totals?<>
      {totals.total>0&&<span className="member-votes-bar" role="img" aria-label={`For ${totals.for}, Against ${totals.against}, Abstaining ${totals.abstaining}`}>
        {(['for','against','abstaining'] as const).map(position=><span key={position} className={'member-votes-'+position} style={{width:(100*totals[position]/totals.total)+'%'}}/>)}</span>}
      <span className="member-votes-counts"><span>For <b>{totals.for}</b></span><span>Against <b>{totals.against}</b></span><span>Abstaining <b>{totals.abstaining}</b></span></span>
    </>:showPartialTotals&&vote.ballotStatus==='conducted'&&['for','against','abstaining'].some(key=>typeof vote.totals?.[key as keyof typeof vote.totals]==='number')?<span className="member-votes-counts">{(['for','against','abstaining'] as const).map(key=><span key={key}>{{for:'For',against:'Against',abstaining:'Abstaining'}[key]} <b>{vote.totals[key]??'—'}</b></span>)}</span>:showMissingTotals?<span className="member-votes-muted">{vote.ballotStatus==='not-conducted'?'Not put to a vote':'Tallies unavailable'}</span>:null}
  </span>;
}

export function Position({vote,memberName,compact=false}:{vote:PositionVote;memberName:string;compact?:boolean}) {
  const label=memberVotePosition(vote),position=label==='For'?'for':label==='Against'?'against':label==='Abstained'?'abstaining':'unknown';
  return <span className={'member-votes-position member-votes-position-'+position+(compact?' member-votes-position-compact':'')}><span className="member-votes-position-label">{memberName}{compact&&['For','Against','Abstained'].includes(label)?' voted':''}{compact?' ':''}</span><strong>{label}</strong></span>;
}


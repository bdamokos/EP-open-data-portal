import {UiMessage, useUiI18n} from './UiI18nReact';
import {selectLanguageText} from './language.mjs';
import type {MemberVote} from './MemberVotesTypes';
import {memberVoteOutcome,memberVotePositionState,memberVotePosition,memberVoteTotals} from './memberVotesPresentation.mjs';
import './MemberVotes.css';
type ResultVote=Pick<MemberVote,'outcome'|'totals'|'ballotStatus'>;
type PositionVote=Pick<MemberVote,'actualPosition'|'ballotStatus'|'method'>;
export function Result({vote,showMissingTotals=true,showPartialTotals=false}:{vote:ResultVote;showMissingTotals?:boolean;showPartialTotals?:boolean}) {
  const ui = useUiI18n();
  const totals=memberVoteTotals(vote),outcome=memberVoteOutcome(vote, ui);
  const noPublishedTotals=(['for','against','abstaining'] as const).every(key=>vote.totals[key]===null);
  return <span className="member-votes-result"><>{<span className="member-votes-result-heading"><span><UiMessage id="membervotesummary.parliament"/></span><strong>{outcome}</strong></span>} {(totals ? <>
      {totals.total>0&&<span className="member-votes-bar" role="img" aria-label={ui.t("membervotesummary.for_for_against_against_abstaining_abstaining", {for: String(totals.for), against: String(totals.against), abstaining: String(totals.abstaining)})}>
        {(['for','against','abstaining'] as const).map(position=><span key={position} className={'member-votes-'+position} style={{width:(100*totals[position]/totals.total)+'%'}}/>)}</span>}
      <span className="member-votes-counts"><span><UiMessage id="membervotesummary.for_count" values={{count: <b>{totals.for}</b>}}/></span><span><UiMessage id="membervotesummary.against_count" values={{count: <b>{totals.against}</b>}}/></span><span><UiMessage id="membervotesummary.abstaining_count" values={{count: <b>{totals.abstaining}</b>}}/></span></span>
    </> : (((showPartialTotals && (vote.ballotStatus!=='not-conducted')) && ['for','against','abstaining'].some(key=>typeof vote.totals?.[key as keyof typeof vote.totals]==='number')) ? <span className="member-votes-counts">{(['for','against','abstaining'] as const).map(key=><span key={key}>{{for:ui.t("membervotespresentation.for"),against:ui.t("membervotespresentation.against"),abstaining:ui.t("membervotesummary.abstaining")}[key]} <b>{vote.totals[key]??'—'}</b></span>)}</span> : (showMissingTotals ? <span className="member-votes-muted">{(vote.ballotStatus==='not-conducted') ? ui.t("activityvote.not_put_to_a_vote") : (((vote.ballotStatus==='conducted') && noPublishedTotals) ? ui.t("membervotesummary.no_tally_published") : ui.t("membervotesummary.tallies_unavailable"))}</span> : null)))}</></span>;
}

export function Position({vote,memberName,compact=false}:{vote:PositionVote;memberName:string;compact?:boolean}) {
  const ui=useUiI18n();
  const label=memberVotePosition(vote,ui),state=memberVotePositionState(vote),recorded=['for','against','abstaining'].includes(state);
  const position=recorded?state:'unknown';
  return <span className={'member-votes-position member-votes-position-'+position+(compact?' member-votes-position-compact':'')}>{ui.language==='ro'||ui.language==='lt' ? ui.rich('membervotesummary.fullPosition.'+state,{memberName:<span className="member-votes-position-label" lang="">{memberName}</span>}).map((part,index)=>typeof part==='string'?<strong key={index}>{part}</strong>:<span key={index}>{part}</span>) : <UiMessage id={compact&&recorded?'membervotesummary.membername_voted_position':'membervotesummary.membername_position'} values={{memberName:<span className="member-votes-position-label" lang="">{memberName}</span>,position:<strong>{label}</strong>}}/>}</span>;
}


export function VotePartDescriptions({vote,language}:{vote:Pick<MemberVote,'parts'>;language:string}) {
  return <>{vote.parts.map(part=>{
    const text=selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
    return text.text ? <section className="member-votes-part" key={part.componentId}><h3><UiMessage id={part.number!==null ? "membervotesummary.published_description_of_part_number" : "membervotesummary.published_description"} values={{number:part.number??''}}/></h3><p lang={text.language}>{text.text}</p></section> : null;
  })}</>;
}

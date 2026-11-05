import {UiMessage,useUiI18n} from './UiI18nReact';
import {positionsUi,votePositionKeys,type VotePosition} from './votePositions';
import {VoteGroupSummary} from './VoteGroupSummary';
import type {GroupMajority,VoteMetricRow} from './voteGroupMetrics.mjs';
import './VoteBreakdown.css';

type Totals=Partial<Record<VotePosition,number|null>>;
const outcomeIds=new Set(['ADOPTED','REJECTED','LAPSED'])
const methodIds=new Set(['VOTE_HAND','VOTE_ELECTRONIC']);

export function VoteBar({totals,thin=false}:{totals:Record<VotePosition,number>;thin?:boolean}) {
  const sum=votePositionKeys.reduce((n,position)=>n+totals[position],0);
  if(sum<=0)return null;
  return <div className={'vote-bar'+(thin?' vote-bar-thin':'')} aria-hidden="true">{votePositionKeys.map(position=>totals[position]>0&&<i key={position} className={'vote-'+position} style={{width:`${totals[position]/sum*100}%`}}/>)}</div>;
}

// The headline of a plenary vote: outcome in words, the three totals, a
// proportional bar and the group line. Unknown totals stay a dash, never 0.
export function VoteResult({outcome,method,aggregate,scoped,groups,rows}:{outcome:string;method?:string;aggregate:Totals;scoped?:Record<VotePosition,number>|null;groups:GroupMajority[];rows:VoteMetricRow[]}) {
  const ui=useUiI18n(),positions=positionsUi(ui);
  const known=votePositionKeys.every(position=>typeof aggregate[position]==='number');
  const barTotals=(scoped||(known?aggregate:null)) as Record<VotePosition,number>|null;
  return <section className="vote-result" lang={ui.language}>
    <p className="vote-result-outcome" data-outcome={outcome}>{outcomeIds.has(outcome)?<UiMessage id={'votegroups.result.outcome.'+outcome}/>:outcome.toLowerCase()}{method&&methodIds.has(method)&&<small className="vote-result-method"><UiMessage id={'votegroups.result.method.'+method}/></small>}</p>
    <div className="vote-result-totals">{votePositionKeys.map(position=><div key={position} className={'vote-'+position}>
      <span>{positions[position]}</span>
      <strong>{scoped?scoped[position]:(aggregate[position]??ui.t('votegroups.result.unknown'))}</strong>
      {scoped&&<small><UiMessage id="votegroups.result.ofParliament" values={{count:aggregate[position]??ui.t('votegroups.result.unknown')}}/></small>}
    </div>)}</div>
    {barTotals&&<VoteBar totals={barTotals}/>}
    <VoteGroupSummary groups={groups} rows={rows}/>
  </section>;
}

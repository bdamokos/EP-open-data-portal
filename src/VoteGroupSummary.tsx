import {UiMessage,useUiI18n} from './UiI18nReact';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {allGroupsAgree,differentFromMajority,type GroupMajority,type VoteMetricRow} from './voteGroupMetrics.mjs';
import './VoteGroupSummary.css';
export function GroupUnity({metric,withPosition=false}:{metric?:GroupMajority;withPosition?:boolean}) {
  const ui=useUiI18n();
  if(!metric)return null;
  if(!metric.majority)return <span className="vote-group-unity"><UiMessage id="votegroups.split"/></span>;
  return <span className="vote-group-unity">{withPosition&&<>{ui.t('votegroups.position.'+metric.majority)} · </>}<UiMessage id="votegroups.unity" values={{percent:new Intl.NumberFormat(ui.language,{style:'percent',maximumFractionDigits:0}).format(metric.unity!),count:metric.counts[metric.majority],total:metric.voters}}/></span>;
}
export function VoteGroupSummary({groups,rows}:{groups:GroupMajority[];rows:VoteMetricRow[]}) {
  const ui=useUiI18n();
  if(!groups.length)return null;
  return <div className="vote-group-summary" lang={ui.language}>
    {allGroupsAgree(groups)?<p><UiMessage id={'votegroups.all_agree.'+groups[0].majority}/></p>:(['for','against','abstaining',null] as const).map(position=>{
      const matching=groups.filter(g=>g.majority===position);
      return matching.length>0&&<p key={position??'split'}><UiMessage id={'votegroups.line.'+(position??'split')} values={{groups:matching.map((g,i)=><span key={g.code} lang={groupLabelLanguage(g.code,ui)}>{i?', ':''}{groupLabel(g.code,ui)}</span>)}}/></p>;
    })}
    <p><UiMessage id="votegroups.voted_differently" values={{count:differentFromMajority(rows)}} counts={{count:differentFromMajority(rows)}}/></p>
  </div>;
}

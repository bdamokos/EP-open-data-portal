import {UiMessage,useUiI18n} from './UiI18nReact';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {allGroupsAgree,differentFromMajority,type GroupMajority,type VoteMetricRow} from './voteGroupMetrics.mjs';
import './VoteGroupSummary.css';
export function GroupUnity({metric,withPosition=false}:{metric?:GroupMajority;withPosition?:boolean}) {
  const ui=useUiI18n();
  if(!metric)return null;
  if(!metric.majority)return <span className="vote-group-unity" lang={ui.messageLocale('votegroups.split')}><UiMessage id="votegroups.split"/></span>;
  const positionId='votegroups.position.'+metric.majority;
  const share=metric.counts[metric.majority]===metric.voters?1:Math.min(0.99,metric.unity!);
  const percent=new Intl.NumberFormat(ui.messageLocale('votegroups.unity'),{style:'percent',maximumFractionDigits:0}).format(share);
  return <span className="vote-group-unity">{withPosition&&<><span lang={ui.messageLocale(positionId)}>{ui.t(positionId)}</span> · </>}<span lang={ui.messageLocale('votegroups.unity')}><UiMessage id="votegroups.unity" values={{percent,voters:<span className="vote-group-unity-count" lang={ui.messageLocale('votegroups.unity.count')}><UiMessage id="votegroups.unity.count" values={{count:metric.counts[metric.majority],total:metric.voters}}/></span>}}/></span></span>;
}
export function VoteGroupSummary({groups,rows}:{groups:GroupMajority[];rows:VoteMetricRow[]}) {
  const ui=useUiI18n();
  if(!groups.length)return null;
  return <div className="vote-group-summary">
    {allGroupsAgree(groups)?<p lang={ui.messageLocale('votegroups.all_agree.'+groups[0].majority)}><UiMessage id={'votegroups.all_agree.'+groups[0].majority}/></p>:(['for','against','abstaining',null] as const).map(position=>{
      const matching=groups.filter(g=>g.majority===position);
      return matching.length>0&&<p key={position??'split'} lang={ui.messageLocale('votegroups.line.'+(position??'split'))}><UiMessage id={'votegroups.line.'+(position??'split')} values={{groups:matching.map((g,i)=><span key={g.code} lang={groupLabelLanguage(g.code,ui)}>{i?', ':''}{groupLabel(g.code,ui)}</span>)}}/></p>;
    })}
    <p lang={ui.messageLocale("votegroups.voted_differently")}><UiMessage id="votegroups.voted_differently" values={{count:differentFromMajority(rows)}} counts={{count:differentFromMajority(rows)}}/></p>
  </div>;
}

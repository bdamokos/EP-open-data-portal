import {UiMessage, useUiI18n} from './UiI18nReact';
import {useData} from './data';
import type {JoinedActivityPage} from './explorerTypes';
import {memberOverviewItems,memberOverviewVotesRoute,type MemberOverviewItem} from './memberOverviewModel.mjs';
import './MemberOverview.css';

type VoteSummary=Parameters<typeof memberOverviewItems>[0]['votes'];

export function MemberOverview({member,language,onSpeeches,onActivities,onVotes}:{member:number;language:string;onSpeeches:()=>void;onActivities:(category:string)=>void;onVotes:(week:string)=>void}) {
  const ui=useUiI18n();
  const activities=useData<JoinedActivityPage>(`latest-activities/${member}?lang=${language}&limit=1`,{unavailable:'error.activity',automatic:false});
  const votes=useData<NonNullable<VoteSummary>>(memberOverviewVotesRoute(member),{unavailable:'error.unavailable',automatic:false});
  const failed=[activities,votes].every(read=>read.failure!==null&&!read.data);
  const pending=[activities,votes].some(read=>read.loading&&!read.data&&read.failure===null);
  const items=memberOverviewItems({activities:activities.data,votes:votes.data});
  if(failed||(!pending&&!items.length))return null;
  const open=(item:MemberOverviewItem)=>item.target==='speeches'?onSpeeches():item.target==='votes'?onVotes(item.week!):onActivities(item.category||'');
  return <div className="member-overview" lang={ui.language} aria-busy={pending||undefined}>
    {[items.filter(item=>item.target!=='votes'),items.filter(item=>item.target==='votes')].map((group,index)=><ul key={index}>{group.map(item=><li key={item.key} data-overview={item.key}>
      <button type="button" onClick={()=>open(item)}><UiMessage id={item.other} values={{count:<b>{item.count}</b>,against:<b>{item.against}</b>}} counts={{count:item.count}}/></button>
    </li>)}</ul>)}
  </div>;
}

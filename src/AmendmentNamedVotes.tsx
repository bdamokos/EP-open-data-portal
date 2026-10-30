import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import {useEffect,useRef,useState} from 'react';
import {useData} from './data';
import {PersonName} from './PersonName';
import {insightMemberHref} from './InsightShared';
import {groupLabel} from './InsightCharts';
import {knownVoteMethodLabel} from './voteMethod.mjs';
import type {Amendment,AmendmentDecision} from './AmendmentTypes';
import type {DecisionVoter,DecisionVotesResponse} from './DecisionVotesTypes';
import {amendmentVoteBinding,authorVotePosition,decisionVotesRoute,validateDecisionVotes} from './decisionVotesPresentation.mjs';
import './AmendmentNamedVotes.css';

const choices=['for','against','abstaining'] as const;
const labels={for:'For',against:'Against',abstaining:'Abstained'};
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({for:ui.t("membervotespresentation.for"),against:ui.t("membervotespresentation.against"),abstaining:ui.t("membervotespresentation.abstained")});

const keyOf=(voter:DecisionVoter)=>voter.group?.groupId??'unavailable';
function GroupVotes({voters,code,language}:{voters:DecisionVoter[];code:string|null;language:string}) {
  const ui = useUiI18n();
  const [showAll,setShowAll]=useState(false),name=code ? groupLabel(code,ui) : ui.t("amendmentnamedvotes.tsx.group.unknown");
  return <details className="amendment-named-votes__group"><summary><span lang={code ? '' : 'en'}>{name}</span><span className="amendment-vote-strip" aria-hidden="true">{choices.map(position=><span key={position} data-position={labels[position]} style={{flexGrow:voters.filter(v=>v.position===position).length}}/>)}</span><span className="amendment-group-counts">{choices.map(position=><span key={position}><b>{voters.filter(v=>v.position===position).length.toLocaleString(language)}</b> {labelsUi(ui)[position].toLocaleLowerCase(ui.locale)}</span>)}</span></summary>
    <div className="amendment-named-votes__people" aria-label={ui.t("amendmentnamedvotes.tsx.named.voters.group", {group: String(name)})}>{choices.map(position=>{const people=voters.filter(v=>v.position===position);return people.length>0&&<section key={position}><h6><>{labelsUi(ui)[position]} ({people.length.toLocaleString(language)})</></h6><ul>{(showAll ? people : people.slice(0,12)).map(voter=><li key={voter.personId}><a href={insightMemberHref(voter.personId,language)}><PersonName id={voter.personId} fallback={ui.t("amendmentnamedvotes.tsx.mep.id", {id: String(voter.personId)})}/></a><RecordMemberAffiliation id={voter.personId} datedGroup={voter.group?.code} language={language}/></li>)}</ul></section>;})}{choices.some(position=>voters.filter(v=>v.position===position).length>12)&&<button type="button" onClick={()=>setShowAll(!showAll)}>{showAll ? <UiMessage id="amendmentnamedvotes.tsx.show.fewer.names"/> : <UiMessage id="amendmentnamedvotes.tsx.show.all.names"/>}</button>}</div>
  </details>;
}
function NamedVoteRead({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const ui = useUiI18n();
  const request=useData<DecisionVotesResponse>(decisionVotesRoute(decision.id,language));
  const data=(((!request.error) && (!request.loading)) && validateDecisionVotes(request.data,decision.id)) ? request.data : null;
  const bound=data?.status==='found'&&amendmentVoteBinding(item,decision,data);
  if(request.loading)return <p role="status"><UiMessage id="amendmentnamedvotes.tsx.loading.named.votes"/></p>;
  if(!data||data.status!=='found')return <p><UiMessage id="amendmentnamedvotes.tsx.named.votes.unavailable"/> <button type="button" onClick={request.retry}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>;
  if(!bound)return <p><UiMessage id="amendmentnamedvotes.tsx.vote.record.does.not.match.this.amendment"/></p>;
  if(data.decision!.ballotStatus==='not-conducted')return <p><UiMessage id="amendmentnamedvotes.tsx.not.put.to.a.vote"/></p>;
  if(data.decision!.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p>{knownVoteMethodLabel(data.decision!.method, ui) ? <UiMessage id="amendmentnamedvotes.tsx.not.individually.recorded"/> : <UiMessage id="amendmentnamedvotes.tsx.named.votes.unavailable"/>}</p>;
  if(data.integrity==='unavailable'||data.integrity==='conflicting')return <p><UiMessage id="amendmentnamedvotes.tsx.named.votes.unavailable"/> <button type="button" onClick={request.retry}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>;
  const groups=[...new Map(data.voters.map(voter=>[keyOf(voter),voter.group?.code??null])).entries()].sort(([a,ac],[b,bc])=>(a==='unavailable') ? 1 : ((b==='unavailable') ? (-1) : ((ac??'').localeCompare(bc??'')||a.localeCompare(b))));
  const authors=item.conflicted ? ([]) : ([...new Map((item.authors||[]).map((author,index)=>[author.personId ? String(author.personId) : ('unresolved:'+index),author])).values()]);
  return <>
    {item.conflicted&&<p><UiMessage id="amendmentnamedvotes.tsx.author.votes.withheld.sources.conflict"/></p>}
    {data.integrity==='partial'&&<p><UiMessage id="amendmentnamedvotes.tsx.named.list.incomplete.group.totals.unavailable"/></p>}
    {authors.length>0&&<section aria-label={ui.t("amendmentnamedvotes.tsx.authors.votes")}><ul className="amendment-named-votes__authors">{authors.map((author,index)=>{
      const personId=String(author.personId??''),voter=data.voters.find(row=>row.personId===personId);
      const recorded=/^[1-9]\d*$/.test(personId)&&voter?.status==='recorded';
      const action=!/^[1-9]\d*$/.test(personId)?'mep_unresolved':voter?.status==='conflicting'?'conflicting_record':recorded?({for:'voted.for',against:'voted.against',abstaining:'abstained'} as const)[voter!.position!]:(data.integrity==='complete'?'has.no.recorded.vote':'unavailable');
      const id=`amendmentnamedvotes.tsx.author.${action}${recorded&&decision.partNumber!=null?'.on.part.part':''}`;
      const authorNode=<><span lang="" title={author.name}><PersonName id={author.personId} label={author.displayName||author.name}/></span><RecordMemberAffiliation id={author.personId} datedGroup={voter?.group?.code} language={language}/></>;
      return <li key={index}>{ui.rich(id,{author:authorNode,part:String(decision.partNumber??'')}).map((part,index)=>typeof part==='string'?<strong key={index} data-position={authorVotePosition(author.personId,data)}>{part}</strong>:<span key={index}>{part}</span>)}</li>;
    })}</ul></section>}
    {(data.integrity==='complete'||data.groupHistory===null)&&<details className="amendment-named-votes__groups"><summary><UiMessage id="amendmentnamedvotes.tsx.how.groups.voted"/></summary>{(data.groupHistory===null) ? <p><UiMessage id="amendmentnamedvotes.tsx.groups.unavailable.for.this.date"/></p> : ((data.integrity==='complete') ? groups.map(([group,code])=><GroupVotes key={group} code={code} voters={data.voters.filter(voter=>keyOf(voter)===group)} language={language}/>) : null)}</details>}
  </>;
}
// Named positions load when the decision approaches the viewport, sharing the
// bounded sitting snapshot. No observer support leaves an ordinary read.
function VisibleVoteRead(props:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(typeof IntersectionObserver==='undefined');
  useEffect(()=>{if(visible||!ref.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'160px'});observer.observe(ref.current);return ()=>observer.disconnect();},[visible]);
  return <div ref={ref} className="amendment-named-votes">{visible&&<NamedVoteRead {...props}/>}</div>;
}
export function AmendmentNamedVotes(props:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const ui = useUiI18n();
  const {decision,language}=props;
  if(['LAPSED','WITHDRAWN'].includes(decision.outcome??''))return null;
  if(['CANCELLED','CANCELED','NOT_HELD'].includes(decision.outcome??''))return <p className="explorer-amendment-secondary"><UiMessage id="amendmentnamedvotes.tsx.not.put.to.a.vote"/></p>;
  if(decision.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p className="explorer-amendment-secondary">{knownVoteMethodLabel(decision.method, ui) ? <UiMessage id="amendmentnamedvotes.tsx.not.individually.recorded"/> : <UiMessage id="amendmentnamedvotes.tsx.named.votes.unavailable"/>}</p>;
  if(['unverified','unresolved-collective'].includes(decision.componentBinding??'')||decision.partNumber!=null&&!decision.partId||decision.partId&&decision.componentBinding!=='single-amendment')return null;
  if(!decisionVotesRoute(decision.id,language))return null;
  return <VisibleVoteRead key={decision.id+':'+language} {...props}/>;
}

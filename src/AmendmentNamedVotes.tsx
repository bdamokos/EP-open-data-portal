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
const keyOf=(voter:DecisionVoter)=>voter.group?.groupId??'unavailable';
function GroupVotes({voters,code,language}:{voters:DecisionVoter[];code:string|null;language:string}) {
  const [showAll,setShowAll]=useState(false),name=code?groupLabel(code):'Group unknown';
  return <details className="amendment-named-votes__group"><summary><span lang={code?'':'en'}>{name}</span><span className="amendment-vote-strip" aria-hidden="true">{choices.map(position=><span key={position} data-position={labels[position]} style={{flexGrow:voters.filter(v=>v.position===position).length}}/>)}</span><span className="amendment-group-counts">{choices.map(position=><span key={position}><b>{voters.filter(v=>v.position===position).length.toLocaleString(language)}</b> {labels[position].toLowerCase()}</span>)}</span></summary>
    <div className="amendment-named-votes__people" aria-label={'Named voters: '+name}>{choices.map(position=>{const people=voters.filter(v=>v.position===position);return people.length>0&&<section key={position}><h6>{labels[position]} ({people.length.toLocaleString(language)})</h6><ul>{(showAll?people:people.slice(0,12)).map(voter=><li key={voter.personId}><a href={insightMemberHref(voter.personId,language)}><PersonName id={voter.personId} fallback={'MEP '+voter.personId}/></a><RecordMemberAffiliation id={voter.personId} datedGroup={voter.group?.code} language={language}/></li>)}</ul></section>;})}{choices.some(position=>voters.filter(v=>v.position===position).length>12)&&<button type="button" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer names':'Show all names'}</button>}</div>
  </details>;
}
function NamedVoteRead({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const request=useData<DecisionVotesResponse>(decisionVotesRoute(decision.id,language));
  const data=!request.error&&!request.loading&&validateDecisionVotes(request.data,decision.id)?request.data:null;
  const bound=data?.status==='found'&&amendmentVoteBinding(item,decision,data);
  if(request.loading)return <p role="status">Loading named votes…</p>;
  if(!data||data.status!=='found')return <p>Named votes unavailable. <button type="button" onClick={request.retry}>Retry</button></p>;
  if(!bound)return <p>Vote record does not match this amendment.</p>;
  if(data.decision!.ballotStatus==='not-conducted')return <p>Not put to a vote.</p>;
  if(data.decision!.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p>{knownVoteMethodLabel(data.decision!.method)?'Not individually recorded.':'Named votes unavailable.'}</p>;
  if(data.integrity==='unavailable'||data.integrity==='conflicting')return <p>Named votes unavailable. <button type="button" onClick={request.retry}>Retry</button></p>;
  const groups=[...new Map(data.voters.map(voter=>[keyOf(voter),voter.group?.code??null])).entries()].sort(([a,ac],[b,bc])=>a==='unavailable'?1:b==='unavailable'?-1:(ac??'').localeCompare(bc??'')||a.localeCompare(b));
  const authors=item.conflicted?[]:[...new Map((item.authors||[]).map((author,index)=>[author.personId?String(author.personId):'unresolved:'+index,author])).values()];
  return <>
    {item.conflicted&&<p>Author votes withheld: sources conflict.</p>}
    {data.integrity==='partial'&&<p>Named list incomplete; group totals unavailable.</p>}
    {authors.length>0&&<section aria-label="Authors’ votes"><ul className="amendment-named-votes__authors">{authors.map((author,index)=>{const position=authorVotePosition(author.personId,data);return <li key={index}><span lang="" title={author.name}><PersonName id={author.personId} label={author.displayName||author.name}/></span><RecordMemberAffiliation id={author.personId} datedGroup={data.voters.find(voter=>voter.personId===String(author.personId))?.group?.code} language={language}/>{' '}<strong data-position={position}>{({For:'voted for',Against:'voted against',Abstained:'abstained','No recorded vote':'has no recorded vote'} as Record<string,string>)[position]||position}</strong>{decision.partNumber!=null&&['For','Against','Abstained'].includes(position)?' on part '+decision.partNumber:''}.</li>;})}</ul></section>}
    {(data.integrity==='complete'||data.groupHistory===null)&&<details className="amendment-named-votes__groups"><summary>How groups voted</summary>{data.groupHistory===null?<p>Groups unavailable for this date.</p>:data.integrity==='complete'?groups.map(([group,code])=><GroupVotes key={group} code={code} voters={data.voters.filter(voter=>keyOf(voter)===group)} language={language}/>):null}</details>}
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
  const {decision,language}=props;
  if(['LAPSED','WITHDRAWN'].includes(decision.outcome??''))return null;
  if(['CANCELLED','CANCELED','NOT_HELD'].includes(decision.outcome??''))return <p className="explorer-amendment-secondary">Not put to a vote.</p>;
  if(decision.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p className="explorer-amendment-secondary">{knownVoteMethodLabel(decision.method)?'Not individually recorded.':'Named votes unavailable.'}</p>;
  if(['unverified','unresolved-collective'].includes(decision.componentBinding??'')||decision.partNumber!=null&&!decision.partId||decision.partId&&decision.componentBinding!=='single-amendment')return null;
  if(!decisionVotesRoute(decision.id,language))return null;
  return <VisibleVoteRead key={decision.id+':'+language} {...props}/>;
}
